// A private headless Firefox-family browser (own throwaway profile, no window), driven over WebDriver BiDi.
// Headless Chromium does not start in agent sessions on this machine; zen-beta does.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function findBrowser() {
  return ["firefox", "zen-beta", "zen", "librewolf"].find((name) => {
    try { execFileSync("which", [name], { stdio: "ignore" }); return true; } catch { return false; }
  });
}

/** Runs body(browser) with a fresh tab. Always kills the browser's process group and removes the profile. */
export async function withBrowser(body) {
  const binary = findBrowser();
  if (!binary) throw new Error("no Firefox-family browser on PATH");
  const profile = mkdtempSync(join(tmpdir(), "bodymap-look-"));
  const child = spawn(binary, ["--headless", "--no-remote", "--profile", profile, "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"], detached: true });
  const waiting = new Map();
  const problems = [];
  let socket, nextId = 0;
  const cleanup = () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); };
  const timer = setTimeout(() => { cleanup(); process.exit(2); }, 55_000);
  try {
    const address = await new Promise((resolve, reject) => {
      let text = "";
      child.stderr.on("data", (chunk) => { text += chunk; const m = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(text); if (m) resolve(m[1]); });
      child.on("exit", () => reject(new Error("browser exited early")));
    });
    socket = new WebSocket(address + "/session");
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("no BiDi connection")); });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && waiting.has(message.id)) {
        const { resolve, reject } = waiting.get(message.id);
        waiting.delete(message.id);
        message.type === "error" ? reject(new Error(message.error + ": " + message.message)) : resolve(message.result);
      } else if (message.method === "log.entryAdded" && message.params.level === "error") {
        problems.push("console error: " + String(message.params.text).split("\n")[0]);
      }
    };
    const send = (method, params = {}) => {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); setTimeout(() => reject(new Error(method + " got no answer in 20 s")), 20_000); });
    };
    await send("session.new", { capabilities: {} });
    await send("session.subscribe", { events: ["log.entryAdded"] });
    const context = (await send("browsingContext.create", { type: "tab" })).context;
    await send("browsingContext.activate", { context });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const browser = {
      problems, sleep,
      async open(url, width, height, dpr = 2) {
        await send("browsingContext.setViewport", { context, viewport: { width, height }, devicePixelRatio: dpr });
        await send("browsingContext.navigate", { context, url: "about:blank", wait: "complete" });
        await send("browsingContext.navigate", { context, url, wait: "complete" });
        await sleep(500);
      },
      async run(expression) {
        const answer = await send("script.evaluate", { expression: "(async () => JSON.stringify(await (" + expression + ")))()", target: { context }, awaitPromise: true });
        if (answer.type !== "success") throw new Error(answer.exceptionDetails.text);
        return answer.result.type === "string" ? JSON.parse(answer.result.value) : undefined;
      },
      async shoot(file) { const { data } = await send("browsingContext.captureScreenshot", { context, origin: "document" }); writeFileSync(file, Buffer.from(data, "base64")); },
      /** A finger by default (pointerType "touch"): the interface must work with touch pointer events. Pass "mouse" for a mouse. */
      pointer: (actions, pointerType = "touch") => send("input.performActions", { context, actions: [{ type: "pointer", id: "finger", parameters: { pointerType }, actions }] }),
      async type(text) {
        const keys = [...text].flatMap((key) => [{ type: "keyDown", value: key }, { type: "keyUp", value: key }]);
        await send("input.performActions", { context, actions: [{ type: "key", id: "keyboard", actions: keys }] });
      },
      key: (value) => send("input.performActions", { context, actions: [{ type: "key", id: "keyboard", actions: [{ type: "keyDown", value }, { type: "keyUp", value }] }] }),
      /** Centre of the first element matching the selector, in viewport pixels. Scrolls it into view first. */
      async centre(selector, index = 0) {
        return browser.run("(() => { const e = document.querySelectorAll(" + JSON.stringify(selector) + ")[" + index + "]; e.scrollIntoView({block: 'center'}); const r = e.getBoundingClientRect(); return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: r.left, top: r.top, width: r.width, height: r.height}; })()");
      },
      async click(selector, index = 0) {
        const c = await browser.centre(selector, index);
        await browser.pointer([{ type: "pointerMove", x: c.x, y: c.y }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }]);
        await sleep(250);
      },
    };
    return await body(browser);
  } finally {
    clearTimeout(timer);
    cleanup();
  }
}
