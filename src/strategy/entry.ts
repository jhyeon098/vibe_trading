export interface EntryFilterResult {
  /** true 면 매수 허용. */
  ok: boolean;
  /** 차단 사유 (ok=false 일 때). */
  reason?: string;
  /** 최근 구간 내 밴드 위치 0(저점)~1(고점). 계산 불가면 null. */
  bandPct: number | null;
  /** 직전 종가 대비 반등 여부. 계산 불가면 null. */
  rebounded: boolean | null;
}

/**
 * BUY 신호에 적용하는 매수 타이밍 필터 (순수함수).
 *
 * - 고점 차단: 최근 구간 밴드 위치가 highGuardPct 이상이면 매수 금지
 *   (뉴스가 아무리 좋아도 고점 추격 방지)
 * - 반등 확인: requireRebound 면 '직전 종가보다 오른' 상태에서만 매수
 *   (떨어지는 칼날 잡기 방지 — 급락 후 반등 초입만 진입)
 *
 * closes 는 과거→현재 순. 데이터가 2개 미만이면 판단 불가로 통과시킨다.
 */
export function entryFilter(
  closes: number[],
  opts: { highGuardPct: number; requireRebound: boolean },
): EntryFilterResult {
  if (closes.length < 2) {
    return { ok: true, bandPct: null, rebounded: null };
  }
  const cur = closes[closes.length - 1]!;
  const prev = closes[closes.length - 2]!;
  const hi = Math.max(...closes);
  const lo = Math.min(...closes);
  const bandPct = hi === lo ? 0 : (cur - lo) / (hi - lo);
  const rebounded = cur > prev;

  if (bandPct >= opts.highGuardPct) {
    return { ok: false, reason: `고점 근처(밴드 ${Math.round(bandPct * 100)}%)`, bandPct, rebounded };
  }
  if (opts.requireRebound && !rebounded) {
    return { ok: false, reason: "반등 미확인(직전 종가 대비 하락/보합)", bandPct, rebounded };
  }
  return { ok: true, bandPct, rebounded };
}
