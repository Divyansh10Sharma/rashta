import type { TrackPos } from '../types.ts';

/** What a rider is doing. Only `riding` is reachable before Phase 4. */
export type RiderState =
  'riding' | 'attacking' | 'staggered' | 'crashing' | 'remounting';

/** A bike as it appears in `src/data/bikes.json`, after validation. */
export interface Bike {
  id: string;
  make: string;
  model: string;
  class: 'street' | 'sport' | 'super';
  price: number;
  /** kW. Display only — the simulation never reads this. See GAME_DESIGN.md. */
  power: number;
  /** kg. Combat shove and cornering grip only. */
  mass: number;
  /** km/h. Authoritative: the ceiling. */
  topSpeed: number;
  /** Seconds from rest to `topSpeed`. Authoritative: the magnitude. */
  timeToTopSpeed: number;
  /** Shape only, normalised, at 0/25/50/75/100% of `topSpeed`. */
  accelCurve: number[];
  handling: number;
  stability: number;
  nitro: number;
  blurb: string;
}

/**
 * A bike with the constants the simulation actually integrates, solved once at
 * load. Keeps the derived numbers out of the data file, where they would be a
 * second source of truth.
 */
export interface TunedBike {
  spec: Bike;
  /** `topSpeed` in m/s — the sim works in metres, the data file in km/h. */
  topSpeedMs: number;
  /**
   * Acceleration scale, in m/s^2, such that integrating `accel * curve(u)`
   * from rest to `topSpeedMs` takes exactly `timeToTopSpeed` seconds.
   */
  accelScale: number;
}

/** Every tunable constant, from `src/data/tuning.json`. */
export interface Tuning {
  accelIntegralSlices: number;
  brakeDecel: number;
  coastDecel: number;
  maxLateralSpeed: number;
  lateralResponse: number;
  lateralSpeedFalloff: number;
  gripLateralLimit: number;
  gripScrub: number;
  leanFromLateral: number;
  leanFromCurvature: number;
  leanMax: number;
  leanResponse: number;
  wheelRadius: number;
  revsIdle: number;
  gearCount: number;
}

/**
 * One tick's worth of control input.
 *
 * Latched once per simulation tick, never read from a device inside `step()`.
 * That is what lets the same recorded sequence replay identically regardless
 * of how the render loop was scheduled.
 */
export interface InputFrame {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. 1 (right) */
  lean: number;
}

/** A rider's full simulation state. Positional data is track space only. */
export interface Rider {
  pos: TrackPos;
  /** m/s along the track. */
  speed: number;
  /** m/s in `t`. */
  lateral: number;
  /** Radians. Cosmetic — for rendering only, never fed back into motion. */
  lean: number;
  /** Radians of wheel rotation, accumulated for the renderer. */
  wheelAngle: number;
  stamina: number;
  state: RiderState;
  bike: TunedBike;
}

/** Everything the simulation owns. */
export interface WorldState {
  player: Rider;
  /** Ticks elapsed. The sim's only clock. */
  tick: number;
}
