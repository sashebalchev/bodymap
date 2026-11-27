// Server-side picture for Claude: front and back side by side, only layers above 0, each at opacity level / 10.
// SVG built here, rasterised by resvg compiled to WebAssembly: no native module, so no per-architecture
// binary to package, and no font (the badge numbers are drawn as strokes).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { figureSvg, layerSvg, STAGE_BG } from "./figure.ts";
import { activeLayers } from "./text.ts";
import { FIG_H, FIG_W, VIEWS, type Layer, type MapState, type View } from "./types.ts";

// Digits on a 6 by 10 grid, drawn as one polyline each.
const DIGITS: Record<string, string> = {
  "0": "M0 0H6V10H0Z", "1": "M1 2L3 0V10", "2": "M0 0H6V5H0V10H6", "3": "M0 0H6V10H0M0 5H6", "4": "M0 0V5H6M6 0V10",
  "5": "M6 0H0V5H6V10H0", "6": "M6 0H0V10H6V5H0", "7": "M0 0H6L2 10", "8": "M0 0H6V10H0ZM0 5H6", "9": "M6 5H0V0H6V10H0",
};

function badge(n: number, x: number, y: number): string {
  const text = String(n);
  const scale = 1.6, glyphW = 6 * scale, gap = 3;
  const width = text.length * glyphW + (text.length - 1) * gap;
  const glyphs = [...text].map((ch, i) => `<path d="${DIGITS[ch] ?? ""}" transform="translate(${(i * (glyphW + gap)).toFixed(1)} 0) scale(${scale})"/>`).join("");
  return (
    `<g data-badge="${n}"><circle cx="${x}" cy="${y}" r="${Math.max(14, width / 2 + 7)}" fill="#fff" stroke="#0f1115" stroke-width="2.5"/>` +
    `<g transform="translate(${(x - width / 2).toFixed(1)} ${(y - 6.5 * scale).toFixed(1)})" fill="none" stroke="#222" stroke-width="2.2" vector-effect="non-scaling-stroke">${glyphs}</g></g>`
  );
}

function centre(layer: Layer, view: View): [number, number] | null {
  const pts = layer.strokes.filter((s) => s.view === view).flatMap((s) => s.pts);
  if (pts.length === 0) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i + 1 < pts.length; i += 2) { sx += pts[i] ?? 0; sy += pts[i + 1] ?? 0; }
  const n = pts.length / 2;
  return [Math.round(sx / n), Math.round(sy / n)];
}

/** The composite as SVG: pure, so the laws about it can be tested without rasterising. */
export function compositeSvg(state: MapState): string {
  const active = activeLayers(state);
  const panels = VIEWS.map((view, i) => {
    const marks = active.map((l) => layerSvg(l, view)).join("");
    const badges = active.map((l, idx) => { const c = centre(l, view); return c ? badge(idx + 1, c[0], c[1]) : ""; }).join("");
    return `<g transform="translate(${i * FIG_W} 0)" data-view="${view}"><rect width="${FIG_W}" height="${FIG_H}" fill="${STAGE_BG}"/>${figureSvg(view)}${marks}${badges}</g>`;
  });
  const divider = `<line x1="${FIG_W}" y1="0" x2="${FIG_W}" y2="${FIG_H}" stroke="#2a303b" stroke-width="2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FIG_W * 2}" height="${FIG_H}" viewBox="0 0 ${FIG_W * 2} ${FIG_H}">${panels.join("")}${divider}</svg>`;
}

let ready: Promise<void> | undefined;
function init(): Promise<void> {
  ready ??= (async () => {
    const wasm = createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
    await initWasm(await readFile(wasm));
  })();
  return ready;
}

export type Rendered = { png: Uint8Array; width: number; height: number; pixels: Uint8Array };

export async function renderComposite(state: MapState): Promise<Rendered> {
  await init();
  const image = new Resvg(compositeSvg(state)).render();
  return { png: image.asPng(), width: image.width, height: image.height, pixels: image.pixels };
}
