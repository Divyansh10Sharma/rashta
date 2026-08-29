import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, loadRacers } from '../../src/core/ai/load.ts';

const raw: unknown = JSON.parse(readFileSync('src/data/racers.json', 'utf8'));

/** A deep copy of the real file, so a mutation in one case cannot leak. */
function clone(): { racers: Record<string, unknown>[] } {
  return JSON.parse(JSON.stringify(raw)) as {
    racers: Record<string, unknown>[];
  };
}

function first(data: {
  racers: Record<string, unknown>[];
}): Record<string, unknown> {
  const entry = data.racers[0];
  if (!entry) throw new Error('fixture has no racers');
  return entry;
}

describe('the racer roster', () => {
  it('is fourteen riders, the player among them', () => {
    const profiles = loadRacers('racers.json', raw);
    expect(profiles.length).toBe(14);
    expect(profiles.filter((p) => p.id === PLAYER_ID).length).toBe(1);
  });

  it('gives every rider a bike that exists in bikes.json', () => {
    const bikes: unknown = JSON.parse(
      readFileSync('src/data/bikes.json', 'utf8'),
    );
    const ids = new Set(
      ((bikes as { bikes: { id: string }[] }).bikes ?? []).map((b) => b.id),
    );
    for (const profile of loadRacers('racers.json', raw)) {
      expect(ids.has(profile.startingBike)).toBe(true);
    }
  });

  it('gives every rider a two-line bio in the game’s voice', () => {
    for (const profile of loadRacers('racers.json', raw)) {
      expect(profile.bio.split('\n').length).toBe(2);
    }
  });

  it('spreads skill across a real range rather than clustering', () => {
    // Thirteen rivals who are all 0.7 is one rival thirteen times over.
    const skills = loadRacers('racers.json', raw)
      .filter((p) => p.id !== PLAYER_ID)
      .map((p) => p.skill);
    expect(Math.max(...skills) - Math.min(...skills)).toBeGreaterThan(0.4);
  });
});

describe('racers.json is validated loudly', () => {
  const cases: [string, (d: ReturnType<typeof clone>) => void, RegExp][] = [
    [
      'a skill above one',
      (d) => (first(d)['skill'] = 1.4),
      /skill must be within \[0, 1\], got 1.4/,
    ],
    [
      'a missing name',
      (d) => delete first(d)['name'],
      /name must be a non-empty string/,
    ],
    [
      'negative starting cash',
      (d) => (first(d)['startingCash'] = -50),
      /startingCash must be a non-negative number/,
    ],
    [
      'a weapon that is neither a string nor null',
      (d) => (first(d)['startingWeapon'] = 7),
      /startingWeapon must be a non-empty string/,
    ],
    [
      'a duplicate id',
      (d) => {
        const copy = d.racers[1];
        if (copy) copy['id'] = first(d)['id'];
      },
      /is a duplicate id/,
    ],
    [
      'no player profile',
      (d) => (d.racers = d.racers.filter((r) => r['id'] !== PLAYER_ID)),
      /must contain a profile with id "player"/,
    ],
    [
      'racers not being an array',
      (d) => (d.racers = 3 as never),
      /must be an array/,
    ],
  ];

  for (const [name, corrupt, message] of cases) {
    it(`rejects ${name}, naming the file and the field`, () => {
      const data = clone();
      corrupt(data);
      expect(() => loadRacers('racers.json', data)).toThrow(message);
      expect(() => loadRacers('racers.json', data)).toThrow(/racers\.json/);
    });
  }

  it('rejects a file that is not an object at all', () => {
    expect(() => loadRacers('racers.json', null)).toThrow(
      /racers must be a JSON object/,
    );
  });

  it('rejects a racer that is not an object', () => {
    const data = clone();
    data.racers[0] = 'farida' as never;
    expect(() => loadRacers('racers.json', data)).toThrow(
      /racers\[0\] must be an object/,
    );
  });

  it('rejects a non-finite unit value', () => {
    const data = clone();
    first(data)['caution'] = Number.NaN;
    expect(() => loadRacers('racers.json', data)).toThrow(
      /caution must be a finite number/,
    );
  });
});
