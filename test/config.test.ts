import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../src/config.ts";

const A = "a".repeat(30), B = "b".repeat(30);
const base = { BODYMAP_DATA_DIR: "/x", BODYMAP_MCP_TOKEN: A, BODYMAP_UI_TOKEN: B };

test("a good environment gives the defaults: port 8104, loopback, Claude capped at 4", () => {
  const c = readConfig(base, "/dist");
  assert.deepEqual([c.port, c.host, c.claudeMaxLevel], [8104, "127.0.0.1", 4]);
});

test("the same token for both doors is refused, so Claude's token can never open the web API", () => {
  assert.throws(() => readConfig({ ...base, BODYMAP_UI_TOKEN: A }, "/d"), /must differ/);
});

test("a short, missing or malformed setting stops the start with a message that says what to set", () => {
  assert.throws(() => readConfig({ ...base, BODYMAP_MCP_TOKEN: "short" }, "/d"), /at least 24/);
  assert.throws(() => readConfig({ ...base, BODYMAP_UI_TOKEN: undefined }, "/d"), /BODYMAP_UI_TOKEN/);
  assert.throws(() => readConfig({ ...base, BODYMAP_DATA_DIR: undefined }, "/d"), /BODYMAP_DATA_DIR/);
  assert.throws(() => readConfig({ ...base, BODYMAP_CLAUDE_MAX_LEVEL: "11" }, "/d"), /1 to 10/);
  assert.throws(() => readConfig({ ...base, BODYMAP_PORT: "http" }, "/d"), /not a port/);
});

test("a token can come from a file, whitespace trimmed, so no secret has to sit in the environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "bodymap-cfg-"));
  try {
    writeFileSync(join(dir, "mcp"), A + "\n");
    const c = readConfig({ BODYMAP_DATA_DIR: "/x", BODYMAP_MCP_TOKEN_FILE: join(dir, "mcp"), BODYMAP_UI_TOKEN: B }, "/d");
    assert.equal(c.mcpToken, A);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the web token can come from a file too", () => {
  const dir = mkdtempSync(join(tmpdir(), "bodymap-cfg-"));
  try {
    writeFileSync(join(dir, "ui"), B + "\n");
    const c = readConfig({ BODYMAP_DATA_DIR: "/x", BODYMAP_MCP_TOKEN: A, BODYMAP_UI_TOKEN_FILE: join(dir, "ui") }, "/d");
    assert.equal(c.uiToken, B);
    assert.throws(() => readConfig({ BODYMAP_DATA_DIR: "/x", BODYMAP_MCP_TOKEN: A, BODYMAP_UI_TOKEN_FILE: join(dir, "missing") }, "/d"), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the MCP token must fit in a URL path: base64url and hex pass, slash, plus, percent and space fail", () => {
  for (const ok of ["Ab_-".repeat(11), "0123456789abcdef".repeat(3), "a.b~c-".repeat(6)]) assert.equal(readConfig({ ...base, BODYMAP_MCP_TOKEN: ok }, "/d").mcpToken, ok);
  for (const bad of ["a/b".padEnd(30, "c"), "a+b".padEnd(30, "c"), "a%2fb".padEnd(30, "c"), "a b".padEnd(30, "c"), "a=".padEnd(30, "c"), "a?b".padEnd(30, "c")]) {
    assert.throws(() => readConfig({ ...base, BODYMAP_MCP_TOKEN: bad }, "/d"), /letters, digits/, JSON.stringify(bad.slice(0, 4)));
  }
});

test("the host is loopback by default, a named address is kept, and the wildcards are refused", () => {
  assert.equal(readConfig({ ...base, BODYMAP_HOST: "127.0.0.2" }, "/d").host, "127.0.0.2");
  for (const wild of ["0.0.0.0", "::", "[::]", "*", " "]) assert.throws(() => readConfig({ ...base, BODYMAP_HOST: wild }, "/d"), /every interface/, wild);
});

test("allowed hosts are a comma list of bare host names, lower-cased; anything else stops the start", () => {
  assert.deepEqual(readConfig(base, "/d").allowedHosts, []);
  assert.deepEqual(readConfig({ ...base, BODYMAP_ALLOWED_HOSTS: "Gym.tailcab34c.ts.net, other.example" }, "/d").allowedHosts, ["gym.tailcab34c.ts.net", "other.example"]);
  for (const bad of ["https://gym.example", "gym.example:443", "gym.example/x", "gym example"]) assert.throws(() => readConfig({ ...base, BODYMAP_ALLOWED_HOSTS: bad }, "/d"), /host names only/, bad);
});
