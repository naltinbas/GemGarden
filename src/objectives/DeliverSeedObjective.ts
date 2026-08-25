import type { FallStep, ObjectiveDefinition } from "../game/Types";
import { SEED_NAME } from "../game/Config";
import { Objective } from "./Objective";

export class DeliverSeedObjective extends Objective {
  readonly label = `${SEED_NAME}s`;
  readonly icon = "seed";

  constructor(def: Extract<ObjectiveDefinition, { type: "deliverSeeds" }>) {
    super(def, def.target);
  }

  override onFall(fall: FallStep): void {
    this.count += fall.delivered.length;
  }
}
