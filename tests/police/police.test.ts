import { describe, expect, it } from 'vitest';
import {
  arrestedBy,
  createPolice,
  stepPolice,
} from '../../src/core/police/police.ts';
import {
  fineFor,
  outcomeOf,
  repairFor,
} from '../../src/core/police/outcome.ts';
import { stepRider } from '../../src/core/sim/step.ts';
import { crash, stepCrash } from '../../src/core/sim/crash.ts';
import { FIXED_DT } from '../../src/core/sim/step.ts';
import { trackDistance } from '../../src/core/track/distance.ts';
import { createRider } from '../../src/core/sim/world.ts';
import { segment, trackOf } from '../helpers/tracks.ts';
import {
  ROUTE_IDS,
  bikes,
  combat,
  police as policeData,
  raceOn,
  trackFor,
  tuning,
} from '../helpers/race.ts';
import type { Rider } from '../../src/core/sim/types.ts';
import type { PoliceUnit } from '../../src/core/police/types.ts';

/**
 * Police, headless.
 *
 * They are riders on the same road through the same physics, so most of what
 * is worth checking is the pursuit state machine and the money.
 */

const DT = 1 / 60;
const ROAD = trackOf(segment({ length: 4000, curvature: 0 }));

function bike() {
  const found = bikes[0];
  if (!found) throw new Error('no bikes');
  return found;
}

function runner(s: number, speed: number): Rider {
  const made = createRider(bike(), s, 0);
  made.speed = speed;
  return made;
}

/** One officer, on the road, ready to notice things. */
function officer(s = 0): PoliceUnit {
  const units = createPolice(ROAD, bike(), 1);
  const unit = units[0];
  if (!unit) throw new Error('no unit');
  unit.rider.pos.s = s;
  unit.rider.speed = 25;
  return unit;
}

function chase(unit: PoliceUnit, field: Rider[], seconds: number): void {
  for (let i = 0; i < seconds * 60; i += 1) {
    stepPolice([unit], field, ROAD, policeData, combat, DT);
    stepRider(unit.rider, unit.input, ROAD, tuning, DT);
  }
}

describe('police presence is per-tier data', () => {
  it('puts nobody on the road at tier 1, on any route', () => {
    for (const id of ROUTE_IDS) {
      if (!id.endsWith('-t1')) continue;
      const track = trackFor(id);
      expect(`${id}: ${track.data.policeDensity}`).toBe(`${id}: 0`);
      expect(createPolice(track, bike()).length).toBe(0);
    }
  });

  it('rises with every tier, on every route', () => {
    const routes = new Set(ROUTE_IDS.map((id) => id.replace(/-t\d$/, '')));
    for (const route of routes) {
      const counts = [1, 2, 3, 4, 5].map(
        (tier) => createPolice(trackFor(`${route}-t${tier}`), bike()).length,
      );
      for (let i = 1; i < counts.length; i += 1) {
        expect(`${route} t${i + 1}: ${counts[i]}`).not.toBe(
          `${route} t${i + 1}: ${counts[i - 1]}`,
        );
        expect(counts[i] ?? 0).toBeGreaterThan(counts[i - 1] ?? 0);
      }
    }
  });

  it('differs between routes at the same tier, by character', () => {
    // The Ring Road is policed and the Ridge is not, which is what those roads
    // are. A tier lookup table could not say that.
    const ring = trackFor('ring-road-t3').data.policeDensity;
    const ridge = trackFor('ridge-run-t3').data.policeDensity;
    expect(ring).toBeGreaterThan(ridge * 3);
  });

  it('never puts police in the standings', () => {
    const track = trackFor('ring-road-t5');
    const race = raceOn(track);
    expect(race.police.length).toBeGreaterThan(0);
    expect(race.entries.length).toBe(14);
    expect(race.order.length).toBe(14);
    // But they are on the road, where rivals and collisions can see them.
    expect(race.riders.length).toBe(14 + race.police.length);
  });
});

describe('pursuit starts, and can be escaped', () => {
  it('ignores a rider going a sensible speed', () => {
    const unit = officer(0);
    const slow = runner(60, policeData.pursuit.triggerSpeed - 4);
    chase(unit, [slow], 3);
    expect(unit.state).toBe('patrolling');
  });

  it('takes an interest in one going noticeably fast', () => {
    const unit = officer(0);
    const quick = runner(60, policeData.pursuit.triggerSpeed + 6);
    chase(unit, [quick], 2);
    expect(unit.state).toBe('pursuing');
    expect(unit.target).toBe(0);
  });

  it('gives up when the rider slows down for long enough', () => {
    const unit = officer(0);
    const rider = runner(60, policeData.pursuit.triggerSpeed + 6);
    chase(unit, [rider], 2);
    expect(unit.state).toBe('pursuing');

    // Slowing down is the escape, and it has to be sustained: this is the
    // acceptance criterion that says escaping is possible.
    rider.speed = policeData.pursuit.dropSpeed - 3;
    chase(unit, [rider], policeData.pursuit.dropSeconds - 1);
    expect(unit.state).toBe('pursuing');
    chase(unit, [rider], 2);
    expect(unit.state).toBe('patrolling');
  });

  it('does not give up the instant the rider lifts off', () => {
    // A brief lift has to not work, or pursuit means nothing.
    const unit = officer(0);
    const rider = runner(60, policeData.pursuit.triggerSpeed + 6);
    chase(unit, [rider], 2);
    rider.speed = policeData.pursuit.dropSpeed - 3;
    chase(unit, [rider], 1);
    expect(unit.state).toBe('pursuing');
    rider.speed = policeData.pursuit.triggerSpeed + 6;
    chase(unit, [rider], 1);
    expect(unit.slowFor).toBe(0);
  });

  it('gives up on a rider who gets far enough away', () => {
    const unit = officer(0);
    const rider = runner(60, policeData.pursuit.triggerSpeed + 6);
    chase(unit, [rider], 2);
    expect(unit.state).toBe('pursuing');

    rider.pos.s = unit.rider.pos.s + policeData.pursuit.loseDistance + 40;
    chase(unit, [rider], 1);
    expect(unit.state).toBe('patrolling');
  });

  it('does not re-acquire instantly after being shaken off', () => {
    const unit = officer(0);
    const rider = runner(60, policeData.pursuit.triggerSpeed + 6);
    chase(unit, [rider], 2);
    expect(unit.state).toBe('pursuing');

    // One step is enough to lose them, and it starts the reaction delay. A
    // full second of chase() would run that delay out before we could look.
    rider.pos.s = unit.rider.pos.s + policeData.pursuit.loseDistance + 40;
    stepPolice([unit], [rider], ROAD, policeData, combat, DT);
    expect(unit.state).toBe('patrolling');
    expect(unit.noticeTimer).toBeGreaterThan(0);

    // Back in range and still speeding, but the officer needs a moment.
    rider.pos.s = unit.rider.pos.s + 40;
    stepPolice([unit], [rider], ROAD, policeData, combat, DT);
    expect(unit.state).toBe('patrolling');

    // And after the moment, they do notice again.
    chase(unit, [rider], policeData.pursuit.reactionSeconds + 0.5);
    expect(unit.state).toBe('pursuing');
  });

  it('closes on its quarry rather than sitting behind it', () => {
    const unit = officer(0);
    const rider = runner(120, policeData.pursuit.triggerSpeed + 6);
    const before = trackDistance(unit.rider.pos, rider.pos, ROAD);
    chase(unit, [rider], 4);
    const after = trackDistance(unit.rider.pos, rider.pos, ROAD);
    expect(after).toBeLessThan(before);
  });

  it('rams by throwing the attack that shoves sideways', () => {
    const unit = officer(0);
    const rider = runner(3, policeData.pursuit.triggerSpeed + 6);
    let rammed = false;
    for (let i = 0; i < 240; i += 1) {
      stepPolice([unit], [rider], ROAD, policeData, combat, DT);
      if (unit.rider.attack === 'kick') rammed = true;
      stepRider(unit.rider, unit.input, ROAD, tuning, DT);
      rider.pos.s = unit.rider.pos.s + 3;
    }
    expect(rammed).toBe(true);
  });
});

/**
 * Crashes a rider and runs the crash on until they are on the ground.
 *
 * Speed is zeroed first because these tests are about where an arrest can
 * reach, and a rider who slides two hundred metres has moved the thing under
 * test. An officer cannot arrest someone still tumbling, which is the whole
 * reason `arrestedBy` names the stages it does.
 */
function putDown(rider: Rider): void {
  rider.speed = 0;
  crash(rider, 'traffic', tuning);
  for (let i = 0; i < 600 && rider.state !== 'downed'; i += 1) {
    stepCrash(rider, tuning, FIXED_DT);
  }
}

describe('arrest', () => {
  it('busts a rider who goes down next to a pursuing officer', () => {
    const unit = officer(0);
    const rider = runner(60, policeData.pursuit.triggerSpeed + 6);
    chase(unit, [rider], 2);
    expect(unit.state).toBe('pursuing');

    rider.pos.s = unit.rider.pos.s + 4;
    expect(arrestedBy(rider, [unit], ROAD, policeData)).toBeNull();
    putDown(rider);
    expect(arrestedBy(rider, [unit], ROAD, policeData)).toBe(unit);
  });

  it('does not bust a rider who goes down out of range', () => {
    const unit = officer(0);
    const rider = runner(60, policeData.pursuit.triggerSpeed + 6);
    chase(unit, [rider], 2);
    rider.pos.s = unit.rider.pos.s + policeData.arrest.radius + 10;
    putDown(rider);
    expect(arrestedBy(rider, [unit], ROAD, policeData)).toBeNull();
  });

  it('does not bust a rider next to an officer who is not chasing them', () => {
    const unit = officer(0);
    const rider = runner(4, 5);
    putDown(rider);
    expect(unit.state).toBe('patrolling');
    expect(arrestedBy(rider, [unit], ROAD, policeData)).toBeNull();
  });

  it('measures the radius along the road, not across a box', () => {
    // Same lesson as Phase 6: on a bend, subtracting coordinates is wrong.
    const bend = trackOf(segment({ length: 600, curvature: 1 / 40 }));
    const unit = officer(0);
    unit.state = 'pursuing';
    unit.rider.pos.s = 300;
    unit.rider.pos.t = -3.5;

    const rider = createRider(bike(), 300 + policeData.arrest.radius, -3.5);
    putDown(rider);
    const along = trackDistance(unit.rider.pos, rider.pos, bend);
    expect(along).toBeGreaterThan(policeData.arrest.radius);
    expect(arrestedBy(rider, [unit], bend, policeData)).toBeNull();
  });
});

describe('what a bad night costs', () => {
  it('scales the fine with the bike, so a Super bike hurts more', () => {
    const cheap = bikes[0];
    const dear = bikes[2];
    if (!cheap || !dear) throw new Error('need three bikes');
    expect(fineFor(dear.spec.price, policeData)).toBeGreaterThan(
      fineFor(cheap.spec.price, policeData) * 2,
    );
    expect(fineFor(cheap.spec.price, policeData)).toBeGreaterThan(
      policeData.arrest.fineBase,
    );
  });

  it('charges nothing to repair an undamaged bike', () => {
    expect(repairFor(100000, 0, policeData)).toBe(0);
  });

  it('charges in proportion to the damage', () => {
    const half = repairFor(100000, 50, policeData);
    const full = repairFor(100000, 99, policeData);
    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(half * 1.8);
  });

  it('charges a step more for a bike that is actually wrecked', () => {
    const nearly = repairFor(100000, 99.9, policeData);
    const written = repairFor(100000, 100, policeData);
    expect(written).toBeGreaterThan(nearly * 2);
  });
});

describe('the end-of-race numbers', () => {
  const track = trackFor('ridge-run-t1');

  it('charges a fine only when arrested', () => {
    const race = raceOn(track);
    const clean = outcomeOf(race);
    expect(clean.fine).toBe(0);
    expect(clean.failReason).toBeNull();

    race.phase = 'failed';
    race.failReason = 'arrested';
    const busted = outcomeOf(race);
    expect(busted.fine).toBeGreaterThan(0);
    expect(busted.failReason).toBe('arrested');
  });

  it('pays the prize only to a rider who finished', () => {
    const race = raceOn(track);
    const player = race.entries.find((e) => e.isPlayer);
    if (!player) throw new Error('no player');

    expect(outcomeOf(race, 8000).prize).toBe(0);
    player.finishTick = 900;
    race.phase = 'finished';
    expect(outcomeOf(race, 8000).prize).toBe(8000);
  });

  it('takes the fine and the repair out of the prize', () => {
    const race = raceOn(track);
    const player = race.entries.find((e) => e.isPlayer);
    if (!player) throw new Error('no player');
    player.rider.damage = 40;
    player.finishTick = 900;
    race.phase = 'finished';

    const out = outcomeOf(race, 8000);
    expect(out.repair).toBeGreaterThan(0);
    expect(out.net).toBe(out.prize - out.fine - out.repair);
    expect(out.net).toBeLessThan(8000);
  });

  it('reports a wreck, and charges for it', () => {
    const race = raceOn(track);
    const player = race.entries.find((e) => e.isPlayer);
    if (!player) throw new Error('no player');
    player.rider.damage = 100;
    race.phase = 'failed';
    race.failReason = 'wrecked';

    const out = outcomeOf(race);
    expect(out.wrecked).toBe(true);
    expect(out.repair).toBeGreaterThan(0);
    expect(out.net).toBeLessThan(0);
    expect(out.finished).toBe(false);
  });
});

describe('blocking', () => {
  it('holds station in front rather than driving away', () => {
    // An officer ahead at full throttle is not an obstruction, it is a bike
    // leaving. Blocking means matching their pace and staying in the way.
    const unit = officer(40);
    const rider = runner(20, policeData.pursuit.triggerSpeed + 6);
    unit.rider.speed = rider.speed;

    let blocked = 0;
    for (let i = 0; i < 300; i += 1) {
      stepPolice([unit], [rider], ROAD, policeData, combat, DT);
      stepRider(unit.rider, unit.input, ROAD, tuning, DT);
      rider.pos.s += rider.speed * DT;
      if (unit.blocking) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(0);
    // Still in front, and still within reach of being a nuisance.
    const ahead = unit.rider.pos.s - rider.pos.s;
    expect(ahead).toBeGreaterThan(0);
    expect(ahead).toBeLessThan(policeData.pursuit.blockGap);
  });

  it('does not block a rider it is not chasing', () => {
    const unit = officer(40);
    const slow = runner(20, 5);
    chase(unit, [slow], 2);
    expect(unit.state).toBe('patrolling');
    expect(unit.blocking).toBe(false);
  });

  it('stops blocking once it is behind again', () => {
    const unit = officer(40);
    const rider = runner(20, policeData.pursuit.triggerSpeed + 6);
    unit.rider.speed = rider.speed;
    stepPolice([unit], [rider], ROAD, policeData, combat, DT);
    expect(unit.state).toBe('pursuing');

    rider.pos.s = unit.rider.pos.s + 30;
    stepPolice([unit], [rider], ROAD, policeData, combat, DT);
    expect(unit.blocking).toBe(false);
    expect(unit.input.throttle).toBe(1);
  });
});
