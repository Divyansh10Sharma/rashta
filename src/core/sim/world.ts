import { createRng } from '../rng.ts';
import { MAIN_BRANCH } from '../types.ts';
import { createTraffic } from './traffic.ts';
import type { Track } from '../track/Track.ts';
import type { Rider, TrafficVehicle, TunedBike, WorldState } from './types.ts';

/** Constructing and copying simulation state. */

/** A rider at rest on the start line. */
export function createRider(bike: TunedBike, s = 0, t = 0): Rider {
  return {
    pos: { s, t, branchId: MAIN_BRANCH },
    lastS: s,
    speed: 0,
    lateral: 0,
    lean: 0,
    wheelAngle: 0,
    stamina: 100,
    weapon: null,
    attack: null,
    attackElapsed: 0,
    staggerTimer: 0,
    damage: 0,
    state: 'riding',
    stateTimer: 0,
    crashCause: null,
    severity: null,
    h: 0,
    hVel: 0,
    bikePos: { s, t, branchId: MAIN_BRANCH },
    bikeSpeed: 0,
    slipTimer: 0,
    graceTimer: 0,
    bike,
  };
}

/**
 * A fresh world on a track.
 *
 * The seed is explicit rather than defaulted from a clock — a race that cannot
 * be reproduced from a number is a race whose bugs are anecdotes.
 */
export function createWorld(
  bike: TunedBike,
  track: Track,
  seed = 1,
): WorldState {
  const rng = createRng(seed);
  return {
    player: createRider(bike),
    traffic: createTraffic(track, rng),
    rng,
    tick: 0,
  };
}

/** Copies one rider's state. Shared by the world copy and the race copy. */
export function copyRider(from: Rider, to: Rider): void {
  to.pos.s = from.pos.s;
  to.pos.t = from.pos.t;
  to.pos.branchId = from.pos.branchId;
  to.lastS = from.lastS;
  to.speed = from.speed;
  to.lateral = from.lateral;
  to.lean = from.lean;
  to.wheelAngle = from.wheelAngle;
  to.stamina = from.stamina;
  to.weapon = from.weapon;
  to.attack = from.attack;
  to.attackElapsed = from.attackElapsed;
  to.staggerTimer = from.staggerTimer;
  to.damage = from.damage;
  to.state = from.state;
  to.stateTimer = from.stateTimer;
  to.crashCause = from.crashCause;
  to.severity = from.severity;
  to.h = from.h;
  to.hVel = from.hVel;
  to.bikePos.s = from.bikePos.s;
  to.bikePos.t = from.bikePos.t;
  to.bikePos.branchId = from.bikePos.branchId;
  to.bikeSpeed = from.bikeSpeed;
  to.slipTimer = from.slipTimer;
  to.graceTimer = from.graceTimer;
  // Shared by reference deliberately: immutable tuning data, not state.
  to.bike = from.bike;
}

/**
 * Copies the traffic pool.
 *
 * Index `i` is the same slot in both, which is what lets the renderer notice a
 * slot that was recycled between two ticks instead of interpolating across it.
 */
export function copyTraffic(
  from: readonly TrafficVehicle[],
  to: TrafficVehicle[],
): void {
  for (let i = 0; i < from.length; i += 1) {
    const source = from[i];
    const target = to[i];
    if (!source || !target) continue;
    target.kind = source.kind;
    target.pos.s = source.pos.s;
    target.pos.t = source.pos.t;
    target.pos.branchId = source.pos.branchId;
    target.speed = source.speed;
    target.cruise = source.cruise;
    target.lane = source.lane;
    target.oncoming = source.oncoming;
    target.laneChangeTimer = source.laneChangeTimer;
    target.active = source.active;
  }
}

/**
 * Copies `from` into `to` without allocating.
 *
 * The render loop keeps the two most recent states so it can interpolate
 * between them, which means a copy every tick — so it must not produce
 * garbage.
 */
export function copyWorld(from: WorldState, to: WorldState): void {
  to.tick = from.tick;
  copyRider(from.player, to.player);
  copyTraffic(from.traffic, to.traffic);
}
