import { Vec3 } from '../vec.ts';
import type { TrackFrame, TrackSegment } from '../types.ts';
import {
  advanceCursor,
  bankTable,
  forwardAt,
  nodeCountFor,
  positionAt,
  type PathCursor,
} from './geometry.ts';

/**
 * One continuous run of segments — the main path, or one fork branch —
 * flattened at load into a table of frames that `sample()` interpolates.
 *
 * Nothing in the sampling path calls a transcendental function. That is the
 * whole reason the table exists; see docs/devlog/phase-01.md.
 */

const WORLD_UP = new Vec3(0, 1, 0);

// Scratch, reused by every sample() call so sampling allocates nothing.
const scratchFwd = new Vec3();
const scratchRight = new Vec3();
const scratchUp = new Vec3();

export class Path {
  /** Cumulative `s` at the start of each segment, plus the total at the end. */
  private readonly segStartS: Float64Array;
  private readonly nodeStart: Int32Array;
  private readonly spacing: Float64Array;
  private readonly stepsPer: Int32Array;
  private readonly pos: Float64Array;
  private readonly fwd: Float64Array;
  private readonly bankSin: Float64Array;
  private readonly bankCos: Float64Array;

  /** Total horizontal length of this path, in metres. */
  readonly length: number;

  constructor(
    readonly segments: TrackSegment[],
    start: PathCursor,
  ) {
    const count = segments.length;
    this.segStartS = new Float64Array(count + 1);
    this.nodeStart = new Int32Array(count);
    this.spacing = new Float64Array(count);
    this.stepsPer = new Int32Array(count);

    let totalNodes = 0;
    let s = 0;
    for (let i = 0; i < count; i += 1) {
      const seg = segments[i];
      if (!seg) continue;
      const steps = nodeCountFor(seg);
      this.segStartS[i] = s;
      this.stepsPer[i] = steps;
      this.spacing[i] = seg.length / steps;
      this.nodeStart[i] = totalNodes;
      totalNodes += steps + 1;
      s += seg.length;
    }
    this.segStartS[count] = s;
    this.length = s;

    this.pos = new Float64Array(totalNodes * 3);
    this.fwd = new Float64Array(totalNodes * 3);

    const cursor: PathCursor = {
      position: start.position.clone(),
      heading: start.heading,
    };
    const p = new Vec3();
    const f = new Vec3();

    for (let i = 0; i < count; i += 1) {
      const seg = segments[i];
      if (!seg) continue;
      const steps = this.stepsPer[i] ?? 1;
      const step = this.spacing[i] ?? 0;
      const base = this.nodeStart[i] ?? 0;
      for (let k = 0; k <= steps; k += 1) {
        // The last node of a segment and the first of the next are computed
        // from the same cursor, so a boundary sampled from either side agrees
        // exactly rather than to within a tolerance.
        const d = k === steps ? seg.length : k * step;
        positionAt(cursor, seg, d, p);
        forwardAt(cursor, seg, d, f);
        const o = (base + k) * 3;
        this.pos[o] = p.x;
        this.pos[o + 1] = p.y;
        this.pos[o + 2] = p.z;
        this.fwd[o] = f.x;
        this.fwd[o + 1] = f.y;
        this.fwd[o + 2] = f.z;
      }
      advanceCursor(cursor, seg);
    }

    const banks = bankTable(segments);
    this.bankSin = banks.sin;
    this.bankCos = banks.cos;
  }

  /** Index of the segment containing `s`, clamped to the path. */
  segmentIndexAt(s: number): number {
    const count = this.segments.length;
    if (s <= 0) return 0;
    if (s >= this.length) return count - 1;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.segStartS[mid] ?? 0) <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** The segment containing `s`. */
  segmentAt(s: number): TrackSegment {
    const seg = this.segments[this.segmentIndexAt(s)];
    if (!seg) throw new Error('Path: track has no segments');
    return seg;
  }

  /**
   * Fills `out` with the frame at `s`. Allocates nothing and calls no
   * transcendental function: a binary search, a linear interpolation between
   * two precomputed nodes, and two cross products.
   */
  sample(s: number, out: TrackFrame): TrackFrame {
    const clamped = s <= 0 ? 0 : s >= this.length ? this.length : s;
    const i = this.segmentIndexAt(clamped);
    const seg = this.segments[i];
    if (!seg) throw new Error('Path: track has no segments');

    const step = this.spacing[i] ?? 1;
    const steps = this.stepsPer[i] ?? 1;
    const local = clamped - (this.segStartS[i] ?? 0);

    let k = Math.floor(local / step);
    if (k < 0) k = 0;
    if (k > steps - 1) k = steps - 1;
    const alpha = local / step - k;

    const a = ((this.nodeStart[i] ?? 0) + k) * 3;
    const b = a + 3;

    out.position.set(
      (this.pos[a] ?? 0) + ((this.pos[b] ?? 0) - (this.pos[a] ?? 0)) * alpha,
      (this.pos[a + 1] ?? 0) +
        ((this.pos[b + 1] ?? 0) - (this.pos[a + 1] ?? 0)) * alpha,
      (this.pos[a + 2] ?? 0) +
        ((this.pos[b + 2] ?? 0) - (this.pos[a + 2] ?? 0)) * alpha,
    );

    scratchFwd
      .set(
        (this.fwd[a] ?? 0) + ((this.fwd[b] ?? 0) - (this.fwd[a] ?? 0)) * alpha,
        (this.fwd[a + 1] ?? 0) +
          ((this.fwd[b + 1] ?? 0) - (this.fwd[a + 1] ?? 0)) * alpha,
        (this.fwd[a + 2] ?? 0) +
          ((this.fwd[b + 2] ?? 0) - (this.fwd[a + 2] ?? 0)) * alpha,
      )
      .normalize();

    // Unbanked road frame: right is horizontal, up completes it.
    scratchRight.crossVectors(WORLD_UP, scratchFwd).normalize();
    scratchUp.crossVectors(scratchFwd, scratchRight);

    // Then roll about forward by the segment's camber. Positive bank tilts up
    // toward `right`, which is the inside of a right-hand (positive) curve.
    const sinB = this.bankSin[i] ?? 0;
    const cosB = this.bankCos[i] ?? 1;
    out.forward.copy(scratchFwd);
    out.up.set(
      scratchUp.x * cosB + scratchRight.x * sinB,
      scratchUp.y * cosB + scratchRight.y * sinB,
      scratchUp.z * cosB + scratchRight.z * sinB,
    );
    out.right.set(
      scratchRight.x * cosB - scratchUp.x * sinB,
      scratchRight.y * cosB - scratchUp.y * sinB,
      scratchRight.z * cosB - scratchUp.z * sinB,
    );

    out.halfWidth = seg.halfWidth;
    out.shoulder = seg.shoulder;
    out.lanes = seg.lanes;
    out.curvature = seg.curvature;
    return out;
  }
}

/** Allocates a reusable frame. Call once, at setup, never per frame. */
export function createFrame(): TrackFrame {
  return {
    position: new Vec3(),
    forward: new Vec3(0, 0, 1),
    right: new Vec3(1, 0, 0),
    up: new Vec3(0, 1, 0),
    halfWidth: 0,
    shoulder: 0,
    lanes: 1,
    curvature: 0,
  };
}
