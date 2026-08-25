import type { CellPosition, LevelDefinition, SpecialType, TerrainDefinition, TokenColor } from "../game/Types";

const FIVE: TokenColor[] = ["ruby", "azure", "citrine", "violet", "jade"];
const SIX: TokenColor[] = ["ruby", "azure", "citrine", "violet", "jade", "pearl"];

const BEAMS: SpecialType[] = ["lineHorizontal", "lineVertical"];
const BEAMS_BURST: SpecialType[] = [...BEAMS, "burst"];
const ALL_SPECIALS: SpecialType[] = [...BEAMS_BURST, "prism"];

function board(tokenTypes: TokenColor[], rows = 8, cols = 8) {
  return { rows, cols, tokenTypes, allowedSpecials: [] as SpecialType[] };
}

function at(row: number, col: number): CellPosition {
  return { row, col };
}

function moss(layers: number, ...cells: [number, number][]): TerrainDefinition[] {
  return cells.map(([row, col]) => ({ row, col, type: "moss", layers }));
}

/** Every cell of one row. Seeds are delivered anywhere along the soil, so a seed swapped sideways is never lost. */
function exitRow(row: number, cols: number): CellPosition[] {
  const out: CellPosition[] = [];
  for (let c = 0; c < cols; c++) out.push(at(row, c));
  return out;
}

/** Twelve handcrafted levels. Seeds are fixed so a level always opens on the same board. */
export const LEVELS: LevelDefinition[] = [
  {
    id: 1,
    name: "Dew Terrace",
    flavor: "Morning light on the first bed of the greenhouse.",
    board: board(FIVE),
    moveLimit: 20,
    objectives: [{ type: "score", target: 4000 }],
    allowedSpecials: [],
    starThresholds: [4000, 7500, 10500],
    tutorialMessage: "Swap two neighbouring gems to line up three of a kind.",
    seed: 101,
  },
  {
    id: 2,
    name: "Moss Steps",
    flavor: "Worn stone steps, soft with green.",
    board: board(SIX),
    moveLimit: 22,
    objectives: [{ type: "score", target: 5000 }],
    allowedSpecials: BEAMS,
    starThresholds: [5000, 8500, 11500],
    tutorialMessage: "Match four in a line to grow a Vine Beam. Swap it to clear its whole row or column.",
    seed: 202,
  },
  {
    id: 3,
    name: "Fern Hollow",
    flavor: "Cool shade where the jade leaves unfurl.",
    board: board(SIX),
    moveLimit: 22,
    objectives: [{ type: "collect", token: "jade", target: 20 }],
    allowedSpecials: BEAMS,
    starThresholds: [4500, 9000, 13500],
    tutorialMessage: "Gather Jade Leaves by matching them. Every jade cleared counts.",
    seed: 303,
  },
  {
    id: 4,
    name: "Mossy Nook",
    flavor: "A ring of crystal moss has crept across the bed.",
    board: board(SIX),
    moveLimit: 26,
    objectives: [
      { type: "collect", token: "azure", target: 16 },
      { type: "clearTerrain", target: "all" },
    ],
    terrain: moss(1, [2, 2], [2, 3], [2, 4], [2, 5], [3, 1], [3, 6], [4, 1], [4, 6], [5, 2], [5, 3], [5, 4], [5, 5]),
    allowedSpecials: BEAMS,
    starThresholds: [6000, 11000, 16500],
    tutorialMessage: "Match on Crystal Moss to clear it away. Every patch must go.",
    seed: 404,
  },
  {
    id: 5,
    name: "Beam Walk",
    flavor: "Two vines are already reaching for the light.",
    board: board(SIX),
    moveLimit: 24,
    objectives: [
      { type: "score", target: 6000 },
      { type: "collect", token: "ruby", target: 15 },
    ],
    initialTokens: [
      { row: 2, col: 1, special: "lineVertical" },
      { row: 5, col: 6, special: "lineHorizontal" },
    ],
    allowedSpecials: BEAMS,
    starThresholds: [6000, 10000, 13500],
    tutorialMessage: "Two Vine Beams are already growing. Swap one with any neighbour to fire it.",
    seed: 505,
  },
  {
    id: 6,
    name: "Twin Bloom Beds",
    flavor: "Two raised beds, both buried under thick moss.",
    board: board(SIX),
    moveLimit: 34,
    objectives: [
      { type: "collect", token: "citrine", target: 12 },
      { type: "collect", token: "violet", target: 12 },
      { type: "clearTerrain", target: "all" },
    ],
    terrain: [...moss(2, [4, 2], [5, 2], [4, 5], [5, 5]), ...moss(1, [4, 1], [5, 1], [4, 6], [5, 6])],
    allowedSpecials: BEAMS,
    starThresholds: [8000, 17500, 22000],
    tutorialMessage: "Thick moss takes two matches to clear.",
    seed: 606,
  },
  {
    id: 7,
    name: "Root Cellar",
    flavor: "Old stone roots have pushed up through the soil.",
    board: board(SIX),
    moveLimit: 26,
    objectives: [{ type: "clearBlockers", blocker: "stoneRoot", target: "all" }],
    blockers: [
      { row: 3, col: 2, type: "stoneRoot" },
      { row: 3, col: 5, type: "stoneRoot" },
      { row: 5, col: 1, type: "stoneRoot" },
      { row: 5, col: 6, type: "stoneRoot" },
      { row: 6, col: 3, type: "stoneRoot" },
      { row: 6, col: 4, type: "stoneRoot" },
    ],
    allowedSpecials: BEAMS_BURST,
    starThresholds: [7000, 12000, 16500],
    tutorialMessage: "Match in an L or T shape to grow a Bloom Burst. Stone Roots crack when you match beside them.",
    seed: 707,
  },
  {
    id: 8,
    name: "Glasshouse Row",
    flavor: "Glass vines have wound themselves around the gems.",
    board: board(SIX),
    moveLimit: 28,
    objectives: [
      { type: "clearBlockers", blocker: "glassVine", target: "all" },
      { type: "collect", token: "pearl", target: 12 },
    ],
    blockers: [
      { row: 3, col: 1, type: "glassVine" },
      { row: 3, col: 2, type: "glassVine" },
      { row: 3, col: 3, type: "glassVine" },
      { row: 3, col: 4, type: "glassVine" },
      { row: 3, col: 5, type: "glassVine" },
      { row: 3, col: 6, type: "glassVine" },
      { row: 5, col: 2, type: "glassVine" },
      { row: 5, col: 5, type: "glassVine" },
    ],
    allowedSpecials: BEAMS_BURST,
    starThresholds: [7000, 16000, 19500],
    tutorialMessage: "A Glass Vine holds its gem in place. Match that gem to shatter the vine.",
    seed: 808,
  },
  {
    id: 9,
    name: "Seedfall Path",
    flavor: "Sun seeds drift down toward the warm soil.",
    board: board(SIX),
    moveLimit: 32,
    objectives: [{ type: "deliverSeeds", target: 2 }],
    seeds: { spawnCols: [2, 5], exitCells: exitRow(7, 8), maxOnBoard: 2 },
    allowedSpecials: BEAMS_BURST,
    starThresholds: [5000, 10000, 15000],
    tutorialMessage: "Guide each Sun Seed down to the soil at the bottom. Match beneath it, or swap it straight down.",
    seed: 909,
  },
  {
    id: 10,
    name: "Bud Terrace",
    flavor: "Locked buds sit on the deepest moss in the garden.",
    board: board(SIX),
    moveLimit: 26,
    objectives: [
      { type: "score", target: 10000 },
      { type: "clearTerrain", target: "all" },
    ],
    terrain: [
      ...moss(2, [2, 3], [2, 4], [4, 2], [4, 5]),
      ...moss(1, [3, 2], [3, 5], [4, 3], [4, 4], [5, 2], [5, 5]),
    ],
    blockers: [
      { row: 2, col: 3, type: "lockedBud" },
      { row: 2, col: 4, type: "lockedBud" },
      { row: 4, col: 2, type: "lockedBud" },
      { row: 4, col: 5, type: "lockedBud" },
    ],
    allowedSpecials: ALL_SPECIALS,
    starThresholds: [10000, 14500, 18000],
    tutorialMessage: "Match five in a line to form a Prism Core. Locked Buds open when you match beside them.",
    seed: 1010,
  },
  {
    id: 11,
    name: "Mist Garden",
    flavor: "A shadow mist pools in the middle of the round bed.",
    board: board(SIX),
    moveLimit: 20,
    objectives: [{ type: "clearBlockers", blocker: "shadowMist", target: "all" }],
    holes: [
      at(0, 0), at(0, 1), at(1, 0),
      at(0, 6), at(0, 7), at(1, 7),
      at(6, 0), at(7, 0), at(7, 1),
      at(6, 7), at(7, 6), at(7, 7),
    ],
    blockers: [
      { row: 3, col: 3, type: "shadowMist" },
      { row: 3, col: 4, type: "shadowMist" },
      { row: 4, col: 3, type: "shadowMist" },
      { row: 4, col: 4, type: "shadowMist" },
      { row: 2, col: 2, type: "shadowMist" },
      { row: 2, col: 5, type: "shadowMist" },
      { row: 5, col: 2, type: "shadowMist" },
      { row: 5, col: 5, type: "shadowMist" },
    ],
    allowedSpecials: ALL_SPECIALS,
    starThresholds: [4000, 11000, 13500],
    tutorialMessage: "Shadow Mist spreads when left alone. Match beside it to burn it off.",
    seed: 1111,
  },
  {
    id: 12,
    name: "Grand Conservatory",
    flavor: "Everything the garden has learned, under one glass roof.",
    board: board(SIX),
    moveLimit: 36,
    objectives: [
      { type: "deliverSeeds", target: 2 },
      { type: "clearBlockers", blocker: "stoneRoot", target: "all" },
      { type: "clearTerrain", target: "all" },
    ],
    holes: [at(0, 0), at(0, 7)],
    terrain: moss(2, [4, 2], [4, 3], [4, 4], [4, 5]),
    blockers: [
      { row: 2, col: 2, type: "stoneRoot" },
      { row: 5, col: 1, type: "stoneRoot" },
      { row: 5, col: 6, type: "stoneRoot" },
      { row: 3, col: 1, type: "lockedBud" },
      { row: 3, col: 6, type: "lockedBud" },
      { row: 6, col: 2, type: "glassVine" },
      { row: 6, col: 5, type: "glassVine" },
    ],
    seeds: { spawnCols: [3, 4], exitCells: exitRow(7, 8), maxOnBoard: 2 },
    allowedSpecials: ALL_SPECIALS,
    starThresholds: [9000, 16000, 23000],
    tutorialMessage: "Seeds, roots and moss all at once. Take the moves as they come.",
    seed: 1212,
  },
];
