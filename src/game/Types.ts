// Shared data types. Board logic, rendering and UI all import from here so
// the modules agree on shapes without importing each other.

export type TokenColor = "ruby" | "azure" | "citrine" | "violet" | "jade" | "pearl";

export const ALL_TOKEN_COLORS: readonly TokenColor[] = [
  "ruby",
  "azure",
  "citrine",
  "violet",
  "jade",
  "pearl",
];

export type SpecialType = "none" | "lineHorizontal" | "lineVertical" | "burst" | "prism";

/** Gems match by color. Seeds never match; they only fall toward exit cells. */
export type TokenKind = "gem" | "seed";

export interface Token {
  /** Stable id so the renderer can track a token while it moves. */
  id: number;
  kind: TokenKind;
  /** null for seeds and for prism cores (which have no color). */
  color: TokenColor | null;
  special: SpecialType;
}

export type BlockerType = "stoneRoot" | "glassVine" | "lockedBud" | "shadowMist";

/**
 * stoneRoot  occupies the cell; the cell has no token while it stands.
 * glassVine  covers a token: token is visible and matchable but cannot be swapped.
 * lockedBud  seals a token: not swappable, not matchable; opened by an adjacent match or a special.
 * shadowMist hides a token: not swappable, not matchable; cleared like a bud, and spreads.
 */
export interface Blocker {
  type: BlockerType;
  hp: number;
  maxHp: number;
}

export type TerrainType = "moss";

export interface Terrain {
  type: TerrainType;
  layers: number;
  maxLayers: number;
}

export interface CellPosition {
  row: number;
  col: number;
}

export interface Cell {
  row: number;
  col: number;
  /** false = hole in the board shape. Never holds a token. */
  playable: boolean;
  token: Token | null;
  blocker: Blocker | null;
  /** Sits under the token. Loses a layer whenever the token on it is cleared. */
  terrain: Terrain | null;
  /** Seed exit. A seed that comes to rest here is delivered. */
  isExit: boolean;
}

export type Orientation = "horizontal" | "vertical" | "mixed";

export interface MatchGroup {
  cells: CellPosition[];
  orientation: Orientation;
  /** Longest straight run inside the group. */
  length: number;
  containsIntersection: boolean;
  color: TokenColor;
  /** Where two runs cross for T and L shapes. */
  intersection?: CellPosition;
}

export interface BoardConfig {
  rows: number;
  cols: number;
  tokenTypes: TokenColor[];
  /** Overwritten by the generator with LevelDefinition.allowedSpecials, which is authoritative. */
  allowedSpecials: SpecialType[];
}

// ---------------------------------------------------------------------------
// Level definitions

export type ObjectiveDefinition =
  | { type: "score"; target: number }
  | { type: "collect"; token: TokenColor; target: number }
  | { type: "clearTerrain"; target: number | "all" }
  | { type: "clearBlockers"; blocker: BlockerType; target: number | "all" }
  | { type: "deliverSeeds"; target: number };

export type ObjectiveType = ObjectiveDefinition["type"];

export interface TerrainDefinition {
  row: number;
  col: number;
  type: TerrainType;
  layers: number;
}

export interface BlockerDefinition {
  row: number;
  col: number;
  type: BlockerType;
  hp?: number;
}

export interface InitialTokenPlacement {
  row: number;
  col: number;
  kind?: TokenKind;
  color?: TokenColor;
  special?: SpecialType;
}

export interface SeedConfig {
  /** Columns where new seeds may enter at the top. */
  spawnCols: number[];
  exitCells: CellPosition[];
  /** How many seeds may be on the board at once. */
  maxOnBoard: number;
}

export interface LevelDefinition {
  id: number;
  name: string;
  /** One line shown on the level map. */
  flavor?: string;
  board: BoardConfig;
  moveLimit: number;
  objectives: ObjectiveDefinition[];
  holes?: CellPosition[];
  terrain?: TerrainDefinition[];
  blockers?: BlockerDefinition[];
  initialTokens?: InitialTokenPlacement[];
  seeds?: SeedConfig;
  allowedSpecials: SpecialType[];
  starThresholds: [number, number, number];
  tutorialMessage?: string;
  /** If true, one moss patch grows each move in which no moss was cleared. */
  mossSpreads?: boolean;
  /** Fixed RNG seed for reproducible boards. Random when omitted. */
  seed?: number;
}

// ---------------------------------------------------------------------------
// Results handed from board logic to the game loop / renderer

export type ComboKind =
  | "none"
  | "single"
  | "beamBeam"
  | "beamBurst"
  | "burstBurst"
  | "prismColor"
  | "prismBeam"
  | "prismBurst"
  | "prismPrism";

export interface SpecialActivation {
  at: CellPosition;
  type: SpecialType;
  combo: ComboKind;
  /** Cells this activation reaches (before merging with other clears). */
  cells: CellPosition[];
  color?: TokenColor;
  /** For beams: which lines were cleared, so the renderer can draw them. */
  lines?: { orientation: "horizontal" | "vertical"; index: number }[];
  /** For bursts: centre + radius. */
  radius?: number;
}

export interface SpecialCreation {
  at: CellPosition;
  type: SpecialType;
  color: TokenColor | null;
  /** The token that became the special. Same id it had before, mutated in place. */
  token: Token;
}

export interface BlockerHit {
  at: CellPosition;
  type: BlockerType;
  remainingHp: number;
  destroyed: boolean;
}

export interface TerrainHit {
  at: CellPosition;
  remainingLayers: number;
}

export interface ScoreEvent {
  at: CellPosition;
  points: number;
  label?: string;
}

export interface ClearedToken {
  token: Token;
  at: CellPosition;
}

/** One round of clearing: matches + special effects + damage, applied to the board. */
export interface ClearStep {
  cascadeIndex: number;
  groups: MatchGroup[];
  cleared: ClearedToken[];
  created: SpecialCreation[];
  activations: SpecialActivation[];
  blockerHits: BlockerHit[];
  terrainHits: TerrainHit[];
  scoreGained: number;
  scoreEvents: ScoreEvent[];
  /** 0 = none, up to 1 for board-wide effects. */
  shake: number;
}

export interface TokenMove {
  token: Token;
  /** For spawned tokens this is above the top of the column segment: segmentTop - k, which may be >= 0. */
  from: CellPosition;
  to: CellPosition;
  /** True when the token was created this step and entered from above its segment. */
  spawned: boolean;
}

export interface SeedDelivery {
  token: Token;
  at: CellPosition;
}

export interface FallStep {
  /** One entry per token that moved, from its position at step start to its final resting cell. */
  moves: TokenMove[];
  /** Seeds that reached an exit. Each also has a move ending on the exit cell. */
  delivered: SeedDelivery[];
  scoreGained: number;
  scoreEvents: ScoreEvent[];
}

export interface SpreadEvent {
  at: CellPosition;
  kind: "moss" | "shadowMist";
}

export interface SwapOutcome {
  valid: boolean;
  a: CellPosition;
  b: CellPosition;
  combo: ComboKind;
  /** Special activations triggered directly by the swap, fed into the first clear step. */
  activations: SpecialActivation[];
}

// ---------------------------------------------------------------------------
// Game / UI state

export type GameState =
  | "MAIN_MENU"
  | "LEVEL_SELECT"
  | "LEVEL_INTRO"
  | "PLAYER_INPUT"
  | "SWAPPING"
  | "RESOLVING_MATCHES"
  | "FALLING"
  | "REFILLING"
  | "RESHUFFLING"
  | "PAUSED"
  | "LEVEL_COMPLETE"
  | "LEVEL_FAILED";

export interface Settings {
  sound: boolean;
  ambient: boolean;
  hints: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  textScale: number;
  showGridCoords: boolean;
}

export interface LevelProgress {
  stars: number;
  bestScore: number;
  completed: boolean;
}

export interface SaveData {
  version: number;
  highestUnlocked: number;
  levels: Record<number, LevelProgress>;
  settings: Settings;
}

export interface ObjectiveStatus {
  type: ObjectiveType;
  label: string;
  progress: number;
  target: number;
  complete: boolean;
  /** Token color for collect objectives, blocker/terrain type otherwise. */
  icon: string;
}

export interface LevelResult {
  levelId: number;
  won: boolean;
  score: number;
  bestScore: number;
  stars: number;
  movesLeft: number;
  objectives: ObjectiveStatus[];
  isNewBest: boolean;
}
