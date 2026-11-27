// Drives the real UI (the web page bundle) with real touch pointers in a private headless browser, against the real
// server (own data dir, test tokens), at a phone viewport, and checks what it sees.
//   node scripts/look.mjs [screenshot folder]
// Exits 1 on any failed check. Five screenshots go to docs/screenshots/app-*.png by default.
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
const W = 412, H = 915;

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
    // Figure units to viewport pixels, through the svg's own box (the figure is letterboxed inside it).
    const figurePoint = async (x, y) => {
      const f = await b.centre('[data-role="figure"]');
      return { x: f.left + (x / 400) * f.width, y: f.top + ((y - 96) / 710) * f.height, scale: f.width / 400 };
    };
    const drag = async (points) => {
      const px = [];
      for (const [x, y] of points) px.push(await figurePoint(x, y));
      const r = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
      await b.pointer([{ type: "pointerMove", ...r(px[0]) }, { type: "pointerDown", button: 0 }, ...px.slice(1).map((p) => ({ type: "pointerMove", ...r(p), duration: 40 })), { type: "pointerUp", button: 0 }]);
      await b.sleep(450);
    };
    const sliderAt = async (index, share) => {
      const s = await b.centre('[data-role="slider"]', index);
      return { x: Math.round(s.left + share * s.width), y: s.y, s };
    };
    const dragSlider = async (index, from, to) => {
      const a = await sliderAt(index, from), z = await sliderAt(index, to);
      await b.pointer([{ type: "pointerMove", x: a.x, y: a.y }, { type: "pointerDown", button: 0 }, { type: "pointerMove", x: z.x, y: z.y, duration: 120 }, { type: "pointerUp", button: 0 }]);
      await b.sleep(450);
    };

    // 1. no token: the page asks for one, and says so when it is wrong
    await b.open(server.url + "/", W, H, 2.625);
    check((await count('[data-role="token-form"]')) === 1, "no token: the page asks for one");
    check((await count('[data-role="server"]')) === 0, "the web page asks for a token only, not an address");
    await typeInto('[data-role="token"]', "not-the-token");
    await b.key(String.fromCharCode(0xe007));
    await b.sleep(600);
    check(/not accepted/.test((await text('[data-role="setup-error"]')) ?? ""), "wrong token: 'not accepted' is shown");

    // 2. empty state
    await b.open(server.url + "/#token=" + UI_TOKEN, W, H, 2.625);
    check((await count('[data-role="empty"]')) === 1, "empty map: the empty state tells what to do");
    check((await count('[data-role="first-mark"]')) === 1, "and offers the one thing to do");
    check((await b.run("location.hash")) === "", "the token is removed from the address bar");
    check(/^Synced, revision 0$/.test((await text('[data-role="status"]')) ?? ""), "the quiet status line: " + (await text('[data-role="status"]')));
    await shoot("app-01-empty");

    // 3. first mark: typed, kind chosen, then painted with a finger
    await b.click('[data-role="first-mark"]');
    await typeInto('[data-role="new-name"]', "Left shoulder");
    await b.click('[data-role="kind-pinched"]');
    await b.click('[data-role="add"]');
    const made = await layerNamed("Left shoulder");
    check(made?.kind === "pinched" && made.level === 5, "new mark saved as pinched, level 5: " + JSON.stringify(made && { kind: made.kind, level: made.level }));
    check((await count('[data-role="sheet"]')) === 0, "the sheet closes, the figure is back to full height");
    check(/Painting Left shoulder/.test((await text('[data-role="target"]')) ?? ""), "the new mark is armed for painting: " + (await text('[data-role="target"]')));
    await b.run("(() => { window.__types = []; const s = document.querySelector('[data-role=figure]'); s.addEventListener('pointerdown', (e) => window.__types.push(e.pointerType)); return 1; })()");
    await drag([[285, 250], [292, 262], [288, 276], [278, 284]]);
    let shoulder = await layerNamed("Left shoulder");
    check((await b.run("window.__types.join()")) === "touch", "the pointer was a touch pointer: " + (await b.run("window.__types.join()")));
    check(shoulder?.strokes.length === 1 && shoulder.strokes[0].view === "front" && shoulder.strokes[0].pts.length >= 4, "a touch drag saved one front stroke, " + shoulder?.strokes[0]?.pts.length / 2 + " points");
    const first = shoulder?.strokes[0].pts;
    check(first && Math.abs(first[0] - 285) <= 1.5 && Math.abs(first[1] - 250) <= 1.5, "the stroke starts where the finger went down, within 1.5 units: (" + first?.[0] + "," + first?.[1] + ") for (285,250)");
    check(first && Math.abs(first[first.length - 2] - 278) <= 1.5 && Math.abs(first[first.length - 1] - 284) <= 1.5, "and ends where it lifted: (" + first?.[first.length - 2] + "," + first?.[first.length - 1] + ") for (278,284)");
    check(shoulder?.strokes[0].r === 16, "medium brush by default: r " + shoulder?.strokes[0].r);
    check((await count('svg.figure g[data-layer]')) === 1, "the stroke is on the picture");

    // 4. a tap is a dot, the large brush is r 28, undo takes the last one back
    await b.click('[data-role="brush-l"]');
    await drag([[200, 300]]);
    shoulder = await layerNamed("Left shoulder");
    const dot = shoulder.strokes[1];
    check(dot?.r === 28 && dot.pts.length === 4 && Math.abs(dot.pts[0] - 200) <= 1.5 && Math.abs(dot.pts[1] - 300) <= 1.5, "a tap is a dot of the large brush at the tap: " + JSON.stringify(dot));
    await b.click('[data-role="undo"]');
    check((await layerNamed("Left shoulder")).strokes.length === 1, "Undo removed the dot");
    await b.click('[data-role="brush-m"]');

    // 5. the back view, a second and a third mark, a different kind each
    await b.click('[data-role="view-back"]');
    await b.click('[data-role="new-mark"]');
    await typeInto('[data-role="new-name"]', "Lower back");
    await b.click('[data-role="kind-sharp"]');
    await b.click('[data-role="add"]');
    await drag([[160, 392], [200, 400], [240, 392]]);
    await b.click('[data-role="new-mark"]');
    await typeInto('[data-role="new-name"]', "Right calf");
    await b.click('[data-role="add"]');
    await b.click('[data-role="brush-l"]');
    await drag([[172, 630], [170, 660], [172, 690]]);
    const back = (await layerNamed("Lower back")).strokes[0];
    check(back?.view === "back" && (await layerNamed("Right calf")).strokes[0]?.view === "back", "strokes on the back are stored as back");
    check((await text('[data-role="view-back"] .count')) === "2" && (await text('[data-role="view-front"] .count')) === "1", "Front and Back show how many marks each side holds");
    // levels: raise two of them through the sheet later; for now set by API so the picture has a spread
    await b.click('[data-role="view-front"]');
    await b.click('[data-role="marks-open"]');

    // 6. the Marks sheet: sliders with a finger
    check((await count('[data-role="mark"]')) === 3, "the sheet lists every mark: " + (await count('[data-role="mark"]')));
    await dragSlider(0, 0.5, 0.82);
    const raised = (await layerNamed("Left shoulder")).level;
    check(raised >= 8 && raised <= 9, "a finger drag raised the slider: 5 -> " + raised);
    check((await text('[data-role="mark"] [data-role="level"]')) === String(raised), "the number beside the slider shows it");
    const opacity = await b.run("document.querySelector('svg.figure g[data-layer]').getAttribute('opacity')");
    check(opacity === String(raised / 10), "the picture's opacity is level / 10: " + opacity);
    await dragSlider(1, 0.5, 0.3);
    await dragSlider(2, 0.5, 0.65);
    const calfBefore = (await layerNamed("Right calf")).level;
    check((await layerNamed("Lower back")).level === 3, "another mark set to 3 with its own slider: " + (await layerNamed("Lower back")).level);
    await dragSlider(2, 0.5, 0.0);
    const gone = await layerNamed("Right calf");
    check(gone.level === 0 && gone.clearedAt && gone.activeSince === null, "dragging to the far left cleared it (level 0, clearedAt set)");
    check((await text('[data-name="Right calf"] [data-role="level"]')) === "cleared", "the list says 'cleared' for it");
    check(await b.run("document.querySelector('[data-name=\"Right calf\"]').classList.contains('cleared')"), "and greys it");
    await b.click('[data-role="undo-sheet"]');
    check((await layerNamed("Right calf")).level === calfBefore && calfBefore > 0, "Undo put it back to " + calfBefore);
    await dragSlider(2, 0.5, 0.0);

    // 7. Claude adds a mark; Refresh (the status line) shows it, tagged
    const claude = new Client({ name: "look", version: "0" });
    await claude.connect(new StreamableHTTPClientTransport(new URL(server.url + "/mcp"), { requestInit: { headers: { authorization: "Bearer " + MCP_TOKEN } } }));
    const added = await claude.callTool({ name: "add_layer", arguments: { name: "Left knee", kind: "tense", level: 9, region: "left_knee" } });
    check(!added.isError && /level 4\/10/.test(added.content[0].text), "Claude's add_layer: capped from 9 to 4");
    await b.click('[data-role="refresh"]');
    check((await count('[data-role="mark"] .tag')) === 1 && (await text('[data-role="mark"] .tag')) === "added by Claude", "the sheet shows it as added by Claude");
    check(/Synced, revision 7/.test((await text('[data-role="status"]')) ?? "") || /Synced, revision \d+/.test((await text('[data-role="status"]')) ?? ""), "status after refresh: " + (await text('[data-role="status"]')));
    await shoot("app-03-marks");

    // 8. rename, kind, remove with a confirmation
    await b.click('[data-name="Left knee"] [data-role="edit"]');
    await typeInto('[data-role="rename"]', "Left knee, inside", true);
    await b.click('[data-role="rename-save"]');
    check(!!(await layerNamed("Left knee, inside")), "rename saved");
    await b.click('[data-name="Left knee, inside"] [data-role="kind-sharp"]');
    check((await layerNamed("Left knee, inside")).kind === "sharp", "kind changed to sharp");
    await b.click('[data-role="delete"]');
    check((await count('[data-role="confirm-delete"]')) === 1 && !!(await layerNamed("Left knee, inside")), "Remove asks first, and nothing is gone yet");
    await b.click('[data-role="keep"]');
    check(!!(await layerNamed("Left knee, inside")), "Keep keeps it");
    await b.click('[data-role="delete"]');
    await b.click('[data-role="confirm-delete"]');
    check(!(await layerNamed("Left knee, inside")), "the second tap removed it");

    // 9. a change made elsewhere while the screen is open: the next edit is refused and says so
    const lower = await layerNamed("Lower back");
    await api("/api/edit", { method: "POST", body: JSON.stringify({ base: (await state()).revision, edit: { op: "rename", layerId: lower.id, name: "Lower back (phone)" } }) });
    await dragSlider(1, 0.3, 0.9);
    check(/changed on another device/.test((await text('[data-role="banner"]')) ?? ""), "stale screen: the banner explains the refused change");
    check((await layerNamed("Lower back (phone)")).level === 3, "and the refused change did not happen");
    check((await text('[data-name="Lower back (phone)"] .mark-name')) !== null, "and the list now shows the fresh name");
    await b.click('[data-role="marks-close"]');
    await shoot("app-04-conflict");
    await b.click('[data-role="banner-action"]');
    check((await count('[data-role="banner"]')) === 0, "Dismiss closes the banner");

    // 10. the painted figure, sheet closed
    await b.click('[data-role="target"]');
    await b.click('[data-name="Lower back (phone)"] [data-role="paint"]');
    await b.click('[data-role="view-back"]');
    await shoot("app-02-painted");

    // 11. About: version and the figure attribution
    await b.click('[data-role="about"]');
    const about = (await text('[data-role="about-screen"]')) ?? "";
    check(/Version 0\.\d+\.\d+/.test(about), "About shows the app version: " + (about.match(/Version \S+/) ?? [""])[0]);
    check(/Muscles front and back/.test(about) && /CC BY-SA 4\.0/.test(about), "About shows the figure attribution and licence");
    check(!/Link target for that line/.test(await text('[data-role="full-notice-text"]') ?? "") , "the full notice is hidden until asked for");
    await shoot("app-05-about");
    await b.click('[data-role="about-back"]');

    // 12. layout, as measured on the page
    const wide = await b.run("({scroll: document.documentElement.scrollWidth, view: innerWidth})");
    check(wide.scroll <= wide.view, "no sideways scroll at " + W + " px");
    const small = await b.run("[...document.querySelectorAll('button, input, [role=button]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.getAttribute('data-role') || e.textContent || e.type) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))");
    check(small.length === 0, "every button and field is at least 48 px tall and wide" + (small.length ? ": " + small.join(", ") : ""));
    await b.click('[data-role="marks-open"]');
    const smallSheet = await b.run("[...document.querySelectorAll('button, input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.getAttribute('data-role') || e.textContent || e.type) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))");
    check(smallSheet.length === 0, "same inside the Marks sheet" + (smallSheet.length ? ": " + smallSheet.join(", ") : ""));
    const thumb = await b.run("parseFloat(getComputedStyle(document.querySelector('[data-role=slider]'), '::-webkit-slider-thumb').width) || parseFloat(getComputedStyle(document.querySelector('[data-role=slider]'), '::-moz-range-thumb').width)");
    check(thumb >= 28, "the slider thumb is big: " + thumb + " px");
    await b.click('[data-role="marks-close"]');
    const anim = await b.run("[...document.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return parseFloat(s.transitionDuration) > 0 || parseFloat(s.animationDuration) > 0; }).length");
    check(anim === 0, "no element has a transition or animation");
    const fig = await b.centre('[data-role="figure"]');
    check(fig.height >= 0.5 * H, "the figure is tall: " + Math.round(fig.height) + " of " + H + " px");
    // text contrast, read from the page: every visible text element against the first opaque background above it
    const worst = await b.run(`(() => {
      const parse = (c) => c.match(/[\\d.]+/g).map(Number);
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length < 4 || c[3] > 0.9) return c; } return [15, 17, 21]; };
      let worst = { ratio: 99, what: '' };
      for (const el of document.querySelectorAll('button, p, span, h1, h2, output, label, input')) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own && el.tagName !== 'INPUT') continue;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height || el.disabled) continue;
        const fg = parse(getComputedStyle(el).color), bg = bgOf(el);
        const [a, b2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        const ratio = (a + 0.05) / (b2 + 0.05);
        if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, what: (el.getAttribute('data-role') || el.className || el.tagName) + ': ' + (el.textContent || '').slice(0, 24) };
      }
      return worst;
    })()`);
    check(worst.ratio >= 4.5, "the weakest text contrast on screen is " + worst.ratio + " (" + worst.what + ")");

    // 13. safe areas: the system bars' sizes arrive as CSS variables (Android) or env(); the layout must make room
    await b.run("document.documentElement.style.setProperty('--safe-area-inset-top', '44px'), document.documentElement.style.setProperty('--safe-area-inset-bottom', '34px'), 1");
    await b.sleep(200);
    const insets = await b.run("({ top: document.querySelector('.top').getBoundingClientRect().top, handleBottom: (() => { const h = document.querySelector('.handle').getBoundingClientRect(); return innerHeight - h.bottom; })(), handleH: document.querySelector('.handle').getBoundingClientRect().height })");
    check(insets.top >= 44 - 0.5, "with a 44 px status bar the top bar starts below it: " + insets.top);
    check(insets.handleH >= 56 + 34 - 0.5, "with a 34 px gesture bar the Marks handle grows to clear it: " + Math.round(insets.handleH) + " px tall");
    await b.run("document.documentElement.style.removeProperty('--safe-area-inset-top'), document.documentElement.style.removeProperty('--safe-area-inset-bottom'), 1");

    // 14. a small phone
    await b.open(server.url + "/", 360, 640, 2);
    const sm = await b.run("({ scroll: document.documentElement.scrollWidth, view: innerWidth, handle: document.querySelector('.handle').getBoundingClientRect().bottom, vh: innerHeight, fig: document.querySelector('[data-role=figure]').getBoundingClientRect().height })");
    check(sm.scroll <= sm.view && sm.handle <= sm.vh + 0.5 && sm.fig >= 250, "360 x 640: no sideways scroll, the Marks handle is on screen, the figure is " + Math.round(sm.fig) + " px tall");

    // 15. the server goes away: a clear error with Try again, not a blank page
    server.stop();
    await b.click('[data-role="refresh"]');
    await b.sleep(500);
    check(/Cannot reach the server/.test((await text('[data-role="banner"]')) ?? ""), "server down: the screen says it cannot reach the server, with Try again");
    check(/Offline/.test((await text('[data-role="status"]')) ?? ""), "and the status line says Offline: " + (await text('[data-role="status"]')));
    check(b.problems.filter((p) => !/Failed to fetch|NetworkError|Load failed/.test(p)).length === 0, "no unexpected console errors" + (b.problems.length ? " (" + b.problems.join(" | ") + ")" : ""));
  });
} finally {
  server.stop();
}
console.log(failures.length ? "\nFAILED " + failures.length : "\nAll checks passed. Screenshots in " + shots);
process.exit(failures.length ? 1 : 0);
