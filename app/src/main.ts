// The Android app's entry. The interface is the web page's, unchanged. What differs is the backend: the server address and
// token live in the app's preferences, and requests go through the native HTTP plugin (so no CORS, no mixed content).
import { App } from "@capacitor/app";
import { CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { FIGURE_NOTICE } from "../../src/figure.ts";
import { apiBackend, normalizeServerUrl, parseSetupLink, type Backend, type HttpResponse, type Transport } from "../../src/ui/backend.ts";
import { mountUi } from "../../src/ui/core.ts";

declare const __APP_VERSION__: string;

const DEFAULT_SERVER = "https://gym.tailcab34c.ts.net/bodymap/";
let server = (await Preferences.get({ key: "server" })).value;
let token = (await Preferences.get({ key: "token" })).value;

const transport: Transport = async ({ url, method, token: bearer, body }): Promise<HttpResponse> => {
  try {
    const reply = await CapacitorHttp.request({
      url, method, data: body, responseType: "json", connectTimeout: 10_000, readTimeout: 20_000,
      headers: { authorization: "Bearer " + bearer, "content-type": "application/json", accept: "application/json" },
    });
    return { status: reply.status, body: reply.data };
  } catch (error) {
    // A TypeError is what the interface reads as "cannot reach the server"; fetch throws the same.
    throw new TypeError(error instanceof Error ? error.message : String(error));
  }
};

const backend: Backend = {
  ...apiBackend({ base: () => server ?? DEFAULT_SERVER, token: () => token, transport }),
  setup: {
    get server() { return server ?? DEFAULT_SERVER; },
    async connect(address, secret) {
      const normal = normalizeServerUrl(address);
      await Preferences.set({ key: "server", value: normal });
      await Preferences.set({ key: "token", value: secret.trim() });
      server = normal;
      token = secret.trim();
    },
    async forget() {
      await Preferences.remove({ key: "token" });
      token = null;
    },
  },
};

const ui = mountUi(document.getElementById("app") as HTMLElement, backend, { version: __APP_VERSION__, notice: FIGURE_NOTICE });

const opened = (link: string) => { const setup = parseSetupLink(link); if (setup) ui.prefill(setup.server, setup.token); };
void App.addListener("appUrlOpen", (event) => opened(event.url));
const launch = await App.getLaunchUrl();
if (launch?.url) opened(launch.url);
void App.addListener("backButton", () => { if (!ui.back()) void App.exitApp(); });
