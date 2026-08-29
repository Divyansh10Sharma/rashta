import type { Rng } from '../rng.ts';
import type { Track } from '../track/Track.ts';
import { MAIN_BRANCH } from '../types.ts';
import type { TrafficKind, TrafficVehicle, Tuning } from './types.ts';

/**
 * City traffic, in track space.
 *
 * A fixed pool, not a spawner. Every vehicle that will ever exist is allocated
 * once; as the rider advances, whatever falls behind is moved ahead and given
 * a new lane rather than destroyed and replaced. Entity count is therefore
 * constant by construction, which is one of the phase's acceptance criteria
 * and not something that needs watching.
 *
 * The guarantee that two vehicles never overlap rests on three rules that
 * compose: a vehicle only spawns into a clear gap, only changes into a clear
 * gap, and slows to match anything it catches in its own lane. The third is
 * what makes it hold rather than be likely — and it is also what makes traffic
 * bunch behind a slow bus, which is the thing that reads as a city rather than
 * as a spawn pattern.
 */

/** Length and width of each kind, in metres. Used for separation and drawing. */
export const TRAFFIC_SIZES: Record<
  TrafficKind,
  { length: number; width: number }
> = {
  auto: { length: 2.7, width: 1.4 },
  car: { length: 4.1, width: 1.8 },
  bus: { length: 11.0, width: 2.6 },
  truck: { length: 8.2, width: 2.5 },
};

/** Cruising speed range per kind, in m/s. Buses are slow; autos are slower. */
const SPEED_RANGE: Record<TrafficKind, [number, number]> = {
  auto: [8, 14],
  car: [16, 26],
  bus: [11, 17],
  truck: [12, 19],
};

/** How often each kind turns up. Autos and cars dominate a Delhi road. */
const MIX: TrafficKind[] = [
  'auto',
  'auto',
  'auto',
  'car',
  'car',
  'car',
  'car',
  'car',
  'bus',
  'bus',
  'truck',
];

/** Clear space kept between two vehicles' bumpers, in metres. */
const BUMPER_MARGIN = 1.5;

/** How early, in metres of width, two vehicles start minding each other. */
const ABREAST_MARGIN = 0.6;

/** Clear space, in metres, kept between a footprint and the centreline. */
const CENTRELINE_MARGIN = 0.2;

/**
 * Extra clearance, in metres, demanded before starting a lane change.
 *
 * A change is not instant: `lane` commits at once but `t` crosses over a
 * couple of seconds, and for that whole time the vehicle occupies both lanes.
 * Checking for a gap only at the moment of deciding is the mistake — the gap
 * it found can close while the crossing is still happening. Demanding a much
 * larger gap up front covers the crossing, and has the side effect of making
 * lane changes occasional rather than constant, which is what the roadmap
 * asked for anyway.
 */
const LANE_CHANGE_CLEARANCE = 28;

/** Metres ahead of the rider that traffic is maintained. */
export const TRAFFIC_AHEAD = 420;
/** Metres behind before a vehicle is recycled. */
export const TRAFFIC_BEHIND = 90;

/** Centre of lane `index` of `lanes`, in metres from the centreline. */
export function laneCentre(
  lanes: number,
  index: number,
  halfWidth: number,
): number {
  const width = (halfWidth * 2) / lanes;
  return -halfWidth + width * (index + 0.5);
}

/**
 * Where this vehicle is trying to sit laterally, in metres.
 *
 * Its lane centre, except that on a two-way road the centreline is a wall.
 * Lane centres move as the road widens and narrows — the Ring Road steps from
 * three lanes to four, the Old City from two to one — and a moving lane centre
 * can put a vehicle's footprint across the divider without any decision being
 * taken. Keeping the whole footprint on its own half is what makes a head-on
 * impossible by construction rather than by margin: two vehicles going
 * opposite ways are then always at least their combined width apart.
 */
function targetT(
  track: Track,
  vehicle: TrafficVehicle,
  lane: number,
  lanes: number,
  halfWidth: number,
): number {
  const want = laneCentre(lanes, lane, halfWidth);
  if (track.segmentAt(vehicle.pos.s, vehicle.pos.branchId).oneWay) return want;

  const clear = TRAFFIC_SIZES[vehicle.kind].width / 2 + CENTRELINE_MARGIN;
  return vehicle.oncoming ? Math.min(want, -clear) : Math.max(want, clear);
}

/**
 * Creates the pool. Size is fixed from the track's density and the window.
 *
 * `fieldSpan` is how far apart the front and back of the field may be and
 * still have traffic between them. It is zero for a lone rider and a couple of
 * kilometres for a race: a window anchored on one rider leaves everybody ahead
 * of them on an empty road, which in a fourteen-rider race decides the result.
 * See devlog phase-05.
 */
export function createTraffic(
  track: Track,
  rng: Rng,
  fieldSpan = 0,
): TrafficVehicle[] {
  const windowKm = (TRAFFIC_AHEAD + TRAFFIC_BEHIND + fieldSpan) / 1000;
  const count = Math.max(0, Math.round(track.data.trafficDensity * windowKm));

  const pool: TrafficVehicle[] = [];
  for (let i = 0; i < count; i += 1) {
    const kind = MIX[rng.nextInt(MIX.length)] ?? 'car';
    pool.push({
      kind,
      pos: { s: 0, t: 0, branchId: MAIN_BRANCH },
      speed: 0,
      cruise: 0,
      lane: 0,
      oncoming: false,
      laneChangeTimer: 0,
      active: false,
    });
  }
  return pool;
}

/** Length of the longest vehicle in the game, for conservative early-outs. */
const LONGEST_VEHICLE = 11.5;

/** Beyond this a leader cannot affect a follower's speed, so stop looking. */
const FOLLOW_RANGE = 90;

/** The gap a vehicle needs behind and ahead to occupy a spot, in metres. */
function gapFor(kind: TrafficKind): number {
  return TRAFFIC_SIZES[kind].length + 6;
}

/**
 * The clear space two vehicles must keep between their centres, in metres.
 *
 * Half of each length, plus a bumper. Anything less and their footprints
 * overlap.
 */
function minGap(a: TrafficKind, b: TrafficKind): number {
  return (
    (TRAFFIC_SIZES[a].length + TRAFFIC_SIZES[b].length) / 2 + BUMPER_MARGIN
  );
}

/**
 * Is there room at `(s, t)` for this vehicle?
 *
 * Exactly the invariant the acceptance criterion states, asked as a question:
 * anything whose width overlaps must be at least `minGap` away along the road.
 * Vehicles far enough to the side are irrelevant however close they are in
 * `s`, which is what lets four lanes of traffic run abreast.
 */
function hasRoom(
  pool: TrafficVehicle[],
  candidate: TrafficVehicle,
  t: number,
  s: number,
  extra = 0,
): boolean {
  const halfSelf = TRAFFIC_SIZES[candidate.kind].width / 2;
  const reach = LONGEST_VEHICLE + BUMPER_MARGIN + extra;
  for (let i = 0; i < pool.length; i += 1) {
    const other = pool[i];
    if (!other || other === candidate || !other.active) continue;

    // Cheapest, most selective test first: nothing further away than the
    // longest gap this call could ever demand can possibly block the spot.
    const along = Math.abs(other.pos.s - s);
    if (along >= reach) continue;
    if (other.pos.branchId !== candidate.pos.branchId) continue;

    const abreast =
      halfSelf + TRAFFIC_SIZES[other.kind].width / 2 + ABREAST_MARGIN;
    if (Math.abs(other.pos.t - t) >= abreast) continue;
    if (along < minGap(candidate.kind, other.kind) + extra) {
      return false;
    }
  }
  return true;
}

/** Places a vehicle somewhere ahead of `s`, or leaves it inactive if it cannot. */
function respawn(
  vehicle: TrafficVehicle,
  pool: TrafficVehicle[],
  track: Track,
  riderS: number,
  rng: Rng,
): void {
  const kind = MIX[rng.nextInt(MIX.length)] ?? 'car';
  vehicle.kind = kind;
  vehicle.pos.branchId = MAIN_BRANCH;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const s = riderS + rng.nextRange(TRAFFIC_AHEAD * 0.35, TRAFFIC_AHEAD);
    const lanes = track.lanesAt(s);
    const halfWidth = track.widthAt(s);
    const lane = rng.nextInt(lanes);

    const seg = track.segmentAt(s);
    // A two-way road runs the left half against you. A one-way carriageway
    // does not, which is most of why the flyway is fast and the Old City is
    // terrifying.
    const oncoming = !seg.oneWay && lane < lanes / 2;

    // Spawn on the same side of the divider the vehicle will drive on. A
    // one-lane stretch of a two-way road has its only lane centre *on* the
    // centreline, so spawning at the raw lane centre puts half a bus into the
    // oncoming half from the moment it appears — and once there it cannot
    // always get out, because moving is only allowed into free space.
    vehicle.pos.s = s;
    vehicle.oncoming = oncoming;
    const t = targetT(track, vehicle, lane, lanes, halfWidth);
    if (!hasRoom(pool, vehicle, t, s)) continue;
    const [lo, hi] = SPEED_RANGE[kind];

    vehicle.pos.t = t;
    vehicle.lane = lane;
    vehicle.cruise = rng.nextRange(lo, hi);
    vehicle.speed = vehicle.cruise;
    vehicle.laneChangeTimer = rng.nextRange(2, 9);
    vehicle.active = true;
    return;
  }
  vehicle.active = false;
}

/**
 * Does this vehicle's lane still exist, and still run the way it is going?
 *
 * Both have to hold. A lane that has vanished is obvious; a lane that has
 * changed direction under the vehicle is the subtle one, and it is what a
 * narrowing two-way road does.
 */
function laneStillValid(
  track: Track,
  vehicle: TrafficVehicle,
  lanes: number,
): boolean {
  if (vehicle.lane >= lanes) return false;
  const seg = track.segmentAt(vehicle.pos.s);
  if (seg.oneWay) return !vehicle.oncoming;
  return vehicle.oncoming === vehicle.lane < lanes / 2;
}

/**
 * The nearest vehicle ahead that this one is actually behind.
 *
 * A vehicle counts as ahead if it shares this one's lane *or* overlaps it
 * laterally, and the union matters. Neither half is sufficient alone: lateral
 * overlap alone misses a vehicle that is committed to your lane but still
 * crossing into it, and lane index alone misses one that is physically in
 * front of you while nominally belonging somewhere else. A vehicle part-way
 * through a crossing genuinely occupies two lanes, so it is ordered against
 * both — which is the whole reason the crossing cannot drive through anyone.
 */
function leaderFor(
  pool: TrafficVehicle[],
  vehicle: TrafficVehicle,
): TrafficVehicle | null {
  let best: TrafficVehicle | null = null;
  let bestGap = Infinity;

  const halfSelf = TRAFFIC_SIZES[vehicle.kind].width / 2;
  for (let i = 0; i < pool.length; i += 1) {
    const other = pool[i];
    if (!other || other === vehicle || !other.active) continue;

    // Distance first. It rejects almost everything on a crowded road, and it
    // is two reads and a subtraction — the width test below is neither.
    const gap = vehicle.oncoming
      ? vehicle.pos.s - other.pos.s
      : other.pos.s - vehicle.pos.s;
    if (gap <= 0 || gap >= bestGap || gap > FOLLOW_RANGE) continue;
    if (other.pos.branchId !== vehicle.pos.branchId) continue;
    if (other.oncoming !== vehicle.oncoming) continue;

    const abreast =
      halfSelf + TRAFFIC_SIZES[other.kind].width / 2 + ABREAST_MARGIN;
    const shares =
      other.lane === vehicle.lane ||
      Math.abs(other.pos.t - vehicle.pos.t) < abreast;
    if (shares) {
      bestGap = gap;
      best = other;
    }
  }
  return best;
}

/** Advances every vehicle one tick, recycling anything the rider has passed. */
export function stepTraffic(
  pool: TrafficVehicle[],
  track: Track,
  backS: number,
  leadS: number,
  rng: Rng,
  tuning: Tuning,
  dt: number,
): void {
  for (const vehicle of pool) {
    if (!vehicle.active) {
      respawn(vehicle, pool, track, leadS, rng);
      continue;
    }

    // The window runs from behind the last rider to ahead of the leader, so
    // every rider meets the same road.
    const behind = vehicle.oncoming
      ? vehicle.pos.s < backS - TRAFFIC_BEHIND
      : vehicle.pos.s < backS - TRAFFIC_BEHIND ||
        vehicle.pos.s > leadS + TRAFFIC_AHEAD * 1.6;
    if (behind) {
      respawn(vehicle, pool, track, leadS, rng);
      continue;
    }

    // Car following: match the leader rather than driving through it. This is
    // what turns three separate rules into an actual guarantee.
    const leader = leaderFor(pool, vehicle);
    let target = vehicle.cruise;
    if (leader) {
      const gap = Math.abs(leader.pos.s - vehicle.pos.s);
      const safe = gapFor(vehicle.kind) + gapFor(leader.kind);
      if (gap < safe) target = Math.min(target, leader.speed * (gap / safe));
    }

    const rate = tuning.trafficAccel * dt;
    if (vehicle.speed < target) {
      vehicle.speed = Math.min(target, vehicle.speed + rate);
    } else {
      vehicle.speed = Math.max(target, vehicle.speed - rate * 2);
    }

    // A velocity constraint, not a positional one.
    //
    // Clamping a vehicle's position back out of its leader looks like it
    // works and does not: pushing A backward shoves it into whatever is
    // behind A, which nothing was checking, so the overlap moves down the
    // queue instead of going away. Capping speed so the gap *cannot* close
    // past the minimum has no such side effect — nothing is ever moved, only
    // slowed — and it makes non-overlap an invariant rather than an outcome,
    // given the gap started large enough. Spawning guarantees that.
    if (leader) {
      const gap = Math.abs(leader.pos.s - vehicle.pos.s);
      const floor = minGap(vehicle.kind, leader.kind);
      const closeRate = (gap - floor) / dt;
      const cap = leader.speed + Math.max(0, closeRate);
      if (vehicle.speed > cap) vehicle.speed = cap;
    }

    vehicle.pos.s += vehicle.speed * (vehicle.oncoming ? -1 : 1) * dt;

    // Drift toward the centre of the lane it believes it is in, so a lane
    // change is a movement rather than a teleport.
    const lanes = track.lanesAt(vehicle.pos.s);
    const halfWidth = track.widthAt(vehicle.pos.s);

    // The road does not keep the same number of lanes the whole way. A vehicle
    // whose lane has just disappeared cannot simply be clamped into the next
    // one along, because on a two-way road that one may be running the other
    // way — which puts it head-on into oncoming traffic that car-following
    // deliberately ignores. Recycling it is invisible; a head-on between two
    // NPCs is not.
    if (!laneStillValid(track, vehicle, lanes)) {
      respawn(vehicle, pool, track, leadS, rng);
      continue;
    }
    const want = targetT(track, vehicle, vehicle.lane, lanes, halfWidth);
    const step = tuning.trafficLaneChangeSpeed * dt;
    const delta = want - vehicle.pos.t;
    const next =
      Math.abs(delta) < step ? want : vehicle.pos.t + Math.sign(delta) * step;

    // Moving sideways is moving, and it can only happen into space that is
    // free. Without this a vehicle slides through its neighbour whenever the
    // road's geometry shifts its lane centre underneath it — no decision is
    // ever taken, so no gap is ever checked. Blocked, it simply holds its line
    // until the road ahead of it clears.
    if (hasRoom(pool, vehicle, next, vehicle.pos.s)) {
      vehicle.pos.t = next;
    } else if (
      Math.abs(vehicle.pos.t) + TRAFFIC_SIZES[vehicle.kind].width / 2 >
      track.driveableHalfWidthAt(vehicle.pos.s, vehicle.pos.branchId)
    ) {
      // Held out of its lane and now hanging off the road: recycle rather than
      // leave it there. A vehicle vanishing ahead of you is invisible.
      respawn(vehicle, pool, track, leadS, rng);
      continue;
    }

    vehicle.laneChangeTimer -= dt;
    if (vehicle.laneChangeTimer <= 0) {
      vehicle.laneChangeTimer = rng.nextRange(4, 14);
      maybeChangeLane(vehicle, pool, track, rng, lanes, halfWidth);
    }
  }
}

/** Tries one lane change, and abandons it if the target lane is not clear. */
function maybeChangeLane(
  vehicle: TrafficVehicle,
  pool: TrafficVehicle[],
  track: Track,
  rng: Rng,
  lanes: number,
  halfWidth: number,
): void {
  if (lanes < 2) return;
  const direction = rng.next() < 0.5 ? -1 : 1;
  const lane = vehicle.lane + direction;
  if (lane < 0 || lane >= lanes) return;

  const seg = track.segmentAt(vehicle.pos.s);
  // Never change into the oncoming half of a two-way road.
  if (!seg.oneWay) {
    const wouldOncome = lane < lanes / 2;
    if (wouldOncome !== vehicle.oncoming) return;
  }

  const t = targetT(track, vehicle, lane, lanes, halfWidth);
  if (!hasRoom(pool, vehicle, t, vehicle.pos.s, LANE_CHANGE_CLEARANCE)) return;
  vehicle.lane = lane;
}
