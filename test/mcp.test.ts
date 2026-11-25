import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GRANT, MCP_TOKEN, UI_TOKEN, startServer, type Running } from "./server-helpers.ts";

type Block = { type: string; text?: string; data?: string; mimeType?: string };
type ToolResult = { content: Block[]; isError?: boolean; structuredContent?: any };
type ToolMeta = { name: string; _meta?: { ui?: { visibility?: string[]; resourceUri?: string } } };

let s: Running;
before(async () => { s = await startServer({ claudeMaxLevel: 4 }); });
after(async () => { await s.close(); });

const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => (await (await s.client()).callTool({ name, arguments: args })) as ToolResult;
const textOf = (r: ToolResult) => r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
const visibleTo = (tools: ToolMeta[], who: "model" | "app") => tools.filter((t) => (t._meta?.ui?.visibility ?? ["model", "app"]).includes(who)).map((t) => t.name).sort();

test("what Claude can see: show, read and add. Nothing that lowers or deletes.", async () => {
  const { tools } = await (await s.client()).listTools();
  const forModel = visibleTo(tools as ToolMeta[], "model");
  assert.deepEqual(forModel, ["add_layer", "get_body_map", "show_body_map"]);
  for (const name of forModel) assert.doesNotMatch(name, /delete|remove|clear|lower|set_level|edit|undo/);
});

test("the tools that can lower or delete are app-only, and the app cannot reach the agent's tools", async () => {
  const { tools } = await (await s.client()).listTools();
  const meta = tools as ToolMeta[];
  assert.deepEqual(visibleTo(meta, "app"), ["body_map_edit", "body_map_state", "show_body_map"]);
  assert.deepEqual(meta.find((t) => t.name === "body_map_edit")?._meta?.ui?.visibility, ["app"]);
});

test("the app tools refuse a caller without the app's own grant", async () => {
  const guess = await call("body_map_edit", { grant: "x", base: 0, edit: { op: "add_layer", name: "Sneaky", kind: "tense", level: 5 } });
  assert.equal(guess.isError, true);
  const state = await call("body_map_state", { grant: "" });
  assert.equal(state.isError, true);
  assert.equal(s.map.state.layers.length, 0);
});

test("show_body_map links the ui:// resource, which is self-contained HTML with the right mime type", async () => {
  const client = await s.client();
  const { tools } = await client.listTools();
  const show = (tools as ToolMeta[]).find((t) => t.name === "show_body_map");
  const uri = show?._meta?.ui?.resourceUri;
  assert.equal(uri, "ui://bodymap/view.html");
  const read = await client.readResource({ uri: uri as string });
  const first = read.contents[0] as { mimeType?: string; text?: string };
  assert.equal(first.mimeType, "text/html;profile=mcp-app");
  assert.match(first.text ?? "", new RegExp(GRANT));
  assert.match(textOf(await call("show_body_map")), /open for Alex/);
});

test("add_layer puts a capped layer on the map and says so", async () => {
  const r = await call("add_layer", { name: "Left shoulder", kind: "pinched", level: 9, region: "left_shoulder" });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /level 4\/10/);
  assert.match(textOf(r), /capped at 4/);
  assert.equal(s.map.state.layers[0]?.level, 4);
});

test("add_layer cannot change a layer that is there, even a cleared one, and refuses with a reason", async () => {
  const layer = s.map.state.layers[0];
  assert.ok(layer);
  // Alex clears it, in his interface
  const cleared = await s.api("/api/edit", { method: "POST", body: JSON.stringify({ base: s.map.state.revision, edit: { op: "set_level", layerId: layer.id, level: 0 } }) });
  assert.equal(cleared.status, 200);
  const before = JSON.stringify(s.map.state);
  const again = await call("add_layer", { name: "left shoulder", kind: "sharp", level: 4 });
  assert.equal(again.isError, true);
  assert.match(textOf(again), /already exists \(cleared by Alex\)/);
  assert.equal(JSON.stringify(s.map.state), before);
});

test("get_body_map returns a PNG and a list that leaves the cleared layer out of the picture", async () => {
  await call("add_layer", { name: "Lower back", kind: "tense", level: 2, region: "lower_back" });
  const r = await call("get_body_map");
  const image = r.content.find((b) => b.type === "image");
  assert.equal(image?.mimeType, "image/png");
  assert.deepEqual([...Buffer.from(image?.data ?? "", "base64").subarray(1, 4)], [0x50, 0x4e, 0x47]);
  const text = textOf(r);
  assert.match(text, /1\. Lower back \| tense \| level 2\/10/);
  assert.doesNotMatch(text, /1\. Left shoulder/);
  assert.match(text, /Cleared by Alex.*Left shoulder/);
});

test("the agent door wants its token, the web token does not open it, and the agent token does not open the web API", async () => {
  const none = await fetch(s.url + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(none.status, 404);
  assert.equal(none.headers.get("www-authenticate"), null);
  const wrong = await fetch(s.url + "/mcp", { method: "POST", headers: { authorization: "Bearer " + UI_TOKEN }, body: "{}" });
  assert.equal(wrong.status, 404);
  assert.equal((await s.api("/api/state", { token: MCP_TOKEN })).status, 401);
  assert.equal((await s.api("/api/state", { token: "" })).status, 401);
  assert.equal((await s.api("/api/state")).status, 200);
});

test("the web door: edits go through, a stale screen gets a 409 with the fresh state, junk gets a 400", async () => {
  const state = s.map.state;
  const layer = state.layers.find((l) => l.name === "Lower back");
  assert.ok(layer);
  const edit = (base: number, body: unknown) => s.api("/api/edit", { method: "POST", body: JSON.stringify({ base, edit: body }) });
  const ok = await edit(state.revision, { op: "set_level", layerId: layer.id, level: 7 });
  assert.equal(ok.status, 200);
  const stale = await edit(state.revision, { op: "set_level", layerId: layer.id, level: 0 });
  assert.equal(stale.status, 409);
  const body = (await stale.json()) as { error: string; state: { layers: { name: string; level: number }[] } };
  assert.equal(body.error, "conflict");
  assert.equal(body.state.layers.find((l) => l.name === "Lower back")?.level, 7);
  assert.equal((await edit(0, { op: "set_level", layerId: layer.id, level: 11 })).status, 400);
  assert.equal((await edit(0, { op: "explode" })).status, 400);
  assert.equal((await s.api("/api/edit", { method: "POST", body: "{nope" })).status, 400);
});

test("an unknown path answers 404 and the health check answers without a token", async () => {
  assert.equal((await fetch(s.url + "/nothing")).status, 404);
  assert.equal((await fetch(s.url + "/healthz")).status, 200);
  const page = await fetch(s.url + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
});
