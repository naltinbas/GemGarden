import type { GameState } from "./Types";

export type { GameState } from "./Types";

const IN_LEVEL: readonly GameState[] = [
  "LEVEL_INTRO",
  "PLAYER_INPUT",
  "SWAPPING",
  "RESOLVING_MATCHES",
  "FALLING",
  "REFILLING",
  "RESHUFFLING",
  "PAUSED",
];

/** Leaving a level is allowed from any in-level state. */
const LEAVE: readonly GameState[] = ["LEVEL_INTRO", "MAIN_MENU", "LEVEL_SELECT"];
const END: readonly GameState[] = ["LEVEL_COMPLETE", "LEVEL_FAILED"];

const TRANSITIONS: Record<GameState, readonly GameState[]> = {
  MAIN_MENU: ["LEVEL_SELECT", "LEVEL_INTRO"],
  LEVEL_SELECT: ["MAIN_MENU", "LEVEL_INTRO"],
  LEVEL_INTRO: ["PLAYER_INPUT", "PAUSED", ...END, ...LEAVE],
  PLAYER_INPUT: ["SWAPPING", "RESHUFFLING", "PAUSED", ...END, ...LEAVE],
  SWAPPING: ["PLAYER_INPUT", "RESOLVING_MATCHES", "FALLING", "PAUSED", ...END, ...LEAVE],
  RESOLVING_MATCHES: ["FALLING", "PLAYER_INPUT", "RESHUFFLING", "PAUSED", ...END, ...LEAVE],
  FALLING: ["REFILLING", "RESOLVING_MATCHES", "PLAYER_INPUT", "RESHUFFLING", "PAUSED", ...END, ...LEAVE],
  REFILLING: ["RESOLVING_MATCHES", "PLAYER_INPUT", "RESHUFFLING", "PAUSED", ...END, ...LEAVE],
  RESHUFFLING: ["PLAYER_INPUT", "PAUSED", ...END, ...LEAVE],
  PAUSED: [...IN_LEVEL.filter((s) => s !== "PAUSED"), ...END, "MAIN_MENU", "LEVEL_SELECT"],
  LEVEL_COMPLETE: [...LEAVE],
  LEVEL_FAILED: [...LEAVE],
};

export class StateMachine {
  private state: GameState;
  private readonly onInvalid: ((from: GameState, to: GameState) => void) | null;

  constructor(initial: GameState = "MAIN_MENU", onInvalid?: (from: GameState, to: GameState) => void) {
    this.state = initial;
    this.onInvalid = onInvalid ?? null;
  }

  get current(): GameState {
    return this.state;
  }

  /** Moves to `next` when the table allows it. Returns false (and keeps the state) otherwise. */
  set(next: GameState): boolean {
    if (next === this.state) return true;
    if (!TRANSITIONS[this.state].includes(next)) {
      this.onInvalid?.(this.state, next);
      return false;
    }
    this.state = next;
    return true;
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.state);
  }

  canGo(next: GameState): boolean {
    return next === this.state || TRANSITIONS[this.state].includes(next);
  }

  /** Only PLAYER_INPUT accepts board interaction. */
  isInputState(): boolean {
    return this.state === "PLAYER_INPUT";
  }

  /** True while a level is loaded and not finished. */
  isInLevel(): boolean {
    return IN_LEVEL.includes(this.state);
  }

  /** States where a menu or dialog covers the board. */
  isDimmed(): boolean {
    return this.is("MAIN_MENU", "LEVEL_SELECT", "PAUSED", "LEVEL_COMPLETE", "LEVEL_FAILED");
  }
}
