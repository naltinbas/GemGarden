import type {
  CellPosition,
  ComboKind,
  MatchGroup,
  SpecialActivation,
  SpecialCreation,
  SpecialType,
  TokenColor,
} from "../game/Types";
import { RULES } from "../game/Config";
import type { Board } from "./Board";

/** Where a group should turn into a special, before the token is touched. */
export interface SpecialChoice {
  at: CellPosition;
  type: SpecialType;
  color: TokenColor | null;
}

export interface EffectOptions {
  /** Color removed by prismColor; also carried on the activation for the renderer. */
  color?: TokenColor;
}

function same(a: CellPosition, b: CellPosition): boolean {
  return a.row === b.row && a.col === b.col;
}

function inGroup(group: MatchGroup, p: CellPosition): boolean {
  return group.cells.some((c) => same(c, p));
}

/** Orientation of the group's longest run, which MatchFinder lists first in cells. */
function longestRunOrientation(group: MatchGroup): "horizontal" | "vertical" {
  if (group.orientation !== "mixed") return group.orientation;
  const [first, second] = group.cells;
  return first.row === second.row ? "horizontal" : "vertical";
}

/** Intersection if present, else the middle cell of the longest run. */
export function groupMiddle(group: MatchGroup): CellPosition {
  return group.intersection ?? group.cells[Math.floor(group.length / 2)];
}

function placement(
  group: MatchGroup,
  preferred: readonly CellPosition[],
  canPlace?: (p: CellPosition) => boolean,
): CellPosition | null {
  const candidates: CellPosition[] = [];
  for (const p of preferred) if (inGroup(group, p)) candidates.push(p);
  if (group.intersection) candidates.push(group.intersection);
  candidates.push(group.cells[Math.floor(group.length / 2)]);
  for (const p of group.cells) candidates.push(p);
  for (const p of candidates) {
    if (!canPlace || canPlace(p)) return { row: p.row, col: p.col };
  }
  return null;
}

/**
 * Prism for a straight run of 5+, burst for T/L shapes, beam for a run of 4+;
 * each only if allowed, first hit wins. Placement prefers the swapped cells
 * (in the order given), then the intersection, then the middle of the longest
 * run. `canPlace` lets the caller veto cells whose token is already special.
 */
export function chooseSpecial(
  group: MatchGroup,
  allowed: readonly SpecialType[],
  preferred: readonly CellPosition[],
  canPlace?: (p: CellPosition) => boolean,
): SpecialChoice | null {
  let type: SpecialType = "none";
  if (group.length >= RULES.prismMatch && allowed.includes("prism")) {
    type = "prism";
  } else if (group.containsIntersection && allowed.includes("burst")) {
    type = "burst";
  } else if (group.length >= RULES.beamMatch) {
    const beam: SpecialType = longestRunOrientation(group) === "horizontal" ? "lineHorizontal" : "lineVertical";
    if (allowed.includes(beam)) type = beam;
  }
  if (type === "none") return null;
  const at = placement(group, preferred, canPlace);
  if (!at) return null;
  return { at, type, color: type === "prism" ? null : group.color };
}

/** Turns the token at the chosen cell into the special in place (same id). */
export function createSpecial(board: Board, choice: SpecialChoice): SpecialCreation {
  const token = board.tokenAt(choice.at.row, choice.at.col);
  if (!token) throw new Error(`No token to turn into a special at (${choice.at.row}, ${choice.at.col})`);
  token.special = choice.type;
  if (choice.type === "prism") token.color = null;
  return { at: { row: choice.at.row, col: choice.at.col }, type: choice.type, color: choice.color, token };
}

class Reach {
  readonly cells: CellPosition[] = [];
  private readonly seen = new Set<number>();

  constructor(private readonly board: Board) {}

  add(row: number, col: number): void {
    if (!this.board.isPlayable(row, col)) return;
    const key = row * this.board.cols + col;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.cells.push({ row, col });
  }

  row(row: number): boolean {
    if (row < 0 || row >= this.board.rows) return false;
    for (let c = 0; c < this.board.cols; c++) this.add(row, c);
    return true;
  }

  col(col: number): boolean {
    if (col < 0 || col >= this.board.cols) return false;
    for (let r = 0; r < this.board.rows; r++) this.add(r, col);
    return true;
  }

  square(at: CellPosition, radius: number): void {
    for (let r = at.row - radius; r <= at.row + radius; r++) {
      for (let c = at.col - radius; c <= at.col + radius; c++) this.add(r, c);
    }
  }
}

type Line = { orientation: "horizontal" | "vertical"; index: number };

/**
 * Every playable cell an activation reaches. Holes are skipped but lines
 * continue past them; blockers and seeds are handled by the resolver, not here.
 */
export function effectCells(
  board: Board,
  at: CellPosition,
  type: SpecialType,
  combo: ComboKind,
  options: EffectOptions = {},
): SpecialActivation {
  const reach = new Reach(board);
  const lines: Line[] = [];
  const activation: SpecialActivation = { at: { row: at.row, col: at.col }, type, combo, cells: reach.cells };
  if (options.color) activation.color = options.color;

  const addRow = (row: number): void => {
    if (reach.row(row)) lines.push({ orientation: "horizontal", index: row });
  };
  const addCol = (col: number): void => {
    if (reach.col(col)) lines.push({ orientation: "vertical", index: col });
  };

  switch (combo) {
    case "beamBeam":
      addRow(at.row);
      addCol(at.col);
      reach.square(at, RULES.burstRadius);
      activation.radius = RULES.burstRadius;
      break;
    case "beamBurst": {
      const half = Math.floor(RULES.beamBurstSpan / 2);
      for (let d = -half; d <= half; d++) addRow(at.row + d);
      for (let d = -half; d <= half; d++) addCol(at.col + d);
      break;
    }
    case "burstBurst":
      reach.square(at, RULES.bigBurstRadius);
      activation.radius = RULES.bigBurstRadius;
      break;
    case "prismColor": {
      reach.add(at.row, at.col);
      const color = options.color;
      if (color) {
        board.forEachCell((cell) => {
          if (!cell.playable || !cell.token || cell.token.kind !== "gem" || cell.token.color !== color) return;
          if (cell.blocker && cell.blocker.type !== "glassVine") return;
          reach.add(cell.row, cell.col);
        });
      }
      break;
    }
    case "prismPrism":
      board.forEachCell((cell) => reach.add(cell.row, cell.col));
      break;
    default:
      switch (type) {
        case "lineHorizontal":
          addRow(at.row);
          break;
        case "lineVertical":
          addCol(at.col);
          break;
        case "burst":
          reach.square(at, RULES.burstRadius);
          activation.radius = RULES.burstRadius;
          break;
        default:
          reach.add(at.row, at.col);
      }
  }
  if (lines.length > 0) activation.lines = lines;
  return activation;
}
