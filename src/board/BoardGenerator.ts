import type { BoardConfig, Cell, LevelDefinition, TokenColor } from "../game/Types";
import { RULES } from "../game/Config";
import { Random } from "../utils/Random";
import { createBlocker } from "../entities/Blocker";
import { createTerrain } from "../entities/Terrain";
import { TokenFactory } from "../entities/Token";
import { Board } from "./Board";
import { isMatchable } from "./BoardCell";
import { findMatches } from "./MatchFinder";
import { hasValidMove } from "./MoveValidator";

function levelCell(board: Board, level: LevelDefinition, row: number, col: number, what: string): Cell {
  const cell = board.get(row, col);
  if (!cell) {
    throw new Error(`Level ${level.id} "${level.name}": ${what} at (${row}, ${col}) is outside the ${board.rows}x${board.cols} grid`);
  }
  if (!cell.playable) {
    throw new Error(`Level ${level.id} "${level.name}": ${what} at (${row}, ${col}) sits on a hole`);
  }
  return cell;
}

/** Holes, terrain, blockers, exits and fixed tokens. Remaining playable cells stay empty. */
export function layoutBoard(level: LevelDefinition, rng: Random): Board {
  const config: BoardConfig = {
    rows: level.board.rows,
    cols: level.board.cols,
    tokenTypes: [...level.board.tokenTypes],
    allowedSpecials: [...level.allowedSpecials],
  };
  const board = new Board(config, rng, new TokenFactory());

  for (const hole of level.holes ?? []) {
    const cell = board.get(hole.row, hole.col);
    if (!cell) {
      throw new Error(`Level ${level.id} "${level.name}": hole at (${hole.row}, ${hole.col}) is outside the grid`);
    }
    cell.playable = false;
  }
  for (const t of level.terrain ?? []) {
    levelCell(board, level, t.row, t.col, "terrain").terrain = createTerrain(t.layers, t.type);
  }
  for (const b of level.blockers ?? []) {
    levelCell(board, level, b.row, b.col, "blocker").blocker = createBlocker(b.type, b.hp);
  }
  for (const e of level.seeds?.exitCells ?? []) {
    levelCell(board, level, e.row, e.col, "exit").isExit = true;
  }
  for (const p of level.initialTokens ?? []) {
    const cell = levelCell(board, level, p.row, p.col, "initial token");
    if (cell.blocker?.type === "stoneRoot") {
      throw new Error(`Level ${level.id} "${level.name}": initial token at (${p.row}, ${p.col}) overlaps a stone root`);
    }
    if (p.kind === "seed") {
      cell.token = board.tokens.createSeed();
    } else if (p.special === "prism") {
      cell.token = board.tokens.createPrism();
    } else {
      cell.token = board.tokens.createGem(p.color ?? rng.pick(config.tokenTypes), p.special ?? "none");
    }
  }
  return board;
}

function sameColor(board: Board, r1: number, c1: number, r2: number, c2: number): TokenColor | null {
  const a = board.get(r1, c1);
  if (!isMatchable(a)) return null;
  const b = board.get(r2, c2);
  if (!isMatchable(b)) return null;
  return a.token.color === b.token.color ? a.token.color : null;
}

const candidates: TokenColor[] = [];

/**
 * Fills every empty playable cell (skipping stone roots) with a random gem whose
 * color does not complete a run of 3. Returns false when some cell had no legal color.
 */
export function fillRandomNoMatch(board: Board, rng: Random = board.rng): boolean {
  const colors = board.config.tokenTypes;
  if (colors.length === 0) throw new Error("Board config has no token colors to fill with");
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const cell = board.cells[r][c];
      if (!cell.playable || cell.token !== null || cell.blocker?.type === "stoneRoot") continue;
      // A gem under a bud or mist cannot match, so any color is fine there.
      const constrained = cell.blocker === null || cell.blocker.type === "glassVine";
      candidates.length = 0;
      for (const color of colors) {
        if (constrained && wouldMatch(board, r, c, color)) continue;
        candidates.push(color);
      }
      if (candidates.length === 0) return false;
      cell.token = board.tokens.createGem(rng.pick(candidates));
    }
  }
  return true;
}

function wouldMatch(board: Board, r: number, c: number, color: TokenColor): boolean {
  return (
    sameColor(board, r, c - 2, r, c - 1) === color ||
    sameColor(board, r, c - 1, r, c + 1) === color ||
    sameColor(board, r, c + 1, r, c + 2) === color ||
    sameColor(board, r - 2, c, r - 1, c) === color ||
    sameColor(board, r - 1, c, r + 1, c) === color ||
    sameColor(board, r + 1, c, r + 2, c) === color
  );
}

/** Builds a level board with no starting match and at least one valid move. Throws when that never happens. */
export function generate(level: LevelDefinition, rng?: Random): Board {
  const random = rng ?? new Random(level.seed ?? Random.randomSeed());
  let reason = "";
  for (let attempt = 0; attempt < RULES.maxGenerationAttempts; attempt++) {
    const board = layoutBoard(level, random);
    if (!fillRandomNoMatch(board, random)) {
      reason = "no color fits without forming a match";
      continue;
    }
    if (findMatches(board).length > 0) {
      reason = "the fixed initial tokens already form a match";
      continue;
    }
    if (!hasValidMove(board)) {
      reason = "no valid move exists";
      continue;
    }
    return board;
  }
  throw new Error(
    `Board generation failed for level ${level.id} "${level.name}" after ${RULES.maxGenerationAttempts} attempts: ${reason}`,
  );
}
