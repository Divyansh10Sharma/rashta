import type { RacerBrain, RacerProfile } from '../ai/types.ts';
import type { TrackPos } from '../types.ts';
import type { Rng } from '../rng.ts';

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

/** What put a rider on the tarmac. Kept so a results screen can say why. */
export type CrashCause = 'traffic' | 'hazard' | 'cliff';

/** A kind of vehicle sharing the road. */
export type TrafficKind = 'auto' | 'car' | 'bus' | 'truck';

/** One vehicle in the traffic pool. Recycled, never destroyed. */
export interface TrafficVehicle {
  kind: TrafficKind;
  pos: TrackPos;
  /** m/s. Always positive; `oncoming` carries the direction. */
  speed: number;
  /** The speed it wants, before anything gets in the way. */
  cruise: number;
  lane: number;
  oncoming: boolean;
  /** Seconds until it next considers changing lane. */
  laneChangeTimer: number;
  /** Inactive vehicles are pool slots waiting to be respawned. */
  active: boolean;
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

  trafficAccel: number;
  trafficLaneChangeSpeed: number;

  crashSeconds: number;
  remountSeconds: number;
  crashDecel: number;
  /** Immunity after remounting, so a crash cannot repeat on the spot. */
  remountGraceSeconds: number;
  /** How far back toward the centreline a remount puts you. */
  remountRecentre: number;
  slipSeconds: number;
  /** How much grip is left while slipping, as a fraction. */
  slipGrip: number;
  potholeSpeedLoss: number;
  dogCrashSpeed: number;
  /** Seconds of road a rival reads ahead, before skill scales it. */
  aiLookahead: number;
  /** Metres a rival reads ahead regardless of speed, so a stopped one still sees. */
  aiLookaheadFloor: number;
  /** Seconds between a rival reconsidering its line, before skill scales it. */
  aiThinkSeconds: number;
  /** Lean input per metre of lateral error, for rivals. */
  aiSteerGain: number;
  /** Seconds on the line before the lights go out. */
  countdownSeconds: number;
  /** 0 disables rubber-banding entirely. See GAME_DESIGN and devlog phase-05 §2. */
  rubberBanding: number;
  /** Metres of gap over which rubber-banding reaches full strength. */
  rubberBandRange: number;
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
  /**
   * `pos.s` as it was at the start of this tick.
   *
   * Collisions resolve after everything has moved, so a check that needs to
   * know what the rider drove *over* — rather than what it is merely near —
   * has to be told where it started. See devlog phase-05, the stray dog.
   */
  lastS: number;
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
  /** Seconds left in `crashing` or `remounting`. */
  stateTimer: number;
  /** Why the rider is down, for the results screen. */
  crashCause: CrashCause | null;
  /** Seconds of reduced grip left, from oil, sand or a pothole. */
  slipTimer: number;
  /** Seconds of immunity after remounting, so you cannot re-hit what got you. */
  graceTimer: number;
  bike: TunedBike;
}

/** Where a race is in its life. */
export type RacePhase = 'countdown' | 'racing' | 'finished' | 'failed';

/** One rider in a race: who they are, what they are riding, how they are doing. */
export interface RaceEntry {
  profile: RacerProfile;
  isPlayer: boolean;
  rider: Rider;
  /** This tick's input. Reused, never reallocated. */
  input: InputFrame;
  /** Rival decision state. Inert for the player. */
  brain: RacerBrain;
  /** The tick this rider crossed the line, or null if still riding. */
  finishTick: number | null;
  /** 1-based standing, refreshed every tick. */
  place: number;
}

/** A whole race. Supersedes WorldState once a race is running. */
export interface RaceState {
  phase: RacePhase;
  entries: RaceEntry[];
  /** Every entry's rider, in entry order. Built once so the AI can scan it. */
  riders: Rider[];
  /** Indices into `entries`, best first. Sorted on progress, never raw s. */
  order: number[];
  traffic: TrafficVehicle[];
  rng: Rng;
  tick: number;
  /** Seconds of racing elapsed. Does not include the countdown. */
  clock: number;
  /** Seconds of countdown elapsed. */
  countdown: number;
}

/** Everything the simulation owns. */
export interface WorldState {
  player: Rider;
  /** A fixed pool. Count never changes after creation. */
  traffic: TrafficVehicle[];
  /**
   * The world's randomness, carried so a saved game resumes the same race
   * rather than a similar one. See ARCHITECTURE.md 6.
   */
  rng: Rng;
  /** Ticks elapsed. The sim's only clock. */
  tick: number;
}
