import type { Config } from "./config.js";
import { log } from "./logger.js";
import { TossClient } from "./api/client.js";
import { TossApi } from "./api/toss.js";
import { computeRSI, decideSignal } from "./strategy/rsi.js";
import { NewsProvider, type NewsResult } from "./strategy/news.js";
import { decideComposite } from "./strategy/composite.js";
import { entryFilter } from "./strategy/entry.js";
import { sma, trendScore } from "./strategy/ma.js";
import { RiskGuard } from "./risk/guard.js";
import { Executor } from "./trader/executor.js";
import { DailyTracker } from "./state.js";
import type { DashboardStore, SymbolRow } from "./web/store.js";

export class Bot {
  private readonly api: TossApi;
  private readonly guard: RiskGuard;
  private readonly executor: Executor;
  private readonly tracker: DailyTracker;
  private readonly news: NewsProvider | null;
  /** symbol → 종목명. 사이클마다 누적(보유/이벤트 표시에 재사용). */
  private readonly names = new Map<string, string>();
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
    this.news =
      config.strategyMode === "composite" && config.newsEnabled
        ? new NewsProvider({ lookbackDays: config.newsLookbackDays, ttlMin: config.newsTtlMin })
        : null;
  }

  /** 심볼의 표시 이름 (없으면 심볼 코드). */
  private nameOf(symbol: string): string {
    return this.names.get(symbol) ?? symbol;
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
      // 폐장·상태미확인이어도 신호는 계산/표시하되, 주문은 정규장이 확실히 열렸을 때만.
      const tradingAllowed = marketOpen === true;
      if (!tradingAllowed) {
        log.info(
          marketOpen === false
            ? "KRX 폐장 — 신호는 계산하되 주문은 보류합니다."
            : "KRX 장 상태 미확인 — 안전하게 주문을 보류합니다.",
        );
      }

      const stocks = await this.api.getTopStocks();
      // 종목명 레지스트리 갱신: 랭킹 응답에 이름이 없으면 /stocks 로 배치 조회
      for (const s of stocks) if (s.name) this.names.set(s.symbol, s.name);
      const missing = stocks.map((s) => s.symbol).filter((sym) => !this.names.has(sym));
      if (missing.length > 0) {
        const resolved = await this.safe("stock-names", () => this.api.getStockNames(missing), new Map<string, string>());
        for (const [sym, name] of resolved) this.names.set(sym, name);
      }
      log.info(`감시 종목 ${stocks.length}개`, stocks.map((s) => this.nameOf(s.symbol)));
      if (stocks.length === 0) return;

      holdings = await this.safe("holdings", () => this.api.getHoldings(), new Map<string, number>());
      buyingPower = await this.safe("buying-power", () => this.api.getBuyingPower(), null);

      // 뉴스는 종목별로 미리 병렬 수집(캐시 워밍업). 실패는 내부에서 중립 흡수.
      if (this.news) {
        await Promise.all(stocks.map((s) => this.news!.get(s.symbol, this.nameOf(s.symbol))));
      }

      let positionCount = holdings.size;

      for (const { symbol, price: rankPrice } of stocks) {
        const name = this.nameOf(symbol);
        const held = holdings.has(symbol);
        try {
          // Wilder RSI 워밍업 + MA60 계산을 위해 최소 60개(약 3개월) 이상 조회
          const closes = await this.api.getDailyCloses(symbol, Math.max(this.config.rsiPeriod * 4 + 1, 60));
          const rsi = computeRSI(closes, this.config.rsiPeriod);
          const ma20 = sma(closes, 20);
          const ma60 = sma(closes, 60);
          const lastClose = closes.length ? closes[closes.length - 1]! : null;
          const maScore = trendScore(lastClose, ma20, ma60);

          const news = this.news ? await this.news.get(symbol, name) : null;
          const decision = this.decide(rsi, news, maScore, held);

          if (decision.signal === "SKIP") {
            log.debug(`${name}: 데이터 부족으로 신호 계산 불가`);
            rows.push({ symbol, name, rsi, signal: "SKIP", price: rankPrice, held, ma20, ma60, ...newsFields(news, decision.score) });
            continue;
          }
          const { signal } = decision;
          log.debug(
            `${name}: RSI=${rsi === null ? "-" : rsi.toFixed(1)}` +
              (news ? ` 뉴스=${news.label}(${news.score.toFixed(2)})` : "") +
              (maScore !== null ? ` 추세=${maScore.toFixed(2)}` : "") +
              ` 종합=${decision.score.toFixed(2)} → ${signal}${held ? " (보유)" : ""}`,
          );

          // 주문 실행 시엔 신선한 현재가를 쓰고, 없으면 랭킹 가격으로 폴백
          let price = rankPrice;
          if (tradingAllowed && signal !== "HOLD") {
            price = (await this.api.getPrice(symbol)) ?? rankPrice;
          }

          // 매수 타이밍 필터: 고점 차단 + 반등 확인 (BUY 신호에만)
          let effectiveSignal = signal;
          let note: string | undefined;
          if (effectiveSignal === "BUY") {
            const filt = entryFilter(closes, {
              highGuardPct: this.config.highGuardPct,
              requireRebound: this.config.reboundConfirm,
            });
            if (!filt.ok) {
              log.info(`${name}: 매수 보류 — ${filt.reason}`);
              effectiveSignal = "HOLD";
              note = filt.reason;
            }
          }

          // 주문·이벤트 로그에 쓸 RSI 는 계산 불가 시 0 으로 대체(뉴스 단독 신호 대비)
          const rsiForOrder = rsi ?? 0;
          if (tradingAllowed && effectiveSignal === "BUY" && price !== null) {
            const bought = await this.handleBuy(symbol, name, rsiForOrder, price, positionCount, buyingPower);
            if (bought) positionCount++;
          } else if (tradingAllowed && effectiveSignal === "SELL" && price !== null) {
            await this.handleSell(symbol, name, rsiForOrder, price, holdings.get(symbol)!);
          }
          rows.push({ symbol, name, rsi, signal: effectiveSignal, price, held, note, ma20, ma60, ...newsFields(news, decision.score) });
        } catch (err) {
          log.warn(`${name} 처리 중 오류 — 스킵`, String(err));
          rows.push({ symbol, name, rsi: null, signal: "SKIP", price: rankPrice, held });
        }
      }

      log.info(`===== 사이클 종료 (당일 매수누계 ${this.tracker.boughtKrw.toLocaleString()}원) =====`);
    } finally {
      this.store?.endCycle({
        marketOpen,
        boughtKrw: this.tracker.boughtKrw,
        weeklyBoughtKrw: this.tracker.weeklyBoughtKrw,
        dailyBuyCount: this.tracker.dailyBuyCount,
        buyingPower,
        holdings: [...holdings.entries()].map(([symbol, quantity]) => ({ symbol, quantity })),
        rows,
        lastCycleAt: new Date().toISOString(),
      });
    }
  }

  /** 전략 모드에 따라 신호를 결정한다. */
  private decide(
    rsi: number | null,
    news: NewsResult | null,
    maScore: number | null,
    held: boolean,
  ): { signal: "BUY" | "SELL" | "HOLD" | "SKIP"; score: number } {
    if (this.config.strategyMode === "composite") {
      const r = decideComposite({
        rsi,
        news,
        maScore,
        buyThreshold: this.config.rsiBuyThreshold,
        sellThreshold: this.config.rsiSellThreshold,
        held,
        weightRsi: this.config.weightRsi,
        weightNews: this.config.weightNews,
        weightMa: this.config.weightMa,
        buyScore: this.config.buyScoreThreshold,
        sellScore: this.config.sellScoreThreshold,
      });
      return { signal: r.signal, score: r.score };
    }
    // RSI 단독
    if (rsi === null) return { signal: "SKIP", score: 0 };
    const signal = decideSignal(rsi, {
      buyThreshold: this.config.rsiBuyThreshold,
      sellThreshold: this.config.rsiSellThreshold,
      held,
    });
    return { signal, score: 0 };
  }

  /** 매수 처리. 실제 매수가 실행됐으면 true. */
  private async handleBuy(
    symbol: string,
    name: string,
    rsi: number,
    price: number,
    positionCount: number,
    buyingPower: number | null,
  ): Promise<boolean> {
    if (price <= 0) return false;
    const quantity = Math.floor(this.config.orderAmountKrw / price);
    if (quantity < 1) {
      log.info(`${name}: 1주 가격(${price})이 주문금액(${this.config.orderAmountKrw})보다 큼 — 스킵`);
      return false;
    }
    const amountKrw = price * quantity;

    const verdict = this.guard.checkBuy({ symbol, amountKrw, positionCount, buyingPowerKrw: buyingPower });
    if (!verdict.ok) {
      log.info(`${name}: 매수 거부 — ${verdict.reason}`);
      this.executor.recordRejection({ symbol, name, side: "BUY", quantity, price, rsi }, verdict.reason ?? "거부");
      return false;
    }

    await this.executor.execute({ symbol, name, side: "BUY", quantity, price, rsi });
    return this.tracker.hasBought(symbol);
  }

  /** 매도 처리. */
  private async handleSell(symbol: string, name: string, rsi: number, price: number, quantity: number): Promise<void> {
    await this.executor.execute({ symbol, name, side: "SELL", quantity, price, rsi });
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

/** SymbolRow 에 넣을 뉴스/종합점수 필드 (뉴스 비활성 시 빈 객체). */
function newsFields(
  news: NewsResult | null,
  score: number,
): Pick<SymbolRow, "newsScore" | "newsLabel" | "keywords" | "score"> {
  if (!news) return {};
  return { newsScore: news.score, newsLabel: news.label, keywords: news.keywords, score };
}
