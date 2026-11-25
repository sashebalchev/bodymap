import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createApp } from "../src/http.ts";
import { appGrant } from "../src/mcp.ts";
import { BodyMap } from "../src/service.ts";
import { Store } from "../src/store.ts";

export const MCP_TOKEN = "m".repeat(32);
export const UI_TOKEN = "u".repeat(32);
export const GRANT = appGrant(UI_TOKEN);

export type Running = {
  url: string;
  dir: string;
  map: BodyMap;
  /** A fresh MCP client. Pass a token to use another, or "" for none. */
  client: (token?: string) => Promise<Client>;
  /** A fresh MCP client that presents its secret in the URL path (/mcp/<secret>) and sends no header. */
  pathClient: (secret: string) => Promise<Client>;
  api: (path: string, init?: RequestInit & { token?: string }) => Promise<Response>;
  close: () => Promise<void>;
};

export async function startServer(options: { claudeMaxLevel?: number; dir?: string; allowedHosts?: string[] } = {}): Promise<Running> {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "bodymap-test-")));
  const store = await Store.open(dir, () => new Date());
  const map = new BodyMap(store, options.claudeMaxLevel ?? 4);
  const server = createApp({ map, mcpToken: MCP_TOKEN, uiToken: UI_TOKEN, webHtml: () => "<html>web</html>", viewHtml: () => "<html>view " + GRANT + "</html>", allowedHosts: options.allowedHosts });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const clients: Client[] = [];
  return {
    url,
    dir,
    map,
    client: async (token = MCP_TOKEN) => {
      const client = new Client({ name: "test", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(url + "/mcp"), { requestInit: { headers: token ? { authorization: "Bearer " + token } : {} } }));
      clients.push(client);
      return client;
    },
    pathClient: async (secret) => {
      const client = new Client({ name: "test", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(url + "/mcp/" + secret)));
      clients.push(client);
      return client;
    },
    api: (path, init = {}) => fetch(url + path, { ...init, headers: { ...(init.token === undefined ? { authorization: "Bearer " + UI_TOKEN } : init.token ? { authorization: "Bearer " + init.token } : {}), ...(init.headers as Record<string, string> | undefined) } }),
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!options.dir) await rm(dir, { recursive: true, force: true });
    },
  };
}
