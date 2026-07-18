import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFilter } from "../src/strategy/entry.js";

const opts = { highGuardPct: 0.8, requireRebound: true };

test("저점 근처 + 반등 시작 → 통과", () => {
  // 100→90 급락 후 92 로 반등
  const closes = [100, 98, 95, 92, 90, 92];
  const r = entryFilter(closes, opts);
  assert.equal(r.ok, true);
  assert.equal(r.rebounded, true);
  assert.ok(r.bandPct! < 0.8);
});

test("아직 하락 중(반등 미확인) → 차단", () => {
  const closes = [100, 98, 95, 92, 90, 88];
  const r = entryFilter(closes, opts);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /반등 미확인/);
});

test("고점 근처면 반등했어도 차단", () => {
  // 80→100 상승, 현재가 99 = 밴드 95% (고점)
  const closes = [80, 85, 90, 95, 98, 99];
  const r = entryFilter(closes, opts);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /고점 근처/);
});

test("반등 확인 끄면 하락 중이어도 통과", () => {
  const closes = [100, 98, 95, 92, 90, 88];
  const r = entryFilter(closes, { highGuardPct: 0.8, requireRebound: false });
  assert.equal(r.ok, true);
});

test("데이터 부족(1개)이면 판단 불가로 통과", () => {
  const r = entryFilter([100], opts);
  assert.equal(r.ok, true);
  assert.equal(r.bandPct, null);
});
