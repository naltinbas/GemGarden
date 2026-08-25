import type { CellPosition, Token } from "../game/Types";
import type { Board } from "../board/Board";
import type { AnimationSystem } from "../systems/AnimationSystem";
import type { ParticleSystem } from "../systems/ParticleSystem";
import type { EffectsRenderer } from "./EffectsRenderer";

/** Board placement inside the canvas, in CSS pixels. */
export interface Layout {
  originX: number;
  originY: number;
  cellSize: number;
  rows: number;
  cols: number;
}

export interface HintVisual {
  a: CellPosition;
  b: CellPosition;
  /** Pulse phase 0..1. */
  t: number;
}

/** A token that has left the board but is still animating out (pops, seed deliveries). */
export interface GhostToken {
  token: Token;
  at: CellPosition;
}

export interface RenderSettings {
  highContrast: boolean;
  reducedMotion: boolean;
  showGridCoords: boolean;
}

/** Everything the renderer needs for one frame. It reads, never writes. */
export interface RenderFrame {
  board: Board;
  visuals: AnimationSystem;
  particles: ParticleSystem;
  effects: EffectsRenderer;
  selected?: CellPosition | null;
  cursor?: CellPosition | null;
  cursorVisible: boolean;
  hover?: CellPosition | null;
  hint?: HintVisual | null;
  /** Drawn on top of the board tokens with their own visuals. */
  ghosts?: readonly GhostToken[];
  /** 0..1, screen shake strength. */
  shake: number;
  /** Milliseconds since the game started. */
  time: number;
  settings: RenderSettings;
  /** True while a menu covers the board. */
  dimmed: boolean;
}

export function cellCentre(layout: Layout, row: number, col: number): { x: number; y: number } {
  return {
    x: layout.originX + (col + 0.5) * layout.cellSize,
    y: layout.originY + (row + 0.5) * layout.cellSize,
  };
}
