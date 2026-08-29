import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/vec.ts';
import { createRng } from '../src/core/rng.ts';

describe('Vec3', () => {
  it('sets, copies, and clones', () => {
    const v = new Vec3().set(1, 2, 3);
    expect([v.x, v.y, v.z]).toEqual([1, 2, 3]);
    const copy = new Vec3().copy(v);
    expect([copy.x, copy.y, copy.z]).toEqual([1, 2, 3]);
    const clone = v.clone();
    expect(clone).not.toBe(v);
    expect([clone.x, clone.y, clone.z]).toEqual([1, 2, 3]);
  });

  it('defaults to the origin', () => {
    const v = new Vec3();
    expect([v.x, v.y, v.z]).toEqual([0, 0, 0]);
  });

  it('adds, subtracts, and scales in place', () => {
    const v = new Vec3(1, 2, 3);
    v.add(new Vec3(1, 1, 1));
    expect([v.x, v.y, v.z]).toEqual([2, 3, 4]);
    v.sub(new Vec3(2, 2, 2));
    expect([v.x, v.y, v.z]).toEqual([0, 1, 2]);
    v.scale(3);
    expect([v.x, v.y, v.z]).toEqual([0, 3, 6]);
  });

  it('adds a scaled vector — the track-space to world-space step', () => {
    const position = new Vec3(0, 0, 10);
    const right = new Vec3(1, 0, 0);
    position.addScaledVector(right, -2.5);
    expect([position.x, position.y, position.z]).toEqual([-2.5, 0, 10]);
  });

  it('interpolates between two vectors', () => {
    const out = new Vec3().lerpVectors(
      new Vec3(0, 0, 0),
      new Vec3(10, 20, 30),
      0.25,
    );
    expect([out.x, out.y, out.z]).toEqual([2.5, 5, 7.5]);
  });

  it('computes dot and cross products', () => {
    expect(new Vec3(1, 0, 0).dot(new Vec3(0, 1, 0))).toBe(0);
    expect(new Vec3(1, 2, 3).dot(new Vec3(4, 5, 6))).toBe(32);
    const cross = new Vec3().crossVectors(new Vec3(1, 0, 0), new Vec3(0, 1, 0));
    expect([cross.x, cross.y, cross.z]).toEqual([0, 0, 1]);
  });

  it('gives the right cross product even when the output aliases an input', () => {
    // sample() reuses scratch vectors, so this case is real, not theoretical.
    const a = new Vec3(1, 0, 0);
    const b = new Vec3(0, 1, 0);
    a.crossVectors(a, b);
    expect([a.x, a.y, a.z]).toEqual([0, 0, 1]);
  });

  it('measures length, squared length, and distance', () => {
    expect(new Vec3(3, 4, 0).length()).toBe(5);
    expect(new Vec3(3, 4, 0).lengthSq()).toBe(25);
    expect(new Vec3(0, 0, 0).distanceTo(new Vec3(3, 4, 0))).toBe(5);
  });

  it('normalises to unit length', () => {
    const v = new Vec3(0, 0, 7).normalize();
    expect(v.length()).toBeCloseTo(1, 12);
    expect(v.z).toBeCloseTo(1, 12);
  });

  it('leaves a zero vector alone rather than producing NaN', () => {
    const v = new Vec3(0, 0, 0).normalize();
    expect([v.x, v.y, v.z]).toEqual([0, 0, 0]);
  });
});

describe('the seeded RNG', () => {
  it('produces the same sequence from the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i += 1) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences from different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const left = Array.from({ length: 20 }, () => a.next());
    const right = Array.from({ length: 20 }, () => b.next());
    expect(left).not.toEqual(right);
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 10_000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const rng = createRng(7);
    const buckets = new Array<number>(10).fill(0);
    const draws = 100_000;
    for (let i = 0; i < draws; i += 1) {
      const index = Math.floor(rng.next() * 10);
      buckets[index] = (buckets[index] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(draws / 10 - draws / 100);
      expect(count).toBeLessThan(draws / 10 + draws / 100);
    }
  });

  it('resumes an identical stream from a saved state', () => {
    // ARCHITECTURE.md 6: the world carries its RNG state so a saved game
    // resumes the same race, not a similar one.
    const rng = createRng(4242);
    for (let i = 0; i < 50; i += 1) rng.next();
    const saved = rng.getState();
    const expected = Array.from({ length: 20 }, () => rng.next());

    const resumed = createRng(0);
    resumed.setState(saved);
    expect(Array.from({ length: 20 }, () => resumed.next())).toEqual(expected);
  });

  it('coerces a fractional seed so it cannot silently fork the stream', () => {
    const whole = createRng(1);
    const fractional = createRng(1.5);
    expect(fractional.next()).toBe(whole.next());
  });

  it('draws integers within bounds and covers the range', () => {
    const rng = createRng(2024);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.nextInt(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
  });

  it('draws floats within a range', () => {
    const rng = createRng(11);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.nextRange(-5, 5);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(5);
    }
  });

  it('returns uint32 values', () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('rejects a seed, state, or bound that makes no sense', () => {
    expect(() => createRng(NaN)).toThrow(/seed must be a finite number/);
    expect(() => createRng(Infinity)).toThrow(/seed must be a finite number/);
    expect(() => createRng(1).setState(NaN)).toThrow(
      /state must be a finite number/,
    );
    expect(() => createRng(1).nextInt(0)).toThrow(/positive integer/);
    expect(() => createRng(1).nextInt(-3)).toThrow(/positive integer/);
    expect(() => createRng(1).nextInt(2.5)).toThrow(/positive integer/);
  });
});
