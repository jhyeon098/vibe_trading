import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { Bot } from "./bot.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  const once = process.argv.includes("--once");

  log.info("vibestock 시작", {
    mode: config.liveTrading ? "LIVE(실주문)" : "DRY-RUN(시뮬레이션)",
    watchCount: config.watchCount,
    rsi: `${config.rsiBuyThreshold}/${config.rsiSellThreshold} (기간 ${config.rsiPeriod})`,
    orderAmountKrw: config.orderAmountKrw,
    limits: `주문 ${config.maxOrderKrw} / 일일 ${config.maxDailyBuyKrw} / 최대 ${config.maxPositions}종목`,
    interval: `${config.cycleIntervalSec}s`,
  });

  if (config.liveTrading) {
    log.warn("⚠️  LIVE 모드: 실제 주문이 전송됩니다.");
  } else {
    log.info("드라이런 모드: 주문은 로그로만 기록됩니다.");
  }

  const bot = new Bot(config);

  let stopping = false;
  const stop = (sig: string) => {
    log.info(`${sig} 수신 — 현재 사이클 후 종료합니다.`);
    stopping = true;
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  do {
    try {
      await bot.runCycle();
    } catch (err) {
      log.error("사이클 실행 중 치명적 오류", String(err));
    }
    if (once || stopping) break;
    await sleep(config.cycleIntervalSec * 1000);
  } while (!stopping);

  log.info("vibestock 종료");
}

main().catch((err) => {
  log.error("시작 실패", String(err));
  process.exit(1);
});
