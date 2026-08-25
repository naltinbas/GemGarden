import type { CellPosition, MatchGroup, Orientation, TokenColor } from "../game/Types";
import { RULES } from "../game/Config";
import { isMatchable } from "./BoardCell";
import type { Board } from "./Board";

interface Run {
  horizontal: boolean;
  color: TokenColor;
  row: number;
  col: number;
  length: number;
}

// Scratch buffers reused across calls: run index per cell for each orientation.
let hRun = new Int32Array(0);
let vRun = new Int32Array(0);

function ensureScratch(size: number): void {
  if (hRun.length < size) {
    hRun = new Int32Array(size);
    vRun = new Int32Array(size);
  }
  hRun.fill(-1, 0, size);
  vRun.fill(-1, 0, size);
}

function matchColor(board: Board, row: number, col: number): TokenColor | null {
  const cell = board.get(row, col);
  return isMatchable(cell) ? cell.token.color : null;
}

function find(parent: number[], i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function union(parent: number[], a: number, b: number): void {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[rb] = ra;
}

/**
 * Runs of >= minMatch same-colored matchable gems along rows and columns,
 * merged into groups wherever two runs share a cell. Each group's cells start
 * with its longest run in line order, followed by the remaining cells.
 */
export function findMatches(board: Board): MatchGroup[] {
  const { rows, cols } = board;
  const min = RULES.minMatch;
  ensureScratch(rows * cols);
  const runs: Run[] = [];

  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const color = matchColor(board, r, c);
      if (color === null) {
        c++;
        continue;
      }
      let end = c + 1;
      while (end < cols && matchColor(board, r, end) === color) end++;
      if (end - c >= min) {
        const id = runs.length;
        runs.push({ horizontal: true, color, row: r, col: c, length: end - c });
        for (let k = c; k < end; k++) hRun[r * cols + k] = id;
      }
      c = end;
    }
  }

  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      const color = matchColor(board, r, c);
      if (color === null) {
        r++;
        continue;
      }
      let end = r + 1;
      while (end < rows && matchColor(board, end, c) === color) end++;
      if (end - r >= min) {
        const id = runs.length;
        runs.push({ horizontal: false, color, row: r, col: c, length: end - r });
        for (let k = r; k < end; k++) vRun[k * cols + c] = id;
      }
      r = end;
    }
  }

  if (runs.length === 0) return [];

  const parent: number[] = runs.map((_, i) => i);
  for (let idx = 0; idx < rows * cols; idx++) {
    if (hRun[idx] >= 0 && vRun[idx] >= 0) union(parent, hRun[idx], vRun[idx]);
  }

  const groupOfRoot = new Map<number, number>();
  const groupRuns: Run[][] = [];
  for (let i = 0; i < runs.length; i++) {
    const root = find(parent, i);
    let g = groupOfRoot.get(root);
    if (g === undefined) {
      g = groupRuns.length;
      groupOfRoot.set(root, g);
      groupRuns.push([]);
    }
    groupRuns[g].push(runs[i]);
  }

  // First shared cell in row-major order becomes the group's intersection.
  const intersections: (CellPosition | undefined)[] = new Array(groupRuns.length).fill(undefined);
  for (let idx = 0; idx < rows * cols; idx++) {
    if (hRun[idx] < 0 || vRun[idx] < 0) continue;
    const g = groupOfRoot.get(find(parent, hRun[idx]))!;
    if (!intersections[g]) intersections[g] = { row: Math.floor(idx / cols), col: idx % cols };
  }

  const groups: MatchGroup[] = [];
  const seen = new Set<number>();
  for (let g = 0; g < groupRuns.length; g++) {
    const members = groupRuns[g];
    let longest = members[0];
    let anyH = false;
    let anyV = false;
    for (const run of members) {
      if (run.length > longest.length) longest = run;
      if (run.horizontal) anyH = true;
      else anyV = true;
    }
    seen.clear();
    const cells: CellPosition[] = [];
    const add = (run: Run): void => {
      for (let k = 0; k < run.length; k++) {
        const row = run.horizontal ? run.row : run.row + k;
        const col = run.horizontal ? run.col + k : run.col;
        const key = row * cols + col;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ row, col });
      }
    };
    add(longest);
    for (const run of members) if (run !== longest) add(run);

    const orientation: Orientation = anyH && anyV ? "mixed" : anyH ? "horizontal" : "vertical";
    const intersection = intersections[g];
    const group: MatchGroup = {
      cells,
      orientation,
      length: longest.length,
      containsIntersection: intersection !== undefined,
      color: longest.color,
    };
    if (intersection) group.intersection = intersection;
    groups.push(group);
  }
  return groups;
}

/** True when the cell sits inside a horizontal or vertical run of >= minMatch. Allocation free. */
export function hasMatchAt(board: Board, pos: CellPosition): boolean {
  const color = matchColor(board, pos.row, pos.col);
  if (color === null) return false;
  const min = RULES.minMatch;

  let n = 1;
  for (let c = pos.col - 1; c >= 0 && matchColor(board, pos.row, c) === color; c--) n++;
  for (let c = pos.col + 1; c < board.cols && matchColor(board, pos.row, c) === color; c++) n++;
  if (n >= min) return true;

  n = 1;
  for (let r = pos.row - 1; r >= 0 && matchColor(board, r, pos.col) === color; r--) n++;
  for (let r = pos.row + 1; r < board.rows && matchColor(board, r, pos.col) === color; r++) n++;
  return n >= min;
}

/** Match groups that include at least one of the given cells. */
export function matchesTouching(board: Board, cells: readonly CellPosition[]): MatchGroup[] {
  const wanted = new Set<number>();
  for (const p of cells) wanted.add(p.row * board.cols + p.col);
  return findMatches(board).filter((group) =>
    group.cells.some((p) => wanted.has(p.row * board.cols + p.col)),
  );
}
