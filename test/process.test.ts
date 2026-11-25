// The real entry point as a child process: files for secrets, loopback by default, and no secret in any output.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const root = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "Sx9-" + "k2_pQ".repeat(8) + "7wE";
const UI = "ui-" + "z".repeat(40);
const dir = mkdtempSync(join(tmpdir(), "bodymap-proc-"));
const mcpFile = join(dir, "mcp-token"), uiFile = join(dir, "ui-token");
writeFileSync(mcpFile, SECRET + "\n", { mode: 0o600 });
writeFileSync(uiFile, UI + "\n", { mode: 0o600 });

const env = (extra: Record<string, string> = {}) => ({ PATH: process.env.PATH ?? "", BODYMAP_DATA_DIR: join(dir, "data"), BODYMAP_PORT: "0", BODYMAP_MCP_TOKEN_FILE: mcpFile, BODYMAP_UI_TOKEN_FILE: uiFile, ...extra });
let child: ChildProcess | undefined;
let output = "";
let base = "";

before(async () => {
  child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/main.ts"], { cwd: root, env: env(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  base = await new Promise<string>((resolve, reject) => {
    const take = (c: Buffer) => {
      output += c;
      const m = /listening on ([\d.]+):(\d+)/.exec(output);
      if (m) resolve("http://" + m[1] + ":" + m[2]);
    };
    child?.stdout?.on("data", take);
    child?.stderr?.on("data", take);
    child?.on("exit", (code) => reject(new Error("server exited with " + code + ": " + output.slice(0, 300))));
  });
});
after(() => {
  if (child?.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
  rmSync(dir, { recursive: true, force: true });
});

test("with secrets from files and no host set, it listens on 127.0.0.1 and the path secret works", async () => {
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  const client = new Client({ name: "proc", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp/" + SECRET)));
  try {
    assert.ok((await client.listTools()).tools.length >= 3);
  } finally {
    await client.close();
  }
  assert.equal((await fetch(base + "/api/state", { headers: { authorization: "Bearer " + UI } })).status, 200, "the UI token file works");
});

test("the data folder named by BODYMAP_DATA_DIR is created and used", async () => {
  const edit = { base: 0, edit: { op: "add_layer", name: "Neck", kind: "tense", level: 3 } };
  const r = await fetch(base + "/api/edit", { method: "POST", headers: { authorization: "Bearer " + UI, "content-type": "application/json" }, body: JSON.stringify(edit) });
  assert.equal(r.status, 200);
  const listing = spawnSync("ls", [join(dir, "data")], { encoding: "utf8" });
  assert.match(listing.stdout, /body-map\.json/);
});

test("wrong secrets, bad bodies and odd paths leave no secret and no request path in stdout or stderr", async () => {
  await fetch(base + "/mcp/" + SECRET, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  await fetch(base + "/mcp/" + SECRET, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope", arguments: {} } }) });
  await fetch(base + "/mcp/" + SECRET.slice(0, -1) + "Q", { method: "POST", body: "{}" });
  await fetch(base + "/mcp/" + SECRET, { method: "DELETE" });
  await fetch(base + "/mcp/" + SECRET, { method: "GET", headers: { accept: "text/event-stream" } });
  await fetch(base + "/mcp/" + SECRET + "/zzz-marker-path", { method: "POST", body: "{}" });
  assert.ok(output.length > 0, "the start-up line was captured");
  assert.equal(output.includes(SECRET), false);
  assert.equal(output.includes(SECRET.slice(0, 12)), false);
  assert.equal(output.includes(UI), false);
  assert.equal(output.includes("zzz-marker-path"), false);
});

test("it refuses to start on every interface, with a short token, or with a token that cannot sit in a URL", () => {
  const run = (extra: Record<string, string>) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "src/main.ts"], { cwd: root, env: env(extra), encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL" });
  for (const host of ["0.0.0.0", "::", "*"]) {
    const r = run({ BODYMAP_HOST: host });
    assert.notEqual(r.status, 0, host);
    assert.match(r.stderr, /never opened on every interface/);
  }
  const unsafe = join(dir, "unsafe");
  writeFileSync(unsafe, "has/slash".padEnd(30, "a"));
  const r = run({ BODYMAP_MCP_TOKEN_FILE: unsafe });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /letters, digits/);
  assert.equal(r.stderr.includes("has/slash"), false, "the refused value is not echoed");
});
