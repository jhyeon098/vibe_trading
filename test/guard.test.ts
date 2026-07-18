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
    strategyMode: "composite",
    newsEnabled: true,
    newsLookbackDays: 7,
    newsTtlMin: 15,
    weightRsi: 0.5,
    weightNews: 0.3,
    weightMa: 0.2,
    buyScoreThreshold: 0.5,
    sellScoreThreshold: -0.5,
    highGuardPct: 0.8,
    reboundConfirm: true,
    watchCount: 20,
    cycleIntervalSec: 60,
    orderAmountKrw: 100_000,
    maxOrderKrw: 100_000,
    maxDailyBuyKrw: 500_000,
    maxWeeklyBuyKrw: 200_000,
    maxDailyBuyCount: 1,
    maxPositions: 5,
    webPort: 3000,
    ...overrides,
  };
}

// 최소한의 DailyTracker 스텁 (파일 IO 없이)
class FakeTracker {
  private bought = new Map<string, number>();
  private _total = 0;
  private _week = 0;
  private _count = 0;
  get boughtKrw() {
    return this._total;
  }
  get weeklyBoughtKrw() {
    return this._week;
  }
  get dailyBuyCount() {
    return this._count;
  }
  hasBought(s: string) {
    return this.bought.has(s);
  }
  recordBuy(s: string, a: number) {
    this.bought.set(s, a);
    this._total += a;
    this._week += a;
    this._count += 1;
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
  // 횟수/주간 한도에 먼저 걸리지 않도록 넉넉히 열어 일일 금액 한도만 검증
  const g = guardWith(makeConfig({ maxDailyBuyCount: 10, maxWeeklyBuyKrw: 10_000_000 }), t);
  const r = g.checkBuy({ symbol: "B", amountKrw: 90_000, positionCount: 1, buyingPowerKrw: 1_000_000 });
  assert.equal(r.ok, false);
});

test("하루 매수 횟수 한도(1회) 도달 시 거부", () => {
  const t = new FakeTracker();
  t.recordBuy("A", 50_000); // 오늘 1회 매수
  const g = guardWith(makeConfig(), t); // maxDailyBuyCount 기본 1
  const r = g.checkBuy({ symbol: "B", amountKrw: 50_000, positionCount: 1, buyingPowerKrw: 1_000_000 });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /하루 매수 횟수/);
});

test("주간 한도(20만원) 초과 거부", () => {
  const t = new FakeTracker();
  t.recordBuy("A", 150_000); // 이번 주 누계 15만
  // 횟수 한도에 먼저 걸리지 않도록 열어 주간 금액만 검증
  const g = guardWith(makeConfig({ maxDailyBuyCount: 10 }), t);
  const r = g.checkBuy({ symbol: "B", amountKrw: 90_000, positionCount: 1, buyingPowerKrw: 1_000_000 });
  assert.equal(r.ok, false); // 15만 + 9만 = 24만 > 20만
  assert.match(r.reason ?? "", /주간 매수 한도/);
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
