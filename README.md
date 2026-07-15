# vibestock

토스증권 Open API 기반 **RSI 자동매매 봇** (국내 KRX).

- 거래대금 상위 종목을 매 사이클 자동 선정 → 종목별 **RSI(14, 일봉)** 계산
- **RSI ≤ 30 매수 / RSI ≥ 70 & 보유중 매도**
- 기본은 **드라이런**: 실계좌 데이터는 진짜로 읽지만 **주문은 로그로만** 기록
- 실주문은 `LIVE_TRADING=true` 일 때만. 끌 수 없는 금액/종목 안전 한도 항상 적용

> ⚠️ 이 봇은 실제 자금이 오갈 수 있습니다. LIVE 모드 전환 전 반드시 드라이런 로그로 동작을 충분히 확인하세요.

## 설치

```bash
npm install
cp .env.example .env   # 값을 채워 넣으세요
```

`.env`:

```
TOSS_CLIENT_ID=발급받은_client_id
TOSS_CLIENT_SECRET=발급받은_client_secret
TOSS_ACCOUNT_SEQ=        # 비우면 /accounts 로 자동 조회
LIVE_TRADING=false       # 정확히 "true" 일 때만 실주문
```

credentials는 토스증권 WTS > 설정 > Open API 에서 발급하고, **실행할 서버/PC의 IP를 반드시 등록**하세요 (미등록 IP는 403).

## 실행

```bash
npm start        # 상시 데몬 (기본 60초 주기)
npm run once     # 1회만 실행하고 종료 (cron 용)
npm test         # 단위 + 드라이런 스모크 테스트
npm run typecheck
```

로그는 `logs/bot.log`, 주문 이벤트는 `logs/orders.log` 에 별도 기록됩니다.

## 웹 대시보드

`npm start` 로 데몬을 띄우면 웹 대시보드가 함께 열립니다:

```
http://localhost:3000
```

브라우저에서 3초마다 자동 갱신되며 다음을 보여줍니다:

- 현재 모드(DRY-RUN/LIVE) · 개장 상태 · 사이클 횟수/시각
- 당일 매수 누계와 일일 한도 진행 바, 가용 현금, 보유 종목 수
- 감시 종목별 **RSI 미터**(30/70 눈금 표시, 낮은 순 정렬) · 신호 · 현재가
- 최근 주문 이벤트(드라이런 기록/전송/거부/실패)

포트는 `.env` 의 `WEB_PORT` 로 변경할 수 있습니다. (`npm run once` 단발 실행 시엔 서버를 띄우지 않습니다.)

## 설정 (환경변수, 선택)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `RSI_PERIOD` | 14 | RSI 기간 |
| `RSI_BUY_THRESHOLD` | 30 | 이하이면 매수 |
| `RSI_SELL_THRESHOLD` | 70 | 이상 & 보유중이면 매도 |
| `WATCH_COUNT` | 20 | 감시 상위 종목 수 (최대 100) |
| `CYCLE_INTERVAL_SEC` | 60 | 사이클 주기(초) |
| `ORDER_AMOUNT_KRW` | 100000 | 매수 신호당 금액(원) |
| `MAX_ORDER_KRW` | 100000 | 주문당 최대 금액 |
| `MAX_DAILY_BUY_KRW` | 500000 | 하루 총 매수 최대 금액 |
| `MAX_POSITIONS` | 5 | 최대 보유 종목 수 |

## 안전장치 (`src/risk/guard.ts` — 우회 불가, 값만 조절)

- 주문당 최대 금액, 하루 총 매수 한도, 최대 보유 종목 수
- 종목당 1회만 신규 매수(당일 중복 방지)
- `LIVE_TRADING` 이 정확히 `"true"` 가 아니면 무조건 드라이런
- 실주문이라도 한도 초과 주문은 거부 + 경고 로그

## 구조

```
src/
  config.ts          설정 로드/검증
  logger.ts          콘솔 + 파일 로깅
  api/auth.ts        OAuth2 토큰 발급·갱신
  api/client.ts      fetch 래퍼(재시도·레이트리밋·에러)
  api/toss.ts        엔드포인트 메서드(방어적 파싱)
  strategy/rsi.ts    RSI 계산 + 신호 판단(순수함수)
  risk/guard.ts      안전 한도 검사
  trader/executor.ts 드라이런/실주문 분기
  state.ts           당일 매수누계·중복 추적
  bot.ts             사이클 오케스트레이션
  index.ts           데몬 진입점
```

## 주의: 응답 필드 매핑

공식 문서가 일부 응답 필드명을 확정하지 않아, `src/api/toss.ts` 는 여러 후보 키를
방어적으로 확인합니다. 실제 응답과 어긋나면 (예: 랭킹의 종목코드 키) 그 파일의
`pick(...)` 후보 목록만 수정하면 됩니다. 첫 실 실행 시 `logs/bot.log` 로 파싱 결과를
확인하세요.

## 면책

투자 손실 책임은 전적으로 사용자에게 있습니다. 이 소프트웨어는 어떠한 보증도 제공하지 않습니다.
