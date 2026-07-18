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

  /** "rsi" = RSI 단독, "composite" = RSI + 뉴스 점수 합산 */
  strategyMode: "rsi" | "composite";

  // 뉴스 전략 (composite 모드에서 사용)
  newsEnabled: boolean;
  newsLookbackDays: number;
  newsTtlMin: number;
  /** composite 점수 가중치 (RSI / 뉴스 감성 / 이동평균 추세) */
  weightRsi: number;
  weightNews: number;
  weightMa: number;
  /** composite 종합점수 임계치 */
  buyScoreThreshold: number;
  sellScoreThreshold: number;

  // 매수 타이밍 필터 (BUY 신호에만 적용)
  /** 최근 밴드 위치가 이 값(0~1) 이상이면 매수 금지(고점 차단). 1 이상이면 사실상 off. */
  highGuardPct: number;
  /** true 면 '가격이 직전 종가보다 오른 뒤'에만 매수(반등 확인). */
  reboundConfirm: boolean;

  // 운영
  watchCount: number;
  cycleIntervalSec: number;
  orderAmountKrw: number;

  // 안전 한도 (끌 수 없음, 값만 조절)
  maxOrderKrw: number;
  maxDailyBuyKrw: number;
  maxWeeklyBuyKrw: number;
  maxDailyBuyCount: number;
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

/** 0·음수도 허용하는 실수 파서 (가중치·점수 임계치용). */
function float(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    throw new Error(`환경변수 ${name} 는 숫자여야 합니다: "${raw}"`);
  }
  return v;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
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

    strategyMode: process.env.STRATEGY_MODE?.trim() === "rsi" ? "rsi" : "composite",

    newsEnabled: bool("NEWS_ENABLED", true),
    newsLookbackDays: num("NEWS_LOOKBACK_DAYS", 7),
    newsTtlMin: num("NEWS_TTL_MIN", 15),
    weightRsi: float("WEIGHT_RSI", 0.5),
    weightNews: float("WEIGHT_NEWS", 0.3),
    weightMa: float("WEIGHT_MA", 0.2),
    buyScoreThreshold: float("BUY_SCORE_THRESHOLD", 0.5),
    sellScoreThreshold: float("SELL_SCORE_THRESHOLD", -0.5),

    highGuardPct: float("HIGH_GUARD_PCT", 0.8),
    reboundConfirm: bool("REBOUND_CONFIRM", true),

    watchCount: Math.min(num("WATCH_COUNT", 20), 100),
    cycleIntervalSec: num("CYCLE_INTERVAL_SEC", 60),
    orderAmountKrw: num("ORDER_AMOUNT_KRW", 100_000),

    maxOrderKrw: num("MAX_ORDER_KRW", 100_000),
    maxDailyBuyKrw: num("MAX_DAILY_BUY_KRW", 500_000),
    maxWeeklyBuyKrw: num("MAX_WEEKLY_BUY_KRW", 200_000),
    maxDailyBuyCount: num("MAX_DAILY_BUY_COUNT", 1),
    maxPositions: num("MAX_POSITIONS", 5),

    webPort: num("WEB_PORT", 3000),
  };

  if (config.rsiBuyThreshold >= config.rsiSellThreshold) {
    throw new Error("RSI_BUY_THRESHOLD 는 RSI_SELL_THRESHOLD 보다 작아야 합니다.");
  }
  if (config.orderAmountKrw > config.maxOrderKrw) {
    throw new Error("ORDER_AMOUNT_KRW 가 MAX_ORDER_KRW 를 초과할 수 없습니다.");
  }
  if (config.weightRsi < 0 || config.weightNews < 0 || config.weightMa < 0) {
    throw new Error("WEIGHT_RSI / WEIGHT_NEWS / WEIGHT_MA 는 음수일 수 없습니다.");
  }
  if (config.strategyMode === "composite" && config.weightRsi + config.weightNews + config.weightMa === 0) {
    throw new Error("composite 모드에서 가중치 합(WEIGHT_RSI+WEIGHT_NEWS+WEIGHT_MA)은 0보다 커야 합니다.");
  }
  if (config.buyScoreThreshold <= config.sellScoreThreshold) {
    throw new Error("BUY_SCORE_THRESHOLD 는 SELL_SCORE_THRESHOLD 보다 커야 합니다.");
  }
  if (config.highGuardPct <= 0) {
    throw new Error("HIGH_GUARD_PCT 는 0보다 커야 합니다. (끄려면 1 이상)");
  }

  return config;
}
