import type { Signal } from "../strategy/rsi.js";

export interface SymbolRow {
  symbol: string;
  name: string;
  rsi: number | null;
  signal: Signal | "SKIP";
  price: number | null;
  held: boolean;
  /** 20일/60일 단순이동평균(원). 데이터 부족 시 null. */
  ma20?: number | null;
  ma60?: number | null;
  /** composite 모드일 때만 채워지는 뉴스/점수 정보. */
  newsScore?: number | null;
  newsLabel?: string;
  keywords?: string[];
  score?: number | null;
  /** 매수 보류 사유 등 부가 설명 (있으면 신호 옆에 표시). */
  note?: string;
}

export interface OrderEvent {
  time: string;
  side: "BUY" | "SELL";
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  amountKrw: number;
  mode: "DRY-RUN" | "LIVE";
  status: "placed" | "sent" | "failed" | "rejected";
  reason?: string;
}

export interface Snapshot {
  mode: "DRY-RUN" | "LIVE";
  startedAt: string;
  lastCycleAt: string | null;
  cycleCount: number;
  running: boolean;
  /** 마지막 사이클에서 발생한 오류 메시지(정상이면 null) */
  lastError: string | null;
  marketOpen: boolean | null;
  config: {
    strategyMode: "rsi" | "composite";
    rsiPeriod: number;
    buyThreshold: number;
    sellThreshold: number;
    orderAmountKrw: number;
    maxOrderKrw: number;
    maxDailyBuyKrw: number;
    maxWeeklyBuyKrw: number;
    maxDailyBuyCount: number;
    maxPositions: number;
    watchCount: number;
    weightRsi: number;
    weightNews: number;
    weightMa: number;
    buyScore: number;
    sellScore: number;
  };
  boughtKrw: number;
  weeklyBoughtKrw: number;
  dailyBuyCount: number;
  buyingPower: number | null;
  holdings: { symbol: string; quantity: number }[];
  rows: SymbolRow[];
  events: OrderEvent[];
}

const MAX_EVENTS = 100;

/** 대시보드가 읽어가는 인메모리 상태. 봇이 사이클마다 갱신한다. */
export class DashboardStore {
  private snap: Snapshot;

  constructor(init: Pick<Snapshot, "mode" | "startedAt" | "config">) {
    this.snap = {
      ...init,
      lastCycleAt: null,
      cycleCount: 0,
      running: false,
      lastError: null,
      marketOpen: null,
      boughtKrw: 0,
      weeklyBoughtKrw: 0,
      dailyBuyCount: 0,
      buyingPower: null,
      holdings: [],
      rows: [],
      events: [],
    };
  }

  beginCycle(): void {
    this.snap.running = true;
  }

  /** 사이클 오류 기록/해제. */
  setError(msg: string | null): void {
    this.snap.lastError = msg;
  }

  endCycle(patch: {
    marketOpen: boolean | null;
    boughtKrw: number;
    weeklyBoughtKrw: number;
    dailyBuyCount: number;
    buyingPower: number | null;
    holdings: { symbol: string; quantity: number }[];
    rows: SymbolRow[];
    lastCycleAt: string;
  }): void {
    this.snap.running = false;
    this.snap.cycleCount++;
    this.snap.marketOpen = patch.marketOpen;
    this.snap.boughtKrw = patch.boughtKrw;
    this.snap.weeklyBoughtKrw = patch.weeklyBoughtKrw;
    this.snap.dailyBuyCount = patch.dailyBuyCount;
    this.snap.buyingPower = patch.buyingPower;
    this.snap.holdings = patch.holdings;
    this.snap.rows = patch.rows;
    this.snap.lastCycleAt = patch.lastCycleAt;
  }

  addEvent(ev: OrderEvent): void {
    this.snap.events.unshift(ev);
    if (this.snap.events.length > MAX_EVENTS) this.snap.events.length = MAX_EVENTS;
  }

  getSnapshot(): Snapshot {
    // 얕은 복사(직렬화 전 안전)
    return { ...this.snap, rows: [...this.snap.rows], events: [...this.snap.events] };
  }
}
