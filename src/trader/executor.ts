import type { Config } from "../config.js";
import { log } from "../logger.js";
import type { TossApi } from "../api/toss.js";
import type { DailyTracker } from "../state.js";
import type { DashboardStore } from "../web/store.js";

export interface OrderPlan {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  /** 판단 근거 가격(원) */
  price: number;
  rsi: number;
}

/**
 * 주문 실행. LIVE_TRADING=true 가 아니면 절대 실주문을 보내지 않고
 * 로그로만 기록(드라이런)한다. 대시보드 스토어에도 이벤트를 남긴다.
 */
export class Executor {
  constructor(
    private readonly config: Config,
    private readonly api: TossApi,
    private readonly tracker: DailyTracker,
    private readonly store?: DashboardStore,
  ) {}

  async execute(plan: OrderPlan): Promise<void> {
    const est = plan.price * plan.quantity;
    const mode = this.config.liveTrading ? "LIVE" : "DRY-RUN";
    const tag = `${plan.side} ${plan.symbol} x${plan.quantity} @${plan.price} (≈${est.toLocaleString()}원, RSI=${plan.rsi.toFixed(1)})`;

    if (!this.config.liveTrading) {
      log.order(`[DRY-RUN] ${tag}`);
      if (plan.side === "BUY") this.tracker.recordBuy(plan.symbol, est);
      this.record(plan, est, mode, "placed");
      return;
    }

    // 실주문
    try {
      const res = await this.api.createOrder({
        symbol: plan.symbol,
        side: plan.side,
        quantity: plan.quantity,
      });
      log.order(`[LIVE] 주문 전송됨 ${tag}`, res);
      if (plan.side === "BUY") this.tracker.recordBuy(plan.symbol, est);
      this.record(plan, est, mode, "sent");
    } catch (err) {
      log.error(`[LIVE] 주문 실패 ${tag}`, String(err));
      this.record(plan, est, mode, "failed", String(err));
    }
  }

  /** 가드 등에 의해 거부된 주문도 대시보드에 남긴다. */
  recordRejection(plan: OrderPlan, reason: string): void {
    const est = plan.price * plan.quantity;
    const mode = this.config.liveTrading ? "LIVE" : "DRY-RUN";
    this.record(plan, est, mode, "rejected", reason);
  }

  private record(
    plan: OrderPlan,
    amountKrw: number,
    mode: "DRY-RUN" | "LIVE",
    status: "placed" | "sent" | "failed" | "rejected",
    reason?: string,
  ): void {
    this.store?.addEvent({
      time: new Date().toISOString(),
      side: plan.side,
      symbol: plan.symbol,
      quantity: plan.quantity,
      price: plan.price,
      amountKrw,
      mode,
      status,
      reason,
    });
  }
}
