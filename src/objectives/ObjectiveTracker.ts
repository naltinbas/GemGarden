import type { ClearStep, FallStep, LevelDefinition, ObjectiveDefinition, ObjectiveStatus } from "../game/Types";
import type { Board } from "../board/Board";
import { ClearBlockersObjective } from "./ClearBlockersObjective";
import { ClearTerrainObjective } from "./ClearTerrainObjective";
import { CollectObjective } from "./CollectObjective";
import { DeliverSeedObjective } from "./DeliverSeedObjective";
import { Objective } from "./Objective";
import { ScoreObjective } from "./ScoreObjective";

export function createObjective(def: ObjectiveDefinition, board: Board): Objective {
  switch (def.type) {
    case "score":
      return new ScoreObjective(def);
    case "collect":
      return new CollectObjective(def);
    case "clearTerrain":
      return new ClearTerrainObjective(def, board);
    case "clearBlockers":
      return new ClearBlockersObjective(def, board);
    case "deliverSeeds":
      return new DeliverSeedObjective(def);
  }
}

/** Fans clear, fall and score updates out to a level's objectives. Needs the starting board so "all" targets resolve. */
export class ObjectiveTracker {
  readonly objectives: readonly Objective[];
  private readonly reported = new Set<Objective>();

  constructor(defs: readonly ObjectiveDefinition[], board: Board) {
    this.objectives = defs.map((def) => createObjective(def, board));
  }

  static fromLevel(level: LevelDefinition, board: Board): ObjectiveTracker {
    return new ObjectiveTracker(level.objectives, board);
  }

  onClear(step: ClearStep): void {
    for (const o of this.objectives) o.onClear(step);
  }

  onFall(fall: FallStep): void {
    for (const o of this.objectives) o.onFall(fall);
  }

  onScore(total: number): void {
    for (const o of this.objectives) o.onScore(total);
  }

  allComplete(): boolean {
    return this.objectives.every((o) => o.complete);
  }

  statuses(): ObjectiveStatus[] {
    return this.objectives.map((o) => o.status());
  }

  /** Objectives that finished since the last call, each reported once. */
  newlyCompleted(): Objective[] {
    const out: Objective[] = [];
    for (const o of this.objectives) {
      if (o.complete && !this.reported.has(o)) {
        this.reported.add(o);
        out.push(o);
      }
    }
    return out;
  }
}
