import type { Vec3 } from '../vec.ts';
import type { TrackSegment } from '../types.ts';

/**
 * Closed-form arc integration, and the only file in `src/core/` permitted to
 * call a transcendental function.
 *
 * CLAUDE.md rule 4 bans `sin`/`cos` from anything the simulation reaches,
 * because IEEE-754 does not pin them to the same bits across engines. A point
 * partway along a constant-curvature arc is inherently `R·sin(theta)`, so the
 * trigonometry has to happen somewhere — it happens here, once, at load,
 * building the table that `Track.sample()` then interpolates without trig.
 *
 * Nothing in here may be called from `step()`. The guard is a test.
 */

/** Where the integrator has got to. Mutated in place while walking a path. */
export interface PathCursor {
  position: Vec3;
  /** Radians. Zero faces +Z; increasing turns right, toward +X. */
  heading: number;
}

/** Largest gap between table nodes, in metres, however gentle the curve. */
const MAX_NODE_SPACING = 2;
/** Smallest gap, so a hairpin cannot produce a million nodes. */
const MIN_NODE_SPACING = 0.25;
/** Target sagitta error of a chord across the arc, in metres. */
const NODE_SAGITTA_TOLERANCE = 0.001;

/**
 * Node spacing for a segment, from the sagitta of a chord across a circle:
 * `e = d^2 / 8R`, solved for `d`. Tight corners get dense nodes, straights get
 * the cap.
 */
export function nodeSpacingFor(curvature: number): number {
  if (curvature === 0) return MAX_NODE_SPACING;
  const radius = 1 / Math.abs(curvature);
  const ideal = Math.sqrt(8 * radius * NODE_SAGITTA_TOLERANCE);
  return Math.min(MAX_NODE_SPACING, Math.max(MIN_NODE_SPACING, ideal));
}

/**
 * Number of node intervals in a segment. Always at least one, and chosen so
 * the segment's end lands exactly on a node — which is what makes sampling a
 * segment boundary from either side agree exactly rather than approximately.
 */
export function nodeCountFor(segment: TrackSegment): number {
  return Math.max(
    1,
    Math.ceil(segment.length / nodeSpacingFor(segment.curvature)),
  );
}

/**
 * Writes the position reached by travelling `distance` into `segment` from
 * `cursor`, without moving the cursor. `distance` is horizontal metres; the
 * rise is `gradient * distance` (see docs/devlog/phase-01.md).
 */
export function positionAt(
  cursor: PathCursor,
  segment: TrackSegment,
  distance: number,
  out: Vec3,
): Vec3 {
  const theta = cursor.heading;
  const dTheta = segment.curvature * distance;

  if (segment.curvature === 0) {
    out.set(
      cursor.position.x + Math.sin(theta) * distance,
      cursor.position.y,
      cursor.position.z + Math.cos(theta) * distance,
    );
  } else {
    // The arc's centre sits one radius along the right vector, so the
    // displacement is R * (right(theta) - right(theta + dTheta)), with
    // right(a) = (cos a, 0, -sin a). This is exact, not a small-angle
    // approximation, which is why segments can be arbitrarily long.
    const radius = 1 / segment.curvature;
    out.set(
      cursor.position.x + radius * (Math.cos(theta) - Math.cos(theta + dTheta)),
      cursor.position.y,
      cursor.position.z + radius * (Math.sin(theta + dTheta) - Math.sin(theta)),
    );
  }

  out.y += segment.gradient * distance;
  return out;
}

/**
 * Writes the unit forward vector at `distance` into `segment`. The vector
 * carries the gradient, so it is not horizontal on a hill — but `s` still
 * advances horizontally, which is why this normalises rather than assuming
 * unit length.
 */
export function forwardAt(
  cursor: PathCursor,
  segment: TrackSegment,
  distance: number,
  out: Vec3,
): Vec3 {
  const theta = cursor.heading + segment.curvature * distance;
  return out
    .set(Math.sin(theta), segment.gradient, Math.cos(theta))
    .normalize();
}

/**
 * Recovers the heading angle from a forward vector. Used at load only, to
 * start a fork branch from the main path's frame at the fork point.
 */
export function headingOf(forward: Vec3): number {
  return Math.atan2(forward.x, forward.z);
}

/** Advances the cursor to the far end of `segment`, mutating it. */
export function advanceCursor(cursor: PathCursor, segment: TrackSegment): void {
  positionAt(cursor, segment, segment.length, cursor.position);
  cursor.heading += segment.curvature * segment.length;
}

/**
 * Sine and cosine of each segment's camber, resolved at load so the runtime
 * can bank a frame with multiplication alone.
 */
export function bankTable(segments: TrackSegment[]): {
  sin: Float64Array;
  cos: Float64Array;
} {
  const sin = new Float64Array(segments.length);
  const cos = new Float64Array(segments.length);
  for (let i = 0; i < segments.length; i += 1) {
    const bank = segments[i]?.bank ?? 0;
    sin[i] = Math.sin(bank);
    cos[i] = Math.cos(bank);
  }
  return { sin, cos };
}
