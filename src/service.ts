// What both doors call. The agent door (MCP) gets read, composite and claudeAdd. Edit is for Alex's interface only.
import { applyEdit, claudeAddLayer, type ClaudeAddInput, type ClaudeAddResult } from "./domain.ts";
import type { Store } from "./store.ts";
import type { Edit, EditReply, MapState } from "./types.ts";

export class BodyMap {
  readonly #store: Store;
  readonly #now: () => Date;
  readonly claudeMaxLevel: number;

  constructor(store: Store, claudeMaxLevel: number, now: () => Date = () => new Date()) {
    this.#store = store;
    this.claudeMaxLevel = claudeMaxLevel;
    this.#now = now;
  }

  get now(): Date {
    return this.#now();
  }

  get state(): MapState {
    return this.#store.state;
  }

  /** Alex's interface only. Nothing on the agent door may call this. */
  edit(base: number, edit: Edit): Promise<EditReply> {
    return this.#store.update((state) => {
      const reply = applyEdit(state, edit, base, this.#now());
      return { next: reply.ok ? reply.state : null, value: reply };
    });
  }

  /** The one write the agent door has. */
  claudeAdd(input: ClaudeAddInput): Promise<ClaudeAddResult> {
    return this.#store.update((state) => {
      const result = claudeAddLayer(state, input, this.claudeMaxLevel, this.#now());
      return { next: result.ok ? result.state : null, value: result };
    });
  }
}
