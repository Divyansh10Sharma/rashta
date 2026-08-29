import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCombat } from '../../src/core/combat/load.ts';
import { ATTACK_KINDS, WEAPON_KINDS } from '../../src/core/combat/types.ts';

const raw: unknown = JSON.parse(readFileSync('src/data/combat.json', 'utf8'));

interface Shape {
  attacks: Record<string, Record<string, unknown>>;
  weapons: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

function clone(): Shape {
  return JSON.parse(JSON.stringify(raw)) as Shape;
}

/** One attack or weapon out of a cloned file, for a test to corrupt. */
function entry(
  group: Record<string, Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const found = group[key];
  if (!found) throw new Error(`fixture has no ${key}`);
  return found;
}

describe('the combat data', () => {
  it('defines every attack and every weapon', () => {
    const data = loadCombat('combat.json', raw);
    for (const kind of ATTACK_KINDS) expect(data.attacks[kind]).toBeDefined();
    for (const kind of WEAPON_KINDS) expect(data.weapons[kind]).toBeDefined();
  });

  it('orders the attacks the way the design document describes them', () => {
    // Punch fast and light, kick slower and shoves, backhand slowest and
    // hardest. If the data stops saying that, the three attacks are one.
    const { attacks } = loadCombat('combat.json', raw);
    expect(attacks.punch.windup).toBeLessThan(attacks.kick.windup);
    expect(attacks.kick.windup).toBeLessThan(attacks.backhand.windup);
    expect(attacks.punch.damage).toBeLessThan(attacks.kick.damage);
    expect(attacks.kick.damage).toBeLessThan(attacks.backhand.damage);
    expect(attacks.kick.push).toBeGreaterThan(attacks.backhand.push);
    // The backhand's cost is the exposure, not the stamina.
    expect(attacks.backhand.recovery).toBeGreaterThan(
      attacks.punch.recovery * 2,
    );
  });

  it('gives every weapon a generic name and no brand', () => {
    const { weapons } = loadCombat('combat.json', raw);
    for (const kind of WEAPON_KINDS) {
      expect(weapons[kind].name.length).toBeGreaterThan(0);
      expect(weapons[kind].damage).toBeGreaterThanOrEqual(1);
      expect(weapons[kind].reach).toBeGreaterThan(0);
    }
  });
});

describe('combat.json is validated loudly', () => {
  const cases: [string, (d: Shape) => void, RegExp][] = [
    [
      'a missing attack',
      (d) => delete d.attacks['kick'],
      /attacks\.kick is missing/,
    ],
    [
      'a missing weapon',
      (d) => delete d.weapons['bat'],
      /weapons\.bat is missing/,
    ],
    [
      'a zero windup',
      (d) => (entry(d.attacks, 'punch')['windup'] = 0),
      /attacks\.punch\.windup must be positive/,
    ],
    [
      'a negative push',
      (d) => (entry(d.attacks, 'kick')['push'] = -1),
      /attacks\.kick\.push must not be negative/,
    ],
    [
      'a weapon that makes you hit softer',
      (d) => (entry(d.weapons, 'pipe')['damage'] = 0.5),
      /weapons\.pipe\.damage must be at least 1/,
    ],
    [
      'a weapon with no name',
      (d) => (entry(d.weapons, 'chain')['name'] = ''),
      /weapons\.chain\.name must be a non-empty string/,
    ],
    [
      'a non-finite value',
      (d) => (entry(d.attacks, 'punch')['damage'] = null),
      /attacks\.punch\.damage must be a finite number/,
    ],
    [
      'a missing pickup range',
      (d) => delete d['pickupRange'],
      /pickupRange must be a finite number/,
    ],
    [
      'a negative stamina regen',
      (d) => (d['staminaRegen'] = -2),
      /staminaRegen must be positive/,
    ],
    [
      'an attack that is not an object',
      (d) => (d.attacks['punch'] = 7 as never),
      /attacks\.punch must be an object/,
    ],
  ];

  for (const [name, corrupt, message] of cases) {
    it(`rejects ${name}, naming the file and the field`, () => {
      const data = clone();
      corrupt(data);
      expect(() => loadCombat('combat.json', data)).toThrow(message);
      expect(() => loadCombat('combat.json', data)).toThrow(/combat\.json/);
    });
  }

  it('rejects a file that is not an object at all', () => {
    expect(() => loadCombat('combat.json', null)).toThrow(
      /combat must be an object/,
    );
  });

  it('rejects missing attacks and weapons groups', () => {
    const noAttacks = clone();
    delete (noAttacks as Partial<Shape>).attacks;
    expect(() => loadCombat('combat.json', noAttacks)).toThrow(
      /attacks must be an object/,
    );

    const noWeapons = clone();
    delete (noWeapons as Partial<Shape>).weapons;
    expect(() => loadCombat('combat.json', noWeapons)).toThrow(
      /weapons must be an object/,
    );
  });
});
