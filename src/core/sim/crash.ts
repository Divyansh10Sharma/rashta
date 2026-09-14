import type { CrashCause, CrashSeverity, Rider, Tuning } from './types.ts';

/**
 * The crash, from impact to riding again.
 *
 * The cost of a crash is **derived, never configured**. A constant recovery
 * time makes a 90 km/h tip-over cost exactly what a 250 km/h highside costs,
 * which turns the worst moment in the game into a pause. Everything here
 * exists so the penalty falls out of the physics — see ARCHITECTURE.md 3.1.
 *
 * The mechanism, in one line: the rider and the bike separate on impact, slide
 * under different friction, and the rider has to walk to wherever the bike
 * ended up. Faster impact, further apart, longer walk.
 *
 * No transcendental function appears here. `h` integrates under constant
 * gravity, which is a quadratic, and the only irrational operation is
 * `Math.sqrt` — which IEEE-754 does specify exactly. Rule 4 survives a crash.
 */

/** Whether a rider is anywhere in the crash sequence. */
export function isDown(rider: Rider): boolean {
  switch (rider.state) {
    case 'airborne':
    case 'sliding':
    case 'downed':
    case 'rising':
    case 'running':
    case 'remounting':
      return true;
    default:
      return false;
  }
}

/** Which band an impact at `speed` metres per second falls into. */
export function severityFor(speed: number, tuning: Tuning): CrashSeverity {
  if (speed >= tuning.crashHighsideSpeed) return 'highside';
  if (speed >= tuning.crashThrownSpeed) return 'thrown';
  return 'tipover';
}

/**
 * How hard a cause throws the rider, as a fraction of impact speed.
 *
 * Head-on into a bus is not clipping a kerb is not being kicked off. The
 * numbers live in `tuning.json`; only the mapping lives here.
 */
function launchFor(cause: CrashCause, tuning: Tuning): number {
  switch (cause) {
    case 'traffic':
      return tuning.crashLaunchTraffic;
    case 'hazard':
      return tuning.crashLaunchHazard;
    case 'cliff':
      return tuning.crashLaunchCliff;
    case 'combat':
      return tuning.crashLaunchCombat;
  }
}

/** Puts a rider into the crash sequence, if they are not already in one. */
export function crash(rider: Rider, cause: CrashCause, tuning: Tuning): void {
  if (isDown(rider)) return;
  // Just remounted: whatever put you down is still right there.
  if (rider.graceTimer > 0) return;

  const impact = rider.speed;
  const severity = severityFor(impact, tuning);
  rider.severity = severity;
  rider.crashCause = cause;
  rider.stateTimer = 0;

  // The machine goes on without its rider, from where the rider was.
  rider.bikePos.s = rider.pos.s;
  rider.bikePos.t = rider.pos.t;
  rider.bikePos.branchId = rider.pos.branchId;
  rider.bikeSpeed = impact * tuning.crashBikeSpeedFactor;

  rider.speed = impact * tuning.crashRiderSpeedFactor;
  rider.lateral = 0;
  rider.lean = 0;
  // Whatever put you down ends the swing, whichever order things resolved in.
  rider.attack = null;
  rider.attackElapsed = 0;
  rider.staggerTimer = 0;
  rider.h = 0;
  rider.hVel = 0;

  // A tip-over does not leave the ground. It is the band that should feel like
  // a mistake rather than an event.
  if (severity === 'tipover') {
    rider.state = 'sliding';
    return;
  }

  const scale = severity === 'highside' ? tuning.crashHighsideLaunchScale : 1;
  rider.hVel = impact * launchFor(cause, tuning) * scale;
  rider.state = 'airborne';
}

/** The bike slides on alone, and keeps sliding while the rider is getting up. */
function slideBike(rider: Rider, tuning: Tuning, dt: number): void {
  if (rider.bikeSpeed <= 0) return;
  rider.bikeSpeed -= tuning.crashBikeFriction * dt;
  if (rider.bikeSpeed < 0) rider.bikeSpeed = 0;
  rider.bikePos.s += rider.bikeSpeed * dt;
}

function stepAirborne(rider: Rider, tuning: Tuning, dt: number): void {
  rider.hVel -= tuning.crashGravity * dt;
  rider.h += rider.hVel * dt;
  // Nothing slows a rider in the air, which is why a launch costs distance as
  // well as time — you land further from the bike than you left it.
  rider.pos.s += rider.speed * dt;
  if (rider.h <= 0) {
    rider.h = 0;
    rider.hVel = 0;
    rider.state = 'sliding';
  }
}

function stepSliding(rider: Rider, tuning: Tuning, dt: number): void {
  rider.speed -= tuning.crashRiderFriction * dt;
  if (rider.speed <= 0) rider.speed = 0;
  rider.pos.s += rider.speed * dt;
  if (rider.speed > 0) return;
  rider.state = 'downed';
  rider.stateTimer = tuning.downedSeconds;
}

/**
 * Walks the rider to wherever the bike stopped.
 *
 * This is the stage that makes the penalty scale: the distance was set by the
 * impact, and no input shortens it.
 */
function stepRunning(rider: Rider, tuning: Tuning, dt: number): void {
  const ds = rider.bikePos.s - rider.pos.s;
  const dt_ = rider.bikePos.t - rider.pos.t;
  const gap = Math.sqrt(ds * ds + dt_ * dt_);
  const stride = tuning.runSpeed * dt;

  if (gap <= stride) {
    rider.pos.s = rider.bikePos.s;
    rider.pos.t = rider.bikePos.t;
    rider.state = 'remounting';
    rider.stateTimer = tuning.remountSeconds;
    return;
  }

  const k = stride / gap;
  rider.pos.s += ds * k;
  rider.pos.t += dt_ * k;
}

function stepRemounting(rider: Rider, tuning: Tuning, dt: number): void {
  rider.stateTimer -= dt;
  if (rider.stateTimer > 0) return;
  rider.state = 'riding';
  rider.crashCause = null;
  rider.severity = null;
  rider.stateTimer = 0;
  rider.speed = 0;
  // You push the bike back onto the road before getting on it. Without this a
  // rider who went off the edge remounts still against the edge and goes
  // straight off again — an infinite crash, which is what the rideability test
  // caught in Phase 4. The recentre itself lives in `step.ts`.
  rider.graceTimer = tuning.remountGraceSeconds;
}

/**
 * Advances a crash by one tick.
 *
 * Returns true if the rider is still down and the rest of the tick should be
 * skipped — they are not steering, braking or leaning until they are back up.
 */
export function stepCrash(rider: Rider, tuning: Tuning, dt: number): boolean {
  if (!isDown(rider)) return false;
  slideBike(rider, tuning, dt);

  switch (rider.state) {
    case 'airborne':
      stepAirborne(rider, tuning, dt);
      return true;
    case 'sliding':
      stepSliding(rider, tuning, dt);
      return true;
    case 'downed':
      rider.stateTimer -= dt;
      if (rider.stateTimer <= 0) {
        rider.state = 'rising';
        rider.stateTimer = tuning.risingSeconds;
      }
      return true;
    case 'rising':
      rider.stateTimer -= dt;
      if (rider.stateTimer <= 0) {
        rider.state = 'running';
        rider.stateTimer = 0;
        // The bike has had the whole downed-and-rising pause to stop. If it
        // somehow has not, it stops now: a rider chasing a bike faster than
        // they can run never remounts, and no state may strand a rider.
        rider.bikeSpeed = 0;
      }
      return true;
    case 'running':
      stepRunning(rider, tuning, dt);
      return true;
    case 'remounting':
      stepRemounting(rider, tuning, dt);
      return true;
    default:
      return false;
  }
}
