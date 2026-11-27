// The HTTP backend shared by the web page and the Android app, against the real service and a stand-in transport.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apiBackend, NeedsToken, normalizeServerUrl, parseSetupLink, type Transport } from "../src/ui/backend.ts";
import { Controller } from "../src/ui/controller.ts";
import { startServer, UI_TOKEN } from "./server-helpers.ts";

const fetchTransport: Transport = async ({ url, method, token, body }) => {
  const r = await fetch(url, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test("load and edit against the real service, through a Controller: a stroke lands in the server's map", async () => {
  const s = await startServer();
  try {
    const backend = apiBackend({ base: () => s.url + "/", token: () => UI_TOKEN, transport: fetchTransport });
    const c = new Controller(backend);
    await c.load();
    assert.deepEqual(c.state.conn, { is: "synced" });
    await c.addMark("Left shoulder", "pinched");
    await c.paint([[100, 200], [120, 230], [150, 250]]);
    await c.setLevel(c.state.selected as string, 8);
    const layer = s.map.state.layers[0];
    assert.deepEqual([layer?.name, layer?.kind, layer?.level, layer?.strokes.length], ["Left shoulder", "pinched", 8, 1]);
    assert.equal(c.state.snap?.state.revision, s.map.state.revision);
  } finally { await s.close(); }
});

test("a wrong token is NeedsToken with words Alex can act on; no token at all is NeedsToken with none", async () => {
  const s = await startServer();
  try {
    await assert.rejects(apiBackend({ base: () => s.url + "/", token: () => "x".repeat(32), transport: fetchTransport }).load(), (e: Error) => e instanceof NeedsToken && /not accepted/.test(e.message));
    await assert.rejects(apiBackend({ base: () => s.url + "/", token: () => null, transport: fetchTransport }).load(), (e: Error) => e instanceof NeedsToken && e.message === "");
  } finally { await s.close(); }
});

test("a stale edit comes back as the server's conflict reply, not as an exception", async () => {
  const s = await startServer();
  try {
    const backend = apiBackend({ base: () => s.url + "/", token: () => UI_TOKEN, transport: fetchTransport });
    const first = await backend.edit(0, { op: "add_layer", name: "Neck", kind: "tense", level: 3 });
    assert.ok(first.ok);
    const id = first.ok ? first.layerId as string : "";
    await backend.edit(first.state.revision, { op: "rename", layerId: id, name: "Neck 2" });
    const stale = await backend.edit(first.state.revision, { op: "set_level", layerId: id, level: 9 });
    assert.equal(stale.ok, false);
    assert.equal(stale.ok ? "" : stale.error, "conflict");
    assert.equal(stale.state.layers[0]?.level, 3);
  } finally { await s.close(); }
});

test("an address that answers but is not a body map server says so", async () => {
  const backend = apiBackend({ base: () => "https://example.test/", token: () => "t", transport: async () => ({ status: 200, body: { hello: "world" } }) });
  await assert.rejects(backend.load(), /does not answer like a body map server/);
  const down = apiBackend({ base: () => "https://example.test/", token: () => "t", transport: async () => ({ status: 502, body: null }) });
  await assert.rejects(down.load(), /answered 502/);
});

test("the server address: https is assumed, a path keeps its slash, query and fragment go", () => {
  assert.equal(normalizeServerUrl("gym.tailcab34c.ts.net/bodymap"), "https://gym.tailcab34c.ts.net/bodymap/");
  assert.equal(normalizeServerUrl("  https://gym.tailcab34c.ts.net/bodymap/?x=1#y "), "https://gym.tailcab34c.ts.net/bodymap/");
  assert.equal(normalizeServerUrl("http://10.0.2.2:8104"), "http://10.0.2.2:8104/");
  for (const bad of ["", "   ", "ftp://host/", "https://", "not a url at all"]) assert.throws(() => normalizeServerUrl(bad), Error, JSON.stringify(bad));
});

test("the setup link carries the two fields, and only bodymap://setup counts", () => {
  assert.deepEqual(parseSetupLink("bodymap://setup?server=https%3A%2F%2Fgym.example%2Fbodymap%2F&token=abc-123_x"), { server: "https://gym.example/bodymap/", token: "abc-123_x" });
  assert.deepEqual(parseSetupLink("bodymap://setup?token=t"), { server: "", token: "t" });
  for (const no of ["bodymap://other?server=x", "https://setup?server=x", "bodymap://setup", "nonsense", ""]) assert.equal(parseSetupLink(no), null, no);
});
