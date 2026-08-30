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

  // Counted here rather than read from `race.tick`: a failed race stops
  // advancing its own clock, so a loop bounded by it never ends. See devlog
  // phase-08.
  const limit = 60 * 60 * 45;
  let steps = 0;
  // No `phase !== 'failed'` guard: the player being wrecked or arrested no
  // longer stops the race, and the thirteen riders this test is about are
  // still going.
  while (!allHome(race) && steps < limit) {
    stepRace(race, FLAT_OUT, track, tuning);
    steps += 1;
    if (race.tick % 60 !== 0) continue;

    for (let i = 0; i < race.entries.length; i += 1) {
      const entry = race.entries[i];
      // A rider who is out is meant to stop moving. Only riders still on the
      // road can be stuck.
      if (!entry || entry.finishTick !== null || entry.out) continue;
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
      // Thirteen rivals, not fourteen riders: with police and bike damage in
      // the game, a player holding the throttle down and never steering gets
      // arrested or wrecked, and should. What this test is about is whether
      // the AI can get itself round.
      expect(
        `${id} rivals home: ${out.finished - (out.playerHome ? 1 : 0)}`,
      ).toBe(`${id} rivals home: 13`);
      expect(out.rivalsHome).toBe(true);
      // A tier-5 route is 25 km and this runs it to the line for thirteen
      // riders, through traffic, police and a fight. It takes 75 s alone and
      // twice that when the rest of the suite is competing for the machine.
    }, 300_000);
  }
});
