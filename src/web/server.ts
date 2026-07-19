import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { log } from "../logger.js";
import type { DashboardStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, "public", "index.html");

export interface WebOptions {
  port: number;
  host: string;
  /** 둘 다 비어있지 않으면 basic auth 요구. */
  user: string;
  pass: string;
}

/** 상수시간 문자열 비교(타이밍 공격 방지). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 대시보드 정적 페이지 + /api/state JSON 을 제공하는 경량 서버(옵션 basic auth). */
export function startWebServer(store: DashboardStore, opts: WebOptions): Server {
  const authRequired = opts.user !== "" && opts.pass !== "";

  const authorized = (header: string | undefined): boolean => {
    if (!authRequired) return true;
    if (!header || !header.startsWith("Basic ")) return false;
    let decoded: string;
    try {
      decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    } catch {
      return false;
    }
    const i = decoded.indexOf(":");
    if (i < 0) return false;
    const u = decoded.slice(0, i);
    const p = decoded.slice(i + 1);
    // 사용자·비번을 각각 비교하되 둘 다 항상 평가(단락 방지)
    const okUser = safeEqual(u, opts.user);
    const okPass = safeEqual(p, opts.pass);
    return okUser && okPass;
  };

  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (!authorized(req.headers.authorization)) {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="vibestock", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("인증이 필요합니다.");
      return;
    }

    if (url === "/api/state") {
      const body = JSON.stringify(store.getSnapshot());
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    if (url === "/" || url === "/index.html") {
      try {
        const html = readFileSync(HTML_PATH);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("dashboard html not found");
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  server.listen(opts.port, opts.host, () => {
    const where = opts.host === "0.0.0.0" ? `포트 ${opts.port} (외부 노출)` : `${opts.host}:${opts.port}`;
    log.info(`대시보드: http://localhost:${opts.port}  [${where}${authRequired ? ", 인증 ON" : ", 인증 OFF"}]`);
  });
  server.on("error", (err) => {
    log.error(`웹 서버 오류 (포트 ${opts.port})`, String(err));
  });
  return server;
}
