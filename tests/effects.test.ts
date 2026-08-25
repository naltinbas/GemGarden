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

function fillTexts(calls: Call[]): { text: string; y: number; fill: unknown; stroke: unknown; lineWidth: unknown }[] {
  return calls
    .filter((c) => c.name === "fillText")
    .map((c) => {
      const props = c.args[3] as Record<string, unknown>;
      return { text: String(c.args[0]), y: c.args[2] as number, fill: props.fillStyle, stroke: props.strokeStyle, lineWidth: props.lineWidth };
    });
}

describe("EffectsRenderer floating text", () => {
  it("keeps a top-row text inside the board while it rises", () => {
    const fx = new EffectsRenderer();
    fx.floatingText({ row: 0, col: 2 }, "+120", { label: "Beam", size: 1.15 });
    fx.update(700);
    const calls: Call[] = [];
    fx.draw(stubContext(calls, {}), LAYOUT);
    const texts = fillTexts(calls);
    expect(texts.map((t) => t.text)).toEqual(["+120", "Beam"]);
    // Text centre stays below the board's top edge, so nothing is drawn under the HUD.
    for (const t of texts) expect(t.y).toBeGreaterThan(LAYOUT.originY);
    expect(texts[0].y).toBeLessThan(LAYOUT.originY + LAYOUT.cellSize * 0.5);
  });

  it("lets a lower text rise the full distance", () => {
    const fx = new EffectsRenderer();
    fx.floatingText({ row: 4, col: 2 }, "+30");
    fx.update(1000);
    const calls: Call[] = [];
    fx.draw(stubContext(calls, {}), LAYOUT);
    const centre = LAYOUT.originY + 4.5 * LAYOUT.cellSize;
    const [text] = fillTexts(calls);
    expect(text.y).toBeLessThan(centre - LAYOUT.cellSize * 0.8);
  });

  it("uses a solid light fill with a dark outline in high contrast", () => {
    const fx = new EffectsRenderer();
    fx.floatingText({ row: 3, col: 3 }, "+60", { color: "#7fe0d4" });
    fx.update(300);
    const normal: Call[] = [];
    fx.draw(stubContext(normal, {}), LAYOUT, false);
    expect(fillTexts(normal)[0].fill).toBe("#7fe0d4");
    const hc: Call[] = [];
    fx.draw(stubContext(hc, {}), LAYOUT, true);
    const text = fillTexts(hc)[0];
    expect(text.fill).toBe("#ffffff");
    expect(text.stroke).toBe("#000000");
    expect(text.lineWidth as number).toBeGreaterThan(fillTexts(normal)[0].lineWidth as number);
  });

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
