// What the screen shows and what Alex's taps do, with no DOM in it: a fake backend and a plain test can drive it.
// Edits go to the server one at a time, in order. A failed or refused edit never blocks the next one.
import { LIMITS, type Edit, type EditReply, type Kind, type Layer, type View } from "../types.ts";
import { NeedsToken, type Backend, type Snapshot } from "./backend.ts";
import { DEFAULT_BRUSH, strokeFromPoints } from "./logic.ts";

/** Where the data stands. One value, so the screen cannot say two things at once. */
export type Conn =
  | { is: "loading" }
  | { is: "synced" }
  | { is: "saving" }
  | { is: "offline"; message: string }
  | { is: "needs_token"; message: string };

export type Banner = { text: string; action: "retry_load" | "retry_edit" | "dismiss" };
type Undo = { label: string; edit: Edit };
type Pending = { edit: Edit; undoOf?: (reply: Extract<EditReply, { ok: true }>) => Undo | null };

export type UiState = {
  snap: Snapshot | null;
  conn: Conn;
  view: View;
  brush: number;
  /** The mark that new strokes go into, or null. */
  selected: string | null;
  banner: Banner | null;
  /** What Undo would do, or null when there is nothing to undo. */
  undo: string | null;
};

export class Controller {
  state: UiState = { snap: null, conn: { is: "loading" }, view: "front", brush: DEFAULT_BRUSH, selected: null, banner: null, undo: null };
  readonly #backend: Backend;
  readonly #listeners = new Set<() => void>();
  #queue: Promise<void> = Promise.resolve();
  #inFlight = 0;
  #undo: Undo[] = [];
  #failed: Pending | null = null;

  constructor(backend: Backend) {
    this.#backend = backend;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch, undo: this.#undo[this.#undo.length - 1]?.label ?? null };
    for (const listener of this.#listeners) listener();
  }

  layer(id: string | null): Layer | undefined {
    return this.state.snap?.state.layers.find((l) => l.id === id);
  }

  // ---- reading ---------------------------------------------------------------------------------------------------
  async load(): Promise<void> {
    if (this.#inFlight > 0) return;
    this.#set({ conn: { is: "loading" } });
    try {
      const snap = await this.#backend.load();
      const keep = this.state.selected && snap.state.layers.some((l) => l.id === this.state.selected);
      this.#set({ snap, conn: { is: "synced" }, banner: null, selected: keep ? this.state.selected : null });
    } catch (error) {
      this.#fail(error, "retry_load");
    }
  }

  #fail(error: unknown, action: Banner["action"]): void {
    if (error instanceof NeedsToken) {
      this.#set({ conn: { is: "needs_token", message: error.message }, banner: null });
      return;
    }
    const why = error instanceof Error ? error.message : String(error);
    const offline = error instanceof TypeError || /failed to fetch|network|load failed|timeout|unable to resolve|connect/i.test(why);
    const text = offline ? "Cannot reach the server. Check the connection." : why;
    this.#set({ conn: { is: "offline", message: text }, banner: { text, action } });
  }

  // ---- what Alex does to the screen only -------------------------------------------------------------------------
  setView(view: View): void { this.#set({ view }); }
  setBrush(brush: number): void { this.#set({ brush }); }
  select(id: string | null): void { this.#set({ selected: id }); }
  dismiss(): void { this.#set({ banner: null }); }

  // ---- edits ------------------------------------------------------------------------------------------------------
  #run(pending: Pending): Promise<void> {
    this.#queue = this.#queue.then(async () => {
      const snap = this.state.snap;
      if (!snap) return;
      this.#inFlight++;
      this.#set({ conn: { is: "saving" } });
      try {
        const reply = await this.#backend.edit(snap.state.revision, pending.edit);
        const next: Partial<UiState> = { snap: { ...snap, state: reply.state } };
        if (reply.ok) {
          const entry = pending.undoOf?.(reply);
          if (entry) this.#undo.push(entry);
          if (pending.edit.op === "add_layer" && reply.layerId) next.selected = reply.layerId;
          this.#failed = null;
          this.#set({ ...next, conn: { is: "synced" }, banner: null });
        } else {
          this.#undo = [];
          const text = reply.error === "conflict" ? "This changed on another device, so your change was not applied. The screen is now up to date." : reply.message;
          this.#failed = null;
          this.#set({ ...next, conn: { is: "synced" }, banner: { text, action: "dismiss" } });
        }
      } catch (error) {
        this.#failed = error instanceof NeedsToken ? null : pending;
        this.#fail(error, "retry_edit");
      } finally {
        this.#inFlight--;
      }
    });
    return this.#queue;
  }

  retry(): Promise<void> {
    const failed = this.#failed;
    if (failed) { this.#failed = null; this.#set({ banner: null }); return this.#run(failed); }
    return this.load();
  }

  /** A finished drag. Goes into the selected mark; nothing happens when no mark is selected. */
  paint(points: readonly [number, number][]): Promise<void> {
    const layer = this.layer(this.state.selected);
    if (!layer || points.length === 0) return Promise.resolve();
    const stroke = strokeFromPoints(this.state.view, this.state.brush, points);
    return this.#run({ edit: { op: "add_stroke", layerId: layer.id, stroke }, undoOf: () => ({ label: "paint stroke", edit: { op: "remove_last_stroke", layerId: layer.id } }) });
  }

  setLevel(id: string, level: number): Promise<void> {
    const layer = this.layer(id);
    if (!layer || level === layer.level) return Promise.resolve();
    const was = layer.level;
    return this.#run({ edit: { op: "set_level", layerId: id, level }, undoOf: () => ({ label: level === 0 ? "clear" : "level change", edit: { op: "set_level", layerId: id, level: was } }) });
  }

  rename(id: string, name: string): Promise<void> {
    const layer = this.layer(id);
    const next = name.trim();
    if (!layer || !next || next === layer.name) return Promise.resolve();
    const was = layer.name;
    return this.#run({ edit: { op: "rename", layerId: id, name: next }, undoOf: () => ({ label: "rename", edit: { op: "rename", layerId: id, name: was } }) });
  }

  setKind(id: string, kind: Kind): Promise<void> {
    const layer = this.layer(id);
    if (!layer || layer.kind === kind) return Promise.resolve();
    const was = layer.kind;
    return this.#run({ edit: { op: "set_kind", layerId: id, kind }, undoOf: () => ({ label: "kind change", edit: { op: "set_kind", layerId: id, kind: was } }) });
  }

  remove(id: string): Promise<void> {
    this.#undo = this.#undo.filter((u) => !("layerId" in u.edit) || u.edit.layerId !== id);
    if (this.state.selected === id) this.#set({ selected: null });
    return this.#run({ edit: { op: "delete_layer", layerId: id } });
  }

  addMark(name: string, kind: Kind): Promise<void> {
    const n = name.trim();
    if (!n || (this.state.snap?.state.layers.length ?? 0) >= LIMITS.maxLayers) return Promise.resolve();
    return this.#run({ edit: { op: "add_layer", name: n, kind, level: 5 }, undoOf: (reply) => (reply.layerId ? { label: "new mark", edit: { op: "delete_layer", layerId: reply.layerId } } : null) });
  }

  undo(): Promise<void> {
    const entry = this.#undo.pop();
    if (!entry) return Promise.resolve();
    this.#set({});
    return this.#run({ edit: entry.edit });
  }

  // ---- the Android app's first run --------------------------------------------------------------------------------
  async connect(server: string, token: string): Promise<void> {
    await this.#backend.setup?.connect(server, token);
    this.#set({ snap: null, selected: null });
    this.#undo = [];
    await this.load();
  }

  async forget(): Promise<void> {
    await this.#backend.setup?.forget();
    this.#backend.setToken?.("");
    this.#undo = [];
    this.#set({ snap: null, selected: null, banner: null, conn: { is: "needs_token", message: "" } });
  }
}
