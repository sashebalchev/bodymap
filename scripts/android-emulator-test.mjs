// Runs the DEBUG apk in a headless x86_64 emulator against the real service on this machine, and checks what the
// service holds afterwards. Needs /dev/kvm and the emulator shell (nix-shell app/shell.nix --arg withEmulator true):
//   scripts/android-emulator-test.sh            (wraps this in the shell and in resource limits)
// One emulator at a time, killed by pid at the end, ten minutes at most. Exits 1 on any failed check.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MCP_TOKEN, UI_TOKEN, startRealServer } from "./server-process.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sdk = process.env.ANDROID_HOME;
const apk = process.argv[2];
const shotDir = process.argv[3] ?? process.env.BODYMAP_SHOTS ?? join(root, "docs/screenshots");
if (!sdk || !apk || !existsSync(apk)) { console.error("usage: android-emulator-test.mjs <debug apk> [screenshot folder] (inside the emulator shell)"); process.exit(2); }
if (!existsSync("/dev/kvm")) { console.error("no /dev/kvm: not running an emulator without hardware acceleration"); process.exit(2); }

const work = mkdtempSync(join(tmpdir(), "bodymap-emu-"));
const ADB_PORT = "15037", CONSOLE_PORT = "5584", SERIAL = "emulator-" + CONSOLE_PORT, CDP_PORT = 19222;
const env = { ...process.env, ANDROID_ADB_SERVER_PORT: ADB_PORT, ANDROID_AVD_HOME: join(work, "avd"), ANDROID_USER_HOME: join(work, "user"), ANDROID_EMULATOR_HOME: join(work, "emu-home"), HOME: process.env.HOME };
mkdirSync(env.ANDROID_AVD_HOME, { recursive: true });
mkdirSync(env.ANDROID_USER_HOME, { recursive: true });
mkdirSync(env.ANDROID_EMULATOR_HOME, { recursive: true });
const failures = [];
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failures.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"], ...opts });
const adb = (...args) => run("adb", ["-s", SERIAL, ...args]);
const pids = [];
let emulator, server;
const deadline = setTimeout(() => { console.error("10 minutes are up"); cleanup(); process.exit(3); }, 600_000);

function cleanup() {
  try { run("adb", ["-s", SERIAL, "emu", "kill"], { timeout: 10_000 }); } catch {}
  for (const pid of pids) { try { process.kill(-pid, "SIGKILL"); } catch {} }
  try { run("adb", ["kill-server"], { timeout: 10_000 }); } catch {}
  try { server?.stop(); } catch {}
  rmSync(work, { recursive: true, force: true });
}
process.on("SIGTERM", () => { cleanup(); process.exit(143); });
// Whatever ends this process, the emulator must not outlive it.
process.on("exit", (code) => { for (const pid of pids) { try { process.kill(-pid, "SIGKILL"); } catch {} } try { execFileSync("adb", ["-s", SERIAL, "emu", "kill"], { env, timeout: 5000, stdio: "ignore" }); } catch {} if (code !== 0) console.log("exit " + code); });
process.on("uncaughtException", (error) => { console.log("uncaught: " + String(error?.message ?? error).replaceAll(UI_TOKEN, "<token>").slice(0, 300)); process.exit(1); });
process.on("unhandledRejection", (error) => { console.log("unhandled: " + String(error?.message ?? error).replaceAll(UI_TOKEN, "<token>").slice(0, 300)); process.exit(1); });

try {
  server = await startRealServer();
  const port = server.port;
  const api = async (path, init) => (await fetch(server.url + path, { ...init, headers: { authorization: "Bearer " + UI_TOKEN, "content-type": "application/json" } })).json();
  const state = async () => (await api("/api/state")).state;
  const layerNamed = async (name) => (await state()).layers.find((l) => l.name === name);

  // ---- the virtual device ----
  const image = process.env.BODYMAP_IMAGE ?? "system-images;android-36;google_apis;x86_64";
  const avdmanager = execFileSync("sh", ["-c", "ls " + sdk + "/cmdline-tools/*/bin/avdmanager | head -1"], { encoding: "utf8" }).trim();
  run("sh", ["-c", "echo no | " + avdmanager + " create avd --force -n bm -k '" + image + "' -d pixel_6"], { timeout: 120_000 });
  // Under a CPU cap the software-rendered full-size screen is slow enough to make Android kill the app for not responding.
  // A 720 x 1600 screen at 320 dpi (the same 360 x 800 dp as a common phone) has less than half the pixels to draw.
  const config = join(env.ANDROID_AVD_HOME, "bm.avd", "config.ini");
  let ini = readFileSync(config, "utf8");
  for (const [key, value] of [["hw.lcd.width", "720"], ["hw.lcd.height", "1600"], ["hw.lcd.density", "320"]]) ini = new RegExp("^" + key.replace(".", "\\.") + "=.*$", "m").test(ini) ? ini.replace(new RegExp("^" + key.replace(".", "\\.") + "=.*$", "m"), key + "=" + value) : ini + "\n" + key + "=" + value + "\n";
  writeFileSync(config, ini);
  run("adb", ["start-server"]);
  emulator = spawn(sdk + "/emulator/emulator", ["-avd", "bm", "-port", CONSOLE_PORT, "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot", "-no-metrics", "-gpu", "swiftshader_indirect", "-memory", "2048", "-cores", "2", "-accel", "on"], { env, detached: true, stdio: "ignore" });
  pids.push(emulator.pid);
  const bootStart = Date.now();
  for (;;) {
    await sleep(3000);
    try { if (adb("shell", "getprop", "sys.boot_completed").trim() === "1") break; } catch {}
    if (Date.now() - bootStart > 300_000) throw new Error("the emulator did not boot in 5 minutes");
  }
  check(true, "the emulator booted in " + Math.round((Date.now() - bootStart) / 1000) + " s (" + adb("shell", "getprop", "ro.build.version.sdk").trim() + ", " + adb("shell", "getprop", "ro.product.cpu.abi").trim() + ")");
  // A fresh emulator can sit at the lock screen, which swallows touches.
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "wm", "dismiss-keyguard");
  adb("shell", "svc", "power", "stayon", "true");
  // A slow host makes systemui miss its deadline and Android covers the screen with an "isn't responding" dialog. Hide those,
  // and give a just-booted system a moment to settle before the first touch.
  adb("shell", "settings", "put", "global", "hide_error_dialogs", "1");
  await sleep(15_000);
  adb("shell", "settings", "put", "global", "window_animation_scale", "0");
  adb("shell", "settings", "put", "global", "transition_animation_scale", "0");
  adb("shell", "settings", "put", "global", "animator_duration_scale", "0");

  // ---- install, open with the setup link ----
  adb("install", "-r", apk);
  check(/dev\.bodymap\.app/.test(adb("shell", "pm", "list", "packages", "dev.bodymap.app")), "the apk installed");
  const link = "bodymap://setup?server=" + encodeURIComponent("http://10.0.2.2:" + port + "/") + "&token=" + UI_TOKEN;
  // adb joins the arguments into one device shell line, so the link (it holds an &) goes in single quotes.
  adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "'" + link + "'", "-n", "dev.bodymap.app/.MainActivity");
  await sleep(4000);

  // The page is reached through the WebView's debug socket, only to read where things are. Every input is a real adb touch.
  const appPid = adb("shell", "pidof", "dev.bodymap.app").trim().split(/\s+/)[0];
  const sockets = adb("shell", "cat", "/proc/net/unix");
  const socket = (sockets.match(/@?(webview_devtools_remote_\d+)/g) ?? []).map((s) => s.replace("@", "")).find((s) => s.endsWith("_" + appPid));
  check(!!socket, "the app's WebView is debuggable (debug build)");
  adb("forward", "tcp:" + CDP_PORT, "localabstract:" + socket);
  const pages = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json")).json();
  const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("no CDP")); });
  let n = 0; const waiting = new Map();
  ws.onclose = () => console.log("info  CDP socket closed");
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const page = async (expression) => {
    const id = ++n;
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: "(async () => JSON.stringify(await (" + expression + ")))()", awaitPromise: true, returnByValue: true } }));
    const m = await Promise.race([new Promise((r) => waiting.set(id, r)), new Promise((_, j) => setTimeout(() => j(new Error("the page did not answer in 15 s")), 15_000))]);
    const v = m.result?.result?.value;
    return v === undefined ? undefined : JSON.parse(v);
  };
  const dpr = await page("devicePixelRatio");
  const screen = adb("shell", "wm", "size").match(/(\d+)x(\d+)/);
  // Where an element is, in device pixels. Verified below: a tap aimed with this lands where it was aimed.
  const where = async (selector, index = 0) => page("(() => { const e = document.querySelectorAll(" + JSON.stringify(selector) + ")[" + index + "]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
  // The page's origin on the screen. Measured with a real tap below (the WebView may sit under the status bar or below it).
  let origin = { x: 0, y: 0 };
  const devX = (v) => Math.round(v * dpr + origin.x), devY = (v) => Math.round(v * dpr + origin.y);
  const tap = async (selector, index = 0) => { const r = await where(selector, index); if (!r) throw new Error("not on screen: " + selector); adb("shell", "input", "tap", String(devX(r.x + r.w / 2)), String(devY(r.y + r.h / 2))); await sleep(500); };
  const text = (selector) => page("document.querySelector(" + JSON.stringify(selector) + ")?.textContent ?? null");

  await page("(() => { window.__taps = []; addEventListener('pointerdown', (e) => window.__taps.push([e.clientX, e.clientY, e.pointerType]), true); return 1; })()");
  adb("shell", "input", "tap", "200", "500");
  await sleep(300);
  const landed = (await page("window.__taps"))[0];
  if (!landed) { try { writeFileSync(join(shotDir, "emu-debug.png"), execFileSync("adb", ["-s", SERIAL, "exec-out", "screencap", "-p"], { env, maxBuffer: 20_000_000 })); console.log("focus: " + adb("shell", "dumpsys", "window").split("\n").filter((l) => /mCurrentFocus|mDreamingLockscreen|isKeyguardShowing/.test(l)).join(" | ").slice(0, 300)); } catch {} }
  check(!!landed && landed[2] === "touch", "an adb tap reaches the page as a touch pointer event");
  if (landed) origin = { x: Math.round(200 - landed[0] * dpr), y: Math.round(500 - landed[1] * dpr) };
  const view = await page("({ w: innerWidth, h: innerHeight, top: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'), bottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom'), padTop: getComputedStyle(document.querySelector('.page, .main')).paddingTop })");
  console.log("info  screen " + screen?.[1] + "x" + screen?.[2] + ", dpr " + dpr + ", page " + Math.round(view.w * dpr) + "x" + Math.round(view.h * dpr) + " device px starting at (" + origin.x + "," + origin.y + "), Capacitor's inset vars top '" + view.top + "' bottom '" + view.bottom + "', top padding " + view.padTop);
  check(Math.abs(origin.x) <= 2 && origin.y >= 0 && origin.y < 200, "after that the page's origin is known, so every later tap is aimed by calibration, not by guess");

  // ---- setup screen, as the link filled it ----
  check((await page("document.querySelector('[data-role=server]')?.value")) === "http://10.0.2.2:" + port + "/", "the setup link filled the server address");
  check((await page("document.querySelector('[data-role=token]')?.value?.length")) === UI_TOKEN.length, "and the token (length only, not shown)");
  check(/Connect/.test((await text('[data-role="connect"]')) ?? ""), "Connect is on screen and nothing was sent yet (the server holds no layers: " + (await state()).layers.length + ")");
  mkdirSync(shotDir, { recursive: true });
  const shoot = (name) => writeFileSync(join(shotDir, name + ".png"), execFileSync("adb", ["-s", SERIAL, "exec-out", "screencap", "-p"], { env, maxBuffer: 20_000_000 }));
  shoot("emu-01-setup");
  await tap('[data-role="connect"]');
  await sleep(2500);
  check(/Synced, revision 0/.test((await text('[data-role="status"]')) ?? ""), "Connect reached the real service from the emulator through the native HTTP plugin: " + (await text('[data-role="status"]')));
  check((await page("document.querySelector('[data-role=empty]') !== null")), "the empty state shows");

  // ---- a mark, typed with the system keyboard path, then painted ----
  await tap('[data-role="first-mark"]');
  await tap('[data-role="new-name"]');
  adb("shell", "input", "text", "Shoulder");
  await sleep(300);
  await tap('[data-role="kind-pinched"]');
  await tap('[data-role="add"]');
  await sleep(1500);
  const mark = await layerNamed("Shoulder");
  check(mark?.kind === "pinched" && mark.level === 5 && mark.by === "alex", "the new mark exists on the service: " + JSON.stringify(mark && { name: mark.name, kind: mark.kind, level: mark.level }));

  const fig = await where('[data-role="figure"]');
  const at = (x, y) => [devX(fig.x + (x / 400) * fig.w), devY(fig.y + ((y - 96) / 710) * fig.h)];
  const a = at(285, 250), b = at(290, 290);
  adb("shell", "input", "swipe", String(a[0]), String(a[1]), String(b[0]), String(b[1]), "400");
  await sleep(1500);
  const painted = await layerNamed("Shoulder");
  const stroke = painted?.strokes[0];
  check(painted?.strokes.length === 1 && stroke.view === "front" && stroke.pts.length >= 4, "an adb swipe painted one front stroke on the service, " + (stroke?.pts.length ?? 0) / 2 + " points");
  check(stroke && Math.abs(stroke.pts[0] - 285) <= 4 && Math.abs(stroke.pts[1] - 250) <= 4 && Math.abs(stroke.pts.at(-2) - 290) <= 4 && Math.abs(stroke.pts.at(-1) - 290) <= 4, "from (285,250) to (290,290) within 4 units: first (" + stroke?.pts[0] + "," + stroke?.pts[1] + "), last (" + stroke?.pts.at(-2) + "," + stroke?.pts.at(-1) + ")");

  // ---- a slider, raised then lowered ----
  await tap('[data-role="marks-open"]');
  const s = await where('[data-role="slider"]');
  const thumbAt = (share) => [devX(s.x + 18 + (s.w - 36) * share), devY(s.y + s.h / 2)];
  // `input swipe` reports only two or three moves, and a range input follows its moves, not the lift: a run of swipes left the
  // slider half way twice. A slider drag is sent as DOWN, eight MOVEs and UP (`input motionevent`), like a finger on glass.
  const drag = (from, to, steps = 8) => {
    const line = ["input motionevent DOWN " + from[0] + " " + from[1]];
    for (let i = 1; i <= steps; i++) line.push("input motionevent MOVE " + Math.round(from[0] + ((to[0] - from[0]) * i) / steps) + " " + Math.round(from[1] + ((to[1] - from[1]) * i) / steps));
    line.push("input motionevent UP " + to[0] + " " + to[1]);
    adb("shell", line.join("; "));
  };
  const from5 = thumbAt(0.5), to9 = thumbAt(0.9);
  await page("(() => { window.__ev = []; for (const t of ['input', 'change']) document.addEventListener(t, (e) => window.__ev.push(t + ':' + e.target.value), true); for (const t of ['pointercancel', 'pointerup']) document.addEventListener(t, (e) => window.__ev.push(t), true); return 1; })()");
  drag(from5, to9);
  await sleep(1200);
  const raised = (await layerNamed("Shoulder")).level;
  console.log("info  slider events during the raise swipe: " + ((await page("window.__ev")) ?? []).join(" ").slice(0, 300));
  check(raised >= 8, "a drag on the slider raised the level on the service: 5 -> " + raised);
  const to2 = thumbAt(0.2), nine = thumbAt(raised / 10);
  drag(nine, to2);
  await sleep(1200);
  const lowered = (await layerNamed("Shoulder")).level;
  check(lowered >= 1 && lowered <= 3, "and a drag back lowered it: " + raised + " -> " + lowered);
  const zero = thumbAt(0);
  drag(to2, [zero[0] - 30, zero[1]]);
  await sleep(1200);
  const cleared = await layerNamed("Shoulder");
  check(cleared.level === 0 && cleared.clearedAt !== null, "all the way left: level 0, cleared on the service");
  check(/cleared/.test((await text('[data-role="mark"] [data-role="level"]')) ?? ""), "and the sheet says 'cleared'");
  shoot("emu-02-marks");

  // ---- the system back button, and a restart ----
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await sleep(600);
  check((await page("document.querySelector('[data-role=sheet]') === null")), "the system back button closed the Marks sheet and the app stayed open");
  adb("shell", "am", "force-stop", "dev.bodymap.app");
  adb("shell", "am", "start", "-W", "-n", "dev.bodymap.app/.MainActivity");
  await sleep(4000);
  const pid2 = adb("shell", "pidof", "dev.bodymap.app").trim().split(/\s+/)[0];
  const socket2 = (adb("shell", "cat", "/proc/net/unix").match(/@?(webview_devtools_remote_\d+)/g) ?? []).map((x) => x.replace("@", "")).find((x) => x.endsWith("_" + pid2));
  adb("forward", "tcp:" + CDP_PORT, "localabstract:" + socket2);
  const pages2 = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json")).json();
  ws.close();
  const ws2 = new WebSocket(pages2.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => { ws2.onopen = r; });
  const id = 1000;
  ws2.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: "document.querySelector('[data-role=status]')?.textContent + '|' + (document.querySelector('[data-role=token-form]') !== null)", returnByValue: true } }));
  const after = await new Promise((r) => { ws2.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === id) r(m.result.result.value); }; });
  check(/^Synced, revision \d+\|false$/.test(after), "after a force stop and a restart the app is still set up (token and address kept): " + after);
  ws2.close();
  void MCP_TOKEN;
} catch (error) {
  // What the device itself says about a death or a hang: crash buffer and the low-memory killer, nothing else.
  try { console.log("logcat (crash buffer and lmkd):\n" + (adb("logcat", "-d", "-b", "crash", "-t", "20") + adb("shell", "logcat -d -s lmkd:I ActivityManager:W AndroidRuntime:E | tail -n 15")).replaceAll(UI_TOKEN, "<token>").slice(0, 2500)); } catch {}
  check(false, "the run stopped: " + String(error instanceof Error ? error.message : error).replaceAll(UI_TOKEN, "<token>").slice(0, 400));
} finally {
  clearTimeout(deadline);
  cleanup();
}
console.log(failures.length ? "\nFAILED " + failures.length : "\nAll emulator checks passed.");
process.exit(failures.length ? 1 : 0);
