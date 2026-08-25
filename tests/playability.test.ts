import { describe, expect, it } from "vitest";
import { hasValidMove } from "../src/board/MoveValidator";
import { LEVELS } from "../src/levels/levels";
import { playLevel } from "./bot";

const EXTRA_SEEDS = [7, 13];

describe("greedy bot playthroughs", () => {
  for (const level of LEVELS) {
    it(`level ${level.id} "${level.name}" plays through its move budget on 3 seeds`, () => {
      const seeds = [level.seed ?? 1, ...EXTRA_SEEDS];
      const results = seeds.map((seed) =>
        playLevel(level, seed, {
          onTurn: (board) => {
            expect(hasValidMove(board)).toBe(true);
          },
        }),
      );
      const wins = results.filter((r) => r.won).length;
      const scores = results.map((r) => r.score);
      console.info(
        `level ${level.id} ${level.name}: ${wins}/${seeds.length} wins, scores ${scores.join(" ")}, stars ${results
          .map((r) => r.stars)
          .join(" ")}, moves used ${results.map((r) => r.movesUsed).join(" ")}`,
      );
      for (const r of results) {
        expect(r.stalled).toBe(false);
        expect(r.movesUsed).toBeLessThanOrEqual(level.moveLimit);
        if (r.won) expect(r.stars).toBeGreaterThanOrEqual(1);
      }
    });
  }
});
