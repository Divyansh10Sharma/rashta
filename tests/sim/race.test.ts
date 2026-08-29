import { describe, expect, it } from 'vitest';
import {
  allHome,
  copyRace,
  createRace,
  playerEntry,
  retire,
  stepRace,
  updateStandings,
} from '../../src/core/sim/race.ts';
import { progress } from '../../src/core/track/distance.ts';
import { MAIN_BRANCH } from '../../src/core/types.ts';
import {
  bikeFor,
  combat,
  raceOn,
  racers,
  trackFor,
  tuning,
} from '../helpers/race.ts';
import type { Track } from '../../src/core/track/Track.ts';
import type { InputFrame, RaceState } from '../../src/core/sim/types.ts';

const FLAT_OUT: InputFrame = { throttle: 1, brake: 0, lean: 0 };

/** Runs a race until everybody is home, or `limit` ticks have passed. */
function runToEnd(race: RaceState, track: Track, limit = 60 * 60 * 30): number {
  let ticks = 0;
  while (!allHome(race) && race.phase !== 'failed' && ticks < limit) {
    stepRace(race, FLAT_OUT, track, tuning);
    ticks += 1;
  }
  return ticks;
}

describe('the grid', () => {
  it('fields fourteen riders with the player last', () => {
    const race = raceOn(trackFor('ridge-run-t1'));
    expect(race.entries.length).toBe(14);

    const player = playerEntry(race);
    expect(player.isPlayer).toBe(true);
    // Last on the grid means furthest back along the road, which is the whole
    // premise: you start last, every time. GAME_DESIGN.md.
    for (const entry of race.entries) {
      if (entry === player) continue;
      expect(entry.rider.pos.s).toBeGreaterThanOrEqual(player.rider.pos.s);
    }
  });

  it('starts nobody on top of anybody else', () => {
    const race = raceOn(trackFor('ring-road-t1'));
    for (let a = 0; a < race.entries.length; a += 1) {
      for (let b = a + 1; b < race.entries.length; b += 1) {
        const ra = race.entries[a]?.rider;
        const rb = race.entries[b]?.rider;
        if (!ra || !rb) continue;
        const apart =
          Math.abs(ra.pos.s - rb.pos.s) > 1 ||
          Math.abs(ra.pos.t - rb.pos.t) > 1;
        expect(apart).toBe(true);
      }
    }
  });

  it('refuses to build a race for a rider who is not on the roster', () => {
    expect(() =>
      createRace(racers, 'nobody', bikeFor, trackFor('ridge-run-t1'), combat),
    ).toThrow(/no racer profile with id "nobody"/);
  });
});

describe('the state machine', () => {
  it('holds the whole field still through the countdown', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track);
    const held = Math.floor(tuning.countdownSeconds * 60);

    for (let i = 0; i < held; i += 1) stepRace(race, FLAT_OUT, track, tuning);
    expect(race.phase).toBe('countdown');
    for (const entry of race.entries) expect(entry.rider.speed).toBe(0);
    expect(race.clock).toBe(0);

    stepRace(race, FLAT_OUT, track, tuning);
    expect(race.phase).toBe('racing');
  });

  it('opens every throttle on the same tick', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track);
    while (race.phase === 'countdown') stepRace(race, FLAT_OUT, track, tuning);
    for (const entry of race.entries) {
      expect(entry.rider.speed).toBeGreaterThan(0);
    }
  });

  it('finishes when the player crosses, and keeps the field racing', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track, 5);
    while (race.phase !== 'finished' && race.tick < 60 * 60 * 20) {
      stepRace(race, FLAT_OUT, track, tuning);
    }
    expect(race.phase).toBe('finished');
    expect(playerEntry(race).finishTick).not.toBeNull();

    // The player's race is over. Fourth through fourteenth are not decided.
    const stragglers = race.entries.filter((e) => e.finishTick === null);
    if (stragglers.length > 0) {
      const before = race.tick;
      stepRace(race, FLAT_OUT, track, tuning);
      expect(race.tick).toBeGreaterThan(before);
    }
  });

  it('stops stepping once everybody is home', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track, 5);
    runToEnd(race, track);
    expect(allHome(race)).toBe(true);

    const settled = race.tick;
    stepRace(race, FLAT_OUT, track, tuning);
    expect(race.tick).toBe(settled);
  });

  it('fails when the player retires, and stays failed', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track);
    for (let i = 0; i < 600; i += 1) stepRace(race, FLAT_OUT, track, tuning);
    retire(race);
    expect(race.phase).toBe('failed');

    const frozen = race.tick;
    stepRace(race, FLAT_OUT, track, tuning);
    expect(race.tick).toBe(frozen);

    retire(race);
    expect(race.phase).toBe('failed');
  });
});

describe('standings', () => {
  it('ranks by progress, not by the odometer, mid-fork', () => {
    // A branch on this route is a few percent longer than the stretch of main
    // road it replaces, so a rider on the main road can be ahead on progress
    // while showing a *smaller* odometer than a rider on the branch. Sorting
    // on raw `s` gets that backwards, and gets it backwards on the HUD.
    const track = trackFor('yamuna-bank-t2');
    const branch = track.branches.reduce((best, b) =>
      b.path.length / (b.rejoinS - b.forkS) >
      best.path.length / (best.rejoinS - best.forkS)
        ? b
        : best,
    );
    // `pos.branchId` is the 1-based index into the track's branches; the
    // branch's own `id` is the name in the data file.
    const branchId = track.branches.indexOf(branch) + 1;
    const span = branch.rejoinS - branch.forkS;
    const ratio = branch.path.length / span;
    expect(ratio).toBeGreaterThan(1);

    // Halfway between "level" and "as far apart as the geometry allows", so
    // the test still holds if a route is redrawn slightly.
    const onBranch = 0.9;
    const onMain = onBranch * ((1 + ratio) / 2);

    const race = raceOn(track);
    const [a, b] = race.entries;
    if (!a || !b) throw new Error('no field');
    a.rider.pos.branchId = MAIN_BRANCH;
    a.rider.pos.s = branch.forkS + onMain * span;
    b.rider.pos.branchId = branchId;
    b.rider.pos.s = branch.forkS + onBranch * branch.path.length;

    expect(a.rider.pos.s).toBeLessThan(b.rider.pos.s);
    expect(progress(a.rider.pos, track)).toBeGreaterThan(
      progress(b.rider.pos, track),
    );

    updateStandings(race, track);
    expect(a.place).toBeLessThan(b.place);
  });

  it('never demotes a rider who has already finished', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track, 3);
    const [a, b] = race.entries;
    if (!a || !b) throw new Error('no field');

    a.finishTick = 100;
    b.finishTick = null;
    b.rider.pos.s = track.totalLength * 0.99;
    updateStandings(race, track);
    expect(a.place).toBeLessThan(b.place);
  });

  it('orders finishers by the tick they crossed', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track, 5);
    runToEnd(race, track);

    let previous = -1;
    for (const index of race.order) {
      const entry = race.entries[index];
      if (!entry || entry.finishTick === null) continue;
      expect(entry.finishTick).toBeGreaterThanOrEqual(previous);
      previous = entry.finishTick;
    }
  });
});

describe('determinism', () => {
  it('produces the same finishing order from the same seed', () => {
    const track = trackFor('yamuna-bank-t2');
    const results = [0, 1].map(() => {
      const race = raceOn(track, 17);
      runToEnd(race, track);
      return race.order
        .map((i) => {
          const entry = race.entries[i];
          return `${entry?.profile.id ?? '?'}@${entry?.finishTick ?? '-'}`;
        })
        .join(' ');
    });
    expect(results[0]).toBe(results[1]);
    // Two complete fourteen-rider races, and slower again under coverage.
  }, 60_000);

  it('does not produce the same race from a different seed', () => {
    // Traffic is seeded, so a different seed is a different set of obstacles.
    // If this ever passes trivially, the seed is not reaching the race.
    const track = trackFor('ring-road-t2');
    const finish = (seed: number): string => {
      const race = raceOn(track, seed);
      runToEnd(race, track);
      return race.order.map((i) => race.entries[i]?.profile.id).join(' ');
    };
    expect(finish(2)).not.toBe(finish(9));
    // Two whole fourteen-rider races on a busy route. Slow on purpose.
  }, 60_000);
});

describe('rubber-banding', () => {
  it('is off in the shipped data file', () => {
    expect(tuning.rubberBanding).toBe(0);
  });

  it('leaves every rival at pace exactly 1 when off', () => {
    const track = trackFor('ridge-run-t1');
    const race = raceOn(track);
    for (let i = 0; i < 60 * 20; i += 1)
      stepRace(race, FLAT_OUT, track, tuning);
    for (const entry of race.entries) {
      if (!entry.isPlayer) expect(entry.brain.pace).toBe(1);
    }
  });

  it('slows a rival that is ahead and hurries one that is behind', () => {
    const track = trackFor('ridge-run-t1');
    const banded = { ...tuning, rubberBanding: 0.2 };
    const race = raceOn(track);
    for (let i = 0; i < 60 * 30; i += 1)
      stepRace(race, FLAT_OUT, track, banded);

    const player = playerEntry(race);
    const at = progress(player.rider.pos, track);
    for (const entry of race.entries) {
      if (entry.isPlayer) continue;
      const ahead = progress(entry.rider.pos, track) > at;
      if (ahead) expect(entry.brain.pace).toBeLessThanOrEqual(1);
      else expect(entry.brain.pace).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('copying a race for the renderer', () => {
  it('reproduces the whole state without sharing any mutable object', () => {
    const track = trackFor('ring-road-t2');
    const from = raceOn(track, 31);
    const to = raceOn(track, 31);
    for (let i = 0; i < 60 * 40; i += 1)
      stepRace(from, FLAT_OUT, track, tuning);

    copyRace(from, to);
    expect(to.phase).toBe(from.phase);
    expect(to.tick).toBe(from.tick);
    expect(to.clock).toBe(from.clock);
    expect(to.countdown).toBe(from.countdown);
    expect(to.order).toEqual(from.order);

    for (let i = 0; i < from.entries.length; i += 1) {
      const a = from.entries[i];
      const b = to.entries[i];
      if (!a || !b) throw new Error('field mismatch');
      expect(b.rider.pos).toEqual(a.rider.pos);
      expect(b.rider.speed).toBe(a.rider.speed);
      expect(b.rider.lastS).toBe(a.rider.lastS);
      expect(b.rider.state).toBe(a.rider.state);
      expect(b.finishTick).toBe(a.finishTick);
      expect(b.place).toBe(a.place);
      expect(b.brain).toEqual(a.brain);
      // Copied, not aliased: the two states must be able to differ.
      expect(b.rider.pos).not.toBe(a.rider.pos);
      expect(b.rider).not.toBe(a.rider);
      // Except the bike, which is immutable tuning data.
      expect(b.rider.bike).toBe(a.rider.bike);
    }
    for (let i = 0; i < from.traffic.length; i += 1) {
      expect(to.traffic[i]).toEqual(from.traffic[i]);
      expect(to.traffic[i]).not.toBe(from.traffic[i]);
    }
  }, 30_000);

  it('allocates nothing: the copy reuses the same objects every time', () => {
    const track = trackFor('ridge-run-t1');
    const from = raceOn(track, 2);
    const to = raceOn(track, 2);
    const riders = to.entries.map((e) => e.rider);
    const positions = to.entries.map((e) => e.rider.pos);

    for (let i = 0; i < 300; i += 1) {
      stepRace(from, FLAT_OUT, track, tuning);
      copyRace(from, to);
    }
    for (let i = 0; i < riders.length; i += 1) {
      expect(to.entries[i]?.rider).toBe(riders[i]);
      expect(to.entries[i]?.rider.pos).toBe(positions[i]);
    }
  });
});
