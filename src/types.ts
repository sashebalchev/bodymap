// Shapes shared by the server, the renderer and both front ends. No runtime dependencies.

export const KINDS = ["tense", "pinched", "sharp"] as const;
export type Kind = (typeof KINDS)[number];
export const VIEWS = ["front", "back"] as const;
export type View = (typeof VIEWS)[number];

/** Drawing space of one figure, in whole units. The two figures sit side by side in the composite. */
export const FIG_W = 400;
export const FIG_H = 900;

export const LIMITS = {
  maxLayers: 40,
  maxStrokesPerLayer: 300,
  maxPointsPerStroke: 1500,
  maxNameLength: 60,
  minBrush: 4,
  maxBrush: 60,
  maxLevel: 10,
} as const;

/** One brush stroke. pts is a flat list of whole numbers: x0, y0, x1, y1, ... in figure units. */
export type Stroke = { view: View; r: number; pts: number[] };

export type Layer = {
  id: string;
  name: string;
  kind: Kind;
  /** 0 = cleared (hidden, greyed). 1..10 = active, drawn at opacity level / 10. */
  level: number;
  strokes: Stroke[];
  by: "alex" | "claude";
  createdAt: string;
  /** When the level last went from 0 to above 0 (or the layer was made active). Null while cleared. */
  activeSince: string | null;
  /** When the level last went from above 0 to 0. Null while active. */
  clearedAt: string | null;
  /** Revision of the whole map at this layer's last change. Used to detect edit conflicts. */
  rev: number;
};

export type MapState = {
  version: 1;
  revision: number;
  updatedAt: string;
  layers: Layer[];
};

/** Everything the interface can do. Only Alex's interface sends these. */
export type Edit =
  | { op: "add_layer"; name: string; kind: Kind; level: number; strokes?: Stroke[] }
  | { op: "add_stroke"; layerId: string; stroke: Stroke }
  | { op: "remove_last_stroke"; layerId: string }
  | { op: "set_level"; layerId: string; level: number }
  | { op: "rename"; layerId: string; name: string }
  | { op: "set_kind"; layerId: string; kind: Kind }
  | { op: "delete_layer"; layerId: string };

export type EditFailure = "conflict" | "not_found" | "invalid" | "limit";
export type EditReply =
  | { ok: true; state: MapState; layerId?: string }
  | { ok: false; error: EditFailure; message: string; state: MapState };

export const KIND_COLOR: Record<Kind, string> = { tense: "#f59e0b", pinched: "#2563eb", sharp: "#dc2626" };
