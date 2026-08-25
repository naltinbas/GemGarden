import type { Cell, CellPosition, Token, TokenMove } from "../game/Types";
import { RULES } from "../game/Config";
import type { Random } from "../utils/Random";
import type { Board } from "./Board";
import { isSwappable } from "./BoardCell";
import { fillRandomNoMatch } from "./BoardGenerator";
import { findMatches } from "./MatchFinder";
import { hasValidMove } from "./MoveValidator";

export interface ReshuffleResult {
  moved: TokenMove[];
  /** False when no arrangement with a move and no match was found; the board is still consistent. */
  success: boolean;
}

function playable(board: Board): boolean {
  return findMatches(board).length === 0 && hasValidMove(board);
}

/** Gems that may move: swappable cells, so seeds and anything under a blocker stay put. */
function shuffleCells(board: Board): Cell[] {
  return board.cellsWithToken((token, cell) => token.kind === "gem" && isSwappable(cell));
}

/**
 * Permutes the swappable gems in place until the board has no match and at
 * least one move. Falls back to fresh colors for the plain gems, then gives up.
 */
export function reshuffle(board: Board, rng: Random = board.rng): ReshuffleResult {
  const startAt = new Map<number, CellPosition>();
  board.forEachCell((cell) => {
    if (cell.token) startAt.set(cell.token.id, { row: cell.row, col: cell.col });
  });

  const cells = shuffleCells(board);
  const tokens: Token[] = cells.map((cell) => cell.token as Token);
  let success = false;
  for (let attempt = 0; attempt < RULES.maxReshuffleAttempts && !success; attempt++) {
    rng.shuffle(tokens);
    for (let i = 0; i < cells.length; i++) cells[i].token = tokens[i];
    success = playable(board);
  }

  if (!success) {
    const plain = cells.filter((cell) => cell.token !== null && cell.token.special === "none");
    for (let attempt = 0; attempt < RULES.maxReshuffleAttempts && !success; attempt++) {
      for (const cell of plain) cell.token = null;
      if (!fillRandomNoMatch(board, rng)) continue;
      success = playable(board);
    }
    // A failed fill leaves gaps; close them so the board stays consistent.
    for (const cell of plain) {
      if (cell.token === null) cell.token = board.tokens.createGem(rng.pick(board.config.tokenTypes));
    }
  }

  const moved: TokenMove[] = [];
  board.forEachCell((cell) => {
    const token = cell.token;
    if (!token) return;
    const to = { row: cell.row, col: cell.col };
    const from = startAt.get(token.id);
    if (!from) moved.push({ token, from: to, to, spawned: true });
    else if (from.row !== to.row || from.col !== to.col) moved.push({ token, from, to, spawned: false });
  });
  return { moved, success };
}

export const ReshuffleSystem = { reshuffle };
