import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng.ts';
import { createFrame } from '../../src/core/track/path.ts';
import { headingOf } from '../../src/core/track/geometry.ts';
import { parseTrack } from '../../src/core/track/load.ts';
import { MAIN_BRANCH } from '../../src/core/types.ts';
import { segment, trackOf } from '../helpers/tracks.ts';

const TEST_TRACK_FILE = 'src/data/tracks/test-track.json';
const testTrack = parseTrack(
  TEST_TRACK_FILE,
  readFileSync(TEST_TRACK_FILE, 'utf8'),
);

const frame = createFrame();
const other = createFrame();

describe('the hand-written test track', () => {
  it('loads and validates', () => {
    expect(testTrack.data.id).toBe('test-track');
    expect(testTrack.data.segments).toHaveLength(8);
  });

  it('contains a straight, a left, a right, a hill, a bank, and a fork', () => {
    const segs = testTrack.data.segments;
    expect(segs.some((s) => s.curvature === 0)).toBe(true);
    expect(segs.some((s) => s.curvature > 0)).toBe(true);
    expect(segs.some((s) => s.curvature < 0)).toBe(true);
    expect(segs.some((s) => s.gradient !== 0)).toBe(true);
    expect(segs.some((s) => s.bank !== 0)).toBe(true);
    expect(testTrack.branches).toHaveLength(1);
  });

  it('reports a total length equal to the sum of its segments', () => {
    const sum = testTrack.data.segments.reduce((a, s) => a + s.length, 0);
    expect(testTrack.totalLength).toBeCloseTo(sum, 9);
  });

  it('is rideable end to end without a NaN', () => {
    for (let s = 0; s <= testTrack.totalLength; s += 1) {
      testTrack.sample(s, frame);
      expect(Number.isFinite(frame.position.x)).toBe(true);
      expect(Number.isFinite(frame.position.y)).toBe(true);
      expect(Number.isFinite(frame.position.z)).toBe(true);
      expect(frame.forward.length()).toBeCloseTo(1, 9);
    }
  });
});

describe('segment boundaries', () => {
  it('agrees from either side to within 1e-9', () => {
    let s = 0;
    for (const seg of testTrack.data.segments.slice(0, -1)) {
      s += seg.length;
      testTrack.sample(s - 1e-10, frame);
      testTrack.sample(s + 1e-10, other);
      expect(frame.position.distanceTo(other.position)).toBeLessThan(1e-9);
    }
    expect(s).toBeGreaterThan(0);
  });

  it('has no seam in heading, which integrates curvature', () => {
    let s = 0;
    for (const seg of testTrack.data.segments.slice(0, -1)) {
      s += seg.length;
      testTrack.sample(s - 1e-10, frame);
      testTrack.sample(s + 1e-10, other);
      expect(headingOf(frame.forward)).toBeCloseTo(headingOf(other.forward), 6);
    }
  });

  it('does kink in pitch where gradient steps — a documented consequence', () => {
    // The tangent is not continuous across a gradient change, because
    // gradient IS the first derivative of elevation, where curvature is only
    // the second derivative of position and so integrates into a smooth
    // heading. A step from flat to 5% is a crest of zero radius. Real roads
    // solve this with a vertical transition curve; this project solves it by
    // authoring a short transition segment. Pinned as a test so the day
    // someone adds smoothing, this fails and they read this comment.
    const track = trackOf(
      segment({ length: 100, gradient: 0 }),
      segment({ length: 100, gradient: 0.05 }),
    );
    track.sample(100 - 1e-10, frame);
    track.sample(100 + 1e-10, other);
    expect(frame.position.distanceTo(other.position)).toBeLessThan(1e-9);
    expect(other.forward.y - frame.forward.y).toBeCloseTo(0.0499, 3);
  });
});

describe('continuity', () => {
  it('moves less than 2 mm over 1 mm of s, for 10,000 random samples', () => {
    const rng = createRng(0xc0ffee);
    let worst = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const s = rng.nextRange(0, testTrack.totalLength - 0.001);
      testTrack.sample(s, frame);
      testTrack.sample(s + 0.001, other);
      worst = Math.max(worst, frame.position.distanceTo(other.position));
    }
    expect(worst).toBeLessThan(0.002);
  });
});

describe('sample() allocation', () => {
  it('writes into the caller-owned frame rather than replacing it', () => {
    const held = createFrame();
    const { position, forward, right, up } = held;
    const keysBefore = Object.keys(held).sort().join(',');

    for (let i = 0; i < 10_000; i += 1) {
      testTrack.sample((i * 0.1) % testTrack.totalLength, held);
    }

    expect(held.position).toBe(position);
    expect(held.forward).toBe(forward);
    expect(held.right).toBe(right);
    expect(held.up).toBe(up);
    expect(Object.keys(held).sort().join(',')).toBe(keysBefore);
  });

  it('does not grow the heap measurably over 200,000 samples', () => {
    const held = createFrame();
    testTrack.sample(0, held);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200_000; i += 1) {
      testTrack.sample((i * 0.01) % testTrack.totalLength, held);
    }
    const grown = process.memoryUsage().heapUsed - before;
    // A per-call allocation of even one Vec3 would be ~10 MB over this run.
    expect(grown).toBeLessThan(4_000_000);
  });
});

describe('road properties', () => {
  it('steps width and lanes at segment boundaries rather than interpolating', () => {
    const track = trackOf(
      segment({ length: 100, halfWidth: 8, lanes: 3 }),
      segment({ length: 100, halfWidth: 4, lanes: 1 }),
    );
    expect(track.widthAt(50)).toBe(8);
    expect(track.lanesAt(50)).toBe(3);
    expect(track.widthAt(150)).toBe(4);
    expect(track.lanesAt(150)).toBe(1);
  });

  it('reports the road plus its shoulder as the survivable width', () => {
    const track = trackOf(segment({ halfWidth: 8, shoulder: 2 }));
    expect(track.widthAt(50)).toBe(8);
    expect(track.driveableHalfWidthAt(50)).toBe(10);
  });

  it('reports signed curvature', () => {
    const track = trackOf(
      segment({ length: 100, curvature: 0.01 }),
      segment({ length: 100, curvature: -0.02 }),
    );
    expect(track.curvatureAt(50)).toBeCloseTo(0.01, 12);
    expect(track.curvatureAt(150)).toBeCloseTo(-0.02, 12);
  });

  it('clamps sampling beyond either end of the track', () => {
    const track = trackOf(segment({ length: 100 }));
    track.sample(-50, frame);
    expect(frame.position.z).toBeCloseTo(0, 9);
    track.sample(500, frame);
    expect(frame.position.z).toBeCloseTo(100, 9);
  });
});

describe('forks', () => {
  const branch = testTrack.branches[0];
  if (!branch) throw new Error('test track lost its branch');

  it('starts the branch exactly where it leaves the main path', () => {
    testTrack.sample(branch.forkS, frame, MAIN_BRANCH);
    testTrack.sample(branch.forkS, other, 1);
    expect(frame.position.distanceTo(other.position)).toBeLessThan(1e-9);
  });

  it('closes: the branch ends on the main path at rejoinS', () => {
    testTrack.sample(branch.forkS + branch.path.length, frame, 1);
    testTrack.sample(branch.rejoinS, other, MAIN_BRANCH);
    expect(frame.position.distanceTo(other.position)).toBeLessThan(0.001);
  });

  it('takes a genuinely different route in between', () => {
    const midS = branch.forkS + branch.path.length / 4;
    testTrack.sample(midS, frame, 1);
    testTrack.sample(midS, other, MAIN_BRANCH);
    expect(frame.position.distanceTo(other.position)).toBeGreaterThan(3);
  });

  it('is longer in metres than the main span, but within 5%', () => {
    const mainSpan = branch.rejoinS - branch.forkS;
    const delta = Math.abs(branch.path.length - mainSpan) / mainSpan;
    expect(branch.path.length).toBeGreaterThan(mainSpan);
    expect(delta).toBeLessThan(0.05);
  });

  it('throws for a branch id that does not exist', () => {
    expect(() => testTrack.branchById(7)).toThrow(/no branch with id 7/);
  });
});
