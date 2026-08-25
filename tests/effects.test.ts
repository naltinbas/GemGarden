import { describe, expect, it } from "vitest";
import { EffectsRenderer } from "../src/render/EffectsRenderer";
import type { Layout } from "../src/render/RenderFrame";

interface Call {
  name: string;
  args: unknown[];
}

/** Records method calls and property writes; roundRect is deliberately absent. */
function stubContext(calls: Call[], props: Record<string, unknown>): CanvasRenderingContext2D {
  const ctx: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "roundRect") return undefined;
        if (prop === "measureText") return () => ({ width: 40 });
        if (typeof prop === "string" && prop in props) return props[prop];
        return (...args: unknown[]) => {
          const snapshot = { ...props };
          calls.push({ name: String(prop), args: [...args, snapshot] });
          return ctx;
        };
      },
      set(_target, prop, value) {
        props[String(prop)] = value;
        return true;
      },
    },
  );
  return ctx as CanvasRenderingContext2D;
}

const LAYOUT: Layout = { originX: 20, originY: 100, cellSize: 50, rows: 8, cols: 8 };

describe("EffectsRenderer", () => {
  it("draws the cascade banner without ctx.roundRect", () => {
    const fx = new EffectsRenderer();
    fx.cascadeBanner("Petal Storm");
    fx.update(200);
    const calls: Call[] = [];
    expect(() => fx.draw(stubContext(calls, {}), LAYOUT)).not.toThrow();
    expect(calls.some((c) => c.name === "quadraticCurveTo")).toBe(true);
    expect(calls.some((c) => c.name === "fillText" && c.args[0] === "Petal Storm")).toBe(true);
  });
});
