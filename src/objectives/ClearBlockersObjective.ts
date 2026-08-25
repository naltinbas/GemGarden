import type { BlockerType, ClearStep, ObjectiveDefinition } from "../game/Types";
import { BLOCKER_NAMES } from "../game/Config";
import type { Board } from "../board/Board";
import { Objective } from "./Objective";

export function countBlockers(board: Board, type: BlockerType): number {
  let n = 0;
  board.forEachCell((cell) => {
    if (cell.blocker?.type === type) n++;
  });
  return n;
}

/**
 * Counts blockers of one type destroyed. "all" is the count on the starting
 * board. Mist spreads, so "all" mist is instead judged by what is left on the
 * board: progress falls when it grows and the goal is met once none remains.
 */
export class ClearBlockersObjective extends Objective {
  readonly label: string;
  readonly icon: string;
  readonly blocker: BlockerType;
  private readonly board: Board | null;

  constructor(def: Extract<ObjectiveDefinition, { type: "clearBlockers" }>, board: Board) {
    super(def, def.target === "all" ? countBlockers(board, def.blocker) : def.target);
    this.blocker = def.blocker;
    this.label = BLOCKER_NAMES[def.blocker];
    this.icon = def.blocker;
    this.board = def.target === "all" && def.blocker === "shadowMist" ? board : null;
  }

  override get progress(): number {
    if (!this.board) return this.count;
    return Math.max(0, this.target - countBlockers(this.board, this.blocker));
  }

  override get complete(): boolean {
    if (!this.board) return this.count >= this.target;
    return countBlockers(this.board, this.blocker) === 0;
  }

  override onClear(step: ClearStep): void {
    for (const hit of step.blockerHits) {
      if (hit.destroyed && hit.type === this.blocker) this.count++;
    }
  }
}
