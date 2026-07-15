import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRSI, decideSignal } from "../src/strategy/rsi.js";

test("데이터 부족이면 null", () => {
  assert.equal(computeRSI([1, 2, 3], 14), null);
  assert.equal(computeRSI(Array(14).fill(1), 14), null); // period+1 미만
});

test("계속 상승하면 RSI 100", () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  assert.equal(computeRSI(closes, 14), 100);
});

test("계속 하락하면 RSI 0", () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
  assert.equal(computeRSI(closes, 14), 0);
});

test("혼합 시계열은 0~100 사이", () => {
  const closes = [
    44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08,
    45.89, 46.03, 45.61, 46.28, 46.28,
  ];
  const rsi = computeRSI(closes, 14);
  assert.ok(rsi !== null);
  assert.ok(rsi! > 0 && rsi! < 100, `RSI 범위 밖: ${rsi}`);
});

test("decideSignal: 과매도면 BUY", () => {
  assert.equal(decideSignal(25, { buyThreshold: 30, sellThreshold: 70, held: false }), "BUY");
});

test("decideSignal: 과매수 & 보유중이면 SELL", () => {
  assert.equal(decideSignal(75, { buyThreshold: 30, sellThreshold: 70, held: true }), "SELL");
});

test("decideSignal: 과매수여도 미보유면 HOLD", () => {
  assert.equal(decideSignal(75, { buyThreshold: 30, sellThreshold: 70, held: false }), "HOLD");
});

test("decideSignal: 중간값이면 HOLD", () => {
  assert.equal(decideSignal(50, { buyThreshold: 30, sellThreshold: 70, held: true }), "HOLD");
});
