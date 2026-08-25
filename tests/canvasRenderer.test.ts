import { describe, expect, it } from "vitest";
import { AssetFactory, type Sprite } from "../src/render/AssetFactory";
import { CanvasRenderer } from "../src/render/CanvasRenderer";
import { EffectsRenderer } from "../src/render/EffectsRenderer";
import type { RenderFrame } from "../src/render/RenderFrame";
import { AnimationSystem } from "../src/systems/AnimationSystem";
import { ParticleSystem } from "../src/systems/ParticleSystem";
import { parseBoard } from "./helpers";

/** A 2D context stub without roundRect, as in older browsers. */
function stubContext(calls: string[]): CanvasRenderingContext2D {
  const ctx: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "roundRect") return undefined;
        if (prop === "measureText") return () => ({ width: 10 });
        return (...args: unknown[]) => {
          void args;
          calls.push(String(prop));
          return ctx;
        };
      },
      set() {
        return true;
      },
    },
  );
  return ctx as CanvasRenderingContext2D;
}

interface StubCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  sizeWrites: number;
  getContext(): CanvasRenderingContext2D;
}

function stubCanvas(calls: string[]): StubCanvas {
  const ctx = stubContext(calls);
  let width = 0;
  const canvas: StubCanvas = {
    get width() {
      return width;
    },
    set width(v: number) {
      width = v;
      canvas.sizeWrites++;
    },
    height: 0,
    style: {},
    sizeWrites: 0,
    getContext: () => ctx,
  };
  return canvas;
}

function makeRenderer(calls: string[]): { renderer: CanvasRenderer; canvas: StubCanvas } {
  const canvas = stubCanvas(calls);
  const assets = new AssetFactory((w, h) => ({ width: w, height: h, getContext: () => stubContext([]) }) as unknown as Sprite);
  return { renderer: new CanvasRenderer(canvas as unknown as HTMLCanvasElement, assets), canvas };
}

function frameFor(renderer: CanvasRenderer): RenderFrame {
  const board = parseBoard(["r a c v", "a c v r", "c v r a", "v r a c"]);
  renderer.setBoard(board);
  return {
    board,
    visuals: new AnimationSystem(),
    particles: new ParticleSystem(10),
    effects: new EffectsRenderer(),
    selected: { row: 1, col: 1 },
    hover: { row: 2, col: 2 },
    hint: { a: { row: 0, col: 0 }, b: { row: 0, col: 1 }, t: 0.3 },
    cursorVisible: false,
    shake: 0,
    time: 1000,
    settings: { highContrast: false, reducedMotion: false, showGridCoords: false },
    dimmed: false,
  };
}

describe("CanvasRenderer", () => {
  it("draws selection, hover and hint rings without ctx.roundRect", () => {
    const calls: string[] = [];
    const { renderer } = makeRenderer(calls);
    renderer.resize(400, 400, 1);
    const frame = frameFor(renderer);
    expect(() => renderer.draw(frame)).not.toThrow();
    // Four rings, each traced by hand with four curved corners.
    expect(calls.filter((c) => c === "quadraticCurveTo").length).toBe(16);
    // The draw ran to the end: the outer save/restore pair is balanced.
    expect(calls.filter((c) => c === "save").length).toBe(calls.filter((c) => c === "restore").length);
  });
});
