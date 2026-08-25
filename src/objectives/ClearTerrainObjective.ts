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

/** Counts moss layers removed. "all" is the layer total on the starting board. */
export class ClearTerrainObjective extends Objective {
  readonly label = TERRAIN_NAME;
  readonly icon = "moss";

  constructor(def: Extract<ObjectiveDefinition, { type: "clearTerrain" }>, board: Board) {
    super(def, def.target === "all" ? totalTerrainLayers(board) : def.target);
  }

  override onClear(step: ClearStep): void {
    this.count += step.terrainHits.length;
  }
}
