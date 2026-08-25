import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AudioManager } from "../src/game/AudioManager";

type State = "suspended" | "running" | "closed" | "interrupted";

let instances: FakeContext[] = [];

class FakeContext {
  state: State = "suspended";
  resumes = 0;
  currentTime = 0;
  destination = {};

  constructor() {
    instances.push(this);
  }

  resume(): Promise<void> {
    this.resumes++;
    this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }

  createGain(): unknown {
    return { gain: { value: 1, setTargetAtTime: () => undefined }, connect: () => undefined };
  }
}

const g = globalThis as { AudioContext?: unknown };
let saved: unknown;

beforeEach(() => {
  instances = [];
  saved = g.AudioContext;
  g.AudioContext = FakeContext;
});

afterEach(() => {
  g.AudioContext = saved;
});

describe("AudioManager unlock and resume", () => {
  it("creates one context and resumes it once per pause", () => {
    const audio = new AudioManager();
    expect(audio.available).toBe(true);
    audio.unlock();
    audio.unlock();
    expect(instances.length).toBe(1);
    const ctx = instances[0];
    expect(ctx.resumes).toBe(1);
    expect(audio.unlocked).toBe(true);

    // Idempotent while running.
    audio.unlock();
    audio.resume();
    expect(ctx.resumes).toBe(1);
  });

  it("resumes again after the browser suspends or interrupts the context", () => {
    const audio = new AudioManager();
    audio.unlock();
    const ctx = instances[0];
    ctx.state = "suspended";
    expect(audio.unlocked).toBe(false);
    audio.unlock();
    expect(ctx.resumes).toBe(2);
    expect(audio.unlocked).toBe(true);

    ctx.state = "interrupted";
    audio.resume();
    expect(ctx.resumes).toBe(3);
    expect(ctx.state).toBe("running");
  });

  it("leaves a closed context alone", () => {
    const audio = new AudioManager();
    audio.unlock();
    const ctx = instances[0];
    ctx.state = "closed";
    audio.resume();
    audio.unlock();
    expect(ctx.resumes).toBe(1);
  });

  it("resume is a no-op before the first gesture", () => {
    const audio = new AudioManager();
    audio.resume();
    expect(instances.length).toBe(0);
  });
});
