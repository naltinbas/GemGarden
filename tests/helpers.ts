import type { BoardConfig, CellPosition, MatchGroup, TokenColor } from "../src/game/Types";
import { ALL_TOKEN_COLORS } from "../src/game/Types";
import { Random } from "../src/utils/Random";
import { Board } from "../src/board/Board";
import { createBlocker } from "../src/entities/Blocker";
import { createTerrain } from "../src/entities/Terrain";

const COLOR_BY_LETTER: Record<string, TokenColor> = {
  r: "ruby",
  a: "azure",
  c: "citrine",
  v: "violet",
  j: "jade",
  p: "pearl",
};

/**
 * Builds a board from rows of whitespace-separated cell codes.
 * Base: r a c v j p gem, S seed, @ prism, X stone root, . empty, # hole.
 * Suffixes: * burst, - horizontal beam, | vertical beam, V vine, B bud,
 * M mist, E exit, a digit for moss layers.
 */
export function parseBoard(layout: string[], config: Partial<BoardConfig> = {}, seed = 1): Board {
  const rowsCodes = layout.map((line) => line.trim().split(/\s+/));
  const rows = rowsCodes.length;
  const cols = rowsCodes[0].length;
  const full: BoardConfig = {
    rows,
    cols,
    tokenTypes: config.tokenTypes ?? [...ALL_TOKEN_COLORS],
    allowedSpecials: config.allowedSpecials ?? ["lineHorizontal", "lineVertical", "burst", "prism"],
  };
  const board = new Board(full, new Random(seed));

  for (let r = 0; r < rows; r++) {
    if (rowsCodes[r].length !== cols) throw new Error(`row ${r} has ${rowsCodes[r].length} cells, expected ${cols}`);
    for (let c = 0; c < cols; c++) {
      const code = rowsCodes[r][c];
      const cell = board.cells[r][c];
      const base = code[0];
      if (base === "#") {
        cell.playable = false;
        continue;
      }
      if (base === "X") {
        cell.blocker = createBlocker("stoneRoot");
      } else if (base === "S") {
        cell.token = board.tokens.createSeed();
      } else if (base === "@") {
        cell.token = board.tokens.createPrism();
      } else if (base in COLOR_BY_LETTER) {
        cell.token = board.tokens.createGem(COLOR_BY_LETTER[base]);
      } else if (base !== ".") {
        throw new Error(`unknown cell code "${code}" at (${r}, ${c})`);
      }
      for (const mod of code.slice(1)) {
        if (mod === "*") cell.token!.special = "burst";
        else if (mod === "-") cell.token!.special = "lineHorizontal";
        else if (mod === "|") cell.token!.special = "lineVertical";
        else if (mod === "V") cell.blocker = createBlocker("glassVine");
        else if (mod === "B") cell.blocker = createBlocker("lockedBud");
        else if (mod === "M") cell.blocker = createBlocker("shadowMist");
        else if (mod === "E") cell.isExit = true;
        else if (mod >= "1" && mod <= "9") cell.terrain = createTerrain(Number(mod));
        else throw new Error(`unknown modifier "${mod}" in "${code}" at (${r}, ${c})`);
      }
    }
  }
  return board;
}

export function pos(row: number, col: number): CellPosition {
  return { row, col };
}

export function key(p: CellPosition): string {
  return `${p.row},${p.col}`;
}

/** Sorted "row,col" keys, handy for comparing cell sets regardless of order. */
export function keys(cells: readonly CellPosition[]): string[] {
  return cells.map(key).sort();
}

export function groupWithCell(groups: MatchGroup[], p: CellPosition): MatchGroup | undefined {
  return groups.find((g) => g.cells.some((c) => c.row === p.row && c.col === p.col));
}
