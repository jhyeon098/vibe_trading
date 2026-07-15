import type { Config } from "../config.js";
import { log } from "../logger.js";
import { TokenProvider } from "./auth.js";

export interface ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** 계좌 헤더(X-Tossinvest-Account) 포함 여부 */
  withAccount?: boolean;
  /** 재시도 최대 횟수 (기본 3) */
  maxRetries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 인증 헤더 주입, 429/401/5xx 재시도, 에러 파싱을 담당하는 fetch 래퍼.
 */
export class TossClient {
  private readonly tokens: TokenProvider;

  constructor(private readonly config: Config) {
    this.tokens = new TokenProvider(config);
  }

  async get<T>(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...opts, method: "GET" });
  }

  async post<T>(path: string, body: unknown, opts: Omit<RequestOptions, "method"> = {}): Promise<T> {
    return this.request<T>(path, { ...opts, method: "POST", body });
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(path, this.config.baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async request<T>(path: string, opts: RequestOptions): Promise<T> {
    const { method = "GET", query, body, withAccount = false, maxRetries = 3 } = opts;
    const url = this.buildUrl(path, query);

    let attempt = 0;
    // 재시도 루프
    for (;;) {
      attempt++;
      const token = await this.tokens.getToken();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (withAccount) {
        if (!this.config.accountSeq) {
          throw new Error(
            "계좌 헤더가 필요한데 accountSeq 가 없습니다. bot 초기화 시 자동 조회되어야 합니다.",
          );
        }
        headers["X-Tossinvest-Account"] = this.config.accountSeq;
      }
      if (body !== undefined) headers["Content-Type"] = "application/json";

      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        // 네트워크 오류 → 백오프 재시도
        if (attempt <= maxRetries) {
          const wait = backoff(attempt);
          log.warn(`네트워크 오류, ${wait}ms 후 재시도 (${attempt}/${maxRetries})`, String(err));
          await sleep(wait);
          continue;
        }
        throw err;
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }

      // 401 → 토큰 재발급 후 1회 재시도
      if (res.status === 401 && attempt <= maxRetries) {
        log.warn("401 인증 실패, 토큰 재발급 후 재시도");
        this.tokens.invalidate();
        continue;
      }

      // 429 → Retry-After 준수
      if (res.status === 429 && attempt <= maxRetries) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 1;
        log.warn(`429 레이트리밋, ${retryAfter}s 대기 후 재시도`);
        await sleep(retryAfter * 1000);
        continue;
      }

      // 5xx → 백오프 재시도
      if (res.status >= 500 && attempt <= maxRetries) {
        const wait = backoff(attempt);
        log.warn(`HTTP ${res.status}, ${wait}ms 후 재시도 (${attempt}/${maxRetries})`);
        await sleep(wait);
        continue;
      }

      // 그 외(4xx) 또는 재시도 소진 → 에러
      throw await parseError(res);
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

async function parseError(res: Response): Promise<ApiError> {
  let code: string | undefined;
  let requestId: string | undefined;
  let message = `HTTP ${res.status}`;
  try {
    const data = (await res.json()) as {
      error?: { code?: string; message?: string; requestId?: string };
    };
    if (data.error) {
      code = data.error.code;
      requestId = data.error.requestId;
      if (data.error.message) message = data.error.message;
    }
  } catch {
    /* 본문 파싱 실패 시 status 만 */
  }
  const err = new Error(`${message} (HTTP ${res.status}${code ? `, ${code}` : ""})`) as ApiError;
  err.status = res.status;
  err.code = code;
  err.requestId = requestId;
  return err;
}
