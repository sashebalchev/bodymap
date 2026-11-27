// The interface's behaviour with no screen: the real domain rules as a fake server, a plain backend in front of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit, emptyState } from "../src/domain.ts";
import type { Edit, EditReply, MapState } from "../src/types.ts";
import { NeedsToken, type Backend } from "../src/ui/backend.ts";
import { Controller } from "../src/ui/controller.ts";
import { T0, withClaudeLayers } from "./helpers.ts";

type Fake = Backend & { server: MapState; sent: { base: number; edit: Edit }[]; failNext?: Error; edits: Promise<void>[] };

function fake(initial: MapState = emptyState(T0)): Fake {
  const f: Fake = {
    server: initial, sent: [], edits: [],
    async load() { if (f.failNext) { const e = f.failNext; f.failNext = undefined; throw e; } return { state: f.server, claudeMaxLevel: 4 }; },
    async edit(base, edit): Promise<EditReply> {
      f.sent.push({ base, edit });
      if (f.failNext) { const e = f.failNext; f.failNext = undefined; throw e; }
      const reply = applyEdit(f.server, edit, base, new Date(T0.getTime() + 1000 * f.sent.length));
      if (reply.ok) f.server = reply.state;
      return reply;
    },
  };
  return f;
}
const line: [number, number][] = [[100, 200], [120, 220], [140, 260]];

async function ready(backend: Fake): Promise<Controller> {
  const c = new Controller(backend);
  await c.load();
  return c;
}
const levelOf = (backend: Fake, name: string) => backend.server.layers.find((l) => l.name === name)?.level;

test("load: synced at the server's revision; a mark that is gone is deselected", async () => {
  const f = fake(withClaudeLayers([{ name: "Neck", region: "neck" }]));
  const c = await ready(f);
  assert.deepEqual(c.state.conn, { is: "synced" });
  assert.equal(c.state.snap?.state.revision, 1);
  c.select(c.state.snap?.state.layers[0]?.id ?? null);
  f.server = emptyState(T0);
  await c.load();
  assert.equal(c.state.selected, null);
});

test("an unreachable server: offline, a banner that offers Try again, and the next load recovers", async () => {
  const f = fake();
  f.failNext = new TypeError("Failed to fetch");
  const c = new Controller(f);
  await c.load();
  assert.equal(c.state.conn.is, "offline");
  assert.equal(c.state.banner?.action, "retry_load");
  assert.match(c.state.banner?.text ?? "", /Cannot reach the server/);
  await c.retry();
  assert.deepEqual(c.state.conn, { is: "synced" });
  assert.equal(c.state.banner, null);
});

test("a refused token sends the screen to setup with the server's wording", async () => {
  const f = fake();
  f.failNext = new NeedsToken("That token was not accepted. Paste it again.");
  const c = new Controller(f);
  await c.load();
  assert.deepEqual(c.state.conn, { is: "needs_token", message: "That token was not accepted. Paste it again." });
});

test("painting needs a selected mark; the stroke goes to that mark on the side being shown, at the chosen brush", async () => {
  const f = fake(withClaudeLayers([{ name: "Neck", region: "neck" }]));
  const c = await ready(f);
  await c.paint(line);
  assert.equal(f.sent.length, 0, "nothing selected, nothing sent");
  const id = f.server.layers[0]?.id as string;
  c.select(id);
  c.setView("back");
  c.setBrush(28);
  await c.paint(line);
  assert.equal(f.sent.length, 1);
  const sent = f.sent[0] as { base: number; edit: Edit };
  assert.equal(sent.base, 1);
  assert.equal(sent.edit.op, "add_stroke");
  assert.deepEqual(f.server.layers[0]?.strokes.at(-1)?.view, "back");
  assert.equal(f.server.layers[0]?.strokes.at(-1)?.r, 28);
  assert.equal(c.state.snap?.state.revision, 2);
});

test("Undo takes back the last stroke, then the one before; with nothing left it does nothing", async () => {
  const f = fake(withClaudeLayers([{ name: "Neck" }]));
  const c = await ready(f);
  c.select(f.server.layers[0]?.id as string);
  await c.paint(line);
  await c.paint(line.slice().reverse());
  assert.equal(f.server.layers[0]?.strokes.length, 2);
  assert.equal(c.state.undo, "paint stroke");
  await c.undo();
  await c.undo();
  assert.equal(f.server.layers[0]?.strokes.length, 0);
  assert.equal(c.state.undo, null);
  const count = f.sent.length;
  await c.undo();
  assert.equal(f.sent.length, count);
});

test("a slider to 0 clears the mark, and Undo raises it back to where it was", async () => {
  const f = fake(withClaudeLayers([{ name: "Neck", level: 4 }]));
  const c = await ready(f);
  const id = f.server.layers[0]?.id as string;
  await c.setLevel(id, 0);
  assert.equal(levelOf(f, "Neck"), 0);
  assert.equal(c.state.undo, "clear");
  await c.undo();
  assert.equal(levelOf(f, "Neck"), 4);
  await c.setLevel(id, 4);
  assert.equal(f.sent.length, 2, "the same level again sends nothing");
});

test("a stale screen: the change is refused, the banner says so, the screen is current again and Undo is gone", async () => {
  const f = fake(withClaudeLayers([{ name: "Neck", level: 4 }]));
  const c = await ready(f);
  const id = f.server.layers[0]?.id as string;
  c.select(id);
  await c.paint(line);
  // Another device changes the mark behind this screen's back.
  f.server = applyEdit(f.server, { op: "rename", layerId: id, name: "Neck (phone)" }, f.server.revision, new Date(T0.getTime() + 99_000)).state;
  const stale = c.state.snap!.state.revision;
  assert.ok(f.server.revision > stale);
  await c.setLevel(id, 9);
  assert.equal(levelOf(f, "Neck (phone)"), 4, "the refused change did not happen");
  assert.match(c.state.banner?.text ?? "", /changed on another device/);
  assert.equal(c.state.banner?.action, "dismiss");
  assert.equal(c.state.snap?.state.layers[0]?.name, "Neck (phone)");
  assert.equal(c.state.undo, null);
  c.dismiss();
  assert.equal(c.state.banner, null);
});

test("a save that cannot reach the server keeps the edit: Try again sends it, once, with the same content", async () => {
  const f = fake(withClaudeLayers([{ name: "Neck" }]));
  const c = await ready(f);
  const id = f.server.layers[0]?.id as string;
  c.select(id);
  f.failNext = new TypeError("Failed to fetch");
  await c.paint(line);
  assert.equal(c.state.conn.is, "offline");
  assert.equal(c.state.banner?.action, "retry_edit");
  assert.equal(f.server.layers[0]?.strokes.length, 0);
  await c.retry();
  assert.equal(f.server.layers[0]?.strokes.length, 1);
  assert.deepEqual(c.state.conn, { is: "synced" });
  await c.retry();
  assert.equal(f.server.layers[0]?.strokes.length, 1, "a second Try again does not paint it twice");
});

test("edits go out one at a time, in the order Alex made them", async () => {
  const f = fake(withClaudeLayers([{ name: "A", level: 2 }, { name: "B", level: 2 }]));
  const c = await ready(f);
  const [a, b] = f.server.layers.map((l) => l.id) as [string, string];
  await Promise.all([c.setLevel(a, 6), c.setLevel(b, 7), c.rename(a, "A2")]);
  assert.deepEqual(f.sent.map((s) => s.edit.op), ["set_level", "set_level", "rename"]);
  assert.deepEqual(f.sent.map((s) => s.base), [2, 3, 4], "each one is based on the revision the one before produced");
  assert.equal(levelOf(f, "A2"), 6);
  assert.equal(levelOf(f, "B"), 7);
});

test("a new mark starts at level 5, is selected for painting, and Undo removes it again", async () => {
  const f = fake();
  const c = await ready(f);
  await c.addMark("  Left shoulder ", "pinched");
  const made = f.server.layers[0];
  assert.deepEqual([made?.name, made?.kind, made?.level, made?.by], ["Left shoulder", "pinched", 5, "alex"]);
  assert.equal(c.state.selected, made?.id);
  await c.undo();
  assert.equal(f.server.layers.length, 0);
  await c.addMark("   ", "tense");
  assert.equal(f.server.layers.length, 0, "an empty name sends nothing");
});

test("a name that exists is refused with the server's words and nothing changes", async () => {
  const f = fake(withClaudeLayers([{ name: "Neck" }]));
  const c = await ready(f);
  await c.addMark("neck", "tense");
  assert.equal(f.server.layers.length, 1);
  assert.match(c.state.banner?.text ?? "", /already exists/);
});

test("removing a mark deselects it and drops its Undo entries; only the removal is sent, no undo of it exists", async () => {
  const f = fake(withClaudeLayers([{ name: "Neck" }, { name: "Knee" }]));
  const c = await ready(f);
  const [neck, knee] = f.server.layers.map((l) => l.id) as [string, string];
  c.select(neck);
  await c.paint(line);
  c.select(knee);
  await c.paint(line);
  await c.remove(neck);
  assert.deepEqual(f.server.layers.map((l) => l.name), ["Knee"]);
  assert.equal(c.state.undo, "paint stroke", "the knee stroke is still undoable");
  await c.undo();
  assert.equal(f.server.layers[0]?.strokes.length, 0);
  assert.equal(c.state.undo, null);
});

test("forget: the screen goes back to the token form and the stored secret is dropped", async () => {
  const f = fake();
  let forgotten = false;
  const backend: Backend = { ...f, load: f.load, edit: f.edit, setup: { server: "https://x/", connect: async () => {}, forget: async () => { forgotten = true; } } };
  const c = new Controller(backend);
  await c.load();
  await c.forget();
  assert.ok(forgotten);
  assert.equal(c.state.snap, null);
  assert.equal(c.state.conn.is, "needs_token");
});
