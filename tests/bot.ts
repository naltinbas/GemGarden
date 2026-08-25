import type { BlockerType, CellPosition, LevelDefinition, TokenColor } from "../src/game/Types";
import { SCORE } from "../src/game/Config";
import { Random } from "../src/utils/Random";
import { Board } from "../src/board/Board";
import { findValidMoves, hasValidMove, type Move } from "../src/board/MoveValidator";
import { reshuffle } from "../src/board/ReshuffleSystem";
import { RoundResolver } from "../src/board/RoundResolver";
import { ObjectiveTracker } from "../src/objectives/ObjectiveTracker";
import { ScoreSystem } from "../src/systems/ScoreSystem";

export interface RunResult {
  levelId: number;
  seed: number;
  won: boolean;
  score: number;
  stars: number;
  movesUsed: number;
  reshuffles: number;
  /** True when a reshuffle found no playable arrangement and the level ended early. */
  stalled: boolean;
  objectives: string[];
}

interface Wants {
  colors: Set<TokenColor>;
  terrain: boolean;
  blockers: Set<BlockerType>;
  seeds: boolean;
}

function wants(tracker: ObjectiveTracker): Wants {
  const w: Wants = { colors: new Set(), terrain: false, blockers: new Set(), seeds: false };
  for (const o of tracker.objectives) {
    if (o.complete) continue;
    const def = o.def;
    if (def.type === "collect") w.colors.add(def.token);
    else if (def.type === "clearTerrain") w.terrain = true;
    else if (def.type === "clearBlockers") w.blockers.add(def.blocker);
    else if (def.type === "deliverSeeds") w.seeds = true;
  }
  return w;
}

function seedRows(board: Board): Map<number, number> {
  const rows = new Map<number, number>();
  board.forEachCell((cell) => {
    if (cell.token?.kind === "seed") rows.set(cell.token.id, cell.row);
  });
  return rows;
}

/**
 * Plays one move on a clone and scores the outcome: points gained plus a bonus
 * for progress on unfinished objectives, so the bot chases goals, not just score.
 */
export function evaluateMove(board: Board, level: LevelDefinition, move: Move, delivered: number, w: Wants): number {
  const clone = board.clone(new Random(board.rng.seed ^ 0x5bd1e995));
  const resolver = new RoundResolver(clone, clone.rng, level);
  const before = seedRows(clone);
  const swap = resolver.trySwap(move.a, move.b);
  if (!swap.valid) return -Infinity;

  let value = 0;
  let cascade = 0;
  let deliveredNow = 0;
  let step = resolver.resolveClear(0, swap.activations);
  if (!step) {
    // A seed swapped straight down makes no match; gravity still has to deliver it if it landed on an exit.
    const fall = resolver.fall(0, delivered);
    deliveredNow += fall.delivered.length;
    value += fall.scoreGained;
  }
  while (step) {
    value += step.scoreGained;
    for (const c of step.cleared) if (c.token.color && w.colors.has(c.token.color)) value += 120;
    if (w.terrain) value += step.terrainHits.length * 150;
    for (const hit of step.blockerHits) {
      if (w.blockers.has(hit.type)) value += hit.destroyed ? 500 : 250;
    }
    const fall = resolver.fall(cascade, delivered + deliveredNow);
    deliveredNow += fall.delivered.length;
    value += fall.scoreGained;
    cascade++;
    step = resolver.resolveClear(cascade);
  }
  if (w.seeds) {
    value += deliveredNow * 1500;
    const after = seedRows(clone);
    for (const [id, row] of before) {
      const now = after.get(id);
      if (now !== undefined) value += (now - row) * 250;
    }
    for (const id of after.keys()) if (!before.has(id)) value += 800;
  }
  return value;
}

export function pickMove(board: Board, level: LevelDefinition, moves: Move[], delivered: number, tracker: ObjectiveTracker): Move {
  const w = wants(tracker);
  let best = moves[0];
  let bestValue = -Infinity;
  for (const move of moves) {
    const value = evaluateMove(board, level, move, delivered, w);
    if (value > bestValue) {
      bestValue = value;
      best = move;
    }
  }
  return best;
}

export interface PlayOptions {
  /** Called after every completed move while the level is still running. */
  onTurn?: (board: Board, move: Move, movesLeft: number) => void;
}

/** Runs the greedy bot through a level's full move budget without rendering. Same loop the game uses. */
export function playLevel(level: LevelDefinition, seed: number, options: PlayOptions = {}): RunResult {
  const def: LevelDefinition = { ...level, seed };
  const board = Board.fromLevel(def);
  const resolver = new RoundResolver(board, board.rng, def);
  const tracker = ObjectiveTracker.fromLevel(def, board);
  const score = new ScoreSystem();
  let movesLeft = def.moveLimit;
  let delivered = 0;
  let reshuffles = 0;
  let stalled = false;

  while (movesLeft > 0 && !tracker.allComplete()) {
    const moves = findValidMoves(board);
    if (moves.length === 0) throw new Error(`level ${def.id} seed ${seed}: no valid move at the start of a turn`);
    const move = pickMove(board, def, moves, delivered, tracker);
    const swap = resolver.trySwap(move.a, move.b);
    if (!swap.valid) throw new Error(`level ${def.id} seed ${seed}: bot picked an invalid move`);
    movesLeft--;

    let cascade = 0;
    let step = resolver.resolveClear(0, swap.activations);
    if (!step) {
      const fall = resolver.fall(0, delivered);
      delivered += fall.delivered.length;
      tracker.onFall(fall);
      tracker.onScore(score.add(fall.scoreGained));
    }
    while (step) {
      tracker.onClear(step);
      tracker.onScore(score.add(step.scoreGained));
      const fall = resolver.fall(cascade, delivered);
      delivered += fall.delivered.length;
      tracker.onFall(fall);
      tracker.onScore(score.add(fall.scoreGained));
      cascade++;
      step = resolver.resolveClear(cascade);
    }
    resolver.endOfMove();
    for (const _o of tracker.newlyCompleted()) tracker.onScore(score.add(SCORE.objectiveCompleted));

    if (tracker.allComplete()) break;
    if (movesLeft > 0 && !hasValidMove(board)) {
      reshuffles++;
      if (!reshuffle(board, board.rng).success) {
        stalled = true;
        break;
      }
    }
    if (movesLeft > 0) options.onTurn?.(board, move, movesLeft);
  }

  const won = tracker.allComplete();
  if (won) score.add(movesLeft * SCORE.levelCompletionMoveBonus);
  return {
    levelId: def.id,
    seed,
    won,
    score: score.total,
    stars: won ? score.starsForWin(def, score.total) : 0,
    movesUsed: def.moveLimit - movesLeft,
    reshuffles,
    stalled,
    objectives: tracker.statuses().map((s) => `${s.label} ${s.progress}/${s.target}`),
  };
}

export function positionKey(p: CellPosition): string {
  return `${p.row},${p.col}`;
}
