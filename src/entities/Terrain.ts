import type { Terrain, TerrainType } from "../game/Types";

export function createTerrain(layers: number, type: TerrainType = "moss"): Terrain {
  return { type, layers, maxLayers: layers };
}

export function cloneTerrain(terrain: Terrain): Terrain {
  return { type: terrain.type, layers: terrain.layers, maxLayers: terrain.maxLayers };
}
