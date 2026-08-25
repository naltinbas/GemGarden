// Idle-timer hints. Pure board logic, no DOM.
import type { CellPosition, LevelDefinition } from "../game/Types";
import { TIMING } from "../game/Config";
import { Random } from "../utils/Random";
import type { Board } from "../board/Board";
import { findValidMoves, type Move } from "../board/MoveValidator";
import { RoundResolver } from "../board/RoundResolver";

export interface Hint {
  a: CellPosition;
  b: CellPosition;
}

/** Points the first clear step of a move would score. Deterministic: the clone gets a fixed seed. */
export function simulateMoveScore(board: Board, level: LevelDefinition, move: Move): number {
  const clone = board.clone(new Random(1));
  const resolver = new RoundResolver(clone, clone.rng, level);
  const swap = resolver.trySwap(move.a, move.b);
  if (!swap.valid) return -1;
  const step = resolver.resolveClear(0, swap.activations);
  return step ? step.scoreGained : 0;
}

export class HintSystem {
  enabled = true;
  delayMs: number;
  private idle = 0;
  private clock = 0;
  private stable = false;
  private best: Hint | null = null;
  private moveCount = 0;
  private current: Hint | null = null;

  constructor(delayMs: number = TIMING.hintDelay) {
    this.delayMs = delayMs;
  }

  /** Call whenever the board comes to rest. Picks the move with the best first-step score. */
  onBoardStable(board: Board, level: LevelDefinition): void {
    const moves = findValidMoves(board);
    this.moveCount = moves.length;
    let best: Move | null = null;
    let bestScore = -Infinity;
    for (const move of moves) {
      const score = simulateMoveScore(board, level, move);
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    this.best = best ? { a: { ...best.a }, b: { ...best.b } } : null;
    this.stable = true;
    this.idle = 0;
    this.current = null;
  }

  /** Any input restarts the idle timer and hides the hint. */
  onInput(): void {
    this.idle = 0;
    this.current = null;
  }

  /** Board is changing; nothing to hint until onBoardStable. */
  reset(): void {
    this.stable = false;
    this.best = null;
    this.current = null;
    this.idle = 0;
    this.moveCount = 0;
  }

  /** Shows the hint right away (the H key), whatever the settings say. */
  showNow(): Hint | null {
    if (!this.stable) return null;
    this.current = this.best;
    this.idle = this.delayMs;
    return this.current;
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.stable || !this.best) return;
    if (this.current) return;
    if (!this.enabled) return;
    this.idle += dt;
    if (this.idle >= this.delayMs) this.current = this.best;
  }

  get hint(): Hint | null {
    return this.current;
  }

  get bestMove(): Hint | null {
    return this.best;
  }

  get validMoveCount(): number {
    return this.moveCount;
  }

  /** 0..1 pulse phase, wrapping every TIMING.hintPulse ms. */
  get phase(): number {
    const period = Math.max(1, TIMING.hintPulse);
    return (this.clock % period) / period;
  }
}
