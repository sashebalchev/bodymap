import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.ts";
import { createApp } from "./http.ts";
import { appGrant } from "./mcp.ts";
import { BodyMap } from "./service.ts";
import { Store } from "./store.ts";

const config = readConfig(process.env, fileURLToPath(new URL("../dist", import.meta.url)));

// The page template carries one placeholder, a base64 JSON blob the page reads at start.
const boot = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
function page(name: string, bootValue: unknown): string {
  let html: string;
  try {
    html = readFileSync(config.distDir + "/" + name, "utf8");
  } catch {
    throw new Error("Missing " + config.distDir + "/" + name + ". Run: npm run build");
  }
  return html.replace("__BOOT__", () => boot(bootValue));
}
const webHtml = page("web.html", { mode: "web" });
const viewHtml = page("view.html", { mode: "mcp", grant: appGrant(config.uiToken), webUrl: config.webUrl ?? null });

const store = await Store.open(config.dataDir, () => new Date());
const map = new BodyMap(store, config.claudeMaxLevel);
const server = createApp({ map, mcpToken: config.mcpToken, uiToken: config.uiToken, webHtml: () => webHtml, viewHtml: () => viewHtml, webUrl: config.webUrl });

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log("bodymap listening on " + config.host + ":" + port + ", " + store.state.layers.length + " layers, revision " + store.state.revision);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
