# VPS 배포 가이드 (24시간 실행 + 폰에서 대시보드 확인)

이 봇은 **상시 실행 데몬 + 대시보드 서버**이고, 토스 Open API 는 **등록된 고정 IP**에서만
호출을 허용합니다. 따라서 **고정 IP가 있는 VPS 한 대**에 봇과 대시보드를 통째로 올리고,
그 IP 를 토스에 등록하는 것이 정석입니다. (Vercel 등 서버리스는 IP가 매번 바뀌어 불가.)

> PC 를 꺼도 매매가 계속되고, 폰에서 언제든 대시보드를 볼 수 있습니다.

---

## 1. VPS 준비

- **고정(Static) IP** 를 주는 소형 인스턴스면 충분합니다. (예: AWS Lightsail, Vultr, DigitalOcean,
  Oracle Cloud Free Tier, 네이버/카카오 클라우드 등 — 대부분 고정 IP 제공/부여 가능. 월 $4~6 수준)
- OS: Ubuntu 22.04+ 권장. Node.js **18.17 이상** 설치.

```bash
# Node 설치 예 (Ubuntu, nodesource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v20.x 확인
```

## 2. 토스에 이 VPS 의 고정 IP 등록 ★필수★

토스증권 WTS → 설정 → Open API → 허용 IP 에 **VPS 의 공인 IP** 를 추가.
(안 하면 `403 IP address not allowed` 로 매매가 전혀 안 됩니다.)

```bash
curl -s https://api.ipify.org   # 이 VPS 의 공인 IP 확인 → 토스에 등록
```

## 3. 코드 배포

```bash
sudo useradd -m vibestock          # 전용 사용자(선택)
sudo su - vibestock
git clone https://github.com/jhyeon098/vibe_trading.git vibestock
cd vibestock
npm install
```

## 4. `.env` 작성 (서버에서 직접, 커밋 금지)

`.env.example` 를 복사해 값을 채웁니다. **비밀키는 절대 git 에 올리지 마세요**(이미 .gitignore 처리됨).

```bash
cp .env.example .env
nano .env
```

최소 설정:

```
TOSS_CLIENT_ID=발급받은_id
TOSS_CLIENT_SECRET=발급받은_secret
LIVE_TRADING=false            # 실매매는 드라이런 충분히 확인 후에만 true

# 대시보드 공개 보호 (★꼭 설정 — 안 하면 잔고/포지션이 그대로 노출)
DASHBOARD_USER=원하는아이디
DASHBOARD_PASS=충분히_긴_비밀번호

# HTTPS 리버스 프록시(Caddy)를 쓸 경우 봇은 로컬만 리스닝:
# WEB_HOST=127.0.0.1
```

동작 확인:

```bash
npm test           # 45개 통과 확인
npm run once       # 1 사이클만 돌려 토큰 발급/파싱 확인 (403 안 나면 IP 등록 OK)
```

## 5. 상시 실행 (systemd)

`deploy/vibestock.service` 의 `User`/`WorkingDirectory`/`ExecStart` 경로를 환경에 맞게 수정 후:

```bash
which npx                                   # ExecStart 의 npx 경로 확인/수정
sudo cp deploy/vibestock.service /etc/systemd/system/vibestock.service
sudo systemctl daemon-reload
sudo systemctl enable --now vibestock       # 부팅 시 자동 시작 + 지금 시작
sudo systemctl status vibestock             # 상태 확인
journalctl -u vibestock -f                  # 실시간 로그
```

> pm2 를 선호하면: `npm i -g pm2 && pm2 start "npx tsx src/index.ts" --name vibestock && pm2 save && pm2 startup`

## 6. 폰에서 접속

### (가장 간단) IP + 포트로 접속 — 임시/테스트용
방화벽에서 3000 포트를 열고 `http://<VPS_IP>:3000` 접속. 대시보드 basic auth 로 보호됩니다.
단, **HTTP 라 비밀번호가 평문 전송**되니 임시로만 쓰세요.

```bash
sudo ufw allow 3000/tcp    # ufw 사용 시
```

### (권장) 도메인 + 자동 HTTPS (Caddy)
1. 무료/유료 도메인의 A 레코드를 VPS IP 로 지정 (무료: DuckDNS 등)
2. `.env` 에 `WEB_HOST=127.0.0.1` (봇은 로컬만 리스닝, 외부는 Caddy만 노출)
3. `deploy/Caddyfile` 의 `your-domain.example.com` 을 실제 도메인으로 교체
4. Caddy 설치 후 실행:

```bash
sudo apt install -y caddy          # 또는 https://caddyserver.com/docs/install
sudo caddy run --config ./deploy/Caddyfile      # 테스트
# 상시화: /etc/caddy/Caddyfile 로 복사 후 sudo systemctl enable --now caddy
```

→ 폰에서 `https://your-domain...` 접속. 자물쇠(HTTPS) + basic auth 로 보호.

---

## 보안 체크리스트

- [ ] `.env` 는 서버에만 존재하고 git 에 없음 (`git status` 로 확인)
- [ ] `DASHBOARD_USER`/`DASHBOARD_PASS` 설정됨
- [ ] 가능하면 HTTPS(Caddy) 사용, 아니면 최소한 basic auth + 신뢰 네트워크
- [ ] `LIVE_TRADING` 은 드라이런으로 충분히 검증하기 전엔 `false`
- [ ] 방화벽: 필요한 포트(22, 80/443 또는 3000)만 개방
- [ ] 채팅으로 공유된 적 있는 토스 secret 은 배포 전 **재발급** 권장

## 업데이트

```bash
cd ~/vibestock && git pull && npm install && sudo systemctl restart vibestock
```
