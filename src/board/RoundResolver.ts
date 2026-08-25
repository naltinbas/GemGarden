import type {
  BlockerHit,
  Cell,
  CellPosition,
  ClearStep,
  ClearedToken,
  ComboKind,
  FallStep,
  LevelDefinition,
  MatchGroup,
  ScoreEvent,
  SpecialActivation,
  SpecialCreation,
  SpecialType,
  SpreadEvent,
  SwapOutcome,
  TerrainHit,
  Token,
} from "../game/Types";
import { SCORE } from "../game/Config";
import type { Random } from "../utils/Random";
import { createBlocker } from "../entities/Blocker";
import { createTerrain } from "../entities/Terrain";
import type { Board } from "./Board";
import { isSwappable } from "./BoardCell";
import { applyGravity } from "./GravitySystem";
import { findMatches } from "./MatchFinder";
import { isValidSwap } from "./MoveValidator";
import { chooseSpecial, createSpecial, effectCells, groupMiddle } from "./SpecialResolver";

const BEAMS: SpecialType[] = ["lineHorizontal", "lineVertical"];
const MIN_GEMS_FOR_MIST_SPREAD = 10;

function copy(p: CellPosition): CellPosition {
  return { row: p.row, col: p.col };
}

function shakeFor(combo: ComboKind): number {
  switch (combo) {
    case "prismPrism":
      return 1;
    case "beamBeam":
    case "beamBurst":
    case "burstBurst":
    case "prismBeam":
    case "prismBurst":
      return 0.6;
    case "none":
      return 0;
    default:
      return 0.3;
  }
}

/** Applies swaps, clear steps and end-of-move spreads to one board. */
export class RoundResolver {
  readonly board: Board;
  readonly rng: Random;
  readonly level: LevelDefinition;
  terrainHitThisMove = 0;
  mistHitThisMove = 0;
  private lastSwap: { a: CellPosition; b: CellPosition } | null = null;
  /** Tokens consumed by a two-special swap that have no activation of their own. */
  private swapConsumed: number[] = [];

  constructor(board: Board, rng: Random, level: LevelDefinition) {
    this.board = board;
    this.rng = rng;
    this.level = level;
  }

  seedsOnBoard(): number {
    return this.board.countTokens("seed");
  }

  /** Seeds the level's objectives ask for in total. */
  seedsWanted(): number {
    let n = 0;
    for (const o of this.level.objectives) if (o.type === "deliverSeeds") n += o.target;
    return n;
  }

  /** Swaps on the board when the move is legal and builds the activations it triggers. */
  trySwap(a: CellPosition, b: CellPosition): SwapOutcome {
    const board = this.board;
    const validity = isValidSwap(board, a, b);
    const outcome: SwapOutcome = { valid: validity.valid, a: copy(a), b: copy(b), combo: validity.combo, activations: [] };
    if (!validity.valid) return outcome;

    board.swapTokens(a, b);
    this.lastSwap = { a: outcome.a, b: outcome.b };
    this.swapConsumed = [];
    const tokenA = board.tokenAt(a.row, a.col) as Token;
    const tokenB = board.tokenAt(b.row, b.col) as Token;
    const acts = outcome.activations;

    switch (validity.combo) {
      case "none":
        break;
      case "single": {
        const atB = tokenB.special !== "none";
        acts.push(effectCells(board, atB ? b : a, (atB ? tokenB : tokenA).special, "single"));
        break;
      }
      case "prismColor": {
        const prismAtB = tokenB.special === "prism";
        const color = (prismAtB ? tokenA : tokenB).color;
        if (color) acts.push(effectCells(board, prismAtB ? b : a, "prism", "prismColor", { color }));
        break;
      }
      case "beamBeam":
      case "beamBurst":
      case "burstBurst":
        acts.push(effectCells(board, b, tokenB.special, validity.combo));
        this.swapConsumed.push(tokenA.id);
        break;
      case "prismBeam":
      case "prismBurst": {
        const prismAtB = tokenB.special === "prism";
        this.convertAndActivate(prismAtB ? b : a, prismAtB ? a : b, validity.combo, acts);
        break;
      }
      case "prismPrism":
        acts.push(effectCells(board, b, "prism", "prismPrism"));
        this.swapConsumed.push(tokenA.id);
        break;
    }
    return outcome;
  }

  /** Every plain gem of the other special's color turns into that special; all of them fire. */
  private convertAndActivate(
    prismAt: CellPosition,
    otherAt: CellPosition,
    combo: "prismBeam" | "prismBurst",
    acts: SpecialActivation[],
  ): void {
    const board = this.board;
    const other = board.tokenAt(otherAt.row, otherAt.col) as Token;
    const color = other.color;
    const parent: SpecialActivation = { at: copy(prismAt), type: "prism", combo, cells: [copy(prismAt)] };
    if (color) parent.color = color;
    acts.push(parent);
    acts.push(effectCells(board, otherAt, other.special, combo));
    if (!color) return;
    board.forEachCell((cell) => {
      const t = cell.token;
      if (!cell.playable || !t || t === other) return;
      if (t.kind !== "gem" || t.color !== color || t.special !== "none") return;
      if (cell.blocker && cell.blocker.type !== "glassVine") return;
      t.special = combo === "prismBeam" ? this.rng.pick(BEAMS) : "burst";
      acts.push(effectCells(board, cell, t.special, combo));
    });
  }

  /**
   * One clearing round: matches, special creation, chain reactions, blocker and
   * terrain damage, removal and scoring. Null when nothing happens.
   */
  resolveClear(cascadeIndex: number, swapActivations: SpecialActivation[] = []): ClearStep | null {
    const board = this.board;
    const groups = findMatches(board);
    if (groups.length === 0 && swapActivations.length === 0) return null;

    const cols = board.cols;
    const keyOf = (p: CellPosition): number => p.row * cols + p.col;
    const activated = new Set<number>(this.swapConsumed);
    this.swapConsumed = [];
    for (const act of swapActivations) {
      const t = board.tokenAt(act.at.row, act.at.col);
      if (t) activated.add(t.id);
    }

    // Special creation. Created cells are immune to every clear this step.
    const preferred = cascadeIndex === 0 && this.lastSwap ? [this.lastSwap.b, this.lastSwap.a] : [];
    const created: SpecialCreation[] = [];
    const creationGroup: number[] = [];
    const immune = new Set<number>();
    const canPlace = (p: CellPosition): boolean => {
      const t = board.tokenAt(p.row, p.col);
      return t !== null && t.kind === "gem" && t.special === "none" && !activated.has(t.id);
    };
    groups.forEach((group, gi) => {
      const choice = chooseSpecial(group, board.config.allowedSpecials, preferred, canPlace);
      if (!choice) return;
      created.push(createSpecial(board, choice));
      creationGroup.push(gi);
      immune.add(keyOf(choice.at));
    });

    // Reached cells with the first source that touched them: group index, or groups.length + activation index.
    const source = new Map<number, number>();
    const order: CellPosition[] = [];
    const activations: SpecialActivation[] = [];
    const reach = (cells: readonly CellPosition[], src: number): void => {
      for (const p of cells) {
        const key = keyOf(p);
        if (immune.has(key) || source.has(key) || !board.isPlayable(p.row, p.col)) continue;
        source.set(key, src);
        order.push(p);
      }
    };
    groups.forEach((group, gi) => reach(group.cells, gi));
    for (const act of swapActivations) {
      activations.push(act);
      reach(act.cells, groups.length + activations.length - 1);
    }

    // Chain reactions: specials inside the reached area fire in place, growing the area.
    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      const cell = board.cells[p.row][p.col];
      const t = cell.token;
      if (!t || t.special === "none" || activated.has(t.id)) continue;
      if (cell.blocker && cell.blocker.type !== "glassVine") continue;
      activated.add(t.id);
      const act = effectCells(board, p, t.special, "single");
      activations.push(act);
      reach(act.cells, groups.length + activations.length - 1);
    }

    const points: number[] = new Array<number>(groups.length + activations.length).fill(0);
    const cleared: ClearedToken[] = [];
    const blockerHits: BlockerHit[] = [];
    const terrainHits: TerrainHit[] = [];
    const hitCells = new Set<number>();

    const hitBlocker = (cell: Cell, src: number, breakIt = false): void => {
      const blocker = cell.blocker;
      const key = keyOf(cell);
      if (!blocker || hitCells.has(key)) return;
      hitCells.add(key);
      blocker.hp = breakIt ? 0 : Math.max(0, blocker.hp - 1);
      const destroyed = blocker.hp === 0;
      blockerHits.push({ at: copy(cell), type: blocker.type, remainingHp: blocker.hp, destroyed });
      points[src] += SCORE.blockerDamage + (destroyed ? SCORE.blockerDestroyed : 0);
      if (blocker.type === "shadowMist") this.mistHitThisMove++;
      if (destroyed) cell.blocker = null;
    };
    const hitTerrain = (cell: Cell, src: number): void => {
      const terrain = cell.terrain;
      if (!terrain || terrain.layers <= 0) return;
      terrain.layers--;
      terrainHits.push({ at: copy(cell), remainingLayers: terrain.layers });
      points[src] += SCORE.terrainCleared;
      this.terrainHitThisMove++;
      if (terrain.layers === 0) cell.terrain = null;
    };
    const clearGem = (cell: Cell, src: number): void => {
      const token = cell.token as Token;
      cell.token = null;
      cleared.push({ token, at: copy(cell) });
      if (src >= groups.length) points[src] += SCORE.specialClearedToken;
      hitTerrain(cell, src);
    };

    for (const p of order) {
      const cell = board.cells[p.row][p.col];
      const src = source.get(keyOf(p)) as number;
      const blocker = cell.blocker;
      if (blocker && blocker.type !== "glassVine") {
        hitBlocker(cell, src);
        continue;
      }
      if (blocker) hitBlocker(cell, src, true);
      if (cell.token === null) hitTerrain(cell, src);
      else if (cell.token.kind === "gem") clearGem(cell, src);
    }

    // Buds, mist and roots next to a match take one hit; vines only break with their token.
    groups.forEach((group, gi) => {
      for (const p of group.cells) {
        for (const n of board.neighbors(p)) {
          if (n.blocker && n.blocker.type !== "glassVine") hitBlocker(n, gi);
        }
      }
    });

    created.forEach((creation, i) => {
      const cell = board.cells[creation.at.row][creation.at.col];
      if (cell.blocker?.type === "glassVine") hitBlocker(cell, creationGroup[i], true);
      hitTerrain(cell, creationGroup[i]);
    });

    groups.forEach((group, gi) => {
      points[gi] += SCORE.tokenMatch * 3 + SCORE.extraTokenInMatch * (group.cells.length - 3);
    });
    creationGroup.forEach((gi) => (points[gi] += SCORE.specialCreated));
    activations.forEach((_, i) => (points[groups.length + i] += SCORE.specialActivated));

    const { scoreGained, scoreEvents } = this.scoreStep(points, cascadeIndex, groups, activations);
    let shake = 0;
    for (const act of activations) shake = Math.max(shake, shakeFor(act.combo));

    return {
      cascadeIndex,
      groups,
      cleared,
      created,
      activations,
      blockerHits,
      terrainHits,
      scoreGained,
      scoreEvents,
      shake,
    };
  }

  /** Multiplies the step total once; per-event points are rounded and nudged so they sum to it. */
  private scoreStep(
    points: number[],
    cascadeIndex: number,
    groups: MatchGroup[],
    activations: SpecialActivation[],
  ): { scoreGained: number; scoreEvents: ScoreEvent[] } {
    const multiplier = 1 + cascadeIndex * SCORE.cascadeMultiplierStep;
    let base = 0;
    for (const p of points) base += p;
    const scoreGained = Math.round(base * multiplier);
    const scoreEvents: ScoreEvent[] = [];
    let sum = 0;
    let largest = -1;
    points.forEach((p, i) => {
      const rounded = Math.round(p * multiplier);
      sum += rounded;
      const at = i < groups.length ? copy(groupMiddle(groups[i])) : copy(activations[i - groups.length].at);
      scoreEvents.push({ at, points: rounded });
      if (largest < 0 || rounded > scoreEvents[largest].points) largest = i;
    });
    if (largest >= 0) scoreEvents[largest].points += scoreGained - sum;
    return { scoreGained, scoreEvents };
  }

  /** Gravity for this level's seed rules. */
  fall(cascadeIndex: number, seedsDelivered: number): FallStep {
    return applyGravity(this.board, {
      rng: this.rng,
      tokenTypes: this.board.config.tokenTypes,
      seeds: this.level.seeds,
      seedsWanted: this.seedsWanted(),
      seedsDelivered,
      cascadeIndex,
    });
  }

  /** Moss and mist grow when the move left them alone. Resets the per-move counters. */
  endOfMove(): SpreadEvent[] {
    const events: SpreadEvent[] = [];
    if (this.level.mossSpreads && this.terrainHitThisMove === 0) {
      const target = this.mossSpreadTarget();
      if (target) {
        target.terrain = createTerrain(1);
        events.push({ at: copy(target), kind: "moss" });
      }
    }
    if (this.mistHitThisMove === 0) {
      const target = this.mistSpreadTarget();
      if (target) {
        target.blocker = createBlocker("shadowMist", 1);
        events.push({ at: copy(target), kind: "shadowMist" });
      }
    }
    this.terrainHitThisMove = 0;
    this.mistHitThisMove = 0;
    this.lastSwap = null;
    this.swapConsumed = [];
    return events;
  }

  private mossSpreadTarget(): Cell | null {
    const board = this.board;
    const candidates: Cell[] = [];
    const seen = new Set<Cell>();
    board.forEachCell((cell) => {
      if (!cell.terrain) return;
      for (const n of board.neighbors(cell)) {
        if (n.terrain || n.blocker?.type === "stoneRoot" || seen.has(n)) continue;
        seen.add(n);
        candidates.push(n);
      }
    });
    return candidates.length > 0 ? this.rng.pick(candidates) : null;
  }

  private mistSpreadTarget(): Cell | null {
    const board = this.board;
    const candidates: Cell[] = [];
    const seen = new Set<Cell>();
    let swappableGems = 0;
    board.forEachCell((cell) => {
      if (isSwappable(cell) && cell.token.kind === "gem") swappableGems++;
      if (cell.blocker?.type !== "shadowMist") return;
      for (const n of board.neighbors(cell)) {
        if (!n.token || n.token.kind !== "gem" || n.token.special !== "none" || n.blocker || seen.has(n)) continue;
        seen.add(n);
        candidates.push(n);
      }
    });
    if (candidates.length === 0 || swappableGems - 1 < MIN_GEMS_FOR_MIST_SPREAD) return null;
    return this.rng.pick(candidates);
  }
}
