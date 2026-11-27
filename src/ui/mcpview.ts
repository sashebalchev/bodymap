// The MCP App. Runs inside Claude's sandboxed frame: no network, no storage. Everything goes through the host
// as tool calls, to the two app-only tools on the same server.
import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";
import type { Edit, EditReply } from "../types.ts";
import { FIGURE_NOTICE } from "../figure.ts";
import type { Backend, Snapshot } from "./backend.ts";
import { mountUi } from "./core.ts";

declare const __APP_VERSION__: string;

const boot = JSON.parse(atob(document.getElementById("boot")?.textContent ?? "e30=")) as { grant?: string; webUrl?: string | null };
const grant = boot.grant ?? "";

const app = new App({ name: "bodymap", version: "0.1.0" }, {});

function applyHost(): void {
  const context = app.getHostContext();
  const inset = context?.safeAreaInsets;
  if (inset) for (const side of ["top", "right", "bottom", "left"] as const) document.documentElement.style.setProperty("--host-" + side, inset[side] + "px");
}
app.onhostcontextchanged = applyHost;

async function tool(name: string, args: Record<string, unknown>) {
  const result = await app.callServerTool({ name, arguments: { grant, ...args } });
  if (result.isError) throw new Error("The server refused the call. Close this and ask Claude to show the body map again.");
  return result.structuredContent as Record<string, unknown>;
}

const backend: Backend = {
  fallbackHint: boot.webUrl ? "If this keeps failing, use the web page: " + boot.webUrl : "If this keeps failing, use the web page on your home server.",
  async load(): Promise<Snapshot> {
    const out = (await tool("body_map_state", {})) as { state: Snapshot["state"]; claudeMaxLevel: number };
    return { state: out.state, claudeMaxLevel: out.claudeMaxLevel };
  },
  async edit(base: number, edit: Edit): Promise<EditReply> {
    return (await tool("body_map_edit", { base, edit })) as unknown as EditReply;
  },
};

// Handlers go in before connect, so no early message is missed.
app.ontoolresult = () => {};
await app.connect();
applyHost();
mountUi(document.getElementById("app") as HTMLElement, backend, { version: __APP_VERSION__, notice: FIGURE_NOTICE });
