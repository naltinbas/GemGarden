import type { Blocker, BlockerType } from "../game/Types";

export const DEFAULT_BLOCKER_HP: Record<BlockerType, number> = {
  stoneRoot: 2,
  glassVine: 1,
  lockedBud: 1,
  shadowMist: 1,
};

export function createBlocker(type: BlockerType, hp?: number): Blocker {
  const points = hp ?? DEFAULT_BLOCKER_HP[type];
  return { type, hp: points, maxHp: points };
}

export function cloneBlocker(blocker: Blocker): Blocker {
  return { type: blocker.type, hp: blocker.hp, maxHp: blocker.maxHp };
}
