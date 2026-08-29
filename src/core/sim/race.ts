import { copyRider, copyTraffic, createRider } from './world.ts';
import { FIXED_DT, stepRider } from './step.ts';
import { createTraffic, stepTraffic } from './traffic.ts';
import { checkHazards, checkOffRoad, checkTraffic } from './collide.ts';
import { createRng } from '../rng.ts';
import { progress } from '../track/distance.ts';
import { think } from '../ai/racer.ts';
import type { Track } from '../track/Track.ts';
import type { RacerProfile } from '../ai/types.ts';
import type {
  InputFrame,
  RaceEntry,
  RaceState,
  Rider,
  TunedBike,
  Tuning,
} from './types.ts';

/**
 * The race: fourteen riders, a countdown, and an order.
 *
 * Standings sort on `progress`, never on raw `s`. Two riders on opposite
 * branches of a fork measure `s` along different curves, so comparing their
 * odometers is wrong in exactly the place it is most visible — mid-fork, on
 * the HUD, with the leader on the other road.
 */

/** Metres between grid rows, and metres either side of centre within a row. */
const GRID_ROW = 6;
const GRID_LANE = 1.6;

/** Riders per row on the start line. */
const GRID_WIDTH = 2;

/**
 * Metres of field the traffic window covers, front to back.
 *
 * A leader further ahead than this rides thinner traffic than the pack. Two
 * kilometres covers the spread for most of a race; by the time it does not,
 * the leader is a minute clear and the result is not in question.
 */
const MAX_FIELD_SPAN = 1200;

function gridS(slot: number): number {
  return -Math.floor(slot / GRID_WIDTH) * GRID_ROW;
}

function gridT(slot: number): number {
  return ((slot % GRID_WIDTH) - (GRID_WIDTH - 1) / 2) * 2 * GRID_LANE;
}

function makeEntry(
  profile: RacerProfile,
  bike: TunedBike,
  slot: number,
  isPlayer: boolean,
): RaceEntry {
  const t = gridT(slot);
  return {
    profile,
    isPlayer,
    rider: createRider(bike, gridS(slot), t),
    input: { throttle: 0, brake: 0, lean: 0 },
    brain: { targetT: t, thinkTimer: 0, cornerLimit: 0, pace: 1 },
    finishTick: null,
    place: 0,
  };
}

/**
 * Builds a race.
 *
 * The player is always placed last on the grid — GAME_DESIGN.md, and the
 * starting condition the whole difficulty curve is written against.
 */
export function createRace(
  profiles: readonly RacerProfile[],
  playerId: string,
  bikeFor: (profile: RacerProfile) => TunedBike,
  track: Track,
  seed = 1,
): RaceState {
  const player = profiles.find((p) => p.id === playerId);
  if (!player) throw new Error(`no racer profile with id "${playerId}"`);
  const rivals = profiles.filter((p) => p.id !== playerId);

  const entries: RaceEntry[] = [];
  for (let i = 0; i < rivals.length; i += 1) {
    const profile = rivals[i];
    if (profile) entries.push(makeEntry(profile, bikeFor(profile), i, false));
  }
  entries.push(makeEntry(player, bikeFor(player), entries.length, true));

  const rng = createRng(seed);
  return {
    phase: 'countdown',
    entries,
    // Built once, not per tick: the AI needs to see every rider, and a
    // fourteen-element array rebuilt sixty times a second is the per-frame
    // allocation CLAUDE.md forbids.
    riders: entries.map((e) => e.rider),
    order: entries.map((_, i) => i),
    traffic: createTraffic(track, rng, MAX_FIELD_SPAN),
    rng,
    tick: 0,
    clock: 0,
    countdown: 0,
  };
}

/** True once every rider in the field has crossed the line. */
export function allHome(race: RaceState): boolean {
  for (const entry of race.entries) if (entry.finishTick === null) return false;
  return true;
}

/** The entry the human is riding. Present in every race, exactly once. */
export function playerEntry(race: RaceState): RaceEntry {
  const found = race.entries.find((e) => e.isPlayer);
  if (!found) throw new Error('race has no player entry');
  return found;
}

/**
 * Sorts `race.order` into current standings, best first.
 *
 * Finishers rank above everyone still riding, and among themselves by the tick
 * they crossed, so a rider who has finished can never be demoted afterwards by
 * somebody else's odometer.
 */
export function updateStandings(race: RaceState, track: Track): void {
  race.order.sort((a, b) => {
    const ea = race.entries[a];
    const eb = race.entries[b];
    if (!ea || !eb) return 0;
    if (ea.finishTick !== null || eb.finishTick !== null) {
      if (ea.finishTick === null) return 1;
      if (eb.finishTick === null) return -1;
      return ea.finishTick - eb.finishTick;
    }
    return progress(eb.rider.pos, track) - progress(ea.rider.pos, track);
  });
  for (let i = 0; i < race.order.length; i += 1) {
    const index = race.order[i];
    const entry = index === undefined ? undefined : race.entries[index];
    if (entry) entry.place = i + 1;
  }
}

/** Rubber-banding, if the data file asks for it. Otherwise exactly 1. */
function paceFor(
  entry: RaceEntry,
  playerProgress: number,
  track: Track,
  tuning: Tuning,
): number {
  if (tuning.rubberBanding <= 0) return 1;
  const ahead = progress(entry.rider.pos, track) - playerProgress;
  const scaled = Math.max(-1, Math.min(1, ahead / tuning.rubberBandRange));
  return 1 - tuning.rubberBanding * scaled;
}

/** The player has given up. The only way a race fails, until Phase 7. */
export function retire(race: RaceState): void {
  if (race.phase === 'racing' || race.phase === 'countdown') {
    race.phase = 'failed';
  }
}

function gatherInputs(
  race: RaceState,
  playerInput: InputFrame,
  playerProgress: number,
  track: Track,
  tuning: Tuning,
  dt: number,
): void {
  for (const entry of race.entries) {
    if (entry.finishTick !== null) continue;
    if (entry.isPlayer) {
      entry.input.throttle = playerInput.throttle;
      entry.input.brake = playerInput.brake;
      entry.input.lean = playerInput.lean;
      continue;
    }
    entry.brain.pace = paceFor(entry, playerProgress, track, tuning);
    think(
      entry.rider,
      entry.profile,
      entry.brain,
      race.riders,
      race.traffic,
      track,
      tuning,
      entry.input,
      dt,
    );
  }
}

function resolveFor(rider: Rider, race: RaceState, track: Track, t: Tuning) {
  if (rider.state !== 'riding') return;
  checkHazards(rider, track, t);
  checkTraffic(rider, race.traffic, track, t);
  checkOffRoad(rider, track, t);
}

/**
 * Advances the whole race one fixed tick.
 *
 * `playerInput` is ignored during the countdown, which is the entire point of
 * having one: every throttle in the field opens on the same tick.
 */
export function stepRace(
  race: RaceState,
  playerInput: InputFrame,
  track: Track,
  tuning: Tuning,
  dt: number = FIXED_DT,
): void {
  if (race.phase === 'failed') return;
  // The player finishing ends the player's race, not the race. Positions four
  // through fourteen are still being decided and the results screen wants
  // them, so the field rides on until everybody is home.
  if (allHome(race)) return;

  race.tick += 1;
  if (race.phase === 'countdown') {
    race.countdown += dt;
    if (race.countdown < tuning.countdownSeconds) return;
    race.phase = 'racing';
  }
  race.clock += dt;

  const player = playerEntry(race);
  gatherInputs(
    race,
    playerInput,
    progress(player.rider.pos, track),
    track,
    tuning,
    dt,
  );

  // Everything moves, then everything collides. Resolving as we go would make
  // the outcome depend on the order the field happens to be stored in.
  for (const entry of race.entries) {
    if (entry.finishTick === null) {
      stepRider(entry.rider, entry.input, track, tuning, dt);
    }
  }
  let backS = Infinity;
  let leadS = -Infinity;
  for (const entry of race.entries) {
    if (entry.finishTick !== null) continue;
    if (entry.rider.pos.s < backS) backS = entry.rider.pos.s;
    if (entry.rider.pos.s > leadS) leadS = entry.rider.pos.s;
  }
  if (leadS - backS > MAX_FIELD_SPAN) backS = leadS - MAX_FIELD_SPAN;
  stepTraffic(race.traffic, track, backS, leadS, race.rng, tuning, dt);

  for (const entry of race.entries) {
    if (entry.finishTick !== null) continue;
    resolveFor(entry.rider, race, track, tuning);
    if (progress(entry.rider.pos, track) >= track.totalLength) {
      entry.finishTick = race.tick;
    }
  }

  updateStandings(race, track);
  if (player.finishTick !== null) race.phase = 'finished';
}

/**
 * Copies a race into another of the same shape, without allocating.
 *
 * The renderer draws between two states, and fourteen riders that teleport
 * between ticks are fourteen times as visible as one.
 */
export function copyRace(from: RaceState, to: RaceState): void {
  to.phase = from.phase;
  to.tick = from.tick;
  to.clock = from.clock;
  to.countdown = from.countdown;
  for (let i = 0; i < from.order.length; i += 1) {
    to.order[i] = from.order[i] ?? i;
  }
  for (let i = 0; i < from.entries.length; i += 1) {
    const a = from.entries[i];
    const b = to.entries[i];
    if (!a || !b) continue;
    copyRider(a.rider, b.rider);
    b.finishTick = a.finishTick;
    b.place = a.place;
    b.input.throttle = a.input.throttle;
    b.input.brake = a.input.brake;
    b.input.lean = a.input.lean;
    b.brain.targetT = a.brain.targetT;
    b.brain.thinkTimer = a.brain.thinkTimer;
    b.brain.cornerLimit = a.brain.cornerLimit;
    b.brain.pace = a.brain.pace;
  }
  copyTraffic(from.traffic, to.traffic);
}
