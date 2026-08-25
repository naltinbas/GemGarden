import type { CellPosition, ComboKind, Token } from "../game/Types";
import { isBeam, isBurst, isPrism } from "../entities/Token";
import { isSwappable } from "./BoardCell";
import type { Board } from "./Board";
import { hasMatchAt } from "./MatchFinder";

export interface SwapValidity {
  valid: boolean;
  combo: ComboKind;
}

export interface Move {
  a: CellPosition;
  b: CellPosition;
  combo: ComboKind;
}

type SpecialClass = "plain" | "beam" | "burst" | "prism";

function specialClass(token: Token | null): SpecialClass {
  if (isPrism(token)) return "prism";
  if (isBurst(token)) return "burst";
  if (isBeam(token)) return "beam";
  return "plain";
}

/** Combo kind for swapping two tokens. Order does not matter for the kind itself. */
export function classifyCombo(tokenA: Token | null, tokenB: Token | null): ComboKind {
  const ca = specialClass(tokenA);
  const cb = specialClass(tokenB);
  if (ca === "plain" && cb === "plain") return "none";
  if (ca === "plain" || cb === "plain") {
    const special = ca === "plain" ? cb : ca;
    const plain = ca === "plain" ? tokenA : tokenB;
    if (special === "prism") {
      // Prism next to a seed has no color to pick, so it just consumes itself.
      return plain !== null && plain.kind === "gem" && plain.color !== null ? "prismColor" : "single";
    }
    return "single";
  }
  if (ca === "prism" || cb === "prism") {
    const other = ca === "prism" ? cb : ca;
    if (other === "prism") return "prismPrism";
    return other === "beam" ? "prismBeam" : "prismBurst";
  }
  if (ca === "beam" && cb === "beam") return "beamBeam";
  if (ca === "burst" && cb === "burst") return "burstBurst";
  return "beamBurst";
}

function isAdjacent(a: CellPosition, b: CellPosition): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

/** A seed may drop one row onto a gem. Two stacked seeds swapping is a no-op, not a move. */
function seedMovesDown(token: Token, below: Token, from: CellPosition, to: CellPosition): boolean {
  return token.kind === "seed" && below.kind !== "seed" && to.col === from.col && to.row === from.row + 1;
}

const INVALID: SwapValidity = { valid: false, combo: "none" };

/** Simulates the swap in place and undoes it; the board is unchanged afterwards. */
export function isValidSwap(board: Board, a: CellPosition, b: CellPosition): SwapValidity {
  const cellA = board.get(a.row, a.col);
  const cellB = board.get(b.row, b.col);
  if (!isSwappable(cellA) || !isSwappable(cellB) || !isAdjacent(a, b)) return INVALID;
  const tokenA = cellA.token;
  const tokenB = cellB.token;

  const combo = classifyCombo(tokenA, tokenB);
  if (combo !== "none") return { valid: true, combo };
  if (seedMovesDown(tokenA, tokenB, a, b) || seedMovesDown(tokenB, tokenA, b, a)) return { valid: true, combo };

  board.swapTokens(a, b);
  const matched = hasMatchAt(board, a) || hasMatchAt(board, b);
  board.swapTokens(a, b);
  return matched ? { valid: true, combo } : INVALID;
}

/** Every adjacent pair whose swap would be accepted. Each unordered pair appears once, a before b. */
export function findValidMoves(board: Board): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const a = { row: r, col: c };
      if (c + 1 < board.cols) {
        const b = { row: r, col: c + 1 };
        const v = isValidSwap(board, a, b);
        if (v.valid) moves.push({ a, b, combo: v.combo });
      }
      if (r + 1 < board.rows) {
        const b = { row: r + 1, col: c };
        const v = isValidSwap(board, a, b);
        if (v.valid) moves.push({ a, b, combo: v.combo });
      }
    }
  }
  return moves;
}

export function hasValidMove(board: Board): boolean {
  const a = { row: 0, col: 0 };
  const b = { row: 0, col: 0 };
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      a.row = r;
      a.col = c;
      if (c + 1 < board.cols) {
        b.row = r;
        b.col = c + 1;
        if (isValidSwap(board, a, b).valid) return true;
      }
      if (r + 1 < board.rows) {
        b.row = r + 1;
        b.col = c;
        if (isValidSwap(board, a, b).valid) return true;
      }
    }
  }
  return false;
}
