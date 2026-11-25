// Named places on the rough outline, so Claude can put a mark on the picture from words alone.
// "left" and "right" are Alex's own sides. In the front view his left is on the right of the picture;
// in the back view it is on the left.
import { FIG_W, type Stroke, type View } from "./types.ts";

type Spec = { views: readonly View[]; sided: boolean; ox: number; cy: number; rx: number; ry: number };

const BOTH = ["front", "back"] as const;
const SPECS: Record<string, Spec> = {
  head: { views: BOTH, sided: false, ox: 0, cy: 80, rx: 42, ry: 46 },
  neck: { views: BOTH, sided: false, ox: 0, cy: 148, rx: 20, ry: 24 },
  shoulder: { views: BOTH, sided: true, ox: 92, cy: 200, rx: 34, ry: 30 },
  upper_arm: { views: BOTH, sided: true, ox: 97, cy: 262, rx: 24, ry: 62 },
  elbow: { views: BOTH, sided: true, ox: 100, cy: 332, rx: 24, ry: 22 },
  forearm: { views: BOTH, sided: true, ox: 120, cy: 400, rx: 20, ry: 62 },
  hand: { views: BOTH, sided: true, ox: 130, cy: 490, rx: 22, ry: 24 },
  chest: { views: ["front"], sided: false, ox: 0, cy: 245, rx: 78, ry: 46 },
  abdomen: { views: ["front"], sided: false, ox: 0, cy: 390, rx: 64, ry: 60 },
  upper_back: { views: ["back"], sided: false, ox: 0, cy: 235, rx: 80, ry: 48 },
  mid_back: { views: ["back"], sided: false, ox: 0, cy: 330, rx: 62, ry: 40 },
  lower_back: { views: ["back"], sided: false, ox: 0, cy: 430, rx: 64, ry: 40 },
  glutes: { views: ["back"], sided: false, ox: 0, cy: 500, rx: 80, ry: 30 },
  hip: { views: BOTH, sided: true, ox: 66, cy: 510, rx: 34, ry: 30 },
  thigh: { views: BOTH, sided: true, ox: 40, cy: 610, rx: 30, ry: 90 },
  knee: { views: BOTH, sided: true, ox: 40, cy: 700, rx: 30, ry: 28 },
  lower_leg: { views: BOTH, sided: true, ox: 41, cy: 780, rx: 25, ry: 70 },
  foot: { views: BOTH, sided: true, ox: 50, cy: 872, rx: 34, ry: 16 },
};

type Region = { views: readonly View[]; place: (view: View) => { cx: number; cy: number; rx: number; ry: number } };

function build(): Record<string, Region> {
  const out: Record<string, Region> = {};
  for (const [name, spec] of Object.entries(SPECS)) {
    const sides: (string | null)[] = spec.sided ? ["left", "right"] : [null];
    for (const side of sides) {
      const id = side ? side + "_" + name : name;
      out[id] = {
        views: spec.views,
        place: (view) => {
          // Alex's left is on the viewer's right in the front view, on the viewer's left in the back view.
          const toRight = (side === "left") === (view === "front");
          const dx = side === null ? 0 : toRight ? spec.ox : -spec.ox;
          return { cx: FIG_W / 2 + dx, cy: spec.cy, rx: spec.rx, ry: spec.ry };
        },
      };
    }
  }
  return out;
}

const REGIONS = build();
export const REGION_IDS = Object.keys(REGIONS) as [string, ...string[]];

/** A rounded blob over the region, as one brush stroke per view. view undefined = every view the region is on. */
export function regionStrokes(regionId: string, view?: View): Stroke[] | { error: string } {
  const region = REGIONS[regionId];
  if (!region) return { error: "unknown region " + regionId };
  const views = view ? [view] : region.views;
  if (view && !region.views.includes(view)) return { error: regionId + " is only drawn in the " + region.views.join(" and ") + " view" };
  return views.map((v) => {
    const { cx, cy, rx, ry } = region.place(v);
    const slack = Math.abs(rx - ry);
    const r = Math.min(rx, ry);
    const pts = rx >= ry ? [cx - slack, cy, cx + slack, cy] : [cx, cy - slack, cx, cy + slack];
    return { view: v, r, pts };
  });
}
