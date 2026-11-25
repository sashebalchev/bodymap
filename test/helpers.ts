import { claudeAddLayer, emptyState } from "../src/domain.ts";
import type { Kind, MapState } from "../src/types.ts";

export const T0 = new Date("2026-11-24T10:00:00Z");
export const T1 = new Date("2026-11-25T10:00:00Z");

export function withClaudeLayers(specs: { name: string; kind?: Kind; region?: string; level?: number }[], cap = 10): MapState {
  let state = emptyState(T0);
  for (const spec of specs) {
    const r = claudeAddLayer(state, { name: spec.name, kind: spec.kind ?? "tense", region: spec.region, level: spec.level }, cap, T0);
    if (!r.ok) throw new Error(r.message);
    state = r.state;
  }
  return state;
}
