// The interface, shared by the MCP App and the plain web page. Both give it a Backend and nothing else.
// No animation anywhere. Big touch targets. Every empty and failing state says what to do.
import { figureSvg, layerSvg, strokeSvg } from "../figure.ts";
import { FIG_H, FIG_W, KIND_COLOR, KINDS, LIMITS, type Edit, type EditReply, type Kind, type Layer, type MapState, type Stroke, type View } from "../types.ts";
import { h, svgGroup } from "./dom.ts";
import { simplify } from "./simplify.ts";

export type Snapshot = { state: MapState; claudeMaxLevel: number };
export type Backend = {
  load(): Promise<Snapshot>;
  edit(base: number, edit: Edit): Promise<EditReply>;
  /** Where to send Alex when this surface cannot load or save. */
  fallbackHint?: string;
  /** The web page asks for a token; the MCP App never does. */
  setToken?(token: string): void;
};
export class NeedsToken extends Error {}

const BRUSHES = [{ label: "Small", r: 8 }, { label: "Medium", r: 16 }, { label: "Large", r: 28 }];
const KIND_HELP: Record<Kind, string> = { tense: "Tense", pinched: "Pinched", sharp: "Sharp" };
const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

type Banner = { tone: "error" | "info"; text: string; retry?: boolean };
type Undo = { label: string; edit: Edit };

export function mountUi(root: HTMLElement, backend: Backend): void {
  let snap: Snapshot | null = null;
  let view: View = "front";
  let selected: string | null = null;
  let brush = 16;
  let status = "Loading";
  let banner: Banner | null = null;
  let undo: Undo[] = [];
  let open: string | null = null;
  let confirmDelete: string | null = null;
  let draftName = "";
  let draftKind: Kind = "tense";
  let needsToken: string | null = null;
  let drawing: { pts: [number, number][]; live: SVGPathElement | SVGCircleElement | null } | null = null;
  let renderLater = false;
  let queue: Promise<void> = Promise.resolve();

  const layerById = (id: string | null): Layer | undefined => snap?.state.layers.find((l) => l.id === id);

  async function load(): Promise<void> {
    status = "Loading";
    render();
    try {
      snap = await backend.load();
      needsToken = null;
      banner = null;
      status = "Up to date";
      if (selected && !layerById(selected)) selected = null;
    } catch (error) {
      if (error instanceof NeedsToken) needsToken = error.message || "";
      else banner = { tone: "error", text: "Could not load the body map. " + (error as Error).message, retry: true };
      status = "Not loaded";
    }
    render();
  }

  /** One change at a time, in order. A failed or refused change never blocks the next. */
  function run(edit: Edit, undoEdit?: (reply: Extract<EditReply, { ok: true }>) => Undo | null): Promise<void> {
    queue = queue.then(async () => {
      if (!snap) return;
      status = "Saving";
      render();
      try {
        const reply = await backend.edit(snap.state.revision, edit);
        snap = { ...snap, state: reply.state };
        if (reply.ok) {
          banner = null;
          status = "Saved";
          const entry = undoEdit?.(reply);
          if (entry) undo.push(entry);
          if (edit.op === "add_layer" && reply.layerId) { selected = reply.layerId; draftName = ""; }
        } else {
          undo = [];
          status = "Not saved";
          banner = { tone: "error", text: reply.error === "conflict" ? "This changed somewhere else, so it was not applied. The screen is now up to date. Try again." : reply.message };
        }
      } catch (error) {
        if (error instanceof NeedsToken) needsToken = error.message || "";
        else banner = { tone: "error", text: "Could not save. " + (error as Error).message, retry: true };
        status = "Not saved";
      }
      render();
    });
    return queue;
  }

  // ---- painting ----------------------------------------------------------------------------------------------
  function toFigure(svg: SVGSVGElement, e: PointerEvent): [number, number] {
    const m = svg.getScreenCTM();
    const p = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : new DOMPoint(0, 0);
    return [Math.max(0, Math.min(FIG_W, p.x)), Math.max(0, Math.min(FIG_H, p.y))];
  }

  function liveStroke(layer: Layer, pts: [number, number][]): string {
    const flat = pts.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
    const stroke: Stroke = { view, r: brush, pts: flat.length >= 4 ? flat : [...flat, ...flat] };
    return strokeSvg(stroke, KIND_COLOR[layer.kind]);
  }

  function finishStroke(layer: Layer): void {
    if (!drawing) return;
    let pts = drawing.pts;
    drawing = null;
    let epsilon = 1.5;
    let simple = simplify(pts, epsilon);
    while (simple.length > LIMITS.maxPointsPerStroke) simple = simplify(pts, (epsilon *= 2));
    pts = simple;
    const flat = pts.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
    const stroke: Stroke = { view, r: brush, pts: flat.length >= 4 ? flat : [...flat, ...flat] };
    void run({ op: "add_stroke", layerId: layer.id, stroke }, () => ({ label: "paint stroke", edit: { op: "remove_last_stroke", layerId: layer.id } }));
    if (renderLater) { renderLater = false; render(); }
  }

  function attachPainting(svg: SVGSVGElement, marks: SVGGElement): void {
    svg.addEventListener("pointerdown", (e) => {
      const layer = layerById(selected);
      if (!layer) return;
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const pt = toFigure(svg, e);
      drawing = { pts: [pt], live: null };
      marks.replaceChildren(svgGroup(liveStroke(layer, drawing.pts)));
      (marks.firstElementChild as SVGElement).setAttribute("opacity", String(Math.max(layer.level, 3) / 10));
    });
    svg.addEventListener("pointermove", (e) => {
      const layer = layerById(selected);
      if (!drawing || !layer) return;
      const pt = toFigure(svg, e);
      const last = drawing.pts[drawing.pts.length - 1] as [number, number];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 2) return;
      drawing.pts.push(pt);
      marks.replaceChildren(svgGroup(liveStroke(layer, drawing.pts)));
      (marks.firstElementChild as SVGElement).setAttribute("opacity", String(Math.max(layer.level, 3) / 10));
    });
    const end = () => { const layer = layerById(selected); if (drawing && layer) finishStroke(layer); else drawing = null; };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", () => { drawing = null; marks.replaceChildren(); });
  }

  // ---- pieces ------------------------------------------------------------------------------------------------
  function picture(): HTMLElement {
    const state = (snap as Snapshot).state;
    const armed = layerById(selected) !== undefined;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + FIG_W + " " + FIG_H);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", (view === "front" ? "Front" : "Back") + " view of the body. " + (armed ? "Drag to paint." : ""));
    svg.setAttribute("class", "figure" + (armed ? " armed" : ""));
    svg.setAttribute("data-role", "figure");
    svg.append(svgGroup(figureSvg(view)));
    svg.append(svgGroup(state.layers.filter((l) => l.level > 0).map((l) => layerSvg(l, view)).join("")));
    const marks = document.createElementNS("http://www.w3.org/2000/svg", "g");
    marks.setAttribute("data-role", "live");
    svg.append(marks);
    attachPainting(svg, marks);
    return h("div", { class: "stage" }, svg);
  }

  function viewToggle(): HTMLElement {
    const state = (snap as Snapshot).state;
    const count = (v: View) => state.layers.filter((l) => l.level > 0 && l.strokes.some((s) => s.view === v)).length;
    const btn = (v: View, label: string) =>
      h("button", { type: "button", class: "seg", "aria-pressed": view === v, "data-role": "view-" + v, onclick: () => { view = v; render(); } }, label + (count(v) ? " (" + count(v) + ")" : ""));
    return h("div", { class: "segs", role: "group", "aria-label": "Which side of the body" }, btn("front", "Front"), btn("back", "Back"));
  }

  function toolbar(): HTMLElement {
    const last = undo[undo.length - 1];
    const layer = layerById(selected);
    return h(
      "div",
      { class: "toolbar" },
      h("div", { class: "segs brushes", role: "group", "aria-label": "Brush size" }, ...BRUSHES.map((b) => h("button", { type: "button", class: "seg", "aria-pressed": brush === b.r, onclick: () => { brush = b.r; render(); } }, b.label))),
      h("button", { type: "button", class: "btn", "data-role": "undo", disabled: !last, onclick: () => { const entry = undo.pop(); if (entry) void run(entry.edit); } }, last ? "Undo " + last.label : "Undo"),
      layer ? h("button", { type: "button", class: "btn", "data-role": "stop", onclick: () => { selected = null; render(); } }, "Stop painting") : null,
    );
  }

  function paintHint(): HTMLElement {
    const state = (snap as Snapshot).state;
    const layer = layerById(selected);
    if (state.layers.length === 0) return h("p", { class: "hint", "data-role": "empty" }, "Nothing is marked. Name a mark below, then paint on the body where it is.");
    if (!layer) return h("p", { class: "hint" }, "Tap Paint on a layer, then draw on the body. Until then, swiping scrolls the page.");
    return h(
      "p",
      { class: "hint armed-hint", "data-role": "painting-into" },
      "Painting into ",
      h("b", {}, layer.name),
      layer.level === 0 ? ". It is cleared, so the mark will not show until you raise its slider." : ".",
    );
  }

  function kindButtons(current: Kind, onPick: (k: Kind) => void): HTMLElement {
    return h("div", { class: "segs", role: "group", "aria-label": "Kind of feeling" }, ...KINDS.map((k) => h("button", { type: "button", class: "seg kind-" + k, "aria-pressed": current === k, onclick: () => onPick(k) }, KIND_HELP[k])));
  }

  function layerRow(layer: Layer, index: number | null): HTMLElement {
    const cleared = layer.level === 0;
    const isOpen = open === layer.id;
    const slider = h("input", { type: "range", min: 0, max: LIMITS.maxLevel, step: 1, value: String(layer.level), class: "slider", "aria-label": layer.name + " level", "data-role": "slider" });
    const readout = h("output", { class: "level", "data-role": "level" }, String(layer.level));
    slider.addEventListener("input", () => {
      readout.textContent = slider.value;
      const group = root.querySelector('[data-layer="' + layer.id + '"]');
      if (group) group.setAttribute("opacity", String(Number(slider.value) / 10));
    });
    slider.addEventListener("change", () => {
      const level = Number(slider.value);
      if (level === layer.level) return;
      const was = layer.level;
      void run({ op: "set_level", layerId: layer.id, level }, () => ({ label: level === 0 ? "clear" : "level change", edit: { op: "set_level", layerId: layer.id, level: was } }));
    });
    const nameInput = h("input", { type: "text", class: "text", value: layer.name, maxlength: LIMITS.maxNameLength, "aria-label": "Layer name" });
    const saveName = () => {
      const name = nameInput.value.trim();
      if (!name || name === layer.name) return;
      const old = layer.name;
      void run({ op: "rename", layerId: layer.id, name }, () => ({ label: "rename", edit: { op: "rename", layerId: layer.id, name: old } }));
    };
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveName(); });
    const painting = selected === layer.id;
    return h(
      "li",
      { class: "layer" + (cleared ? " cleared" : ""), "data-role": "layer", "data-name": layer.name },
      h(
        "div",
        { class: "layer-head" },
        h("span", { class: "dot kind-" + layer.kind, "aria-hidden": "true" }),
        h("span", { class: "layer-name" }, (index ? "#" + index + " " : "") + layer.name),
        readout,
        h("button", { type: "button", class: "btn paint", "aria-pressed": painting, "data-role": "paint", onclick: () => { selected = painting ? null : layer.id; render(); } }, painting ? "Painting" : "Paint"),
      ),
      slider,
      h("div", { class: "layer-meta" },
        h("span", {}, cleared ? "Cleared " + dayOf(layer.clearedAt) + ". Raise the slider to bring it back." : KIND_HELP[layer.kind] + ", since " + dayOf(layer.activeSince)),
        layer.by === "claude" ? h("span", { class: "tag" }, "added by Claude") : null,
        h("button", { type: "button", class: "link", "aria-expanded": isOpen, onclick: () => { open = isOpen ? null : layer.id; confirmDelete = null; render(); } }, isOpen ? "Close" : "Edit"),
      ),
      isOpen
        ? h("div", { class: "details" },
            h("div", { class: "row" }, nameInput, h("button", { type: "button", class: "btn", onclick: saveName }, "Rename")),
            kindButtons(layer.kind, (k) => { if (k !== layer.kind) { const was = layer.kind; void run({ op: "set_kind", layerId: layer.id, kind: k }, () => ({ label: "kind change", edit: { op: "set_kind", layerId: layer.id, kind: was } })); } }),
            confirmDelete === layer.id
              ? h("div", { class: "row confirm" }, h("span", {}, "Remove this layer for good? This cannot be undone."),
                  h("button", { type: "button", class: "btn danger", "data-role": "confirm-delete", onclick: () => { confirmDelete = null; open = null; if (selected === layer.id) selected = null; undo = undo.filter((u) => !("layerId" in u.edit) || u.edit.layerId !== layer.id); void run({ op: "delete_layer", layerId: layer.id }); } }, "Remove"),
                  h("button", { type: "button", class: "btn", onclick: () => { confirmDelete = null; render(); } }, "Keep"))
              : h("button", { type: "button", class: "btn danger", "data-role": "delete", onclick: () => { confirmDelete = layer.id; render(); } }, "Remove layer"),
          )
        : null,
    );
  }

  function layerList(): HTMLElement {
    const state = (snap as Snapshot).state;
    let n = 0;
    const rows = state.layers.map((l) => layerRow(l, l.level > 0 ? ++n : null));
    return h("ul", { class: "layers", "data-role": "layers" }, ...rows);
  }

  function newMark(): HTMLElement {
    const state = (snap as Snapshot).state;
    const full = state.layers.length >= LIMITS.maxLayers;
    const input = h("input", { type: "text", class: "text", value: draftName, maxlength: LIMITS.maxNameLength, placeholder: "Name, e.g. left shoulder", "aria-label": "Name of the new mark", "data-role": "new-name" });
    input.addEventListener("input", () => { draftName = input.value; add.disabled = !draftName.trim() || full; });
    const submit = () => { const name = draftName.trim(); if (!name) return; void run({ op: "add_layer", name, kind: draftKind, level: 5 }, (reply) => (reply.layerId ? { label: "new mark", edit: { op: "delete_layer", layerId: reply.layerId } } : null)); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    const add = h("button", { type: "button", class: "btn primary", "data-role": "add", disabled: !draftName.trim() || full, onclick: submit }, "Add mark");
    return h("form", { class: "newmark", onsubmit: (e: Event) => e.preventDefault() },
      h("h2", {}, "New mark"),
      full ? h("p", { class: "hint" }, "The map holds " + LIMITS.maxLayers + " layers. Remove one to add another.") : null,
      input, kindButtons(draftKind, (k) => { draftKind = k; render(); }), add);
  }

  function tokenForm(): HTMLElement {
    const input = h("input", { type: "password", class: "text", autocomplete: "current-password", "aria-label": "Access token", "data-role": "token" });
    const go = () => { if (input.value.trim()) { backend.setToken?.(input.value.trim()); void load(); } };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    return h("div", { class: "card", "data-role": "token-form" },
      h("h2", {}, "Access token"),
      h("p", {}, needsToken ? needsToken : "Paste the web token once. It stays in this browser only."),
      input, h("button", { type: "button", class: "btn primary", onclick: go }, "Open the map"));
  }

  function render(): void {
    if (drawing) { renderLater = true; return; }
    const keep = document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.role === "new-name" ? { start: document.activeElement.selectionStart } : null;
    const head = h("header", { class: "top" }, h("h1", {}, "Body map"), h("span", { class: "status", "data-role": "status", role: "status" }, status + (snap ? ", revision " + snap.state.revision : "")),
      h("button", { type: "button", class: "btn", "data-role": "refresh", onclick: () => { void load(); } }, "Refresh"));
    const kids: (Node | null)[] = [head];
    if (banner) {
      kids.push(h("div", { class: "banner " + banner.tone, role: "alert", "data-role": "banner" }, h("span", {}, banner.text), banner.retry ? h("button", { type: "button", class: "btn", onclick: () => { void load(); } }, "Try again") : null,
        backend.fallbackHint && banner.tone === "error" ? h("span", { class: "fallback" }, backend.fallbackHint) : null));
    }
    if (needsToken !== null) kids.push(tokenForm());
    else if (snap) kids.push(h("div", { class: "left" }, viewToggle(), toolbar(), paintHint(), picture()), h("div", { class: "right" }, layerList(), newMark()));
    else if (!banner) kids.push(h("p", { class: "hint" }, "Loading the map"));
    root.replaceChildren(h("main", {}, ...kids));
    if (keep) { const el = root.querySelector<HTMLInputElement>('[data-role="new-name"]'); el?.focus(); if (keep.start !== null) el?.setSelectionRange(keep.start, keep.start); }
  }

  void load();
}
