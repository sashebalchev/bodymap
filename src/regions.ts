// Named places on the body drawing, so Claude can put a mark on the picture from words alone.
// "left" and "right" are Alex's own sides. In the front view his left is on the right of the picture;
// in the back view it is on the left.
// The numbers were read off assets/figure/front.svg and back.svg (400 by 900 units). The two views are not the same
// shape (the back view's arms hang lower), so a place can carry its own numbers for the back view. A test checks that
// every place, in every view it is on, lies on the drawing and not on the empty ground.
import { FIG_W, type Stroke, type View } from "./types.ts";

type Place = { ox: number; cy: number; rx: number; ry: number; lean: number };
type Spec = { views: readonly View[]; sided: boolean; front: Place; back?: Partial<Place> };

const BOTH = ["front", "back"] as const;
const p = (ox: number, cy: number, rx: number, ry: number, lean = 0): Place => ({ ox, cy, rx, ry, lean });
const SPECS: Record<string, Spec> = {
  head: { views: BOTH, sided: false, front: p(0, 146, 28, 38), back: { cy: 143 } },
  neck: { views: BOTH, sided: false, front: p(0, 207, 22, 18) },
  shoulder: { views: BOTH, sided: true, front: p(84, 262, 32, 32), back: { ox: 68, cy: 283 } },
  upper_arm: { views: BOTH, sided: true, front: p(92, 335, 20, 45), back: { ox: 84, cy: 345, ry: 40 } },
  elbow: { views: BOTH, sided: true, front: p(106, 392, 20, 18), back: { ox: 94, cy: 372 } },
  forearm: { views: BOTH, sided: true, front: p(133, 425, 14, 32, 11), back: { ox: 113, cy: 425, ry: 38, lean: 12 } },
  hand: { views: BOTH, sided: true, front: p(152, 497, 16, 28, 8), back: { ox: 142, cy: 487 } },
  chest: { views: ["front"], sided: false, front: p(0, 282, 82, 38) },
  abdomen: { views: ["front"], sided: false, front: p(0, 388, 52, 62) },
  upper_back: { views: ["back"], sided: false, front: p(0, 270, 70, 38) },
  mid_back: { views: ["back"], sided: false, front: p(0, 340, 62, 30) },
  lower_back: { views: ["back"], sided: false, front: p(0, 392, 56, 28) },
  glutes: { views: ["back"], sided: false, front: p(0, 440, 62, 34) },
  hip: { views: BOTH, sided: true, front: p(58, 436, 26, 26), back: { ox: 52, cy: 420, rx: 22, ry: 22 } },
  thigh: { views: BOTH, sided: true, front: p(35, 520, 28, 60), back: { ox: 30, cy: 528, ry: 50 } },
  knee: { views: BOTH, sided: true, front: p(30, 592, 20, 20), back: { ox: 28, cy: 580 } },
  lower_leg: { views: BOTH, sided: true, front: p(31, 655, 20, 52), back: { ox: 30, cy: 645, ry: 55 } },
  foot: { views: BOTH, sided: true, front: p(29, 752, 20, 42), back: { cy: 770, ry: 25 } },
};

type Region = { views: readonly View[]; place: (view: View) => { cx: number; cy: number; rx: number; ry: number; lean: number } };

function build(): Record<string, Region> {
  const out: Record<string, Region> = {};
  for (const [name, spec] of Object.entries(SPECS)) {
    const sides: (string | null)[] = spec.sided ? ["left", "right"] : [null];
    for (const side of sides) {
      const id = side ? side + "_" + name : name;
      out[id] = {
        views: spec.views,
        place: (view) => {
          const q = view === "back" ? { ...spec.front, ...spec.back } : spec.front;
          // Alex's left is on the viewer's right in the front view, on the viewer's left in the back view.
          const toRight = (side === "left") === (view === "front");
          const dx = side === null ? 0 : toRight ? q.ox : -q.ox;
          return { cx: FIG_W / 2 + dx, cy: q.cy, rx: q.rx, ry: q.ry, lean: toRight ? q.lean : -q.lean };
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
    const { cx, cy, rx, ry, lean } = region.place(v);
    const slack = Math.abs(rx - ry);
    const r = Math.min(rx, ry);
    // A limb that hangs at a slant: the lower end leans outward from the middle of the body.
    const pts = rx >= ry ? [cx - slack, cy, cx + slack, cy] : [cx - lean, cy - slack, cx + lean, cy + slack];
    return { view: v, r, pts: pts.map(Math.round) };
  });
}
