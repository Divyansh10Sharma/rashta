import type { Track } from '../track/Track.ts';
import { curveAt } from './bike.ts';
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

  const target =
    input.lean *
    tuning.maxLateralSpeed *
    rider.bike.spec.handling *
    speedFactor;

  const response = clamp(tuning.lateralResponse * dt, 0, 1);
  rider.lateral += (target - rider.lateral) * response;
  rider.pos.t += rider.lateral * dt;

  // Riders may use the shoulder but not go past it. Leaving the road properly
  // is Phase 4's problem.
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

/** Advances one rider by one tick. */
export function stepRider(
  rider: Rider,
  input: InputFrame,
  track: Track,
  tuning: Tuning,
  dt: number,
): void {
  stepSpeed(rider, input, track, tuning, dt);
  stepLateral(rider, input, track, tuning, dt);
  rider.pos.s += rider.speed * dt;
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
  world.tick += 1;
}
