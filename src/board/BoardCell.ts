import type { Cell, Token, TokenColor } from "../game/Types";
import { cloneBlocker } from "../entities/Blocker";
import { cloneTerrain } from "../entities/Terrain";
import { cloneToken } from "../entities/Token";

export function createCell(row: number, col: number): Cell {
  return { row, col, playable: true, token: null, blocker: null, terrain: null, isExit: false };
}

/** Any blocker pins the token in place (a stone root has no token at all). */
export function hasImmobilizingBlocker(cell: Cell): boolean {
  return cell.blocker !== null;
}

export type SwappableCell = Cell & { token: Token };
export type MatchableCell = Cell & { token: Token & { kind: "gem"; color: TokenColor } };

export function isSwappable(cell: Cell | null): cell is SwappableCell {
  return cell !== null && cell.playable && cell.token !== null && cell.blocker === null;
}

/** Gem with a color, not sealed by a bud or hidden by mist. Vines do not stop matching. */
export function isMatchable(cell: Cell | null): cell is MatchableCell {
  if (cell === null || !cell.playable || cell.token === null) return false;
  if (cell.token.kind !== "gem" || cell.token.color === null) return false;
  const blocker = cell.blocker;
  return blocker === null || blocker.type === "glassVine";
}

export function cloneCell(cell: Cell): Cell {
  return {
    row: cell.row,
    col: cell.col,
    playable: cell.playable,
    token: cell.token ? cloneToken(cell.token) : null,
    blocker: cell.blocker ? cloneBlocker(cell.blocker) : null,
    terrain: cell.terrain ? cloneTerrain(cell.terrain) : null,
    isExit: cell.isExit,
  };
}
