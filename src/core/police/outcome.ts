import { playerEntry } from '../sim/race.ts';
import type { RaceState } from '../sim/types.ts';
import type { PoliceData, RaceOutcome } from './types.ts';

/**
 * What a race cost, in rupees.
 *
 * Phase 7 computes this and stops. There is no wallet, no shop and nothing
 * persisted — Phase 8 owns the career that pays for it, and prize money is
 * zero here because the prize table arrives with it. A speculative economy
 * written now would be the wrong shape by the time Phase 8 came round.
 *
 * Fines and repairs scale with the bike's price, so a bad night on a Super
 * bike is genuinely expensive. That is GAME_DESIGN's rule, not a tuning knob.
 */

/** Rounds to whole rupees. Nobody is fined 4,131.72. */
function rupees(value: number): number {
  return Math.round(value);
}

/** The fine for being arrested on this bike, in rupees. */
export function fineFor(price: number, data: PoliceData): number {
  return rupees(data.arrest.fineBase + price * data.arrest.fineBikeFraction);
}

/**
 * The repair bill for a bike at `damage` out of 100.
 *
 * Linear in damage up to the wreck point, plus a step at the wreck itself:
 * a bike written off costs more than one at 99% damage, because the difference
 * between "expensive" and "you are walking home" should be visible.
 */
export function repairFor(
  price: number,
  damage: number,
  data: PoliceData,
): number {
  const { damage: rates } = data;
  const wrecked = damage >= rates.wreckAt;
  const fraction = (damage / rates.wreckAt) * rates.repairFraction;
  const extra = wrecked ? rates.wreckFraction : 0;
  return rupees(price * (fraction + extra));
}

/** Reads the finished race and totals the night up. */
export function outcomeOf(race: RaceState, prize = 0): RaceOutcome {
  const player = playerEntry(race);
  const price = player.rider.bike.spec.price;
  const data = race.policeData;
  const damage = player.rider.damage;
  const wrecked = damage >= data.damage.wreckAt;

  // An arrest ends the race, so there is no prize to collect either way.
  const arrested = race.failReason === 'arrested';
  const earned = race.phase === 'finished' ? prize : 0;
  const fine = arrested ? fineFor(price, data) : 0;
  const repair = repairFor(price, damage, data);

  return {
    place: player.place,
    finished: player.finishTick !== null,
    failReason: race.failReason,
    prize: earned,
    fine,
    repair,
    damage,
    wrecked,
    net: earned - fine - repair,
  };
}
