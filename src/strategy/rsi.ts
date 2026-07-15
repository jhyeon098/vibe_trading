export type Signal = "BUY" | "SELL" | "HOLD";

/**
 * Wilder 방식 RSI 계산. closes 는 과거→현재 순서.
 * 데이터가 period+1 미만이면 null.
 */
export function computeRSI(closes: number[], period: number): number | null {
  if (period <= 0) throw new Error("RSI 기간은 1 이상이어야 합니다.");
  if (closes.length < period + 1) return null;

  // 첫 period 구간의 평균 상승/하락
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  // 이후 구간은 Wilder 평활
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100; // 하락이 전혀 없으면 RSI 100
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * RSI 값과 임계치로 신호 결정.
 * - RSI ≤ buyThreshold           → BUY (과매도)
 * - RSI ≥ sellThreshold && 보유중 → SELL (과매수)
 * - 그 외                         → HOLD
 */
export function decideSignal(
  rsi: number,
  opts: { buyThreshold: number; sellThreshold: number; held: boolean },
): Signal {
  if (rsi <= opts.buyThreshold) return "BUY";
  if (rsi >= opts.sellThreshold && opts.held) return "SELL";
  return "HOLD";
}
