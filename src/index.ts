import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { Bot } from "./bot.js";
import { DashboardStore } from "./web/store.js";
import { startWebServer } from "./web/server.js";

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

  const store = new DashboardStore({
    mode: config.liveTrading ? "LIVE" : "DRY-RUN",
    startedAt: new Date().toISOString(),
    config: {
      rsiPeriod: config.rsiPeriod,
      buyThreshold: config.rsiBuyThreshold,
      sellThreshold: config.rsiSellThreshold,
      orderAmountKrw: config.orderAmountKrw,
      maxOrderKrw: config.maxOrderKrw,
      maxDailyBuyKrw: config.maxDailyBuyKrw,
      maxPositions: config.maxPositions,
      watchCount: config.watchCount,
    },
  });

  const bot = new Bot(config, store);

  // 웹 대시보드 (단발 실행에서는 띄우지 않음)
  const server = once ? null : startWebServer(store, config.webPort);

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
      store.setError(null);
    } catch (err) {
      const msg = String(err);
      log.error("사이클 실행 중 치명적 오류", msg);
      store.setError(
        msg.includes("IP address not allowed")
          ? "토스에 등록되지 않은 IP입니다. 토스증권 > 설정 > Open API > IP 관리에서 현재 IP를 등록하세요."
          : msg,
      );
    }
    if (once || stopping) break;
    await sleep(config.cycleIntervalSec * 1000);
  } while (!stopping);

  server?.close();
  log.info("vibestock 종료");
}

main().catch((err) => {
  log.error("시작 실패", String(err));
  process.exit(1);
});
