// The rough man. One source for the browser and the server's PNG, so they cannot drift apart.
import { FIG_H, FIG_W, KIND_COLOR, type Layer, type Stroke, type View } from "./types.ts";

const OUTLINE = "#5b6770";
const FILL = "#e6eaed";
const DETAIL = "#9aa5ad";

type Limb = [x1: number, y1: number, x2: number, y2: number, width: number];
const mirror = (x: number) => FIG_W - x;

const LIMBS: Limb[] = [
  [200, 120, 200, 165, 34],
  [118, 195, 88, 330, 42],
  [mirror(118), 195, mirror(88), 330, 42],
  [88, 330, 72, 470, 36],
  [mirror(88), 330, mirror(72), 470, 36],
  [165, 510, 160, 700, 66],
  [mirror(165), 510, mirror(160), 700, 66],
  [160, 700, 158, 850, 50],
  [mirror(160), 700, mirror(158), 850, 50],
];
const TORSO = "118,170 282,170 268,330 258,430 272,520 128,520 142,430 132,330";
const HANDS: [number, number][] = [[68, 490], [mirror(68), 490]];
const FEET: [number, number][] = [[150, 872], [mirror(150), 872]];

function silhouette(): string {
  const parts: string[] = [];
  for (const [pass, color, grow] of [["outline", OUTLINE, 8], ["fill", FILL, 0]] as const) {
    const l = LIMBS.map(([a, b, c, d, w]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke-width="${w + grow}"/>`).join("");
    const t = `<polygon points="${TORSO}" stroke-width="${grow || 2}" stroke-linejoin="round"/>`;
    const h = `<circle cx="200" cy="78" r="${46 + grow / 2}" stroke-width="0"/>`;
    const hands = HANDS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${20 + grow / 2}" stroke-width="0"/>`).join("");
    const feet = FEET.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="${32 + grow / 2}" ry="${14 + grow / 2}" stroke-width="0"/>`).join("");
    parts.push(`<g data-pass="${pass}" fill="${color}" stroke="${color}" stroke-linecap="round">${l}${t}${h}${hands}${feet}</g>`);
  }
  return parts.join("");
}

function details(view: View): string {
  const style = `fill="none" stroke="${DETAIL}" stroke-width="3" stroke-linecap="round"`;
  if (view === "front") {
    return `<path d="M178 168 Q200 188 222 168" ${style}/><circle cx="200" cy="420" r="4" fill="${DETAIL}"/>`;
  }
  return (
    `<path d="M200 165 L200 520" ${style} stroke-dasharray="10 8"/>` +
    `<path d="M150 215 Q145 280 185 290" ${style}/><path d="M250 215 Q255 280 215 290" ${style}/>`
  );
}

/** The empty outline for one view, in figure units (0..400 by 0..900). */
export function figureSvg(view: View): string {
  return silhouette() + details(view);
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
