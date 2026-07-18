import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_DIR = "state";
const STATE_FILE = join(STATE_DIR, "daily.json");

interface DailyState {
  /** YYYY-MM-DD (UTC) */
  date: string;
  /** 이번 주 시작(월요일) YYYY-MM-DD (UTC) */
  week: string;
  /** 당일 시뮬레이션/실주문으로 매수한 총 금액(원) */
  boughtKrw: number;
  /** 당일 매수 실행 횟수 */
  boughtCount: number;
  /** 이번 주 매수한 총 금액(원) */
  weekBoughtKrw: number;
  /** 당일 이미 매수 신호를 실행한 종목 (중복 매수 방지) */
  boughtSymbols: string[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 이번 주 월요일(UTC) YYYY-MM-DD. */
function weekStart(): string {
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - dow);
  return monday.toISOString().slice(0, 10);
}

/** 당일/주간 매수 누계·횟수·종목을 추적. 날짜/주가 바뀌면 자동 리셋. */
export class DailyTracker {
  private state: DailyState;

  constructor() {
    this.state = this.load();
    this.rolloverIfNeeded();
  }

  get boughtKrw(): number {
    this.rolloverIfNeeded();
    return this.state.boughtKrw;
  }

  get dailyBuyCount(): number {
    this.rolloverIfNeeded();
    return this.state.boughtCount;
  }

  get weeklyBoughtKrw(): number {
    this.rolloverIfNeeded();
    return this.state.weekBoughtKrw;
  }

  hasBought(symbol: string): boolean {
    this.rolloverIfNeeded();
    return this.state.boughtSymbols.includes(symbol);
  }

  recordBuy(symbol: string, amountKrw: number): void {
    this.rolloverIfNeeded();
    this.state.boughtKrw += amountKrw;
    this.state.weekBoughtKrw += amountKrw;
    this.state.boughtCount += 1;
    if (!this.state.boughtSymbols.includes(symbol)) {
      this.state.boughtSymbols.push(symbol);
    }
    this.persist();
  }

  private rolloverIfNeeded(): void {
    const d = today();
    const w = weekStart();
    let changed = false;
    // 주 리셋은 일 리셋보다 먼저 (주 누계는 요일 무관하게 유지)
    if (this.state.week !== w) {
      this.state.week = w;
      this.state.weekBoughtKrw = 0;
      changed = true;
    }
    if (this.state.date !== d) {
      this.state.date = d;
      this.state.boughtKrw = 0;
      this.state.boughtCount = 0;
      this.state.boughtSymbols = [];
      changed = true;
    }
    if (changed) this.persist();
  }

  private load(): DailyState {
    try {
      const raw = readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<DailyState>;
      return {
        date: parsed.date ?? today(),
        week: parsed.week ?? weekStart(),
        boughtKrw: parsed.boughtKrw ?? 0,
        boughtCount: parsed.boughtCount ?? 0,
        weekBoughtKrw: parsed.weekBoughtKrw ?? 0,
        boughtSymbols: parsed.boughtSymbols ?? [],
      };
    } catch {
      return { date: today(), week: weekStart(), boughtKrw: 0, boughtCount: 0, weekBoughtKrw: 0, boughtSymbols: [] };
    }
  }

  private persist(): void {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch {
      /* 상태 저장 실패는 치명적이지 않음 */
    }
  }
}
