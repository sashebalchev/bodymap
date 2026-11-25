// One small node:http server, two doors.
//   /mcp/<token>  the agent door. The only path meant to be reachable from the internet. The token A in the path
//                 counts as "Authorization: Bearer A" (Claude's connector sends no header), and the header still works on /mcp.
//   /             the plain web page, and /api/* for it. Bearer token B, typed once into the page. Tailnet only.
// The two tokens are different on purpose: the token Claude's connector holds cannot reach /api,
// and the token of the web page cannot call /mcp.
// A failed agent-door check answers exactly like an unknown path (404, same body): no 401, no hint that a door is here.
// Neither the token nor the request path of the agent door is ever logged or sent into the MCP SDK.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcp, appGrant, type McpDeps } from "./mcp.ts";
import { EditSchema } from "./schemas.ts";
import { renderComposite } from "./render.ts";
import type { BodyMap } from "./service.ts";
import * as z from "zod/v4";

export type AppConfig = { map: BodyMap; mcpToken: string; uiToken: string; webHtml: () => string; viewHtml: () => string; webUrl?: string; allowedHosts?: string[] };

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
const notFound = (res: ServerResponse) => json(res, 404, { error: "not found" });
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** Host and Origin must name a host we expect. A missing Origin passes: only browsers send one. */
function hostAllowed(req: IncomingMessage, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const hostname = (value: string): string | null => { try { return new URL(value).hostname; } catch { return null; } };
  const ok = (name: string | null) => name !== null && (allowed.includes(name) || LOOPBACK.includes(name));
  if (!ok(hostname("http://" + (req.headers.host ?? "")))) return false;
  const origin = req.headers.origin;
  return origin === undefined || ok(hostname(origin));
}
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
  const allowedHosts = config.allowedHosts ?? [];
  const mcpDeps: McpDeps = { map, grant: appGrant(config.uiToken), viewHtml: config.viewHtml, webUrl: config.webUrl };
  const mcp = toNodeHandler(createMcp(mcpDeps));

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!hostAllowed(req, allowedHosts)) return notFound(res);
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;

    if (path === "/healthz" && req.method === "GET") return json(res, 200, { ok: true });

    if (path === "/mcp" || path.startsWith("/mcp/")) {
      // The path token wins when there is one: a wrong path token is not rescued by a right header.
      const presented = path === "/mcp" ? bearer(req) : path.slice("/mcp/".length);
      if (!same(presented, config.mcpToken)) return notFound(res);
      if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return json(res, 413, { error: "body too large" });
      req.url = "/mcp"; // the token leaves the request here, so nothing downstream can log or echo it
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
    notFound(res);
  };

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status = (error as { status?: number }).status ?? 500;
      if (!res.headersSent) json(res, status, { error: status === 500 ? "internal error" : (error as Error).message });
      else res.end();
      // Only the error's class: a message could carry a request path, and the agent door's path holds the token.
      if (status === 500) console.error("request failed:", (error as Error).name);
    });
  });
}
