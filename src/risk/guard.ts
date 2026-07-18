import type { Config } from "../config.js";
import type { DailyTracker } from "../state.js";

export interface BuyContext {
  symbol: string;
  /** 이번 주문 예상 금액(원) */
  amountKrw: number;
  /** 현재 보유 종목 수 */
  positionCount: number;
  /** 가용 현금(원). null 이면 확인 불가로 간주 */
  buyingPowerKrw: number | null;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * 끌 수 없는 하드 안전장치. 실주문/드라이런 모두 여기서 검사한다.
 * 어떤 설정으로도 우회할 수 없고 값(한도)만 조절 가능하다.
 */
export class RiskGuard {
  constructor(
    private readonly config: Config,
    private readonly tracker: DailyTracker,
  ) {}

  /** 매수 허용 여부. */
  checkBuy(ctx: BuyContext): GuardResult {
    if (ctx.amountKrw <= 0) {
      return { ok: false, reason: "주문 금액이 0 이하" };
    }
    if (ctx.amountKrw > this.config.maxOrderKrw) {
      return {
        ok: false,
        reason: `주문당 한도 초과 (${ctx.amountKrw} > ${this.config.maxOrderKrw})`,
      };
    }
    if (this.tracker.hasBought(ctx.symbol)) {
      return { ok: false, reason: "당일 이미 매수한 종목(중복 방지)" };
    }
    if (this.tracker.dailyBuyCount >= this.config.maxDailyBuyCount) {
      return {
        ok: false,
        reason: `하루 매수 횟수 한도 도달 (${this.tracker.dailyBuyCount}/${this.config.maxDailyBuyCount}회)`,
      };
    }
    if (this.tracker.boughtKrw + ctx.amountKrw > this.config.maxDailyBuyKrw) {
      return {
        ok: false,
        reason: `일일 매수 한도 초과 (${this.tracker.boughtKrw}+${ctx.amountKrw} > ${this.config.maxDailyBuyKrw})`,
      };
    }
    if (this.tracker.weeklyBoughtKrw + ctx.amountKrw > this.config.maxWeeklyBuyKrw) {
      return {
        ok: false,
        reason: `주간 매수 한도 초과 (${this.tracker.weeklyBoughtKrw}+${ctx.amountKrw} > ${this.config.maxWeeklyBuyKrw})`,
      };
    }
    if (ctx.positionCount >= this.config.maxPositions) {
      return {
        ok: false,
        reason: `최대 보유 종목 수 도달 (${ctx.positionCount}/${this.config.maxPositions})`,
      };
    }
    if (ctx.buyingPowerKrw !== null && ctx.amountKrw > ctx.buyingPowerKrw) {
      return {
        ok: false,
        reason: `가용 현금 부족 (${ctx.amountKrw} > ${ctx.buyingPowerKrw})`,
      };
    }
    return { ok: true };
  }
}
