import { test } from "node:test";
import assert from "node:assert/strict";
import { sma, trendScore } from "../src/strategy/ma.js";

test("최근 period 개의 평균을 계산", () => {
  const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(sma(closes, 5), (6 + 7 + 8 + 9 + 10) / 5); // = 8
  assert.equal(sma(closes, 10), 5.5);
});

test("데이터가 period 미만이면 null", () => {
  assert.equal(sma([1, 2, 3], 5), null);
});

test("MA20/MA60: 60개면 둘 다 계산, 59개면 MA60 null", () => {
  const c60 = Array.from({ length: 60 }, (_, i) => i + 1); // 1..60
  assert.equal(sma(c60, 20), (41 + 60) / 2); // 최근 20개(41..60) 평균 = 50.5
  assert.equal(sma(c60, 60), 30.5);
  assert.equal(sma(c60.slice(1), 60), null); // 59개 → MA60 불가
});

test("trendScore: 이평 위=양수, 아래=음수, 데이터 없으면 null", () => {
  assert.ok(trendScore(110, 100, 100)! > 0); // 이평 위 = 정배열 우호
  assert.ok(trendScore(90, 100, 100)! < 0); // 이평 아래 = 역배열
  assert.equal(trendScore(100, 100, 100), 0); // 이평과 동일 = 중립
  assert.equal(trendScore(null, 100, 100), null);
  assert.equal(trendScore(100, null, 100), null);
});

test("trendScore: ±10% 이상 벌어지면 포화(±1)", () => {
  assert.equal(trendScore(200, 100, 100), 1); // 훨씬 위 → +1
  assert.equal(trendScore(1, 100, 100), -1); // 훨씬 아래 → -1
});
