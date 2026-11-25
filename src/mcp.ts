// The agent door: MCP over HTTP, stateless. Claude sees show_body_map, get_body_map and add_layer.
// The picture opens as an MCP App (ui:// resource). Its two app-only tools are how the app talks back.
import { createHmac } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";
import { ClaudeAddSchema, EditSchema, ViewSchema } from "./schemas.ts";
import { REGION_IDS } from "./regions.ts";
import { renderComposite } from "./render.ts";
import { describe } from "./text.ts";
import type { BodyMap } from "./service.ts";
import { KINDS } from "./types.ts";

export const VIEW_URI = "ui://bodymap/view.html";

/**
 * A second lock on the app-only tools. It is derived from the web token, so it cannot be turned back into it,
 * and it is only ever written into the app's own HTML. It keeps a model that guesses a hidden tool name out.
 * It is not a boundary against the host, which holds the HTML.
 */
export const appGrant = (uiToken: string): string => createHmac("sha256", uiToken).update("bodymap-mcp-app-v1").digest("hex").slice(0, 32);

export type McpDeps = { map: BodyMap; grant: string; viewHtml: () => string; webUrl: string | undefined };

const text = (t: string) => ({ type: "text" as const, text: t });

function build(deps: McpDeps): McpServer {
  const { map } = deps;
  const server = new McpServer(
    { name: "bodymap", version: "0.1.0" },
    {
      instructions:
        "Alex's body map: where he feels tension, pinching or pain, painted on a front and back outline. " +
        "Read it with get_body_map before you plan any session. Every layer above 0 is something to train around. " +
        "You can add a layer from words with add_layer. You cannot lower, clear or delete a layer: only Alex does that, in the app.",
    },
  );

  registerAppResource(server, "Body map", VIEW_URI, { description: "Interactive front and back body outline Alex paints on." }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: deps.viewHtml(), _meta: { ui: { prefersBorder: false } } }],
  }));

  registerAppTool(
    server,
    "show_body_map",
    {
      title: "Show the body map",
      description:
        "Open the body map for Alex so he can paint marks, move sliders and name layers. Call it when he wants to mark something or look at the map. " +
        "Afterwards call get_body_map to see what he marked.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async () => ({ content: [text("The body map is open for Alex. Current state:\n" + describe(map.state, map.now))] }),
  );

  registerAppTool(
    server,
    "get_body_map",
    {
      title: "Read the body map",
      description:
        "The body map as a picture (front on the left, back on the right, only layers above 0, opacity = level / 10) and a text list " +
        "with name, kind (tense, pinched, sharp), level and since when. Read it before planning a session.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async () => {
      const state = map.state;
      const picture = await renderComposite(state);
      return {
        content: [
          { type: "image" as const, data: Buffer.from(picture.png).toString("base64"), mimeType: "image/png" },
          text(describe(state, map.now)),
        ],
      };
    },
  );

  registerAppTool(
    server,
    "add_layer",
    {
      title: "Add a body map layer",
      description:
        "Add a new layer from words, e.g. name \"Left shoulder\", kind pinched, region left_shoulder. " +
        "Only adds: it never changes, lowers, clears or deletes an existing layer, and a name that exists is refused. " +
        `The level is capped at ${map.claudeMaxLevel} (Alex can raise it). left and right are Alex's own sides. Region puts a mark on the picture; leave it out when unsure.`,
      inputSchema: ClaudeAddSchema.extend({
        region: z.enum(REGION_IDS).optional().describe("Named place on the body, e.g. left_shoulder, lower_back, right_knee."),
        view: ViewSchema.optional().describe("Only front or only back. Leave out to mark every view the region is on."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input) => {
      const result = await map.claudeAdd(input);
      if (!result.ok) return { isError: true, content: [text(result.message)] };
      const placed = result.layer.strokes.length ? "Marked on the " + [...new Set(result.layer.strokes.map((s) => s.view))].join(" and ") + " view." : "No mark on the picture yet: Alex can paint it.";
      return { content: [text(`Added "${result.layer.name}" (${result.layer.kind}) at level ${result.layer.level}/10. ${result.note}${placed} Revision ${result.state.revision}.`)] };
    },
  );

  const Grant = z.object({ grant: z.string().max(64) });
  const denied = { isError: true as const, content: [text("This tool belongs to the body map app. Use show_body_map.")] };

  registerAppTool(
    server,
    "body_map_state",
    {
      title: "Body map app: read state",
      description: "For the body map app only. Returns the full map including strokes.",
      inputSchema: Grant,
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ grant }) => {
      if (grant !== deps.grant) return denied;
      const state = map.state;
      return { content: [text("ok")], structuredContent: { state, claudeMaxLevel: map.claudeMaxLevel, webUrl: deps.webUrl ?? null } };
    },
  );

  registerAppTool(
    server,
    "body_map_edit",
    {
      title: "Body map app: edit",
      description: "For the body map app only. Alex's changes: paint, level, rename, kind, undo, delete.",
      inputSchema: Grant.extend({ base: z.int().min(0), edit: EditSchema }),
      annotations: { readOnlyHint: false, destructiveHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ grant, base, edit }) => {
      if (grant !== deps.grant) return denied;
      const reply = await map.edit(base, edit);
      return { content: [text(reply.ok ? "ok" : reply.error)], structuredContent: reply };
    },
  );

  return server;
}

export const createMcp = (deps: McpDeps) => createMcpHandler(() => build(deps));
export { KINDS };
