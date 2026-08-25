import type { ObjectiveDefinition } from "../game/Types";
import { Objective } from "./Objective";

export class ScoreObjective extends Objective {
  readonly label = "Score";
  readonly icon = "score";

  constructor(def: Extract<ObjectiveDefinition, { type: "score" }>) {
    super(def, def.target);
  }

  override onScore(total: number): void {
    this.count = total;
  }
}
