# vibestock — 토스증권 RSI 자동매매 봇 설계

작성일: 2026-07-15

## 목적
토스증권 Open API를 이용해 국내(KRX) 주식을 RSI 과매수/과매도 전략으로
자동 판단하는 봇. 기본은 **드라이런**(신호와 주문을 로그로만 기록)이며,
실계좌의 **실제 데이터**(시세·보유·가용현금)를 읽는다. 실주문 전송은
`LIVE_TRADING=true` 플래그로만 활성화되고, 끌 수 없는 금액/종목 한도가 항상 적용된다.

## 결정 사항
| 항목 | 값 |
|---|---|
| 스택 | TypeScript / Node.js (18+, 내장 fetch) |
| 시장 | 국내 KRX |
| 감시 종목 | 전체시장 거래대금 상위 20개 (`MARKET_TRADING_AMOUNT`, 매 사이클 갱신) |
| 전략 | RSI(기본 기간 14, 일봉) |
| 매수 신호 | RSI ≤ 30 (과매도) |
| 매도 신호 | RSI ≥ 70 (과매수) & 해당 종목 보유 중 |
| 포지션 사이징 | 신호당 고정 10만원 |
| 실행 모델 | 상시 데몬, 기본 60초 주기, 장중에만 |
| 주문 기본 | 드라이런(로그만). `LIVE_TRADING=true`일 때만 실주문 |

## API (base: https://openapi.tossinvest.com)
- 인증: `POST /oauth2/token` (client_credentials) → Bearer 토큰. 만료 전 자동 갱신.
- 계좌/자산/주문 요청엔 `X-Tossinvest-Account: {accountSeq}` 헤더 필요.
- 사용 엔드포인트:
  - `GET /api/v1/rankings` (type=MARKET_TRADING_AMOUNT, marketCountry=KR, duration=realtime, count=20, excludeInvestmentCaution=true)
  - `GET /api/v1/candles` (symbol, interval=1d, count≥ RSI기간+1)
  - `GET /api/v1/accounts` (계좌번호 자동 조회)
  - `GET /api/v1/holdings`, `GET /api/v1/buying-power`, `GET /api/v1/sellable-quantity`
  - `POST /api/v1/orders` (실주문 시에만)
  - `GET /api/v1/market-calendar/KR` (개장 여부)
- 레이트리밋: AUTH 5/s, ACCOUNT 1/s, ASSET 5/s, MARKET_DATA 10/s, ORDER 6/s(09:00–09:10 3/s).
  응답 헤더 `X-RateLimit-*`, 429 시 `Retry-After` 준수.

## 한 사이클 흐름 (bot.ts)
1. 토큰 확보(캐시/갱신)
2. `market-calendar/KR`로 개장 확인 — 폐장이면 주문 없이 대기
3. `rankings`로 거래대금 상위 20종목 심볼 수집
4. 종목별 `candles`(일봉) 조회
5. 종목별 RSI 계산
6. 신호 판단: RSI≤30 매수 / (RSI≥70 & 보유) 매도
7. 리스크 검사(guard): 일일한도·주문한도·보유종목수·중복보유
8. 실행(executor): 드라이런 로그 또는 실주문
9. 다음 사이클까지 sleep

## 컴포넌트 구조
```
src/
  config.ts        # .env 로드/검증, 한도·RSI·주기 파라미터
  logger.ts        # 콘솔 + 파일(logs/) 로깅
  api/
    auth.ts        # OAuth2 토큰 발급·캐시·자동갱신
    client.ts      # fetch 래퍼: 헤더, 레이트리밋, 재시도, 에러 파싱
    toss.ts        # 엔드포인트 메서드
  strategy/rsi.ts  # RSI 계산 + 신호 판단(순수 함수)
  risk/guard.ts    # 끌 수 없는 한도 검사
  trader/executor.ts # 드라이런/실주문 분기 + 주문 로그
  state.ts         # 당일 매수누계·보유 추적(state/ 파일 저장)
  bot.ts           # 사이클 오케스트레이션
  index.ts         # 데몬 루프 진입점 + 종료 시그널 처리
```

## 안전장치 (risk/guard.ts — 끌 수 없음, 값만 조절)
- 주문당 최대 10만원
- 하루 총 매수 최대 50만원
- 최대 보유 5종목
- 종목당 1회만 신규 매수(중복 방지)
- `LIVE_TRADING`이 정확히 `"true"`가 아니면 무조건 드라이런
- 실주문이라도 한도 초과 시 거부 + 경고 로그

## 에러 처리
- 401 → 토큰 재발급 후 1회 재시도
- 429 → `Retry-After` 대기 후 재시도
- 개별 종목 실패 → 해당 종목만 스킵, 사이클 지속
- 5xx/네트워크 → 지수 백오프 재시도, 지속 실패 시 다음 사이클
- 폐장/휴장 → 주문 없이 대기

## 테스트
- `strategy/rsi.ts`, `risk/guard.ts`: 순수 로직 단위 테스트
- API 계층: mock으로 대체

## 운영 참고
- 실 API는 토스에 **등록된 IP**에서만 200 응답(그 외 403). 실행은 등록 IP 환경에서.
- `.env`의 client secret은 채팅 노출 이력이 있으므로 테스트 후 **재발급 권장**.

## 비고 (YAGNI로 제외)
- 미국 시장, 조건부 주문, 백테스팅 엔진, 웹 대시보드 — 이번 범위 밖.
