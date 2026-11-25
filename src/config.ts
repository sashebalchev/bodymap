// Environment in, a checked config out. Secrets come from a variable or from a file, never from argv.
import { readFileSync } from "node:fs";

export type Config = {
  dataDir: string;
  host: string;
  port: number;
  mcpToken: string;
  uiToken: string;
  claudeMaxLevel: number;
  webUrl: string | undefined;
  distDir: string;
  /** Host names the Host and Origin headers may carry. Empty means no host check. Loopback names are always allowed. */
  allowedHosts: string[];
};

type Env = Record<string, string | undefined>;

// The MCP token is also a path segment (/mcp/<token>), so it may hold only characters that need no escaping.
const URL_SAFE = /^[A-Za-z0-9._~-]+$/;
const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "::", "[::]", "*"]);

function secret(env: Env, name: string): string {
  const file = env[name + "_FILE"];
  const raw = file ? readFileSync(file, "utf8") : env[name];
  const value = raw?.trim();
  if (!value) throw new Error("Set " + name + " or " + name + "_FILE.");
  if (value.length < 24) throw new Error(name + " must be at least 24 characters. Make one with: openssl rand -base64 32 | tr '+/' '-_' | tr -d '='");
  return value;
}

function hostList(raw: string | undefined): string[] {
  const names = (raw ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const name of names) if (!/^[a-z0-9.-]+$/.test(name)) throw new Error("BODYMAP_ALLOWED_HOSTS takes host names only, comma separated, no port, scheme or path.");
  return names;
}

export function readConfig(env: Env, distDefault: string): Config {
  const dataDir = env.BODYMAP_DATA_DIR;
  if (!dataDir) throw new Error("Set BODYMAP_DATA_DIR to the folder that holds body-map.json.");
  const mcpToken = secret(env, "BODYMAP_MCP_TOKEN");
  const uiToken = secret(env, "BODYMAP_UI_TOKEN");
  if (!URL_SAFE.test(mcpToken)) throw new Error("BODYMAP_MCP_TOKEN goes into the connector URL, so it may only hold letters, digits and . _ ~ - (base64url or hex).");
  if (mcpToken === uiToken) throw new Error("BODYMAP_MCP_TOKEN and BODYMAP_UI_TOKEN must differ: the token Claude holds must not open the web page's API.");
  const port = Number(env.BODYMAP_PORT ?? 8104);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("BODYMAP_PORT is not a port number.");
  const claudeMaxLevel = Number(env.BODYMAP_CLAUDE_MAX_LEVEL ?? 4);
  if (!Number.isInteger(claudeMaxLevel) || claudeMaxLevel < 1 || claudeMaxLevel > 10) throw new Error("BODYMAP_CLAUDE_MAX_LEVEL must be a whole number from 1 to 10.");
  const host = (env.BODYMAP_HOST ?? "127.0.0.1").trim();
  if (WILDCARD_HOSTS.has(host)) throw new Error("BODYMAP_HOST must name one address (default 127.0.0.1). The service is never opened on every interface.");
  return { dataDir, host, port, mcpToken, uiToken, claudeMaxLevel, webUrl: env.BODYMAP_WEB_URL || undefined, distDir: env.BODYMAP_DIST ?? distDefault, allowedHosts: hostList(env.BODYMAP_ALLOWED_HOSTS) };
}
