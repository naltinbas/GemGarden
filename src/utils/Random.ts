/** Small seedable PRNG (mulberry32). Same seed, same board. */
export class Random {
  private state: number;
  readonly seed: number;

  constructor(seed?: number) {
    this.seed = (seed ?? Random.randomSeed()) >>> 0;
    this.state = this.seed || 0x9e3779b9;
  }

  static randomSeed(): number {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** In-place Fisher-Yates. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = items[i];
      items[i] = items[j];
      items[j] = t;
    }
    return items;
  }

  /** Independent generator derived from this one. */
  fork(): Random {
    return new Random((this.next() * 0xffffffff) >>> 0);
  }
}
