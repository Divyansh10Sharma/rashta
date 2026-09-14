import { describe, expect, it } from 'vitest';
import {
  canSteer,
  engagedWith,
  phaseOf,
  reachOf,
  startAttack,
  stepCombat,
} from '../../src/core/combat/combat.ts';
import { trackDistance } from '../../src/core/track/distance.ts';
import { createRider } from '../../src/core/sim/world.ts';
import { stepRider } from '../../src/core/sim/step.ts';
import { segment, trackOf } from '../helpers/tracks.ts';
import { bikes, combat, tuning } from '../helpers/race.ts';
import type { Track } from '../../src/core/track/Track.ts';
import type { Rider } from '../../src/core/sim/types.ts';
import type { DroppedWeapon } from '../../src/core/combat/types.ts';
import { isDown } from '../../src/core/sim/crash.ts';

/**
 * Combat, headless.
 *
 * The point of nearly every test here is that range is a distance along a
 * curved road, not a box in `(s, t)`. Two riders with identical `(s, t)`
 * offsets are further apart on a bend than on a straight, and an attack has to
 * agree.
 */

const DT = 1 / 60;

function bike() {
  const found = bikes[0];
  if (!found) throw new Error('no bikes');
  return found;
}

function rider(s: number, t: number): Rider {
  const made = createRider(bike(), s, t);
  made.speed = 25;
  return made;
}

function slots(n: number): DroppedWeapon[] {
  const pool: DroppedWeapon[] = [];
  for (let i = 0; i < n; i += 1) {
    pool.push({
      kind: 'pipe',
      s: 0,
      t: 0,
      branchId: 0,
      settle: 0,
      active: false,
    });
  }
  return pool;
}

/** Runs the attack far enough for the active window to open. */
function swing(field: Rider[], dropped: DroppedWeapon[], track: Track): void {
  for (let i = 0; i < 40; i += 1) {
    stepCombat(field, dropped, track, combat, tuning, DT);
  }
}

const STRAIGHT = trackOf(segment({ length: 600, curvature: 0 }));
// A 40 m radius bend: the tightest thing in the Old City is about this.
const BEND = trackOf(segment({ length: 600, curvature: 1 / 40 }));

describe('range is measured along the road, not across a box', () => {
  it('measures the same offsets differently on a bend, both ways', () => {
    // The whole reason range cannot be an (s, t) box. Two riders 2.4 m apart
    // along the road are further apart than that on the outside of a bend and
    // closer than it on the inside, from identical coordinates. A box says
    // 2.4 in every case and is wrong twice.
    const apart = (t: number, track: Track): number =>
      trackDistance(
        { s: 300, t, branchId: 0 },
        { s: 302.4, t, branchId: 0 },
        track,
      );

    const outside = apart(-3.5, BEND);
    const inside = apart(3.5, BEND);
    const flat = apart(-3.5, STRAIGHT);

    expect(flat).toBeCloseTo(2.4, 2);
    expect(outside).toBeGreaterThan(flat + 0.15);
    expect(inside).toBeLessThan(flat - 0.15);
  });

  it('connects on the straight and misses on the bend, same offsets', () => {
    // 2.4 m apart along the road, which is inside a punch. On the outside of
    // the bend the same coordinates are further than a punch reaches.
    const outcomes = [STRAIGHT, BEND].map((track) => {
      const attacker = rider(300, -3.5);
      const target = rider(302.4, -3.5);
      startAttack(attacker, 'punch', combat);
      swing([attacker, target], slots(0), track);
      return {
        at: trackDistance(attacker.pos, target.pos, track),
        hit: target.stamina < 100,
      };
    });
    expect(outcomes[0]?.at).toBeLessThan(combat.attacks.punch.range);
    expect(outcomes[1]?.at).toBeGreaterThan(combat.attacks.punch.range);
    expect(outcomes[0]?.hit).toBe(true);
    expect(outcomes[1]?.hit).toBe(false);
  });

  it('connects at the stated range and misses just outside it, on a bend', () => {
    const spec = combat.attacks.punch;
    for (const track of [STRAIGHT, BEND]) {
      for (const [offset, shouldHit] of [
        [spec.range * 0.8, true],
        [spec.range * 1.4, false],
      ] as const) {
        const attacker = rider(300, 0);
        // Place the target by measuring, not by assuming: on a bend the `t`
        // that gives a two-metre gap is not the same `t` as on a straight.
        let target = rider(300, offset);
        let at = trackDistance(attacker.pos, target.pos, track);
        for (let i = 0; i < 30 && Math.abs(at - offset) > 1e-3; i += 1) {
          target = rider(300, target.pos.t * (offset / at));
          at = trackDistance(attacker.pos, target.pos, track);
        }
        startAttack(attacker, 'punch', combat);
        swing([attacker, target], slots(0), track);
        expect(`${at.toFixed(2)}m hit=${target.stamina < 100}`).toBe(
          `${at.toFixed(2)}m hit=${shouldHit}`,
        );
      }
    }
  });

  it('extends reach by exactly the weapon it is holding', () => {
    const spec = combat.attacks.punch;
    const bare = rider(0, 0);
    const armed = rider(0, 0);
    armed.weapon = 'chain';
    expect(reachOf(bare, spec, combat)).toBe(spec.range);
    expect(reachOf(armed, spec, combat)).toBe(
      spec.range + combat.weapons.chain.reach,
    );
  });
});

describe('the three phases of an attack', () => {
  it('runs windup, then active, then recovery, then finishes', () => {
    const attacker = rider(300, 0);
    expect(startAttack(attacker, 'backhand', combat)).toBe(true);
    const spec = combat.attacks.backhand;

    const seen: (string | null)[] = [];
    for (let i = 0; i < 80; i += 1) {
      seen.push(phaseOf(attacker, combat));
      stepCombat([attacker], slots(0), STRAIGHT, combat, tuning, DT);
    }
    expect(seen[0]).toBe('windup');
    expect(seen[Math.floor((spec.windup + 0.01) * 60)]).toBe('active');
    expect(seen[Math.floor((spec.windup + spec.active + 0.05) * 60)]).toBe(
      'recovery',
    );
    expect(attacker.attack).toBeNull();
  });

  it('locks steering for the whole attack, which is what it costs', () => {
    const attacker = rider(300, 0);
    expect(canSteer(attacker)).toBe(true);
    startAttack(attacker, 'backhand', combat);

    let locked = 0;
    let ticks = 0;
    while (attacker.attack !== null && ticks < 200) {
      if (!canSteer(attacker)) locked += 1;
      stepCombat([attacker], slots(0), STRAIGHT, combat, tuning, DT);
      ticks += 1;
    }
    // Locked for every tick the attack was running, and free the moment it
    // ends. A backhand is about nine tenths of a second of no steering.
    expect(locked).toBe(ticks);
    expect(canSteer(attacker)).toBe(true);
    const spec = combat.attacks.backhand;
    expect(ticks / 60).toBeCloseTo(
      spec.windup + spec.active + spec.recovery,
      1,
    );
  });

  it('actually refuses to steer the bike mid-swing', () => {
    // The lock has to reach the physics, not just report itself.
    const hard = { throttle: 0, brake: 0, lean: 1 };
    const free = rider(300, 0);
    const busy = rider(300, 0);
    startAttack(busy, 'backhand', combat);

    for (let i = 0; i < 12; i += 1) {
      stepRider(free, hard, STRAIGHT, tuning, DT);
      stepRider(busy, hard, STRAIGHT, tuning, DT);
    }
    expect(free.pos.t).toBeGreaterThan(0.05);
    expect(busy.pos.t).toBe(0);
  });

  it('lands once, not once per tick of the active window', () => {
    const attacker = rider(300, 0);
    const target = rider(301, 0);
    startAttack(attacker, 'punch', combat);
    swing([attacker, target], slots(0), STRAIGHT);

    // One punch, minus whatever stamina regenerated back afterwards.
    const dealt = 100 - target.stamina;
    expect(dealt).toBeGreaterThan(combat.attacks.punch.damage * 0.5);
    expect(dealt).toBeLessThan(combat.attacks.punch.damage * 1.05);
  });

  it('refuses to start when there is not the stamina to pay for it', () => {
    const tired = rider(300, 0);
    tired.stamina = combat.attacks.backhand.cost;
    expect(startAttack(tired, 'backhand', combat)).toBe(false);
    expect(tired.attack).toBeNull();
  });

  it('refuses to start a second attack over the first', () => {
    const attacker = rider(300, 0);
    expect(startAttack(attacker, 'punch', combat)).toBe(true);
    expect(startAttack(attacker, 'backhand', combat)).toBe(false);
    expect(attacker.attack).toBe('punch');
  });

  it('drops a swing when the rider is knocked off mid-attack', () => {
    const attacker = rider(300, 0);
    startAttack(attacker, 'backhand', combat);
    attacker.state = 'sliding';
    stepCombat([attacker], slots(0), STRAIGHT, combat, tuning, DT);
    expect(attacker.attack).toBeNull();
  });
});

describe('being hit', () => {
  it('costs stamina, staggers, and shoves you sideways', () => {
    const attacker = rider(300, 0);
    const target = rider(301, 1.2);
    startAttack(attacker, 'kick', combat);
    // Stepped only as far as the blow landing: the stagger is under half a
    // second and running the full attack out would let it expire first.
    const spec = combat.attacks.kick;
    for (let i = 0; i < Math.ceil(spec.windup * 60) + 1; i += 1) {
      stepCombat([attacker, target], slots(0), STRAIGHT, combat, tuning, DT);
    }

    expect(target.stamina).toBeLessThan(100);
    expect(target.pos.t).toBeGreaterThan(1.2);
    expect(target.staggerTimer).toBeGreaterThan(0);
  });

  it('shoves away from the attacker, whichever side that is', () => {
    for (const side of [-1, 1]) {
      const attacker = rider(300, 0);
      const target = rider(301, side * 1.2);
      startAttack(attacker, 'kick', combat);
      swing([attacker, target], slots(0), STRAIGHT);
      expect(Math.abs(target.pos.t)).toBeGreaterThan(1.2);
      expect(Math.sign(target.pos.t)).toBe(side);
    }
  });

  it('kicks harder sideways than it punches', () => {
    // A kick is for forcing someone off the road; a punch is for damage.
    expect(combat.attacks.kick.push).toBeGreaterThan(
      combat.attacks.punch.push * 2,
    );
    expect(combat.attacks.backhand.damage).toBeGreaterThan(
      combat.attacks.punch.damage * 2,
    );
  });

  it('puts a rider down at zero stamina, with combat as the cause', () => {
    const attacker = rider(300, 0);
    const target = rider(301, 0);
    target.stamina = 4;
    startAttack(attacker, 'backhand', combat);
    swing([attacker, target], slots(0), STRAIGHT);

    expect(target.stamina).toBe(0);
    expect(isDown(target)).toBe(true);
    expect(target.crashCause).toBe('combat');
  });

  it('regenerates stamina while nothing is landing', () => {
    const hurt = rider(300, 0);
    hurt.stamina = 40;
    for (let i = 0; i < 60; i += 1) {
      stepCombat([hurt], slots(0), STRAIGHT, combat, tuning, DT);
    }
    expect(hurt.stamina).toBeCloseTo(40 + combat.staminaRegen, 1);
  });
});

describe('weapons circulate and are never created', () => {
  it('is stolen by an unarmed attacker who lands a hit', () => {
    const thief = rider(300, 0);
    const armed = rider(301, 0);
    armed.weapon = 'bat';
    const dropped = slots(1);

    startAttack(thief, 'punch', combat);
    swing([thief, armed], dropped, STRAIGHT);

    expect(thief.weapon).toBe('bat');
    expect(armed.weapon).toBeNull();
    expect(dropped.filter((d) => d.active).length).toBe(0);
  });

  it('is knocked into the road when the attacker already has one', () => {
    const attacker = rider(300, 0);
    attacker.weapon = 'pipe';
    const armed = rider(301, 0);
    armed.weapon = 'chain';
    const dropped = slots(2);

    startAttack(attacker, 'punch', combat);
    swing([attacker, armed], dropped, STRAIGHT);

    expect(attacker.weapon).toBe('pipe');
    expect(armed.weapon).toBeNull();
    const loose = dropped.filter((d) => d.active);
    expect(loose.length).toBe(1);
    expect(loose[0]?.kind).toBe('chain');
  });

  it('is dropped in the road by a rider who goes down', () => {
    const attacker = rider(300, 0);
    attacker.weapon = 'pipe';
    const target = rider(301, 0);
    target.weapon = 'bat';
    target.stamina = 3;
    const dropped = slots(2);

    startAttack(attacker, 'backhand', combat);
    swing([attacker, target], dropped, STRAIGHT);

    expect(target.weapon).toBeNull();
    expect(isDown(target)).toBe(true);
    expect(dropped.filter((d) => d.active).map((d) => d.kind)).toContain('bat');
  });

  it('is picked up by an unarmed rider who rides over it', () => {
    const finder = rider(300, 0);
    const dropped = slots(1);
    const slot = dropped[0];
    if (!slot) throw new Error('no slot');
    Object.assign(slot, {
      kind: 'chain',
      s: 301,
      t: 0,
      branchId: 0,
      active: true,
    });

    stepCombat([finder], dropped, STRAIGHT, combat, tuning, DT);
    expect(finder.weapon).toBe('chain');
    expect(slot.active).toBe(false);
  });

  it('is not picked up by a rider who already has one', () => {
    const carrier = rider(300, 0);
    carrier.weapon = 'pipe';
    const dropped = slots(1);
    const slot = dropped[0];
    if (!slot) throw new Error('no slot');
    Object.assign(slot, {
      kind: 'chain',
      s: 301,
      t: 0,
      branchId: 0,
      active: true,
    });

    stepCombat([carrier], dropped, STRAIGHT, combat, tuning, DT);
    expect(carrier.weapon).toBe('pipe');
    expect(slot.active).toBe(true);
  });

  it('is not picked up from the far side of the road', () => {
    const finder = rider(300, 0);
    const dropped = slots(1);
    const slot = dropped[0];
    if (!slot) throw new Error('no slot');
    Object.assign(slot, {
      kind: 'chain',
      s: 300,
      t: combat.pickupRange + 2,
      branchId: 0,
      active: true,
    });

    stepCombat([finder], dropped, STRAIGHT, combat, tuning, DT);
    expect(finder.weapon).toBeNull();
    expect(slot.active).toBe(true);
  });
});

describe('who you are fighting', () => {
  it('is the nearest rider inside engage range, measured along the road', () => {
    const me = rider(300, 0);
    const near = rider(302, 0.5);
    const far = rider(305, 0.5);
    expect(engagedWith(me, [me, near, far], STRAIGHT, combat)).toBe(near);
  });

  it('is nobody when the nearest is out of range', () => {
    const me = rider(300, 0);
    const away = rider(300 + combat.engageRange + 5, 0);
    expect(engagedWith(me, [me, away], STRAIGHT, combat)).toBeNull();
  });

  it('is nobody on the other side of a fork', () => {
    const me = rider(300, 0);
    const elsewhere = rider(301, 0);
    elsewhere.pos.branchId = 1;
    expect(engagedWith(me, [me, elsewhere], STRAIGHT, combat)).toBeNull();
  });
});
