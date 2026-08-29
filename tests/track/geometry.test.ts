import { describe, expect, it } from 'vitest';
import { createFrame } from '../../src/core/track/path.ts';
import { headingOf } from '../../src/core/track/geometry.ts';
import { segment, trackOf } from '../helpers/tracks.ts';

const frame = createFrame();

describe('sampling a straight', () => {
  it('produces a straight line along +Z', () => {
    const track = trackOf(segment({ length: 100 }));
    for (const s of [0, 25, 50, 99.5, 100]) {
      track.sample(s, frame);
      expect(frame.position.x).toBeCloseTo(0, 12);
      expect(frame.position.y).toBeCloseTo(0, 12);
      expect(frame.position.z).toBeCloseTo(s, 9);
    }
  });

  it('keeps a constant forward, right, and up frame', () => {
    const track = trackOf(segment({ length: 100 }));
    track.sample(40, frame);
    expect(frame.forward.x).toBeCloseTo(0, 12);
    expect(frame.forward.z).toBeCloseTo(1, 12);
    expect(frame.right.x).toBeCloseTo(1, 12);
    expect(frame.up.y).toBeCloseTo(1, 12);
  });

  it('gives an orthonormal frame', () => {
    const track = trackOf(segment({ length: 100 }));
    track.sample(40, frame);
    expect(frame.forward.length()).toBeCloseTo(1, 12);
    expect(frame.right.length()).toBeCloseTo(1, 12);
    expect(frame.up.length()).toBeCloseTo(1, 12);
    expect(frame.forward.dot(frame.right)).toBeCloseTo(0, 12);
    expect(frame.forward.dot(frame.up)).toBeCloseTo(0, 12);
    expect(frame.right.dot(frame.up)).toBeCloseTo(0, 12);
  });
});

describe('sampling a constant-curvature arc', () => {
  // curvature and length chosen so their product is exact in binary floating
  // point: 0.01 * 100 is 1 rad with no rounding to argue about.
  it('rotates heading by exactly L/R', () => {
    const track = trackOf(segment({ length: 100, curvature: 0.01 }));
    track.sample(100, frame);
    expect(headingOf(frame.forward)).toBeCloseTo(1, 9);
  });

  it('rotates heading proportionally along the arc', () => {
    const track = trackOf(segment({ length: 100, curvature: 0.01 }));
    for (const s of [0, 20, 50, 80, 100]) {
      track.sample(s, frame);
      expect(headingOf(frame.forward)).toBeCloseTo(s * 0.01, 6);
    }
  });

  it('turns right for positive curvature and left for negative', () => {
    const right = trackOf(segment({ length: 100, curvature: 0.01 }));
    right.sample(100, frame);
    expect(frame.position.x).toBeGreaterThan(0);

    const left = trackOf(segment({ length: 100, curvature: -0.01 }));
    left.sample(100, frame);
    expect(frame.position.x).toBeLessThan(0);
  });

  it('stays on a circle of radius R about the centre of curvature', () => {
    const radius = 1 / 0.01;
    const track = trackOf(segment({ length: 150, curvature: 0.01 }));
    // Positive curvature puts the centre one radius to the right of the start.
    for (const s of [0, 37.5, 75, 112.5, 150]) {
      track.sample(s, frame);
      const dx = frame.position.x - radius;
      const dz = frame.position.z - 0;
      expect(Math.sqrt(dx * dx + dz * dz)).toBeCloseTo(radius, 3);
    }
  });
});

describe('elevation', () => {
  it('integrates gradient as rise per metre of s', () => {
    const track = trackOf(segment({ length: 200, gradient: 0.05 }));
    for (const s of [0, 50, 100, 200]) {
      track.sample(s, frame);
      expect(frame.position.y).toBeCloseTo(s * 0.05, 9);
    }
  });

  it('accumulates elevation across segments', () => {
    const track = trackOf(
      segment({ length: 100, gradient: 0.05 }),
      segment({ length: 100, gradient: -0.02 }),
    );
    track.sample(200, frame);
    expect(frame.position.y).toBeCloseTo(100 * 0.05 - 100 * 0.02, 9);
  });

  it('tilts forward up a hill but keeps it a unit vector', () => {
    const track = trackOf(segment({ length: 100, gradient: 0.05 }));
    track.sample(50, frame);
    expect(frame.forward.y).toBeGreaterThan(0);
    expect(frame.forward.length()).toBeCloseTo(1, 12);
  });
});

describe('bank', () => {
  it('tilts up toward the inside of a right-hand curve', () => {
    const track = trackOf(segment({ length: 100, curvature: 0.01, bank: 0.2 }));
    track.sample(0, frame);
    // Heading is +Z at s = 0, so "right" is +X and a positive bank tilts up
    // that way.
    expect(frame.up.x).toBeGreaterThan(0);
    expect(frame.up.length()).toBeCloseTo(1, 12);
  });

  it('keeps the frame orthonormal when banked', () => {
    const track = trackOf(segment({ length: 100, curvature: 0.01, bank: 0.3 }));
    track.sample(50, frame);
    expect(frame.forward.dot(frame.right)).toBeCloseTo(0, 12);
    expect(frame.forward.dot(frame.up)).toBeCloseTo(0, 12);
    expect(frame.right.dot(frame.up)).toBeCloseTo(0, 12);
    expect(frame.right.length()).toBeCloseTo(1, 12);
  });
});
