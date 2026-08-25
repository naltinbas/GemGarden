import { describe, expect, it } from "vitest";
import type { CellPosition, LevelDefinition } from "../src/game/Types";
import { ALL_TOKEN_COLORS } from "../src/game/Types";
import { Random } from "../src/utils/Random";
import { Board } from "../src/board/Board";
import { layoutBoard } from "../src/board/BoardGenerator";
import { columnSegments } from "../src/board/GravitySystem";
import { findMatches } from "../src/board/MatchFinder";
import { hasValidMove } from "../src/board/MoveValidator";
import { createBlocker } from "../src/entities/Blocker";
import { LevelRepository, levelRepository } from "../src/levels/LevelRepository";
import { LEVELS } from "../src/levels/levels";
import { ObjectiveTracker } from "../src/objectives/ObjectiveTracker";

const RANDOM_SEEDS_PER_LEVEL = 20;

function isHole(level: LevelDefinition, p: CellPosition): boolean {
  return (level.holes ?? []).some((h) => h.row === p.row && h.col === p.col);
}

function inGrid(level: LevelDefinition, p: CellPosition): boolean {
  return p.row >= 0 && p.row < level.board.rows && p.col >= 0 && p.col < level.board.cols;
}

function placements(level: LevelDefinition): { what: string; at: CellPosition }[] {
  const out: { what: string; at: CellPosition }[] = [];
  for (const t of level.terrain ?? []) out.push({ what: "terrain", at: t });
  for (const b of level.blockers ?? []) out.push({ what: `blocker ${b.type}`, at: b });
  for (const t of level.initialTokens ?? []) out.push({ what: "initial token", at: t });
  for (const e of level.seeds?.exitCells ?? []) out.push({ what: "exit", at: e });
  return out;
}

describe("level list", () => {
  it("has twelve levels with ids 1..12 in order", () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(LEVELS.map((l) => l.name)).size).toBe(12);
  });

  it("gives every level a name, flavor line, fixed seed and a move budget", () => {
    for (const level of LEVELS) {
      expect(level.name.length).toBeGreaterThan(2);
      expect(level.flavor?.length ?? 0).toBeGreaterThan(5);
      expect(Number.isInteger(level.seed)).toBe(true);
      expect(level.moveLimit).toBeGreaterThan(0);
      expect(level.objectives.length).toBeGreaterThan(0);
    }
  });

  it("keeps star thresholds positive and strictly ascending", () => {
    for (const level of LEVELS) {
      const [one, two, three] = level.starThresholds;
      expect(one).toBeGreaterThan(0);
      expect(two).toBeGreaterThan(one);
      expect(three).toBeGreaterThan(two);
      for (const o of level.objectives) if (o.type === "score") expect(one).toBeLessThanOrEqual(o.target);
    }
  });

  it("uses real colors without duplicates and never lists 'none' as a special", () => {
    for (const level of LEVELS) {
      const colors = level.board.tokenTypes;
      expect(colors.length).toBeGreaterThanOrEqual(4);
      expect(new Set(colors).size).toBe(colors.length);
      for (const c of colors) expect(ALL_TOKEN_COLORS).toContain(c);
      expect(level.allowedSpecials).not.toContain("none");
      expect(new Set(level.allowedSpecials).size).toBe(level.allowedSpecials.length);
    }
  });

  it("follows the progression: five colors and no specials on 1, beams from 2, bursts from 7, prisms from 10", () => {
    expect(LEVELS[0].board.tokenTypes).toHaveLength(5);
    expect(LEVELS[0].allowedSpecials).toEqual([]);
    for (const level of LEVELS.slice(1)) {
      expect(level.board.tokenTypes).toHaveLength(6);
      expect(level.allowedSpecials).toContain("lineHorizontal");
      expect(level.allowedSpecials).toContain("lineVertical");
      expect(level.allowedSpecials.includes("burst")).toBe(level.id >= 7);
      expect(level.allowedSpecials.includes("prism")).toBe(level.id >= 10);
    }
    expect(LEVELS[0].tutorialMessage).toBeTruthy();
    expect(LEVELS[1].tutorialMessage).toMatch(/Vine Beam/);
    expect(LEVELS[9].tutorialMessage).toMatch(/Locked Bud/);
  });
});

describe("level layouts", () => {
  for (const level of LEVELS) {
    describe(`level ${level.id} "${level.name}"`, () => {
      it("places holes inside the grid and everything else on playable cells", () => {
        for (const h of level.holes ?? []) expect(inGrid(level, h)).toBe(true);
        const seen = new Set<string>();
        for (const { what, at } of placements(level)) {
          expect(inGrid(level, at), `${what} at ${at.row},${at.col}`).toBe(true);
          expect(isHole(level, at), `${what} at ${at.row},${at.col} sits on a hole`).toBe(false);
          if (what.startsWith("blocker")) {
            const key = `${at.row},${at.col}`;
            expect(seen.has(key), `two blockers at ${key}`).toBe(false);
            seen.add(key);
          }
        }
        for (const t of level.terrain ?? []) expect(t.layers).toBeGreaterThan(0);
      });

      it("only asks to collect colors the board spawns", () => {
        for (const o of level.objectives) {
          if (o.type === "collect") {
            expect(level.board.tokenTypes).toContain(o.token);
            expect(o.target).toBeGreaterThan(0);
          }
        }
      });

      it("resolves every 'all' target to more than zero", () => {
        const board = Board.fromLevel(level);
        const tracker = ObjectiveTracker.fromLevel(level, board);
        for (const o of tracker.objectives) {
          expect(o.target, `${o.def.type} target`).toBeGreaterThan(0);
          expect(o.complete).toBe(false);
        }
      });

      it("has an exit at the bottom of the topmost segment of every seed column", () => {
        const seeds = level.seeds;
        const wantsSeeds = level.objectives.some((o) => o.type === "deliverSeeds");
        expect(seeds !== undefined).toBe(wantsSeeds);
        if (!seeds) return;
        expect(seeds.maxOnBoard).toBeGreaterThanOrEqual(1);
        expect(seeds.spawnCols.length).toBeGreaterThan(0);
        const board = layoutBoard(level, new Random(level.seed));
        const segments = columnSegments(board);
        for (const col of seeds.spawnCols) {
          expect(col).toBeGreaterThanOrEqual(0);
          expect(col).toBeLessThan(level.board.cols);
          const top = segments.filter((s) => s.col === col).sort((a, b) => a.top - b.top)[0];
          expect(top, `column ${col} has no open segment`).toBeDefined();
          expect(board.cells[top.bottom][col].isExit, `column ${col}: no exit at row ${top.bottom}`).toBe(true);
          for (let r = top.top; r <= top.bottom; r++) {
            expect(board.cells[r][col].playable).toBe(true);
            expect(board.cells[r][col].blocker).toBeNull();
          }
        }
        const exitKeys = seeds.exitCells.map((e) => `${e.row},${e.col}`);
        expect(new Set(exitKeys).size).toBe(exitKeys.length);
      });

      it("generates with its own seed and with 20 random seeds, always with a move and no match", () => {
        const seeds = [level.seed as number];
        const rng = new Random(level.id * 7919);
        for (let i = 0; i < RANDOM_SEEDS_PER_LEVEL; i++) seeds.push(rng.int(1, 0x7fffffff));
        for (const seed of seeds) {
          const board = Board.fromLevel({ ...level, seed });
          expect(board.rng.seed).toBe(seed);
          expect(findMatches(board)).toEqual([]);
          expect(hasValidMove(board)).toBe(true);
          expect(board.config.allowedSpecials).toEqual(level.allowedSpecials);
        }
      });

      it("opens on the same board every time with its fixed seed", () => {
        expect(Board.fromLevel(level).toString()).toBe(Board.fromLevel(level).toString());
      });
    });
  }
});

describe("shadow mist objective on the mist level", () => {
  const level = LEVELS.find((l) => l.objectives.some((o) => o.type === "clearBlockers" && o.blocker === "shadowMist"))!;

  it("targets only the initial mist and finishes when none is left", () => {
    const board = Board.fromLevel(level);
    const tracker = ObjectiveTracker.fromLevel(level, board);
    const initial = (level.blockers ?? []).filter((b) => b.type === "shadowMist").length;
    const objective = tracker.objectives[0];
    expect(objective.target).toBe(initial);

    // A spread does not move the target, it only sets progress back.
    const spread = board.cells[1][3];
    expect(spread.blocker).toBeNull();
    spread.blocker = createBlocker("shadowMist", 1);
    expect(objective.target).toBe(initial);
    expect(objective.progress).toBe(0);
    expect(objective.complete).toBe(false);

    board.forEachCell((cell) => {
      if (cell.blocker?.type === "shadowMist") cell.blocker = null;
    });
    expect(objective.progress).toBe(initial);
    expect(tracker.allComplete()).toBe(true);
  });
});

describe("LevelRepository", () => {
  it("serves the twelve levels in order", () => {
    expect(levelRepository.count).toBe(12);
    expect(levelRepository.all()).toBe(LEVELS);
    expect(levelRepository.first().id).toBe(1);
    expect(levelRepository.getById(7)?.name).toBe(LEVELS[6].name);
    expect(levelRepository.getById(13)).toBeUndefined();
  });

  it("walks next() through the chain and stops after the last", () => {
    let id = 1;
    for (let i = 0; i < 11; i++) {
      const next = levelRepository.next(id);
      expect(next?.id).toBe(id + 1);
      id = next!.id;
    }
    expect(levelRepository.next(12)).toBeNull();
    expect(levelRepository.next(99)).toBeNull();
  });

  it("works over a custom list", () => {
    const repo = new LevelRepository([LEVELS[2], LEVELS[5]]);
    expect(repo.count).toBe(2);
    expect(repo.next(3)?.id).toBe(6);
    expect(repo.next(6)).toBeNull();
  });
});
