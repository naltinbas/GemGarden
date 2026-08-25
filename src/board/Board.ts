import type { BoardConfig, Cell, CellPosition, LevelDefinition, Token, TokenKind } from "../game/Types";
import { Random } from "../utils/Random";
import { TokenFactory } from "../entities/Token";
import { cloneCell, createCell } from "./BoardCell";
import { generate } from "./BoardGenerator";

export class Board {
  readonly rows: number;
  readonly cols: number;
  config: BoardConfig;
  cells: Cell[][];
  rng: Random;
  tokens: TokenFactory;

  constructor(config: BoardConfig, rng: Random = new Random(), tokens: TokenFactory = new TokenFactory()) {
    this.rows = config.rows;
    this.cols = config.cols;
    this.config = config;
    this.rng = rng;
    this.tokens = tokens;
    this.cells = [];
    for (let r = 0; r < this.rows; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < this.cols; c++) row.push(createCell(r, c));
      this.cells.push(row);
    }
  }

  static fromLevel(level: LevelDefinition, rng?: Random): Board {
    return generate(level, rng);
  }

  inBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  get(row: number, col: number): Cell | null {
    return this.inBounds(row, col) ? this.cells[row][col] : null;
  }

  isPlayable(row: number, col: number): boolean {
    return this.inBounds(row, col) && this.cells[row][col].playable;
  }

  tokenAt(row: number, col: number): Token | null {
    return this.inBounds(row, col) ? this.cells[row][col].token : null;
  }

  swapTokens(a: CellPosition, b: CellPosition): void {
    const cellA = this.cells[a.row][a.col];
    const cellB = this.cells[b.row][b.col];
    const t = cellA.token;
    cellA.token = cellB.token;
    cellB.token = t;
  }

  forEachCell(fn: (cell: Cell) => void): void {
    for (let r = 0; r < this.rows; r++) {
      const row = this.cells[r];
      for (let c = 0; c < this.cols; c++) fn(row[c]);
    }
  }

  /** Orthogonal neighbours that are inside the board and playable. */
  neighbors(pos: CellPosition): Cell[] {
    const out: Cell[] = [];
    const up = this.get(pos.row - 1, pos.col);
    const down = this.get(pos.row + 1, pos.col);
    const left = this.get(pos.row, pos.col - 1);
    const right = this.get(pos.row, pos.col + 1);
    if (up?.playable) out.push(up);
    if (down?.playable) out.push(down);
    if (left?.playable) out.push(left);
    if (right?.playable) out.push(right);
    return out;
  }

  cellsWithToken(predicate?: (token: Token, cell: Cell) => boolean): Cell[] {
    const out: Cell[] = [];
    this.forEachCell((cell) => {
      if (cell.token && (!predicate || predicate(cell.token, cell))) out.push(cell);
    });
    return out;
  }

  countTokens(kind: TokenKind): number {
    let n = 0;
    this.forEachCell((cell) => {
      if (cell.token && cell.token.kind === kind) n++;
    });
    return n;
  }

  /**
   * Deep copy of cells, config and token factory. The clone gets its own Random
   * (same seed by default) rather than sharing the original's stream.
   */
  clone(rng: Random = new Random(this.rng.seed)): Board {
    const config: BoardConfig = {
      rows: this.config.rows,
      cols: this.config.cols,
      tokenTypes: [...this.config.tokenTypes],
      allowedSpecials: [...this.config.allowedSpecials],
    };
    const copy = new Board(config, rng, new TokenFactory(this.tokens.nextId));
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) copy.cells[r][c] = cloneCell(this.cells[r][c]);
    }
    return copy;
  }

  /** Two characters per cell: color initial / S seed / @ prism / . empty / # hole, then * for a special. */
  toString(): string {
    const lines: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let line = "";
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        const token = cell.token;
        if (!cell.playable) line += "# ";
        else if (!token) line += ". ";
        else if (token.kind === "seed") line += "S ";
        else if (token.color === null) line += "@*";
        else line += token.color[0] + (token.special === "none" ? " " : "*");
      }
      lines.push(line);
    }
    return lines.join("\n");
  }
}
