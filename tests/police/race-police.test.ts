import { describe, expect, it } from 'vitest';
import { allHome, playerEntry, stepRace } from '../../src/core/sim/race.ts';
import { outcomeOf } from '../../src/core/police/outcome.ts';
import { crash } from '../../src/core/sim/collide.ts';
import {
  police as policeData,
  raceOn,
  trackFor,
  tuning,
} from '../helpers/race.ts';
import type { InputFrame } from '../../src/core/sim/types.ts';

/**
 * Police inside a real race.
 *
 * The unit tests put one officer on a synthetic straight. These check that a
 * route with police on it produces pursuits, damage and busts while everything
 * else in the game is also happening.
 */

const FLAT_OUT: InputFrame = { throttle: 1, brake: 0, lean: 0 };

describe('police on a real route', () => {
  it('take an interest in a field riding flat out', () => {
    const track = trackFor('ring-road-t4');
    const race = raceOn(track, 5);
    expect(race.police.length).toBeGreaterThan(0);

    let pursued = 0;
    for (let i = 0; i < 60 * 200; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      // Not `!== 'racing'`: the first three seconds are the countdown, and
      // breaking on that leaves the loop before anybody has moved.
      if (race.phase === 'failed' || race.phase === 'finished') break;
      for (const unit of race.police) {
        if (unit.state === 'pursuing') pursued += 1;
      }
    }
    expect(pursued).toBeGreaterThan(0);
  }, 120_000);

  it('leave a tier-1 race entirely alone', () => {
    // The difficulty curve says tier 1 teaches riding. No police, from data.
    const track = trackFor('ring-road-t1');
    const race = raceOn(track, 5);
    expect(race.police.length).toBe(0);

    for (let i = 0; i < 60 * 90; i += 1)
      stepRace(race, FLAT_OUT, track, tuning);
    expect(race.failReason).toBeNull();
  }, 60_000);

  it('never let a police rider into the standings', () => {
    const track = trackFor('ring-road-t4');
    const race = raceOn(track, 5);
    const ids = new Set(race.entries.map((e) => e.profile.id));

    for (let i = 0; i < 60 * 120; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      if (race.phase !== 'racing' && race.phase !== 'countdown') break;
    }
    expect(race.order.length).toBe(14);
    for (const index of race.order) {
      expect(ids.has(race.entries[index]?.profile.id ?? '')).toBe(true);
    }
  }, 60_000);
});

describe('bike damage accumulates across a race', () => {
  it('starts at nothing and rises with crashes', () => {
    const track = trackFor('old-city-t3');
    const race = raceOn(track, 11);
    const player = playerEntry(race);
    expect(player.rider.damage).toBe(0);

    for (let i = 0; i < 60 * 240; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      if (race.phase === 'failed' || allHome(race)) break;
    }
    expect(player.rider.damage).toBeGreaterThan(0);
  }, 120_000);

  it('charges a crash once, not for every tick of the slide', () => {
    // Same shape as the Phase 5 hazard fix: on the edge, not while inside.
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track);
    const player = playerEntry(race);
    while (race.phase === 'countdown') stepRace(race, FLAT_OUT, track, tuning);

    player.rider.damage = 0;
    crash(player.rider, 'traffic', tuning);
    stepRace(race, FLAT_OUT, track, tuning);
    const afterOne = player.rider.damage;
    expect(afterOne).toBeGreaterThan(0);

    // The whole slide and remount adds nothing further.
    for (let i = 0; i < 60 * 3; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      if (player.rider.state === 'riding') break;
    }
    expect(player.rider.damage).toBeCloseTo(afterOne, 6);
  }, 60_000);

  it('never goes past the wreck threshold', () => {
    const track = trackFor('old-city-t5');
    const race = raceOn(track, 3);
    for (let i = 0; i < 60 * 200; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      for (const entry of race.entries) {
        expect(entry.rider.damage).toBeLessThanOrEqual(
          policeData.damage.wreckAt,
        );
      }
      if (race.phase === 'failed') break;
    }
  }, 120_000);
});

describe('a race that ends badly', () => {
  it('ends the moment the player is wrecked, and says so', () => {
    const track = trackFor('ridge-run-t2');
    const race = raceOn(track);
    const player = playerEntry(race);
    while (race.phase === 'countdown') stepRace(race, FLAT_OUT, track, tuning);

    player.rider.damage = policeData.damage.wreckAt;
    stepRace(race, FLAT_OUT, track, tuning);

    expect(race.phase).toBe('failed');
    expect(race.failReason).toBe('wrecked');

    const out = outcomeOf(race, 8000);
    expect(out.wrecked).toBe(true);
    expect(out.prize).toBe(0);
    expect(out.repair).toBeGreaterThan(0);
    expect(out.net).toBeLessThan(0);
  }, 60_000);

  it('ends on an arrest, with a fine and no prize', () => {
    const track = trackFor('ring-road-t3');
    const race = raceOn(track);
    const player = playerEntry(race);
    while (race.phase === 'countdown') stepRace(race, FLAT_OUT, track, tuning);

    const unit = race.police[0];
    if (!unit) throw new Error('this route should have police');
    // Put an officer on the player, chasing, and knock the player down.
    unit.state = 'pursuing';
    // The target is an index into `race.riders`, and an officer whose target
    // does not resolve drops straight back to patrolling.
    unit.target = race.riders.indexOf(player.rider);
    expect(unit.target).toBeGreaterThanOrEqual(0);
    unit.rider.pos.branchId = player.rider.pos.branchId;
    unit.rider.pos.s = player.rider.pos.s + 3;
    unit.rider.pos.t = player.rider.pos.t;
    // Put the player down directly. Shoving `t` off the road does not work:
    // `clampToRoad` pulls them back before the collision check ever runs.
    crash(player.rider, 'traffic', tuning);

    stepRace(race, FLAT_OUT, track, tuning);
    expect(race.phase).toBe('failed');
    expect(race.failReason).toBe('arrested');

    const out = outcomeOf(race, 8000);
    expect(out.fine).toBeGreaterThan(0);
    expect(out.prize).toBe(0);
    expect(out.finished).toBe(false);
  }, 60_000);

  it('parks the wrecked player and lets the rest of the field ride on', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track);
    while (race.phase === 'countdown') stepRace(race, FLAT_OUT, track, tuning);
    const player = playerEntry(race);
    player.rider.damage = policeData.damage.wreckAt;
    stepRace(race, FLAT_OUT, track, tuning);
    expect(player.out).toBe(true);

    const parked = player.rider.pos.s;
    for (let i = 0; i < 120; i += 1) stepRace(race, FLAT_OUT, track, tuning);
    // A wrecked bike goes nowhere; the race it was in carries on without it.
    expect(player.rider.pos.s).toBe(parked);
    expect(race.tick).toBeGreaterThan(0);
    expect(allHome(race)).toBe(false);
  }, 60_000);
});
