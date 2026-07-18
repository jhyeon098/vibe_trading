import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * fetch 를 목킹해 전체 사이클을 드라이런으로 돌린다.
 * 핵심 검증: 드라이런에서는 POST /api/v1/orders 가 절대 호출되지 않는다.
 */
test("드라이런 사이클: 매수신호가 나도 실주문은 전송되지 않는다", async () => {
  // 로그/상태 파일이 프로젝트를 더럽히지 않도록 임시 디렉토리에서 실행
  const cwd = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), "vibestock-")));

  // 강한 하락 추세(과매도) 후 마지막에 반등 → 반등확인 필터를 통과하는 BUY 유도
  const descendingCloses = Array.from({ length: 19 }, (_, i) => ({ close: 200 - i, timestamp: i }));
  descendingCloses.push({ close: 185, timestamp: 19 }); // 직전 종가(182)보다 상승 = 반등 확인

  let ordersPosted = 0;
  let priceFetched = false;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    if (url.includes("/oauth2/token"))
      return json({ access_token: "tok", token_type: "Bearer", expires_in: 3600 });
    if (url.includes("/api/v1/accounts")) return json({ accounts: [{ accountSeq: "999" }] });
    if (url.includes("/api/v1/market-calendar/KR"))
      return json({
        today: { integrated: { regularMarket: { startTime: "2000-01-01T00:00:00.000+09:00", endTime: "2099-01-01T00:00:00.000+09:00" } } },
      });
    if (url.includes("/api/v1/rankings")) return json({ rankings: [{ symbol: "005930" }] });
    if (url.includes("/api/v1/holdings")) return json({ holdings: [] });
    if (url.includes("/api/v1/buying-power")) return json({ buyingPower: 10_000_000 });
    if (url.includes("/api/v1/candles")) return json({ candles: descendingCloses });
    if (url.includes("/api/v1/prices")) {
      priceFetched = true;
      return json({ prices: [{ symbol: "005930", price: 1000 }] });
    }
    if (url.includes("/api/v1/orders") && method === "POST") {
      ordersPosted++;
      return json({ orderId: "should-not-happen" });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    process.env.TOSS_CLIENT_ID = "id";
    process.env.TOSS_CLIENT_SECRET = "secret";
    process.env.LIVE_TRADING = "false";
    process.env.TOSS_ACCOUNT_SEQ = "";

    const { loadConfig } = await import("../src/config.js");
    const { Bot } = await import("../src/bot.js");

    const bot = new Bot(loadConfig());
    await bot.runCycle();

    assert.equal(ordersPosted, 0, "드라이런인데 실주문이 전송됨!");
    assert.equal(priceFetched, true, "매수 신호 처리에서 현재가를 조회했어야 함");
  } finally {
    globalThis.fetch = realFetch;
    process.chdir(cwd);
  }
});
