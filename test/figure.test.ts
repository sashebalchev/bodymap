import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { figureAssetsModule } from "../scripts/figure-assets.mjs";
import { FIGURE_NOTICE, figureSvg, STAGE_BG } from "../src/figure.ts";
import { REGION_IDS, regionStrokes } from "../src/regions.ts";
import { compositeSvg, renderComposite } from "../src/render.ts";
import { FIG_H, FIG_W, KIND_COLOR, KINDS, VIEWS } from "../src/types.ts";
import { contrast } from "../src/ui/logic.ts";
import { withClaudeLayers } from "./helpers.ts";

const root = new URL("../", import.meta.url);

test("src/figure-assets.ts is what the build makes from assets/figure (run npm run build when this fails)", async () => {
  assert.equal(await readFile(new URL("src/figure-assets.ts", root), "utf8"), await figureAssetsModule());
});

test("the drawing is the checked-in front.svg and back.svg, each one sized to the drawing space", async () => {
  for (const view of VIEWS) {
    const file = await readFile(new URL("assets/figure/" + view + ".svg", root), "utf8");
    const inner = file.slice(file.indexOf("<svg ") + 5);
    const svg = figureSvg(view);
    assert.ok(svg.startsWith('<svg width="' + FIG_W + '" height="' + FIG_H + '" '), view + " is not sized");
    assert.ok(svg.includes(inner.slice(0, 400)), view + " does not carry the file's own markup");
    assert.match(svg, /viewBox="0 0 400 900"/);
    assert.ok(!svg.includes("<!--"), "the licence comment stays in the file, not in every picture");
  }
});

test("the picture Claude gets is built from the very same drawing as the app", () => {
  const svg = compositeSvg(withClaudeLayers([]));
  for (const view of VIEWS) assert.ok(svg.includes(figureSvg(view)), view + " drawing missing from the composite");
});

test("ids in the two drawings do not clash when they share one picture", () => {
  const ids = [...compositeSvg(withClaudeLayers([])).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 20);
  assert.equal(new Set(ids).size, ids.length);
});

test("the notice for the About screen names the source and the licence", () => {
  assert.match(FIGURE_NOTICE, /CC BY-SA 4\.0/);
  assert.match(FIGURE_NOTICE, /commons\.wikimedia\.org\/wiki\/File:Muscles_front_and_back\.svg/);
});

test("every named place Claude can mark lies on the drawing, in every view it is on (centre and both ends)", async () => {
  const empty = await renderComposite(withClaudeLayers([]));
  const bg = [0x0f, 0x11, 0x15];
  assert.equal(STAGE_BG, "#0f1115");
  const onBody = (view: "front" | "back", x: number, y: number) => {
    const px = (VIEWS.indexOf(view) * FIG_W + Math.round(x)) + Math.round(y) * empty.width;
    const rgb = [...empty.pixels.slice(px * 4, px * 4 + 3)];
    return rgb.some((c, i) => Math.abs(c - (bg[i] as number)) > 12);
  };
  const off: string[] = [];
  for (const id of REGION_IDS) {
    const strokes = regionStrokes(id);
    assert.ok(Array.isArray(strokes), id);
    for (const s of strokes as { view: "front" | "back"; pts: number[] }[]) {
      const [x1, y1, x2, y2] = s.pts as [number, number, number, number];
      for (const [x, y] of [[x1, y1], [x2, y2], [(x1 + x2) / 2, (y1 + y2) / 2]] as const) if (!onBody(s.view, x, y)) off.push(id + " " + s.view + " (" + x + "," + y + ")");
    }
  }
  assert.deepEqual(off, []);
});

test("left and right are Alex's own sides: his left is on the right of the front picture and the left of the back", () => {
  const x = (id: string, view: "front" | "back") => ((regionStrokes(id, view) as { pts: number[] }[])[0] as { pts: number[] }).pts[0] as number;
  assert.ok(x("left_knee", "front") > FIG_W / 2);
  assert.ok(x("left_knee", "back") < FIG_W / 2);
  assert.ok(x("right_knee", "front") < FIG_W / 2);
});

test("mark colours stand out from the ground and from the drawing's greys", async () => {
  for (const kind of KINDS) {
    const color = KIND_COLOR[kind];
    assert.ok(contrast(color, STAGE_BG) >= 4.5, kind + " on the ground: " + contrast(color, STAGE_BG).toFixed(2));
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const grey of ["#7d8b96", "#d6dfe4"]) {
      const d = Math.hypot(...rgb(color).map((c, i) => c - (rgb(grey)[i] as number)));
      assert.ok(d >= 90, kind + " is too close to the drawing's " + grey + ": " + d.toFixed(0));
    }
  }
  const unique = new Set(KINDS.map((k) => KIND_COLOR[k]));
  assert.equal(unique.size, KINDS.length);
});
