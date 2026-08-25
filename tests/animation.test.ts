import { describe, expect, it } from "vitest";
import { AnimationSystem, linear } from "../src/systems/AnimationSystem";
import { ParticleSystem } from "../src/systems/ParticleSystem";

function settled(p: Promise<void>): { done: boolean; promise: Promise<void> } {
  const state = { done: false, promise: p };
  p.then(() => {
    state.done = true;
  });
  return state;
}

describe("AnimationSystem", () => {
  it("creates default visuals on first get", () => {
    const anim = new AnimationSystem();
    expect(anim.has(7)).toBe(false);
    const v = anim.get(7);
    expect(v).toEqual({ x: 0, y: 0, scale: 1, alpha: 1, rot: 0, glow: 0 });
    expect(anim.get(7)).toBe(v);
    expect(anim.has(7)).toBe(true);
  });

  it("tweens linearly to the target and settles the promise", async () => {
    const anim = new AnimationSystem();
    const state = settled(anim.tween(1, { x: 1, scale: 0 }, 100, linear));
    expect(anim.isBusy()).toBe(true);
    anim.update(50);
    expect(anim.get(1).x).toBeCloseTo(0.5);
    expect(anim.get(1).scale).toBeCloseTo(0.5);
    await Promise.resolve();
    expect(state.done).toBe(false);
    anim.update(60);
    expect(anim.get(1).x).toBe(1);
    expect(anim.get(1).scale).toBe(0);
    expect(anim.isBusy()).toBe(false);
    await state.promise;
    expect(state.done).toBe(true);
  });

  it("applies easing on the way and lands exactly on the target", () => {
    const anim = new AnimationSystem();
    anim.tween(1, { y: -2 }, 200);
    anim.update(100);
    const mid = anim.get(1).y;
    expect(mid).toBeLessThan(0);
    expect(mid).toBeGreaterThan(-2);
    expect(mid).not.toBeCloseTo(-1, 3);
    anim.update(100);
    expect(anim.get(1).y).toBe(-2);
  });

  it("resolves immediately when duration is zero or negative", async () => {
    const anim = new AnimationSystem();
    const a = settled(anim.tween(1, { alpha: 0 }, 0));
    const b = settled(anim.tween(2, { x: 3 }, -10, linear, 500));
    expect(anim.get(1).alpha).toBe(0);
    expect(anim.get(2).x).toBe(3);
    expect(anim.isBusy()).toBe(false);
    await Promise.all([a.promise, b.promise]);
    expect(a.done && b.done).toBe(true);
  });

  it("waits for the delay before sampling the start value", () => {
    const anim = new AnimationSystem();
    anim.tween(1, { x: 1 }, 100, linear, 100);
    anim.update(50);
    expect(anim.get(1).x).toBe(0);
    anim.get(1).x = 0.5;
    anim.update(100);
    // 50ms into the tween, from 0.5 to 1.
    expect(anim.get(1).x).toBeCloseTo(0.75);
    anim.update(50);
    expect(anim.get(1).x).toBe(1);
  });

  it("lets a newer tween take over shared keys and resolves the older one", async () => {
    const anim = new AnimationSystem();
    const first = settled(anim.tween(1, { x: 1, y: 1 }, 100, linear));
    anim.update(50);
    const second = settled(anim.tween(1, { x: 0 }, 100, linear));
    anim.update(50);
    // y finished with the first tween; x is now driven only by the second.
    expect(anim.get(1).y).toBe(1);
    expect(anim.get(1).x).toBeCloseTo(0.25);
    await first.promise;
    expect(first.done).toBe(true);
    anim.update(50);
    expect(anim.get(1).x).toBe(0);
    await second.promise;
    expect(second.done).toBe(true);
    expect(anim.isBusy()).toBe(false);
  });

  it("tweens plain objects with tweenValue", async () => {
    const anim = new AnimationSystem();
    const target = { value: 10, label: "x" };
    const p = anim.tweenValue(target, { value: 20 }, 40, linear);
    anim.update(20);
    expect(target.value).toBeCloseTo(15);
    anim.update(20);
    expect(target.value).toBe(20);
    expect(target.label).toBe("x");
    await p;
  });

  it("removeVisual finishes pending tweens and drops the visual", async () => {
    const anim = new AnimationSystem();
    const p = settled(anim.tween(3, { scale: 2 }, 1000));
    anim.update(10);
    anim.removeVisual(3);
    expect(anim.has(3)).toBe(false);
    expect(anim.isBusy()).toBe(false);
    await p.promise;
    expect(p.done).toBe(true);
  });

  it("finishAll jumps every tween to its end", () => {
    const anim = new AnimationSystem();
    anim.tween(1, { x: 1 }, 500);
    anim.tween(2, { rot: 6 }, 500, linear, 200);
    anim.finishAll();
    expect(anim.get(1).x).toBe(1);
    expect(anim.get(2).rot).toBe(6);
    expect(anim.isBusy()).toBe(false);
  });
});

describe("ParticleSystem", () => {
  it("never holds more live particles than its capacity", () => {
    const ps = new ParticleSystem(50, () => 0.5);
    for (let i = 0; i < 20; i++) ps.emit(0, 0, { count: 40 });
    expect(ps.activeCount).toBe(50);
    let seen = 0;
    ps.forEach(() => seen++);
    expect(seen).toBe(50);
  });

  it("moves particles and retires them when their life runs out", () => {
    const ps = new ParticleSystem(10, () => 0.5);
    ps.emit(5, 5, { count: 4, speed: 100, life: 100, gravity: 0, spread: 0, direction: 0 });
    expect(ps.activeCount).toBe(4);
    ps.update(50);
    ps.forEach((p) => {
      expect(p.x).toBeGreaterThan(5);
      expect(p.y).toBeCloseTo(5);
    });
    ps.update(100);
    expect(ps.activeCount).toBe(0);
  });

  it("reuses the same particle objects instead of allocating", () => {
    const ps = new ParticleSystem(8, () => 0.1);
    ps.emit(0, 0, { count: 8, life: 100 });
    const before = new Set<object>();
    ps.forEach((p) => before.add(p));
    ps.update(200);
    expect(ps.activeCount).toBe(0);
    ps.emit(1, 1, { count: 8, life: 100 });
    ps.forEach((p) => expect(before.has(p)).toBe(true));
  });

  it("applies gravity and clear()", () => {
    const ps = new ParticleSystem(4, () => 0.5);
    ps.emit(0, 0, { count: 1, speed: 0, gravity: 1000, life: 1000 });
    ps.update(500);
    let vy = 0;
    ps.forEach((p) => (vy = p.vy));
    expect(vy).toBeCloseTo(500);
    ps.clear();
    expect(ps.activeCount).toBe(0);
  });
});
