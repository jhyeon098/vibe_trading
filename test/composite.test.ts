import { test } from "node:test";
import assert from "node:assert/strict";
import { decideComposite, rsiToScore } from "../src/strategy/composite.js";
import type { NewsResult } from "../src/strategy/news.js";

const neutralNews: NewsResult = { score: 0, label: "중립", keywords: [], headlines: [], count: 0, at: "2026-07-18T00:00:00Z" };
function news(score: number): NewsResult {
  return { ...neutralNews, score, label: score > 0 ? "긍정" : score < 0 ? "부정" : "중립" };
}

const base = {
  buyThreshold: 30,
  sellThreshold: 70,
  weightRsi: 0.6,
  weightNews: 0.4,
  weightMa: 0, // 기존 테스트는 이동평균 영향 없음
  maScore: null as number | null,
  buyScore: 0.5,
  sellScore: -0.5,
};

// RSI 0.5 / 뉴스 0.3 / 추세 0.2 (실제 기본값)
const w3 = { weightRsi: 0.5, weightNews: 0.3, weightMa: 0.2 };

test("rsiToScore: 과매도=+1, 중립=0, 과매수=-1", () => {
  assert.equal(rsiToScore(30, 30, 70), 1);
  assert.equal(rsiToScore(50, 30, 70), 0);
  assert.equal(rsiToScore(70, 30, 70), -1);
});

test("과매도 RSI + 중립 뉴스 → BUY", () => {
  const r = decideComposite({ ...base, rsi: 15, news: news(0), held: false });
  assert.equal(r.signal, "BUY");
  assert.ok(r.score >= base.buyScore);
});

test("강한 부정 뉴스가 과매도 RSI 매수를 상쇄 → HOLD", () => {
  const r = decideComposite({ ...base, rsi: 30, news: news(-1), held: false });
  // 0.6*1 + 0.4*(-1) = 0.2 < 0.5
  assert.equal(r.signal, "HOLD");
});

test("과매수 RSI + 부정 뉴스 + 보유중 → SELL", () => {
  const r = decideComposite({ ...base, rsi: 75, news: news(-1), held: true });
  assert.equal(r.signal, "SELL");
});

test("과매수라도 미보유면 SELL 안 함 → HOLD", () => {
  const r = decideComposite({ ...base, rsi: 75, news: news(-1), held: false });
  assert.equal(r.signal, "HOLD");
});

test("뉴스만 있고 RSI 없음 → 뉴스 100% 가중", () => {
  const r = decideComposite({ ...base, rsi: null, news: news(1), held: false });
  assert.equal(r.newsScore, 1);
  assert.equal(r.signal, "BUY");
});

test("RSI·뉴스·추세 모두 없음 → SKIP", () => {
  const r = decideComposite({ ...base, rsi: null, news: null, maScore: null, held: false });
  assert.equal(r.signal, "SKIP");
});

test("역배열(추세 -1)이 과매도 매수를 눌러 HOLD", () => {
  const r = decideComposite({ ...base, ...w3, rsi: 30, news: news(0), maScore: -1, held: false });
  // (1*0.5 + 0*0.3 + -1*0.2) / 1.0 = 0.3 < 0.5
  assert.equal(r.signal, "HOLD");
  assert.equal(r.maScore, -1);
});

test("정배열(추세 +1)이 종합점수를 끌어올려 HOLD→BUY", () => {
  const noTrend = decideComposite({ ...base, ...w3, rsi: 35, news: news(0), maScore: null, held: false });
  assert.equal(noTrend.signal, "HOLD"); // 추세 없으면 0.47 로 부족
  const withTrend = decideComposite({ ...base, ...w3, rsi: 35, news: news(0), maScore: 1, held: false });
  assert.equal(withTrend.signal, "BUY"); // 정배열이 0.575 로 끌어올림
});
