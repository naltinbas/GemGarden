import { describe, expect, it } from "vitest";
import type { LevelDefinition, MatchGroup } from "../src/game/Types";
import { findMatches } from "../src/board/MatchFinder";
import { RoundResolver } from "../src/board/RoundResolver";
import { chooseSpecial, effectCells } from "../src/board/SpecialResolver";
import { keys, parseBoard, pos } from "./helpers";
import type { Board } from "../src/board/Board";

function level(board: Board): LevelDefinition {
  return {
    id: 1,
    name: "test",
    board: board.config,
    moveLimit: 10,
    objectives: [{ type: "score", target: 100 }],
    allowedSpecials: board.config.allowedSpecials,
    starThresholds: [100, 200, 300],
  };
}

function resolver(board: Board): RoundResolver {
  return new RoundResolver(board, board.rng, level(board));
}

/** Runs the swap and the first clear step, asserting the swap was legal. */
function play(board: Board, a: ReturnType<typeof pos>, b: ReturnType<typeof pos>) {
  const r = resolver(board);
  const swap = r.trySwap(a, b);
  expect(swap.valid).toBe(true);
  const step = r.resolveClear(0, swap.activations);
  expect(step).not.toBeNull();
  return { resolver: r, swap, step: step! };
}

function groupOf(cells: string[]): MatchGroup {
  return findMatches(parseBoard(cells))[0];
}

describe("chooseSpecial", () => {
  const ALL = ["lineHorizontal", "lineVertical", "burst", "prism"] as const;

  it("makes a beam along the run for four in a row", () => {
    const h = groupOf(["r r r r a", "a c v j p"]);
    expect(chooseSpecial(h, ALL, [])).toMatchObject({ type: "lineHorizontal", color: "ruby" });
    const v = groupOf(["r a", "r c", "r v", "r j", "a p"]);
    expect(chooseSpecial(v, ALL, [])).toMatchObject({ type: "lineVertical", at: pos(2, 0) });
  });

  it("makes a colorless prism for five in a row and a burst for a T", () => {
    const five = groupOf(["r r r r r"]);
    expect(chooseSpecial(five, ALL, [])).toEqual({ at: pos(0, 2), type: "prism", color: null });
    const tee = groupOf(["r r r", "a r c", "v r j"]);
    expect(chooseSpecial(tee, ALL, [])).toEqual({ at: pos(0, 1), type: "burst", color: "ruby" });
  });

  it("returns nothing for a plain three", () => {
    expect(chooseSpecial(groupOf(["r r r a"]), ALL, [])).toBeNull();
  });

  it("falls back to the next allowed type", () => {
    const five = groupOf(["r r r r r"]);
    expect(chooseSpecial(five, ["lineHorizontal"], [])?.type).toBe("lineHorizontal");
    expect(chooseSpecial(five, ["burst"], [])).toBeNull();
    const tee = groupOf(["r r r r", "a r c v", "v r j p"]);
    expect(chooseSpecial(tee, ["lineHorizontal", "lineVertical"], [])?.type).toBe("lineHorizontal");
    expect(chooseSpecial(tee, [], [])).toBeNull();
  });

  it("prefers the swapped cells in the order given, then the intersection, then the middle", () => {
    const tee = groupOf(["r r r", "a r c", "v r j"]);
    expect(chooseSpecial(tee, ALL, [pos(2, 1), pos(0, 0)])?.at).toEqual(pos(2, 1));
    expect(chooseSpecial(tee, ALL, [pos(2, 2), pos(0, 0)])?.at).toEqual(pos(0, 0));
    expect(chooseSpecial(tee, ALL, [pos(2, 2)])?.at).toEqual(pos(0, 1));
    const four = groupOf(["r r r r a"]);
    expect(chooseSpecial(four, ALL, [])?.at).toEqual(pos(0, 2));
  });

  it("skips cells the caller vetoes", () => {
    const four = groupOf(["r r r r a"]);
    const veto = (p: { row: number; col: number }) => p.col !== 2;
    expect(chooseSpecial(four, ALL, [pos(0, 2)], veto)?.at).toEqual(pos(0, 0));
  });
});

describe("special creation through a swap", () => {
  it("turns the moved token into a horizontal beam on a four match", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r r a r c", "j p r c v", "p a c v j"]);
    const before = board.tokenAt(3, 2)!;
    const { step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.created).toHaveLength(1);
    expect(step.created[0]).toMatchObject({ at: pos(2, 2), type: "lineHorizontal", color: "ruby" });
    expect(step.created[0].token).toBe(before);
    expect(board.tokenAt(2, 2)).toBe(before);
    expect(before.special).toBe("lineHorizontal");
    expect(keys(step.cleared.map((c) => c.at))).toEqual(keys([pos(2, 0), pos(2, 1), pos(2, 3)]));
    expect(board.tokenAt(2, 0)).toBeNull();
  });

  it("turns the moved token into a vertical beam on a vertical four", () => {
    const board = parseBoard(["r a v j p", "r v j p a", "a r p c v", "r p c v j", "p a c v j"]);
    const { step } = play(board, pos(2, 1), pos(2, 0));
    expect(step.created[0]).toMatchObject({ at: pos(2, 0), type: "lineVertical" });
    expect(board.tokenAt(2, 0)!.special).toBe("lineVertical");
  });

  it("makes a prism with no color on a five match", () => {
    const board = parseBoard(["a c v j p a", "c v j p a c", "r r a r r c", "j p r c v j", "p a c v j p"]);
    const { step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.created[0]).toMatchObject({ at: pos(2, 2), type: "prism", color: null });
    const token = board.tokenAt(2, 2)!;
    expect(token.special).toBe("prism");
    expect(token.color).toBeNull();
    expect(step.cleared).toHaveLength(4);
  });

  it("makes a burst at the intersection of a T", () => {
    const board = parseBoard(["a c r j p", "c v r p a", "j r a r c", "p a r v j", "v j c a p"]);
    const { step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.groups[0].containsIntersection).toBe(true);
    expect(step.created[0]).toMatchObject({ at: pos(2, 2), type: "burst", color: "ruby" });
    expect(step.cleared).toHaveLength(4);
  });

  it("makes a burst at the corner of an L without a swap", () => {
    const board = parseBoard(["r r r j p", "r v c p a", "r j a c v"]);
    const step = resolver(board).resolveClear(0)!;
    expect(step.created[0]).toMatchObject({ at: pos(0, 0), type: "burst" });
    expect(board.tokenAt(0, 0)!.special).toBe("burst");
    expect(step.cleared).toHaveLength(4);
  });

  it("creates nothing when the level allows no specials", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r r a r c", "j p r c v", "p a c v j"], { allowedSpecials: [] });
    const { step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.created).toHaveLength(0);
    expect(step.cleared).toHaveLength(4);
  });
});

describe("chain reactions", () => {
  it("fires a beam that sits inside a match and clears its row", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r r- r j c", "j p r c v", "p a c v j"]);
    const step = resolver(board).resolveClear(0)!;
    expect(step.activations).toHaveLength(1);
    expect(step.activations[0]).toMatchObject({ at: pos(2, 1), type: "lineHorizontal", combo: "single" });
    expect(keys(step.cleared.map((c) => c.at))).toEqual(keys([0, 1, 2, 3, 4].map((c) => pos(2, c))));
    expect(step.scoreGained).toBe(180 + 250 + 2 * 30);
    expect(step.shake).toBe(0.3);
  });

  it("chains a second special reached by the first", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r r- r j| c", "j p r c v", "p a c v j"]);
    const step = resolver(board).resolveClear(0)!;
    expect(step.activations.map((a) => a.type)).toEqual(["lineHorizontal", "lineVertical"]);
    expect(step.cleared).toHaveLength(5 + 4);
    expect(board.tokenAt(0, 3)).toBeNull();
    expect(board.tokenAt(4, 3)).toBeNull();
  });

  it("consumes a prism hit by a beam without firing it", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r r- r @ c", "j p r c v", "p a c v j"]);
    const step = resolver(board).resolveClear(0)!;
    expect(step.activations[1]).toMatchObject({ at: pos(2, 3), type: "prism", combo: "single", cells: [pos(2, 3)] });
    expect(step.cleared).toHaveLength(5);
  });

  it("fires each special in the area exactly once", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r r- r- j c", "j p r c v", "p a c v j"]);
    const step = resolver(board).resolveClear(0)!;
    expect(step.activations).toHaveLength(2);
    expect(step.cleared).toHaveLength(5);
  });
});

describe("effectCells", () => {
  const plain = () => parseBoard(["a c v j p", "c v j p a", "j p a c v", "p a c v j", "v j p a c"]);

  it("beams clear a whole row or column, skipping holes", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "j p a c #", "p a c v j", "v j p a c"]);
    const h = effectCells(board, pos(2, 2), "lineHorizontal", "single");
    expect(keys(h.cells)).toEqual(keys([0, 1, 2, 3].map((c) => pos(2, c))));
    expect(h.lines).toEqual([{ orientation: "horizontal", index: 2 }]);
    const v = effectCells(board, pos(2, 4), "lineVertical", "single");
    expect(keys(v.cells)).toEqual(keys([0, 1, 3, 4].map((r) => pos(r, 4))));
  });

  it("bursts clear a 3x3 clipped to the board", () => {
    const b = effectCells(plain(), pos(0, 0), "burst", "single");
    expect(keys(b.cells)).toEqual(keys([pos(0, 0), pos(0, 1), pos(1, 0), pos(1, 1)]));
    expect(b.radius).toBe(1);
    expect(effectCells(plain(), pos(2, 2), "burst", "single").cells).toHaveLength(9);
  });

  it("beamBeam clears the row, the column and a 3x3", () => {
    const a = effectCells(plain(), pos(2, 2), "lineHorizontal", "beamBeam");
    const expected = new Set<string>();
    for (let i = 0; i < 5; i++) expected.add(`2,${i}`).add(`${i},2`);
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) expected.add(`${r},${c}`);
    expect(keys(a.cells)).toEqual([...expected].sort());
    expect(a.lines).toHaveLength(2);
  });

  it("beamBurst clears three rows and three columns", () => {
    const a = effectCells(plain(), pos(2, 2), "burst", "beamBurst");
    const expected = new Set<string>();
    for (let d = 1; d <= 3; d++) for (let i = 0; i < 5; i++) expected.add(`${d},${i}`).add(`${i},${d}`);
    expect(keys(a.cells)).toEqual([...expected].sort());
    expect(a.lines).toHaveLength(6);
    const corner = effectCells(plain(), pos(0, 0), "burst", "beamBurst");
    expect(corner.cells).toHaveLength(16);
  });

  it("burstBurst clears a 5x5", () => {
    expect(effectCells(plain(), pos(2, 2), "burst", "burstBurst").cells).toHaveLength(25);
    expect(effectCells(plain(), pos(0, 0), "burst", "burstBurst").cells).toHaveLength(9);
  });

  it("prismColor picks every free gem of the color plus the prism", () => {
    const board = parseBoard(["@ r a r", "rB rM rV c", "j r a c"]);
    const a = effectCells(board, pos(0, 0), "prism", "prismColor", { color: "ruby" });
    expect(keys(a.cells)).toEqual(keys([pos(0, 0), pos(0, 1), pos(0, 3), pos(1, 2), pos(2, 1)]));
    expect(a.color).toBe("ruby");
  });

  it("prismPrism reaches every playable cell", () => {
    const board = parseBoard(["@ r # r", "S rM rV X"]);
    expect(effectCells(board, pos(0, 0), "prism", "prismPrism").cells).toHaveLength(7);
  });
});

describe("combo swaps", () => {
  it("beam + beam consumes both and clears the cross plus a 3x3", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "j r- a- c v", "p a c v j", "v j p a c"]);
    const { swap, step } = play(board, pos(2, 1), pos(2, 2));
    expect(swap.combo).toBe("beamBeam");
    expect(step.activations).toHaveLength(1);
    expect(step.activations[0]).toMatchObject({ at: pos(2, 2), combo: "beamBeam" });
    expect(step.cleared).toHaveLength(13);
    expect(board.tokenAt(2, 1)).toBeNull();
    expect(step.shake).toBe(0.6);
  });

  it("beam + burst clears three rows and columns", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "j r* a- c v", "p a c v j", "v j p a c"]);
    const { swap, step } = play(board, pos(2, 1), pos(2, 2));
    expect(swap.combo).toBe("beamBurst");
    expect(step.activations[0].type).toBe("burst");
    expect(step.cleared).toHaveLength(21);
  });

  it("burst + burst clears a 5x5", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "j r* a* c v", "p a c v j", "v j p a c"]);
    const { swap, step } = play(board, pos(2, 1), pos(2, 2));
    expect(swap.combo).toBe("burstBurst");
    expect(step.cleared).toHaveLength(25);
  });

  it("prism + gem removes that color everywhere", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "j @ a c v", "p a c v j", "v j p a c"]);
    const { swap, step } = play(board, pos(2, 1), pos(2, 2));
    expect(swap.combo).toBe("prismColor");
    expect(step.activations[0]).toMatchObject({ type: "prism", combo: "prismColor", color: "azure" });
    const colors = step.cleared.map((c) => c.token.color);
    expect(colors.filter((c) => c === "azure")).toHaveLength(5);
    expect(colors.filter((c) => c === null)).toHaveLength(1);
    expect(step.cleared).toHaveLength(6);
    expect(board.tokenAt(2, 2)).toBeNull();
  });

  it("prism + seed only consumes the prism", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "j @ S c v", "p a c v j", "v j p a c"]);
    const seed = board.tokenAt(2, 2)!;
    const { swap, step } = play(board, pos(2, 1), pos(2, 2));
    expect(swap.combo).toBe("single");
    expect(step.cleared).toHaveLength(1);
    expect(board.tokenAt(2, 1)).toBe(seed);
  });

  it("prism + beam turns every gem of that color into a beam and fires them all", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "j @ a- c v", "p a c v j", "v j p a c"]);
    const { swap, step } = play(board, pos(2, 1), pos(2, 2));
    expect(swap.combo).toBe("prismBeam");
    expect(swap.activations[0]).toMatchObject({ type: "prism", combo: "prismBeam", at: pos(2, 2), color: "azure" });
    expect(swap.activations[1]).toMatchObject({ type: "lineHorizontal", combo: "prismBeam", at: pos(2, 1) });
    expect(swap.activations).toHaveLength(2 + 4);
    for (const act of swap.activations.slice(2)) {
      expect(["lineHorizontal", "lineVertical"]).toContain(act.type);
      expect(act.combo).toBe("prismBeam");
    }
    expect(step.activations).toHaveLength(6);
    expect(step.created).toHaveLength(0);
    for (const act of swap.activations) expect(board.tokenAt(act.at.row, act.at.col)).toBeNull();
  });

  it("prism + burst turns every gem of that color into a burst", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "j @ a* c v", "p a c v j", "v j p a c"]);
    const { swap, step } = play(board, pos(2, 1), pos(2, 2));
    expect(swap.combo).toBe("prismBurst");
    expect(swap.activations.slice(1).every((a) => a.type === "burst" && a.combo === "prismBurst")).toBe(true);
    expect(step.cleared.length).toBeGreaterThanOrEqual(7);
  });

  it("prism + prism clears the board but leaves seeds", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "j @ @ c v", "p a S v j", "v j p a c"]);
    const { swap, step } = play(board, pos(2, 1), pos(2, 2));
    expect(swap.combo).toBe("prismPrism");
    expect(step.activations).toHaveLength(1);
    expect(step.cleared).toHaveLength(24);
    expect(board.tokenAt(3, 2)!.kind).toBe("seed");
    expect(step.shake).toBe(1);
  });
});
