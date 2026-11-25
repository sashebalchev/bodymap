// What Claude reads next to the picture. The numbers match the badges drawn on the picture.
import type { Layer, MapState } from "./types.ts";

export const activeLayers = (state: MapState): Layer[] => state.layers.filter((l) => l.level > 0);

function ago(iso: string | null, now: Date): string {
  if (!iso) return "unknown";
  const hours = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 3_600_000);
  const date = iso.slice(0, 10);
  if (hours < 1) return date + " (under an hour)";
  if (hours < 48) return date + " (" + Math.round(hours) + " h)";
  return date + " (" + Math.round(hours / 24) + " days)";
}

export function describe(state: MapState, now: Date): string {
  const active = activeLayers(state);
  const cleared = state.layers.filter((l) => l.level === 0);
  const lines = ["Body map, revision " + state.revision + ", updated " + state.updatedAt.slice(0, 16).replace("T", " ") + " UTC."];
  lines.push("Left and right are Alex's own sides. In the picture, the left half is the front view and the right half the back view.");
  if (active.length === 0) {
    lines.push("No active layers: Alex has nothing marked right now.");
  } else {
    lines.push("Active layers (" + active.length + "). Opacity in the picture is level / 10. The number matches the badge on the picture.");
    active.forEach((l, i) => {
      const views = [...new Set(l.strokes.map((s) => s.view))];
      const marks = views.length ? "marked on " + views.join(" and ") : "no mark painted yet";
      lines.push(`${i + 1}. ${l.name} | ${l.kind} | level ${l.level}/10 | since ${ago(l.activeSince, now)} | added by ${l.by === "claude" ? "Claude" : "Alex"} | ${marks}`);
    });
  }
  if (cleared.length) {
    lines.push("Cleared by Alex (not active, not in the picture): " + cleared.map((l) => l.name + " (" + l.kind + ", cleared " + ago(l.clearedAt, now) + ")").join("; ") + ".");
  }
  return lines.join("\n");
}
