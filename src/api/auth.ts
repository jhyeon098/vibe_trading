import type { Config } from "../config.js";
import { log } from "../logger.js";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * OAuth2 Client Credentials 토큰을 발급/캐시하고 만료 전 자동 갱신한다.
 */
export class TokenProvider {
  private token: string | null = null;
  private expiresAt = 0; // epoch ms
  private inflight: Promise<string> | null = null;

  constructor(private readonly config: Config) {}

  /** 유효한 access token 반환 (필요 시 발급/갱신). */
  async getToken(): Promise<string> {
    // 만료 30초 전이면 갱신
    if (this.token && Date.now() < this.expiresAt - 30_000) {
      return this.token;
    }
    // 동시 요청 시 발급 1회로 합침
    if (this.inflight) return this.inflight;
    this.inflight = this.issue().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** 401 등으로 강제 재발급이 필요할 때. */
  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  private async issue(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const res = await fetch(`${this.config.baseUrl}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`토큰 발급 실패 (HTTP ${res.status}): ${text}`);
    }

    const data = (await res.json()) as TokenResponse;
    if (!data.access_token) {
      throw new Error("토큰 응답에 access_token 이 없습니다.");
    }
    this.token = data.access_token;
    this.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    log.info(`토큰 발급됨 (expires_in=${data.expires_in ?? "?"}s)`);
    return this.token;
  }
}
