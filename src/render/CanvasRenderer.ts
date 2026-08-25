// Draws one RenderFrame to a canvas. Reads the board, never changes it.
import type { CellPosition, Token } from "../game/Types";
import { TOKEN_STYLE } from "../game/Config";
import type { Board } from "../board/Board";
import type { TokenVisual } from "../systems/AnimationSystem";
import { AssetFactory } from "./AssetFactory";
import { cellCentre, type Layout, type RenderFrame } from "./RenderFrame";

const MARGIN_FRACTION = 0.04;
const MIN_MARGIN = 8;

interface TokenDraw {
  row: number;
  col: number;
  token: Token;
  visual: TokenVisual | null;
  /** Draw order; moving or scaled tokens go last, ghosts above those. */
  layer: number;
  /** Under shadow mist: no glow. */
  hidden: boolean;
}

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly assets: AssetFactory;
  layout: Layout = { originX: 0, originY: 0, cellSize: 48, rows: 8, cols: 8 };
  private ctx: CanvasRenderingContext2D | null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private board: Board | null = null;
  private drawList: TokenDraw[] = [];

  constructor(canvas: HTMLCanvasElement, assets: AssetFactory = new AssetFactory()) {
    this.canvas = canvas;
    this.assets = assets;
    this.ctx = canvas.getContext("2d");
  }

  get cssWidth(): number {
    return this.width;
  }

  get cssHeight(): number {
    return this.height;
  }

  /** Board the layout is fitted to. Call before resize so the grid size is known. */
  setBoard(board: Board): void {
    this.board = board;
    if (board.rows !== this.layout.rows || board.cols !== this.layout.cols) {
      this.computeLayout(board.rows, board.cols);
    }
  }

  /** width/height in CSS pixels. */
  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.dpr = Math.max(1, dpr || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.assets.clearCache();
    this.computeLayout(this.board?.rows ?? this.layout.rows, this.board?.cols ?? this.layout.cols);
  }

  /** Centre of a cell in CSS pixels. Fractional rows/cols are fine. */
  cellToXY(row: number, col: number): { x: number; y: number } {
    return cellCentre(this.layout, row, col);
  }

  /** CSS pixel point to cell. null outside the grid or on a hole. */
  xyToCell(x: number, y: number): CellPosition | null {
    const { originX, originY, cellSize, rows, cols } = this.layout;
    const col = Math.floor((x - originX) / cellSize);
    const row = Math.floor((y - originY) / cellSize);
    if (row < 0 || col < 0 || row >= rows || col >= cols) return null;
    if (this.board && !this.board.isPlayable(row, col)) return null;
    return { row, col };
  }

  draw(frame: RenderFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (frame.board !== this.board) this.setBoard(frame.board);
    const { board, settings } = frame;
    const layout = this.layout;
    const cs = layout.cellSize;
    const px = Math.round(cs * this.dpr);
    const hc = settings.highContrast;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(ctx, frame);

    ctx.save();
    if (frame.shake > 0 && !settings.reducedMotion) {
      const k = frame.shake * cs * 0.12;
      ctx.translate(Math.sin(frame.time * 0.11) * k, Math.cos(frame.time * 0.13) * k);
    }

    // Cell bases, terrain, exits.
    const base0 = this.assets.cellBaseSprite(px, hc, 0);
    const base1 = this.assets.cellBaseSprite(px, hc, 1);
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const cell = board.cells[r][c];
        if (!cell.playable) continue;
        const x = layout.originX + c * cs;
        const y = layout.originY + r * cs;
        ctx.drawImage((r + c) % 2 === 0 ? base0 : base1, x, y, cs, cs);
        if (cell.terrain && cell.terrain.layers > 0) {
          ctx.drawImage(this.assets.terrainSprite(cell.terrain.layers, px, hc), x, y, cs, cs);
        }
        if (cell.isExit) ctx.drawImage(this.assets.exitSprite(px, hc), x, y, cs, cs);
      }
    }

    this.drawTokens(ctx, frame, px);
    this.drawBlockers(ctx, frame, px);

    if (frame.hint) this.drawHint(ctx, frame);
    if (frame.hover && !samePos(frame.hover, frame.selected)) this.drawRing(ctx, frame.hover, "rgba(255,255,255,0.35)", cs * 0.04, 0);
    if (frame.selected) {
      const pulse = settings.reducedMotion ? 0 : Math.sin(frame.time * 0.008) * 0.5 + 0.5;
      this.drawRing(ctx, frame.selected, hc ? "#ffffff" : "#fff3b0", cs * (0.06 + pulse * 0.02), pulse * cs * 0.03);
    }
    if (frame.cursorVisible && frame.cursor) {
      const { x, y } = this.cellToXY(frame.cursor.row, frame.cursor.col);
      ctx.drawImage(this.assets.cursorSprite(px, hc), x - cs / 2, y - cs / 2, cs, cs);
    }

    this.drawParticles(ctx, frame);
    frame.effects.draw(ctx, layout);
    if (settings.showGridCoords) this.drawGridCoords(ctx, frame);
    ctx.restore();

    if (frame.dimmed) {
      ctx.fillStyle = "rgba(6, 12, 12, 0.55)";
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  private computeLayout(rows: number, cols: number): void {
    const margin = Math.max(MIN_MARGIN, Math.min(this.width, this.height) * MARGIN_FRACTION);
    const availW = Math.max(1, this.width - margin * 2);
    const availH = Math.max(1, this.height - margin * 2);
    const cellSize = Math.max(8, Math.floor(Math.min(availW / cols, availH / rows)));
    this.layout = {
      originX: Math.floor((this.width - cellSize * cols) / 2),
      originY: Math.floor((this.height - cellSize * rows) / 2),
      cellSize,
      rows,
      cols,
    };
  }

  private drawBackground(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const w = this.width;
    const h = this.height;
    if (frame.settings.highContrast) {
      ctx.fillStyle = "#07100f";
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.1, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    g.addColorStop(0, "#1d4a45");
    g.addColorStop(0.55, "#0f2c2a");
    g.addColorStop(1, "#071312");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Slow drifting light, skipped under reduced motion.
    const t = frame.settings.reducedMotion ? 0 : frame.time * 0.0002;
    const lx = w * (0.5 + Math.sin(t) * 0.25);
    const ly = h * (0.35 + Math.cos(t * 0.7) * 0.15);
    const light = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.min(w, h) * 0.6);
    light.addColorStop(0, "rgba(140, 230, 200, 0.12)");
    light.addColorStop(1, "rgba(140, 230, 200, 0)");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, w, h);
  }

  private drawTokens(ctx: CanvasRenderingContext2D, frame: RenderFrame, px: number): void {
    const { board, visuals, settings, time } = frame;
    const layout = this.layout;
    const cs = layout.cellSize;
    const hc = settings.highContrast;
    const list = this.drawList;
    list.length = 0;
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const cell = board.cells[r][c];
        const token = cell.token;
        if (!cell.playable || !token) continue;
        const visual = visuals.has(token.id) ? visuals.get(token.id) : null;
        let layer = 0;
        if (visual) {
          if (visual.x !== 0 || visual.y !== 0) layer = 2;
          else if (visual.scale !== 1 || visual.rot !== 0) layer = 1;
        }
        list.push({ row: r, col: c, token, visual, layer, hidden: cell.blocker?.type === "shadowMist" });
      }
    }
    if (frame.ghosts) {
      for (const g of frame.ghosts) {
        const visual = visuals.has(g.token.id) ? visuals.get(g.token.id) : null;
        list.push({ row: g.at.row, col: g.at.col, token: g.token, visual, layer: 3, hidden: false });
      }
    }
    list.sort((a, b) => a.layer - b.layer || a.token.id - b.token.id);

    for (const item of list) {
      const { token, visual, hidden } = item;
      const centre = cellCentre(layout, item.row, item.col);
      const x = centre.x + (visual ? visual.x * cs : 0);
      const y = centre.y + (visual ? visual.y * cs : 0);
      const scale = visual ? visual.scale : 1;
      const alpha = visual ? visual.alpha : 1;
      if (alpha <= 0 || scale <= 0) continue;
      const special = token.special !== "none";
      let glow = visual ? visual.glow : 0;
      if (!settings.reducedMotion && !hidden) {
        const phase = time * (special ? 0.004 : 0.0018) + token.id * 1.7;
        glow += (special ? 0.35 : 0.12) + Math.sin(phase) * (special ? 0.25 : 0.08);
      }
      ctx.save();
      ctx.translate(x, y);
      if (visual && visual.rot !== 0) ctx.rotate(visual.rot);
      ctx.globalAlpha = Math.min(1, alpha);
      if (glow > 0 && !hc) {
        const gs = cs * scale * (1.35 + glow * 0.4);
        ctx.globalAlpha = Math.min(1, alpha * Math.min(1, glow));
        ctx.drawImage(this.assets.glowSprite(token.kind === "seed" ? null : token.color, px), -gs / 2, -gs / 2, gs, gs);
        ctx.globalAlpha = Math.min(1, alpha);
      }
      const sprite = token.kind === "seed" ? this.assets.seedSprite(px, hc) : this.assets.tokenSprite(token.color, token.special, px, hc);
      const ds = cs * scale;
      ctx.drawImage(sprite, -ds / 2, -ds / 2, ds, ds);
      ctx.restore();
    }
  }

  private drawBlockers(ctx: CanvasRenderingContext2D, frame: RenderFrame, px: number): void {
    const { board, settings } = frame;
    const layout = this.layout;
    const cs = layout.cellSize;
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const cell = board.cells[r][c];
        const blocker = cell.blocker;
        if (!cell.playable || !blocker || blocker.hp <= 0) continue;
        const sprite = this.assets.blockerSprite(blocker.type, px, settings.highContrast, blocker.hp < blocker.maxHp);
        ctx.drawImage(sprite, layout.originX + c * cs, layout.originY + r * cs, cs, cs);
      }
    }
  }

  private drawHint(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const hint = frame.hint;
    if (!hint) return;
    const cs = this.layout.cellSize;
    const t = frame.settings.reducedMotion ? 0.5 : hint.t;
    const pulse = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
    const color = frame.settings.highContrast ? "#ffffff" : "#b9fff0";
    this.drawRing(ctx, hint.a, color, cs * 0.045, pulse * cs * 0.05, 0.5 + pulse * 0.5);
    this.drawRing(ctx, hint.b, color, cs * 0.045, pulse * cs * 0.05, 0.5 + pulse * 0.5);
    const a = this.cellToXY(hint.a.row, hint.a.col);
    const b = this.cellToXY(hint.b.row, hint.b.col);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const slide = frame.settings.reducedMotion ? 0.5 : t;
    const hx = a.x + dx * (0.25 + 0.5 * slide);
    const hy = a.y + dy * (0.25 + 0.5 * slide);
    const s = cs * 0.14;
    ctx.save();
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(hx + ux * s, hy + uy * s);
    ctx.lineTo(hx - uy * s, hy + ux * s);
    ctx.lineTo(hx + uy * s, hy - ux * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawRing(ctx: CanvasRenderingContext2D, at: CellPosition, color: string, lineWidth: number, grow: number, alpha = 1): void {
    const cs = this.layout.cellSize;
    const x = this.layout.originX + at.col * cs;
    const y = this.layout.originY + at.row * cs;
    const inset = cs * 0.06 - grow;
    const radius = cs * 0.18;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(10, 10, 20, 0.6)";
    ctx.lineWidth = lineWidth + 2;
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, cs - inset * 2, cs - inset * 2, radius);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    ctx.save();
    frame.particles.forEach((p) => {
      const f = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, f * 1.5);
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + 0.6 * f);
      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.shape === "petal") {
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 1.4, s * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-s * 1.6, -s * 0.35, s * 3.2, s * 0.7);
        }
        ctx.restore();
      }
    });
    ctx.restore();
  }

  private drawGridCoords(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const { board } = frame;
    const cs = this.layout.cellSize;
    ctx.save();
    ctx.font = `${Math.max(8, Math.round(cs * 0.2))}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        if (!board.cells[r][c].playable) continue;
        const x = this.layout.originX + c * cs + cs * 0.08;
        const y = this.layout.originY + r * cs + cs * 0.06;
        const text = `${r},${c}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.strokeText(text, x, y);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();
  }
}

function samePos(a: CellPosition | null | undefined, b: CellPosition | null | undefined): boolean {
  return !!a && !!b && a.row === b.row && a.col === b.col;
}

/** Fill color for a token's particles, so callers can match effects to the gem. */
export function tokenParticleColors(token: Token): string[] {
  if (token.kind === "seed") return ["#ffd77a", "#d98c2e", "#fff3c0"];
  if (token.color === null) return ["#ff8a8a", "#ffe08a", "#8affc8", "#8ac8ff", "#d08aff"];
  const s = TOKEN_STYLE[token.color];
  return [s.light, s.fill, "#ffffff"];
}
