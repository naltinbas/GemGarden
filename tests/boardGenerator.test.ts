import { describe, expect, it } from "vitest";
import type { LevelDefinition } from "../src/game/Types";
import { RULES } from "../src/game/Config";
import { Random } from "../src/utils/Random";
import { Board } from "../src/board/Board";
import { fillRandomNoMatch, generate, layoutBoard } from "../src/board/BoardGenerator";
import { findMatches } from "../src/board/MatchFinder";
import { hasValidMove } from "../src/board/MoveValidator";
import { isMatchable } from "../src/board/BoardCell";

function level(overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  return {
    id: 99,
    name: "Test Bed",
    board: { rows: 8, cols: 8, tokenTypes: ["ruby", "azure", "citrine", "violet", "jade", "pearl"], allowedSpecials: [] },
    moveLimit: 20,
    objectives: [{ type: "score", target: 1000 }],
    allowedSpecials: ["lineHorizontal", "lineVertical", "burst"],
    starThresholds: [1000, 2000, 3000],
    ...overrides,
  };
}

const SHAPED = level({
  board: { rows: 7, cols: 7, tokenTypes: ["ruby", "azure", "citrine", "violet", "jade"], allowedSpecials: [] },
  holes: [{ row: 0, col: 0 }, { row: 0, col: 6 }, { row: 3, col: 3 }, { row: 6, col: 0 }, { row: 6, col: 6 }],
  terrain: [{ row: 1, col: 1, type: "moss", layers: 2 }, { row: 5, col: 5, type: "moss", layers: 1 }],
  blockers: [
    { row: 2, col: 2, type: "stoneRoot" },
    { row: 2, col: 4, type: "glassVine" },
    { row: 4, col: 2, type: "lockedBud" },
    { row: 4, col: 4, type: "shadowMist", hp: 3 },
  ],
  seeds: { spawnCols: [3], exitCells: [{ row: 2, col: 3 }], maxOnBoard: 1 },
  initialTokens: [
    { row: 5, col: 1, color: "ruby" },
    { row: 5, col: 2, kind: "seed" },
    { row: 1, col: 5, special: "prism" },
    { row: 3, col: 5, color: "jade", special: "burst" },
  ],
});

describe("generate", () => {
  it("never starts with a match and always has a move, for 200 seeds", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const board = generate(level({ seed }));
      expect(findMatches(board), `seed ${seed}`).toEqual([]);
      expect(hasValidMove(board), `seed ${seed}`).toBe(true);
      board.forEachCell((cell) => {
        expect(cell.token, `seed ${seed} cell ${cell.row},${cell.col}`).not.toBeNull();
        expect(cell.token!.kind).toBe("gem");
        expect(cell.token!.special).toBe("none");
      });
    }
  });

  it("holds for shaped boards with holes and blockers over many seeds", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const board = generate({ ...SHAPED, seed });
      expect(findMatches(board), `seed ${seed}`).toEqual([]);
      expect(hasValidMove(board), `seed ${seed}`).toBe(true);
    }
  });

  it("respects holes: not playable and never filled", () => {
    const board = generate({ ...SHAPED, seed: 7 });
    for (const h of SHAPED.holes!) {
      const cell = board.get(h.row, h.col)!;
      expect(cell.playable).toBe(false);
      expect(cell.token).toBeNull();
    }
    board.forEachCell((cell) => {
      if (cell.playable && cell.blocker?.type !== "stoneRoot") expect(cell.token).not.toBeNull();
    });
  });

  it("applies terrain, blockers, exits and initial tokens", () => {
    const board = generate({ ...SHAPED, seed: 3 });
    expect(board.get(1, 1)!.terrain).toEqual({ type: "moss", layers: 2, maxLayers: 2 });
    expect(board.get(5, 5)!.terrain).toEqual({ type: "moss", layers: 1, maxLayers: 1 });

    const root = board.get(2, 2)!;
    expect(root.blocker).toEqual({ type: "stoneRoot", hp: 2, maxHp: 2 });
    expect(root.token).toBeNull();

    expect(board.get(2, 4)!.blocker).toEqual({ type: "glassVine", hp: 1, maxHp: 1 });
    expect(board.get(4, 2)!.blocker).toEqual({ type: "lockedBud", hp: 1, maxHp: 1 });
    expect(board.get(4, 4)!.blocker).toEqual({ type: "shadowMist", hp: 3, maxHp: 3 });
    for (const [r, c] of [[2, 4], [4, 2], [4, 4]]) {
      const t = board.get(r, c)!.token!;
      expect(t.kind).toBe("gem");
      expect(t.color).not.toBeNull();
    }

    expect(board.get(2, 3)!.isExit).toBe(true);
    expect(board.get(5, 1)!.token).toMatchObject({ kind: "gem", color: "ruby", special: "none" });
    expect(board.get(5, 2)!.token).toMatchObject({ kind: "seed", color: null });
    expect(board.get(1, 5)!.token).toMatchObject({ kind: "gem", color: null, special: "prism" });
    expect(board.get(3, 5)!.token).toMatchObject({ kind: "gem", color: "jade", special: "burst" });
  });

  it("copies the level's allowedSpecials and token types into the board config", () => {
    const board = generate(level({ seed: 5, allowedSpecials: ["burst"] }));
    expect(board.config.allowedSpecials).toEqual(["burst"]);
    expect(board.config.tokenTypes).toEqual(["ruby", "azure", "citrine", "violet", "jade", "pearl"]);
    expect(board.rows).toBe(8);
    expect(board.cols).toBe(8);
  });

  it("uses the level seed for reproducible boards and its own rng otherwise", () => {
    const a = generate(level({ seed: 42 }));
    const b = generate(level({ seed: 42 }));
    expect(a.toString()).toBe(b.toString());
    expect(a.rng.seed).toBe(42);
    const c = generate(level({ seed: 43 }));
    expect(c.toString()).not.toBe(a.toString());

    const custom = new Random(42);
    const d = generate(level(), custom);
    expect(d.rng).toBe(custom);
    expect(d.toString()).toBe(a.toString());
  });

  it("gives every token a unique id", () => {
    const board = generate(level({ seed: 11 }));
    const ids = board.cellsWithToken().map((c) => c.token!.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(board.tokens.nextId).toBeGreaterThan(ids.length);
  });

  it("Board.fromLevel delegates to the generator", () => {
    const board = Board.fromLevel(level({ seed: 42 }));
    expect(board.toString()).toBe(generate(level({ seed: 42 })).toString());
  });

  it("throws a descriptive error when no board can be built", () => {
    const impossible = level({
      board: { rows: 1, cols: 3, tokenTypes: ["ruby"], allowedSpecials: [] },
      seed: 1,
    });
    expect(() => generate(impossible)).toThrow(/Board generation failed for level 99 "Test Bed" after 200 attempts: no color fits/);

    const prematched = level({
      seed: 1,
      initialTokens: [
        { row: 0, col: 0, color: "ruby" },
        { row: 0, col: 1, color: "ruby" },
        { row: 0, col: 2, color: "ruby" },
      ],
    });
    expect(() => generate(prematched)).toThrow(/already form a match/);
    expect(RULES.maxGenerationAttempts).toBe(200);
  });

  it("throws on placements outside the grid or on holes", () => {
    expect(() => generate(level({ terrain: [{ row: 9, col: 0, type: "moss", layers: 1 }] }))).toThrow(/outside/);
    expect(() =>
      generate(level({ holes: [{ row: 0, col: 0 }], blockers: [{ row: 0, col: 0, type: "lockedBud" }] })),
    ).toThrow(/hole/);
  });
});

describe("fillRandomNoMatch", () => {
  it("refills only the emptied cells and keeps the board match free", () => {
    const board = generate(level({ seed: 9 }));
    const keep = board.get(0, 0)!.token;
    for (let c = 0; c < board.cols; c++) board.cells[3][c].token = null;
    board.cells[5][5].token = null;
    expect(fillRandomNoMatch(board)).toBe(true);
    expect(board.get(0, 0)!.token).toBe(keep);
    for (let c = 0; c < board.cols; c++) expect(board.get(3, c)!.token).not.toBeNull();
    expect(findMatches(board)).toEqual([]);
  });

  it("returns false when a cell has no legal color", () => {
    const layout = level({ board: { rows: 1, cols: 3, tokenTypes: ["ruby"], allowedSpecials: [] } });
    const board = layoutBoard(layout, new Random(1));
    expect(fillRandomNoMatch(board, new Random(1))).toBe(false);
  });

  it("skips roots and puts matchable gems under vines", () => {
    const board = layoutBoard(SHAPED, new Random(2));
    expect(fillRandomNoMatch(board, new Random(2))).toBe(true);
    expect(board.get(2, 2)!.token).toBeNull();
    expect(isMatchable(board.get(2, 4))).toBe(true);
    expect(isMatchable(board.get(4, 2))).toBe(false);
    expect(board.get(4, 2)!.token).not.toBeNull();
  });
});
