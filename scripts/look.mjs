// Drives the real web page with a real pointer and keyboard in a private headless browser, against the real server.
//   node scripts/look.mjs [screenshot folder]
// Exits 1 on any failed check. Screenshots go to docs/screenshots by default.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { withBrowser } from "./browser.mjs";
import { MCP_TOKEN, UI_TOKEN, startRealServer } from "./server-process.mjs";

const shots = process.argv[2] ?? fileURLToPath(new URL("../docs/screenshots", import.meta.url));
mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failures.push(what); };

const server = await startRealServer();
const api = async (path, init) => (await fetch(server.url + path, { ...init, headers: { authorization: "Bearer " + UI_TOKEN, "content-type": "application/json" } })).json();
const state = async () => (await api("/api/state")).state;
const layerNamed = async (name) => (await state()).layers.find((l) => l.name === name);

try {
  await withBrowser(async (b) => {
    const shoot = (name) => b.shoot(join(shots, name + ".png"));
    const text = (sel) => b.run("document.querySelector(" + JSON.stringify(sel) + ")?.textContent ?? null");
    const count = (sel) => b.run("document.querySelectorAll(" + JSON.stringify(sel) + ").length");
    const typeInto = async (sel, words, replace = false) => {
      await b.click(sel);
      if (replace) await b.run("document.querySelector(" + JSON.stringify(sel) + ").select()");
      await b.type(words);
      await b.sleep(150);
    };
    const figurePoint = async (x, y) => { const f = await b.centre('[data-role="figure"]'); return { x: Math.round(f.left + (x / 400) * f.width), y: Math.round(f.top + (y / 900) * f.height) }; };
    const drag = async (points) => {
      const px = [];
      for (const [x, y] of points) px.push(await figurePoint(x, y));
      await b.pointer([{ type: "pointerMove", x: px[0].x, y: px[0].y }, { type: "pointerDown", button: 0 }, ...px.slice(1).map((p) => ({ type: "pointerMove", x: p.x, y: p.y, duration: 40 })), { type: "pointerUp", button: 0 }]);
      await b.sleep(500);
    };

    // 1. no token: the page asks for one, and says so when it is wrong
    await b.open(server.url + "/", 390, 844);
    check((await count('[data-role="token-form"]')) === 1, "no token: the page asks for one");
    await shoot("00-token");
    await typeInto('[data-role="token"]', "not-the-token");
    await b.key(String.fromCharCode(0xe007));
    await b.sleep(600);
    check(/not accepted/.test((await text('[data-role="token-form"]')) ?? ""), "wrong token: 'not accepted' is shown");

    // 2. empty state
    await b.open(server.url + "/#token=" + UI_TOKEN, 390, 844);
    check((await count('[data-role="empty"]')) === 1, "empty map: the empty state tells what to do");
    check((await b.run("location.hash")) === "", "the token is removed from the address bar");
    await shoot("01-empty");

    // 3. a new mark, typed on the keyboard, then painted with a pointer
    await typeInto('[data-role="new-name"]', "Left shoulder");
    await b.click(".newmark .seg.kind-pinched");
    await b.click('[data-role="add"]');
    const made = await layerNamed("Left shoulder");
    check(made?.kind === "pinched" && made.level === 5, "new mark saved as pinched, level 5: " + JSON.stringify(made && { kind: made.kind, level: made.level }));
    check(/Painting into/.test((await text('[data-role="painting-into"]')) ?? ""), "the new mark is armed for painting");
    await drag([[262, 180], [275, 195], [290, 205], [280, 220], [265, 215]]);
    let shoulder = await layerNamed("Left shoulder");
    check(shoulder?.strokes.length === 1 && shoulder.strokes[0].view === "front" && shoulder.strokes[0].pts.length >= 4, "a real pointer drag saved one front stroke, " + shoulder?.strokes[0]?.pts.length / 2 + " points");
    check(shoulder?.strokes[0].pts.every((v) => Number.isInteger(v)), "stroke points are whole numbers");
    check((await count('svg.figure g[data-layer]')) === 1, "the stroke is on the picture");
    await shoot("02-painted");

    // 4. undo, then paint again
    await b.click('[data-role="undo"]');
    check((await layerNamed("Left shoulder")).strokes.length === 0, "Undo removed the stroke");
    check((await count('svg.figure g[data-layer]')) === 0, "and it left the picture");
    await drag([[262, 180], [275, 195], [290, 205], [280, 220], [265, 215]]);
    check((await layerNamed("Left shoulder")).strokes.length === 1, "painted again");

    // 5. back view
    await b.click('[data-role="view-back"]');
    await drag([[100, 190], [112, 205], [125, 215]]);
    shoulder = await layerNamed("Left shoulder");
    check(shoulder.strokes.length === 2 && shoulder.strokes[1].view === "back", "a stroke on the back view is stored as back");
    await b.click('[data-role="view-front"]');

    // 6. slider: to a higher level, then all the way to 0
    const slider = await b.centre('[data-role="slider"]');
    const at = (share) => ({ x: Math.round(slider.left + share * slider.width), y: slider.y });
    await b.pointer([{ type: "pointerMove", ...at(0.5) }, { type: "pointerDown", button: 0 }, { type: "pointerMove", ...at(0.82), duration: 100 }, { type: "pointerUp", button: 0 }]);
    await b.sleep(500);
    const raised = (await layerNamed("Left shoulder")).level;
    check(raised >= 8 && raised <= 9, "a real drag raised the slider: 5 -> " + raised);
    check((await text('[data-role="level"]')) === String(raised), "the number beside the slider shows it");
    const group = await b.run("document.querySelector('svg.figure g[data-layer]').getAttribute('opacity')");
    check(group === String(raised / 10), "the picture's opacity is level / 10: " + group);
    await shoot("03-raised");
    const s2 = await b.centre('[data-role="slider"]');
    await b.pointer([{ type: "pointerMove", x: Math.round(s2.left + s2.width * 0.9), y: s2.y }, { type: "pointerDown", button: 0 }, { type: "pointerMove", x: Math.round(s2.left - 20), y: s2.y, duration: 150 }, { type: "pointerUp", button: 0 }]);
    await b.sleep(500);
    const cleared = await layerNamed("Left shoulder");
    check(cleared.level === 0 && cleared.clearedAt && cleared.activeSince === null, "dragging to the far left cleared it (level 0, clearedAt set)");
    check((await count('svg.figure g[data-layer]')) === 0, "a cleared layer is gone from the picture");
    check((await b.run("document.querySelector('[data-role=layer]').classList.contains('cleared')")) === true, "and greyed in the list");
    await shoot("04-cleared");
    await b.click('[data-role="undo"]');
    check((await layerNamed("Left shoulder")).level === raised, "Undo put the level back to " + raised);

    // 7. rename, kind, delete with confirmation
    await b.click(".layer .link");
    await typeInto(".details .text", "Left shoulder, front", true);
    await b.click(".details .row .btn");
    check(!!(await layerNamed("Left shoulder, front")), "rename saved");
    await shoot("05-details");
    await b.click('[data-role="delete"]');
    check((await count('[data-role="confirm-delete"]')) === 1, "Remove asks first");
    check(!!(await layerNamed("Left shoulder, front")), "nothing is gone before the second tap");
    await b.click('[data-role="confirm-delete"]');
    check((await state()).layers.length === 0, "second tap removed the layer");
    check((await count('[data-role="empty"]')) === 1, "back to the empty state");

    // 8. Claude adds a layer; the page shows it after Refresh, tagged
    const claude = new Client({ name: "look", version: "0" });
    await claude.connect(new StreamableHTTPClientTransport(new URL(server.url + "/mcp"), { requestInit: { headers: { authorization: "Bearer " + MCP_TOKEN } } }));
    const added = await claude.callTool({ name: "add_layer", arguments: { name: "Lower back", kind: "tense", level: 9, region: "lower_back" } });
    check(!added.isError && /level 4\/10/.test(added.content[0].text), "Claude's add_layer: capped from 9 to 4");
    await b.click('[data-role="refresh"]');
    check((await text('[data-role="layer"] .tag')) === "added by Claude", "the page shows it as added by Claude");
    await b.click('[data-role="view-back"]');
    await shoot("06-claude-added");

    // 9. a change made elsewhere while the page is open: the next edit says so and refreshes
    const lower = await layerNamed("Lower back");
    await api("/api/edit", { method: "POST", body: JSON.stringify({ base: (await state()).revision, edit: { op: "rename", layerId: lower.id, name: "Lower back (elsewhere)" } }) });
    const s3 = await b.centre('[data-role="slider"]');
    await b.pointer([{ type: "pointerMove", x: Math.round(s3.left + s3.width * 0.75), y: s3.y }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }]);
    await b.sleep(600);
    check(/changed somewhere else/.test((await text('[data-role="banner"]')) ?? ""), "stale screen: the banner explains the refused change");
    check((await layerNamed("Lower back (elsewhere)")).level === 4, "and the refused change did not happen");
    check((await text('[data-role="layer"] .layer-name')).includes("elsewhere"), "and the screen now shows the fresh name");
    await shoot("07-conflict");

    // 10. layout
    const wide = await b.run("({scroll: document.documentElement.scrollWidth, view: innerWidth})");
    check(wide.scroll <= wide.view, "no sideways scroll at 390 px");
    const small = await b.run("[...document.querySelectorAll('button, input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && Math.min(r.width, r.height) < 40 && e.type !== 'range'; }).map((e) => e.textContent || e.type)");
    check(small.length === 0, "every button and field is at least 40 px tall and wide" + (small.length ? ": " + small.join(", ") : ""));
    const anim = await b.run("[...document.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return parseFloat(s.transitionDuration) > 0 || parseFloat(s.animationDuration) > 0; }).length");
    check(anim === 0, "no element has a transition or animation");

    await b.open(server.url + "/", 1200, 900);
    await shoot("08-desktop");

    // 11. the server goes away: a clear error, not a blank page
    server.stop();
    await b.click('[data-role="refresh"]');
    await b.sleep(500);
    check(/Could not load/.test((await text('[data-role="banner"]')) ?? ""), "server down: the page says it could not load, with Try again");
    await shoot("09-error");
    check(b.problems.filter((p) => !/Failed to fetch|NetworkError|Load failed/.test(p)).length === 0, "no unexpected console errors" + (b.problems.length ? " (" + b.problems.join(" | ") + ")" : ""));
  });
} finally {
  server.stop();
}
console.log(failures.length ? "\nFAILED " + failures.length : "\nAll checks passed. Screenshots in " + shots);
process.exit(failures.length ? 1 : 0);
