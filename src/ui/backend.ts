// What the interface needs from the outside, and nothing else. The MCP App, the web page and the Android app each give
// the interface one of these. The interface never learns which one it has.
import type { Edit, EditReply, MapState } from "../types.ts";

export type Snapshot = { state: MapState; claudeMaxLevel: number };

/** Server address and token, kept by the Android app. Only a backend that has to ask for them offers this. */
export type Setup = {
  /** The saved address, or null before the first setup. */
  server: string | null;
  /** Validate the address, then remember it and the token. Nothing is sent to the server yet. */
  connect(server: string, token: string): Promise<void>;
  /** Forget the token. The address stays, so the next setup only asks for the token. */
  forget(): Promise<void>;
};

export type Backend = {
  load(): Promise<Snapshot>;
  edit(base: number, edit: Edit): Promise<EditReply>;
  /** Where to send Alex when this surface cannot load or save. */
  fallbackHint?: string;
  /** The web page asks for a token; the MCP App never does. */
  setToken?(token: string): void;
  /** The Android app asks for an address and a token. */
  setup?: Setup;
};

export class NeedsToken extends Error {}

// ---- the HTTP backend shared by the web page and the Android app -------------------------------------------------

export type HttpRequest = { url: string; method: "GET" | "POST"; token: string; body?: unknown };
export type HttpResponse = { status: number; body: unknown };
/** The web page uses fetch. The Android app uses the native HTTP plugin, so there is no CORS and no mixed content. */
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function apiBackend(options: { base: () => string; token: () => string | null; transport: Transport }): Pick<Backend, "load" | "edit"> {
  const call = async (path: string, method: "GET" | "POST", body?: unknown): Promise<HttpResponse> => {
    const token = options.token();
    if (!token) throw new NeedsToken("");
    const reply = await options.transport({ url: options.base() + path, method, token, body });
    if (reply.status === 401) throw new NeedsToken("That token was not accepted. Paste it again.");
    return reply;
  };
  return {
    async load() {
      const reply = await call("api/state", "GET");
      const b = reply.body;
      if (reply.status !== 200 || !isRecord(b) || !isRecord(b["state"]) || !Array.isArray(b["state"]["layers"])) {
        throw new Error(reply.status === 200 ? "That address does not answer like a body map server." : "The server answered " + reply.status + ".");
      }
      return b as unknown as Snapshot;
    },
    async edit(base, edit) {
      const reply = await call("api/edit", "POST", { base, edit });
      const b = reply.body;
      if (isRecord(b) && "ok" in b && isRecord(b["state"])) return b as unknown as EditReply;
      throw new Error(isRecord(b) && typeof b["message"] === "string" ? b["message"] : "The server answered " + reply.status + ".");
    },
  };
}

// ---- the address and the setup link -----------------------------------------------------------------------------

/** What Alex typed, made into a base URL that ends in a slash. Throws an Error that says what is wrong. */
export function normalizeServerUrl(input: string): string {
  let text = input.trim();
  if (!text) throw new Error("Enter the server address.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error("That is not a web address."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The address must start with https://");
  if (!url.hostname) throw new Error("That is not a web address.");
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

/** bodymap://setup?server=...&token=... gives the two fields. Anything else gives null. */
export function parseSetupLink(link: string): { server: string; token: string } | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== "bodymap:" || url.hostname !== "setup") return null;
  const server = url.searchParams.get("server");
  const token = url.searchParams.get("token");
  return server || token ? { server: server ?? "", token: token ?? "" } : null;
}
