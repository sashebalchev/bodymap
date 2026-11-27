// The small pure rules of the interface, kept out of the DOM so they can be tested.
import { LIMITS, type Kind, type Layer, type Stroke, type View } from "../types.ts";
import { simplify } from "./simplify.ts";

export const BRUSHES = [
  { id: "s", label: "S", name: "Small brush", r: 8 },
  { id: "m", label: "M", name: "Medium brush", r: 16 },
  { id: "l", label: "L", name: "Large brush", r: 28 },
] as const;
export const DEFAULT_BRUSH = 16;

export const KIND_LABEL: Record<Kind, string> = { tense: "Tense", pinched: "Pinched", sharp: "Sharp" };

/** A finished drag as the one stroke the server stores: simplified, whole numbers, a dot when it did not move. */
export function strokeFromPoints(view: View, r: number, points: readonly [number, number][]): Stroke {
  let epsilon = 1.5;
  let simple = simplify([...points], epsilon);
  while (simple.length > LIMITS.maxPointsPerStroke) simple = simplify([...points], (epsilon *= 2));
  const flat = simple.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
  return { view, r, pts: flat.length >= 4 ? flat : [...flat.slice(0, 2), ...flat.slice(0, 2)] };
}

export const levelLabel = (level: number): string => (level === 0 ? "cleared" : String(level));

const day = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

/** The grey line under a mark's name. */
export function markMeta(layer: Layer): string {
  if (layer.level === 0) return "Cleared " + day(layer.clearedAt) + ". Slide up to restore.";
  return KIND_LABEL[layer.kind] + ", since " + day(layer.activeSince);
}

/** How many active marks have a stroke on each side, for the Front and Back buttons. */
export function marksPerView(layers: readonly Layer[]): Record<View, number> {
  const count = (v: View) => layers.filter((l) => l.level > 0 && l.strokes.some((s) => s.view === v)).length;
  return { front: count("front"), back: count("back") };
}

/** WCAG relative luminance and contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The part of assets/figure/NOTICE.md meant for the About screen. Falls back to the whole notice rather than show nothing. */
export function attributionText(notice: string): string {
  const lines = notice.split("\n");
  const start = lines.findIndex((l) => /^##\s+Attribution text/i.test(l));
  if (start < 0) return notice.trim();
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).map((l) => l.replace(/^>\s?/, "")).join("\n").trim();
}
