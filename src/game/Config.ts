import type { BlockerType, SpecialType, TokenColor } from "./Types";

export const SCORE = {
  tokenMatch: 60,
  extraTokenInMatch: 25,
  cascadeMultiplierStep: 0.5,
  specialCreated: 150,
  specialActivated: 250,
  specialClearedToken: 30,
  blockerDamage: 100,
  blockerDestroyed: 250,
  terrainCleared: 80,
  seedDelivered: 400,
  objectiveCompleted: 500,
  levelCompletionMoveBonus: 300,
};

/** Animation durations in milliseconds. */
export const TIMING = {
  swap: 170,
  swapBack: 170,
  clear: 240,
  specialActivate: 320,
  fallPerCell: 60,
  fallMin: 140,
  fallMax: 420,
  spawnDelayPerRow: 25,
  reshuffle: 700,
  levelIntro: 900,
  hintDelay: 7000,
  hintPulse: 900,
  toast: 1600,
  maxDeltaMs: 50,
};

export const RULES = {
  burstRadius: 1,
  bigBurstRadius: 2,
  /** Beam + burst clears this many rows and columns around the swap. */
  beamBurstSpan: 3,
  minMatch: 3,
  beamMatch: 4,
  prismMatch: 5,
  maxGenerationAttempts: 200,
  maxReshuffleAttempts: 60,
  defaultBoard: { rows: 8, cols: 8 },
};

export interface TokenStyle {
  name: string;
  /** Short label used in HUD text and aria labels. */
  short: string;
  fill: string;
  light: string;
  dark: string;
  edge: string;
  glow: string;
  /** Letter drawn in high-contrast mode. */
  letter: string;
}

export const TOKEN_STYLE: Record<TokenColor, TokenStyle> = {
  ruby: {
    name: "Ruby Bloom",
    short: "Ruby",
    fill: "#e63b5a",
    light: "#ff8aa0",
    dark: "#8f1430",
    edge: "#5c0a1e",
    glow: "rgba(255, 90, 120, 0.55)",
    letter: "R",
  },
  azure: {
    name: "Azure Droplet",
    short: "Azure",
    fill: "#2f8de8",
    light: "#8fd0ff",
    dark: "#12448f",
    edge: "#0a2a5e",
    glow: "rgba(90, 170, 255, 0.55)",
    letter: "A",
  },
  citrine: {
    name: "Citrine Seed",
    short: "Citrine",
    fill: "#f2b52a",
    light: "#ffe58a",
    dark: "#9a6a08",
    edge: "#5e4004",
    glow: "rgba(255, 210, 90, 0.55)",
    letter: "C",
  },
  violet: {
    name: "Violet Petal",
    short: "Violet",
    fill: "#8e4fe0",
    light: "#d2a8ff",
    dark: "#4a1f8a",
    edge: "#2c0f57",
    glow: "rgba(190, 130, 255, 0.55)",
    letter: "V",
  },
  jade: {
    name: "Jade Leaf",
    short: "Jade",
    fill: "#2ebd6b",
    light: "#9cf0bd",
    dark: "#0f6b39",
    edge: "#084324",
    glow: "rgba(110, 240, 160, 0.55)",
    letter: "J",
  },
  pearl: {
    name: "Pearl Moonstone",
    short: "Pearl",
    fill: "#e9e6f2",
    light: "#ffffff",
    dark: "#9d97b8",
    edge: "#5c5678",
    glow: "rgba(240, 235, 255, 0.6)",
    letter: "P",
  },
};

export const SPECIAL_NAMES: Record<Exclude<SpecialType, "none">, string> = {
  lineHorizontal: "Vine Beam",
  lineVertical: "Vine Beam",
  burst: "Bloom Burst",
  prism: "Prism Core",
};

export const BLOCKER_NAMES: Record<BlockerType, string> = {
  stoneRoot: "Stone Root",
  glassVine: "Glass Vine",
  lockedBud: "Locked Bud",
  shadowMist: "Shadow Mist",
};

export const TERRAIN_NAME = "Crystal Moss";
export const SEED_NAME = "Sun Seed";

/** Label shown for cascade index 1, 2, 3... (index 0 is the player's own match). */
export const CASCADE_LABELS = [
  "",
  "Bloom Chain x1.5",
  "Bloom Chain x2",
  "Garden Cascade x2.5",
  "Garden Cascade x3",
  "Petal Storm x3.5",
  "Petal Storm x4",
];

export function cascadeLabel(index: number): string {
  if (index <= 0) return "";
  if (index < CASCADE_LABELS.length) return CASCADE_LABELS[index];
  return `Petal Storm x${1 + index * SCORE.cascadeMultiplierStep}`;
}

export const SAVE_KEY = "gemgarden.save.v1";

export const DEFAULT_SETTINGS = {
  sound: true,
  ambient: false,
  hints: true,
  highContrast: false,
  reducedMotion: false,
  textScale: 1,
  showGridCoords: false,
};
