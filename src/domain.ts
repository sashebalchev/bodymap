// The rules. Pure functions: a state and a request in, a new state or a refusal out.
//
// The laws live here:
//   1. Only an Edit lowers a level or deletes a layer, and Edits come only from Alex's interface.
//   2. claudeAddLayer can only create. It never changes a layer that exists, cleared or not.
//   3. A level written by Claude is capped.
//   4. A change to a layer is refused when the sender's view of it is older than the layer.
import { randomBytes } from "node:crypto";
import { LIMITS, type Edit, type EditReply, type Kind, type Layer, type MapState, type Stroke, type View } from "./types.ts";
import { regionStrokes } from "./regions.ts";

export function emptyState(now: Date): MapState {
  return { version: 1, revision: 0, updatedAt: now.toISOString(), layers: [] };
}

const newId = () => "l_" + randomBytes(5).toString("hex");
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function bump(state: MapState, now: Date, change: (layers: Layer[], rev: number) => Layer[]): MapState {
  const revision = state.revision + 1;
  return { ...state, revision, updatedAt: now.toISOString(), layers: change(state.layers, revision) };
}

function refuse(state: MapState, error: Exclude<EditReply, { ok: true }>["error"], message: string): EditReply {
  return { ok: false, error, message, state };
}

function withLevel(layer: Layer, level: number, now: Date): Pick<Layer, "level" | "activeSince" | "clearedAt"> {
  if (level === layer.level) return layer;
  if (level === 0) return { level, activeSince: null, clearedAt: now.toISOString() };
  if (layer.level === 0) return { level, activeSince: now.toISOString(), clearedAt: null };
  return { level, activeSince: layer.activeSince, clearedAt: null };
}

function newLayer(name: string, kind: Kind, level: number, strokes: Stroke[], by: Layer["by"], now: Date, rev: number): Layer {
  const iso = now.toISOString();
  return { id: newId(), name: name.trim(), kind, level, strokes, by, createdAt: iso, activeSince: level > 0 ? iso : null, clearedAt: level > 0 ? null : iso, rev };
}

/** Alex's interface. base is the revision the screen was showing when he acted. */
export function applyEdit(state: MapState, edit: Edit, base: number, now: Date): EditReply {
  if (edit.op === "add_layer") {
    if (state.layers.length >= LIMITS.maxLayers) return refuse(state, "limit", "At most " + LIMITS.maxLayers + " layers. Delete one you no longer need.");
    if (state.layers.some((l) => sameName(l.name, edit.name))) return refuse(state, "invalid", "A layer called " + edit.name.trim() + " already exists.");
    const next = bump(state, now, (layers, rev) => [...layers, newLayer(edit.name, edit.kind, edit.level, edit.strokes ?? [], "alex", now, rev)]);
    return { ok: true, state: next, layerId: next.layers[next.layers.length - 1]?.id };
  }

  const target = state.layers.find((l) => l.id === edit.layerId);
  if (!target) return refuse(state, "not_found", "That layer is gone. The screen was out of date.");
  if (target.rev > base) return refuse(state, "conflict", "This layer changed since the screen last loaded.");

  const replace = (change: (l: Layer, rev: number) => Layer | null): EditReply => {
    const next = bump(state, now, (layers, rev) => layers.flatMap((l) => (l.id === target.id ? (change(l, rev) ?? []) : [l])));
    return { ok: true, state: next, layerId: target.id };
  };

  switch (edit.op) {
    case "add_stroke":
      if (target.strokes.length >= LIMITS.maxStrokesPerLayer) return refuse(state, "limit", "This layer has the most strokes it can hold.");
      return replace((l, rev) => ({ ...l, strokes: [...l.strokes, edit.stroke], rev }));
    case "remove_last_stroke":
      if (target.strokes.length === 0) return refuse(state, "invalid", "Nothing to undo on this layer.");
      return replace((l, rev) => ({ ...l, strokes: l.strokes.slice(0, -1), rev }));
    case "set_level":
      if (edit.level === target.level) return { ok: true, state, layerId: target.id };
      return replace((l, rev) => ({ ...l, ...withLevel(l, edit.level, now), rev }));
    case "rename":
      if (state.layers.some((l) => l.id !== target.id && sameName(l.name, edit.name))) return refuse(state, "invalid", "A layer called " + edit.name.trim() + " already exists.");
      return replace((l, rev) => ({ ...l, name: edit.name.trim(), rev }));
    case "set_kind":
      return replace((l, rev) => ({ ...l, kind: edit.kind, rev }));
    case "delete_layer":
      return replace(() => null);
  }
}

export type ClaudeAddInput = { name: string; kind: Kind; level?: number; region?: string; view?: View };
export type ClaudeAddResult =
  | { ok: true; state: MapState; layer: Layer; note: string }
  | { ok: false; state: MapState; message: string };

/**
 * Claude's only write. It creates a layer, at most at the cap, optionally with a mark on a named region.
 * A layer with the same name that already exists, cleared or not, is left exactly as it is.
 */
export function claudeAddLayer(state: MapState, input: ClaudeAddInput, cap: number, now: Date): ClaudeAddResult {
  const existing = state.layers.find((l) => sameName(l.name, input.name));
  if (existing) {
    const where = existing.level === 0 ? "cleared by Alex" : "at level " + existing.level;
    return { ok: false, state, message: "A layer called " + existing.name + " already exists (" + where + "). Nothing was changed. Only Alex changes an existing layer." };
  }
  if (state.layers.length >= LIMITS.maxLayers) return { ok: false, state, message: "The map holds " + LIMITS.maxLayers + " layers already. Nothing was added." };

  let strokes: Stroke[] = [];
  if (input.region) {
    const placed = regionStrokes(input.region, input.view);
    if ("error" in placed) return { ok: false, state, message: placed.error };
    strokes = placed;
  }
  const wanted = input.level ?? Math.min(3, cap);
  const level = Math.max(1, Math.min(wanted, cap));
  const note = wanted > cap ? "Level capped at " + cap + " (Alex can raise it). " : "";
  const next = bump(state, now, (layers, rev) => [...layers, newLayer(input.name, input.kind, level, strokes, "claude", now, rev)]);
  const layer = next.layers[next.layers.length - 1] as Layer;
  return { ok: true, state: next, layer, note };
}
