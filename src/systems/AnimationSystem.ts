// Per-token visual state and a small tween engine. Pure numbers, no canvas.
import { easeOutCubic } from "../utils/MathUtils";

export interface TokenVisual {
  /** Offset from the token's cell centre, in cell units. */
  x: number;
  y: number;
  scale: number;
  alpha: number;
  /** Radians. */
  rot: number;
  /** Extra glow strength added to the idle pulse, 0..1. */
  glow: number;
}

export type Easing = (t: number) => number;

export type TweenProps = Partial<TokenVisual>;

/** Numeric members of T that a tween may drive. */
export type NumericProps<T> = { [K in keyof T]?: T[K] extends number ? number : never };

export const linear: Easing = (t) => t;

interface Tween {
  target: Record<string, number>;
  keys: string[];
  from: number[];
  to: number[];
  delay: number;
  duration: number;
  elapsed: number;
  started: boolean;
  easing: Easing;
  resolve: () => void;
}

export function createVisual(): TokenVisual {
  return { x: 0, y: 0, scale: 1, alpha: 1, rot: 0, glow: 0 };
}

export class AnimationSystem {
  private visuals = new Map<number, TokenVisual>();
  private tweens: Tween[] = [];

  /** Visual for a token id, created with defaults when missing. */
  get(id: number): TokenVisual {
    let v = this.visuals.get(id);
    if (!v) {
      v = createVisual();
      this.visuals.set(id, v);
    }
    return v;
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  /** Apply props immediately, without a tween. */
  set(id: number, props: TweenProps): TokenVisual {
    const v = this.get(id);
    Object.assign(v, props);
    return v;
  }

  tween(id: number, props: TweenProps, durationMs: number, easing: Easing = easeOutCubic, delayMs = 0): Promise<void> {
    return this.tweenValue(this.get(id), props, durationMs, easing, delayMs);
  }

  /**
   * Tween numeric fields on any object. The start values are sampled when the
   * delay runs out, so a queued tween continues from wherever the object is then.
   */
  tweenValue<T extends object>(
    target: T,
    props: NumericProps<T>,
    durationMs: number,
    easing: Easing = easeOutCubic,
    delayMs = 0,
  ): Promise<void> {
    const obj = target as unknown as Record<string, number>;
    const keys: string[] = [];
    const to: number[] = [];
    for (const key of Object.keys(props)) {
      const value = (props as Record<string, number | undefined>)[key];
      if (typeof value === "number") {
        keys.push(key);
        to.push(value);
      }
    }
    if (keys.length === 0) return Promise.resolve();
    if (durationMs <= 0) {
      this.releaseKeys(obj, keys);
      for (let i = 0; i < keys.length; i++) obj[keys[i]] = to[i];
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const tw: Tween = {
        target: obj,
        keys,
        from: new Array<number>(keys.length).fill(0),
        to,
        delay: Math.max(0, delayMs),
        duration: durationMs,
        elapsed: 0,
        started: false,
        easing,
        resolve,
      };
      if (tw.delay <= 0) this.start(tw);
      this.tweens.push(tw);
    });
  }

  update(dt: number): void {
    if (this.tweens.length === 0) return;
    let write = 0;
    for (let i = 0; i < this.tweens.length; i++) {
      const tw = this.tweens[i];
      let step = dt;
      if (tw.delay > 0) {
        if (step < tw.delay) {
          tw.delay -= step;
          this.tweens[write++] = tw;
          continue;
        }
        step -= tw.delay;
        tw.delay = 0;
      }
      if (!tw.started) this.start(tw);
      tw.elapsed += step;
      const t = tw.elapsed >= tw.duration ? 1 : tw.elapsed / tw.duration;
      const e = t >= 1 ? 1 : tw.easing(t);
      for (let k = 0; k < tw.keys.length; k++) {
        tw.target[tw.keys[k]] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      }
      if (t >= 1) tw.resolve();
      else this.tweens[write++] = tw;
    }
    // Tweens that lost all their keys get resolved and dropped too.
    let out = 0;
    for (let i = 0; i < write; i++) {
      const tw = this.tweens[i];
      if (tw.keys.length === 0) tw.resolve();
      else this.tweens[out++] = tw;
    }
    this.tweens.length = out;
  }

  isBusy(): boolean {
    return this.tweens.length > 0;
  }

  get activeTweens(): number {
    return this.tweens.length;
  }

  /** Drop the visual and finish any tween on it at its target value. */
  removeVisual(id: number): void {
    const v = this.visuals.get(id);
    if (v) this.finishTweensOn(v);
    this.visuals.delete(id);
  }

  /** Jump every tween on a token to its end and resolve it. */
  finish(id: number): void {
    const v = this.visuals.get(id);
    if (v) this.finishTweensOn(v);
  }

  /** Finish every tween immediately (e.g. when leaving a level). */
  finishAll(): void {
    const pending = this.tweens;
    this.tweens = [];
    for (const tw of pending) {
      for (let k = 0; k < tw.keys.length; k++) tw.target[tw.keys[k]] = tw.to[k];
      tw.resolve();
    }
  }

  clear(): void {
    this.finishAll();
    this.visuals.clear();
  }

  forEachVisual(fn: (visual: TokenVisual, id: number) => void): void {
    this.visuals.forEach(fn);
  }

  /** Sample the start values now. A newer tween on the same keys wins over older ones. */
  private start(tw: Tween): void {
    tw.started = true;
    this.releaseKeys(tw.target, tw.keys, tw);
    for (let k = 0; k < tw.keys.length; k++) tw.from[k] = tw.target[tw.keys[k]];
  }

  private finishTweensOn(target: object): void {
    let write = 0;
    for (let i = 0; i < this.tweens.length; i++) {
      const tw = this.tweens[i];
      if (tw.target === target) {
        for (let k = 0; k < tw.keys.length; k++) tw.target[tw.keys[k]] = tw.to[k];
        tw.resolve();
      } else {
        this.tweens[write++] = tw;
      }
    }
    this.tweens.length = write;
  }

  /** Remove keys from other started tweens on the same target so they stop fighting. */
  private releaseKeys(target: object, keys: string[], except?: Tween): void {
    for (const tw of this.tweens) {
      if (tw === except || tw.target !== target || !tw.started) continue;
      for (const key of keys) {
        const idx = tw.keys.indexOf(key);
        if (idx < 0) continue;
        tw.keys.splice(idx, 1);
        tw.from.splice(idx, 1);
        tw.to.splice(idx, 1);
      }
    }
  }
}
