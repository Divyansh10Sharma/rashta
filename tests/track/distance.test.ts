import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { progress, trackDistance } from '../../src/core/track/distance.ts';
import { parseTrack } from '../../src/core/track/load.ts';
import { MAIN_BRANCH } from '../../src/core/types.ts';
import type { TrackPos } from '../../src/core/types.ts';
import { segment, trackOf } from '../helpers/tracks.ts';

const TEST_TRACK_FILE = 'src/data/tracks/test-track.json';
const testTrack = parseTrack(
  TEST_TRACK_FILE,
  readFileSync(TEST_TRACK_FILE, 'utf8'),
);

const at = (s: number, t: number, branchId = MAIN_BRANCH): TrackPos => ({
  s,
  t,
  branchId,
});

/**
 * The exact chord between two points on a constant-curvature arc, as the
 * reference `trackDistance` approximates. A point at lateral offset `t` sits
 * at polar radius `|R| * (1 - t * k)`, and the two radial lines are separated
 * by `|ds| * |k|`. Uses `cos`, which is exactly why it lives in a test and not
 * in the simulation.
 */
function exactChord(a: TrackPos, b: TrackPos, curvature: number): number {
  if (curvature === 0) return Math.hypot(b.s - a.s, b.t - a.t);
  const radius = 1 / Math.abs(curvature);
  const r1 = radius * (1 - a.t * curvature);
  const r2 = radius * (1 - b.t * curvature);
  const dPhi = Math.abs(b.s - a.s) * Math.abs(curvature);
  return Math.sqrt(r1 * r1 + r2 * r2 - 2 * r1 * r2 * Math.cos(dPhi));
}

describe('trackDistance on a straight', () => {
  it('is plain Pythagoras when there is no curvature', () => {
    const track = trackOf(segment({ length: 200 }));
    expect(trackDistance(at(10, 0), at(13, 4), track)).toBeCloseTo(5, 9);
  });

  it('is symmetric', () => {
    const track = trackOf(segment({ length: 200 }));
    const ab = trackDistance(at(10, -2), at(17, 3), track);
    const ba = trackDistance(at(17, 3), at(10, -2), track);
    expect(ab).toBeCloseTo(ba, 12);
  });

  it('is zero for a position against itself', () => {
    const track = trackOf(segment({ length: 200 }));
    expect(trackDistance(at(40, 2), at(40, 2), track)).toBe(0);
  });
});

describe('trackDistance under curvature', () => {
  it('agrees with the exact chord across the tightest corner, at every gap', () => {
    // Segment 5 of the test track: curvature -0.04 (a 25 m radius), road plus
    // shoulder 4.5 m either side. Sweep the full width and a range of gaps.
    const curvature = -0.04;
    let worstError = 0;
    for (let t1 = -4.5; t1 <= 4.5; t1 += 0.5) {
      for (let t2 = -4.5; t2 <= 4.5; t2 += 0.5) {
        for (const ds of [0.5, 1, 2, 4, 8]) {
          const a = at(775, t1);
          const b = at(775 + ds, t2);
          const got = trackDistance(a, b, testTrack);
          const want = exactChord(a, b, curvature);
          if (want > 0.01) {
            worstError = Math.max(worstError, Math.abs(got - want) / want);
          }
        }
      }
    }
    // Not 0.1% but 1e-5: the decomposition is exact and only the sine is
    // approximated. The roadmap asked for 0.1%; hitting it by three orders of
    // magnitude is what happens when you stop approximating the geometry and
    // approximate only the transcendental.
    expect(worstError).toBeLessThan(1e-5);
  });

  it('reproduces the figures quoted in ARCHITECTURE.md 1.4', () => {
    // A 20 m corner, riders 2 m apart in s and 1 m apart in t. The same two
    // numbers mean very different real separations depending where on the
    // road they sit — which is the entire reason this function exists.
    const track = trackOf(
      segment({ length: 200, curvature: 0.05, halfWidth: 8, shoulder: 2 }),
    );
    const inside = trackDistance(at(100, 4), at(102, 5), track);
    const outside = trackDistance(at(100, -5), at(102, -4), track);

    expect(inside).toBeCloseTo(1.8434, 3);
    expect(outside).toBeCloseTo(2.6448, 3);
    expect(outside / inside - 1).toBeCloseTo(0.435, 2);

    // And against the exact chord, not just the published rounding.
    expect(inside).toBeCloseTo(exactChord(at(100, 4), at(102, 5), 0.05), 6);
    expect(outside).toBeCloseTo(exactChord(at(100, -5), at(102, -4), 0.05), 6);
  });

  it('reads shorter on the inside of a bend than the naive box', () => {
    const track = trackOf(segment({ length: 200, curvature: 0.05 }));
    const naive = Math.hypot(2, 1);
    expect(trackDistance(at(100, 4), at(102, 5), track)).toBeLessThan(naive);
    expect(trackDistance(at(100, -5), at(102, -4), track)).toBeGreaterThan(
      naive,
    );
  });

  it('clamps a rider who has left the road rather than going negative', () => {
    const track = trackOf(
      segment({ length: 200, curvature: 0.05, halfWidth: 8, shoulder: 2 }),
    );
    // t = 400 is far past the point where (1 - t*k) would turn negative.
    const far = trackDistance(at(100, 400), at(110, 400), track);
    expect(far).toBeGreaterThan(0);
    expect(Number.isFinite(far)).toBe(true);
  });
});

describe('trackDistance across forks', () => {
  it('is infinite between riders on different branches', () => {
    const a = at(800, 0, MAIN_BRANCH);
    const b = at(800, 0, 1);
    expect(trackDistance(a, b, testTrack)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('progress', () => {
  const branch = testTrack.branches[0];
  if (!branch) throw new Error('test track lost its branch');

  it('is just s on the main path', () => {
    expect(progress(at(437, 3), testTrack)).toBe(437);
  });

  it('equals the fork point where the branch leaves', () => {
    expect(progress(at(branch.forkS, 0, 1), testTrack)).toBeCloseTo(
      branch.forkS,
      9,
    );
  });

  it('equals the rejoin point where the branch ends', () => {
    const endS = branch.forkS + branch.path.length;
    expect(progress(at(endS, 0, 1), testTrack)).toBeCloseTo(branch.rejoinS, 9);
  });

  it('brings both routes to the rejoin at exactly equal progress', () => {
    const viaBranch = progress(
      at(branch.forkS + branch.path.length, 0, 1),
      testTrack,
    );
    const viaMain = progress(at(branch.rejoinS, 0, MAIN_BRANCH), testTrack);
    expect(viaBranch).toBeCloseTo(viaMain, 9);
  });

  it('is not the same as raw s on a branch — the whole point', () => {
    const midS = branch.forkS + branch.path.length / 2;
    expect(progress(at(midS, 0, 1), testTrack)).not.toBeCloseTo(midS, 3);
  });

  it('increases monotonically along the branch', () => {
    let previous = -Infinity;
    for (let d = 0; d <= branch.path.length; d += 5) {
      const p = progress(at(branch.forkS + d, 0, 1), testTrack);
      expect(p).toBeGreaterThan(previous);
      previous = p;
    }
  });

  it('orders two riders correctly across different branches', () => {
    // The branch rider is 90% of the way round the long way; the main rider
    // has only just left the fork. Raw `s` would put the main rider ahead.
    const branchRider = at(branch.forkS + branch.path.length * 0.9, 0, 1);
    const mainRider = at(branch.forkS + 10, 0, MAIN_BRANCH);
    expect(branchRider.s).toBeGreaterThan(mainRider.s);
    expect(progress(branchRider, testTrack)).toBeGreaterThan(
      progress(mainRider, testTrack),
    );
  });
});
