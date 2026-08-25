import { describe, expect, it } from "vitest";
import type { SeedConfig, TokenMove } from "../src/game/Types";
import type { Board } from "../src/board/Board";
import { applyGravity, columnSegments, type GravityContext } from "../src/board/GravitySystem";
import { parseBoard, pos } from "./helpers";

function ctx(board: Board, over: Partial<GravityContext> = {}): GravityContext {
  return {
    rng: board.rng,
    tokenTypes: board.config.tokenTypes,
    seedsWanted: 0,
    seedsDelivered: 0,
    cascadeIndex: 0,
    ...over,
  };
}

function moveOf(moves: TokenMove[], id: number): TokenMove | undefined {
  return moves.find((m) => m.token.id === id);
}

function full(board: Board): boolean {
  let ok = true;
  board.forEachCell((cell) => {
    if (cell.playable && cell.blocker?.type !== "stoneRoot" && cell.token === null) ok = false;
  });
  return ok;
}

describe("columnSegments", () => {
  it("splits columns at holes, roots and blockers", () => {
    const board = parseBoard(["a . c", "# X aV", "r . j"]);
    expect(columnSegments(board)).toEqual([
      { col: 0, top: 0, bottom: 0 },
      { col: 0, top: 2, bottom: 2 },
      { col: 1, top: 0, bottom: 0 },
      { col: 1, top: 2, bottom: 2 },
      { col: 2, top: 0, bottom: 0 },
      { col: 2, top: 2, bottom: 2 },
    ]);
  });
});

describe("applyGravity", () => {
  it("drops tokens to the lowest empty cell and spawns the rest from above", () => {
    const board = parseBoard(["a . c", ". . .", "r . j"]);
    const a = board.tokenAt(0, 0)!;
    const c = board.tokenAt(0, 2)!;
    const r = board.tokenAt(2, 0)!;
    const fall = applyGravity(board, ctx(board));

    expect(full(board)).toBe(true);
    expect(board.tokenAt(1, 0)).toBe(a);
    expect(board.tokenAt(2, 0)).toBe(r);
    expect(board.tokenAt(1, 2)).toBe(c);
    expect(moveOf(fall.moves, a.id)).toEqual({ token: a, from: pos(0, 0), to: pos(1, 0), spawned: false });
    expect(moveOf(fall.moves, c.id)).toEqual({ token: c, from: pos(0, 2), to: pos(1, 2), spawned: false });
    expect(moveOf(fall.moves, r.id)).toBeUndefined();

    const spawned = fall.moves.filter((m) => m.spawned);
    expect(spawned).toHaveLength(5);
    const col1 = spawned.filter((m) => m.to.col === 1).sort((x, y) => y.to.row - x.to.row);
    expect(col1.map((m) => [m.from.row, m.to.row])).toEqual([
      [-1, 2],
      [-2, 1],
      [-3, 0],
    ]);
    expect(moveOf(fall.moves, board.tokenAt(0, 0)!.id)!.from).toEqual(pos(-1, 0));
    expect(fall.delivered).toHaveLength(0);
    expect(fall.scoreGained).toBe(0);
  });

  it("does not let tokens pass through a hole; the lower segment refills from its own top", () => {
    const board = parseBoard(["a", ".", "#", "."]);
    const a = board.tokenAt(0, 0)!;
    const fall = applyGravity(board, ctx(board));
    expect(board.tokenAt(1, 0)).toBe(a);
    expect(moveOf(fall.moves, a.id)!.to).toEqual(pos(1, 0));
    const below = moveOf(fall.moves, board.tokenAt(3, 0)!.id)!;
    expect(below).toMatchObject({ from: pos(2, 0), to: pos(3, 0), spawned: true });
    expect(moveOf(fall.moves, board.tokenAt(0, 0)!.id)!.from).toEqual(pos(-1, 0));
    expect(board.cells[2][0].token).toBeNull();
  });

  it("treats a stone root as a floor and a ceiling", () => {
    const board = parseBoard(["a", ".", "X", "."]);
    const fall = applyGravity(board, ctx(board));
    expect(board.cells[2][0].token).toBeNull();
    expect(board.cells[2][0].blocker?.type).toBe("stoneRoot");
    expect(moveOf(fall.moves, board.tokenAt(3, 0)!.id)!.from).toEqual(pos(2, 0));
    expect(board.tokenAt(1, 0)!.color).toBe("azure");
  });

  it("never moves a token under a blocker and splits the column there", () => {
    const board = parseBoard([".", "aV", ".", "cB", "."]);
    const pinned = board.tokenAt(1, 0)!;
    const pinnedB = board.tokenAt(3, 0)!;
    const fall = applyGravity(board, ctx(board));
    expect(board.tokenAt(1, 0)).toBe(pinned);
    expect(board.tokenAt(3, 0)).toBe(pinnedB);
    expect(fall.moves).toHaveLength(3);
    expect(fall.moves.map((m) => [m.from.row, m.to.row]).sort()).toEqual([
      [-1, 0],
      [1, 2],
      [3, 4],
    ]);
  });

  const seeds: SeedConfig = { spawnCols: [0], exitCells: [pos(2, 0)], maxOnBoard: 1 };

  it("spawns a seed at the top of a spawn column when the objective needs one", () => {
    const board = parseBoard([". a", "a c", "cE j"]);
    const fall = applyGravity(board, ctx(board, { seeds, seedsWanted: 1 }));
    const seed = board.tokenAt(0, 0)!;
    expect(seed.kind).toBe("seed");
    expect(moveOf(fall.moves, seed.id)).toMatchObject({ from: pos(-1, 0), to: pos(0, 0), spawned: true });
    expect(board.countTokens("seed")).toBe(1);
  });

  it("spawns at most one seed per step and none once enough are delivered or on board", () => {
    const more: SeedConfig = { spawnCols: [0, 1], exitCells: [pos(2, 0), pos(2, 1)], maxOnBoard: 3 };
    const board = parseBoard([". .", ". .", "cE jE"]);
    applyGravity(board, ctx(board, { seeds: more, seedsWanted: 3 }));
    expect(board.countTokens("seed")).toBe(1);

    const done = parseBoard([". a", "a c", "cE j"]);
    applyGravity(done, ctx(done, { seeds, seedsWanted: 1, seedsDelivered: 1 }));
    expect(done.countTokens("seed")).toBe(0);

    const capped = parseBoard([". a", "S c", "cE j"]);
    applyGravity(capped, ctx(capped, { seeds, seedsWanted: 5 }));
    expect(capped.countTokens("seed")).toBe(1);
  });

  it("does not spawn a seed into a column whose top cell is already filled", () => {
    const board = parseBoard(["a .", "a .", "cE j"]);
    applyGravity(board, ctx(board, { seeds, seedsWanted: 1 }));
    expect(board.countTokens("seed")).toBe(0);
  });

  it("delivers a seed that lands on an exit, refills above it and counts it once", () => {
    const board = parseBoard(["a", "S", ".E"]);
    const a = board.tokenAt(0, 0)!;
    const seed = board.tokenAt(1, 0)!;
    const fall = applyGravity(board, ctx(board, { seeds, seedsWanted: 1, cascadeIndex: 2 }));

    expect(fall.delivered).toEqual([{ token: seed, at: pos(2, 0) }]);
    expect(moveOf(fall.moves, seed.id)).toEqual({ token: seed, from: pos(1, 0), to: pos(2, 0), spawned: false });
    expect(moveOf(fall.moves, a.id)).toEqual({ token: a, from: pos(0, 0), to: pos(2, 0), spawned: false });
    expect(board.tokenAt(2, 0)).toBe(a);
    expect(board.countTokens("seed")).toBe(0);
    expect(full(board)).toBe(true);
    const spawned = fall.moves.filter((m) => m.spawned);
    expect(spawned.map((m) => [m.from.row, m.to.row]).sort()).toEqual([
      [-1, 1],
      [-2, 0],
    ]);
    expect(fall.scoreGained).toBe(800);
    expect(fall.scoreEvents).toEqual([{ at: pos(2, 0), points: 800, label: "Seed delivered" }]);

    const again = applyGravity(board, ctx(board, { seeds, seedsWanted: 1, seedsDelivered: 1 }));
    expect(again.delivered).toHaveLength(0);
    expect(again.moves).toHaveLength(0);
  });

  it("delivers a seed that was already resting on the exit", () => {
    const board = parseBoard(["a", "SE"]);
    const fall = applyGravity(board, ctx(board, { seeds: { spawnCols: [0], exitCells: [pos(1, 0)], maxOnBoard: 1 } }));
    expect(fall.delivered).toHaveLength(1);
    expect(fall.scoreGained).toBe(400);
    expect(board.tokenAt(1, 0)!.color).not.toBeNull();
  });

  it("keeps spawning from the board rng so results are reproducible", () => {
    const a = parseBoard([". . .", ". . .", ". . ."], {}, 7);
    const b = parseBoard([". . .", ". . .", ". . ."], {}, 7);
    applyGravity(a, ctx(a));
    applyGravity(b, ctx(b));
    expect(a.toString()).toBe(b.toString());
  });
});
