import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR" | "ORDER";

const LOG_DIR = "logs";

function ensureDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function ts(): string {
  // 로컬(KST 가정) 타임스탬프
  return new Date().toISOString();
}

function write(level: Level, msg: string, extra?: unknown): void {
  const line =
    `[${ts()}] ${level.padEnd(5)} ${msg}` +
    (extra !== undefined ? ` ${safeJson(extra)}` : "");

  const consoleFn =
    level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  consoleFn(line);

  ensureDir();
  try {
    appendFileSync(join(LOG_DIR, "bot.log"), line + "\n");
    if (level === "ORDER") {
      appendFileSync(join(LOG_DIR, "orders.log"), line + "\n");
    }
  } catch {
    /* 파일 로깅 실패는 무시(콘솔은 이미 출력됨) */
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (m: string, e?: unknown) => write("DEBUG", m, e),
  info: (m: string, e?: unknown) => write("INFO", m, e),
  warn: (m: string, e?: unknown) => write("WARN", m, e),
  error: (m: string, e?: unknown) => write("ERROR", m, e),
  /** 주문 관련 이벤트는 별도 orders.log 에도 기록 */
  order: (m: string, e?: unknown) => write("ORDER", m, e),
};
