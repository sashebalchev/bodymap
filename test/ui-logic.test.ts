import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, type Layer } from "../src/types.ts";
import { attributionText, BRUSHES, contrast, levelLabel, markMeta, marksPerView, strokeFromPoints } from "../src/ui/logic.ts";
import { simplify } from "../src/ui/simplify.ts";
import { FIGURE_NOTICE } from "../src/figure.ts";
import { StrokeSchema } from "../src/schemas.ts";

const layer = (over: Partial<Layer>): Layer => ({ id: "l_1", name: "Knee", kind: "tense", level: 5, strokes: [], by: "alex", createdAt: "2026-11-20T10:00:00Z", activeSince: "2026-11-20T10:00:00Z", clearedAt: null, rev: 1, ...over });

test("a drag becomes one stroke the server accepts: whole numbers, simplified, in range", () => {
  const drag: [number, number][] = Array.from({ length: 400 }, (_, i) => [100 + i * 0.5 + Math.sin(i / 7) * 0.3, 300 + Math.cos(i / 40) * 40]);
  const stroke = strokeFromPoints("back", 16, drag);
  assert.equal(stroke.view, "back");
  assert.equal(stroke.r, 16);
  assert.ok(stroke.pts.length < drag.length, "simplified: " + stroke.pts.length / 2 + " of " + drag.length);
  assert.ok(StrokeSchema.safeParse(stroke).success);
  assert.ok(stroke.pts.every(Number.isInteger));
});

test("a tap is a dot: one point, written twice so the server sees a stroke", () => {
  assert.deepEqual(strokeFromPoints("front", 8, [[120.4, 300.6]]).pts, [120, 301, 120, 301]);
});

test("a stroke never has more points than the server allows, however wild the drag", () => {
  const wild: [number, number][] = Array.from({ length: 6000 }, (_, i) => [(i * 7919) % 400, (i * 104729) % 900]);
  const stroke = strokeFromPoints("front", 28, wild);
  assert.ok(stroke.pts.length / 2 <= LIMITS.maxPointsPerStroke);
  assert.ok(StrokeSchema.safeParse(stroke).success);
});

test("simplify keeps both ends and drops points on a straight line", () => {
  const line: [number, number][] = [[0, 0], [1, 0.1], [2, 0], [3, 0.1], [4, 0]];
  assert.deepEqual(simplify(line, 1.5), [[0, 0], [4, 0]]);
  const corner: [number, number][] = [[0, 0], [50, 0], [50, 50]];
  assert.equal(simplify(corner, 1.5).length, 3);
});

test("brush presets are three, ascending, and inside the server's limits", () => {
  assert.equal(BRUSHES.length, 3);
  const r = BRUSHES.map((b) => b.r);
  assert.deepEqual([...r].sort((a, b) => a - b), r);
  assert.ok(r.every((v) => v >= LIMITS.minBrush && v <= LIMITS.maxBrush));
});

test("level 0 reads 'cleared', anything else its number", () => {
  assert.equal(levelLabel(0), "cleared");
  assert.equal(levelLabel(7), "7");
  assert.match(markMeta(layer({ level: 0, activeSince: null, clearedAt: "2026-11-22T10:00:00Z" })), /^Cleared 22 Nov\. Slide up to restore\.$/);
  assert.match(markMeta(layer({ kind: "pinched" })), /^Pinched, since 20 Nov$/);
});

test("the Front and Back counts include only active marks that have a stroke on that side", () => {
  const s = (view: "front" | "back") => ({ view, r: 8, pts: [1, 1, 2, 2] });
  const counts = marksPerView([layer({ id: "a", strokes: [s("front")] }), layer({ id: "b", strokes: [s("front"), s("back")] }), layer({ id: "c", level: 0, strokes: [s("back")] }), layer({ id: "d" })]);
  assert.deepEqual(counts, { front: 2, back: 1 });
});

test("contrast follows WCAG: black on white is 21, a colour with itself is 1", () => {
  assert.ok(Math.abs(contrast("#000000", "#ffffff") - 21) < 0.01);
  assert.equal(contrast("#336699", "#336699"), 1);
});

test("the About screen shows the attribution section of the notice, and the whole notice when that section is missing", () => {
  const text = attributionText(FIGURE_NOTICE);
  assert.match(text, /^Body figures: "Muscles front and back" by OpenStax/);
  assert.match(text, /CC BY-SA 4\.0/);
  assert.ok(!text.includes("##") && !text.startsWith(">"));
  assert.ok(text.length < FIGURE_NOTICE.length / 2);
  assert.equal(attributionText("just a note"), "just a note");
});
