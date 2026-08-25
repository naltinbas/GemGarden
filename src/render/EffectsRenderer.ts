// Short-lived board effects with their own clocks: beams, rings, flashes, texts, banners.
import type { CellPosition } from "../game/Types";
import { easeOutCubic, easeInQuad, clamp } from "../utils/MathUtils";
import { cellCentre, traceRoundRect, type Layout } from "./RenderFrame";

export type BeamOrientation = "horizontal" | "vertical";

interface BeamFx {
  orientation: BeamOrientation;
  index: number;
  color: string;
  age: number;
  duration: number;
}

interface RingFx {
  at: CellPosition;
  radius: number;
  color: string;
  age: number;
  duration: number;
}

interface FlashFx {
  age: number;
  duration: number;
}

interface TextFx {
  at: CellPosition;
  text: string;
  label: string;
  color: string;
  size: number;
  age: number;
  duration: number;
}

interface BannerFx {
  text: string;
  age: number;
  duration: number;
}

interface PulseFx {
  color: string;
  age: number;
  duration: number;
}

export interface FloatingTextOptions {
  label?: string;
  color?: string;
  /** Font size multiplier, 1 = default. */
  size?: number;
  durationMs?: number;
}

const DEFAULT = {
  beam: 420,
  ring: 460,
  flash: 520,
  text: 1100,
  banner: 1300,
  pulse: 600,
};

export class EffectsRenderer {
  /** Scales every default duration; the game sets it low under reduced motion. */
  durationScale = 1;
  private beams: BeamFx[] = [];
  private rings: RingFx[] = [];
  private flashes: FlashFx[] = [];
  private texts: TextFx[] = [];
  private banners: BannerFx[] = [];
  private pulses: PulseFx[] = [];

  beam(orientation: BeamOrientation, index: number, color: string, durationMs?: number): void {
    this.beams.push({ orientation, index, color, age: 0, duration: this.dur(durationMs, DEFAULT.beam) });
  }

  /** radius is in cells; the ring grows past it slightly while fading. */
  burstRing(at: CellPosition, radius: number, color = "#ffffff", durationMs?: number): void {
    this.rings.push({ at: { row: at.row, col: at.col }, radius, color, age: 0, duration: this.dur(durationMs, DEFAULT.ring) });
  }

  prismFlash(durationMs?: number): void {
    this.flashes.push({ age: 0, duration: this.dur(durationMs, DEFAULT.flash) });
  }

  /** Score burst or any short text rising from a cell. Fractional positions are fine. */
  floatingText(at: CellPosition, text: string, opts: FloatingTextOptions = {}): void {
    this.texts.push({
      at: { row: at.row, col: at.col },
      text,
      label: opts.label ?? "",
      color: opts.color ?? "#fff6c8",
      size: opts.size ?? 1,
      age: 0,
      duration: this.dur(opts.durationMs, DEFAULT.text),
    });
  }

  cascadeBanner(text: string, durationMs?: number): void {
    // Only one banner at a time; a new one replaces the old.
    this.banners.length = 0;
    this.banners.push({ text, age: 0, duration: this.dur(durationMs, DEFAULT.banner) });
  }

  boardPulse(color = "#ffffff", durationMs?: number): void {
    this.pulses.push({ color, age: 0, duration: this.dur(durationMs, DEFAULT.pulse) });
  }

  update(dt: number): void {
    age(this.beams, dt);
    age(this.rings, dt);
    age(this.flashes, dt);
    age(this.texts, dt);
    age(this.banners, dt);
    age(this.pulses, dt);
  }

  isBusy(): boolean {
    return (
      this.beams.length + this.rings.length + this.flashes.length + this.texts.length + this.banners.length + this.pulses.length > 0
    );
  }

  clear(): void {
    this.beams.length = 0;
    this.rings.length = 0;
    this.flashes.length = 0;
    this.texts.length = 0;
    this.banners.length = 0;
    this.pulses.length = 0;
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout, highContrast = false): void {
    if (!this.isBusy()) return;
    ctx.save();
    for (const b of this.beams) this.drawBeam(ctx, layout, b);
    for (const r of this.rings) this.drawRing(ctx, layout, r);
    for (const p of this.pulses) this.drawPulse(ctx, layout, p);
    for (const f of this.flashes) this.drawFlash(ctx, layout, f);
    for (const t of this.texts) this.drawText(ctx, layout, t, highContrast);
    for (const b of this.banners) this.drawBanner(ctx, layout, b);
    ctx.restore();
  }

  private dur(requested: number | undefined, fallback: number): number {
    return Math.max(1, (requested ?? fallback) * this.durationScale);
  }

  private drawBeam(ctx: CanvasRenderingContext2D, layout: Layout, fx: BeamFx): void {
    const t = fx.age / fx.duration;
    const fade = 1 - easeInQuad(t);
    const cs = layout.cellSize;
    const horizontal = fx.orientation === "horizontal";
    const centre = horizontal
      ? layout.originY + (fx.index + 0.5) * cs
      : layout.originX + (fx.index + 0.5) * cs;
    const start = horizontal ? layout.originX : layout.originY;
    const length = horizontal ? layout.cols * cs : layout.rows * cs;
    const width = cs * (0.25 + 0.55 * easeOutCubic(Math.min(1, t * 2.5)));
    ctx.save();
    if (!horizontal) {
      ctx.translate(centre, start);
      ctx.rotate(Math.PI / 2);
      ctx.translate(-start, -centre);
    }
    const glow = ctx.createLinearGradient(0, centre - width, 0, centre + width);
    glow.addColorStop(0, "rgba(255,255,255,0)");
    glow.addColorStop(0.5, fx.color);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = 0.55 * fade;
    ctx.fillStyle = glow;
    ctx.fillRect(start, centre - width, length, width * 2);
    ctx.globalAlpha = 0.95 * fade;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, cs * 0.08 * fade);
    ctx.beginPath();
    ctx.moveTo(start, centre);
    ctx.lineTo(start + length, centre);
    ctx.stroke();
    ctx.restore();
  }

  private drawRing(ctx: CanvasRenderingContext2D, layout: Layout, fx: RingFx): void {
    const t = fx.age / fx.duration;
    const e = easeOutCubic(t);
    const { x, y } = cellCentre(layout, fx.at.row, fx.at.col);
    const r = layout.cellSize * (0.3 + (fx.radius + 0.7) * e);
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = Math.max(1.5, layout.cellSize * 0.18 * (1 - e) + 1.5);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    const bloom = ctx.createRadialGradient(x, y, 0, x, y, r);
    bloom.addColorStop(0, "rgba(255,255,255,0.55)");
    bloom.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = (1 - t) * 0.6;
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawPulse(ctx: CanvasRenderingContext2D, layout: Layout, fx: PulseFx): void {
    const t = fx.age / fx.duration;
    const grow = layout.cellSize * 0.5 * easeOutCubic(t);
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = Math.max(2, layout.cellSize * 0.12 * (1 - t));
    ctx.strokeRect(
      layout.originX - grow,
      layout.originY - grow,
      layout.cols * layout.cellSize + grow * 2,
      layout.rows * layout.cellSize + grow * 2,
    );
    ctx.globalAlpha = 1;
  }

  private drawFlash(ctx: CanvasRenderingContext2D, layout: Layout, fx: FlashFx): void {
    const t = fx.age / fx.duration;
    const w = layout.cols * layout.cellSize;
    const h = layout.rows * layout.cellSize;
    const cx = layout.originX + w / 2;
    const cy = layout.originY + h / 2;
    const radius = Math.hypot(w, h) * 0.6 * (0.3 + 0.7 * easeOutCubic(t));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.4, "rgba(255,240,200,0.6)");
    g.addColorStop(0.7, "rgba(200,180,255,0.3)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = 1 - easeInQuad(t);
    ctx.fillStyle = g;
    ctx.fillRect(layout.originX - w * 0.2, layout.originY - h * 0.2, w * 1.4, h * 1.4);
    ctx.globalAlpha = 1;
  }

  private drawText(ctx: CanvasRenderingContext2D, layout: Layout, fx: TextFx, highContrast: boolean): void {
    const t = fx.age / fx.duration;
    const { x, y } = cellCentre(layout, fx.at.row, fx.at.col);
    const rise = layout.cellSize * 0.9 * easeOutCubic(t);
    const pop = t < 0.15 ? 0.6 + 0.4 * (t / 0.15) : 1;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const px = Math.max(11, layout.cellSize * 0.36 * fx.size * pop);
    // Top-row texts stop at the board edge instead of sliding under the HUD.
    const ty = Math.max(layout.originY + px * 0.6, y - rise);
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${px}px system-ui, "Segoe UI", sans-serif`;
    ctx.lineWidth = Math.max(2, px * (highContrast ? 0.24 : 0.18));
    ctx.strokeStyle = highContrast ? "#000000" : "rgba(10, 8, 20, 0.85)";
    ctx.strokeText(fx.text, x, ty);
    ctx.fillStyle = highContrast ? "#ffffff" : fx.color;
    ctx.fillText(fx.text, x, ty);
    if (fx.label) {
      const lp = Math.max(9, px * 0.55);
      ctx.font = `600 ${lp}px system-ui, "Segoe UI", sans-serif`;
      ctx.lineWidth = Math.max(1.5, lp * (highContrast ? 0.24 : 0.18));
      ctx.strokeText(fx.label, x, ty + px * 0.75);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(fx.label, x, ty + px * 0.75);
    }
    ctx.globalAlpha = 1;
  }

  private drawBanner(ctx: CanvasRenderingContext2D, layout: Layout, fx: BannerFx): void {
    const t = fx.age / fx.duration;
    const scale = t < 0.12 ? 0.7 + 0.3 * easeOutCubic(t / 0.12) : 1;
    const alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    const cs = layout.cellSize;
    const cx = layout.originX + (layout.cols * cs) / 2;
    const cy = layout.originY + cs * 1.2;
    const px = Math.max(14, cs * 0.5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.font = `bold ${px}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = ctx.measureText(fx.text).width + px * 1.4;
    const height = px * 1.7;
    ctx.fillStyle = "rgba(14, 26, 24, 0.82)";
    ctx.strokeStyle = "rgba(255, 230, 150, 0.9)";
    ctx.lineWidth = 2;
    traceRoundRect(ctx, -width / 2, -height / 2, width, height, height / 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = Math.max(2, px * 0.16);
    ctx.strokeStyle = "rgba(10, 8, 20, 0.9)";
    ctx.strokeText(fx.text, 0, 1);
    ctx.fillStyle = "#ffe89a";
    ctx.fillText(fx.text, 0, 1);
    ctx.restore();
  }
}

function age<T extends { age: number; duration: number }>(list: T[], dt: number): void {
  let write = 0;
  for (let i = 0; i < list.length; i++) {
    const fx = list[i];
    fx.age += dt;
    if (fx.age < fx.duration) list[write++] = fx;
  }
  list.length = write;
}
