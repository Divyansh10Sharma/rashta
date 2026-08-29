/**
 * A minimal mutable 3-vector.
 *
 * Deliberately not Three.js's `Vector3`: `src/core/` may not import `three`
 * (CLAUDE.md rule 1), and the render layer converts at the boundary. Every
 * method that produces a vector writes into `this` and returns it, so a
 * per-frame loop can run with zero allocation.
 */
export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  /** Sets all three components. */
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  /** Copies another vector's components into this one. */
  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  /** Allocates. Never call this inside a per-frame loop. */
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  /** Adds `v` to this vector. */
  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  /** Subtracts `v` from this vector. */
  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  /** Adds `v * scale`. The workhorse for stepping along a track frame. */
  addScaledVector(v: Vec3, scale: number): this {
    this.x += v.x * scale;
    this.y += v.y * scale;
    this.z += v.z * scale;
    return this;
  }

  /** Multiplies every component by `s`. */
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  /** Writes `a + (b - a) * alpha` into this vector. */
  lerpVectors(a: Vec3, b: Vec3, alpha: number): this {
    this.x = a.x + (b.x - a.x) * alpha;
    this.y = a.y + (b.y - a.y) * alpha;
    this.z = a.z + (b.z - a.z) * alpha;
    return this;
  }

  /** Writes the cross product `a x b` into this vector. */
  crossVectors(a: Vec3, b: Vec3): this {
    // Read all six components before writing, so `out` may alias `a` or `b`.
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const bx = b.x;
    const by = b.y;
    const bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }

  /** Dot product with `v`. */
  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** Squared length. Prefer this to `length()` when only comparing. */
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /** Euclidean length. `sqrt` is IEEE-754 exact, so this is sim-legal. */
  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  /** Distance to `v`. */
  distanceTo(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Scales to unit length. A zero vector is left untouched rather than NaN. */
  normalize(): this {
    const len = this.length();
    if (len > 0) this.scale(1 / len);
    return this;
  }
}
