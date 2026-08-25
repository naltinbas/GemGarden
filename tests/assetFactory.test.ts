import { describe, expect, it } from "vitest";
import { ALL_TOKEN_COLORS, type BlockerType, type SpecialType } from "../src/game/Types";
import { AssetFactory, assetKey, tokenKey, type Sprite } from "../src/render/AssetFactory";

/** Records every context method called; property sets are accepted and ignored. */
function stubCanvasFactory(calls: string[]) {
  const ctxStub: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "measureText") return () => ({ width: 10 });
        return (...args: unknown[]) => {
          calls.push(String(prop));
          void args;
          return ctxStub;
        };
      },
      set() {
        return true;
      },
    },
  );
  return (width: number, height: number): Sprite =>
    ({ width, height, getContext: () => ctxStub }) as unknown as Sprite;
}

const SPECIALS: SpecialType[] = ["none", "lineHorizontal", "lineVertical", "burst", "prism"];
const BLOCKERS: BlockerType[] = ["stoneRoot", "glassVine", "lockedBud", "shadowMist"];

describe("asset keys", () => {
  it("tokenKey is stable and follows color|special|size|hc", () => {
    expect(tokenKey("ruby", "none", 48, false)).toBe("ruby|none|48|false");
    expect(tokenKey("ruby", "none", 48, false)).toBe(tokenKey("ruby", "none", 48, false));
    expect(tokenKey(null, "prism", 64, true)).toBe("prism|prism|64|true");
    expect(tokenKey("jade", "burst", 32, true)).not.toBe(tokenKey("jade", "burst", 32, false));
  });

  it("assetKey joins parts deterministically", () => {
    expect(assetKey("moss", 2, 40, false)).toBe("moss:2|40|false");
    expect(assetKey("glow", null, 40)).toBe("glow:null|40");
  });
});

describe("AssetFactory", () => {
  it("caches sprites by key and clears on clearCache", () => {
    const factory = new AssetFactory(stubCanvasFactory([]));
    const a = factory.tokenSprite("ruby", "none", 48, false);
    const b = factory.tokenSprite("ruby", "none", 48, false);
    expect(a).toBe(b);
    expect(factory.cacheSize).toBe(1);
    expect(factory.tokenSprite("ruby", "none", 48, true)).not.toBe(a);
    expect(factory.tokenSprite("ruby", "none", 32, false)).not.toBe(a);
    expect(factory.cacheSize).toBe(3);
    factory.clearCache();
    expect(factory.cacheSize).toBe(0);
    expect(factory.tokenSprite("ruby", "none", 48, false)).not.toBe(a);
  });

  it("renders every color, special and contrast combination without throwing", () => {
    const calls: string[] = [];
    const factory = new AssetFactory(stubCanvasFactory(calls));
    for (const color of ALL_TOKEN_COLORS) {
      for (const special of SPECIALS) {
        for (const hc of [false, true]) {
          const sprite = factory.tokenSprite(color, special, 40, hc);
          expect(sprite.width).toBe(40);
        }
      }
    }
    factory.tokenSprite(null, "prism", 40, false);
    expect(calls.filter((c) => c === "fill").length).toBeGreaterThan(50);
    // High-contrast gems draw their letter.
    expect(calls).toContain("fillText");
  });

  it("renders seeds, blockers, terrain, exits, tiles, glow and cursor", () => {
    const calls: string[] = [];
    const factory = new AssetFactory(stubCanvasFactory(calls));
    for (const hc of [false, true]) {
      factory.seedSprite(36, hc);
      for (const type of BLOCKERS) {
        factory.blockerSprite(type, 36, hc, false);
        factory.blockerSprite(type, 36, hc, true);
      }
      factory.terrainSprite(1, 36, hc);
      factory.terrainSprite(2, 36, hc);
      factory.terrainSprite(3, 36, hc);
      factory.exitSprite(36, hc);
      factory.cellBaseSprite(36, hc, 0);
      factory.cellBaseSprite(36, hc, 1);
      factory.cursorSprite(36, hc);
    }
    factory.glowSprite("azure", 36);
    factory.glowSprite(null, 36);
    // Damage only changes the stone root look; the other blockers share one sprite.
    expect(factory.blockerSprite("glassVine", 36, false, true)).toBe(factory.blockerSprite("glassVine", 36, false, false));
    expect(factory.blockerSprite("stoneRoot", 36, false, true)).not.toBe(factory.blockerSprite("stoneRoot", 36, false, false));
    // 3 moss layers use the dense sprite.
    expect(factory.terrainSprite(3, 36, false)).toBe(factory.terrainSprite(2, 36, false));
    expect(calls.length).toBeGreaterThan(100);
  });

  it("rounds sizes to whole pixels", () => {
    const factory = new AssetFactory(stubCanvasFactory([]));
    expect(factory.seedSprite(47.6, false).width).toBe(48);
  });
});
