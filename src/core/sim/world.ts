import { MAIN_BRANCH } from '../types.ts';
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
    bike,
  };
}

/** A fresh world with one rider on it. */
export function createWorld(bike: TunedBike): WorldState {
  return { player: createRider(bike), tick: 0 };
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
  b.bike = a.bike;
}
