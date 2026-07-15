import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { log } from "../logger.js";
import type { DashboardStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, "public", "index.html");

/** 대시보드 정적 페이지 + /api/state JSON 을 제공하는 경량 서버. */
export function startWebServer(store: DashboardStore, port: number): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";

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

  server.listen(port, () => {
    log.info(`대시보드: http://localhost:${port}`);
  });
  server.on("error", (err) => {
    log.error(`웹 서버 오류 (포트 ${port})`, String(err));
  });
  return server;
}
