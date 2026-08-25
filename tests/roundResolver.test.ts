import { describe, expect, it } from "vitest";
import type { CellPosition, LevelDefinition } from "../src/game/Types";
import { Board } from "../src/board/Board";
import { findValidMoves } from "../src/board/MoveValidator";
import { reshuffle } from "../src/board/ReshuffleSystem";
import { RoundResolver } from "../src/board/RoundResolver";
import { effectCells } from "../src/board/SpecialResolver";
import { createBlocker } from "../src/entities/Blocker";
import { keys, parseBoard, pos } from "./helpers";

function level(board: Board, over: Partial<LevelDefinition> = {}): LevelDefinition {
  return {
    id: 1,
    name: "test",
    board: board.config,
    moveLimit: 10,
    objectives: [{ type: "score", target: 100 }],
    allowedSpecials: board.config.allowedSpecials,
    starThresholds: [100, 200, 300],
    ...over,
  };
}

function resolver(board: Board, over: Partial<LevelDefinition> = {}): RoundResolver {
  return new RoundResolver(board, board.rng, level(board, over));
}

function play(board: Board, a: CellPosition, b: CellPosition, over: Partial<LevelDefinition> = {}) {
  const r = resolver(board, over);
  const swap = r.trySwap(a, b);
  expect(swap.valid).toBe(true);
  const step = r.resolveClear(0, swap.activations);
  expect(step).not.toBeNull();
  return { resolver: r, swap, step: step! };
}

// Swapping (3,2) up into (2,2) lines up four rubies in row 2.
const FOUR = ["a c v j p", "c v j p a", "r r a r c", "j p r c v", "p a c v j"];

describe("trySwap", () => {
  it("leaves the board alone and reports no activations for an illegal move", () => {
    const board = parseBoard(FOUR);
    const before = board.toString();
    const out = resolver(board).trySwap(pos(0, 0), pos(0, 1));
    expect(out).toEqual({ valid: false, a: pos(0, 0), b: pos(0, 1), combo: "none", activations: [] });
    expect(board.toString()).toBe(before);
  });

  it("performs a legal plain swap on the board", () => {
    const board = parseBoard(FOUR);
    const moved = board.tokenAt(3, 2)!;
    const out = resolver(board).trySwap(pos(3, 2), pos(2, 2));
    expect(out).toMatchObject({ valid: true, combo: "none", activations: [] });
    expect(board.tokenAt(2, 2)).toBe(moved);
  });

  it("returns null from resolveClear when nothing matched and nothing fired", () => {
    const board = parseBoard(FOUR);
    expect(resolver(board).resolveClear(0)).toBeNull();
  });
});

describe("blockers", () => {
  it("breaks a glass vine together with the gem under it", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r rV a r c", "j p r c v", "p a c v j"]);
    const covered = board.tokenAt(2, 1)!;
    const { step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.blockerHits).toEqual([{ at: pos(2, 1), type: "glassVine", remainingHp: 0, destroyed: true }]);
    expect(step.cleared.map((c) => c.token)).toContain(covered);
    expect(board.cells[2][1].blocker).toBeNull();
    expect(board.tokenAt(2, 1)).toBeNull();
    expect(step.scoreGained).toBe(180 + 25 + 150 + 100 + 250);
  });

  it("opens a locked bud next to a match and keeps its token", () => {
    const board = parseBoard(["a c v j p", "c v jB p a", "r r a r c", "j p r c v", "p a c v j"]);
    const sealed = board.tokenAt(1, 2)!;
    const { step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.blockerHits).toEqual([{ at: pos(1, 2), type: "lockedBud", remainingHp: 0, destroyed: true }]);
    expect(board.cells[1][2].blocker).toBeNull();
    expect(board.tokenAt(1, 2)).toBe(sealed);
    expect(step.cleared.map((c) => c.token)).not.toContain(sealed);
  });

  it("hits a stone root next to a match once, then removes it at zero", () => {
    const board = parseBoard(["a c v j p", "c v X p a", "r r a r c", "j p r c v", "p a c v j"]);
    const { step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.blockerHits).toEqual([{ at: pos(1, 2), type: "stoneRoot", remainingHp: 1, destroyed: false }]);
    expect(board.cells[1][2].blocker?.hp).toBe(1);

    const weak = parseBoard(["a c v j p", "c v X p a", "r r a r c", "j p r c v", "p a c v j"]);
    weak.cells[1][2].blocker = createBlocker("stoneRoot", 1);
    const second = play(weak, pos(3, 2), pos(2, 2));
    expect(second.step.blockerHits[0]).toMatchObject({ type: "stoneRoot", remainingHp: 0, destroyed: true });
    expect(weak.cells[1][2].blocker).toBeNull();
    expect(weak.cells[1][2].token).toBeNull();
    second.resolver.fall(1, 0);
    expect(weak.tokenAt(1, 2)).not.toBeNull();
  });

  it("hits a blocker only once even when two match cells touch it", () => {
    const board = parseBoard(["a c r j p", "c X r p a", "j r a r c", "p a r v j", "v j c a p"]);
    const { step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.groups[0].cells).toHaveLength(5);
    expect(step.blockerHits).toEqual([{ at: pos(1, 1), type: "stoneRoot", remainingHp: 1, destroyed: false }]);
  });

  it("beams pass through roots, buds and vines, damaging each and clearing beyond", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r- X aB cV v", "j p r c v", "p a c v j"]);
    const kept = board.tokenAt(2, 2)!;
    const beam = effectCells(board, pos(2, 0), "lineHorizontal", "single");
    const step = resolver(board).resolveClear(0, [beam])!;
    expect(keys(step.cleared.map((c) => c.at))).toEqual(keys([pos(2, 0), pos(2, 3), pos(2, 4)]));
    expect(step.blockerHits.map((h) => [h.type, h.remainingHp])).toEqual([
      ["stoneRoot", 1],
      ["lockedBud", 0],
      ["glassVine", 0],
    ]);
    expect(board.tokenAt(2, 2)).toBe(kept);
    expect(board.cells[2][2].blocker).toBeNull();
    expect(step.activations).toEqual([beam]);
  });

  it("hits a bud once when it is both next to the match and inside a beam", () => {
    const board = parseBoard(["a c v j p", "c v jB p a", "r r a r c", "j p r c v", "p a c v j"]);
    const r = resolver(board);
    const swap = r.trySwap(pos(3, 2), pos(2, 2));
    const beam = effectCells(board, pos(4, 2), "lineVertical", "single");
    const step = r.resolveClear(0, [...swap.activations, beam])!;
    expect(step.blockerHits.filter((h) => h.at.row === 1 && h.at.col === 2)).toHaveLength(1);
    expect(board.tokenAt(1, 2)).not.toBeNull();
    // The created beam at (2,2) is immune to the vertical beam passing through it.
    expect(step.created[0].at).toEqual(pos(2, 2));
    expect(board.tokenAt(2, 2)!.special).toBe("lineHorizontal");
    expect(keys(step.cleared.map((c) => c.at))).toEqual(
      keys([pos(2, 0), pos(2, 1), pos(2, 3), pos(0, 2), pos(3, 2), pos(4, 2)]),
    );
  });

  it("leaves seeds alone inside a beam", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r- S a c v", "j p r c v", "p a c v j"]);
    const seed = board.tokenAt(2, 1)!;
    const step = resolver(board).resolveClear(0, [effectCells(board, pos(2, 0), "lineHorizontal", "single")])!;
    expect(step.cleared).toHaveLength(4);
    expect(board.tokenAt(2, 1)).toBe(seed);
  });
});

describe("terrain", () => {
  it("takes one layer off every cleared cell and off the creation cell", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r2 r1 a1 r c", "j p r c v", "p a c v j"]);
    const { resolver: r, step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.terrainHits).toHaveLength(3);
    expect(step.terrainHits.find((h) => h.at.col === 0)).toEqual({ at: pos(2, 0), remainingLayers: 1 });
    expect(step.terrainHits.find((h) => h.at.col === 1)).toEqual({ at: pos(2, 1), remainingLayers: 0 });
    expect(step.terrainHits.find((h) => h.at.col === 2)).toEqual({ at: pos(2, 2), remainingLayers: 0 });
    expect(board.cells[2][0].terrain?.layers).toBe(1);
    expect(board.cells[2][1].terrain).toBeNull();
    expect(board.cells[2][2].terrain).toBeNull();
    expect(board.tokenAt(2, 2)).not.toBeNull();
    expect(r.terrainHitThisMove).toBe(3);
    expect(step.scoreGained).toBe(180 + 25 + 150 + 3 * 80);
  });

  it("loses a layer under an empty cell inside a special effect", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r- .1 a c v", "j p r c v", "p a c v j"]);
    const step = resolver(board).resolveClear(0, [effectCells(board, pos(2, 0), "lineHorizontal", "single")])!;
    expect(step.terrainHits).toEqual([{ at: pos(2, 1), remainingLayers: 0 }]);
  });
});

describe("scoring", () => {
  it("multiplies the step by the cascade multiplier and keeps events in sync", () => {
    const THREE = ["a c v j p", "c v j p a", "r r r j c", "j p a c v", "p a c v j"];
    expect(resolver(parseBoard(THREE)).resolveClear(0)!.scoreGained).toBe(180);
    const step1 = resolver(parseBoard(THREE)).resolveClear(1)!;
    expect(step1.scoreGained).toBe(270);
    expect(step1.scoreEvents).toEqual([{ at: pos(2, 1), points: 270 }]);
    expect(resolver(parseBoard(THREE)).resolveClear(2)!.scoreGained).toBe(360);
  });

  it("rounds the total once and spreads the difference over the events", () => {
    const board = parseBoard(["r r r j p", "c v j p a", "a a a j c", "j p c c v", "p a c v j"]);
    const step = resolver(board).resolveClear(1)!;
    expect(step.groups).toHaveLength(2);
    expect(step.scoreGained).toBe(540);
    expect(step.scoreEvents.reduce((sum, e) => sum + e.points, 0)).toBe(540);
    const odd = parseBoard(["r r r r p", "c v j p a", "a a a a c", "j p c c v", "p a c v j"]);
    const both = resolver(odd).resolveClear(1)!;
    expect(both.scoreGained).toBe(Math.round(2 * (205 + 150) * 1.5));
    expect(both.scoreEvents.reduce((sum, e) => sum + e.points, 0)).toBe(both.scoreGained);
  });

  it("scores a four match with its beam at the swap", () => {
    const { step } = play(parseBoard(FOUR), pos(3, 2), pos(2, 2));
    expect(step.scoreGained).toBe(180 + 25 + 150);
    expect(step.scoreEvents).toHaveLength(1);
    expect(step.shake).toBe(0);
  });
});

describe("endOfMove", () => {
  const MOSS = ["a1 c v j p", "c v j p a", "r r a r c", "j p r c v", "p a c v j"];

  it("grows moss next to existing moss when no moss was cleared", () => {
    const board = parseBoard(MOSS);
    const { resolver: r } = play(board, pos(3, 2), pos(2, 2), { mossSpreads: true });
    expect(r.terrainHitThisMove).toBe(0);
    const events = r.endOfMove();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("moss");
    expect([pos(0, 1), pos(1, 0)]).toContainEqual(events[0].at);
    expect(board.cells[events[0].at.row][events[0].at.col].terrain).toEqual({ type: "moss", layers: 1, maxLayers: 1 });
  });

  it("does not grow moss when moss was cleared this move, and resets the counter", () => {
    const board = parseBoard(["a c v j p", "c v j p a", "r1 r a r c", "j p r c v", "p a c v j"]);
    const { resolver: r } = play(board, pos(3, 2), pos(2, 2), { mossSpreads: true });
    expect(r.terrainHitThisMove).toBe(1);
    expect(r.endOfMove()).toEqual([]);
    expect(r.terrainHitThisMove).toBe(0);
  });

  it("does not grow moss unless the level says so", () => {
    const board = parseBoard(MOSS);
    expect(resolver(board).endOfMove()).toEqual([]);
  });

  it("spreads one mist onto a plain neighbouring gem when no mist was hit", () => {
    const board = parseBoard(["aM c v j p", "c v j p a", "r r a r c", "j p r c v", "p a c v j"]);
    const events = resolver(board).endOfMove();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("shadowMist");
    expect([pos(0, 1), pos(1, 0)]).toContainEqual(events[0].at);
    const cell = board.cells[events[0].at.row][events[0].at.col];
    expect(cell.blocker).toEqual({ type: "shadowMist", hp: 1, maxHp: 1 });
    expect(cell.token).not.toBeNull();
  });

  it("does not spread mist that was hit this move", () => {
    const board = parseBoard(["a c v j p", "c v jM p a", "r r a r c", "j p r c v", "p a c v j"]);
    const { resolver: r, step } = play(board, pos(3, 2), pos(2, 2));
    expect(step.blockerHits[0].type).toBe("shadowMist");
    expect(r.mistHitThisMove).toBe(1);
    expect(r.endOfMove()).toEqual([]);
    expect(r.mistHitThisMove).toBe(0);
  });

  it("does not spread mist when fewer than ten free gems would remain", () => {
    const board = parseBoard(["aM c v", "c v j", "r r a"]);
    expect(resolver(board).endOfMove()).toEqual([]);
    const border = parseBoard(["aM c v j", "c v j p", "r p a #"]);
    expect(resolver(border).endOfMove()).toEqual([]);
    const enough = parseBoard(["aM c v j", "c v j p", "r p a r", "a c v j"]);
    expect(resolver(enough).endOfMove()).toHaveLength(1);
  });

  it("spreads both moss and mist in one quiet move", () => {
    const board = parseBoard(["a1 c v j p", "c v j p a", "r r a r c", "j p r c v", "p a c v jM"]);
    const events = resolver(board, { mossSpreads: true }).endOfMove();
    expect(events.map((e) => e.kind).sort()).toEqual(["moss", "shadowMist"]);
  });
});

describe("random play", () => {
  it("keeps the board consistent through many moves with every feature on", () => {
    const def: LevelDefinition = {
      id: 99,
      name: "fuzz",
      board: { rows: 8, cols: 8, tokenTypes: ["ruby", "azure", "citrine", "violet", "jade"], allowedSpecials: [] },
      moveLimit: 40,
      objectives: [{ type: "deliverSeeds", target: 3 }],
      holes: [pos(3, 3), pos(3, 4)],
      terrain: [
        { row: 6, col: 1, type: "moss", layers: 2 },
        { row: 6, col: 2, type: "moss", layers: 1 },
      ],
      blockers: [
        { row: 5, col: 5, type: "stoneRoot" },
        { row: 1, col: 6, type: "glassVine" },
        { row: 2, col: 1, type: "lockedBud" },
        { row: 4, col: 6, type: "shadowMist" },
      ],
      seeds: { spawnCols: [0], exitCells: [pos(7, 0)], maxOnBoard: 1 },
      allowedSpecials: ["lineHorizontal", "lineVertical", "burst", "prism"],
      starThresholds: [100, 200, 300],
      mossSpreads: true,
    };
    for (const seed of [1, 2, 3, 4, 5]) {
      const board = Board.fromLevel({ ...def, seed });
      const r = resolver(board, def);
      let delivered = 0;
      const checkBoard = (): void => {
        const ids = new Set<number>();
        board.forEachCell((cell) => {
          if (!cell.playable) {
            expect(cell.token).toBeNull();
            return;
          }
          if (cell.blocker?.type === "stoneRoot") {
            expect(cell.token).toBeNull();
            return;
          }
          expect(cell.token).not.toBeNull();
          expect(ids.has(cell.token!.id)).toBe(false);
          ids.add(cell.token!.id);
        });
      };
      checkBoard();
      for (let move = 0; move < 40; move++) {
        let moves = findValidMoves(board);
        if (moves.length === 0) {
          const shuffled = reshuffle(board, board.rng);
          if (!shuffled.success) break;
          moves = findValidMoves(board);
        }
        const pick = board.rng.pick(moves);
        const swap = r.trySwap(pick.a, pick.b);
        expect(swap.valid).toBe(true);
        let cascade = 0;
        let step = r.resolveClear(0, swap.activations);
        while (step) {
          const clearedIds = new Set(step.cleared.map((c) => c.token.id));
          expect(clearedIds.size).toBe(step.cleared.length);
          board.forEachCell((cell) => {
            if (cell.token) expect(clearedIds.has(cell.token.id)).toBe(false);
          });
          expect(step.scoreEvents.reduce((s, e) => s + e.points, 0)).toBe(step.scoreGained);
          for (const c of step.created) expect(board.tokenAt(c.at.row, c.at.col)).toBe(c.token);
          const fall = r.fall(cascade, delivered);
          for (const m of fall.moves) {
            if (fall.delivered.some((d) => d.token === m.token)) continue;
            expect(board.tokenAt(m.to.row, m.to.col)).toBe(m.token);
          }
          delivered += fall.delivered.length;
          checkBoard();
          cascade++;
          step = r.resolveClear(cascade);
        }
        r.endOfMove();
        checkBoard();
      }
      expect(delivered).toBeLessThanOrEqual(3);
    }
  });
});
