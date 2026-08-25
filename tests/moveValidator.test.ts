import { describe, expect, it } from "vitest";
import { classifyCombo, findValidMoves, hasValidMove, isValidSwap } from "../src/board/MoveValidator";
import { TokenFactory } from "../src/entities/Token";
import { parseBoard, pos } from "./helpers";

// No matches anywhere; swapping (2,3) with (2,2) lines up three rubies in row 2.
const ONE_MOVE = ["a c v p j a", "c v j p a c", "r r j r c v", "j p a c v j", "p a c v j p", "a c v j p a"];

describe("isValidSwap plain gems", () => {
  it("accepts a swap that creates a match, in either direction", () => {
    const board = parseBoard(ONE_MOVE);
    expect(isValidSwap(board, pos(2, 3), pos(2, 2))).toEqual({ valid: true, combo: "none" });
    expect(isValidSwap(board, pos(2, 2), pos(2, 3))).toEqual({ valid: true, combo: "none" });
  });

  it("rejects a swap that creates nothing", () => {
    const board = parseBoard(ONE_MOVE);
    expect(isValidSwap(board, pos(0, 0), pos(0, 1))).toEqual({ valid: false, combo: "none" });
    expect(isValidSwap(board, pos(2, 2), pos(1, 2))).toEqual({ valid: false, combo: "none" });
  });

  it("leaves the board unchanged after checking", () => {
    const board = parseBoard(ONE_MOVE);
    const before = board.toString();
    isValidSwap(board, pos(2, 3), pos(2, 2));
    isValidSwap(board, pos(0, 0), pos(0, 1));
    expect(board.toString()).toBe(before);
  });

  it("rejects non-adjacent, diagonal, same-cell and out-of-range pairs", () => {
    const board = parseBoard(ONE_MOVE);
    expect(isValidSwap(board, pos(2, 1), pos(2, 3)).valid).toBe(false);
    expect(isValidSwap(board, pos(1, 2), pos(2, 3)).valid).toBe(false);
    expect(isValidSwap(board, pos(2, 2), pos(2, 2)).valid).toBe(false);
    expect(isValidSwap(board, pos(0, 0), pos(-1, 0)).valid).toBe(false);
    expect(isValidSwap(board, pos(5, 5), pos(5, 6)).valid).toBe(false);
  });

  it("rejects holes and empty cells", () => {
    const board = parseBoard(["a c v j p a", "c v j p a c", "r r # r c v", "j p . c v j", "p a c v j p", "a c v j p a"]);
    expect(isValidSwap(board, pos(2, 3), pos(2, 2)).valid).toBe(false);
    expect(isValidSwap(board, pos(3, 1), pos(3, 2)).valid).toBe(false);
  });

  it("rejects cells under vines, buds, mist and roots", () => {
    for (const code of ["rV", "rB", "rM", "X"]) {
      const rows = [...ONE_MOVE];
      rows[2] = `r r j ${code} c v`;
      const board = parseBoard(rows);
      expect(isValidSwap(board, pos(2, 3), pos(2, 2)).valid).toBe(false);
    }
    // Blocker on the other side of the swap.
    const rows = [...ONE_MOVE];
    rows[2] = "r r jV r c v";
    expect(isValidSwap(parseBoard(rows), pos(2, 3), pos(2, 2)).valid).toBe(false);
  });
});

describe("isValidSwap with specials", () => {
  function swap(rows: string[], a = pos(2, 2), b = pos(2, 3)) {
    return isValidSwap(parseBoard(rows), a, b);
  }
  function row2(line: string): string[] {
    const rows = [...ONE_MOVE];
    rows[2] = line;
    return rows;
  }

  it("special with a plain gem is a single activation even without a match", () => {
    expect(swap(row2("a c j* p c v"))).toEqual({ valid: true, combo: "single" });
    expect(swap(row2("a c j- p c v"))).toEqual({ valid: true, combo: "single" });
    expect(swap(row2("a c j p| c v"))).toEqual({ valid: true, combo: "single" });
  });

  it("prism with a colored gem is prismColor, prism with a seed is single", () => {
    expect(swap(row2("a c @ p c v"))).toEqual({ valid: true, combo: "prismColor" });
    expect(swap(row2("a c p @ c v"))).toEqual({ valid: true, combo: "prismColor" });
    expect(swap(row2("a c @ S c v"))).toEqual({ valid: true, combo: "single" });
  });

  it("classifies two-special combos", () => {
    expect(swap(row2("a c j- p- c v")).combo).toBe("beamBeam");
    expect(swap(row2("a c j| p- c v")).combo).toBe("beamBeam");
    expect(swap(row2("a c j- p* c v")).combo).toBe("beamBurst");
    expect(swap(row2("a c j* p| c v")).combo).toBe("beamBurst");
    expect(swap(row2("a c j* p* c v")).combo).toBe("burstBurst");
    expect(swap(row2("a c @ p- c v")).combo).toBe("prismBeam");
    expect(swap(row2("a c j| @ c v")).combo).toBe("prismBeam");
    expect(swap(row2("a c @ p* c v")).combo).toBe("prismBurst");
    expect(swap(row2("a c @ @ c v")).combo).toBe("prismPrism");
  });

  it("still requires swappable cells for specials", () => {
    expect(swap(row2("a c j*B p c v")).valid).toBe(false);
    expect(swap(row2("a c @ X c v")).valid).toBe(false);
  });

  it("classifyCombo works on bare tokens", () => {
    const f = new TokenFactory();
    const plain = f.createGem("ruby");
    const beam = f.createGem("azure", "lineHorizontal");
    const burst = f.createGem("jade", "burst");
    const prism = f.createPrism();
    const seed = f.createSeed();
    expect(classifyCombo(plain, plain)).toBe("none");
    expect(classifyCombo(plain, seed)).toBe("none");
    expect(classifyCombo(null, plain)).toBe("none");
    expect(classifyCombo(beam, plain)).toBe("single");
    expect(classifyCombo(seed, burst)).toBe("single");
    expect(classifyCombo(prism, plain)).toBe("prismColor");
    expect(classifyCombo(seed, prism)).toBe("single");
    expect(classifyCombo(burst, prism)).toBe("prismBurst");
    expect(classifyCombo(prism, prism)).toBe("prismPrism");
  });
});

describe("isValidSwap with seeds", () => {
  it("lets a seed move down one row without a match", () => {
    const board = parseBoard(["a c S j p a", "c v j p a c", "r r j r c v", "j p a c v j", "p a c v j p", "a c v j p a"]);
    expect(isValidSwap(board, pos(0, 2), pos(1, 2))).toEqual({ valid: true, combo: "none" });
    expect(isValidSwap(board, pos(1, 2), pos(0, 2))).toEqual({ valid: true, combo: "none" });
  });

  it("rejects moving a seed sideways or up without a match", () => {
    const board = parseBoard(["a c v j p a", "c v S p a c", "r r j r c v", "j p a c v j", "p a c v j p", "a c v j p a"]);
    expect(isValidSwap(board, pos(1, 2), pos(0, 2)).valid).toBe(false);
    expect(isValidSwap(board, pos(1, 2), pos(1, 1)).valid).toBe(false);
  });

  it("accepts a sideways seed swap that lines up the displaced gem", () => {
    const board = parseBoard(["a c v j p a", "c v j p a c", "r r S r c v", "j p a c v j", "p a c v j p", "a c v j p a"]);
    expect(isValidSwap(board, pos(2, 2), pos(2, 3)).valid).toBe(true);
  });

  it("rejects swapping two stacked seeds, so a board with only that pair has no move", () => {
    const board = parseBoard(["a c v j p a", "c v S p a c", "v j S a c v", "j p X c v j", "p a c v j p", "a c v j p a"]);
    expect(isValidSwap(board, pos(1, 2), pos(2, 2)).valid).toBe(false);
    expect(isValidSwap(board, pos(2, 2), pos(1, 2)).valid).toBe(false);
    expect(findValidMoves(board)).toEqual([]);
    expect(hasValidMove(board)).toBe(false);
  });
});

describe("findValidMoves and hasValidMove", () => {
  it("finds exactly the one move on the reference board, a before b", () => {
    const board = parseBoard(ONE_MOVE);
    const before = board.toString();
    const moves = findValidMoves(board);
    expect(moves).toEqual([{ a: pos(2, 2), b: pos(2, 3), combo: "none" }]);
    expect(hasValidMove(board)).toBe(true);
    expect(board.toString()).toBe(before);
  });

  it("reports no moves on a dead board", () => {
    const board = parseBoard(["a c v j p a", "c v j p a c", "v j p a c v", "j p a c v j", "p a c v j p", "a c v j p a"]);
    expect(findValidMoves(board)).toEqual([]);
    expect(hasValidMove(board)).toBe(false);
  });

  it("counts special swaps as moves", () => {
    const board = parseBoard(["a c v j p a", "c v j p a c", "v j p a c v", "j p a c v j", "p a c v j p", "a c v j* p a"]);
    const moves = findValidMoves(board);
    expect(moves.every((m) => m.combo === "single")).toBe(true);
    expect(moves).toHaveLength(3);
  });

  it("skips pairs blocked by holes or roots", () => {
    const board = parseBoard(["a c v j p a", "c v j p a c", "r r # r c v", "j p X c v j", "p a c v j p", "a c v j p a"]);
    expect(findValidMoves(board)).toEqual([]);
  });
});
