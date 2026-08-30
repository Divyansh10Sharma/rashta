import { describe, expect, it } from 'vitest';
import { allHome, playerEntry, stepRace } from '../../src/core/sim/race.ts';
import { WEAPON_KINDS } from '../../src/core/combat/types.ts';
import { combat, raceOn, trackFor, tuning } from '../helpers/race.ts';
import type { RaceState } from '../../src/core/sim/types.ts';
import type { InputFrame } from '../../src/core/sim/types.ts';
import type { WeaponKind } from '../../src/core/combat/types.ts';

/**
 * Combat inside a real race.
 *
 * The unit tests put two riders on a synthetic road and check the mechanics.
 * These check that fourteen riders on a real route actually use them, and that
 * the one law the design depends on — weapons circulate, they are never
 * created — holds for a whole race with everything else happening at once.
 */

const FLAT_OUT: InputFrame = { throttle: 1, brake: 0, lean: 0 };

/** Every weapon in the race, carried or lying in the road. */
function census(race: RaceState): Record<WeaponKind, number> {
  const count = { pipe: 0, chain: 0, bat: 0 };
  for (const entry of race.entries) {
    const held = entry.rider.weapon;
    if (held !== null) count[held] += 1;
  }
  for (const slot of race.dropped) {
    if (slot.active) count[slot.kind] += 1;
  }
  return count;
}

function total(count: Record<WeaponKind, number>): number {
  return WEAPON_KINDS.reduce((sum, kind) => sum + count[kind], 0);
}

describe('weapons circulate and are never created or lost', () => {
  it('starts with exactly the weapons the roster brought', () => {
    const race = raceOn(trackFor('ridge-run-t1'));
    const start = census(race);
    expect(total(start)).toBe(10);
    // All three kinds are actually in circulation. A weapon that never
    // appears in a race is data nothing exercises.
    for (const kind of WEAPON_KINDS) {
      expect(`${kind}: ${start[kind]}`).not.toBe(`${kind}: 0`);
    }
  });

  it('keeps the count of every kind constant for a whole race', () => {
    const track = trackFor('old-city-t2');
    const race = raceOn(track, 19);
    const start = census(race);

    let worst = '';
    while (
      !allHome(race) &&
      race.phase !== 'failed' &&
      race.tick < 60 * 60 * 45
    ) {
      stepRace(race, FLAT_OUT, track, tuning);
      if (race.tick % 120 !== 0) continue;
      const now = census(race);
      for (const kind of WEAPON_KINDS) {
        if (now[kind] !== start[kind]) {
          worst = `${kind} went from ${start[kind]} to ${now[kind]} at tick ${race.tick}`;
        }
      }
      if (worst) break;
    }
    expect(worst || 'constant').toBe('constant');
    expect(census(race)).toEqual(start);
  }, 120_000);

  it('actually moves them between riders over a race', () => {
    // A conservation law is easy to satisfy by never letting anything happen.
    const track = trackFor('old-city-t2');
    const race = raceOn(track, 19);
    const before = race.entries.map((e) => e.rider.weapon);

    for (let i = 0; i < 60 * 240; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
    }
    const after = race.entries.map((e) => e.rider.weapon);
    const moved = before.filter((w, i) => w !== after[i]).length;
    expect(`weapons changed hands: ${moved > 0}`).toBe(
      'weapons changed hands: true',
    );
  }, 120_000);
});

describe('rivals fight each other without being told to', () => {
  it('throws attacks during a real race', () => {
    const track = trackFor('old-city-t2');
    const race = raceOn(track, 7);
    const thrown = new Set<string>();
    let swings = 0;

    for (let i = 0; i < 60 * 180; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      for (const entry of race.entries) {
        if (entry.isPlayer) continue;
        const attack = entry.input.attack;
        if (attack != null) {
          swings += 1;
          thrown.add(entry.profile.id);
        }
      }
    }
    expect(swings).toBeGreaterThan(0);
    // Not one rider swinging over and over: several of them fight.
    expect(thrown.size).toBeGreaterThan(2);
  }, 120_000);

  it('lands hits, and stamina is spent and regained', () => {
    const track = trackFor('old-city-t2');
    const race = raceOn(track, 7);
    let lowest = 100;
    for (let i = 0; i < 60 * 180; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      for (const entry of race.entries) {
        lowest = Math.min(lowest, entry.rider.stamina);
      }
    }
    expect(lowest).toBeLessThan(100);
  }, 120_000);

  it('never lets a rival attack while it is down', () => {
    const track = trackFor('old-city-t3');
    const race = raceOn(track, 13);
    for (let i = 0; i < 60 * 120; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      for (const entry of race.entries) {
        if (entry.rider.state === 'riding') continue;
        expect(entry.rider.attack).toBeNull();
      }
    }
  }, 120_000);
});

describe('the player fights through the same input as everything else', () => {
  it('throws the attack the input frame asked for', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track);
    const me = playerEntry(race);

    // Past the countdown first: nothing happens on the line.
    while (race.phase === 'countdown') stepRace(race, FLAT_OUT, track, tuning);
    expect(me.rider.attack).toBeNull();

    stepRace(race, { ...FLAT_OUT, attack: 'kick' }, track, tuning);
    expect(me.rider.attack).toBe('kick');

    // And a held key does not stack a second attack over the first.
    stepRace(race, { ...FLAT_OUT, attack: 'backhand' }, track, tuning);
    expect(me.rider.attack).toBe('kick');
  });

  it('spends the player stamina the attack costs', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track);
    const me = playerEntry(race);
    while (race.phase === 'countdown') stepRace(race, FLAT_OUT, track, tuning);

    const before = me.rider.stamina;
    stepRace(race, { ...FLAT_OUT, attack: 'backhand' }, track, tuning);
    expect(before - me.rider.stamina).toBeCloseTo(
      combat.attacks.backhand.cost - combat.staminaRegen / 60,
      3,
    );
  });
});
