import type { Vec3 } from './vec.ts';

/** Where scenery, lighting, and road material come from. See GAME_DESIGN.md. */
export type SceneryTag = 'ridge' | 'yamuna' | 'ringroad' | 'oldcity' | 'flyway';

/** The kinds of thing that can be sitting in the road. */
export type HazardKind =
  'oil' | 'pothole' | 'roadworks' | 'barricade' | 'dog' | 'cow' | 'sand';

/** A hazard placed at a point on a segment, in track space. */
export interface HazardSpec {
  kind: HazardKind;
  /** Metres from the start of the segment that owns it. */
  offset: number;
  /** Metres left (negative) or right (positive) of the centreline. */
  t: number;
}

/**
 * One constant-curvature arc of road.
 *
 * `curvature` is 1/radius: zero is straight, positive turns right. `gradient`
 * is metres risen per metre of `s`, so `s` measures horizontal distance — see
 * docs/devlog/phase-01.md on why. `bank` is constant across the segment;
 * author a short transition segment where camber needs to change smoothly.
 */
export interface TrackSegment {
  length: number;
  curvature: number;
  gradient: number;
  bank: number;
  halfWidth: number;
  shoulder: number;
  lanes: number;
  oneWay: boolean;
  scenery: SceneryTag;
  hazards: HazardSpec[];
}

/**
 * An alternative route that leaves the main path and returns to it.
 *
 * `forkS` and `rejoinS` are both measured on the **main path**. The branch's
 * own segments carry their own length, which may differ from
 * `rejoinS - forkS` — that difference is what `progress()` normalises away.
 */
export interface TrackBranch {
  id: string;
  forkS: number;
  rejoinS: number;
  /**
   * Where the branch's centreline sits, in main-path `t`, at the split.
   *
   * A slip road leaves from the edge of the road it leaves, not from the
   * middle of it. Without this the two centrelines are coincident at the fork
   * and a rider hugging the outside edge is nowhere near the branch they are
   * plainly next to. On a branch, `t` is measured from the branch's own
   * centreline, so entering subtracts this and rejoining adds it back.
   */
  entryT: number;
  segments: TrackSegment[];
}

/** A hazard resolved to an absolute `s` on a path, ready to collide with. */
export interface PlacedHazard {
  kind: HazardKind;
  /** Metres along the path that owns it. */
  s: number;
  t: number;
  branchId: number;
}

/** A track as it appears on disk, before validation and precompute. */
export interface TrackData {
  id: string;
  name: string;
  scenery: SceneryTag;
  /**
   * Vehicles per kilometre. Per route *and* per tier: the Ring Road carries
   * more than the Ridge at the same tier because that is what those roads
   * are, and a tier lookup table could not express it. See
   * docs/devlog/phase-04.md.
   */
  trafficDensity: number;
  /** Police riders per kilometre. Zero at tier 1, by design. */
  policeDensity: number;
  segments: TrackSegment[];
  branches: TrackBranch[];
}

/** The main path's branch id. Entities start here and return here. */
export const MAIN_BRANCH = 0;

/**
 * A position in track space. This is the only kind of position `src/core/`
 * stores — world space is derived at render time (CLAUDE.md rule 2).
 */
export interface TrackPos {
  /** Metres along the centreline of whichever branch this entity is on. */
  s: number;
  /** Metres left (negative) or right (positive) of that centreline. */
  t: number;
  /** `MAIN_BRANCH`, or 1-based index into the track's branches. */
  branchId: number;
}

/**
 * The moving reference frame at some `s`. Caller-owned and reused: `sample()`
 * fills one of these rather than returning a fresh object.
 */
export interface TrackFrame {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  halfWidth: number;
  shoulder: number;
  lanes: number;
  /** Signed 1/radius at this point, for the curvature correction in §1.4. */
  curvature: number;
}
