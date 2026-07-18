import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHeadlines, parseRssTitles } from "../src/strategy/news.js";

test("긍정 헤드라인 다수 → 긍정 라벨, 양수 점수", () => {
  const r = analyzeHeadlines(
    ["삼성전자 실적 급등 신고가 돌파", "삼성전자 수주 확대 호재", "삼성전자 목표가 상향"],
    "삼성전자",
  );
  assert.equal(r.label, "긍정");
  assert.ok(r.score > 0, `score=${r.score}`);
  assert.equal(r.count, 3);
  assert.ok(r.keywords.length > 0);
});

test("부정 헤드라인 다수 → 부정 라벨, 음수 점수", () => {
  const r = analyzeHeadlines(
    ["OO전자 급락 적자 쇼크", "OO전자 소송 리스크 우려", "OO전자 목표가 하향"],
    "OO전자",
  );
  assert.equal(r.label, "부정");
  assert.ok(r.score < 0, `score=${r.score}`);
});

test("반복 등장한 주제어만 키워드로, 1회성 감성어(흑자/적자)는 제외", () => {
  const titles = [
    "삼성SDI 배터리 신규 수주",
    "삼성SDI 배터리 화재 우려",
    "삼성SDI 배터리 공급 확대",
    "삼성SDI 흑자 전환 기대",
    "삼성SDI 적자 축소",
  ];
  const r = analyzeHeadlines(titles, "삼성SDI");
  assert.ok(r.keywords.includes("배터리"), "3개 기사에 반복된 '배터리'는 키워드여야 함");
  assert.ok(
    !r.keywords.includes("흑자") && !r.keywords.includes("적자"),
    "1회씩만 나온 흑자·적자는 키워드에서 제외되어야 함",
  );
  assert.ok(!r.keywords.includes("삼성SDI"), "종목명은 키워드에서 제외");
});

test("기사 없음 → 중립, 점수 0", () => {
  const r = analyzeHeadlines([], "아무종목");
  assert.equal(r.label, "중립");
  assert.equal(r.score, 0);
  assert.equal(r.count, 0);
  assert.deepEqual(r.keywords, []);
});

test("RSS 파싱: CDATA·엔티티 해제, 언론사 접미어 제거", () => {
  const xml =
    "<rss><channel>" +
    "<item><title><![CDATA[삼성전자 급등 &amp; 신고가 - 한국경제]]></title></item>" +
    "<item><title>현대차 약세 - 매일경제</title></item>" +
    "</channel></rss>";
  const titles = parseRssTitles(xml);
  assert.deepEqual(titles, ["삼성전자 급등 & 신고가", "현대차 약세"]);
});
