import { MAIN_BRANCH } from '../types.ts';
import type { Track } from '../track/Track.ts';
import { curveAt } from './bike.ts';
import {
  checkHazards,
  checkOffRoad,
  checkTraffic,
  stepCrash,
} from './collide.ts';
import { stepTraffic } from './traffic.ts';
import type { InputFrame, Rider, Tuning, WorldState } from './types.ts';

/**
 * The simulation tick.
 *
 * Fixed `dt`, no wall clock, no `Math.random` outside the seeded RNG, and no
 * transcendental function anywhere it can reach — the guarantees in
 * CLAUDE.md rule 4 all live or die here.
 *
 * The bike is an arcade model, not a rigid body: five scalars per rider, of
 * which only `speed` and `lateral` affect motion. See ARCHITECTURE.md 3.
 */

/** Exactly 1/60 s. The simulation advances by this and nothing else. */
export const FIXED_DT = 1 / 60;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Integrates speed from throttle, brake, coasting drag, and the grip penalty
 * for carrying too much speed into a bend.
 */
function stepSpeed(
  rider: Rider,
  input: InputFrame,
  track: Track,
  tuning: Tuning,
  dt: number,
): void {
  const { topSpeedMs, accelScale, spec } = rider.bike;
  const u = rider.speed / topSpeedMs;

  if (input.throttle > 0) {
    rider.speed +=
      accelScale * curveAt(spec.accelCurve, u) * input.throttle * dt;
  } else {
    rider.speed -= tuning.coastDecel * dt;
  }

  if (input.brake > 0) {
    rider.speed -= tuning.brakeDecel * input.brake * dt;
  }

  // Cornering scrub. A bend demands lateral acceleration of v^2 * curvature;
  // past what the tyres will give, the excess comes off the speed rather than
  // out of the rider's control, which is the arcade compromise.
  const curvature = Math.abs(
    track.curvatureAt(rider.pos.s, rider.pos.branchId),
  );
  if (curvature > 0) {
    const demanded = rider.speed * rider.speed * curvature;
    const excess = demanded - tuning.gripLateralLimit;
    if (excess > 0) rider.speed -= excess * tuning.gripScrub * dt;
  }

  rider.speed = clamp(rider.speed, 0, topSpeedMs);
}

/**
 * Integrates lateral motion. Lean input asks for a lateral velocity rather
 * than setting one, and the ask shrinks as speed rises — which is what makes
 * the bike feel heavy at speed without simulating any actual weight.
 */
function stepLateral(
  rider: Rider,
  input: InputFrame,
  track: Track,
  tuning: Tuning,
  dt: number,
): void {
  const speedFactor =
    tuning.lateralSpeedFalloff / (tuning.lateralSpeedFalloff + rider.speed);

  // Oil, sand and potholes take grip away without taking control away: the
  // bars still turn, the bike just stops answering properly for a moment.
  const grip = rider.slipTimer > 0 ? tuning.slipGrip : 1;

  const target =
    input.lean *
    tuning.maxLateralSpeed *
    rider.bike.spec.handling *
    speedFactor *
    grip;

  const response = clamp(tuning.lateralResponse * dt, 0, 1);
  rider.lateral += (target - rider.lateral) * response;
  rider.pos.t += rider.lateral * dt;

  clampToRoad(rider, track);
}

/**
 * Riders may use the shoulder but not go past it. Leaving the road properly is
 * Phase 4's problem.
 *
 * Called again after any route change, because a branch can be much narrower
 * than the road it leaves — and because the road itself narrows at segment
 * boundaries.
 */
function clampToRoad(rider: Rider, track: Track): void {
  const limit = track.driveableHalfWidthAt(rider.pos.s, rider.pos.branchId);
  if (rider.pos.t > limit) {
    rider.pos.t = limit;
    if (rider.lateral > 0) rider.lateral = 0;
  } else if (rider.pos.t < -limit) {
    rider.pos.t = -limit;
    if (rider.lateral < 0) rider.lateral = 0;
  }
}

/**
 * Lean angle and wheel spin. Both are cosmetic: the renderer reads them, and
 * nothing in the simulation ever does.
 */
function stepCosmetic(
  rider: Rider,
  track: Track,
  tuning: Tuning,
  dt: number,
): void {
  const curvature = track.curvatureAt(rider.pos.s, rider.pos.branchId);
  const target = clamp(
    rider.lateral * tuning.leanFromLateral +
      curvature * rider.speed * tuning.leanFromCurvature,
    -tuning.leanMax,
    tuning.leanMax,
  );

  const response = clamp(tuning.leanResponse * dt, 0, 1);
  rider.lean += (target - rider.lean) * response;
  rider.wheelAngle += (rider.speed / tuning.wheelRadius) * dt;
}

/** How far off centre a rider must be at the split to be taken onto a branch. */
export const FORK_CAPTURE_T = 1.5;

/**
 * Moves a rider onto a fork branch, or back off one.
 *
 * Which branch a rider takes is decided by the branch's own geometry rather
 * than by a field in the data file: the first segment's curvature says which
 * way the road peels off, so drifting right at the split takes the right-hand
 * road. Nothing to keep in sync, and the rule matches what the split looks
 * like on screen.
 *
 * Rejoining is unconditional — reach the end of the branch and you are back on
 * the main path at its `rejoinS`, carrying `t` across.
 */
function stepRoute(rider: Rider, track: Track, previousS: number): void {
  if (rider.pos.branchId === MAIN_BRANCH) {
    for (let i = 0; i < track.branches.length; i += 1) {
      const branch = track.branches[i];
      if (!branch) continue;
      // Only at the tick the rider crosses the split, never after.
      if (previousS >= branch.forkS || rider.pos.s < branch.forkS) continue;

      const first = branch.path.segments[0];
      if (!first || first.curvature === 0) continue;
      const side = first.curvature > 0 ? 1 : -1;

      // Committed to that side of the road at all?
      if (rider.pos.t * side < FORK_CAPTURE_T) continue;

      // And actually alongside the branch's mouth. `t` on a branch is measured
      // from the branch's own centreline, so entering is a translation, not a
      // snap — a rider hugging the outside edge of a wide road is exactly on
      // the outside edge of the slip road leaving it.
      const local = rider.pos.t - branch.entryT;
      if (Math.abs(local) > first.halfWidth + first.shoulder) continue;

      rider.pos.t = local;
      rider.pos.branchId = i + 1;
      return;
    }
    return;
  }

  const branch = track.branchById(rider.pos.branchId);
  const end = branch.forkS + branch.path.length;
  if (rider.pos.s >= end) {
    rider.pos.s = branch.rejoinS + (rider.pos.s - end);
    rider.pos.t += branch.entryT;
    rider.pos.branchId = MAIN_BRANCH;
  }
}

/** Advances one rider by one tick. */
export function stepRider(
  rider: Rider,
  input: InputFrame,
  track: Track,
  tuning: Tuning,
  dt: number,
): void {
  // Recorded before anything moves, including the crash slide, so a hazard
  // check that runs after the tick can tell what was driven over.
  rider.lastS = rider.pos.s;
  if (rider.slipTimer > 0) rider.slipTimer -= dt;
  if (rider.graceTimer > 0) rider.graceTimer -= dt;
  // A rider on the tarmac is not steering, braking, or leaning. Everything
  // below is skipped until they are back up.
  if (stepCrash(rider, tuning, dt)) return;

  const previousS = rider.pos.s;
  stepSpeed(rider, input, track, tuning, dt);
  stepLateral(rider, input, track, tuning, dt);
  rider.pos.s += rider.speed * dt;
  stepRoute(rider, track, previousS);
  // `s` moved and the branch may have changed, so the road under the rider is
  // not the one stepLateral clamped against.
  clampToRoad(rider, track);
  // A remount puts the rider back toward the middle of the road, not against
  // whatever edge they left by.
  if (rider.graceTimer > 0) {
    const pull = tuning.remountRecentre * dt;
    if (Math.abs(rider.pos.t) > pull)
      rider.pos.t -= Math.sign(rider.pos.t) * pull;
    else rider.pos.t = 0;
  }
  stepCosmetic(rider, track, tuning, dt);
}

/**
 * Advances the world by exactly one tick.
 *
 * Order is fixed and matters — see ARCHITECTURE.md 4. Only the player exists
 * before Phase 5.
 */
export function step(
  world: WorldState,
  input: InputFrame,
  track: Track,
  tuning: Tuning,
  dt: number = FIXED_DT,
): void {
  stepRider(world.player, input, track, tuning, dt);
  stepTraffic(
    world.traffic,
    track,
    world.player.pos.s,
    world.player.pos.s,
    world.rng,
    tuning,
    dt,
  );

  // Collisions resolve once, at the end, after everything has moved — so the
  // answer does not depend on the order things were stepped in.
  // ARCHITECTURE.md 4.
  if (world.player.state === 'riding') {
    checkHazards(world.player, track, tuning);
    checkTraffic(world.player, world.traffic, track, tuning);
    checkOffRoad(world.player, track, tuning);
  }

  world.tick += 1;
}
