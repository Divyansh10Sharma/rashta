import { trackDistance } from '../track/distance.ts';
import type { Track } from '../track/Track.ts';
import type { HazardKind, SceneryTag } from '../types.ts';
import { TRAFFIC_SIZES } from './traffic.ts';
import type { CrashCause, Rider, TrafficVehicle, Tuning } from './types.ts';

/**
 * What the rider hits, and what happens next.
 *
 * Everything here measures in metres via `trackDistance`, never with a raw
 * `(s, t)` box. Track space is not metric — a rectangle in it is a curved wedge
 * in the world — so a box would make a rider harder to hit on the outside of a
 * bend than the inside, which is the sort of unfairness nobody reports as a bug
 * because it just feels wrong.
 */

/** Half the rider's footprint, in metres. */
const RIDER_HALF_LENGTH = 1.0;
export const RIDER_HALF_WIDTH = 0.45;

/**
 * Districts where leaving the road ends your race.
 *
 * This was going to be derived from `shoulder` — the survivable margin past
 * the road edge — but the data says otherwise: the Old City's shoulders are
 * 0.2-0.4 m against the flyway's 0.4-0.6, so any width threshold makes the
 * wrong route lethal. The Old City is lined with walls you scrape; the flyway
 * is elevated with nothing beside it. That is a fact about the *place*, and
 * the scenery tag is exactly the field that records which place you are in.
 */
const FATAL_EDGE: ReadonlySet<SceneryTag> = new Set<SceneryTag>(['flyway']);

/** Hazards that end the ride rather than merely costing you. */
const CRASHING_HAZARDS: ReadonlySet<HazardKind> = new Set<HazardKind>([
  'barricade',
  'roadworks',
  'cow',
]);

/** Hazards that take grip away instead of taking you off. */
const SLIP_HAZARDS: ReadonlySet<HazardKind> = new Set<HazardKind>([
  'oil',
  'sand',
]);

/** How close, in metres, the rider must be to a hazard to be affected by it. */
const HAZARD_REACH = 1.6;

/** Puts a rider into the crash sequence, if they are not already in one. */
export function crash(rider: Rider, cause: CrashCause, tuning: Tuning): void {
  if (rider.state === 'crashing' || rider.state === 'remounting') return;
  // Just remounted: whatever put you down is still right there.
  if (rider.graceTimer > 0) return;
  rider.state = 'crashing';
  rider.crashCause = cause;
  rider.stateTimer = tuning.crashSeconds;
  rider.lateral = 0;
  rider.lean = 0;
}

/**
 * Advances a crash toward being back on the bike.
 *
 * The cost of a crash is time, not damage — the bike slides, the rider walks
 * back, and the race carries on without them for a fixed few seconds. Returns
 * true if the rider is still down and the rest of the tick should be skipped.
 */
export function stepCrash(rider: Rider, tuning: Tuning, dt: number): boolean {
  if (rider.state === 'crashing') {
    // The bike slides on, shedding speed fast.
    rider.speed = Math.max(0, rider.speed - tuning.crashDecel * dt);
    rider.pos.s += rider.speed * dt;
    rider.stateTimer -= dt;
    if (rider.stateTimer <= 0) {
      rider.state = 'remounting';
      rider.stateTimer = tuning.remountSeconds;
      rider.speed = 0;
    }
    return true;
  }

  if (rider.state === 'remounting') {
    rider.stateTimer -= dt;
    if (rider.stateTimer <= 0) {
      rider.state = 'riding';
      rider.crashCause = null;
      rider.stateTimer = 0;
      // You push the bike back onto the road before getting on it. Without
      // this a rider who went off the edge remounts still against the edge and
      // goes straight off again — an infinite crash, which is exactly what the
      // rideability test caught.
      rider.graceTimer = tuning.remountGraceSeconds;
    }
    return true;
  }

  return false;
}

/** Ends the ride if the rider has run out of road somewhere with no barrier. */
export function checkOffRoad(rider: Rider, track: Track, tuning: Tuning): void {
  const seg = track.segmentAt(rider.pos.s, rider.pos.branchId);
  if (!FATAL_EDGE.has(seg.scenery)) return;
  if (Math.abs(rider.pos.t) >= seg.halfWidth + seg.shoulder - 1e-6) {
    crash(rider, 'cliff', tuning);
  }
}

/** Ends the ride if the rider is inside a vehicle's footprint. */
export function checkTraffic(
  rider: Rider,
  pool: readonly TrafficVehicle[],
  track: Track,
  tuning: Tuning,
): void {
  for (const vehicle of pool) {
    if (!vehicle.active) continue;
    if (vehicle.pos.branchId !== rider.pos.branchId) continue;

    const size = TRAFFIC_SIZES[vehicle.kind];
    const reach = (size.length + size.width) / 4 + RIDER_HALF_LENGTH;
    if (trackDistance(rider.pos, vehicle.pos, track) > reach) continue;

    // Close in metres is not the same as overlapping: a bike alongside a bus
    // in the next lane is within a bus-length but is not touching it.
    const lateral = Math.abs(rider.pos.t - vehicle.pos.t);
    if (lateral > size.width / 2 + RIDER_HALF_WIDTH) continue;

    crash(rider, 'traffic', tuning);
    return;
  }
}

/**
 * Applies whatever hazard the rider is on top of.
 *
 * The track's hazards are sorted by `s`, so this only looks at the handful
 * within reach rather than walking the whole route every tick.
 */
export function checkHazards(rider: Rider, track: Track, tuning: Tuning): void {
  const hazards = track.hazards;
  // You hit a hazard by driving over it, once — not by being near it, every
  // tick. A rider who arrives slowly at a stray dog used to lose six metres a
  // second sixty times a second and could never crawl the metre and a half
  // clear of it. See devlog phase-05.
  const from = Math.min(rider.lastS, rider.pos.s);
  const to = Math.max(rider.lastS, rider.pos.s);
  for (const hazard of hazards) {
    if (hazard.s <= from) continue;
    if (hazard.s > to) break;
    if (hazard.branchId !== rider.pos.branchId) continue;
    if (trackDistance(rider.pos, hazard, track) > HAZARD_REACH) continue;

    if (CRASHING_HAZARDS.has(hazard.kind)) {
      crash(rider, 'hazard', tuning);
      return;
    }
    if (SLIP_HAZARDS.has(hazard.kind)) {
      // Grip goes, control does not: the rider keeps steering but the bike
      // stops answering for a moment.
      rider.slipTimer = Math.max(rider.slipTimer, tuning.slipSeconds);
      return;
    }
    if (hazard.kind === 'pothole') {
      rider.speed = Math.max(0, rider.speed - tuning.potholeSpeedLoss);
      rider.slipTimer = Math.max(rider.slipTimer, tuning.slipSeconds * 0.4);
      return;
    }
    if (hazard.kind === 'dog') {
      // A dog is survivable at low speed and not at high speed, which is the
      // only hazard in the game whose outcome depends on how fast you are.
      if (rider.speed > tuning.dogCrashSpeed) crash(rider, 'hazard', tuning);
      else rider.speed = Math.max(0, rider.speed - tuning.potholeSpeedLoss);
      return;
    }
  }
}
