import type { ClearStep, FallStep, ObjectiveDefinition, ObjectiveStatus } from "../game/Types";

/** One level goal. Subclasses count what they care about from clear and fall steps. */
export abstract class Objective {
  readonly def: ObjectiveDefinition;
  readonly target: number;
  abstract readonly label: string;
  abstract readonly icon: string;
  protected count = 0;

  constructor(def: ObjectiveDefinition, target: number) {
    this.def = def;
    this.target = target;
  }

  get progress(): number {
    return this.count;
  }

  get complete(): boolean {
    return this.progress >= this.target;
  }

  onClear(_step: ClearStep): void {}

  onFall(_fall: FallStep): void {}

  onScore(_total: number): void {}

  status(): ObjectiveStatus {
    return {
      type: this.def.type,
      label: this.label,
      progress: Math.min(this.progress, this.target),
      target: this.target,
      complete: this.complete,
      icon: this.icon,
    };
  }
}
