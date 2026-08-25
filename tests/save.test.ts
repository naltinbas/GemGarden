import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SAVE_KEY, TEXT_SCALE } from "../src/game/Config";
import { SAVE_VERSION, SaveManager, parseSaveData, type StorageLike } from "../src/game/SaveManager";

class FakeStorage implements StorageLike {
  readonly items = new Map<string, string>();
  writes = 0;

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes++;
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

class BrokenStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("no storage");
  }

  setItem(): void {
    throw new Error("quota");
  }

  removeItem(): void {
    throw new Error("no storage");
  }
}

describe("SaveManager", () => {
  it("starts fresh when nothing is stored", () => {
    const save = new SaveManager(new FakeStorage());
    expect(save.highestUnlocked).toBe(1);
    expect(save.isUnlocked(1)).toBe(true);
    expect(save.isUnlocked(2)).toBe(false);
    expect(save.isUnlocked(0)).toBe(false);
    expect(save.getProgress(1)).toEqual({ stars: 0, bestScore: 0, completed: false });
    expect(save.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("records a win, unlocks the next level and reloads it from storage", () => {
    const storage = new FakeStorage();
    const save = new SaveManager(storage);
    const first = save.recordResult(1, 4200, 2);
    expect(first).toEqual({ progress: { stars: 2, bestScore: 4200, completed: true }, isNewBest: true });
    expect(save.highestUnlocked).toBe(2);
    expect(save.isUnlocked(2)).toBe(true);
    expect(save.isUnlocked(3)).toBe(false);
    expect(storage.items.has(SAVE_KEY)).toBe(true);

    const again = new SaveManager(storage);
    expect(again.getProgress(1)).toEqual({ stars: 2, bestScore: 4200, completed: true });
    expect(again.highestUnlocked).toBe(2);
    expect(JSON.parse(storage.items.get(SAVE_KEY)!).version).toBe(SAVE_VERSION);
  });

  it("keeps the best score and star count and reports new bests", () => {
    const save = new SaveManager(new FakeStorage());
    save.recordResult(3, 5000, 3);
    const worse = save.recordResult(3, 3000, 1);
    expect(worse.isNewBest).toBe(false);
    expect(worse.progress).toEqual({ stars: 3, bestScore: 5000, completed: true });
    const better = save.recordResult(3, 6000, 2);
    expect(better.isNewBest).toBe(true);
    expect(save.getProgress(3)).toEqual({ stars: 3, bestScore: 6000, completed: true });
  });

  it("stores a failed attempt's score without completing or unlocking", () => {
    const save = new SaveManager(new FakeStorage());
    save.recordResult(1, 900, 0);
    expect(save.getProgress(1)).toEqual({ stars: 0, bestScore: 900, completed: false });
    expect(save.highestUnlocked).toBe(1);
  });

  it("never lowers highestUnlocked when a lower level is replayed", () => {
    const save = new SaveManager(new FakeStorage());
    save.recordResult(1, 100, 1);
    save.recordResult(2, 100, 1);
    save.recordResult(3, 100, 1);
    save.recordResult(1, 200, 1);
    expect(save.highestUnlocked).toBe(4);
  });

  it("merges stored settings over the defaults and persists updates", () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, settings: { sound: false, textScale: 1.25, bogus: 1 } }));
    const save = new SaveManager(storage);
    expect(save.settings).toEqual({ ...DEFAULT_SETTINGS, sound: false, textScale: 1.25 });

    const updated = save.updateSettings({ highContrast: true });
    expect(updated.highContrast).toBe(true);
    expect(updated.sound).toBe(false);
    expect(new SaveManager(storage).settings.highContrast).toBe(true);
    expect("bogus" in save.settings).toBe(false);
  });

  it("drops wrongly typed settings", () => {
    const data = parseSaveData(JSON.stringify({ version: 1, settings: { sound: "yes", textScale: -2, hints: 0 } }));
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("tolerates broken JSON and odd shapes", () => {
    for (const json of ["{not json", "42", "null", "[]", '"str"', JSON.stringify({ version: 1, levels: [1, 2] })]) {
      const storage = new FakeStorage();
      storage.setItem(SAVE_KEY, json);
      const save = new SaveManager(storage);
      expect(save.highestUnlocked).toBe(1);
      expect(save.getProgress(1).completed).toBe(false);
      expect(save.settings).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("sanitises level entries and derives highestUnlocked from completed levels", () => {
    const data = parseSaveData(
      JSON.stringify({
        version: 1,
        highestUnlocked: "nope",
        levels: {
          1: { stars: 9, bestScore: "x", completed: true },
          2: { stars: 1.7, bestScore: 1500.9 },
          abc: { stars: 3 },
          "-1": { stars: 3 },
          4: "junk",
        },
      }),
    );
    expect(data.levels).toEqual({
      1: { stars: 3, bestScore: 0, completed: true },
      2: { stars: 1, bestScore: 1500, completed: true },
    });
    expect(data.highestUnlocked).toBe(3);
  });

  it("discards progress from another schema version but keeps settings", () => {
    const storage = new FakeStorage();
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({ version: 2, highestUnlocked: 9, levels: { 1: { stars: 3, bestScore: 1, completed: true } }, settings: { ambient: true } }),
    );
    const save = new SaveManager(storage);
    expect(save.highestUnlocked).toBe(1);
    expect(save.getProgress(1).completed).toBe(false);
    expect(save.settings.ambient).toBe(true);
  });

  it("clamps a stored textScale into the slider's range", () => {
    for (const [stored, expected] of [
      [60, TEXT_SCALE.max],
      [0.1, TEXT_SCALE.min],
      [1.2, 1.2],
    ]) {
      const data = parseSaveData(JSON.stringify({ version: 1, settings: { textScale: stored } }));
      expect(data.settings.textScale).toBe(expected);
    }
    const save = new SaveManager(new FakeStorage());
    expect(save.updateSettings({ textScale: 9 }).textScale).toBe(TEXT_SCALE.max);
  });

  it("resets progress but keeps and persists settings", () => {
    const storage = new FakeStorage();
    const save = new SaveManager(storage);
    save.recordResult(1, 1000, 3);
    save.updateSettings({ sound: false, highContrast: true, textScale: 1.3 });
    save.reset();
    expect(save.highestUnlocked).toBe(1);
    expect(save.getProgress(1)).toEqual({ stars: 0, bestScore: 0, completed: false });
    expect(save.settings).toEqual({ ...DEFAULT_SETTINGS, sound: false, highContrast: true, textScale: 1.3 });

    const reloaded = new SaveManager(storage);
    expect(reloaded.highestUnlocked).toBe(1);
    expect(reloaded.getProgress(1).completed).toBe(false);
    expect(reloaded.settings).toEqual(save.settings);
  });

  it("works in memory when there is no storage at all", () => {
    const save = new SaveManager(null);
    expect(save.save()).toBe(false);
    save.recordResult(1, 100, 1);
    expect(save.isUnlocked(2)).toBe(true);
    expect(() => save.reset()).not.toThrow();
  });

  it("survives a storage that throws", () => {
    const save = new SaveManager(new BrokenStorage());
    expect(save.highestUnlocked).toBe(1);
    expect(save.save()).toBe(false);
    expect(() => save.recordResult(1, 100, 1)).not.toThrow();
    expect(save.isUnlocked(2)).toBe(true);
    expect(() => save.updateSettings({ hints: false })).not.toThrow();
    expect(save.settings.hints).toBe(false);
    expect(() => save.reset()).not.toThrow();
    expect(save.isUnlocked(2)).toBe(false);
  });

  it("returns copies so callers cannot mutate saved state", () => {
    const save = new SaveManager(new FakeStorage());
    save.recordResult(1, 100, 1);
    save.getProgress(1).stars = 3;
    save.settings.sound = false;
    expect(save.getProgress(1).stars).toBe(1);
    expect(save.settings.sound).toBe(true);
  });
});
