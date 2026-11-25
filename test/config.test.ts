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
