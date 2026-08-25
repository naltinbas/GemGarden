import type { Token } from "../game/Types";

export function isSeed(token: Token | null): boolean {
  return token !== null && token.kind === "seed";
}
