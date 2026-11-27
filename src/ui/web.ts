// The plain web page. Same interface, talks to api/ (relative) with the token Alex pasted once.
import { apiBackend, type Backend, type HttpResponse, type Transport } from "./backend.ts";
import { mountUi } from "./core.ts";
import { FIGURE_NOTICE } from "../figure.ts";

declare const __APP_VERSION__: string;

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

const transport: Transport = async ({ url, method, token, body }): Promise<HttpResponse> => {
  const response = await fetch(url, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const backend: Backend = {
  ...apiBackend({ base: () => "", token: () => memory ?? store.get(), transport }),
  setToken(token) { memory = token; store.set(token); },
};

mountUi(document.getElementById("app") as HTMLElement, backend, { version: __APP_VERSION__, notice: FIGURE_NOTICE });
