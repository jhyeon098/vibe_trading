import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_DIR = "state";
const STATE_FILE = join(STATE_DIR, "daily.json");

interface DailyState {
  /** YYYY-MM-DD (로컬) */
  date: string;
  /** 당일 시뮬레이션/실주문으로 매수한 총 금액(원) */
  boughtKrw: number;
  /** 당일 이미 매수 신호를 실행한 종목 (중복 매수 방지) */
  boughtSymbols: string[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 당일 매수 누계와 매수 종목을 추적. 날짜가 바뀌면 자동 리셋. */
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

  hasBought(symbol: string): boolean {
    this.rolloverIfNeeded();
    return this.state.boughtSymbols.includes(symbol);
  }

  recordBuy(symbol: string, amountKrw: number): void {
    this.rolloverIfNeeded();
    this.state.boughtKrw += amountKrw;
    if (!this.state.boughtSymbols.includes(symbol)) {
      this.state.boughtSymbols.push(symbol);
    }
    this.persist();
  }

  private rolloverIfNeeded(): void {
    const d = today();
    if (this.state.date !== d) {
      this.state = { date: d, boughtKrw: 0, boughtSymbols: [] };
      this.persist();
    }
  }

  private load(): DailyState {
    try {
      const raw = readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<DailyState>;
      return {
        date: parsed.date ?? today(),
        boughtKrw: parsed.boughtKrw ?? 0,
        boughtSymbols: parsed.boughtSymbols ?? [],
      };
    } catch {
      return { date: today(), boughtKrw: 0, boughtSymbols: [] };
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
