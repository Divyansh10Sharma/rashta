import { copyRider, copyTraffic, createRider } from './world.ts';
import { FIXED_DT, stepRider } from './step.ts';
import { createTraffic, stepTraffic } from './traffic.ts';
import { checkHazards, checkOffRoad, checkTraffic } from './collide.ts';
import { createRng } from '../rng.ts';
import { progress } from '../track/distance.ts';
import { think } from '../ai/racer.ts';
import { startAttack, stepCombat } from '../combat/combat.ts';
import { arrestedBy, createPolice, stepPolice } from '../police/police.ts';
import type { FailReason, PoliceData } from '../police/types.ts';
import { WEAPON_KINDS } from '../combat/types.ts';
import { MAIN_BRANCH } from '../types.ts';
import type { CombatData, DroppedWeapon, WeaponKind } from '../combat/types.ts';
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

/** A roster's `startingWeapon` string, checked against the real weapons. */
function asWeapon(name: string | null): WeaponKind | null {
  if (name === null) return null;
  if (!WEAPON_KINDS.includes(name as WeaponKind)) {
    throw new Error(`racers.json: "${name}" is not a weapon`);
  }
  return name as WeaponKind;
}

/** Metres between grid rows, and metres either side of centre within a row. */
const GRID_ROW = 6;
const GRID_LANE = 1.6;

/** Riders per row on the start line. */
const GRID_WIDTH = 2;

/**
 * Metres of field the traffic window covers, front to back.
 *
 * A leader further ahead than this rides thinner traffic than the pack. 1.2 km
 * covers the spread for most of a race; by the time it does not, the leader is
 * a minute clear and the result is not in question. It was 2 km until Phase 5
 * measured the cost of the pool that implies — see devlog phase-05.
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
  const rider = createRider(bike, gridS(slot), t);
  // The roster says who turns up armed. Nothing creates a weapon after this.
  rider.weapon = asWeapon(profile.startingWeapon);
  return {
    profile,
    isPlayer,
    rider,
    input: { throttle: 0, brake: 0, lean: 0 },
    brain: {
      targetT: t,
      thinkTimer: 0,
      cornerLimit: 0,
      pace: 1,
      lastStamina: 100,
      grudge: 0,
      swingTimer: 0,
    },
    finishTick: null,
    place: 0,
    out: false,
    wasDown: false,
    lastStamina: 100,
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
  combat: CombatData,
  policeData: PoliceData,
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

  // One slot per weapon on the grid, and not one more: weapons circulate, so
  // carried plus dropped is a constant for the whole race, and a pool that
  // cannot overflow is a duplication bug that cannot happen quietly.
  const armed = entries.filter((e) => e.rider.weapon !== null).length;
  const dropped: DroppedWeapon[] = [];
  for (let i = 0; i < armed; i += 1) {
    dropped.push({
      kind: 'pipe',
      s: 0,
      t: 0,
      branchId: MAIN_BRANCH,
      settle: 0,
      active: false,
    });
  }

  // Police ride the slowest bike in the field: they catch you by not having
  // to stop, not by being faster than you. The detail is sized from the
  // route's own density, which is zero at tier 1 by design.
  const patrolBike = entries[0]?.rider.bike;
  if (!patrolBike) throw new Error('race has no riders to take a bike from');
  const police = createPolice(track, patrolBike);

  const rng = createRng(seed);
  return {
    phase: 'countdown',
    failReason: null,
    combat,
    policeData,
    police,
    entries,
    dropped,
    // Built once, not per tick: the AI needs to see every rider, and a
    // fourteen-element array rebuilt sixty times a second is the per-frame
    // allocation CLAUDE.md forbids.
    // Police are in the rider field so rivals, collisions and combat all see
    // them, and never in `entries`, so they can never enter the standings.
    riders: [...entries.map((e) => e.rider), ...police.map((u) => u.rider)],
    order: entries.map((_, i) => i),
    traffic: createTraffic(track, rng, MAX_FIELD_SPAN),
    rng,
    tick: 0,
    clock: 0,
    countdown: 0,
  };
}

/** True once every rider has either crossed the line or dropped out. */
export function allHome(race: RaceState): boolean {
  for (const entry of race.entries) {
    if (entry.finishTick === null && !entry.out) return false;
  }
  return true;
}

/** Riders still on the road: not finished, not arrested, not wrecked. */
function racing(entry: RaceEntry): boolean {
  return entry.finishTick === null && !entry.out;
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
    if (ea.out !== eb.out) return ea.out ? 1 : -1;
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

/**
 * Ends the *player's* race badly. Retiring, an arrest, or a wrecked bike.
 *
 * The other thirteen are still racing. Being arrested ends your night, not
 * everybody's — the same way finishing ends your race and not the race. Before
 * this, an arrest froze the whole field mid-corner. See devlog phase-08.
 */
export function fail(race: RaceState, reason: FailReason): void {
  if (race.phase !== 'racing' && race.phase !== 'countdown') return;
  race.phase = 'failed';
  race.failReason = reason;
  playerEntry(race).out = true;
}

/** The player has given up. */
export function retire(race: RaceState): void {
  fail(race, 'retired');
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
    if (!racing(entry)) continue;
    if (entry.isPlayer) {
      entry.input.throttle = playerInput.throttle;
      entry.input.brake = playerInput.brake;
      entry.input.lean = playerInput.lean;
      entry.input.attack = playerInput.attack ?? null;
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
      race.combat,
      entry.input,
      dt,
    );
  }
}

/**
 * Adds bike damage for anything that happened this tick.
 *
 * A crash is charged once, on the tick the rider goes down, not for every tick
 * they are sliding — the same "on the edge, not while inside" shape as the
 * hazard fix in Phase 5.
 */
function accrueDamage(race: RaceState): void {
  const rates = race.policeData.damage;
  for (const entry of race.entries) {
    if (!racing(entry)) continue;
    const rider = entry.rider;
    const down = rider.state !== 'riding';
    if (down && !entry.wasDown) rider.damage += rates.perCrash;
    entry.wasDown = down;

    if (rider.stamina < entry.lastStamina - 0.001) {
      rider.damage += rates.perHit;
    }
    entry.lastStamina = rider.stamina;
    if (rider.damage > rates.wreckAt) rider.damage = rates.wreckAt;
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
  // Neither finishing nor being arrested ends the race: positions four through
  // fourteen are still being decided and the results screen wants them, so the
  // field rides on until everybody is home or out.
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
    if (racing(entry)) stepRider(entry.rider, entry.input, track, tuning, dt);
  }
  let backS = Infinity;
  let leadS = -Infinity;
  for (const entry of race.entries) {
    if (!racing(entry)) continue;
    if (entry.rider.pos.s < backS) backS = entry.rider.pos.s;
    if (entry.rider.pos.s > leadS) leadS = entry.rider.pos.s;
  }
  if (leadS - backS > MAX_FIELD_SPAN) backS = leadS - MAX_FIELD_SPAN;
  stepTraffic(race.traffic, track, backS, leadS, race.rng, tuning, dt);

  // Attacks begin from the latched input, then every attack in flight advances
  // together — so no rider wins an exchange by being stored first.
  for (const entry of race.entries) {
    const wanted = entry.input.attack;
    if (racing(entry) && wanted != null) {
      startAttack(entry.rider, wanted, race.combat);
    }
  }
  stepCombat(race.riders, race.dropped, track, race.combat, tuning, dt);

  // Police decide after combat, so an officer reacts to the road as it is at
  // the end of the tick rather than as it was at the start.
  stepPolice(race.police, race.riders, track, race.policeData, race.combat, dt);
  for (const unit of race.police) {
    if (unit.active) stepRider(unit.rider, unit.input, track, tuning, dt);
  }

  for (const entry of race.entries) {
    if (!racing(entry)) continue;
    resolveFor(entry.rider, race, track, tuning);
    if (progress(entry.rider.pos, track) >= track.totalLength) {
      entry.finishTick = race.tick;
    }
  }

  accrueDamage(race);
  updateStandings(race, track);

  // A bust ends the race, and it can only happen to the player: nobody is
  // watching whether a rival got arrested.
  if (
    racing(player) &&
    arrestedBy(player.rider, race.police, track, race.policeData)
  ) {
    fail(race, 'arrested');
    return;
  }
  if (racing(player) && player.rider.damage >= race.policeData.damage.wreckAt) {
    fail(race, 'wrecked');
    return;
  }
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
  to.failReason = from.failReason;
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
    b.out = a.out;
    b.wasDown = a.wasDown;
    b.lastStamina = a.lastStamina;
    b.input.throttle = a.input.throttle;
    b.input.brake = a.input.brake;
    b.input.lean = a.input.lean;
    b.input.attack = a.input.attack ?? null;
    b.brain.targetT = a.brain.targetT;
    b.brain.thinkTimer = a.brain.thinkTimer;
    b.brain.cornerLimit = a.brain.cornerLimit;
    b.brain.pace = a.brain.pace;
    b.brain.lastStamina = a.brain.lastStamina;
    b.brain.grudge = a.brain.grudge;
    b.brain.swingTimer = a.brain.swingTimer;
  }
  for (let i = 0; i < from.police.length; i += 1) {
    const a = from.police[i];
    const b = to.police[i];
    if (!a || !b) continue;
    copyRider(a.rider, b.rider);
    b.state = a.state;
    b.target = a.target;
    b.slowFor = a.slowFor;
    b.ramTimer = a.ramTimer;
    b.blocking = a.blocking;
    b.noticeTimer = a.noticeTimer;
    b.targetT = a.targetT;
    b.active = a.active;
    b.input.throttle = a.input.throttle;
    b.input.brake = a.input.brake;
    b.input.lean = a.input.lean;
    b.input.attack = a.input.attack ?? null;
  }

  copyTraffic(from.traffic, to.traffic);
  for (let i = 0; i < from.dropped.length; i += 1) {
    const a = from.dropped[i];
    const b = to.dropped[i];
    if (!a || !b) continue;
    b.kind = a.kind;
    b.s = a.s;
    b.t = a.t;
    b.branchId = a.branchId;
    b.settle = a.settle;
    b.active = a.active;
  }
}
