import type { Config } from "./config.js";
import { log } from "./logger.js";
import { TossClient } from "./api/client.js";
import { TossApi } from "./api/toss.js";
import { computeRSI, decideSignal } from "./strategy/rsi.js";
import { RiskGuard } from "./risk/guard.js";
import { Executor } from "./trader/executor.js";
import { DailyTracker } from "./state.js";
import type { DashboardStore, SymbolRow } from "./web/store.js";

export class Bot {
  private readonly api: TossApi;
  private readonly guard: RiskGuard;
  private readonly executor: Executor;
  private readonly tracker: DailyTracker;
  private accountReady = false;

  constructor(
    private readonly config: Config,
    private readonly store?: DashboardStore,
  ) {
    const client = new TossClient(config);
    this.api = new TossApi(client, config);
    this.tracker = new DailyTracker();
    this.guard = new RiskGuard(config, this.tracker);
    this.executor = new Executor(config, this.api, this.tracker, store);
  }

  /** 계좌번호가 없으면 자동 조회해 config 에 채운다. */
  private async ensureAccount(): Promise<void> {
    if (this.accountReady) return;
    if (!this.config.accountSeq) {
      const seq = await this.api.getFirstAccountSeq();
      if (!seq) throw new Error("계좌를 찾을 수 없습니다. TOSS_ACCOUNT_SEQ 를 .env 에 지정하세요.");
      this.config.accountSeq = seq;
      log.info(`계좌 자동 설정: ${seq}`);
    }
    this.accountReady = true;
  }

  /** 한 사이클 실행. */
  async runCycle(): Promise<void> {
    const mode = this.config.liveTrading ? "LIVE" : "DRY-RUN";
    log.info(`===== 사이클 시작 (${mode}) =====`);
    this.store?.beginCycle();

    const rows: SymbolRow[] = [];
    let marketOpen: boolean | null = null;
    let holdings = new Map<string, number>();
    let buyingPower: number | null = null;

    try {
      await this.ensureAccount();

      marketOpen = await this.api.isKrMarketOpen();
      if (marketOpen === false) {
        log.info("KRX 폐장 상태 — 주문 없이 이번 사이클 종료");
        return;
      }

      const symbols = await this.api.getTopSymbols();
      log.info(`감시 종목 ${symbols.length}개`, symbols);
      if (symbols.length === 0) return;

      holdings = await this.safe("holdings", () => this.api.getHoldings(), new Map<string, number>());
      buyingPower = await this.safe("buying-power", () => this.api.getBuyingPower(), null);

      let positionCount = holdings.size;

      for (const symbol of symbols) {
        const held = holdings.has(symbol);
        try {
          const closes = await this.api.getDailyCloses(symbol, this.config.rsiPeriod + 1);
          const rsi = computeRSI(closes, this.config.rsiPeriod);
          if (rsi === null) {
            log.debug(`${symbol}: 데이터 부족으로 RSI 계산 불가`);
            rows.push({ symbol, rsi: null, signal: "SKIP", price: null, held });
            continue;
          }

          const signal = decideSignal(rsi, {
            buyThreshold: this.config.rsiBuyThreshold,
            sellThreshold: this.config.rsiSellThreshold,
            held,
          });
          log.debug(`${symbol}: RSI=${rsi.toFixed(1)} → ${signal}${held ? " (보유)" : ""}`);

          let price: number | null = null;
          if (signal === "BUY") {
            price = await this.handleBuy(symbol, rsi, positionCount, buyingPower);
            if (price !== null && this.tracker.hasBought(symbol)) positionCount++;
          } else if (signal === "SELL") {
            price = await this.handleSell(symbol, rsi, holdings.get(symbol)!);
          }
          rows.push({ symbol, rsi, signal, price, held });
        } catch (err) {
          log.warn(`${symbol} 처리 중 오류 — 스킵`, String(err));
          rows.push({ symbol, rsi: null, signal: "SKIP", price: null, held });
        }
      }

      log.info(`===== 사이클 종료 (당일 매수누계 ${this.tracker.boughtKrw.toLocaleString()}원) =====`);
    } finally {
      this.store?.endCycle({
        marketOpen,
        boughtKrw: this.tracker.boughtKrw,
        buyingPower,
        holdings: [...holdings.entries()].map(([symbol, quantity]) => ({ symbol, quantity })),
        rows,
        lastCycleAt: new Date().toISOString(),
      });
    }
  }

  /** 매수 처리. 실행에 사용한 현재가를 반환(스킵 시 null). */
  private async handleBuy(
    symbol: string,
    rsi: number,
    positionCount: number,
    buyingPower: number | null,
  ): Promise<number | null> {
    const price = await this.api.getPrice(symbol);
    if (price === null || price <= 0) {
      log.warn(`${symbol}: 현재가 조회 실패 — 매수 스킵`);
      return null;
    }
    const quantity = Math.floor(this.config.orderAmountKrw / price);
    if (quantity < 1) {
      log.info(`${symbol}: 1주 가격(${price})이 주문금액(${this.config.orderAmountKrw})보다 큼 — 스킵`);
      return price;
    }
    const amountKrw = price * quantity;

    const verdict = this.guard.checkBuy({ symbol, amountKrw, positionCount, buyingPowerKrw: buyingPower });
    if (!verdict.ok) {
      log.info(`${symbol}: 매수 거부 — ${verdict.reason}`);
      this.executor.recordRejection({ symbol, side: "BUY", quantity, price, rsi }, verdict.reason ?? "거부");
      return price;
    }

    await this.executor.execute({ symbol, side: "BUY", quantity, price, rsi });
    return price;
  }

  /** 매도 처리. 사용한 현재가 반환. */
  private async handleSell(symbol: string, rsi: number, quantity: number): Promise<number | null> {
    const price = (await this.api.getPrice(symbol)) ?? 0;
    await this.executor.execute({ symbol, side: "SELL", quantity, price, rsi });
    return price || null;
  }

  /** 실패해도 사이클을 계속 진행하기 위한 안전 래퍼. */
  private async safe<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      log.warn(`${name} 조회 실패 — 기본값 사용`, String(err));
      return fallback;
    }
  }
}
