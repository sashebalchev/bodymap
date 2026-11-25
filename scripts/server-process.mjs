// Starts the real server as a child process for the look scripts. Tokens go in the environment, never in argv.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_TOKEN = "m".repeat(16) + "0123456789abcdef";
export const UI_TOKEN = "u".repeat(16) + "fedcba9876543210";

export async function startRealServer(extraEnv = {}) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "bodymap-data-"));
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/main.ts"], {
    cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, BODYMAP_DATA_DIR: dir, BODYMAP_PORT: "0", BODYMAP_MCP_TOKEN: MCP_TOKEN, BODYMAP_UI_TOKEN: UI_TOKEN, ...extraEnv },
  });
  const port = await new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (c) => { out += c; const m = /listening on [^:]+:(\d+)/.exec(out); if (m) resolve(Number(m[1])); });
    child.stderr.on("data", (c) => { out += c; });
    child.on("exit", (code) => reject(new Error("server exited with " + code + ": " + out.slice(0, 300))));
  });
  return {
    url: "http://127.0.0.1:" + port, dir, port,
    stop() { try { process.kill(-child.pid, "SIGKILL"); } catch {} rmSync(dir, { recursive: true, force: true }); },
  };
}
