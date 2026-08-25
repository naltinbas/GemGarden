import type { SpecialType, Token, TokenColor } from "../game/Types";

/** Hands out tokens with unique ids. One factory per board so ids stay unique across its lifetime. */
export class TokenFactory {
  nextId: number;

  constructor(nextId = 1) {
    this.nextId = nextId;
  }

  createGem(color: TokenColor, special: SpecialType = "none"): Token {
    return { id: this.nextId++, kind: "gem", color, special };
  }

  createSeed(): Token {
    return { id: this.nextId++, kind: "seed", color: null, special: "none" };
  }

  createPrism(): Token {
    return { id: this.nextId++, kind: "gem", color: null, special: "prism" };
  }
}

export function cloneToken(token: Token): Token {
  return { id: token.id, kind: token.kind, color: token.color, special: token.special };
}

export function isSpecial(token: Token | null): boolean {
  return token !== null && token.special !== "none";
}

export function isBeam(token: Token | null): boolean {
  return token !== null && (token.special === "lineHorizontal" || token.special === "lineVertical");
}

export function isBurst(token: Token | null): boolean {
  return token !== null && token.special === "burst";
}

export function isPrism(token: Token | null): boolean {
  return token !== null && token.special === "prism";
}
