// The MCP App inside a stand-in host (the SDK's own AppBridge), in a private headless browser, against the real server.
//   node scripts/look-mcp.mjs [screenshot folder]
import { createServer, request } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { withBrowser } from "./browser.mjs";
import { MCP_TOKEN, startRealServer } from "./server-process.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const shots = process.argv[2] ?? join(root, "docs/screenshots");
mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failures.push(what); };

const bundle = await build({ entryPoints: [root + "test/host/host.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", charset: "ascii" });
const hostJs = bundle.outputFiles[0].text;
const server = await startRealServer({ BODYMAP_WEB_URL: "http://berry:8104/" });

// Same origin for the host page and /mcp, so no CORS: the harness forwards /mcp to the real server.
const harness = createServer((req, res) => {
  if (req.url?.startsWith("/mcp")) {
    const up = request({ host: "127.0.0.1", port: server.port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  } else if (req.url === "/host.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(hostJs); }
  else { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><meta name=viewport content="width=device-width, initial-scale=1"><body style="margin:0"><script type="module" src="/host.js"></script>'); }
});
await new Promise((r) => harness.listen(0, "127.0.0.1", r));
const harnessUrl = "http://127.0.0.1:" + harness.address().port + "/?h=800&token=" + MCP_TOKEN;

try {
  await withBrowser(async (b) => {
    const shoot = (name) => b.shoot(join(shots, name + ".png"));
    const F = "document.querySelector('iframe').contentDocument";
    const inView = (expr) => b.run("(() => { const D = " + F + "; return (" + expr + "); })()");
    const textIn = (sel) => inView("D.querySelector(" + JSON.stringify(sel) + ")?.textContent ?? null");
    const clickIn = async (sel, index = 0) => {
      const c = await b.run("(() => { const D = " + F + "; const e = D.querySelectorAll(" + JSON.stringify(sel) + ")[" + index + "]; e.scrollIntoView({block:'center'}); const f = document.querySelector('iframe').getBoundingClientRect(); const r = e.getBoundingClientRect(); return {x: Math.round(f.left + r.left + r.width/2), y: Math.round(f.top + r.top + r.height/2)}; })()");
      await b.pointer([{ type: "pointerMove", x: c.x, y: c.y }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }]);
      await b.sleep(400);
    };
    const model = async (name, args) => { const r = await b.run("hostCall(" + JSON.stringify(name) + "," + JSON.stringify(args ?? {}) + ")"); return r; };

    await b.open(harnessUrl, 390, 844);
    for (let i = 0; i < 40 && !(await b.run("!!window.hostReady")); i++) await b.sleep(250);
    check(await b.run("window.hostReady === true"), "host connected to the server and mounted the ui:// resource in an iframe");
    check((await b.run("window.resourceMime")) === "text/html;profile=mcp-app", "resource mime type is text/html;profile=mcp-app");
    await b.sleep(1200);
    check(/Synced, revision 0/.test((await textIn('[data-role="status"]')) ?? ""), "the app initialised with the host and loaded the map through its app-only tool: " + (await textIn('[data-role="status"]')));
    check((await inView("!!D.querySelector('[data-role=empty]')")) === true, "empty state shown inside the frame");
    await shoot("10-mcp-empty");

    const tools = await b.run("hostTools()");
    check(tools.map((t) => t.name).includes("body_map_edit"), "(the host sees all tools; hiding app-only ones is the host's job, checked in unit tests on the visibility flag)");

    const added = await model("add_layer", { name: "Left shoulder", kind: "pinched", level: 3, region: "left_shoulder" });
    check(!added.isError, "Claude's add_layer through the same connection: " + added.content[0].text.slice(0, 60));
    await clickIn('[data-role="refresh"]');
    await b.sleep(500);
    await clickIn('[data-role="marks-open"]');
    check((await textIn('[data-role="mark"] .tag')) === "added by Claude", "Refresh in the app shows the layer Claude added");

    // paint with a real pointer inside the frame
    await clickIn('[data-role="paint"]');
    const measure = () => b.run("(() => { const D = " + F + "; const f = document.querySelector('iframe').getBoundingClientRect(); const e = D.querySelector('[data-role=figure]'); e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {left: f.left + r.left, top: f.top + r.top, w: r.width, h: r.height}; })()");
    await measure();
    await b.sleep(300);
    const box = await measure();
    const P = ([x, y]) => ({ x: Math.round(box.left + (x / 400) * box.w), y: Math.round(box.top + ((y - 96) / 710) * box.h) });
    const path = [[250, 200], [262, 215], [275, 205], [268, 190]].map(P);
    await b.pointer([{ type: "pointerMove", ...path[0] }, { type: "pointerDown", button: 0 }, ...path.slice(1).map((p) => ({ type: "pointerMove", ...p, duration: 40 })), { type: "pointerUp", button: 0 }]);
    await b.sleep(700);
    let seen = await model("get_body_map");
    let list = seen.content.find((c) => c.type === "text").text;
    check(/1\. Left shoulder \| pinched \| level 3\/10/.test(list), "Claude reads the layer back: " + list.split("\n").find((l) => l.startsWith("1.")));
    const strokes = (await model("body_map_state", { grant: "" })).isError;
    check((await inView("D.querySelectorAll('svg.figure g[data-layer] path').length")) >= 1, "Alex's stroke shows in the app (a path beyond Claude's blob)");
    check(strokes === true, "an app-only tool called without the grant is refused");
    const png = seen.content.find((c) => c.type === "image");
    check(png?.mimeType === "image/png" && png.data.length > 1000, "get_body_map returned a PNG image (" + Math.round(png.data.length * 0.75) + " bytes)");
    writeFileSync(join(shots, "get_body_map-sample.png"), Buffer.from(png.data, "base64"));
    await shoot("11-mcp-painted");

    // Alex drags the slider to 0 in the app; Claude sees it cleared
    await clickIn('[data-role="marks-open"]');
    const measureSlider = () => b.run("(() => { const D = " + F + "; const f = document.querySelector('iframe').getBoundingClientRect(); const e = D.querySelector('[data-role=slider]'); e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {left: f.left + r.left, w: r.width, y: f.top + r.top + r.height/2}; })()");
    await measureSlider();
    await b.sleep(300);
    const sl = await measureSlider();
    await b.pointer([{ type: "pointerMove", x: Math.round(sl.left + sl.w * 0.3), y: Math.round(sl.y) }, { type: "pointerDown", button: 0 }, { type: "pointerMove", x: Math.max(1, Math.round(sl.left - 8)), y: Math.round(sl.y), duration: 120 }, { type: "pointerUp", button: 0 }]);
    await b.sleep(700);
    seen = await model("get_body_map");
    list = seen.content.find((c) => c.type === "text").text;
    check(/No active layers/.test(list) && /Cleared by Alex.*Left shoulder/.test(list), "after Alex drags to 0, Claude sees it cleared and out of the picture: " + list.split("\n").slice(2).join(" / "));
    await shoot("12-mcp-cleared");

    // the server goes away
    server.stop();
    await clickIn('[data-role="refresh"]');
    await b.sleep(800);
    const banner = (await textIn('[data-role="banner"]')) ?? "";
    check(/Cannot reach the server/.test(banner) && /web page: http:\/\/berry:8104/.test(banner), "server down: the app says so and names the web page fallback: " + banner.slice(0, 160));
    await shoot("13-mcp-error");

    const csp = b.problems.filter((p) => /Content-Security-Policy/.test(p));
    check(csp.length === 0, "no CSP violations under the default MCP Apps CSP (the HTML is self-contained)" + (csp.length ? ": " + csp[0] : ""));
    const other = b.problems.filter((p) => !/Content-Security-Policy|Failed to fetch|NetworkError|Load failed|\/mcp/.test(p));
    check(other.length === 0, "no other console errors" + (other.length ? ": " + other.join(" | ") : ""));
  });
} finally {
  server.stop();
  harness.close();
}
console.log(failures.length ? "\nFAILED " + failures.length : "\nAll checks passed. Screenshots in " + shots);
process.exit(failures.length ? 1 : 0);
