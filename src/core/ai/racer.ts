import { TRAFFIC_SIZES } from '../sim/traffic.ts';
import { RIDER_HALF_WIDTH } from '../sim/collide.ts';
import { engagedWith, reachOf } from '../combat/combat.ts';
import { trackDistance } from '../track/distance.ts';
import type { AttackKind, CombatData } from '../combat/types.ts';
import type { Track } from '../track/Track.ts';
import type {
  InputFrame,
  Rider,
  TrafficVehicle,
  Tuning,
} from '../sim/types.ts';
import type { RacerBrain, RacerProfile } from './types.ts';

/**
 * A rival rider's brain.
 *
 * It may write to an `InputFrame` and to its own `RacerBrain`, and to nothing
 * else. Rivals go through the same `stepRider` as the player, so an AI that
 * could set its own position would put thirteen of the fourteen riders outside
 * every physics guarantee the simulation makes. See devlog phase-05 §1.
 */

/** Lateral lines considered when picking a way through. Odd, so 0 is included. */
const LINE_SAMPLES = 9;

/** Metres of clear road a rider wants beside an obstacle it passes. */
const PASSING_MARGIN = 0.35;

/**
 * Walking pace, in m/s, that a rider is always allowed to make.
 *
 * A speed limit of exactly zero is absorbing: a rider stopped by something can
 * never move, so the geometry that stopped it can never change, and on a
 * narrow two-way street a queue of them parks permanently. Filtering forward
 * at walking pace always resolves it, and if it resolves it into a bus, the
 * crash slide is still progress. See devlog phase-05.
 */
const CREEP = 2.2;

/** Curvature below this is a straight; dividing by it would give nonsense. */
const STRAIGHT = 1e-5;

/** Points sampled along the road ahead when working out how fast to go. */
const CORNER_SAMPLES = 6;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Where this racer sits when nothing is in the way, in metres right of centre.
 *
 * Derived from `caution` rather than stored: a cautious rider keeps to their
 * own side of the road, a bold one uses the crown of it, and on a two-way
 * street that is the difference that gets one of them killed.
 */
export function preferredT(profile: RacerProfile, halfWidth: number): number {
  return (0.15 + 0.6 * profile.caution) * halfWidth;
}

/** How far ahead this racer is reading the road, in metres. */
function lookahead(
  profile: RacerProfile,
  speed: number,
  tuning: Tuning,
): number {
  const seconds = tuning.aiLookahead * (0.6 + 0.8 * profile.skill);
  return speed * seconds + tuning.aiLookaheadFloor;
}

/**
 * The speed the road ahead allows right now, in m/s.
 *
 * For each point sampled ahead, `sqrt(grip / curvature)` is the speed that
 * corner will take, and `sqrt(v^2 + 2*a*d)` is therefore the speed that may be
 * carried `d` metres before it. Taking the minimum over the samples is what
 * makes reading further ahead an advantage rather than a handicap: a rider who
 * only capped speed at the sharpest bend in sight got slower the further they
 * looked, so skill cancelled itself out and the field finished in a random
 * order. See devlog phase-05.
 *
 * Square roots only. Nothing transcendental gets into the simulation.
 */
function cornerLimit(
  rider: Rider,
  profile: RacerProfile,
  track: Track,
  tuning: Tuning,
  reach: number,
): number {
  const grip = tuning.gripLateralLimit * (0.7 + 0.3 * profile.skill);
  // Braking margin, not braking maximum: a rider who plans on the absolute
  // limit arrives at every corner already too fast.
  const decel = tuning.brakeDecel * 0.8;

  let limit = rider.bike.topSpeedMs;
  for (let i = 0; i <= CORNER_SAMPLES; i += 1) {
    const d = (reach * i) / CORNER_SAMPLES;
    const k = Math.abs(track.curvatureAt(rider.pos.s + d, rider.pos.branchId));
    if (k < STRAIGHT) continue;
    const corner = grip / k;
    limit = Math.min(limit, Math.sqrt(corner + 2 * decel * d));
  }
  return limit;
}

/**
 * How much a rider at `t` is inconvenienced by everything ahead of it.
 *
 * Distance-weighted rather than boolean: a bus forty metres away should bend
 * the line, and the same bus four metres away should be the only thing that
 * matters.
 */
function blockage(
  t: number,
  rider: Rider,
  profile: RacerProfile,
  field: readonly Rider[],
  traffic: readonly TrafficVehicle[],
  reach: number,
): number {
  let worst = 0;
  const branch = rider.pos.branchId;

  for (const other of traffic) {
    if (!other.active || other.pos.branchId !== branch) continue;
    const gap = other.pos.s - rider.pos.s;
    if (gap <= 0 || gap > reach) continue;
    const size = TRAFFIC_SIZES[other.kind];
    const need = size.width / 2 + RIDER_HALF_WIDTH + PASSING_MARGIN;
    if (Math.abs(t - other.pos.t) >= need) continue;
    // Oncoming traffic closes at the sum of both speeds, so the same gap is
    // worth much less time. A cautious rider feels that; a bold one does not.
    const urgency = other.oncoming ? 2.5 - profile.aggression : 1;
    worst = Math.max(worst, ((reach - gap) / reach) * urgency);
  }

  for (const other of field) {
    if (other === rider || other.pos.branchId !== branch) continue;
    const gap = other.pos.s - rider.pos.s;
    if (gap <= 0 || gap > reach) continue;
    const need = 2 * RIDER_HALF_WIDTH + PASSING_MARGIN;
    if (Math.abs(t - other.pos.t) >= need) continue;
    worst = Math.max(worst, (reach - gap) / reach);
  }

  return worst;
}

/** Picks the line: the cheapest compromise between preferred and passable. */
function chooseLine(
  rider: Rider,
  profile: RacerProfile,
  field: readonly Rider[],
  traffic: readonly TrafficVehicle[],
  track: Track,
  reach: number,
): number {
  const halfWidth = track.driveableHalfWidthAt(rider.pos.s, rider.pos.branchId);
  const want = clamp(preferredT(profile, halfWidth), -halfWidth, halfWidth);
  const usable = halfWidth - RIDER_HALF_WIDTH;

  let bestT = want;
  let bestCost = Infinity;
  for (let i = 0; i < LINE_SAMPLES; i += 1) {
    const t = -usable + (2 * usable * i) / (LINE_SAMPLES - 1);
    // Wandering costs something even when it is free, or a rider drifts across
    // the road whenever two lines tie.
    const drift = Math.abs(t - want) / (usable > 0 ? usable : 1);
    const cost =
      blockage(t, rider, profile, field, traffic, reach) *
        (1.2 + profile.caution) +
      drift * 0.35;
    if (cost < bestCost) {
      bestCost = cost;
      bestT = t;
    }
  }
  return bestT;
}

/** The speed the nearest thing in this rider's line allows, in m/s. */
function followLimit(
  rider: Rider,
  profile: RacerProfile,
  field: readonly Rider[],
  traffic: readonly TrafficVehicle[],
  target: number,
  reach: number,
): number {
  let limit = rider.bike.topSpeedMs;
  const branch = rider.pos.branchId;
  const safeGap = 5 + 9 * profile.caution;

  // What you hit is decided by the line you are on, not the line you meant to
  // take. A rider halfway through a move has to respect both.
  const near = (t: number): number =>
    Math.min(Math.abs(target - t), Math.abs(rider.pos.t - t));

  for (const other of traffic) {
    if (!other.active || other.pos.branchId !== branch) continue;
    const gap = other.pos.s - rider.pos.s;
    if (gap <= 0 || gap > reach) continue;
    const size = TRAFFIC_SIZES[other.kind];
    if (near(other.pos.t) >= size.width / 2 + RIDER_HALF_WIDTH) continue;
    // Something coming the other way is not a car to follow, it is a wall.
    const pace = other.oncoming ? 0 : other.speed;
    limit = Math.min(limit, pace + Math.max(0, gap - safeGap) * 1.6);
  }

  for (const other of field) {
    if (other === rider || other.pos.branchId !== branch) continue;
    const gap = other.pos.s - rider.pos.s;
    if (gap <= 0 || gap > reach) continue;
    if (near(other.pos.t) >= 2 * RIDER_HALF_WIDTH) continue;
    limit = Math.min(limit, other.speed + Math.max(0, gap - safeGap) * 1.6);
  }

  return Math.max(limit, CREEP);
}

/**
 * Decides whether to swing, and with what.
 *
 * Aggression sets how often a rival attacks at all; vengefulness sets how long
 * being hit keeps it interested. A rival with low aggression and high
 * vengefulness — Pritam Sodhi — never starts anything and does not let go.
 */
function chooseAttack(
  rider: Rider,
  profile: RacerProfile,
  brain: RacerBrain,
  field: readonly Rider[],
  track: Track,
  data: CombatData,
  dt: number,
): AttackKind | null {
  // An unexplained fall in stamina is the only evidence a rival gets that
  // somebody hit it. Regeneration only ever raises it.
  if (rider.stamina < brain.lastStamina - 0.001) {
    brain.grudge = 2 + 6 * profile.vengefulness;
  }
  brain.lastStamina = rider.stamina;
  if (brain.grudge > 0) brain.grudge -= dt;
  if (brain.swingTimer > 0) brain.swingTimer -= dt;

  if (rider.state !== 'riding' || rider.attack !== null) return null;
  if (brain.swingTimer > 0) return null;

  const heat = profile.aggression + (brain.grudge > 0 ? 0.5 : 0);
  if (heat < 0.35) return null;

  const target = engagedWith(rider, field, track, data);
  if (!target) return null;

  // Only swing at something actually in reach, measured along the road.
  const kind: AttackKind =
    heat > 1.0 && rider.stamina > 55
      ? 'backhand'
      : Math.abs(target.pos.t - rider.pos.t) > 1.2
        ? 'kick'
        : 'punch';
  const spec = data.attacks[kind];
  if (rider.stamina <= spec.cost * 2) return null;
  if (
    trackDistance(rider.pos, target.pos, track) > reachOf(rider, spec, data)
  ) {
    return null;
  }

  // A rival that swings every time it can is a rival that is always in
  // recovery, and recovery is where you crash.
  brain.swingTimer = 2.4 - 1.6 * profile.aggression;
  return kind;
}

/**
 * Advances one rival's decisions and writes its input for this tick.
 *
 * `brain.pace` is applied here rather than computed here: rubber-banding needs
 * to know where the player is, and this function deliberately does not.
 */
export function think(
  rider: Rider,
  profile: RacerProfile,
  brain: RacerBrain,
  field: readonly Rider[],
  traffic: readonly TrafficVehicle[],
  track: Track,
  tuning: Tuning,
  combat: CombatData,
  out: InputFrame,
  dt: number,
): void {
  const reach = lookahead(profile, rider.speed, tuning);

  brain.thinkTimer -= dt;
  if (brain.thinkTimer <= 0) {
    // A line reconsidered every tick is not a decision: the rider oscillates
    // between two equally good gaps and commits to neither.
    brain.thinkTimer = tuning.aiThinkSeconds * (1.4 - profile.skill);
    brain.targetT = chooseLine(rider, profile, field, traffic, track, reach);
    brain.cornerLimit = cornerLimit(rider, profile, track, tuning, reach);
  }

  const halfWidth = track.driveableHalfWidthAt(rider.pos.s, rider.pos.branchId);
  const target = clamp(brain.targetT, -halfWidth, halfWidth);
  out.lean = clamp((target - rider.pos.t) * tuning.aiSteerGain, -1, 1);

  const wanted =
    Math.min(
      brain.cornerLimit,
      followLimit(rider, profile, field, traffic, target, reach),
    ) * brain.pace;

  if (rider.speed > wanted) {
    out.throttle = 0;
    out.brake = clamp((rider.speed - wanted) * 0.4, 0.15, 1);
  } else {
    out.throttle = 1;
    out.brake = 0;
  }

  out.attack = chooseAttack(rider, profile, brain, field, track, combat, dt);
}
