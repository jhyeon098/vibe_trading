import { test } from "node:test";
import assert from "node:assert/strict";
import { RiskGuard } from "../src/risk/guard.js";
import type { Config } from "../src/config.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    clientId: "x",
    clientSecret: "y",
    accountSeq: "1",
    baseUrl: "https://example.com",
    liveTrading: false,
    rsiPeriod: 14,
    rsiBuyThreshold: 30,
    rsiSellThreshold: 70,
    watchCount: 20,
    cycleIntervalSec: 60,
    orderAmountKrw: 100_000,
    maxOrderKrw: 100_000,
    maxDailyBuyKrw: 500_000,
    maxPositions: 5,
    webPort: 3000,
    ...overrides,
  };
}

// 최소한의 DailyTracker 스텁 (파일 IO 없이)
class FakeTracker {
  private bought = new Map<string, number>();
  private _total = 0;
  get boughtKrw() {
    return this._total;
  }
  hasBought(s: string) {
    return this.bought.has(s);
  }
  recordBuy(s: string, a: number) {
    this.bought.set(s, a);
    this._total += a;
  }
}

function guardWith(config: Config, tracker: FakeTracker) {
  // RiskGuard 는 DailyTracker 의 일부 메서드만 사용하므로 구조적 타이핑으로 주입
  return new RiskGuard(config, tracker as unknown as import("../src/state.js").DailyTracker);
}

test("정상 매수는 허용", () => {
  const g = guardWith(makeConfig(), new FakeTracker());
  const r = g.checkBuy({ symbol: "A", amountKrw: 90_000, positionCount: 0, buyingPowerKrw: 1_000_000 });
  assert.equal(r.ok, true);
});

test("주문당 한도 초과 거부", () => {
  const g = guardWith(makeConfig({ maxOrderKrw: 50_000 }), new FakeTracker());
  const r = g.checkBuy({ symbol: "A", amountKrw: 90_000, positionCount: 0, buyingPowerKrw: 1_000_000 });
  assert.equal(r.ok, false);
});

test("중복 매수 거부", () => {
  const t = new FakeTracker();
  t.recordBuy("A", 90_000);
  const g = guardWith(makeConfig(), t);
  const r = g.checkBuy({ symbol: "A", amountKrw: 90_000, positionCount: 1, buyingPowerKrw: 1_000_000 });
  assert.equal(r.ok, false);
});

test("일일 한도 초과 거부", () => {
  const t = new FakeTracker();
  t.recordBuy("A", 450_000);
  const g = guardWith(makeConfig(), t);
  const r = g.checkBuy({ symbol: "B", amountKrw: 90_000, positionCount: 1, buyingPowerKrw: 1_000_000 });
  assert.equal(r.ok, false);
});

test("최대 보유 종목 수 도달 시 거부", () => {
  const g = guardWith(makeConfig({ maxPositions: 3 }), new FakeTracker());
  const r = g.checkBuy({ symbol: "A", amountKrw: 90_000, positionCount: 3, buyingPowerKrw: 1_000_000 });
  assert.equal(r.ok, false);
});

test("가용 현금 부족 시 거부", () => {
  const g = guardWith(makeConfig(), new FakeTracker());
  const r = g.checkBuy({ symbol: "A", amountKrw: 90_000, positionCount: 0, buyingPowerKrw: 50_000 });
  assert.equal(r.ok, false);
});

test("가용 현금 확인 불가(null)면 통과", () => {
  const g = guardWith(makeConfig(), new FakeTracker());
  const r = g.checkBuy({ symbol: "A", amountKrw: 90_000, positionCount: 0, buyingPowerKrw: null });
  assert.equal(r.ok, true);
});
