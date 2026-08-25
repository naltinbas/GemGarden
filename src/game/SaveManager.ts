import type { LevelProgress, SaveData, Settings } from "./Types";
import { DEFAULT_SETTINGS, SAVE_KEY } from "./Config";

export const SAVE_VERSION = 1;

/** The slice of the Storage API we use, so tests can hand in a plain object. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!storage) return null;
    storage.getItem(SAVE_KEY);
    return storage;
  } catch {
    return null;
  }
}

function defaultProgress(): LevelProgress {
  return { stars: 0, bestScore: 0, completed: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function readSettings(raw: unknown): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (!isRecord(raw)) return settings;
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    const value = raw[key];
    if (key === "textScale") {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) settings.textScale = value;
    } else if (typeof value === "boolean") {
      settings[key] = value;
    }
  }
  return settings;
}

function readProgress(raw: unknown): Record<number, LevelProgress> {
  const levels: Record<number, LevelProgress> = {};
  if (!isRecord(raw)) return levels;
  for (const key of Object.keys(raw)) {
    const id = Number(key);
    const entry = raw[key];
    if (!Number.isInteger(id) || id <= 0 || !isRecord(entry)) continue;
    const stars = Math.min(3, asInt(entry.stars, 0));
    levels[id] = {
      stars,
      bestScore: asInt(entry.bestScore, 0),
      completed: entry.completed === true || stars > 0,
    };
  }
  return levels;
}

export function emptySaveData(): SaveData {
  return { version: SAVE_VERSION, highestUnlocked: 1, levels: {}, settings: { ...DEFAULT_SETTINGS } };
}

/** Parses stored JSON into a valid SaveData, falling back to defaults for anything malformed. */
export function parseSaveData(json: string | null): SaveData {
  const data = emptySaveData();
  if (!json) return data;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return data;
  }
  if (!isRecord(raw)) return data;
  data.settings = readSettings(raw.settings);
  if (raw.version !== SAVE_VERSION) return data;
  data.levels = readProgress(raw.levels);
  let highest = asInt(raw.highestUnlocked, 1);
  for (const key of Object.keys(data.levels)) {
    const id = Number(key);
    if (data.levels[id].completed) highest = Math.max(highest, id + 1);
  }
  data.highestUnlocked = Math.max(1, highest);
  return data;
}

export class SaveManager {
  private readonly storage: StorageLike | null;
  private data: SaveData;

  constructor(storage: StorageLike | null = browserStorage()) {
    this.storage = storage;
    this.data = this.load();
  }

  load(): SaveData {
    let json: string | null = null;
    try {
      json = this.storage ? this.storage.getItem(SAVE_KEY) : null;
    } catch {
      json = null;
    }
    this.data = parseSaveData(json);
    return this.data;
  }

  save(): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  get highestUnlocked(): number {
    return this.data.highestUnlocked;
  }

  get settings(): Settings {
    return { ...this.data.settings };
  }

  getProgress(id: number): LevelProgress {
    const p = this.data.levels[id];
    return p ? { ...p } : defaultProgress();
  }

  isUnlocked(id: number): boolean {
    return id >= 1 && id <= this.data.highestUnlocked;
  }

  /** Stars above zero count as a win and unlock the next level. Returns the updated entry. */
  recordResult(id: number, score: number, stars: number): { progress: LevelProgress; isNewBest: boolean } {
    const prev = this.data.levels[id] ?? defaultProgress();
    const won = stars > 0;
    const isNewBest = score > prev.bestScore;
    const progress: LevelProgress = {
      stars: Math.max(prev.stars, Math.min(3, Math.floor(stars))),
      bestScore: Math.max(prev.bestScore, Math.floor(score)),
      completed: prev.completed || won,
    };
    this.data.levels[id] = progress;
    if (won) this.data.highestUnlocked = Math.max(this.data.highestUnlocked, id + 1);
    this.save();
    return { progress: { ...progress }, isNewBest };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = readSettings({ ...this.data.settings, ...patch });
    this.save();
    return this.settings;
  }

  reset(): void {
    this.data = emptySaveData();
    if (!this.storage) return;
    try {
      this.storage.removeItem(SAVE_KEY);
    } catch {
      // Nothing to do; the in-memory state is already clean.
    }
  }
}
