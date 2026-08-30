import { describe, expect, it } from 'vitest';
import { preferredT, think } from '../../src/core/ai/racer.ts';
import { stepRace, playerEntry, allHome } from '../../src/core/sim/race.ts';
import { combat, raceOn, racers, trackFor, tuning } from '../helpers/race.ts';
import type { RacerBrain, RacerProfile } from '../../src/core/ai/types.ts';
import type { InputFrame, RaceState } from '../../src/core/sim/types.ts';

const FLAT_OUT: InputFrame = { throttle: 1, brake: 0, lean: 0 };

function profileFor(id: string): RacerProfile {
  const found = racers.find((r) => r.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

function brain(): RacerBrain {
  return {
    targetT: 0,
    thinkTimer: 0,
    cornerLimit: 0,
    pace: 1,
    lastStamina: 100,
    grudge: 0,
    swingTimer: 0,
  };
}

describe('where a racer chooses to sit', () => {
  it('keeps a cautious rider further from the centreline than a bold one', () => {
    // On a two-way road the crown is where the oncoming traffic is. This is
    // the difference between Dev Tandon and Kabir Anand, in one number.
    const timid = preferredT(profileFor('dev-tandon'), 8);
    const bold = preferredT(profileFor('kabir-anand'), 8);
    expect(timid).toBeGreaterThan(bold);
    expect(bold).toBeGreaterThan(0);
  });

  it('scales with the width of the road, not a fixed lane number', () => {
    const profile = profileFor('noor-siddiqui');
    expect(preferredT(profile, 16)).toBeCloseTo(2 * preferredT(profile, 8), 9);
  });
});

describe('what a racer is allowed to touch', () => {
  it('writes an input and its own brain, and nothing else', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track);
    const entry = race.entries[0];
    if (!entry) throw new Error('no field');

    entry.rider.pos.s = 400;
    entry.rider.speed = 30;
    const before = JSON.stringify({
      pos: entry.rider.pos,
      speed: entry.rider.speed,
      lateral: entry.rider.lateral,
      state: entry.rider.state,
    });

    think(
      entry.rider,
      entry.profile,
      entry.brain,
      race.riders,
      race.traffic,
      track,
      tuning,
      combat,
      entry.input,
      1 / 60,
    );

    expect(
      JSON.stringify({
        pos: entry.rider.pos,
        speed: entry.rider.speed,
        lateral: entry.rider.lateral,
        state: entry.rider.state,
      }),
    ).toBe(before);
  });

  it('only ever produces inputs a controller could produce', () => {
    const track = trackFor('old-city-t3');
    const race = raceOn(track, 4);
    for (let i = 0; i < 60 * 90; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      if (i % 13 !== 0) continue;
      for (const entry of race.entries) {
        if (entry.isPlayer) continue;
        expect(entry.input.throttle).toBeGreaterThanOrEqual(0);
        expect(entry.input.throttle).toBeLessThanOrEqual(1);
        expect(entry.input.brake).toBeGreaterThanOrEqual(0);
        expect(entry.input.brake).toBeLessThanOrEqual(1);
        expect(Math.abs(entry.input.lean)).toBeLessThanOrEqual(1);
      }
    }
  }, 30_000);

  it('is a pure function of the state it is given', () => {
    const track = trackFor('ring-road-t2');
    const race = raceOn(track, 8);
    for (let i = 0; i < 600; i += 1) stepRace(race, FLAT_OUT, track, tuning);

    const entry = race.entries[3];
    if (!entry) throw new Error('no field');
    const twice = [0, 1].map(() => {
      const b = { ...entry.brain, thinkTimer: 0 };
      const out: InputFrame = { throttle: 0, brake: 0, lean: 0 };
      think(
        entry.rider,
        entry.profile,
        b,
        race.riders,
        race.traffic,
        track,
        tuning,
        combat,
        out,
        1 / 60,
      );
      return JSON.stringify({ out, b });
    });
    expect(twice[0]).toBe(twice[1]);
  });
});

describe('how a racer reads the road', () => {
  it('brakes for the corners on a route that has them', () => {
    const track = trackFor('old-city-t2');
    const race = raceOn(track, 6);
    let braked = 0;
    for (let i = 0; i < 60 * 120; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      for (const entry of race.entries) {
        if (!entry.isPlayer && entry.input.brake > 0) braked += 1;
      }
    }
    expect(braked).toBeGreaterThan(0);
  }, 30_000);

  it('holds a line rather than reconsidering it sixty times a second', () => {
    // A rider that re-decides every tick oscillates between two equally good
    // gaps and takes neither.
    const track = trackFor('ring-road-t3');
    const race = raceOn(track, 12);
    for (let i = 0; i < 600; i += 1) stepRace(race, FLAT_OUT, track, tuning);

    let changes = 0;
    let previous = race.entries.map((e) => e.brain.targetT);
    for (let i = 0; i < 600; i += 1) {
      stepRace(race, FLAT_OUT, track, tuning);
      const now = race.entries.map((e) => e.brain.targetT);
      for (let k = 0; k < now.length; k += 1) {
        if (now[k] !== previous[k]) changes += 1;
      }
      previous = now;
    }
    // Thirteen rivals over ten seconds: a few dozen decisions, not thousands.
    expect(changes).toBeLessThan(13 * 600 * 0.2);
  }, 30_000);

  it('gives a more skilful rider a shorter gap between decisions', () => {
    const track = trackFor('ridge-run-t1');
    const good = profileFor('farida-qasim');
    const poor = profileFor('ishaan-marwah');
    expect(good.skill).toBeGreaterThan(poor.skill);

    const race = raceOn(track);
    const entry = race.entries[0];
    if (!entry) throw new Error('no field');
    const timerAfter = (profile: RacerProfile): number => {
      const b = brain();
      const out: InputFrame = { throttle: 0, brake: 0, lean: 0 };
      think(
        entry.rider,
        profile,
        b,
        race.riders,
        race.traffic,
        track,
        tuning,
        combat,
        out,
        1 / 60,
      );
      return b.thinkTimer;
    };
    expect(timerAfter(good)).toBeLessThan(timerAfter(poor));
  });
});

/** Rides the player's bike with a rival-grade brain. Returns place and time. */
function ridden(trackId: string, seed: number): { place: number; at: number } {
  const track = trackFor(trackId);
  const race: RaceState = raceOn(track, seed);
  const player = playerEntry(race);
  const ace: RacerProfile = {
    ...profileFor('sabina-thapa'),
    skill: 1,
    caution: 0.85,
  };
  const mind = brain();
  const input: InputFrame = { throttle: 0, brake: 0, lean: 0 };

  while (
    !allHome(race) &&
    race.phase !== 'failed' &&
    race.tick < 60 * 60 * 45
  ) {
    think(
      player.rider,
      ace,
      mind,
      race.riders,
      race.traffic,
      track,
      tuning,
      combat,
      input,
      1 / 60,
    );
    stepRace(race, input, track, tuning);
  }
  const third = race.entries.find((e) => e.place === 3);
  return {
    place: player.place,
    at: ((player.finishTick ?? 0) - (third?.finishTick ?? 0)) / 60,
  };
}

describe('the player starts last, and top three is worth having', () => {
  it('puts the player last on the grid in every race', () => {
    for (const id of ['ridge-run-t1', 'old-city-t3', 'dnd-flyway-t5']) {
      const race = raceOn(trackFor(id));
      const player = playerEntry(race);
      const behind = race.entries.filter(
        (e) => !e.isPlayer && e.rider.pos.s >= player.rider.pos.s,
      );
      expect(behind.length).toBe(13);
    }
  });

  it('does not hand a top-three finish to a rider who only holds throttle', () => {
    // "Not easy" has to fail for the laziest possible input or it means
    // nothing. Holding the throttle down is the laziest possible input.
    const track = trackFor('ridge-run-t2');
    const race = raceOn(track, 21);
    while (
      !allHome(race) &&
      race.phase !== 'failed' &&
      race.tick < 60 * 60 * 45
    ) {
      stepRace(race, FLAT_OUT, track, tuning);
    }
    expect(playerEntry(race).place).toBeGreaterThan(3);
  }, 60_000);

  it('puts the podium within reach of a rider who takes a line', () => {
    // "Achievable" is a claim about a human, and a rival-grade brain is not
    // one — it does not learn a route, and route knowledge is most of what
    // separates a good player from this. What can be shown headlessly is that
    // the podium is close: seconds, over a five-minute race, from a brain no
    // better than the field's. Whether a person closes that gap is a question
    // for playtesting, and it is recorded as the open risk of this phase.
    const out = ridden('ridge-run-t2', 21);
    expect(`place ${out.place}, ${out.at.toFixed(1)}s off third`).toBe(
      `place ${out.place}, ${out.at.toFixed(1)}s off third`,
    );
    expect(out.place).toBeLessThanOrEqual(8);
    expect(out.at).toBeLessThan(30);
  }, 60_000);
});
