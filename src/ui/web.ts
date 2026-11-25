// The plain web page. Same interface, talks to api/ (relative) with the token Alex pasted once.
import type { Edit, EditReply } from "../types.ts";
import { mountUi, NeedsToken, type Backend, type Snapshot } from "./core.ts";

const KEY = "bodymap.token";
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* private mode: the token lasts until the page closes */ } },
};
let memory: string | null = null;

// The proxy may serve this page under a prefix (/bodymap/) and strip it. Every URL here is relative, so it follows the page.
// A page opened as /bodymap (no slash) would resolve "api/state" to /api/state: give it its slash first.
if (!location.pathname.endsWith("/")) history.replaceState(null, "", location.pathname + "/" + location.search + location.hash);

const fromHash = new URLSearchParams(location.hash.slice(1)).get("token");
if (fromHash) {
  memory = fromHash;
  store.set(fromHash);
  history.replaceState(null, "", location.pathname);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = memory ?? store.get();
  if (!token) throw new NeedsToken("");
  const response = await fetch(path, { ...init, headers: { authorization: "Bearer " + token, "content-type": "application/json" } });
  if (response.status === 401) throw new NeedsToken("That token was not accepted. Paste it again.");
  return response;
}

const backend: Backend = {
  setToken(token) { memory = token; store.set(token); },
  async load(): Promise<Snapshot> {
    const response = await api("api/state");
    if (!response.ok) throw new Error("The server answered " + response.status + ".");
    return (await response.json()) as Snapshot;
  },
  async edit(base: number, edit: Edit): Promise<EditReply> {
    const response = await api("api/edit", { method: "POST", body: JSON.stringify({ base, edit }) });
    const body = (await response.json()) as EditReply | { error: string; message?: string };
    if ("ok" in body) return body;
    throw new Error(body.message ?? body.error);
  },
};

mountUi(document.getElementById("app") as HTMLElement, backend);
