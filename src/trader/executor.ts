import type { Config } from "../config.js";
import { log } from "../logger.js";
import type { TossApi } from "../api/toss.js";
import type { DailyTracker } from "../state.js";

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
 * 로그로만 기록(드라이런)한다.
 */
export class Executor {
  constructor(
    private readonly config: Config,
    private readonly api: TossApi,
    private readonly tracker: DailyTracker,
  ) {}

  async execute(plan: OrderPlan): Promise<void> {
    const est = plan.price * plan.quantity;
    const tag = `${plan.side} ${plan.symbol} x${plan.quantity} @${plan.price} (≈${est.toLocaleString()}원, RSI=${plan.rsi.toFixed(1)})`;

    if (!this.config.liveTrading) {
      log.order(`[DRY-RUN] ${tag}`);
      if (plan.side === "BUY") this.tracker.recordBuy(plan.symbol, est);
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
    } catch (err) {
      log.error(`[LIVE] 주문 실패 ${tag}`, String(err));
    }
  }
}
