// The edge: everything that arrives from a client is parsed here before the domain sees it.
import * as z from "zod/v4";
import { KINDS, LIMITS, VIEWS, FIG_H, FIG_W, type Edit } from "./types.ts";

export const KindSchema = z.enum(KINDS);
export const ViewSchema = z.enum(VIEWS);
const Name = z.string().trim().min(1).max(LIMITS.maxNameLength);
const Level = z.int().min(0).max(LIMITS.maxLevel);
const LayerId = z.string().min(1).max(40);

export const StrokeSchema = z.object({
  view: ViewSchema,
  r: z.int().min(LIMITS.minBrush).max(LIMITS.maxBrush),
  pts: z
    .array(z.int().min(0).max(Math.max(FIG_W, FIG_H)))
    .min(2)
    .max(LIMITS.maxPointsPerStroke * 2)
    .refine((p) => p.length % 2 === 0, "pts needs an x and a y for every point"),
});

export const EditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_layer"), name: Name, kind: KindSchema, level: Level, strokes: z.array(StrokeSchema).max(LIMITS.maxStrokesPerLayer).optional() }),
  z.object({ op: z.literal("add_stroke"), layerId: LayerId, stroke: StrokeSchema }),
  z.object({ op: z.literal("remove_last_stroke"), layerId: LayerId }),
  z.object({ op: z.literal("set_level"), layerId: LayerId, level: Level }),
  z.object({ op: z.literal("rename"), layerId: LayerId, name: Name }),
  z.object({ op: z.literal("set_kind"), layerId: LayerId, kind: KindSchema }),
  z.object({ op: z.literal("delete_layer"), layerId: LayerId }),
]);
// The parsed shape must be exactly the shared Edit type the front ends send.
export const _editMatchesType: (e: z.infer<typeof EditSchema>) => Edit = (e) => e;

export const ClaudeAddSchema = z.object({
  name: Name,
  kind: KindSchema,
  level: z.int().min(1).max(LIMITS.maxLevel).optional(),
});

/** The shape of the saved file. A file that does not parse is never overwritten. */
export const StoredLayerSchema = z.object({
  id: LayerId,
  name: Name,
  kind: KindSchema,
  level: Level,
  strokes: z.array(StrokeSchema),
  by: z.enum(["alex", "claude"]),
  createdAt: z.string(),
  activeSince: z.string().nullable(),
  clearedAt: z.string().nullable(),
  rev: z.int().min(0),
});
export const StoredStateSchema = z.object({
  version: z.literal(1),
  revision: z.int().min(0),
  updatedAt: z.string(),
  layers: z.array(StoredLayerSchema),
});
