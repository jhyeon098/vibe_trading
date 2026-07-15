import "dotenv/config";

/** 봇 전역 설정. .env 에서 로드하고 검증한다. */
export interface Config {
  clientId: string;
  clientSecret: string;
  accountSeq: string | null;
  baseUrl: string;

  /** 정확히 true 일 때만 실주문. 그 외엔 드라이런. */
  liveTrading: boolean;

  // 전략
  rsiPeriod: number;
  rsiBuyThreshold: number;
  rsiSellThreshold: number;

  // 운영
  watchCount: number;
  cycleIntervalSec: number;
  orderAmountKrw: number;

  // 안전 한도 (끌 수 없음, 값만 조절)
  maxOrderKrw: number;
  maxDailyBuyKrw: number;
  maxPositions: number;

  // 웹 대시보드
  webPort: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`환경변수 ${name} 는 양수여야 합니다: "${raw}"`);
  }
  return v;
}

export function loadConfig(): Config {
  const clientId = process.env.TOSS_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.TOSS_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 가 필요합니다. .env 를 확인하세요.",
    );
  }

  const accountSeqRaw = process.env.TOSS_ACCOUNT_SEQ?.trim();
  const accountSeq = accountSeqRaw ? accountSeqRaw : null;

  // 실주문은 정확히 "true" 문자열일 때만. 오타/대문자/1 등은 모두 드라이런.
  const liveTrading = process.env.LIVE_TRADING === "true";

  const config: Config = {
    clientId,
    clientSecret,
    accountSeq,
    baseUrl: process.env.TOSS_BASE_URL?.trim() || "https://openapi.tossinvest.com",
    liveTrading,

    rsiPeriod: num("RSI_PERIOD", 14),
    rsiBuyThreshold: num("RSI_BUY_THRESHOLD", 30),
    rsiSellThreshold: num("RSI_SELL_THRESHOLD", 70),

    watchCount: Math.min(num("WATCH_COUNT", 20), 100),
    cycleIntervalSec: num("CYCLE_INTERVAL_SEC", 60),
    orderAmountKrw: num("ORDER_AMOUNT_KRW", 100_000),

    maxOrderKrw: num("MAX_ORDER_KRW", 100_000),
    maxDailyBuyKrw: num("MAX_DAILY_BUY_KRW", 500_000),
    maxPositions: num("MAX_POSITIONS", 5),

    webPort: num("WEB_PORT", 3000),
  };

  if (config.rsiBuyThreshold >= config.rsiSellThreshold) {
    throw new Error("RSI_BUY_THRESHOLD 는 RSI_SELL_THRESHOLD 보다 작아야 합니다.");
  }
  if (config.orderAmountKrw > config.maxOrderKrw) {
    throw new Error("ORDER_AMOUNT_KRW 가 MAX_ORDER_KRW 를 초과할 수 없습니다.");
  }

  return config;
}
