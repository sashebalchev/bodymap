// One JSON file in the data directory. Writes are queued, atomic (temp file, then rename), and a file that
// does not parse stops the server instead of being overwritten.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StoredStateSchema } from "./schemas.ts";
import { emptyState } from "./domain.ts";
import type { MapState } from "./types.ts";

export class Store {
  readonly file: string;
  #state: MapState;
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(file: string, state: MapState) {
    this.file = file;
    this.#state = state;
  }

  static async open(dir: string, now: () => Date): Promise<Store> {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "body-map.json");
    let raw: string | undefined;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (raw === undefined) return new Store(file, emptyState(now()));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(file + " is not valid JSON. Not starting, so it is not overwritten. Fix or move the file.");
    }
    const checked = StoredStateSchema.safeParse(parsed);
    if (!checked.success) throw new Error(file + " does not look like a body map (" + checked.error.issues[0]?.message + "). Not starting, so it is not overwritten.");
    return new Store(file, checked.data);
  }

  get state(): MapState {
    return this.#state;
  }

  /** Run a change against the latest state. The change returns the new state to keep, or null to keep the old one. */
  update<T>(change: (state: MapState) => { next: MapState | null; value: T }): Promise<T> {
    const run = this.#queue.then(async () => {
      const { next, value } = change(this.#state);
      if (next && next !== this.#state) {
        const tmp = this.file + ".tmp";
        await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
        await rename(tmp, this.file);
        this.#state = next;
      }
      return value;
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
