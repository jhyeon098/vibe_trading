import type { Signal } from "./rsi.js";
import type { NewsResult } from "./news.js";

export interface CompositeInput {
  rsi: number | null;
  news: NewsResult | null;
  /** 이동평균 추세 점수 -1~+1 (없으면 null). */
  maScore: number | null;
  buyThreshold: number;
  sellThreshold: number;
  held: boolean;
  weightRsi: number;
  weightNews: number;
  weightMa: number;
  buyScore: number;
  sellScore: number;
}

export interface CompositeResult {
  signal: Signal | "SKIP";
  /** 종합 점수 -1(강한 매도) ~ +1(강한 매수). */
  score: number;
  /** RSI 기반 점수 -1 ~ +1. */
  rsiScore: number;
  /** 뉴스 감성 점수 -1 ~ +1. */
  newsScore: number;
  /** 이동평균 추세 점수 -1 ~ +1. */
  maScore: number;
}

/**
 * RSI 를 -1~+1 매수압력 점수로 정규화한다 (평균회귀 관점).
 * - RSI = buyThreshold  → +1 (과매도, 매수 우호)
 * - RSI = 중간값(50 기준) → 0
 * - RSI = sellThreshold → -1 (과매수, 매도 우호)
 */
export function rsiToScore(rsi: number, buyThreshold: number, sellThreshold: number): number {
  const mid = (buyThreshold + sellThreshold) / 2;
  const span = mid - buyThreshold || 1;
  return clamp((mid - rsi) / span, -1, 1);
}

/**
 * RSI 점수와 뉴스 감성 점수를 가중합해 최종 신호를 낸다.
 * - 종합점수 ≥ buyScore            → BUY
 * - 종합점수 ≤ sellScore && 보유중 → SELL
 * - 그 외                          → HOLD
 * RSI·뉴스 둘 다 없으면 SKIP.
 */
export function decideComposite(input: CompositeInput): CompositeResult {
  const hasRsi = input.rsi !== null;
  const hasNews = input.news !== null;
  const hasMa = input.maScore !== null;
  if (!hasRsi && !hasNews && !hasMa) {
    return { signal: "SKIP", score: 0, rsiScore: 0, newsScore: 0, maScore: 0 };
  }

  const rsiScore = hasRsi ? rsiToScore(input.rsi!, input.buyThreshold, input.sellThreshold) : 0;
  const newsScore = hasNews ? clamp(input.news!.score, -1, 1) : 0;
  const maScore = hasMa ? clamp(input.maScore!, -1, 1) : 0;

  // 실제 존재하는 신호에만 가중치를 부여해 정규화 (없는 요소는 가중치 0)
  const wRsi = hasRsi ? input.weightRsi : 0;
  const wNews = hasNews ? input.weightNews : 0;
  const wMa = hasMa ? input.weightMa : 0;
  const wSum = wRsi + wNews + wMa;
  const score = wSum === 0 ? 0 : (rsiScore * wRsi + newsScore * wNews + maScore * wMa) / wSum;

  let signal: Signal;
  if (score >= input.buyScore) signal = "BUY";
  else if (score <= input.sellScore && input.held) signal = "SELL";
  else signal = "HOLD";

  return { signal, score, rsiScore, newsScore, maScore };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
