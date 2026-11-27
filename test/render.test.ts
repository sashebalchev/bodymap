import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit } from "../src/domain.ts";
import { compositeSvg, renderComposite } from "../src/render.ts";
import { FIG_VIEW, type MapState } from "../src/types.ts";
import { T1, withClaudeLayers } from "./helpers.ts";

const withoutIds = (svg: string) => svg.replace(/ data-layer="[^"]*"/g, "");

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const pixel = (r: { pixels: Uint8Array; width: number }, x: number, y: number) => [...r.pixels.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];

function clear(state: MapState, name: string): MapState {
  const id = state.layers.find((l) => l.name === name)?.id as string;
  const r = applyEdit(state, { op: "set_level", layerId: id, level: 0 }, state.revision, T1);
  assert.ok(r.ok);
  return r.state;
}

test("the composite leaves out a layer at level 0: same picture as if it were never there", () => {
  const both = withClaudeLayers([{ name: "Neck", region: "neck", level: 3 }, { name: "Knee", region: "left_knee", level: 3 }]);
  const cleared = clear(both, "Knee");
  const never = withClaudeLayers([{ name: "Neck", region: "neck", level: 3 }]);
  assert.equal(withoutIds(compositeSvg(cleared)), withoutIds(compositeSvg(never)));
  assert.notEqual(withoutIds(compositeSvg(both)), withoutIds(compositeSvg(never)));
});

test("a layer is drawn at opacity level / 10", () => {
  const svg = compositeSvg(withClaudeLayers([{ name: "Neck", region: "neck", level: 7 }]));
  assert.match(svg, /data-layer="[^"]+" opacity="0.7"/);
});

test("the PNG is a real picture, front and back side by side, and a stronger level stands out more from the drawing", async () => {
  const weak = await renderComposite(withClaudeLayers([{ name: "Lower back", kind: "sharp", region: "lower_back", level: 2 }]));
  const strong = await renderComposite(withClaudeLayers([{ name: "Lower back", kind: "sharp", region: "lower_back", level: 9 }]));
  const none = await renderComposite(withClaudeLayers([]));
  assert.deepEqual([...strong.png.slice(0, 4)], PNG_MAGIC);
  assert.deepEqual([strong.width, strong.height], [800, 710]);
  // lower back is on the back view only: right half. A spot on the mark, away from the badge in its middle.
  const at = (r: typeof weak) => pixel(r, 400 + 235, 392 - FIG_VIEW.y);
  const away = (r: typeof weak) => at(r).reduce((sum, c, i) => sum + Math.abs(c - (at(none)[i] as number)), 0);
  assert.ok(away(weak) > 20, "a weak mark shows: " + away(weak));
  assert.ok(away(strong) > away(weak) + 60, "a strong mark shows more: " + [away(weak), away(strong)]);
  assert.deepEqual(pixel(strong, 235, 392 - FIG_VIEW.y), pixel(none, 235, 392 - FIG_VIEW.y), "the front half is untouched");
});

test("a cleared layer's pixels match an empty map exactly", async () => {
  const state = clear(withClaudeLayers([{ name: "Lower back", region: "lower_back", level: 9 }]), "Lower back");
  const a = await renderComposite(state);
  const b = await renderComposite(withClaudeLayers([]));
  assert.deepEqual(a.pixels, b.pixels);
});
