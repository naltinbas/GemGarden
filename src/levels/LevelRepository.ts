import type { LevelDefinition } from "../game/Types";
import { LEVELS } from "./levels";

export class LevelRepository {
  private readonly levels: readonly LevelDefinition[];
  private readonly byId = new Map<number, LevelDefinition>();

  constructor(levels: readonly LevelDefinition[] = LEVELS) {
    this.levels = levels;
    for (const level of levels) this.byId.set(level.id, level);
  }

  all(): readonly LevelDefinition[] {
    return this.levels;
  }

  get count(): number {
    return this.levels.length;
  }

  getById(id: number): LevelDefinition | undefined {
    return this.byId.get(id);
  }

  first(): LevelDefinition {
    return this.levels[0];
  }

  /** The level after `id` in list order, or null after the last one. */
  next(id: number): LevelDefinition | null {
    const index = this.levels.findIndex((level) => level.id === id);
    if (index < 0 || index + 1 >= this.levels.length) return null;
    return this.levels[index + 1];
  }
}

export const levelRepository = new LevelRepository();
