import type { Config } from "../config.js";
import { TossClient } from "./client.js";

/**
 * 토스증권 Open API 엔드포인트 래퍼.
 *
 * 모든 응답은 `{ result: ... }` 로 감싸져 오므로 unwrap 후 파싱한다.
 * 필드명은 실제 응답 기준(2026-07 확인): rankings/candles/items 등.
 */
export class TossApi {
  constructor(
    private readonly client: TossClient,
    private readonly config: Config,
  ) {}

  /** 거래대금 상위 종목 (심볼 + 랭킹 응답에 담긴 현재가). */
  async getTopStocks(): Promise<{ symbol: string; price: number | null }[]> {
    const data = await this.client.get<unknown>("/api/v1/rankings", {
      query: {
        type: "MARKET_TRADING_AMOUNT",
        marketCountry: "KR",
        duration: "realtime",
        count: this.config.watchCount,
        excludeInvestmentCaution: true,
      },
    });
    const rows = asArray(pick(unwrap(data), ["rankings", "items", "data"]));
    const out: { symbol: string; price: number | null }[] = [];
    for (const row of rows) {
      const sym = pickString(row, ["symbol", "code", "stockCode", "shortCode", "ticker"]);
      if (!sym) continue;
      // price 는 { lastPrice } 중첩 객체 또는 평면 필드일 수 있음
      const priceObj = pick(row, ["price"]);
      const price =
        pickNumber(priceObj, ["lastPrice", "price", "close"]) ??
        pickNumber(row, ["lastPrice", "price", "close", "tradePrice"]);
      out.push({ symbol: sym, price });
    }
    return out.slice(0, this.config.watchCount);
  }

  /** 일봉 종가 배열(과거→현재 순). */
  async getDailyCloses(symbol: string, count: number): Promise<number[]> {
    const data = await this.client.get<unknown>("/api/v1/candles", {
      query: { symbol, interval: "1d", count },
    });
    const rows = asArray(pick(unwrap(data), ["candles", "items", "data"]));

    const entries: { ts: number; close: number }[] = [];
    for (const row of rows) {
      const close = pickNumber(row, ["closePrice", "close", "c", "tradePrice"]);
      if (close === null) continue;
      const ts = pickTimestamp(row, ["timestamp", "time", "epoch", "dt", "date"]);
      entries.push({ ts: ts ?? entries.length, close });
    }
    // 응답이 최신→과거 순이므로 시각 기준 오름차순 정렬
    entries.sort((a, b) => a.ts - b.ts);
    return entries.map((e) => e.close);
  }

  /** 현재가. */
  async getPrice(symbol: string): Promise<number | null> {
    const data = await this.client.get<unknown>("/api/v1/prices", {
      query: { symbols: symbol },
    });
    const root = unwrap(data);
    const rows = Array.isArray(root) ? (root as Record<string, unknown>[]) : asArray(pick(root, ["prices", "items", "data"]));
    const first = rows[0] ?? (root as Record<string, unknown>);
    return pickNumber(first, ["lastPrice", "price", "currentPrice", "close", "tradePrice", "last"]);
  }

  /** 계좌 목록에서 첫 계좌의 accountSeq 반환. */
  async getFirstAccountSeq(): Promise<string | null> {
    const data = await this.client.get<unknown>("/api/v1/accounts");
    const root = unwrap(data);
    const rows = Array.isArray(root) ? (root as Record<string, unknown>[]) : asArray(pick(root, ["accounts", "items", "data"]));
    const first = rows[0];
    if (!first) return null;
    const seq = pick(first, ["accountSeq", "accountId", "id", "seq", "accountNo"]);
    return seq !== undefined && seq !== null ? String(seq) : null;
  }

  /** 보유 종목: symbol -> quantity 맵. */
  async getHoldings(): Promise<Map<string, number>> {
    const data = await this.client.get<unknown>("/api/v1/holdings", { withAccount: true });
    const rows = asArray(pick(unwrap(data), ["items", "holdings", "data"]));
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
    const data = await this.client.get<unknown>("/api/v1/buying-power", {
      query: { currency: "KRW" },
      withAccount: true,
    });
    return pickNumber(unwrap(data), [
      "cashBuyingPower",
      "buyingPower",
      "availableAmount",
      "cash",
      "amount",
      "cashBalance",
    ]);
  }

  /** KRX 정규장 개장 여부. 판단 불가하면 null. */
  async isKrMarketOpen(): Promise<boolean | null> {
    try {
      const data = await this.client.get<unknown>("/api/v1/market-calendar/KR");
      const today = pick(unwrap(data), ["today"]);
      const regular = pick(pick(today, ["integrated"]), ["regularMarket"]);
      const start = pickTimestamp(regular, ["startTime"]);
      const end = pickTimestamp(regular, ["endTime"]);
      if (start === null || end === null) return null;
      const now = Date.now();
      return now >= start && now <= end;
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

/** 토스 응답의 { result: ... } 래핑을 벗긴다. */
function unwrap(data: unknown): unknown {
  if (data && typeof data === "object" && "result" in (data as Record<string, unknown>)) {
    return (data as Record<string, unknown>).result;
  }
  return data;
}

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

/** ISO 문자열 또는 epoch 숫자를 epoch ms 로. */
function pickTimestamp(obj: unknown, keys: string[]): number | null {
  const v = pick(obj, keys);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  return [];
}
