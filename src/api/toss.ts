import type { Config } from "../config.js";
import { TossClient } from "./client.js";

/**
 * 토스증권 Open API 엔드포인트 래퍼.
 *
 * 공식 문서가 일부 응답 필드명을 확정해 두지 않아, 파싱은 방어적으로
 * (여러 후보 키를 확인) 처리한다. 실제 응답과 어긋나면 여기만 고치면 된다.
 */
export class TossApi {
  constructor(
    private readonly client: TossClient,
    private readonly config: Config,
  ) {}

  /** 거래대금 상위 종목 심볼 목록. */
  async getTopSymbols(): Promise<string[]> {
    const data = await this.client.get<Record<string, unknown>>("/api/v1/rankings", {
      query: {
        type: "MARKET_TRADING_AMOUNT",
        marketCountry: "KR",
        duration: "realtime",
        count: this.config.watchCount,
        excludeInvestmentCaution: true,
      },
    });
    const rows = asArray(pick(data, ["rankings", "items", "data", "result"]));
    const symbols: string[] = [];
    for (const row of rows) {
      const sym = pickString(row, ["symbol", "code", "stockCode", "shortCode", "ticker"]);
      if (sym) symbols.push(sym);
    }
    return symbols.slice(0, this.config.watchCount);
  }

  /** 일봉 종가 배열(과거→현재 순). */
  async getDailyCloses(symbol: string, count: number): Promise<number[]> {
    const data = await this.client.get<Record<string, unknown>>("/api/v1/candles", {
      query: { symbol, interval: "1d", count },
    });
    const rows = asArray(pick(data, ["candles", "items", "data", "result"]));
    const closes: number[] = [];
    for (const row of rows) {
      const c = pickNumber(row, ["close", "closePrice", "c", "tradePrice"]);
      if (c !== null) closes.push(c);
    }
    // 응답이 최신→과거로 올 수도 있으므로, 타임스탬프가 있으면 정렬
    const withTs = rows.every(
      (r) => pickNumber(r, ["timestamp", "time", "epoch", "dt"]) !== null,
    );
    if (withTs && closes.length === rows.length) {
      const paired = rows.map((r, i) => ({
        ts: pickNumber(r, ["timestamp", "time", "epoch", "dt"])!,
        close: closes[i]!,
      }));
      paired.sort((a, b) => a.ts - b.ts);
      return paired.map((p) => p.close);
    }
    return closes;
  }

  /** 현재가. */
  async getPrice(symbol: string): Promise<number | null> {
    const data = await this.client.get<Record<string, unknown>>("/api/v1/prices", {
      query: { symbols: symbol },
    });
    const rows = asArray(pick(data, ["prices", "items", "data", "result"])) ;
    const first = rows[0] ?? (data as Record<string, unknown>);
    return pickNumber(first, ["price", "currentPrice", "close", "tradePrice", "last"]);
  }

  /** 계좌 목록에서 첫 계좌의 accountSeq 반환. */
  async getFirstAccountSeq(): Promise<string | null> {
    const data = await this.client.get<Record<string, unknown>>("/api/v1/accounts");
    const rows = asArray(pick(data, ["accounts", "items", "data", "result"]));
    const first = rows[0];
    if (!first) return null;
    const seq = pick(first, ["accountSeq", "accountId", "id", "seq", "accountNo"]);
    return seq !== undefined && seq !== null ? String(seq) : null;
  }

  /** 보유 종목: symbol -> quantity 맵. */
  async getHoldings(): Promise<Map<string, number>> {
    const data = await this.client.get<Record<string, unknown>>("/api/v1/holdings", {
      withAccount: true,
    });
    const rows = asArray(pick(data, ["holdings", "items", "data", "result"]));
    const map = new Map<string, number>();
    for (const row of rows) {
      const sym = pickString(row, ["symbol", "code", "stockCode", "shortCode"]);
      const qty = pickNumber(row, ["quantity", "qty", "balanceQuantity", "holdingQuantity"]);
      if (sym && qty !== null && qty > 0) map.set(sym, qty);
    }
    return map;
  }

  /** 주문 가능 현금(원). */
  async getBuyingPower(): Promise<number | null> {
    const data = await this.client.get<Record<string, unknown>>("/api/v1/buying-power", {
      withAccount: true,
    });
    return pickNumber(data, ["buyingPower", "availableAmount", "cash", "amount", "cashBalance"]);
  }

  /** KRX 개장 여부. 판단 불가하면 null. */
  async isKrMarketOpen(): Promise<boolean | null> {
    try {
      const data = await this.client.get<Record<string, unknown>>("/api/v1/market-calendar/KR");
      const open = pick(data, ["isOpen", "open", "marketOpen", "tradingDay"]);
      if (typeof open === "boolean") return open;
      return null;
    } catch {
      return null;
    }
  }

  /** 시장가 매수/매도 주문 전송 (실주문 모드에서만 호출). */
  async createOrder(input: {
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
  }): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>(
      "/api/v1/orders",
      {
        symbol: input.symbol,
        side: input.side,
        quantity: input.quantity,
        type: "MARKET",
      },
      { withAccount: true },
    );
  }
}

// ---- 방어적 파싱 헬퍼 ----

function pick(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    if (rec[k] !== undefined) return rec[k];
  }
  return undefined;
}

function pickString(obj: unknown, keys: string[]): string | null {
  const v = pick(obj, keys);
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function pickNumber(obj: unknown, keys: string[]): number | null {
  const v = pick(obj, keys);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  return [];
}
