import type { LevelDefinition } from "../game/Types";

export interface StarProgress {
  stars: number;
  /** How far the score is between the last reached threshold and the next one; 1 once all three are earned. */
  fraction: number;
}

/** Running score for one level attempt plus the star thresholds arithmetic. */
export class ScoreSystem {
  total = 0;

  add(points: number): number {
    this.total += points;
    return this.total;
  }

  reset(): void {
    this.total = 0;
  }

  /** 0 to 3 purely by thresholds. A win awards at least one star regardless; see starsForWin. */
  starsFor(level: LevelDefinition, score: number): number {
    let stars = 0;
    for (const threshold of level.starThresholds) if (score >= threshold) stars++;
    return stars;
  }

  starsForWin(level: LevelDefinition, score: number): number {
    return Math.max(1, this.starsFor(level, score));
  }

  progressToNextStar(level: LevelDefinition, score: number): StarProgress {
    const stars = this.starsFor(level, score);
    if (stars >= 3) return { stars, fraction: 1 };
    const from = stars === 0 ? 0 : level.starThresholds[stars - 1];
    const to = level.starThresholds[stars];
    const span = to - from;
    const fraction = span <= 0 ? 1 : Math.max(0, Math.min(1, (score - from) / span));
    return { stars, fraction };
  }
}
