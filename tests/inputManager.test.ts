import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputManager } from "../src/game/InputManager";

type Listener = (e: unknown) => void;

const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const listeners = new Map<string, Listener>();

function stubCanvas(): HTMLCanvasElement {
  const canvas = {
    style: {} as Record<string, string>,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    focus: () => undefined,
  };
  return canvas as unknown as HTMLCanvasElement;
}

function keyEvent(key: string): KeyboardEvent & { prevented: boolean } {
  const e = {
    key,
    target: null,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
  };
  return e as unknown as KeyboardEvent & { prevented: boolean };
}

beforeEach(() => {
  for (const name of ["window", "document", "HTMLElement"]) saved[name] = g[name];
  listeners.clear();
  g.window = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  g.HTMLElement = class {};
});

afterEach(() => {
  for (const name of ["window", "document", "HTMLElement"]) {
    if (saved[name] === undefined) delete g[name];
    else g[name] = saved[name];
  }
});

function make(): { input: InputManager; events: string[]; press: (key: string) => ReturnType<typeof keyEvent> } {
  const canvas = stubCanvas();
  g.document = { activeElement: canvas };
  const input = new InputManager(canvas, { xyToCell: () => null, cellSize: () => 40 });
  const events: string[] = [];
  for (const name of ["pause", "activity", "select", "restart", "hint", "cursorMove"] as const) {
    input.on(name, () => events.push(name));
  }
  const press = (key: string) => {
    const e = keyEvent(key);
    listeners.get("keydown")?.(e);
    return e;
  };
  return { input, events, press };
}

describe("InputManager pause keys", () => {
  it("Escape and P emit pause only, never activity", () => {
    const { input, events, press } = make();
    input.setMode("play");
    expect(press("Escape").prevented).toBe(true);
    expect(press("p").prevented).toBe(true);
    expect(press("P").prevented).toBe(true);
    expect(events).toEqual(["pause", "pause", "pause"]);
  });

  it("still emits pause while paused but nothing else", () => {
    const { input, events, press } = make();
    input.setMode("paused");
    press("Escape");
    press(" ");
    press("ArrowDown");
    expect(events).toEqual(["pause"]);
  });

  it("board keys count as activity", () => {
    const { input, events, press } = make();
    input.setMode("play");
    press(" ");
    press("ArrowDown");
    expect(events).toEqual(["activity", "select", "activity", "cursorMove"]);
  });

  it("ignores every key when off or already handled", () => {
    const { input, events, press } = make();
    press("Escape");
    input.setMode("play");
    const e = keyEvent("p");
    (e as { defaultPrevented: boolean }).defaultPrevented = true;
    listeners.get("keydown")?.(e);
    expect(events).toEqual([]);
  });
});
