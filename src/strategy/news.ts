import { log } from "../logger.js";

/** 한 종목의 뉴스 분석 결과. */
export interface NewsResult {
  /** 감성 점수 -1(부정) ~ +1(긍정). 근거 없으면 0. */
  score: number;
  label: "긍정" | "부정" | "중립";
  /** 감성/빈도 상위 키워드 (대시보드 표시용). */
  keywords: string[];
  /** 샘플 헤드라인 (최대 3개). */
  headlines: string[];
  /** 수집된 기사 수. */
  count: number;
  /** 수집 시각 ISO. */
  at: string;
}

/** 재무/시황 긍정 어휘. */
const POSITIVE = [
  "급등", "상승", "강세", "신고가", "호재", "흑자", "수주", "계약", "사상최대", "최대실적",
  "돌파", "회복", "반등", "개선", "성장", "확대", "배당", "자사주", "상향", "호실적",
  "흥행", "수혜", "기대", "순항", "훈풍", "매수", "목표가상향", "역대급", "껑충", "급증",
];

/** 재무/시황 부정 어휘. */
const NEGATIVE = [
  "급락", "하락", "약세", "신저가", "악재", "적자", "손실", "감소", "축소", "부진",
  "우려", "리콜", "소송", "횡령", "배임", "하향", "목표가하향", "매도", "폭락", "감산",
  "파산", "디폴트", "규제", "제재", "부도", "쇼크", "위기", "조사", "압수수색", "하한가",
];

/** 키워드 빈도에서 제외할 흔한 토큰. */
const STOPWORDS = new Set([
  "주가", "증권", "종목", "코스피", "코스닥", "시장", "투자", "오늘", "관련", "기업",
  "전망", "분석", "속보", "단독", "종합", "뉴스", "기자", "그룹", "대표", "회장",
  "마감", "개장", "거래", "국내", "글로벌", "지난", "올해", "작년", "최근", "대비",
  "이유", "상황", "발표", "예상", "가능", "이번", "위해", "따라", "통해",
]);

/**
 * 구글 뉴스 RSS 를 종목별로 조회하고 TTL 캐시한다.
 * 실패(네트워크/차단)는 중립(score 0)으로 흡수해 봇 사이클을 막지 않는다.
 */
export class NewsProvider {
  private cache = new Map<string, NewsResult>();

  constructor(
    private readonly opts: { lookbackDays: number; ttlMin: number },
  ) {}

  /** 캐시 우선 조회. key 는 심볼, query 는 검색어(보통 종목명). */
  async get(key: string, query: string): Promise<NewsResult> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now - Date.parse(cached.at) < this.opts.ttlMin * 60_000) {
      return cached;
    }
    let result: NewsResult;
    try {
      const titles = await this.fetchTitles(query);
      result = analyzeHeadlines(titles, query);
    } catch (err) {
      log.warn(`뉴스 조회 실패(${query}) — 중립 처리`, String(err));
      result = { score: 0, label: "중립", keywords: [], headlines: [], count: 0, at: new Date().toISOString() };
    }
    this.cache.set(key, result);
    return result;
  }

  private async fetchTitles(query: string): Promise<string[]> {
    const q = encodeURIComponent(`${query} when:${this.opts.lookbackDays}d`);
    const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (vibestock news bot)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseRssTitles(xml);
  }
}

/** RSS 문자열에서 <item> 의 제목만 추출한다. */
export function parseRssTitles(xml: string): string[] {
  const titles: string[] = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/g) ?? [];
  for (const item of items) {
    const m = item.match(/<title>([\s\S]*?)<\/title>/);
    if (!m) continue;
    // 구글 뉴스 제목은 "제목 - 언론사" 형식 → 뒤 언론사 제거
    const raw = decodeEntities(stripCdata(m[1]!)).trim();
    const title = raw.replace(/\s+-\s+[^-]+$/, "").trim();
    if (title) titles.push(title);
  }
  return titles;
}

/** 헤드라인 목록으로 감성 점수·키워드를 계산한다 (순수함수, 테스트 용이). */
export function analyzeHeadlines(titles: string[], query: string): NewsResult {
  const at = new Date().toISOString();
  if (titles.length === 0) {
    return { score: 0, label: "중립", keywords: [], headlines: [], count: 0, at };
  }

  let pos = 0;
  let neg = 0;
  // 문서빈도(df): 각 토큰이 '몇 개의 서로 다른 헤드라인'에 등장했는지 (기사당 1회만 카운트)
  const df = new Map<string, number>();
  const qnorm = query.replace(/\s+/g, "").toLowerCase();

  for (const t of titles) {
    for (const w of POSITIVE) if (t.includes(w)) pos++;
    for (const w of NEGATIVE) if (t.includes(w)) neg++;

    const seen = new Set<string>();
    for (const tok of tokenize(t)) {
      if (tok.length < 2 || STOPWORDS.has(tok)) continue;
      if (/^\d+$/.test(tok)) continue; // 순수 숫자 제외
      const low = tok.toLowerCase();
      if (qnorm.includes(low)) continue; // 종목명(및 그 일부) 제외
      if (seen.has(tok)) continue; // 한 헤드라인 내 중복은 1회만
      seen.add(tok);
      df.set(tok, (df.get(tok) ?? 0) + 1);
    }
  }

  const total = pos + neg;
  const score = total === 0 ? 0 : (pos - neg) / total;
  const label = score > 0.15 ? "긍정" : score < -0.15 ? "부정" : "중립";

  // 키워드 = 여러 헤드라인에 반복 등장한 주제어. df 내림차순, 동률은 긴 단어·사전순.
  const ranked = [...df.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]),
  );
  // 2개 이상 기사에 나온 토큰만 '키워드'로 인정. 없으면(기사 희소) 상위로 폴백.
  const recurring = ranked.filter(([, c]) => c >= 2);
  const keywords = (recurring.length ? recurring : ranked).slice(0, 5).map(([k]) => k);

  return { score, label, keywords, headlines: titles.slice(0, 3), count: titles.length, at };
}

/** 한글/영문/숫자 토큰만 남기고 분리. */
function tokenize(s: string): string[] {
  return s
    .replace(/[^가-힣a-zA-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function stripCdata(s: string): string {
  const m = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return m ? m[1]! : s;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}
