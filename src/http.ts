// One small node:http server, two doors.
//   /mcp   the agent door. Bearer token A. The only path meant to be reachable from the internet.
//   /      the plain web page, and /api/* for it. Bearer token B, typed once into the page. Tailnet only.
// The two tokens are different on purpose: the token Claude's connector holds cannot reach /api,
// and the token of the web page cannot call /mcp.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcp, appGrant, type McpDeps } from "./mcp.ts";
import { EditSchema } from "./schemas.ts";
import { renderComposite } from "./render.ts";
import type { BodyMap } from "./service.ts";
import * as z from "zod/v4";

export type AppConfig = { map: BodyMap; mcpToken: string; uiToken: string; webHtml: () => string; viewHtml: () => string; webUrl?: string };

const MAX_BODY = 1_000_000;
const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function send(res: ServerResponse, status: number, body: string | Uint8Array, type: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...extra });
  res.end(body);
}
const json = (res: ServerResponse, status: number, value: unknown) => send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("body is not JSON"), { status: 400 });
  }
}

const EditRequest = z.object({ base: z.int().min(0), edit: EditSchema });

export function createApp(config: AppConfig): Server {
  const { map } = config;
  const mcpDeps: McpDeps = { map, grant: appGrant(config.uiToken), viewHtml: config.viewHtml, webUrl: config.webUrl };
  const mcp = toNodeHandler(createMcp(mcpDeps));

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;

    if (path === "/mcp/health" && req.method === "GET") return json(res, 200, { ok: true });

    if (path === "/mcp") {
      if (!same(bearer(req), config.mcpToken)) return send(res, 401, JSON.stringify({ error: "unauthorized" }), "application/json", { "www-authenticate": "Bearer" });
      if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return json(res, 413, { error: "body too large" });
      return void (await mcp(req, res));
    }

    if (path === "/" && req.method === "GET") return send(res, 200, config.webHtml(), "text/html; charset=utf-8", { "content-security-policy": PAGE_CSP });

    if (path.startsWith("/api/")) {
      if (!same(bearer(req), config.uiToken)) return json(res, 401, { error: "unauthorized" });
      if (path === "/api/state" && req.method === "GET") return json(res, 200, { state: map.state, claudeMaxLevel: map.claudeMaxLevel });
      if (path === "/api/composite.png" && req.method === "GET") return send(res, 200, (await renderComposite(map.state)).png, "image/png");
      if (path === "/api/edit" && req.method === "POST") {
        const parsed = EditRequest.safeParse(await readJson(req));
        if (!parsed.success) return json(res, 400, { error: "invalid", message: parsed.error.issues[0]?.path.join(".") + ": " + parsed.error.issues[0]?.message });
        const reply = await map.edit(parsed.data.base, parsed.data.edit);
        return json(res, reply.ok ? 200 : reply.error === "conflict" ? 409 : reply.error === "not_found" ? 404 : 422, reply);
      }
    }
    json(res, 404, { error: "not found" });
  };

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status = (error as { status?: number }).status ?? 500;
      if (!res.headersSent) json(res, status, { error: status === 500 ? "internal error" : (error as Error).message });
      else res.end();
      if (status === 500) console.error("request failed:", (error as Error).message);
    });
  });
}
