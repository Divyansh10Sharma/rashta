import { trackDistance } from '../track/distance.ts';
import { startAttack } from '../combat/combat.ts';
import { createRider } from '../sim/world.ts';
import type { Track } from '../track/Track.ts';
import type { Rider, RiderState, TunedBike } from '../sim/types.ts';
import type { CombatData } from '../combat/types.ts';
import type { PoliceData, PoliceUnit } from './types.ts';

/**
 * Police riders.
 *
 * They are `Rider`s on the same road through the same `stepRider`, so pursuit
 * is a function returning an `InputFrame` and a ram is a kick the combat system
 * already had. Building them as a distinct entity with its own movement would
 * have been a second physics and a second set of bugs.
 *
 * They live in `race.riders` so rivals and collisions see them, and never in
 * `race.entries`, because they are not racing and must not appear in the
 * standings.
 */

/** Metres ahead of the pack a patrolling officer is placed. */
const PATROL_AHEAD = 320;

/** Metres of road one officer covers before another is worth having. */
const PATROL_SPACING = 240;

/** Lean input per metre of lateral error. Matches the rivals' gain. */
const STEER_GAIN = 0.55;

/** Builds the police detail for a route, sized from its density. */
export function createPolice(
  track: Track,
  bike: TunedBike,
  count?: number,
): PoliceUnit[] {
  const km = track.totalLength / 1000;
  const wanted = count ?? Math.round(track.data.policeDensity * km);

  const units: PoliceUnit[] = [];
  for (let i = 0; i < wanted; i += 1) {
    units.push({
      rider: createRider(bike, PATROL_AHEAD + i * PATROL_SPACING, 0),
      input: { throttle: 0, brake: 0, lean: 0, attack: null },
      state: 'patrolling',
      target: -1,
      slowFor: 0,
      ramTimer: 0,
      blocking: false,
      noticeTimer: 0,
      targetT: 0,
      active: true,
    });
  }
  return units;
}

/** The gap from an officer to its quarry, in metres along the road. */
function gapTo(unit: PoliceUnit, target: Rider, track: Track): number {
  if (unit.rider.pos.branchId !== target.pos.branchId) return Infinity;
  return trackDistance(unit.rider.pos, target.pos, track);
}

/**
 * Decides who, if anyone, this officer is chasing.
 *
 * Pursuit starts on speed and ends on speed sustained, distance, or the target
 * being off the road. All three have to work, because "escaping pursuit is
 * possible" is an acceptance criterion and one exit is not an escape.
 */
function updatePursuit(
  unit: PoliceUnit,
  riders: readonly Rider[],
  track: Track,
  data: PoliceData,
  dt: number,
): Rider | null {
  const { pursuit } = data;

  if (unit.state === 'pursuing') {
    const quarry = riders[unit.target];
    if (!quarry) {
      unit.state = 'patrolling';
      unit.target = -1;
      return null;
    }
    if (quarry.speed < pursuit.dropSpeed) unit.slowFor += dt;
    else unit.slowFor = 0;

    const lost =
      unit.slowFor >= pursuit.dropSeconds ||
      gapTo(unit, quarry, track) > pursuit.loseDistance;
    if (lost) {
      unit.state = 'patrolling';
      unit.target = -1;
      unit.slowFor = 0;
      // A fresh reaction delay, so shaking one officer is worth something even
      // if you speed up again immediately.
      unit.noticeTimer = pursuit.reactionSeconds;
      return null;
    }
    return quarry;
  }

  // Patrolling: notice the nearest rider going noticeably fast.
  if (unit.noticeTimer > 0) {
    unit.noticeTimer -= dt;
    return null;
  }
  let bestAt = pursuit.loseDistance;
  let bestIndex = -1;
  for (let i = 0; i < riders.length; i += 1) {
    const rider = riders[i];
    if (!rider || rider.speed < pursuit.triggerSpeed) continue;
    const at = gapTo(unit, rider, track);
    if (at < bestAt) {
      bestAt = at;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;

  unit.state = 'pursuing';
  unit.target = bestIndex;
  unit.slowFor = 0;
  return riders[bestIndex] ?? null;
}

/**
 * Advances every officer: pursuit, steering, throttle, and the ram.
 *
 * `riders` is indexed, and `unit.target` is an index into it, so the field
 * handed in here must be the same array every tick.
 */
export function stepPolice(
  units: PoliceUnit[],
  riders: readonly Rider[],
  track: Track,
  data: PoliceData,
  combat: CombatData,
  dt: number,
): void {
  for (const unit of units) {
    if (!unit.active) continue;
    const rider = unit.rider;
    if (unit.ramTimer > 0) unit.ramTimer -= dt;

    const quarry = updatePursuit(unit, riders, track, data, dt);
    const halfWidth = track.driveableHalfWidthAt(
      rider.pos.s,
      rider.pos.branchId,
    );

    if (!quarry) {
      // Patrolling: hold the middle of the road at a steady, legal pace.
      unit.blocking = false;
      unit.targetT = 0;
      unit.input.lean = clamp(-rider.pos.t * STEER_GAIN, -1, 1);
      const cruising = data.pursuit.dropSpeed * 0.8;
      unit.input.throttle = rider.speed < cruising ? 1 : 0;
      unit.input.brake = rider.speed > cruising * 1.15 ? 0.3 : 0;
      continue;
    }

    // Sit on their line, whichever side of them we are.
    unit.targetT = clamp(quarry.pos.t, -halfWidth, halfWidth);
    unit.input.lean = clamp((unit.targetT - rider.pos.t) * STEER_GAIN, -1, 1);

    // Blocking is being in front and *staying* there. An officer ahead at full
    // throttle simply drives away, which is the opposite of an obstruction —
    // so once in front, match the quarry's pace and hold the line.
    const ahead =
      rider.pos.branchId === quarry.pos.branchId
        ? rider.pos.s - quarry.pos.s
        : -1;
    unit.blocking = ahead > 0 && ahead < data.pursuit.blockGap;

    if (unit.blocking) {
      unit.input.throttle = rider.speed < quarry.speed ? 1 : 0;
      unit.input.brake = rider.speed > quarry.speed * 1.05 ? 0.25 : 0;
    } else {
      unit.input.throttle = 1;
      unit.input.brake = 0;
    }

    const gap = gapTo(unit, quarry, track);
    const alongside = gap <= data.pursuit.closeGap;
    if (alongside && unit.ramTimer <= 0) {
      // A ram is a kick: it is the attack that pushes laterally, and reusing it
      // means an officer shows the same wind-up glow a rival does.
      if (startAttack(rider, 'kick', combat)) {
        unit.ramTimer = data.pursuit.ramCooldown;
      }
    }
  }
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Whether `rider` was busted: down, and within the arrest radius of an officer
 * who was chasing them.
 *
 * Measured with `trackDistance`. Phase 6's lesson was that a range measured by
 * subtracting coordinates is wrong on a bend in both directions, and an arrest
 * radius is not exempt.
 */
/** The crash stages during which an officer can actually reach you. */
const ARRESTABLE: ReadonlySet<RiderState> = new Set<RiderState>([
  'downed',
  'rising',
  'running',
]);

export function arrestedBy(
  rider: Rider,
  units: readonly PoliceUnit[],
  track: Track,
  data: PoliceData,
): PoliceUnit | null {
  // On the ground, not in the air. An officer pulls up beside a rider who is
  // down and getting up; one still mid-tumble has not stopped moving yet.
  if (!ARRESTABLE.has(rider.state)) return null;
  for (const unit of units) {
    if (!unit.active || unit.state !== 'pursuing') continue;
    if (unit.rider.pos.branchId !== rider.pos.branchId) continue;
    if (Math.abs(unit.rider.pos.s - rider.pos.s) > data.arrest.radius) continue;
    if (trackDistance(unit.rider.pos, rider.pos, track) > data.arrest.radius) {
      continue;
    }
    return unit;
  }
  return null;
}
