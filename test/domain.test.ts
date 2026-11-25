import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdit, claudeAddLayer, emptyState } from "../src/domain.ts";
import { Store } from "../src/store.ts";
import { describe } from "../src/text.ts";
import { LIMITS, type Layer, type MapState } from "../src/types.ts";
import { T0, T1, withClaudeLayers } from "./helpers.ts";

const layer = (state: MapState, name: string): Layer => {
  const found = state.layers.find((l) => l.name === name);
  assert.ok(found, "no layer called " + name);
  return found;
};

test("Claude's layer is capped at the level Alex allows, and the answer says so", () => {
  const r = claudeAddLayer(emptyState(T0), { name: "Left shoulder", kind: "pinched", level: 9 }, 4, T0);
  assert.ok(r.ok);
  assert.equal(r.layer.level, 4);
  assert.match(r.note, /capped at 4/);
  assert.equal(r.layer.by, "claude");
});

test("without a level Claude's layer starts modest, never above the cap", () => {
  const r = claudeAddLayer(emptyState(T0), { name: "Neck", kind: "tense" }, 2, T0);
  assert.ok(r.ok);
  assert.equal(r.layer.level, 2);
});

test("Claude cannot change a layer that exists: not raise it, not revive a cleared one, not repaint it", () => {
  let state = withClaudeLayers([{ name: "Neck", region: "neck", level: 2 }]);
  const neck = layer(state, "Neck");
  state = (applyEdit(state, { op: "set_level", layerId: neck.id, level: 0 }, state.revision, T1) as { state: MapState }).state;
  const before = JSON.stringify(state);
  for (const name of ["Neck", "  neck ", "NECK"]) {
    const r = claudeAddLayer(state, { name, kind: "sharp", level: 4, region: "head" }, 4, T1);
    assert.equal(r.ok, false);
    assert.equal(r.state, state);
  }
  assert.equal(JSON.stringify(state), before);
  assert.equal(layer(state, "Neck").level, 0);
});

test("a long run of Claude additions never alters, lowers or removes what was there", () => {
  let state = withClaudeLayers([{ name: "A", region: "head", level: 3 }, { name: "B", region: "chest", level: 2 }]);
  const frozen = new Map(state.layers.map((l) => [l.id, JSON.stringify(l)]));
  const names = ["A", "B", "C", "D", "a", "E"];
  for (let i = 0; i < 30; i++) {
    const r = claudeAddLayer(state, { name: names[i % names.length] as string, kind: "pinched", level: (i % 10) + 1, region: i % 2 ? "knee_oops" : "neck" }, 4, T1);
    if (r.ok) state = r.state;
    for (const l of state.layers) if (frozen.has(l.id)) assert.equal(JSON.stringify(l), frozen.get(l.id));
    assert.ok([...frozen.keys()].every((id) => state.layers.some((l) => l.id === id)));
  }
});

test("Claude's mark goes where the words say, in Alex's own left and right", () => {
  const state = withClaudeLayers([{ name: "Left shoulder", region: "left_shoulder" }]);
  const [front, back] = layer(state, "Left shoulder").strokes;
  assert.equal(front?.view, "front");
  assert.equal(back?.view, "back");
  assert.ok((front?.pts[0] ?? 0) > 200, "front view: his left is on the right of the picture");
  assert.ok((back?.pts[0] ?? 999) < 200, "back view: his left is on the left of the picture");
});

test("an unknown region or a view the region is not on is refused, not guessed", () => {
  const s = emptyState(T0);
  assert.equal(claudeAddLayer(s, { name: "x", kind: "tense", region: "elbow_of_doom" }, 4, T0).ok, false);
  assert.equal(claudeAddLayer(s, { name: "x", kind: "tense", region: "chest", view: "back" }, 4, T0).ok, false);
});

test("Alex lowers a slider to 0: cleared, hidden, remembered; raising it again makes it active from now", () => {
  let state = withClaudeLayers([{ name: "Neck", level: 3 }]);
  const id = layer(state, "Neck").id;
  let r = applyEdit(state, { op: "set_level", layerId: id, level: 0 }, state.revision, T1);
  assert.ok(r.ok);
  state = r.state;
  assert.equal(layer(state, "Neck").level, 0);
  assert.equal(layer(state, "Neck").activeSince, null);
  assert.equal(layer(state, "Neck").clearedAt, T1.toISOString());
  assert.match(describe(state, T1), /Cleared by Alex.*Neck/);
  assert.match(describe(state, T1), /No active layers/);
  const later = new Date("2026-11-26T10:00:00Z");
  r = applyEdit(state, { op: "set_level", layerId: id, level: 6 }, state.revision, later);
  assert.ok(r.ok);
  assert.equal(layer(r.state, "Neck").activeSince, later.toISOString());
});

test("since-when survives level changes that stay above 0", () => {
  let state = withClaudeLayers([{ name: "Neck", level: 3 }]);
  const id = layer(state, "Neck").id;
  const r = applyEdit(state, { op: "set_level", layerId: id, level: 7 }, state.revision, T1);
  assert.ok(r.ok);
  assert.equal(layer(r.state, "Neck").activeSince, T0.toISOString());
});

test("a change made from an older screen is refused when the layer moved on", () => {
  const state = withClaudeLayers([{ name: "Neck", level: 3 }]);
  const stale = state.revision;
  const id = layer(state, "Neck").id;
  const first = applyEdit(state, { op: "rename", layerId: id, name: "Neck, right side" }, stale, T1);
  assert.ok(first.ok);
  const second = applyEdit(first.state, { op: "set_level", layerId: id, level: 0 }, stale, T1);
  assert.equal(second.ok, false);
  assert.ok(!second.ok && second.error === "conflict");
  assert.equal(layer(second.state, "Neck, right side").level, 3, "the refused change did not happen");
});

test("a layer Claude adds does not make Alex's open screen stale for the other layers", () => {
  let state = withClaudeLayers([{ name: "Neck", level: 3 }]);
  const seen = state.revision;
  const added = claudeAddLayer(state, { name: "Knee", kind: "sharp", level: 2 }, 4, T1);
  assert.ok(added.ok);
  const r = applyEdit(added.state, { op: "set_level", layerId: layer(added.state, "Neck").id, level: 0 }, seen, T1);
  assert.ok(r.ok, "Alex's edit of Neck still goes through");
  assert.equal(r.state.revision, added.state.revision + 1);
});

test("edits to a missing layer, duplicate names and the layer cap are refused with a reason", () => {
  let state = withClaudeLayers([{ name: "Neck" }]);
  const gone = applyEdit(state, { op: "set_level", layerId: "l_nope", level: 0 }, state.revision, T1);
  assert.ok(!gone.ok && gone.error === "not_found");
  const dup = applyEdit(state, { op: "add_layer", name: "neck", kind: "tense", level: 5 }, state.revision, T1);
  assert.ok(!dup.ok && dup.error === "invalid");
  for (let i = 0; state.layers.length < LIMITS.maxLayers; i++) {
    const r = applyEdit(state, { op: "add_layer", name: "n" + i, kind: "tense", level: 1 }, state.revision, T1);
    assert.ok(r.ok);
    state = r.state;
  }
  const over = applyEdit(state, { op: "add_layer", name: "one too many", kind: "tense", level: 1 }, state.revision, T1);
  assert.ok(!over.ok && over.error === "limit");
});

test("strokes are added and undone one at a time", () => {
  let state = withClaudeLayers([{ name: "Neck" }]);
  const id = layer(state, "Neck").id;
  const stroke = { view: "back" as const, r: 10, pts: [100, 100, 120, 120] };
  let r = applyEdit(state, { op: "add_stroke", layerId: id, stroke }, state.revision, T1);
  assert.ok(r.ok);
  assert.equal(layer(r.state, "Neck").strokes.length, 1);
  r = applyEdit(r.state, { op: "remove_last_stroke", layerId: id }, r.state.revision, T1);
  assert.ok(r.ok);
  assert.equal(layer(r.state, "Neck").strokes.length, 0);
  state = r.state;
  assert.ok(!applyEdit(state, { op: "remove_last_stroke", layerId: id }, state.revision, T1).ok);
});

test("the list for Claude names level, kind and since-when, and says when nothing is marked", () => {
  assert.match(describe(emptyState(T0), T1), /No active layers/);
  const state = withClaudeLayers([{ name: "Left shoulder", kind: "pinched", region: "left_shoulder", level: 4 }]);
  const text = describe(state, T1);
  assert.match(text, /1\. Left shoulder \| pinched \| level 4\/10 \| since 2026-11-24 \(24 h\) \| added by Claude \| marked on front and back/);
  assert.match(text, /revision 1/);
});

test("the file keeps the map and its revision across a restart, and a damaged file is never overwritten", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bodymap-test-"));
  try {
    const store = await Store.open(dir, () => T0);
    await store.update((s) => {
      const r = claudeAddLayer(s, { name: "Neck", kind: "tense", region: "neck" }, 4, T1);
      assert.ok(r.ok);
      return { next: r.state, value: null };
    });
    const again = await Store.open(dir, () => T0);
    assert.equal(again.state.revision, 1);
    assert.equal(again.state.layers[0]?.name, "Neck");

    const broken = '{"version":1,"revision":"x"';
    await writeFile(join(dir, "body-map.json"), broken);
    await assert.rejects(Store.open(dir, () => T0), /not valid JSON/);
    assert.equal(await readFile(join(dir, "body-map.json"), "utf8"), broken);
    await writeFile(join(dir, "body-map.json"), JSON.stringify({ version: 1, revision: -3, updatedAt: "", layers: [] }));
    await assert.rejects(Store.open(dir, () => T0), /does not look like a body map/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two writes at once both land, in order, with no lost update", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bodymap-test-"));
  try {
    const store = await Store.open(dir, () => T0);
    const add = (name: string) => store.update((s) => { const r = claudeAddLayer(s, { name, kind: "tense" }, 4, T1); assert.ok(r.ok); return { next: r.state, value: null }; });
    await Promise.all([add("A"), add("B"), add("C")]);
    assert.deepEqual(store.state.layers.map((l) => l.name), ["A", "B", "C"]);
    assert.equal(store.state.revision, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
