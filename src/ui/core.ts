// The interface, shared by the MCP App, the plain web page and the Android app. Each gives it a Backend and nothing else.
// No animation anywhere. Every touch target is at least 48 px. Every empty and failing state says what to do.
import { figureSvg, layerSvg, strokeSvg } from "../figure.ts";
import { FIG_VIEW, FIG_W, KIND_COLOR, KINDS, LIMITS, type Kind, type Layer, type View } from "../types.ts";
import { NeedsToken, type Backend } from "./backend.ts";
import { Controller, type Conn, type UiState } from "./controller.ts";
import { h, icon, svgGroup } from "./dom.ts";
import { attributionText, BRUSHES, KIND_LABEL, levelLabel, markMeta, marksPerView, strokeFromPoints } from "./logic.ts";

export { NeedsToken };
export type { Backend, Snapshot } from "./backend.ts";

export type MountOptions = { version?: string; notice?: string };
export type Mounted = { controller: Controller; prefill(server: string, token: string): void };

type Screen = "main" | "about" | "setup";

function statusText(conn: Conn, revision: number | null): string {
  switch (conn.is) {
    case "loading": return "Loading";
    case "saving": return "Saving";
    case "offline": return "Offline. Tap to retry";
    case "needs_token": return "Not connected";
    case "synced": return "Synced, revision " + (revision ?? 0);
  }
}

export function mountUi(root: HTMLElement, backend: Backend, options: MountOptions = {}): Mounted {
  const ctrl = new Controller(backend);
  // What lives only on this screen: which panel is open, and what is half typed.
  let screen: Screen = "main";
  let sheet = false;
  let editing: string | null = null;
  let confirming: string | null = null;
  let confirmForget = false;
  let fullNotice = false;
  let newOpen = false;
  const draft = { newName: "", newKind: "tense" as Kind, rename: {} as Record<string, string>, server: backend.setup?.server ?? "https://gym.tailcab34c.ts.net/bodymap/", token: "" };
  let setupError = "";
  let setupBusy = false;
  let drawing: { id: number; pts: [number, number][]; marks: SVGGElement; svg: SVGSVGElement } | null = null;
  let renderLater = false;
  const parsedFigure = new Map<View, SVGGElement>();

  const st = (): UiState => ctrl.state;
  const layers = (): Layer[] => st().snap?.state.layers ?? [];

  // ---- painting ----------------------------------------------------------------------------------------------------
  function toFigure(svg: SVGSVGElement, e: PointerEvent): [number, number] {
    const m = svg.getScreenCTM();
    const p = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : new DOMPoint(0, 0);
    return [Math.max(0, Math.min(FIG_W, p.x)), Math.max(FIG_VIEW.y, Math.min(FIG_VIEW.y + FIG_VIEW.h, p.y))];
  }

  function drawLive(): void {
    const layer = ctrl.layer(st().selected);
    if (!drawing || !layer) return;
    const stroke = strokeFromPoints(st().view, st().brush, drawing.pts);
    const group = svgGroup(strokeSvg({ ...stroke, pts: drawing.pts.length < 2 ? stroke.pts : drawing.pts.flatMap(([x, y]) => [Math.round(x), Math.round(y)]) }, KIND_COLOR[layer.kind]));
    group.setAttribute("opacity", String(Math.max(layer.level, 3) / 10));
    drawing.marks.replaceChildren(group);
  }

  function attachPainting(svg: SVGSVGElement, marks: SVGGElement): void {
    svg.addEventListener("pointerdown", (e) => {
      if (drawing || !ctrl.layer(st().selected) || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      drawing = { id: e.pointerId, pts: [toFigure(svg, e)], marks, svg };
      drawLive();
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drawing || e.pointerId !== drawing.id) return;
      // Touch screens report faster than frames: take every sample, drop only the ones that did not move.
      const samples = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const s of samples.length ? samples : [e]) {
        const pt = toFigure(svg, s);
        const last = drawing.pts[drawing.pts.length - 1] as [number, number];
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 1) drawing.pts.push(pt);
      }
      drawLive();
    });
    svg.addEventListener("pointerup", (e) => {
      if (!drawing || e.pointerId !== drawing.id) return;
      const pts = drawing.pts;
      drawing = null;
      void ctrl.paint(pts);
      if (renderLater) { renderLater = false; render(); }
    });
    const abandon = (e: PointerEvent) => { if (drawing && e.pointerId === drawing.id) { drawing = null; marks.replaceChildren(); if (renderLater) { renderLater = false; render(); } } };
    svg.addEventListener("pointercancel", abandon);
  }

  function figure(): HTMLElement {
    const view = st().view;
    const armed = ctrl.layer(st().selected) !== undefined;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 " + FIG_VIEW.y + " " + FIG_W + " " + FIG_VIEW.h);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", (view === "front" ? "Front" : "Back") + " view of the body." + (armed ? " Drag to paint." : ""));
    svg.setAttribute("class", "figure" + (armed ? " armed" : ""));
    svg.setAttribute("data-role", "figure");
    let base = parsedFigure.get(view);
    if (!base) { base = svgGroup(figureSvg(view)); parsedFigure.set(view, base); }
    svg.append(base.cloneNode(true));
    svg.append(svgGroup(layers().filter((l) => l.level > 0).map((l) => layerSvg(l, view)).join("")));
    const marks = document.createElementNS("http://www.w3.org/2000/svg", "g");
    marks.setAttribute("data-role", "live");
    svg.append(marks);
    attachPainting(svg, marks);
    return h("div", { class: "stage" }, svg);
  }

  // ---- small parts -------------------------------------------------------------------------------------------------
  const chips = (current: Kind, onPick: (k: Kind) => void, label = "Kind of feeling"): HTMLElement =>
    h("div", { class: "chips", role: "group", "aria-label": label },
      ...KINDS.map((k) => h("button", { type: "button", class: "chip kind-" + k, "aria-pressed": current === k, "data-role": "kind-" + k, onclick: () => onPick(k) }, h("span", { class: "dot kind-" + k, "aria-hidden": "true" }), KIND_LABEL[k])));

  function topBar(): HTMLElement {
    const revision = st().snap?.state.revision ?? null;
    return h("header", { class: "top" },
      h("button", { type: "button", class: "title", "data-role": "refresh", onclick: () => { void ctrl.retry(); } },
        h("span", { class: "name" }, "Body map"),
        h("span", { class: "status", "data-role": "status", role: "status" }, statusText(st().conn, revision))),
      h("button", { type: "button", class: "icon-btn", "data-role": "about", "aria-label": "About and settings", onclick: () => { screen = "about"; confirmForget = false; render(); } }, icon("info")));
  }

  function banner(): HTMLElement | null {
    const b = st().banner;
    if (!b) return null;
    const label = b.action === "dismiss" ? "Dismiss" : "Try again";
    return h("div", { class: "banner" + (b.action === "dismiss" ? " notice" : ""), role: "alert", "data-role": "banner" },
      h("span", { class: "banner-text" }, b.text),
      h("button", { type: "button", class: "btn", "data-role": "banner-action", onclick: () => { if (b.action === "dismiss") ctrl.dismiss(); else void ctrl.retry(); } }, label),
      b.action === "retry_load" && backend.fallbackHint ? h("span", { class: "fallback" }, backend.fallbackHint) : null);
  }

  function segBar(): HTMLElement {
    const count = marksPerView(layers());
    const seg = (v: View, label: string) =>
      h("button", { type: "button", class: "seg", "aria-pressed": st().view === v, "data-role": "view-" + v, onclick: () => ctrl.setView(v) }, label, count[v] ? h("span", { class: "count" }, String(count[v])) : null);
    return h("div", { class: "segs views", role: "group", "aria-label": "Which side of the body" }, seg("front", "Front"), seg("back", "Back"));
  }

  function paintBar(): HTMLElement {
    const selected = ctrl.layer(st().selected);
    const brushes = h("div", { class: "segs brushes", role: "group", "aria-label": "Brush size" },
      ...BRUSHES.map((b) => h("button", { type: "button", class: "seg", "aria-label": b.name, "aria-pressed": st().brush === b.r, "data-role": "brush-" + b.id, onclick: () => ctrl.setBrush(b.r) }, h("span", { class: "brush-dot brush-" + b.id, "aria-hidden": "true" }))));
    const undo = st().undo;
    const undoBtn = h("button", { type: "button", class: "btn undo", "data-role": "undo", disabled: !undo, "aria-label": undo ? "Undo " + undo : "Undo", onclick: () => { void ctrl.undo(); } }, icon("undo"), "Undo");
    if (layers().length === 0) {
      return h("div", { class: "paintbar" }, h("p", { class: "hint", "data-role": "empty" }, "Nothing is marked. Add a mark, then paint where it is."),
        h("button", { type: "button", class: "btn primary wide", "data-role": "first-mark", onclick: () => { sheet = true; newOpen = true; render(); } }, "Add a mark"));
    }
    const target = selected
      ? h("button", { type: "button", class: "target", "data-role": "target", onclick: () => { sheet = true; editing = null; render(); } },
          h("span", { class: "dot kind-" + selected.kind, "aria-hidden": "true" }), h("span", { class: "target-name" }, "Painting ", h("b", {}, selected.name)), h("span", { class: "target-level" }, levelLabel(selected.level)))
      : h("button", { type: "button", class: "target none", "data-role": "target", onclick: () => { sheet = true; render(); } }, h("span", { class: "target-name" }, "Choose a mark to paint"));
    const add = h("button", { type: "button", class: "icon-btn boxed", "data-role": "new-mark", "aria-label": "New mark", onclick: () => { sheet = true; newOpen = true; render(); } }, icon("plus"));
    return h("div", { class: "paintbar" }, h("div", { class: "row" }, target, add), h("div", { class: "row" }, brushes, undoBtn));
  }

  function handle(): HTMLElement {
    const active = layers().filter((l) => l.level > 0).length;
    const cleared = layers().length - active;
    return h("button", { type: "button", class: "handle", "data-role": "marks-open", "aria-expanded": false, onclick: () => { sheet = true; render(); } },
      h("span", { class: "grip", "aria-hidden": "true" }), h("span", { class: "handle-title" }, "Marks"),
      h("span", { class: "handle-count" }, layers().length === 0 ? "none yet" : active + " active" + (cleared ? ", " + cleared + " cleared" : "")), icon("chevron-up"));
  }

  // ---- the Marks sheet ---------------------------------------------------------------------------------------------
  function markRow(layer: Layer, index: number | null): HTMLElement {
    const cleared = layer.level === 0;
    const isEditing = editing === layer.id;
    const painting = st().selected === layer.id;
    const readout = h("output", { class: "level", "data-role": "level" }, levelLabel(layer.level));
    const slider = h("input", { type: "range", min: 0, max: LIMITS.maxLevel, step: 1, value: String(layer.level), class: "slider", "aria-label": layer.name + " level", "data-role": "slider" });
    const fill = (level: number) => slider.style.setProperty("--p", String(level / LIMITS.maxLevel));
    fill(layer.level);
    slider.addEventListener("input", () => {
      fill(Number(slider.value));
      readout.textContent = levelLabel(Number(slider.value));
      readout.classList.toggle("is-cleared", slider.value === "0");
      root.querySelector('[data-layer="' + layer.id + '"]')?.setAttribute("opacity", String(Number(slider.value) / 10));
    });
    slider.addEventListener("change", () => { void ctrl.setLevel(layer.id, Number(slider.value)); });
    if (cleared) readout.classList.add("is-cleared");

    const nameValue = draft.rename[layer.id] ?? layer.name;
    const nameInput = h("input", { type: "text", class: "text", value: nameValue, maxlength: LIMITS.maxNameLength, "aria-label": "Mark name", "data-key": "rename-" + layer.id, "data-role": "rename" });
    nameInput.addEventListener("input", () => { draft.rename[layer.id] = nameInput.value; });
    const save = () => { const name = nameInput.value.trim(); delete draft.rename[layer.id]; void ctrl.rename(layer.id, name); };
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });

    const details = isEditing
      ? h("div", { class: "details" },
          h("div", { class: "row" }, nameInput, h("button", { type: "button", class: "btn", "data-role": "rename-save", onclick: save }, "Rename")),
          chips(layer.kind, (k) => { void ctrl.setKind(layer.id, k); }),
          confirming === layer.id
            ? h("div", { class: "confirm" }, h("p", {}, "Remove ", h("b", {}, layer.name), " for good? Its marks go with it."),
                h("div", { class: "row" },
                  h("button", { type: "button", class: "btn danger", "data-role": "confirm-delete", onclick: () => { confirming = null; editing = null; void ctrl.remove(layer.id); } }, "Remove"),
                  h("button", { type: "button", class: "btn", "data-role": "keep", onclick: () => { confirming = null; render(); } }, "Keep")))
            : h("button", { type: "button", class: "btn danger", "data-role": "delete", onclick: () => { confirming = layer.id; render(); } }, "Remove mark"))
      : null;

    return h("li", { class: "mark" + (cleared ? " cleared" : ""), "data-role": "mark", "data-name": layer.name, "data-id": layer.id },
      h("div", { class: "mark-head" }, h("span", { class: "dot kind-" + layer.kind, "aria-hidden": "true" }),
        h("span", { class: "mark-title" }, h("span", { class: "mark-name" }, (index ? index + ". " : "") + layer.name),
          h("span", { class: "meta" }, markMeta(layer), layer.by === "claude" ? h("span", { class: "tag" }, "added by Claude") : null)), readout),
      slider,
      h("div", { class: "mark-foot" },
        h("button", { type: "button", class: "btn small", "aria-pressed": painting, "data-role": "paint", onclick: () => { st().selected === layer.id ? ctrl.select(null) : ctrl.select(layer.id); sheet = false; render(); } }, painting ? "Painting" : "Paint"),
        h("button", { type: "button", class: "btn small", "aria-expanded": isEditing, "data-role": "edit", onclick: () => { editing = isEditing ? null : layer.id; confirming = null; render(); } }, isEditing ? "Close" : "Edit")),
      details);
  }

  function newMark(): HTMLElement {
    const full = layers().length >= LIMITS.maxLayers;
    if (!newOpen && layers().length > 0) {
      return h("button", { type: "button", class: "btn wide", "data-role": "new-open", disabled: full, onclick: () => { newOpen = true; render(); } }, icon("plus"), full ? "The map holds " + LIMITS.maxLayers + " marks" : "New mark");
    }
    const input = h("input", { type: "text", class: "text", value: draft.newName, maxlength: LIMITS.maxNameLength, placeholder: "Name, e.g. left shoulder", "aria-label": "Name of the new mark", "data-key": "new-name", "data-role": "new-name", enterkeyhint: "done" });
    const add = h("button", { type: "button", class: "btn primary", "data-role": "add", disabled: !draft.newName.trim() || full }, "Add mark");
    input.addEventListener("input", () => { draft.newName = input.value; add.disabled = !draft.newName.trim() || full; });
    const submit = async () => {
      const name = draft.newName.trim();
      if (!name) return;
      draft.newName = "";
      newOpen = false;
      sheet = false;
      await ctrl.addMark(name, draft.newKind);
      render();
    };
    add.addEventListener("click", () => { void submit(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") void submit(); });
    return h("form", { class: "newmark", onsubmit: (e: Event) => e.preventDefault() }, h("h2", {}, "New mark"), input, chips(draft.newKind, (k) => { draft.newKind = k; render(); }), h("div", { class: "row" }, add, layers().length ? h("button", { type: "button", class: "btn", "data-role": "new-cancel", onclick: () => { newOpen = false; render(); } }, "Cancel") : null));
  }

  function sheetPanel(): HTMLElement {
    let n = 0;
    const rows = layers().map((l) => markRow(l, l.level > 0 ? ++n : null));
    return h("section", { class: "sheet", role: "dialog", "aria-label": "Marks", "data-role": "sheet" },
      h("header", { class: "sheet-head" }, h("span", { class: "grip", "aria-hidden": "true" }), h("h2", {}, "Marks"),
        h("button", { type: "button", class: "btn small borderless", "data-role": "undo-sheet", disabled: !st().undo, "aria-label": st().undo ? "Undo " + st().undo : "Undo", onclick: () => { void ctrl.undo(); } }, icon("undo"), "Undo"),
        h("button", { type: "button", class: "icon-btn", "data-role": "marks-close", "aria-label": "Close marks", onclick: () => { sheet = false; editing = null; confirming = null; render(); } }, icon("close"))),
      h("div", { class: "sheet-body", "data-scroll": "sheet" }, newMark(), h("ul", { class: "marks", "data-role": "layers" }, ...rows)));
  }

  // ---- other screens -----------------------------------------------------------------------------------------------
  function setupScreen(): HTMLElement {
    const askServer = backend.setup !== undefined;
    const c = st().conn;
    const message = setupError || (c.is === "needs_token" ? c.message : "");
    const server = h("input", { type: "url", class: "text", value: draft.server, autocomplete: "url", autocapitalize: "none", spellcheck: false, "aria-label": "Server address", "data-key": "server", "data-role": "server", inputmode: "url" });
    server.addEventListener("input", () => { draft.server = server.value; });
    const token = h("input", { type: "password", class: "text", value: draft.token, autocomplete: "off", autocapitalize: "none", spellcheck: false, "aria-label": "Access token", "data-key": "token", "data-role": "token" });
    token.addEventListener("input", () => { draft.token = token.value; });
    const go = async () => {
      setupError = "";
      const value = draft.token.trim();
      if (!value) { setupError = "Paste the access token."; render(); return; }
      setupBusy = true;
      render();
      try {
        if (backend.setup) await ctrl.connect(draft.server, value);
        else { backend.setToken?.(value); await ctrl.load(); }
        const after = st().conn;
        if (after.is === "needs_token") setupError = after.message || "That token was not accepted.";
        else if (after.is === "offline" && !st().snap) setupError = after.message;
        else { screen = "main"; draft.token = ""; }
      } catch (error) {
        setupError = error instanceof Error ? error.message : String(error);
      }
      setupBusy = false;
      render();
    };
    token.addEventListener("keydown", (e) => { if (e.key === "Enter") void go(); });
    return h("main", { class: "page setup", "data-role": "token-form" },
      h("h1", {}, "Body map"),
      h("p", { class: "lead" }, askServer ? "Connect to your body map server. You need its address and the web token." : "Paste the web token once. It stays in this browser only."),
      askServer ? h("label", { class: "field" }, h("span", {}, "Server address"), server) : null,
      h("label", { class: "field" }, h("span", {}, "Access token"), token),
      message ? h("p", { class: "error", role: "alert", "data-role": "setup-error" }, message) : null,
      h("button", { type: "button", class: "btn primary wide", "data-role": "connect", disabled: setupBusy, onclick: () => { void go(); } }, setupBusy ? "Connecting" : "Connect"),
      screen === "setup" && st().snap ? h("button", { type: "button", class: "btn wide", onclick: () => { screen = "about"; render(); } }, "Back") : null);
  }

  function aboutScreen(): HTMLElement {
    const server = backend.setup?.server ?? null;
    const canForget = backend.setup !== undefined || backend.setToken !== undefined;
    return h("main", { class: "page about", "data-role": "about-screen" },
      h("header", { class: "page-head" },
        h("button", { type: "button", class: "icon-btn", "data-role": "about-back", "aria-label": "Back", onclick: () => { screen = "main"; render(); } }, icon("back")), h("h1", {}, "About")),
      h("section", { class: "block" }, h("h2", {}, "Body map"), h("p", { class: "meta" }, "Version " + (options.version ?? "dev")),
        server ? h("p", { class: "meta" }, "Server: ", h("span", { class: "mono" }, server)) : null,
        h("p", { class: "meta" }, st().snap ? st().snap!.state.layers.length + " marks, revision " + st().snap!.state.revision : "Not loaded")),
      backend.setup ? h("button", { type: "button", class: "btn wide", "data-role": "change-server", onclick: () => { draft.server = backend.setup?.server ?? draft.server; setupError = ""; screen = "setup"; render(); } }, "Change server or token") : null,
      canForget ? (confirmForget
        ? h("div", { class: "confirm" }, h("p", {}, "Forget the token on this device? The marks stay on the server."), h("div", { class: "row" },
            h("button", { type: "button", class: "btn danger", "data-role": "confirm-forget", onclick: () => { confirmForget = false; screen = "main"; void ctrl.forget().then(render); } }, "Forget"),
            h("button", { type: "button", class: "btn", onclick: () => { confirmForget = false; render(); } }, "Keep")))
        : h("button", { type: "button", class: "btn danger wide", "data-role": "forget", onclick: () => { confirmForget = true; render(); } }, "Forget token")) : null,
      h("section", { class: "block" }, h("h2", {}, "Figure"),
        h("pre", { class: "notice attribution", "data-role": "notice" }, attributionText(options.notice ?? "")),
        h("button", { type: "button", class: "btn wide", "data-role": "full-notice", "aria-expanded": fullNotice, onclick: () => { fullNotice = !fullNotice; render(); } }, fullNotice ? "Hide the full notice" : "Show the full notice"),
        fullNotice ? h("pre", { class: "notice", "data-role": "full-notice-text" }, options.notice ?? "") : null));
  }

  function offlineScreen(): HTMLElement {
    const c = st().conn;
    return h("main", { class: "page", "data-role": "load-error" },
      h("h1", {}, "Cannot load the body map"), h("p", { class: "lead" }, c.is === "offline" ? c.message : "Something went wrong."),
      backend.setup?.server ? h("p", { class: "meta" }, "Server: ", h("span", { class: "mono" }, backend.setup.server)) : null,
      h("button", { type: "button", class: "btn primary wide", "data-role": "retry", onclick: () => { void ctrl.retry(); } }, "Try again"),
      backend.setup ? h("button", { type: "button", class: "btn wide", "data-role": "change-server", onclick: () => { screen = "setup"; setupError = ""; render(); } }, "Change server or token") : null,
      backend.fallbackHint ? h("p", { class: "meta" }, backend.fallbackHint) : null);
  }

  // ---- the whole screen --------------------------------------------------------------------------------------------
  function render(): void {
    if (drawing) { renderLater = true; return; }
    const active = document.activeElement;
    const focus = active instanceof HTMLInputElement && active.dataset["key"] ? { key: active.dataset["key"], start: active.selectionStart, end: active.selectionEnd } : null;
    const scroll = root.querySelector<HTMLElement>('[data-scroll="sheet"]')?.scrollTop ?? 0;
    const conn = st().conn;
    const wantsSetup = screen === "setup" || (conn.is === "needs_token" && screen !== "about");
    let body: HTMLElement;
    if (wantsSetup) body = setupScreen();
    else if (screen === "about") body = aboutScreen();
    else if (!st().snap) body = conn.is === "offline" ? offlineScreen() : h("main", { class: "page", "data-role": "loading" }, h("p", { class: "lead" }, "Loading the body map"));
    else {
      body = h("main", { class: "main" + (sheet ? " sheet-open" : "") },
        topBar(), banner(), segBar(), figure(), sheet ? null : paintBar(), sheet ? sheetPanel() : handle());
    }
    root.replaceChildren(body);
    root.querySelector<HTMLElement>('[data-scroll="sheet"]')?.scrollTo(0, scroll);
    if (focus) {
      const el = root.querySelector<HTMLInputElement>('[data-key="' + focus.key + '"]');
      el?.focus();
      if (el && focus.start !== null && focus.end !== null) el.setSelectionRange(focus.start, focus.end);
    }
  }

  ctrl.subscribe(render);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && st().snap && st().conn.is === "synced") void ctrl.load(); });
  render();
  void ctrl.load();

  return {
    controller: ctrl,
    prefill(server, token) { draft.server = server; draft.token = token; setupError = ""; screen = "setup"; render(); },
  };
}
