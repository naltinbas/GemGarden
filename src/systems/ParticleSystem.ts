// Fixed-pool particles. update() never allocates; dead particles swap to the back.

export type ParticleShape = "circle" | "petal" | "spark";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  rot: number;
  spin: number;
  shape: ParticleShape;
  /** Air drag per second, 0 = none. */
  drag: number;
}

export interface EmitOptions {
  count?: number;
  color?: string | readonly string[];
  /** Pixels per second; each particle gets speed * (0.5..1). */
  speed?: number;
  /** Milliseconds; each particle gets life * (0.7..1). */
  life?: number;
  size?: number;
  /** Pixels per second squared, positive is down. */
  gravity?: number;
  /** Cone half-angle in radians around direction. Pi = every direction. */
  spread?: number;
  /** Radians, 0 = right, -PI/2 = up. */
  direction?: number;
  shape?: ParticleShape;
  spin?: number;
  drag?: number;
}

export class ParticleSystem {
  readonly capacity: number;
  private pool: Particle[];
  private count = 0;
  private rng: () => number;

  constructor(capacity = 600, rng: () => number = Math.random) {
    this.capacity = capacity;
    this.rng = rng;
    this.pool = [];
    for (let i = 0; i < capacity; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, color: "#fff",
        gravity: 0, rot: 0, spin: 0, shape: "circle", drag: 0,
      });
    }
  }

  get activeCount(): number {
    return this.count;
  }

  /** Spawns up to count particles. When the pool is full the oldest live ones are reused. */
  emit(x: number, y: number, opts: EmitOptions = {}): number {
    const count = Math.max(0, Math.floor(opts.count ?? 12));
    const speed = opts.speed ?? 120;
    const life = opts.life ?? 600;
    const size = opts.size ?? 4;
    const gravity = opts.gravity ?? 0;
    const spread = opts.spread ?? Math.PI;
    const direction = opts.direction ?? -Math.PI / 2;
    const shape = opts.shape ?? "circle";
    const spin = opts.spin ?? 0;
    const drag = opts.drag ?? 0;
    const color = opts.color ?? "#ffffff";
    let emitted = 0;
    for (let i = 0; i < count; i++) {
      let p: Particle;
      if (this.count < this.capacity) {
        p = this.pool[this.count++];
      } else {
        p = this.oldest();
      }
      const angle = direction + (this.rng() * 2 - 1) * spread;
      const v = speed * (0.5 + this.rng() * 0.5);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v;
      p.maxLife = life * (0.7 + this.rng() * 0.3);
      p.life = p.maxLife;
      p.size = size * (0.6 + this.rng() * 0.8);
      p.color = typeof color === "string" ? color : color[Math.floor(this.rng() * color.length)];
      p.gravity = gravity;
      p.rot = this.rng() * Math.PI * 2;
      p.spin = (this.rng() * 2 - 1) * spin;
      p.shape = shape;
      p.drag = drag;
      emitted++;
    }
    return emitted;
  }

  update(dt: number): void {
    const s = dt / 1000;
    let i = 0;
    while (i < this.count) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.count--;
        if (i !== this.count) {
          // Swap the dead slot with the last live one so live particles stay packed in front.
          this.pool[i] = this.pool[this.count];
          this.pool[this.count] = p;
        }
        continue;
      }
      p.vy += p.gravity * s;
      if (p.drag > 0) {
        const k = Math.max(0, 1 - p.drag * s);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.rot += p.spin * s;
      i++;
    }
  }

  forEach(fn: (p: Particle) => void): void {
    for (let i = 0; i < this.count; i++) fn(this.pool[i]);
  }

  clear(): void {
    this.count = 0;
  }

  private oldest(): Particle {
    let best = this.pool[0];
    let bestFrac = 2;
    for (let i = 0; i < this.count; i++) {
      const p = this.pool[i];
      const frac = p.life / p.maxLife;
      if (frac < bestFrac) {
        bestFrac = frac;
        best = p;
      }
    }
    return best;
  }
}
