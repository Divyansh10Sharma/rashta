import { Vec3 } from '../vec.ts';
import { MAIN_BRANCH } from '../types.ts';
import type { TrackData, TrackFrame, TrackSegment } from '../types.ts';
import { headingOf } from './geometry.ts';
import { Path, createFrame } from './path.ts';

/**
 * A validated, precomputed track: the main path plus any fork branches.
 *
 * Positions handed to this class are always track space. World space comes out
 * of `sample()` and is never stored (CLAUDE.md rule 2).
 */

/** How far a branch's end may miss the main path at its `rejoinS`, in metres. */
export const REJOIN_TOLERANCE = 0.5;

/** A branch, with its geometry built and its span on the main path resolved. */
export interface BuiltBranch {
  id: string;
  forkS: number;
  rejoinS: number;
  /** Lateral offset of this branch's centreline from the main one, at the fork. */
  entryT: number;
  path: Path;
}

export class Track {
  private readonly main: Path;
  private readonly builtBranches: BuiltBranch[];

  /** Total length of the main path, in metres. */
  readonly totalLength: number;

  constructor(
    readonly file: string,
    readonly data: TrackData,
  ) {
    this.main = new Path(data.segments, {
      position: new Vec3(0, 0, 0),
      heading: 0,
    });
    this.totalLength = this.main.length;

    const frame = createFrame();
    this.builtBranches = data.branches.map((branch) => {
      this.main.sample(branch.forkS, frame);
      // The branch centreline starts `entryT` metres to the side of the main
      // one, which is where a slip road actually leaves from.
      const start = frame.position
        .clone()
        .addScaledVector(frame.right, branch.entryT);
      const path = new Path(branch.segments, {
        position: start,
        heading: headingOf(frame.forward),
      });
      return {
        id: branch.id,
        forkS: branch.forkS,
        rejoinS: branch.rejoinS,
        entryT: branch.entryT,
        path,
      };
    });

    this.assertBranchesRejoin();
  }

  /**
   * A branch whose geometry does not arrive where its `rejoinS` claims would
   * put riders metres off the road on rejoining, and the symptom would show up
   * far from the cause. Caught here instead.
   */
  private assertBranchesRejoin(): void {
    const branchEnd = createFrame();
    const mainAt = createFrame();
    for (const branch of this.builtBranches) {
      branch.path.sample(branch.path.length, branchEnd);
      this.main.sample(branch.rejoinS, mainAt);
      // The branch rejoins offset by `entryT`, not on the centreline.
      mainAt.position.addScaledVector(mainAt.right, branch.entryT);
      const miss = branchEnd.position.distanceTo(mainAt.position);
      if (miss > REJOIN_TOLERANCE) {
        throw new Error(
          `${this.file}: branch "${branch.id}" ends ${miss.toFixed(3)} m from ` +
            `the main path at rejoinS ${branch.rejoinS}, over the ` +
            `${REJOIN_TOLERANCE} m tolerance — its segments do not close`,
        );
      }
    }
  }

  /** The branches, in declaration order. Branch ids are 1-based. */
  get branches(): readonly BuiltBranch[] {
    return this.builtBranches;
  }

  /** The branch for a 1-based id. Throws if the id is not a real branch. */
  branchById(branchId: number): BuiltBranch {
    const branch = this.builtBranches[branchId - 1];
    if (!branch) {
      throw new Error(`${this.file}: no branch with id ${branchId}`);
    }
    return branch;
  }

  /**
   * Converts a track-space `s` to a distance along whichever path the entity
   * is on. On a branch, `s` continues from the fork rather than restarting.
   */
  private localS(s: number, branchId: number): number {
    return branchId === MAIN_BRANCH ? s : s - this.branchById(branchId).forkS;
  }

  private pathFor(branchId: number): Path {
    return branchId === MAIN_BRANCH
      ? this.main
      : this.branchById(branchId).path;
  }

  /**
   * Fills `out` with the frame at `s` on `branchId`. Allocates nothing and
   * calls no transcendental function.
   */
  sample(
    s: number,
    out: TrackFrame,
    branchId: number = MAIN_BRANCH,
  ): TrackFrame {
    return this.pathFor(branchId).sample(this.localS(s, branchId), out);
  }

  /** The segment covering `s`. */
  segmentAt(s: number, branchId: number = MAIN_BRANCH): TrackSegment {
    return this.pathFor(branchId).segmentAt(this.localS(s, branchId));
  }

  /** Drivable half-width at `s`, in metres, excluding the shoulder. */
  widthAt(s: number, branchId: number = MAIN_BRANCH): number {
    return this.segmentAt(s, branchId).halfWidth;
  }

  /** Survivable half-width at `s`: road plus shoulder. */
  driveableHalfWidthAt(s: number, branchId: number = MAIN_BRANCH): number {
    const seg = this.segmentAt(s, branchId);
    return seg.halfWidth + seg.shoulder;
  }

  /** Lane count at `s`. */
  lanesAt(s: number, branchId: number = MAIN_BRANCH): number {
    return this.segmentAt(s, branchId).lanes;
  }

  /** Signed curvature at `s`, as 1/radius. Positive turns right. */
  curvatureAt(s: number, branchId: number = MAIN_BRANCH): number {
    return this.segmentAt(s, branchId).curvature;
  }
}
