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
};

type Env = Record<string, string | undefined>;

function secret(env: Env, name: string): string {
  const file = env[name + "_FILE"];
  const raw = file ? readFileSync(file, "utf8") : env[name];
  const value = raw?.trim();
  if (!value) throw new Error("Set " + name + " or " + name + "_FILE.");
  if (value.length < 24) throw new Error(name + " must be at least 24 characters. Make one with: openssl rand -hex 24");
  return value;
}

export function readConfig(env: Env, distDefault: string): Config {
  const dataDir = env.BODYMAP_DATA_DIR;
  if (!dataDir) throw new Error("Set BODYMAP_DATA_DIR to the folder that holds body-map.json.");
  const mcpToken = secret(env, "BODYMAP_MCP_TOKEN");
  const uiToken = secret(env, "BODYMAP_UI_TOKEN");
  if (mcpToken === uiToken) throw new Error("BODYMAP_MCP_TOKEN and BODYMAP_UI_TOKEN must differ: the token Claude holds must not open the web page's API.");
  const port = Number(env.BODYMAP_PORT ?? 8104);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("BODYMAP_PORT is not a port number.");
  const claudeMaxLevel = Number(env.BODYMAP_CLAUDE_MAX_LEVEL ?? 4);
  if (!Number.isInteger(claudeMaxLevel) || claudeMaxLevel < 1 || claudeMaxLevel > 10) throw new Error("BODYMAP_CLAUDE_MAX_LEVEL must be a whole number from 1 to 10.");
  return { dataDir, host: env.BODYMAP_HOST ?? "127.0.0.1", port, mcpToken, uiToken, claudeMaxLevel, webUrl: env.BODYMAP_WEB_URL || undefined, distDir: env.BODYMAP_DIST ?? distDefault };
}
