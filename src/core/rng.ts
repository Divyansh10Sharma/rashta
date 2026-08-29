/**
 * The project's only source of randomness.
 *
 * CLAUDE.md rule 4: the simulation is bit-exactly deterministic, so
 * `Math.random` is banned everywhere else and ESLint enforces it. This is
 * mulberry32 — a small, fast, well-distributed PRNG whose entire state is one
 * 32-bit integer, which is what lets a saved game resume an identical race.
 *
 * Every operation here is integer arithmetic, `Math.imul`, and bit shifts. No
 * transcendental functions, so this is legal inside `step()`.
 */
export interface Rng {
  /** The next unsigned 32-bit integer. */
  nextUint32(): number;
  /** The next float in [0, 1). */
  next(): number;
  /** The next float in [min, max). */
  nextRange(min: number, max: number): number;
  /** The next integer in [0, bound). Throws if `bound` is not a positive integer. */
  nextInt(bound: number): number;
  /** The current state, for saving. */
  getState(): number;
  /** Restores a previously saved state. */
  setState(state: number): void;
}

/** 2^-32, for mapping a uint32 into [0, 1) without bias. */
const INV_2_32 = 2.3283064365386963e-10;

/**
 * Creates a seeded generator. The same seed always produces the same
 * sequence, on every machine.
 */
export function createRng(seed: number): Rng {
  if (!Number.isFinite(seed)) {
    throw new Error(`rng: seed must be a finite number, got ${seed}`);
  }

  // Coerce to uint32 up front so createRng(1.5) and createRng(1) cannot
  // silently produce different streams from what looks like the same seed.
  let state = seed >>> 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  return {
    nextUint32,
    next: () => nextUint32() * INV_2_32,
    nextRange: (min, max) => min + nextUint32() * INV_2_32 * (max - min),
    nextInt: (bound) => {
      if (!Number.isInteger(bound) || bound <= 0) {
        throw new Error(
          `rng: nextInt bound must be a positive integer, got ${bound}`,
        );
      }
      return Math.floor(nextUint32() * INV_2_32 * bound);
    },
    getState: () => state,
    setState: (s) => {
      if (!Number.isFinite(s)) {
        throw new Error(`rng: state must be a finite number, got ${s}`);
      }
      state = s >>> 0;
    },
  };
}
