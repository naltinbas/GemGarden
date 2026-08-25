import type { ClearStep, ObjectiveDefinition } from "../game/Types";
import { TERRAIN_NAME } from "../game/Config";
import type { Board } from "../board/Board";
import { Objective } from "./Objective";

export function totalTerrainLayers(board: Board): number {
  let n = 0;
  board.forEachCell((cell) => {
    if (cell.terrain) n += cell.terrain.layers;
  });
  return n;
}

/**
 * Counts moss layers removed. "all" is the layer total on the starting board
 * but is judged by what is left: moss can spread, and a spread patch must go
 * too, so progress falls when it grows and the goal is met once none remains.
 */
export class ClearTerrainObjective extends Objective {
  readonly label = TERRAIN_NAME;
  readonly icon = "moss";
  private readonly board: Board | null;

  constructor(def: Extract<ObjectiveDefinition, { type: "clearTerrain" }>, board: Board) {
    super(def, def.target === "all" ? totalTerrainLayers(board) : def.target);
    this.board = def.target === "all" ? board : null;
  }

  override get progress(): number {
    if (!this.board) return this.count;
    return Math.max(0, this.target - totalTerrainLayers(this.board));
  }

  override get complete(): boolean {
    if (!this.board) return this.count >= this.target;
    return totalTerrainLayers(this.board) === 0;
  }

  override onClear(step: ClearStep): void {
    this.count += step.terrainHits.length;
  }
}
