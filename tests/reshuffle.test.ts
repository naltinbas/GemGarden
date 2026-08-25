import { describe, expect, it } from "vitest";
import { findMatches } from "../src/board/MatchFinder";
import { findValidMoves, hasValidMove } from "../src/board/MoveValidator";
import { reshuffle } from "../src/board/ReshuffleSystem";
import { parseBoard } from "./helpers";

// Every row and column holds all six colors, so no swap can line up three.
const STUCK = ["a c v j p r", "c v j p r a", "v j p r a c", "j p r a c v", "p r a c v j", "r a c v j p"];

describe("reshuffle", () => {
  it("rearranges a stuck board into one with a move and no match, keeping the same tokens", () => {
    const board = parseBoard(STUCK);
    expect(hasValidMove(board)).toBe(false);
    const before = new Set(board.cellsWithToken().map((c) => c.token!.id));

    const result = reshuffle(board, board.rng);
    expect(result.success).toBe(true);
    expect(findMatches(board)).toEqual([]);
    expect(findValidMoves(board).length).toBeGreaterThan(0);

    const after = new Set(board.cellsWithToken().map((c) => c.token!.id));
    expect(after).toEqual(before);
    expect(result.moved.length).toBeGreaterThan(0);
    for (const move of result.moved) {
      expect(move.spawned).toBe(false);
      expect(move.from).not.toEqual(move.to);
      expect(board.tokenAt(move.to.row, move.to.col)).toBe(move.token);
    }
  });

  it("leaves blocked cells, roots, seeds and holes where they are", () => {
    const rows = [...STUCK];
    rows[0] = "aV c v j p r";
    rows[2] = "v j pM r a c";
    rows[3] = "j p r X c v";
    rows[5] = "r a c v # S";
    const board = parseBoard(rows);
    const vine = board.tokenAt(0, 0)!;
    const misted = board.tokenAt(2, 2)!;
    const seed = board.tokenAt(5, 5)!;
    const result = reshuffle(board, board.rng);
    expect(result.success).toBe(true);
    expect(board.tokenAt(0, 0)).toBe(vine);
    expect(board.tokenAt(2, 2)).toBe(misted);
    expect(board.tokenAt(5, 5)).toBe(seed);
    expect(board.cells[3][3].blocker?.type).toBe("stoneRoot");
    expect(board.cells[3][3].token).toBeNull();
    expect(board.cells[5][4].token).toBeNull();
    expect(result.moved.some((m) => [vine.id, misted.id, seed.id].includes(m.token.id))).toBe(false);
  });

  it("keeps specials as tokens while shuffling", () => {
    const rows = [...STUCK];
    rows[1] = "c v j* p r a";
    const board = parseBoard(rows);
    const burst = board.tokenAt(1, 2)!;
    reshuffle(board, board.rng);
    const found = board.cellsWithToken((t) => t.id === burst.id);
    expect(found).toHaveLength(1);
    expect(found[0].token!.special).toBe("burst");
  });

  it("reports failure on a board that can never have a move, leaving it full", () => {
    const board = parseBoard(["a a c"], { tokenTypes: ["azure", "citrine"] });
    const result = reshuffle(board, board.rng);
    expect(result.success).toBe(false);
    expect(board.cellsWithToken()).toHaveLength(3);
    expect(findMatches(board)).toEqual([]);
  });

  it("is reproducible for the same seed", () => {
    const a = parseBoard(STUCK, {}, 42);
    const b = parseBoard(STUCK, {}, 42);
    reshuffle(a, a.rng);
    reshuffle(b, b.rng);
    expect(a.toString()).toBe(b.toString());
  });
});
