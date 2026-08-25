import { describe, expect, it } from "vitest";
import type { ClearStep, FallStep, Token, TokenColor } from "../src/game/Types";
import { ClearBlockersObjective } from "../src/objectives/ClearBlockersObjective";
import { ClearTerrainObjective } from "../src/objectives/ClearTerrainObjective";
import { CollectObjective } from "../src/objectives/CollectObjective";
import { DeliverSeedObjective } from "../src/objectives/DeliverSeedObjective";
import { ObjectiveTracker, createObjective } from "../src/objectives/ObjectiveTracker";
import { ScoreObjective } from "../src/objectives/ScoreObjective";
import { createBlocker } from "../src/entities/Blocker";
import { createTerrain } from "../src/entities/Terrain";
import { parseBoard, pos } from "./helpers";

let nextId = 1;

function gem(color: TokenColor | null, special: Token["special"] = "none"): Token {
  return { id: nextId++, kind: "gem", color, special };
}

function seed(): Token {
  return { id: nextId++, kind: "seed", color: null, special: "none" };
}

function clearStep(over: Partial<ClearStep> = {}): ClearStep {
  return {
    cascadeIndex: 0,
    groups: [],
    cleared: [],
    created: [],
    activations: [],
    blockerHits: [],
    terrainHits: [],
    scoreGained: 0,
    scoreEvents: [],
    shake: 0,
    ...over,
  };
}

function fallStep(over: Partial<FallStep> = {}): FallStep {
  return { moves: [], delivered: [], scoreGained: 0, scoreEvents: [], ...over };
}

const PLAIN = ["r a c v j", "a c v j p", "c v j p r", "v j p r a", "j p r a c"];

describe("ScoreObjective", () => {
  it("tracks the running total and completes at the target", () => {
    const o = new ScoreObjective({ type: "score", target: 1000 });
    expect(o.status()).toEqual({ type: "score", label: "Score", progress: 0, target: 1000, complete: false, icon: "score" });
    o.onScore(400);
    expect(o.progress).toBe(400);
    expect(o.complete).toBe(false);
    o.onScore(1250);
    expect(o.complete).toBe(true);
    expect(o.progress).toBe(1250);
    expect(o.status().progress).toBe(1000);
  });

  it("ignores clear and fall steps", () => {
    const o = new ScoreObjective({ type: "score", target: 10 });
    o.onClear(clearStep({ scoreGained: 500, cleared: [{ token: gem("ruby"), at: pos(0, 0) }] }));
    o.onFall(fallStep({ scoreGained: 500 }));
    expect(o.progress).toBe(0);
  });
});

describe("CollectObjective", () => {
  it("counts only gems of its color, from any source", () => {
    const o = new CollectObjective({ type: "collect", token: "jade", target: 3 });
    expect(o.label).toBe("Jade Leaf");
    expect(o.icon).toBe("jade");
    o.onClear(
      clearStep({
        cleared: [
          { token: gem("jade"), at: pos(0, 0) },
          { token: gem("ruby"), at: pos(0, 1) },
          { token: gem("jade", "lineHorizontal"), at: pos(0, 2) },
          { token: gem(null, "prism"), at: pos(0, 3) },
          { token: seed(), at: pos(0, 4) },
        ],
      }),
    );
    expect(o.progress).toBe(2);
    expect(o.complete).toBe(false);
    o.onClear(clearStep({ cleared: [{ token: gem("jade"), at: pos(1, 0) }] }));
    expect(o.complete).toBe(true);
    o.onClear(clearStep({ cleared: [{ token: gem("jade"), at: pos(1, 0) }] }));
    expect(o.progress).toBe(4);
    expect(o.status().progress).toBe(3);
  });
});

describe("ClearTerrainObjective", () => {
  it("counts every layer hit against a numeric target", () => {
    const board = parseBoard(PLAIN);
    const o = new ClearTerrainObjective({ type: "clearTerrain", target: 2 }, board);
    expect(o.icon).toBe("moss");
    o.onClear(clearStep({ terrainHits: [{ at: pos(0, 0), remainingLayers: 1 }] }));
    expect(o.progress).toBe(1);
    o.onClear(clearStep({ terrainHits: [{ at: pos(0, 0), remainingLayers: 0 }] }));
    expect(o.complete).toBe(true);
  });

  it("resolves 'all' to the total layers on the starting board", () => {
    const board = parseBoard(["r2 a c v1 j", "a c3 v j p", "c v j p r", "v j p r a", "j p r a c"]);
    const o = new ClearTerrainObjective({ type: "clearTerrain", target: "all" }, board);
    expect(o.target).toBe(6);
    expect(o.status().label).toBe("Crystal Moss");
  });

  it("judges 'all' by the layers left on the board, so spread moss must go too", () => {
    const board = parseBoard(["r2 a c v1 j", "a c v j p", "c v j p r", "v j p r a", "j p r a c"]);
    const o = new ClearTerrainObjective({ type: "clearTerrain", target: "all" }, board);
    expect(o.target).toBe(3);
    expect(o.progress).toBe(0);

    board.cells[0][0].terrain = createTerrain(1);
    o.onClear(clearStep({ terrainHits: [{ at: pos(0, 0), remainingLayers: 1 }] }));
    board.cells[0][3].terrain = null;
    o.onClear(clearStep({ terrainHits: [{ at: pos(0, 3), remainingLayers: 0 }] }));
    expect(o.progress).toBe(2);
    expect(o.complete).toBe(false);

    // Spread: the target stays, progress drops back and the hit count alone never finishes it.
    board.cells[3][3].terrain = createTerrain(1);
    expect(o.target).toBe(3);
    expect(o.progress).toBe(1);
    board.cells[0][0].terrain = null;
    o.onClear(clearStep({ terrainHits: [{ at: pos(0, 0), remainingLayers: 0 }] }));
    expect(o.progress).toBe(2);
    expect(o.complete).toBe(false);

    board.cells[3][3].terrain = null;
    o.onClear(clearStep({ terrainHits: [{ at: pos(3, 3), remainingLayers: 0 }] }));
    expect(o.progress).toBe(3);
    expect(o.complete).toBe(true);
    expect(o.status()).toMatchObject({ progress: 3, target: 3, complete: true, icon: "moss" });
  });
});

describe("ClearBlockersObjective", () => {
  it("counts destroyed hits of its own type only", () => {
    const board = parseBoard(PLAIN);
    const o = new ClearBlockersObjective({ type: "clearBlockers", blocker: "stoneRoot", target: 2 }, board);
    expect(o.label).toBe("Stone Root");
    expect(o.icon).toBe("stoneRoot");
    o.onClear(
      clearStep({
        blockerHits: [
          { at: pos(0, 0), type: "stoneRoot", remainingHp: 1, destroyed: false },
          { at: pos(1, 1), type: "stoneRoot", remainingHp: 0, destroyed: true },
          { at: pos(2, 2), type: "glassVine", remainingHp: 0, destroyed: true },
        ],
      }),
    );
    expect(o.progress).toBe(1);
    expect(o.complete).toBe(false);
    o.onClear(clearStep({ blockerHits: [{ at: pos(0, 0), type: "stoneRoot", remainingHp: 0, destroyed: true }] }));
    expect(o.complete).toBe(true);
  });

  it("resolves 'all' to the count on the starting board", () => {
    const board = parseBoard(["r aV c v j", "a c v jV p", "X v j p r", "v j pB r a", "j p r a c"]);
    const vines = new ClearBlockersObjective({ type: "clearBlockers", blocker: "glassVine", target: "all" }, board);
    const roots = new ClearBlockersObjective({ type: "clearBlockers", blocker: "stoneRoot", target: "all" }, board);
    const buds = new ClearBlockersObjective({ type: "clearBlockers", blocker: "lockedBud", target: "all" }, board);
    expect([vines.target, roots.target, buds.target]).toEqual([2, 1, 1]);
    vines.onClear(clearStep({ blockerHits: [{ at: pos(0, 1), type: "glassVine", remainingHp: 0, destroyed: true }] }));
    expect(vines.status().progress).toBe(1);
  });

  it("judges 'all' shadow mist by what is left on the board", () => {
    const board = parseBoard(["r aM c v j", "a c vM j p", "c v j p r", "v j p r a", "j p r a c"]);
    const o = new ClearBlockersObjective({ type: "clearBlockers", blocker: "shadowMist", target: "all" }, board);
    expect(o.target).toBe(2);
    expect(o.progress).toBe(0);

    board.cells[0][1].blocker = null;
    o.onClear(clearStep({ blockerHits: [{ at: pos(0, 1), type: "shadowMist", remainingHp: 0, destroyed: true }] }));
    expect(o.progress).toBe(1);
    expect(o.complete).toBe(false);

    // Spread: the target stays, progress drops back.
    board.cells[3][3].blocker = createBlocker("shadowMist", 1);
    expect(o.target).toBe(2);
    expect(o.progress).toBe(0);

    board.cells[1][2].blocker = null;
    board.cells[3][3].blocker = null;
    expect(o.progress).toBe(2);
    expect(o.complete).toBe(true);
    expect(o.status()).toMatchObject({ progress: 2, target: 2, complete: true, icon: "shadowMist" });
  });

  it("uses destroyed hits for a numeric mist target", () => {
    const board = parseBoard(["r aM c v j", "a c vM j p", "c v j p r", "v j p r a", "j p r a c"]);
    const o = new ClearBlockersObjective({ type: "clearBlockers", blocker: "shadowMist", target: 3 }, board);
    for (let i = 0; i < 3; i++) {
      o.onClear(clearStep({ blockerHits: [{ at: pos(0, 1), type: "shadowMist", remainingHp: 0, destroyed: true }] }));
    }
    expect(o.complete).toBe(true);
  });
});

describe("DeliverSeedObjective", () => {
  it("counts delivered seeds from fall steps", () => {
    const o = new DeliverSeedObjective({ type: "deliverSeeds", target: 2 });
    expect(o.icon).toBe("seed");
    expect(o.label).toBe("Sun Seeds");
    o.onFall(fallStep({ delivered: [{ token: seed(), at: pos(7, 2) }] }));
    expect(o.progress).toBe(1);
    o.onClear(clearStep({ cleared: [{ token: seed(), at: pos(0, 0) }] }));
    expect(o.progress).toBe(1);
    o.onFall(fallStep({ delivered: [{ token: seed(), at: pos(7, 2) }] }));
    expect(o.complete).toBe(true);
  });
});

describe("ObjectiveTracker", () => {
  it("builds one objective per definition and fans events out", () => {
    const board = parseBoard(["r2 aM c v j", "a c v jV p", "X v j p r", "v j p r a", "j p r a c"]);
    const tracker = new ObjectiveTracker(
      [
        { type: "score", target: 300 },
        { type: "collect", token: "ruby", target: 1 },
        { type: "clearTerrain", target: "all" },
        { type: "clearBlockers", blocker: "stoneRoot", target: "all" },
        { type: "deliverSeeds", target: 1 },
      ],
      board,
    );
    expect(tracker.objectives.map((o) => o.constructor.name)).toEqual([
      "ScoreObjective",
      "CollectObjective",
      "ClearTerrainObjective",
      "ClearBlockersObjective",
      "DeliverSeedObjective",
    ]);
    expect(tracker.statuses().map((s) => s.target)).toEqual([300, 1, 2, 1, 1]);
    expect(tracker.allComplete()).toBe(false);

    board.cells[0][0].terrain = null;
    tracker.onClear(
      clearStep({
        cleared: [{ token: gem("ruby"), at: pos(0, 0) }],
        terrainHits: [
          { at: pos(0, 0), remainingLayers: 1 },
          { at: pos(0, 0), remainingLayers: 0 },
        ],
        blockerHits: [{ at: pos(2, 0), type: "stoneRoot", remainingHp: 0, destroyed: true }],
      }),
    );
    tracker.onFall(fallStep({ delivered: [{ token: seed(), at: pos(4, 0) }] }));
    expect(tracker.statuses().map((s) => s.complete)).toEqual([false, true, true, true, true]);
    tracker.onScore(300);
    expect(tracker.allComplete()).toBe(true);
  });

  it("reports each newly completed objective exactly once", () => {
    const board = parseBoard(PLAIN);
    const tracker = new ObjectiveTracker(
      [
        { type: "score", target: 100 },
        { type: "collect", token: "azure", target: 1 },
      ],
      board,
    );
    expect(tracker.newlyCompleted()).toEqual([]);
    tracker.onScore(100);
    const first = tracker.newlyCompleted();
    expect(first.map((o) => o.label)).toEqual(["Score"]);
    expect(tracker.newlyCompleted()).toEqual([]);
    tracker.onScore(5000);
    tracker.onClear(clearStep({ cleared: [{ token: gem("azure"), at: pos(0, 0) }] }));
    expect(tracker.newlyCompleted().map((o) => o.label)).toEqual(["Azure Droplet"]);
    expect(tracker.newlyCompleted()).toEqual([]);
  });

  it("creates every objective type through createObjective", () => {
    const board = parseBoard(PLAIN);
    expect(createObjective({ type: "deliverSeeds", target: 2 }, board)).toBeInstanceOf(DeliverSeedObjective);
    expect(createObjective({ type: "clearTerrain", target: 4 }, board).target).toBe(4);
  });
});
