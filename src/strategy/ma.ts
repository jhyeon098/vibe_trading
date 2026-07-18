/**
 * 단순이동평균(SMA). closes 는 과거→현재 순서.
 * 최근 period 개의 평균을 반환하고, 데이터가 period 미만이면 null.
 */
export function sma(closes: number[], period: number): number | null {
  if (period <= 0) return null;
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    sum += closes[i]!;
  }
  return sum / period;
}

/**
 * 이동평균 기반 추세 점수 -1(강한 역배열/하락) ~ +1(강한 정배열/상승).
 * 현재가가 MA20·MA60 대비 얼마나 위/아래인지(±K 이상 벌어지면 포화)를 평균.
 * 가격·이평 중 하나라도 없으면 null (점수 합산에서 제외).
 */
export function trendScore(
  price: number | null,
  ma20: number | null,
  ma60: number | null,
  bandK = 0.1,
): number | null {
  if (price == null || ma20 == null || ma60 == null || ma20 <= 0 || ma60 <= 0) return null;
  const p20 = clamp((price - ma20) / (ma20 * bandK), -1, 1);
  const p60 = clamp((price - ma60) / (ma60 * bandK), -1, 1);
  return (p20 + p60) / 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
