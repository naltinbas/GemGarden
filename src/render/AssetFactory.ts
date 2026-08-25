// Pre-rendered sprites for tokens, blockers, terrain and board tiles, cached by key.
import type { BlockerType, SpecialType, TokenColor } from "../game/Types";
import { TOKEN_STYLE } from "../game/Config";
import { Random } from "../utils/Random";

export type Sprite = HTMLCanvasElement | OffscreenCanvas;
export type CanvasFactory = (width: number, height: number) => Sprite;
type Ctx = CanvasRenderingContext2D;

export function defaultCanvasFactory(width: number, height: number): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function tokenKey(color: TokenColor | null, special: SpecialType, size: number, highContrast: boolean): string {
  return `${color ?? "prism"}|${special}|${size}|${highContrast}`;
}

export function assetKey(kind: string, ...parts: (string | number | boolean | null)[]): string {
  return `${kind}:${parts.map((p) => (p === null ? "null" : String(p))).join("|")}`;
}

const PRISM_HUES = [0, 60, 120, 180, 240, 300];
const MIST_FILL = "#2a1140";
const MIST_EDGE = "#8e5bb8";
const MOSS_LIGHT = "#7fe0d4";
const MOSS_DARK = "#2f9c93";
const EXIT_GOLD = "#ffd75e";

export class AssetFactory {
  private cache = new Map<string, Sprite>();
  private createCanvas: CanvasFactory;

  constructor(createCanvas: CanvasFactory = defaultCanvasFactory) {
    this.createCanvas = createCanvas;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /** Gem token. color null means a prism core. */
  tokenSprite(color: TokenColor | null, special: SpecialType, size: number, highContrast: boolean): Sprite {
    return this.make(tokenKey(color, special, size, highContrast), size, (ctx) => {
      ctx.translate(size / 2, size / 2);
      const r = size * 0.4;
      if (color === null || special === "prism") {
        drawPrism(ctx, r, size, highContrast);
        return;
      }
      drawGem(ctx, color, r, size, highContrast);
      if (special === "lineHorizontal" || special === "lineVertical") drawBeamMark(ctx, r, size, special === "lineVertical");
      else if (special === "burst") drawBurstMark(ctx, color, r, size);
      if (highContrast) drawLetter(ctx, TOKEN_STYLE[color].letter, size);
    });
  }

  seedSprite(size: number, highContrast: boolean): Sprite {
    return this.make(assetKey("seed", size, highContrast), size, (ctx) => {
      ctx.translate(size / 2, size / 2);
      drawSeed(ctx, size * 0.4, size, highContrast);
      if (highContrast) drawLetter(ctx, "S", size);
    });
  }

  /** Soft radial halo drawn behind a token. null = neutral gold for prisms and seeds. */
  glowSprite(color: TokenColor | null, size: number): Sprite {
    return this.make(assetKey("glow", color, size), size, (ctx) => {
      const glow = color ? TOKEN_STYLE[color].glow : "rgba(255, 235, 170, 0.6)";
      const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
      g.addColorStop(0, glow);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    });
  }

  /** damaged = hp below max; only stone roots change their look. */
  blockerSprite(type: BlockerType, size: number, highContrast: boolean, damaged = false): Sprite {
    const stage = type === "stoneRoot" && damaged;
    return this.make(assetKey("blocker", type, size, highContrast, stage), size, (ctx) => {
      switch (type) {
        case "stoneRoot":
          drawStoneRoot(ctx, size, highContrast, stage);
          break;
        case "glassVine":
          drawGlassVine(ctx, size, highContrast);
          break;
        case "lockedBud":
          drawLockedBud(ctx, size, highContrast);
          break;
        case "shadowMist":
          drawShadowMist(ctx, size, highContrast);
          break;
      }
    });
  }

  terrainSprite(layers: number, size: number, highContrast: boolean): Sprite {
    const dense = layers >= 2;
    return this.make(assetKey("moss", dense ? 2 : 1, size, highContrast), size, (ctx) => {
      drawMoss(ctx, size, dense, highContrast);
    });
  }

  exitSprite(size: number, highContrast: boolean): Sprite {
    return this.make(assetKey("exit", size, highContrast), size, (ctx) => drawExit(ctx, size, highContrast));
  }

  /** variant 0/1 for a light checker pattern. */
  cellBaseSprite(size: number, highContrast: boolean, variant: number): Sprite {
    const v = variant & 1;
    return this.make(assetKey("base", size, highContrast, v), size, (ctx) => drawCellBase(ctx, size, highContrast, v));
  }

  cursorSprite(size: number, highContrast: boolean): Sprite {
    return this.make(assetKey("cursor", size, highContrast), size, (ctx) => drawCursor(ctx, size, highContrast));
  }

  private make(key: string, size: number, draw: (ctx: Ctx, size: number) => void): Sprite {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const px = Math.max(1, Math.round(size));
    const canvas = this.createCanvas(px, px);
    const ctx = canvas.getContext("2d") as Ctx | null;
    if (ctx) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      draw(ctx, px);
      ctx.restore();
    }
    this.cache.set(key, canvas);
    return canvas;
  }
}

// ---------------------------------------------------------------------------
// Gem silhouettes. Each traces a closed path centred on the origin with radius r.

function traceBloom(ctx: Ctx, r: number): void {
  const petals = 5;
  const inner = r * 0.5;
  const d = Math.PI / petals;
  ctx.beginPath();
  for (let i = 0; i < petals; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / petals;
    const v0 = a - d;
    const v1 = a + d;
    if (i === 0) ctx.moveTo(Math.cos(v0) * inner, Math.sin(v0) * inner);
    ctx.quadraticCurveTo(Math.cos(a - d * 0.55) * r * 1.12, Math.sin(a - d * 0.55) * r * 1.12, Math.cos(a) * r, Math.sin(a) * r);
    ctx.quadraticCurveTo(Math.cos(a + d * 0.55) * r * 1.12, Math.sin(a + d * 0.55) * r * 1.12, Math.cos(v1) * inner, Math.sin(v1) * inner);
  }
  ctx.closePath();
}

function traceTeardrop(ctx: Ctx, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.bezierCurveTo(r * 0.12, -r * 0.6, r * 0.62, -r * 0.2, r * 0.62, r * 0.36);
  ctx.arc(0, r * 0.36, r * 0.62, 0, Math.PI);
  ctx.bezierCurveTo(-r * 0.62, -r * 0.2, -r * 0.12, -r * 0.6, 0, -r);
  ctx.closePath();
}

function traceLens(ctx: Ctx, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 0.9, 0, 0, r);
  ctx.quadraticCurveTo(-r * 0.9, 0, 0, -r);
  ctx.closePath();
}

function traceFourPetal(ctx: Ctx, r: number): void {
  const k = r * 0.32;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(k, -k, r, 0);
  ctx.quadraticCurveTo(k, k, 0, r);
  ctx.quadraticCurveTo(-k, k, -r, 0);
  ctx.quadraticCurveTo(-k, -k, 0, -r);
  ctx.closePath();
}

function traceLeaf(ctx: Ctx, r: number): void {
  const t = r * 0.71;
  ctx.beginPath();
  ctx.moveTo(t, -t);
  ctx.quadraticCurveTo(r * 0.85, r * 0.85, -t, t);
  ctx.quadraticCurveTo(-r * 0.85, -r * 0.85, t, -t);
  ctx.closePath();
}

function traceCircle(ctx: Ctx, r: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
  ctx.closePath();
}

function traceHexagon(ctx: Ctx, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function traceShape(ctx: Ctx, color: TokenColor, r: number): void {
  switch (color) {
    case "ruby":
      traceBloom(ctx, r);
      break;
    case "azure":
      traceTeardrop(ctx, r);
      break;
    case "citrine":
      traceLens(ctx, r * 0.9);
      break;
    case "violet":
      traceFourPetal(ctx, r);
      break;
    case "jade":
      traceLeaf(ctx, r);
      break;
    case "pearl":
      traceCircle(ctx, r);
      break;
  }
}

function gemGradient(ctx: Ctx, color: TokenColor, r: number): CanvasGradient {
  const s = TOKEN_STYLE[color];
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.05, 0, 0, r * 1.25);
  g.addColorStop(0, s.light);
  g.addColorStop(0.45, s.fill);
  g.addColorStop(1, s.dark);
  return g;
}

function drawGem(ctx: Ctx, color: TokenColor, r: number, size: number, highContrast: boolean): void {
  const s = TOKEN_STYLE[color];
  traceShape(ctx, color, r);
  ctx.fillStyle = gemGradient(ctx, color, r);
  ctx.fill();
  drawInnerFacet(ctx, color, r, size);
  traceShape(ctx, color, r);
  ctx.strokeStyle = highContrast ? "#0b0b12" : s.edge;
  ctx.lineWidth = size * (highContrast ? 0.07 : 0.03);
  ctx.stroke();
  // Gloss spot near the upper left.
  ctx.beginPath();
  ctx.ellipse(-r * 0.32, -r * 0.42, r * 0.2, r * 0.11, -Math.PI / 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fill();
}

function drawInnerFacet(ctx: Ctx, color: TokenColor, r: number, size: number): void {
  const s = TOKEN_STYLE[color];
  ctx.lineWidth = size * 0.025;
  switch (color) {
    case "ruby":
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = s.light;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = s.dark;
      ctx.fill();
      break;
    case "azure":
      traceTeardrop(ctx, r * 0.5);
      ctx.strokeStyle = s.light;
      ctx.stroke();
      break;
    case "citrine":
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.quadraticCurveTo(r * 0.05, -r * 1.15, r * 0.35, -r * 1.05);
      ctx.strokeStyle = "#5fa33a";
      ctx.lineWidth = size * 0.035;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(r * 0.34, -r * 1.02, r * 0.16, r * 0.09, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = "#7ccb4b";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.55);
      ctx.lineTo(0, r * 0.55);
      ctx.strokeStyle = s.dark;
      ctx.lineWidth = size * 0.02;
      ctx.stroke();
      break;
    case "violet":
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = s.light;
      ctx.fill();
      traceFourPetal(ctx, r * 0.55);
      ctx.strokeStyle = s.light;
      ctx.stroke();
      break;
    case "jade": {
      const t = r * 0.6;
      ctx.beginPath();
      ctx.moveTo(t, -t);
      ctx.lineTo(-t, t);
      for (let i = -1; i <= 1; i++) {
        const px = i * r * 0.28;
        ctx.moveTo(px, -px);
        ctx.lineTo(px + r * 0.28, -px + r * 0.05);
        ctx.moveTo(px, -px);
        ctx.lineTo(px - r * 0.05, -px - r * 0.28);
      }
      ctx.strokeStyle = s.light;
      ctx.stroke();
      break;
    }
    case "pearl":
      ctx.beginPath();
      ctx.arc(-r * 0.12, -r * 0.12, r * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r * 0.06, r * 0.06, r * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = gemGradient(ctx, color, r);
      ctx.fill();
      break;
  }
}

function drawLetter(ctx: Ctx, letter: string, size: number): void {
  ctx.font = `bold ${Math.round(size * 0.46)}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = size * 0.09;
  ctx.strokeStyle = "#0b0b12";
  ctx.strokeText(letter, 0, size * 0.02);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(letter, 0, size * 0.02);
}

function drawBeamMark(ctx: Ctx, r: number, size: number, vertical: boolean): void {
  ctx.save();
  if (vertical) ctx.rotate(Math.PI / 2);
  const half = r * 0.82;
  const off = r * 0.2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = size * 0.05;
  ctx.beginPath();
  ctx.moveTo(-half, -off);
  ctx.lineTo(half, -off);
  ctx.moveTo(-half, off);
  ctx.lineTo(half, off);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * (half + r * 0.22), 0);
    ctx.lineTo(dir * half, -r * 0.3);
    ctx.lineTo(dir * half, r * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBurstMark(ctx: Ctx, color: TokenColor, r: number, size: number): void {
  const s = TOKEN_STYLE[color];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.11, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = s.dark;
    ctx.lineWidth = size * 0.015;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.11, 0, Math.PI * 2);
  ctx.fillStyle = s.light;
  ctx.fill();
}

function drawPrism(ctx: Ctx, r: number, size: number, highContrast: boolean): void {
  traceHexagon(ctx, r);
  ctx.fillStyle = "#e6e4ee";
  ctx.fill();
  for (let i = 0; i < 6; i++) {
    const a0 = -Math.PI / 2 + (i * Math.PI) / 3;
    const a1 = a0 + Math.PI / 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    ctx.closePath();
    ctx.fillStyle = `hsla(${PRISM_HUES[i]}, 85%, 68%, 0.75)`;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fill();
  traceHexagon(ctx, r);
  ctx.strokeStyle = highContrast ? "#0b0b12" : "#4a4660";
  ctx.lineWidth = size * (highContrast ? 0.07 : 0.03);
  ctx.stroke();
  traceHexagon(ctx, r * 0.62);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = size * 0.02;
  ctx.stroke();
}

function drawSeed(ctx: Ctx, r: number, size: number, highContrast: boolean): void {
  const halo = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.25);
  halo.addColorStop(0, "rgba(255, 220, 120, 0.55)");
  halo.addColorStop(1, "rgba(255, 220, 120, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeStyle = "rgba(255, 210, 90, 0.7)";
  ctx.lineWidth = size * 0.02;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    ctx.lineTo(Math.cos(a) * r * 1.18, Math.sin(a) * r * 1.18);
    ctx.stroke();
  }
  ctx.save();
  ctx.rotate(0.35);
  traceLens(ctx, r * 0.85);
  const g = ctx.createLinearGradient(-r * 0.4, -r, r * 0.4, r);
  g.addColorStop(0, "#ffd77a");
  g.addColorStop(0.5, "#d98c2e");
  g.addColorStop(1, "#7a4614");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 240, 200, 0.8)";
  ctx.lineWidth = size * 0.02;
  for (const off of [-0.18, 0.18]) {
    ctx.beginPath();
    ctx.moveTo(off * r, -r * 0.55);
    ctx.quadraticCurveTo(off * r * 1.8, 0, off * r, r * 0.55);
    ctx.stroke();
  }
  traceLens(ctx, r * 0.85);
  ctx.strokeStyle = highContrast ? "#0b0b12" : "#5a3410";
  ctx.lineWidth = size * (highContrast ? 0.07 : 0.03);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Blockers

function drawStoneRoot(ctx: Ctx, size: number, highContrast: boolean, damaged: boolean): void {
  const c = size / 2;
  const r = size * 0.42;
  ctx.strokeStyle = "#5b3b1f";
  ctx.lineWidth = size * 0.05;
  for (const [sx, dx] of [
    [-0.18, -0.4],
    [0.05, 0.05],
    [0.22, 0.42],
  ]) {
    ctx.beginPath();
    ctx.moveTo(c + sx * size, c + size * 0.25);
    ctx.quadraticCurveTo(c + sx * size + dx * size * 0.4, c + size * 0.42, c + dx * size, size * 0.98);
    ctx.stroke();
  }
  ctx.beginPath();
  const bumps = 9;
  for (let i = 0; i <= bumps; i++) {
    const a = (i / bumps) * Math.PI * 2;
    const wob = i % 2 === 0 ? 1 : 0.86;
    const x = c + Math.cos(a) * r * wob;
    const y = c + Math.sin(a) * r * wob * 0.92;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(c - r * 0.4, c - r * 0.5, r * 0.1, c, c, r * 1.2);
  g.addColorStop(0, "#b8b8b4");
  g.addColorStop(0.6, "#7d7d7a");
  g.addColorStop(1, "#4a4a48");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = highContrast ? "#0b0b12" : "#33332f";
  ctx.lineWidth = size * (highContrast ? 0.06 : 0.03);
  ctx.stroke();
  const cracks: number[][] = [
    [-0.25, -0.2, -0.05, 0.02, -0.15, 0.22],
    [0.1, -0.3, 0.2, -0.05, 0.05, 0.12],
  ];
  if (damaged) {
    cracks.push([-0.3, 0.1, -0.02, 0.18, 0.28, 0.05], [0.15, 0.1, 0.25, 0.3, 0.1, 0.34], [-0.1, -0.35, 0.02, -0.15, 0.12, -0.32]);
  }
  ctx.strokeStyle = "#2c2c29";
  ctx.lineWidth = size * (damaged ? 0.035 : 0.025);
  for (const [x0, y0, x1, y1, x2, y2] of cracks) {
    ctx.beginPath();
    ctx.moveTo(c + x0 * size, c + y0 * size);
    ctx.lineTo(c + x1 * size, c + y1 * size);
    ctx.lineTo(c + x2 * size, c + y2 * size);
    ctx.stroke();
  }
  ctx.strokeStyle = "#6b4a2b";
  ctx.lineWidth = size * 0.03;
  ctx.beginPath();
  ctx.moveTo(c - r * 0.9, c + r * 0.3);
  ctx.quadraticCurveTo(c - r * 1.1, c + r * 0.6, c - r * 0.7, c + r * 0.95);
  ctx.moveTo(c + r * 0.9, c + r * 0.2);
  ctx.quadraticCurveTo(c + r * 1.15, c + r * 0.55, c + r * 0.75, c + r * 0.9);
  ctx.stroke();
}

function drawGlassVine(ctx: Ctx, size: number, highContrast: boolean): void {
  ctx.fillStyle = "rgba(170, 255, 190, 0.14)";
  ctx.fillRect(0, 0, size, size);
  // Glass sheen band across the upper left.
  const sheen = ctx.createLinearGradient(0, 0, size, size);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0)");
  sheen.addColorStop(0.35, "rgba(255, 255, 255, 0.22)");
  sheen.addColorStop(0.5, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, size, size);
  const stems: number[][] = [
    [0.05, 0.35, 0.5, 0.2, 0.95, 0.65],
    [0.1, 0.9, 0.55, 0.5, 0.9, 0.05],
    [0.4, 0.02, 0.6, 0.55, 0.45, 0.98],
  ];
  ctx.lineWidth = size * (highContrast ? 0.07 : 0.055);
  ctx.strokeStyle = highContrast ? "#0b3d1a" : "rgba(47, 140, 76, 0.85)";
  for (const [x0, y0, cx, cy, x1, y1] of stems) {
    ctx.beginPath();
    ctx.moveTo(x0 * size, y0 * size);
    ctx.quadraticCurveTo(cx * size, cy * size, x1 * size, y1 * size);
    ctx.stroke();
  }
  ctx.lineWidth = size * 0.018;
  ctx.strokeStyle = "rgba(220, 255, 225, 0.7)";
  for (const [x0, y0, cx, cy, x1, y1] of stems) {
    ctx.beginPath();
    ctx.moveTo(x0 * size, y0 * size);
    ctx.quadraticCurveTo(cx * size, cy * size, x1 * size, y1 * size);
    ctx.stroke();
  }
  const leaves: number[][] = [
    [0.3, 0.28, -0.6],
    [0.72, 0.5, 0.4],
    [0.32, 0.72, 0.9],
    [0.62, 0.18, 0.2],
  ];
  for (const [x, y, rot] of leaves) {
    ctx.beginPath();
    ctx.ellipse(x * size, y * size, size * 0.09, size * 0.045, rot, 0, Math.PI * 2);
    ctx.fillStyle = highContrast ? "#1d7a3a" : "rgba(120, 220, 140, 0.8)";
    ctx.fill();
    ctx.strokeStyle = "rgba(20, 70, 35, 0.7)";
    ctx.lineWidth = size * 0.012;
    ctx.stroke();
  }
}

function drawLockedBud(ctx: Ctx, size: number, highContrast: boolean): void {
  const c = size / 2;
  ctx.strokeStyle = "#2f6b3a";
  ctx.lineWidth = size * 0.045;
  ctx.beginPath();
  ctx.moveTo(c, size * 0.7);
  ctx.quadraticCurveTo(c - size * 0.05, size * 0.85, c - size * 0.02, size * 0.96);
  ctx.stroke();
  // Three sepals, outer two first so the middle one sits on top.
  for (const [dx, lean] of [
    [-0.13, -0.35],
    [0.13, 0.35],
    [0, 0],
  ]) {
    ctx.save();
    ctx.translate(c + dx * size, size * 0.62);
    ctx.rotate(lean);
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.5);
    ctx.bezierCurveTo(size * 0.22, -size * 0.3, size * 0.22, size * 0.05, 0, size * 0.12);
    ctx.bezierCurveTo(-size * 0.22, size * 0.05, -size * 0.22, -size * 0.3, 0, -size * 0.5);
    ctx.closePath();
    const g = ctx.createLinearGradient(-size * 0.2, 0, size * 0.2, 0);
    g.addColorStop(0, "#2f7f43");
    g.addColorStop(0.5, "#66c36f");
    g.addColorStop(1, "#2d6d3c");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = highContrast ? "#0b0b12" : "#1e4a28";
    ctx.lineWidth = size * (highContrast ? 0.05 : 0.025);
    ctx.stroke();
    ctx.restore();
  }
  // Pink tip peeking out of the closed bud.
  ctx.beginPath();
  ctx.moveTo(c, size * 0.08);
  ctx.quadraticCurveTo(c + size * 0.09, size * 0.2, c, size * 0.3);
  ctx.quadraticCurveTo(c - size * 0.09, size * 0.2, c, size * 0.08);
  ctx.fillStyle = "#f2a4c5";
  ctx.fill();
  // Chain ring at the lower right.
  const rx = size * 0.8;
  const ry = size * 0.8;
  ctx.lineWidth = size * 0.045;
  ctx.strokeStyle = highContrast ? "#ffffff" : "#c9c9d6";
  ctx.beginPath();
  ctx.arc(rx, ry, size * 0.1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(rx - size * 0.13, ry - size * 0.1, size * 0.07, size * 0.045, -0.7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.015;
  ctx.strokeStyle = "#4a4a58";
  ctx.beginPath();
  ctx.arc(rx, ry, size * 0.1, 0, Math.PI * 2);
  ctx.stroke();
}

function drawShadowMist(ctx: Ctx, size: number, highContrast: boolean): void {
  const c = size / 2;
  const r = size * 0.47;
  const g = ctx.createRadialGradient(c, c, r * 0.2, c, c, r);
  g.addColorStop(0, MIST_FILL);
  g.addColorStop(0.75, "#3b1a58");
  g.addColorStop(1, "rgba(59, 26, 88, 0.85)");
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const wob = i % 3 === 0 ? 1 : 0.93;
    const x = c + Math.cos(a) * r * wob;
    const y = c + Math.sin(a) * r * wob;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  if (highContrast) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = size * 0.05;
    ctx.stroke();
  }
  ctx.strokeStyle = highContrast ? "#d9b8ff" : MIST_EDGE;
  ctx.lineWidth = size * 0.035;
  ctx.beginPath();
  let angle = 0;
  let rad = 0;
  ctx.moveTo(c, c);
  while (rad < r * 0.7) {
    angle += 0.35;
    rad += r * 0.7 * 0.35 / (Math.PI * 2.2);
    ctx.lineTo(c + Math.cos(angle) * rad, c + Math.sin(angle) * rad * 0.85);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(160, 110, 200, 0.35)";
  ctx.beginPath();
  ctx.ellipse(c + r * 0.45, c - r * 0.45, r * 0.3, r * 0.15, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(c - r * 0.5, c + r * 0.4, r * 0.25, r * 0.12, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Terrain, exits, tiles, cursor

function drawMoss(ctx: Ctx, size: number, dense: boolean, highContrast: boolean): void {
  const rng = new Random(dense ? 7 : 3);
  const c = size / 2;
  const base = dense ? MOSS_DARK : MOSS_LIGHT;
  const alpha = dense ? 0.9 : 0.6;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = base;
  ctx.beginPath();
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const rr = size * (0.36 + rng.next() * 0.06);
    const x = c + Math.cos(a) * rr;
    const y = c + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  // Fuzzy edge: little tufts scattered around the rim.
  const tufts = dense ? 34 : 22;
  for (let i = 0; i < tufts; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = size * (0.3 + rng.next() * 0.17);
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, size * (0.03 + rng.next() * 0.035), 0, Math.PI * 2);
    ctx.fillStyle = rng.chance(0.5) ? base : dense ? MOSS_LIGHT : "#b9f3ec";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (highContrast) {
    ctx.strokeStyle = dense ? "#ffffff" : "#0b0b12";
    ctx.lineWidth = size * 0.03;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.38, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (dense) {
    const crystals = [
      [0.32, 0.36, 0.09],
      [0.66, 0.3, 0.07],
      [0.5, 0.66, 0.1],
      [0.72, 0.62, 0.06],
    ];
    for (const [x, y, s] of crystals) {
      ctx.beginPath();
      ctx.moveTo(x * size, (y - s) * size);
      ctx.lineTo((x + s * 0.6) * size, y * size);
      ctx.lineTo(x * size, (y + s) * size);
      ctx.lineTo((x - s * 0.6) * size, y * size);
      ctx.closePath();
      ctx.fillStyle = "#c9fbff";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = size * 0.015;
      ctx.stroke();
    }
  }
}

function drawExit(ctx: Ctx, size: number, highContrast: boolean): void {
  const cx = size / 2;
  const cy = size * 0.82;
  const rx = size * 0.34;
  const ry = size * 0.11;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 10, 30, 0.6)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 215, 94, 0.35)";
  ctx.lineWidth = size * 0.12;
  ctx.stroke();
  ctx.strokeStyle = highContrast ? "#ffffff" : EXIT_GOLD;
  ctx.lineWidth = size * 0.05;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 245, 200, 0.6)";
  ctx.lineWidth = size * 0.05;
  ctx.setLineDash([size * 0.06, size * 0.1]);
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.2, size * 0.5);
  ctx.lineTo(cx, cy - ry * 0.5);
  ctx.moveTo(cx + size * 0.2, size * 0.5);
  ctx.lineTo(cx, cy - ry * 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
}

function traceRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCellBase(ctx: Ctx, size: number, highContrast: boolean, variant: number): void {
  const inset = Math.max(1, size * 0.035);
  const w = size - inset * 2;
  traceRoundRect(ctx, inset, inset, w, w, size * 0.16);
  if (highContrast) {
    ctx.fillStyle = variant === 0 ? "#151f1e" : "#1e2c2a";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = variant === 0 ? "rgba(28, 58, 54, 0.62)" : "rgba(36, 72, 66, 0.62)";
  ctx.fill();
  ctx.strokeStyle = "rgba(160, 230, 210, 0.14)";
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.stroke();
}

function drawCursor(ctx: Ctx, size: number, highContrast: boolean): void {
  const len = size * 0.24;
  const inset = size * 0.06;
  ctx.lineWidth = size * 0.06;
  ctx.strokeStyle = "rgba(10, 10, 20, 0.7)";
  traceCorners(ctx, size, inset, len);
  ctx.stroke();
  ctx.lineWidth = size * 0.035;
  ctx.strokeStyle = highContrast ? "#ffffff" : "#fff3b0";
  traceCorners(ctx, size, inset, len);
  ctx.stroke();
}

function traceCorners(ctx: Ctx, size: number, inset: number, len: number): void {
  const a = inset;
  const b = size - inset;
  ctx.beginPath();
  ctx.moveTo(a, a + len);
  ctx.lineTo(a, a);
  ctx.lineTo(a + len, a);
  ctx.moveTo(b - len, a);
  ctx.lineTo(b, a);
  ctx.lineTo(b, a + len);
  ctx.moveTo(b, b - len);
  ctx.lineTo(b, b);
  ctx.lineTo(b - len, b);
  ctx.moveTo(a + len, b);
  ctx.lineTo(a, b);
  ctx.lineTo(a, b - len);
}
