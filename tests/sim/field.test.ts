import { describe, expect, it } from 'vitest';
import { allHome, stepRace } from '../../src/core/sim/race.ts';
import { progress } from '../../src/core/track/distance.ts';
import { ROUTE_IDS, raceOn, trackFor, tuning } from '../helpers/race.ts';
import type { InputFrame } from '../../src/core/sim/types.ts';

/**
 * The acceptance test for Phase 5: every AI rider finishes every route.
 *
 * Riding flat out with no steering is not how a person plays, and that is the
 * point — the player input here is deliberately the worst legal input, so
 * anything the rivals do is theirs.
 */

const FLAT_OUT: InputFrame = { throttle: 1, brake: 0, lean: 0 };

/** Seconds a rider may make no ground before we call it stuck. */
const STUCK_SECONDS = 20;

/** Metres of progress that counts as making ground. */
const STUCK_METRES = 5;

interface Outcome {
  finished: number;
  rivalsHome: boolean;
  playerHome: boolean;
  stuck: string[];
  seconds: number;
}

function race25(id: string): Outcome {
  const track = trackFor(id);
  const race = raceOn(track, 11);
  const best = race.entries.map(() => -Infinity);
  const lastGain = race.entries.map(() => 0);
  const stuck: string[] = [];

  const limit = 60 * 60 * 45;
  while (!allHome(race) && race.tick < limit) {
    stepRace(race, FLAT_OUT, track, tuning);
    if (race.tick % 60 !== 0) continue;

    for (let i = 0; i < race.entries.length; i += 1) {
      const entry = race.entries[i];
      if (!entry || entry.finishTick !== null) continue;
      const at = progress(entry.rider.pos, track);
      if (at > (best[i] ?? -Infinity) + STUCK_METRES) {
        best[i] = at;
        lastGain[i] = race.tick;
      } else if (race.tick - (lastGain[i] ?? 0) > STUCK_SECONDS * 60) {
        stuck.push(`${entry.profile.id} at ${at.toFixed(0)} m`);
        lastGain[i] = race.tick;
      }
    }
  }

  const rivals = race.entries.filter((e) => !e.isPlayer);
  return {
    finished: race.entries.filter((e) => e.finishTick !== null).length,
    rivalsHome: rivals.every((e) => e.finishTick !== null),
    playerHome: race.entries.some((e) => e.isPlayer && e.finishTick !== null),
    stuck,
    seconds: race.clock,
  };
}

describe('every AI rider completes every route, on every tier', () => {
  for (const id of ROUTE_IDS) {
    it(`${id}: thirteen rivals get home`, () => {
      const out = race25(id);
      expect(`${id} stuck: ${out.stuck.join(', ') || 'nobody'}`).toBe(
        `${id} stuck: nobody`,
      );
      expect(`${id} finishers: ${out.finished}`).toBe(`${id} finishers: 14`);
      expect(out.rivalsHome).toBe(true);
    }, 120_000);
  }
});
