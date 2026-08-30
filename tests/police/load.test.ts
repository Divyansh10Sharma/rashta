import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadPolice } from '../../src/core/police/load.ts';

const raw: unknown = JSON.parse(readFileSync('src/data/police.json', 'utf8'));

interface Shape {
  pursuit: Record<string, unknown>;
  arrest: Record<string, unknown>;
  damage: Record<string, unknown>;
}

function clone(): Shape {
  return JSON.parse(JSON.stringify(raw)) as Shape;
}

describe('the police data', () => {
  it('describes a pursuit that can be escaped', () => {
    // If an officer gave up at a higher speed than it started chasing at, it
    // could never let go — and "escaping pursuit is possible" is the
    // acceptance criterion. The loader refuses that file rather than shipping
    // a game where the police are permanent.
    const { pursuit } = loadPolice('police.json', raw);
    expect(pursuit.dropSpeed).toBeLessThan(pursuit.triggerSpeed);
    expect(pursuit.dropSeconds).toBeGreaterThan(0);
    expect(pursuit.loseDistance).toBeGreaterThan(0);
  });

  it('makes a wreck cost more than the worst repair', () => {
    const { damage } = loadPolice('police.json', raw);
    expect(damage.wreckFraction).toBeGreaterThan(damage.repairFraction);
    expect(damage.perCrash).toBeGreaterThan(damage.perHit);
  });
});

describe('police.json is validated loudly', () => {
  const cases: [string, (d: Shape) => void, RegExp][] = [
    [
      'a drop speed at or above the trigger speed',
      (d) => (d.pursuit['dropSpeed'] = d.pursuit['triggerSpeed']),
      /pursuit\.dropSpeed must be below pursuit\.triggerSpeed/,
    ],
    [
      'a zero arrest radius',
      (d) => (d.arrest['radius'] = 0),
      /arrest\.radius must be positive/,
    ],
    [
      'a negative fine',
      (d) => (d.arrest['fineBase'] = -100),
      /arrest\.fineBase must be positive/,
    ],
    [
      'a missing pursuit field',
      (d) => delete d.pursuit['ramCooldown'],
      /pursuit\.ramCooldown must be a finite number/,
    ],
    [
      'a non-numeric damage rate',
      (d) => (d.damage['perCrash'] = 'lots'),
      /damage\.perCrash must be a finite number/,
    ],
    [
      'a zero wreck threshold',
      (d) => (d.damage['wreckAt'] = 0),
      /damage\.wreckAt must be positive/,
    ],
  ];

  for (const [name, corrupt, message] of cases) {
    it(`rejects ${name}, naming the file and the field`, () => {
      const data = clone();
      corrupt(data);
      expect(() => loadPolice('police.json', data)).toThrow(message);
      expect(() => loadPolice('police.json', data)).toThrow(/police\.json/);
    });
  }

  it('rejects a file that is not an object at all', () => {
    expect(() => loadPolice('police.json', null)).toThrow(
      /police must be an object/,
    );
  });

  it('rejects each missing group by name', () => {
    for (const group of ['pursuit', 'arrest', 'damage'] as const) {
      const data = clone();
      delete (data as Partial<Shape>)[group];
      expect(() => loadPolice('police.json', data)).toThrow(
        new RegExp(`${group} must be an object`),
      );
    }
  });
});
