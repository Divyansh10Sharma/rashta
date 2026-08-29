import { createRng } from '../rng.ts';
import { MAIN_BRANCH } from '../types.ts';
import { createTraffic } from './traffic.ts';
import type { Track } from '../track/Track.ts';
import type { Rider, TunedBike, WorldState } from './types.ts';

/** Constructing and copying simulation state. */

/** A rider at rest on the start line. */
export function createRider(bike: TunedBike, s = 0, t = 0): Rider {
  return {
    pos: { s, t, branchId: MAIN_BRANCH },
    speed: 0,
    lateral: 0,
    lean: 0,
    wheelAngle: 0,
    stamina: 100,
    state: 'riding',
    stateTimer: 0,
    crashCause: null,
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

/**
 * Copies `from` into `to` without allocating.
 *
 * The render loop keeps the two most recent states so it can interpolate
 * between them, which means a copy every tick — so it must not produce
 * garbage. `bike` is shared by reference deliberately: it is immutable
 * tuning data, not state.
 */
export function copyWorld(from: WorldState, to: WorldState): void {
  to.tick = from.tick;
  const a = from.player;
  const b = to.player;
  b.pos.s = a.pos.s;
  b.pos.t = a.pos.t;
  b.pos.branchId = a.pos.branchId;
  b.speed = a.speed;
  b.lateral = a.lateral;
  b.lean = a.lean;
  b.wheelAngle = a.wheelAngle;
  b.stamina = a.stamina;
  b.state = a.state;
  b.stateTimer = a.stateTimer;
  b.crashCause = a.crashCause;
  b.slipTimer = a.slipTimer;
  b.graceTimer = a.graceTimer;
  b.bike = a.bike;

  // Traffic is copied for the same reason the rider is: the renderer draws
  // between two states, and a bus that teleports between ticks is as visible
  // as a rider that does.
  for (let i = 0; i < from.traffic.length; i += 1) {
    const source = from.traffic[i];
    const target = to.traffic[i];
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
