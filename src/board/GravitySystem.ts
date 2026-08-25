import type { CellPosition, FallStep, ScoreEvent, SeedConfig, SeedDelivery, TokenColor, TokenMove } from "../game/Types";
import { SCORE } from "../game/Config";
import type { Random } from "../utils/Random";
import type { Board } from "./Board";

export interface GravityContext {
  rng: Random;
  tokenTypes: TokenColor[];
  seeds?: SeedConfig;
  /** Total seeds the level wants delivered. */
  seedsWanted: number;
  /** Seeds delivered before this step. */
  seedsDelivered: number;
  cascadeIndex: number;
}

/** Maximal run of playable, blocker-free cells in one column. Tokens only move inside it. */
export interface Segment {
  col: number;
  top: number;
  bottom: number;
}

export function columnSegments(board: Board): Segment[] {
  const out: Segment[] = [];
  for (let c = 0; c < board.cols; c++) {
    let top = -1;
    for (let r = 0; r <= board.rows; r++) {
      const cell = r < board.rows ? board.cells[r][c] : null;
      const open = cell !== null && cell.playable && cell.blocker === null;
      if (open && top < 0) top = r;
      if (!open && top >= 0) {
        out.push({ col: c, top, bottom: r - 1 });
        top = -1;
      }
    }
  }
  return out;
}

function topSegment(segments: Segment[], col: number): Segment | undefined {
  let best: Segment | undefined;
  for (const s of segments) if (s.col === col && (!best || s.top < best.top)) best = s;
  return best;
}

function compact(board: Board, seg: Segment): void {
  let write = seg.bottom;
  for (let r = seg.bottom; r >= seg.top; r--) {
    const cell = board.cells[r][seg.col];
    if (cell.token === null) continue;
    if (r !== write) {
      board.cells[write][seg.col].token = cell.token;
      cell.token = null;
    }
    write--;
  }
}

function seedSpawnColumn(board: Board, ctx: GravityContext, segments: Segment[], deliveredNow: number): number {
  const seeds = ctx.seeds;
  if (!seeds) return -1;
  const onBoard = board.countTokens("seed");
  if (ctx.seedsWanted <= onBoard + ctx.seedsDelivered + deliveredNow) return -1;
  if (onBoard >= seeds.maxOnBoard) return -1;
  const eligible = seeds.spawnCols.filter((col) => {
    const seg = topSegment(segments, col);
    return seg !== undefined && board.cells[seg.top][col].token === null;
  });
  return eligible.length > 0 ? ctx.rng.pick(eligible) : -1;
}

/**
 * Drops tokens within their column segments, refills each segment from its own
 * top, delivers seeds resting on exits and repeats until nothing moves.
 * Spawned tokens get from.row = segmentTop - k so the renderer can stagger them.
 */
export function applyGravity(board: Board, ctx: GravityContext): FallStep {
  const segments = columnSegments(board);
  const startAt = new Map<number, CellPosition>();
  const spawnedFrom = new Map<number, CellPosition>();
  const spawnCount = new Map<Segment, number>();
  board.forEachCell((cell) => {
    if (cell.token) startAt.set(cell.token.id, { row: cell.row, col: cell.col });
  });

  const moves: TokenMove[] = [];
  const delivered: SeedDelivery[] = [];
  const scoreEvents: ScoreEvent[] = [];
  let scoreGained = 0;
  const multiplier = 1 + ctx.cascadeIndex * SCORE.cascadeMultiplierStep;
  let seedPlaced = false;

  for (;;) {
    for (const seg of segments) compact(board, seg);

    const seedCol = seedPlaced ? -1 : seedSpawnColumn(board, ctx, segments, delivered.length);
    const seedSeg = seedCol >= 0 ? topSegment(segments, seedCol) : undefined;
    for (const seg of segments) {
      let k = spawnCount.get(seg) ?? 0;
      let seedHere = seg === seedSeg;
      for (let r = seg.bottom; r >= seg.top; r--) {
        const cell = board.cells[r][seg.col];
        if (cell.token !== null) continue;
        k++;
        const token = seedHere ? board.tokens.createSeed() : board.tokens.createGem(ctx.rng.pick(ctx.tokenTypes));
        if (seedHere) {
          seedHere = false;
          seedPlaced = true;
        }
        cell.token = token;
        spawnedFrom.set(token.id, { row: seg.top - k, col: seg.col });
      }
      spawnCount.set(seg, k);
    }

    let deliveredNow = false;
    for (const seg of segments) {
      for (let r = seg.bottom; r >= seg.top; r--) {
        const cell = board.cells[r][seg.col];
        const token = cell.token;
        if (!cell.isExit || !token || token.kind !== "seed") continue;
        const at = { row: r, col: seg.col };
        const from = spawnedFrom.get(token.id) ?? startAt.get(token.id) ?? at;
        moves.push({ token, from, to: at, spawned: spawnedFrom.has(token.id) });
        delivered.push({ token, at });
        cell.token = null;
        const points = Math.round(SCORE.seedDelivered * multiplier);
        scoreGained += points;
        scoreEvents.push({ at, points, label: "Seed delivered" });
        deliveredNow = true;
      }
    }
    if (!deliveredNow) break;
  }

  board.forEachCell((cell) => {
    const token = cell.token;
    if (!token) return;
    const to = { row: cell.row, col: cell.col };
    const origin = spawnedFrom.get(token.id);
    if (origin) {
      moves.push({ token, from: origin, to, spawned: true });
      return;
    }
    const from = startAt.get(token.id);
    if (from && (from.row !== to.row || from.col !== to.col)) moves.push({ token, from, to, spawned: false });
  });

  return { moves, delivered, scoreGained, scoreEvents };
}

export const GravitySystem = { apply: applyGravity, segments: columnSegments };
