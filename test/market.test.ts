import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TossClient } from "../src/api/client.js";
import { TossApi } from "../src/api/toss.js";
import type { Config } from "../src/config.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function makeApi(calendarBody: unknown): TossApi {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/oauth2/token")) return json({ access_token: "t", token_type: "Bearer", expires_in: 3600 });
    if (url.includes("/market-calendar/KR")) return json(calendarBody);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const cfg = { clientId: "x", clientSecret: "y", baseUrl: "https://ex.com" } as unknown as Config;
  return new TossApi(new TossClient(cfg), cfg);
}

test("휴장일(integrated null)은 false", async () => {
  const api = makeApi({ result: { today: { date: "2026-07-18", integrated: null } } });
  assert.equal(await api.isKrMarketOpen(), false);
});

test("정규장 시간 안이면 true", async () => {
  const api = makeApi({
    result: { today: { integrated: { regularMarket: {
      startTime: "2000-01-01T00:00:00.000+09:00", endTime: "2099-01-01T00:00:00.000+09:00",
    } } } },
  });
  assert.equal(await api.isKrMarketOpen(), true);
});

test("today 자체가 없으면 null(미확인)", async () => {
  const api = makeApi({ result: {} });
  assert.equal(await api.isKrMarketOpen(), null);
});
