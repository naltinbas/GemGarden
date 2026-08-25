import type { ClearStep, ObjectiveDefinition, TokenColor } from "../game/Types";
import { TOKEN_STYLE } from "../game/Config";
import { Objective } from "./Objective";

/** Counts every gem of one color that leaves the board, whatever removed it. */
export class CollectObjective extends Objective {
  readonly label: string;
  readonly icon: string;
  readonly color: TokenColor;

  constructor(def: Extract<ObjectiveDefinition, { type: "collect" }>) {
    super(def, def.target);
    this.color = def.token;
    this.label = TOKEN_STYLE[def.token].name;
    this.icon = def.token;
  }

  override onClear(step: ClearStep): void {
    for (const c of step.cleared) {
      if (c.token.kind === "gem" && c.token.color === this.color) this.count++;
    }
  }
}
