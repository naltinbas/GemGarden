// Pointer and keyboard input for the board canvas. Emits intents; the Game decides what they mean.
import type { CellPosition } from "./Types";
import { EventEmitter } from "../utils/EventEmitter";

export type InputEvents = {
  /** Tap, click, or Space/Enter on the cursor cell. */
  select: CellPosition;
  /** Drag from a toward its neighbour b. */
  swap: { a: CellPosition; b: CellPosition };
  cursorMove: CellPosition;
  /** Pointer hovering a cell, or null when it leaves the grid. */
  hover: CellPosition | null;
  pause: null;
  restart: null;
  hint: null;
  /** Any pointer press or key press while input is on; used to skip splashes. */
  activity: null;
};

/** off: nothing; paused: only the pause keys; play: everything. */
export type InputMode = "off" | "paused" | "play";

export interface CoordinateMapper {
  xyToCell(x: number, y: number): CellPosition | null;
  cellSize(): number;
}

const DRAG_THRESHOLD_CELLS = 0.35;
const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  w: [-1, 0],
  s: [1, 0],
  a: [0, -1],
  d: [0, 1],
};

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export class InputManager extends EventEmitter<InputEvents> {
  readonly canvas: HTMLCanvasElement;
  private readonly mapper: CoordinateMapper;
  private mode: InputMode = "off";
  private rows = 0;
  private cols = 0;
  private isPlayable: (row: number, col: number) => boolean = () => true;
  private cursor: CellPosition = { row: 0, col: 0 };

  private pressed: CellPosition | null = null;
  private pressX = 0;
  private pressY = 0;
  private pointerId = -1;
  private dragged = false;

  private readonly onPointerDown = (e: PointerEvent): void => this.pointerDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.pointerMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.pointerUp(e);
  private readonly onPointerLeave = (): void => this.emit("hover", null);
  private readonly onKeyDown = (e: KeyboardEvent): void => this.keyDown(e);

  constructor(canvas: HTMLCanvasElement, mapper: CoordinateMapper) {
    super();
    this.canvas = canvas;
    this.mapper = mapper;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKeyDown);
  }

  dispose(): void {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("keydown", this.onKeyDown);
    this.clear();
  }

  setMode(mode: InputMode): void {
    this.mode = mode;
    if (mode !== "play") this.pressed = null;
  }

  get currentMode(): InputMode {
    return this.mode;
  }

  /** Grid the cursor moves over. Holes are skipped when stepping. */
  setGrid(rows: number, cols: number, isPlayable: (row: number, col: number) => boolean): void {
    this.rows = rows;
    this.cols = cols;
    this.isPlayable = isPlayable;
    if (!this.inGrid(this.cursor) || !isPlayable(this.cursor.row, this.cursor.col)) {
      this.cursor = this.firstPlayable();
    }
  }

  getCursor(): CellPosition {
    return { row: this.cursor.row, col: this.cursor.col };
  }

  setCursor(pos: CellPosition): void {
    if (this.inGrid(pos)) this.cursor = { row: pos.row, col: pos.col };
  }

  private inGrid(p: CellPosition): boolean {
    return p.row >= 0 && p.col >= 0 && p.row < this.rows && p.col < this.cols;
  }

  private firstPlayable(): CellPosition {
    const centre = { row: Math.floor(this.rows / 2), col: Math.floor(this.cols / 2) };
    if (this.inGrid(centre) && this.isPlayable(centre.row, centre.col)) return centre;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) if (this.isPlayable(r, c)) return { row: r, col: c };
    }
    return { row: 0, col: 0 };
  }

  // ---------------------------------------------------------------------------
  // Pointer

  private canvasPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private pointerDown(e: PointerEvent): void {
    if (this.mode === "off") return;
    this.emit("activity", null);
    if (this.mode !== "play") return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });
    const { x, y } = this.canvasPoint(e);
    const cell = this.mapper.xyToCell(x, y);
    this.pressed = cell;
    this.pressX = x;
    this.pressY = y;
    this.pointerId = e.pointerId;
    this.dragged = false;
    if (cell) {
      this.cursor = { row: cell.row, col: cell.col };
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nicety; dragging still works while the pointer stays over the canvas.
      }
    }
  }

  private pointerMove(e: PointerEvent): void {
    if (this.mode !== "play") return;
    const { x, y } = this.canvasPoint(e);
    if (!this.pressed || e.pointerId !== this.pointerId) {
      if (e.pointerType === "mouse" && !this.pressed) this.emit("hover", this.mapper.xyToCell(x, y));
      return;
    }
    if (this.dragged) return;
    const dx = x - this.pressX;
    const dy = y - this.pressY;
    const threshold = this.mapper.cellSize() * DRAG_THRESHOLD_CELLS;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const a = this.pressed;
    const b = horizontal ? { row: a.row, col: a.col + Math.sign(dx) } : { row: a.row + Math.sign(dy), col: a.col };
    this.dragged = true;
    this.pressed = null;
    if (this.inGrid(b) && this.isPlayable(b.row, b.col)) this.emit("swap", { a, b });
  }

  private pointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const pressed = this.pressed;
    this.pressed = null;
    if (this.mode !== "play" || this.dragged || !pressed) return;
    // A tap that ends on another cell is treated as a click on the pressed cell.
    this.emit("select", pressed);
  }

  // ---------------------------------------------------------------------------
  // Keyboard

  private keyDown(e: KeyboardEvent): void {
    if (this.mode === "off" || e.defaultPrevented || isTextTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === "Escape" || key === "p") {
      e.preventDefault();
      this.emit("activity", null);
      this.emit("pause", null);
      return;
    }
    if (this.mode !== "play") return;

    const canvasFocused = document.activeElement === this.canvas;
    const onButton = e.target instanceof HTMLElement && e.target.tagName === "BUTTON";
    if (key in ARROWS) {
      if (onButton && !canvasFocused) return;
      e.preventDefault();
      this.emit("activity", null);
      this.moveCursor(ARROWS[key][0], ARROWS[key][1]);
      return;
    }
    if (key === " " || key === "Enter") {
      if (onButton && !canvasFocused) return;
      e.preventDefault();
      this.emit("activity", null);
      this.emit("select", this.getCursor());
      return;
    }
    if (key === "r") {
      e.preventDefault();
      this.emit("restart", null);
      return;
    }
    if (key === "h") {
      e.preventDefault();
      this.emit("hint", null);
    }
  }

  /** Steps the cursor, skipping holes, stopping at the edge. */
  private moveCursor(dr: number, dc: number): void {
    let r = this.cursor.row + dr;
    let c = this.cursor.col + dc;
    while (r >= 0 && c >= 0 && r < this.rows && c < this.cols) {
      if (this.isPlayable(r, c)) {
        this.cursor = { row: r, col: c };
        this.emit("cursorMove", this.getCursor());
        return;
      }
      r += dr;
      c += dc;
    }
    // Nothing that way; still report so the cursor becomes visible.
    this.emit("cursorMove", this.getCursor());
  }
}
