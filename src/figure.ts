// The body drawing and the marks on it. One source for the phone app, the web page, the MCP view and the server's PNG,
// so they cannot drift apart. The drawing itself is assets/figure/front.svg and back.svg (CC BY-SA 4.0, see
// assets/figure/NOTICE.md). scripts/build.mjs inlines both files into src/figure-assets.ts with esbuild's text loader,
// so nothing here reads a file at runtime.
import { FIGURE_BACK, FIGURE_FRONT, FIGURE_NOTICE } from "./figure-assets.ts";
import { FIG_H, FIG_W, KIND_COLOR, type Layer, type Stroke, type View } from "./types.ts";

export { FIGURE_NOTICE };

/** The ground the figure stands on, in the app and in the picture Claude gets. */
export const STAGE_BG = "#0f1115";

// The files carry a licence comment and no width or height. A nested svg without a size fills its parent, which would be
// wrong inside the side by side picture, so it gets the drawing space's size.
const sized = (svg: string): string => svg.replace(/<!--[\s\S]*?-->/g, "").trim().replace("<svg ", `<svg width="${FIG_W}" height="${FIG_H}" `);
const DRAWINGS: Record<View, string> = { front: sized(FIGURE_FRONT), back: sized(FIGURE_BACK) };

/** The empty drawing for one view, in figure units (0..400 by 0..900). */
export function figureSvg(view: View): string {
  return DRAWINGS[view];
}

const f = (n: number) => String(Math.round(n));

/** SVG path data for a stroke: a dot for one point, a round-capped polyline otherwise. */
export function strokeSvg(s: Stroke, color: string): string {
  const p = s.pts;
  if (p.length < 2) return "";
  const onePoint = p.length === 2 || p.every((v, i) => v === p[i % 2]);
  if (onePoint) return `<circle cx="${f(p[0] ?? 0)}" cy="${f(p[1] ?? 0)}" r="${f(s.r)}" fill="${color}"/>`;
  let d = "M" + f(p[0] ?? 0) + " " + f(p[1] ?? 0);
  for (let i = 2; i + 1 < p.length; i += 2) d += "L" + f(p[i] ?? 0) + " " + f(p[i + 1] ?? 0);
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(s.r * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** One active layer's marks in one view. The group carries the opacity so crossings inside a layer do not darken. */
export function layerSvg(layer: Layer, view: View): string {
  const marks = layer.strokes.filter((s) => s.view === view).map((s) => strokeSvg(s, KIND_COLOR[layer.kind])).join("");
  if (!marks) return "";
  return `<g data-layer="${layer.id}" opacity="${layer.level / 10}">${marks}</g>`;
}

export const figureBounds = { width: FIG_W, height: FIG_H };
