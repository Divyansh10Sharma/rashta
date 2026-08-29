import { MAIN_BRANCH } from '../types.ts';
import type { TrackPos } from '../types.ts';
import type { Track } from './Track.ts';

/**
 * Measuring in track space, per ARCHITECTURE.md 1.4.
 *
 * Track space is not metric. A rectangle in `(s, t)` is a curved wedge in the
 * world, so any question that is really about metres — combat range, the
 * police arrest radius, traffic occupancy — has to correct for curvature.
 *
 * Everything here is trig-free and so legal inside `step()`.
 */

/**
 * `2 * sin(u / 2) / u` as a Maclaurin series: the ratio of a circular arc's
 * chord to its length.
 *
 * This is the whole trick. The exact separation needs `sin(dPhi / 2)`, and
 * CLAUDE.md rule 4 bans `Math.sin` from anything the simulation reaches
 * because engines disagree in the last bits. A truncated polynomial is pure
 * multiplication and addition, so it is identical on every machine, and four
 * terms hold to about 3e-6 out to `u = 2` — far beyond any range this game
 * asks about.
 */
function chordOverArc(u: number): number {
  const u2 = u * u;
  const factor = 1 - u2 / 24 + (u2 * u2) / 1920 - (u2 * u2 * u2) / 322_560;
  return factor > 0 ? factor : 0;
}

/**
 * Beyond this sweep the four-term series stops being trustworthy.
 *
 * It holds to about 3e-6 out to `u = 2` and degrades fast after — far enough
 * for anything a collision asks about. Past it the answer only has to be
 * safely large, never wrongly small.
 */
const SERIES_MAX_SWEEP = 2;

/**
 * Approximate metric separation between two track positions, in metres.
 *
 * Exact separation on a constant-curvature arc decomposes as
 * `d^2 = dt^2 + 4 * r1 * r2 * sin(dPhi / 2)^2`, where a point at lateral
 * offset `t` sits at polar radius `r = R * (1 - t * k)`. Everything here is
 * that identity, with only the sine replaced by its series — so this is
 * accurate to about 1e-6 across the road, not the 0.1% a first-order
 * `(1 - tMean * k)` scaling manages. See docs/devlog/phase-01.md.
 *
 * Entities on different fork branches are never in contact, so they are
 * infinitely far apart — which is the answer combat and collision want.
 */
export function trackDistance(a: TrackPos, b: TrackPos, track: Track): number {
  if (a.branchId !== b.branchId) return Number.POSITIVE_INFINITY;

  const ds = b.s - a.s;
  const dt = b.t - a.t;

  const midS = (a.s + b.s) / 2;
  const curvature = track.curvatureAt(midS, a.branchId);
  if (curvature === 0) return Math.sqrt(ds * ds + dt * dt);

  // Clamp to the road before correcting. Validation guarantees `1 - t * k`
  // stays positive within halfWidth + shoulder; a rider who has left the road
  // entirely is off the geometry this describes and should get a sane
  // distance rather than a negative radius.
  const limit = track.driveableHalfWidthAt(midS, a.branchId);
  const ta = clamp(a.t, -limit, limit);
  const tb = clamp(b.t, -limit, limit);

  const radius = 1 / Math.abs(curvature);
  const ra = radius * (1 - ta * curvature);
  const rb = radius * (1 - tb * curvature);

  const sweep = Math.abs(ds) * Math.abs(curvature);

  // Past the series' range, saturate rather than let it collapse. The chord of
  // any arc is at most the circle's diameter, so `2R + |dt|` is a safe upper
  // bound — and safe here means "never reports a far pair as close", which is
  // the only property a collision check needs. Letting the series run on
  // instead returns near-zero for two vehicles 273 m apart on a tight road,
  // which is a false collision rather than an inaccurate distance.
  if (sweep > SERIES_MAX_SWEEP) return 2 * radius + Math.abs(dt);

  const along = Math.sqrt(ra * rb) * sweep * chordOverArc(sweep);
  return Math.sqrt(along * along + dt * dt);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Race progress: a single monotone scalar comparable across fork branches.
 *
 * `s` is an odometer, not a race position — two riders on different branches
 * measure it along different curves, so `a.s > b.s` is meaningless between
 * them. This maps a branch's own `s` onto the span of the main path it
 * replaces, so both routes reach the rejoin at exactly equal progress however
 * much their lengths differ.
 *
 * Sort standings by this. Never by raw `s`.
 */
export function progress(pos: TrackPos, track: Track): number {
  if (pos.branchId === MAIN_BRANCH) return pos.s;

  const branch = track.branchById(pos.branchId);
  const travelled = pos.s - branch.forkS;
  const mainSpan = branch.rejoinS - branch.forkS;
  return branch.forkS + (travelled / branch.path.length) * mainSpan;
}
