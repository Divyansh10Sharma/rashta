import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';

/**
 * Bad bike and tuning data has to fail on load, loudly, naming the field.
 * Same contract as the track loader — see tests/track/validate.test.ts.
 */

const tuning = loadTuning(
  'src/data/tuning.json',
  JSON.parse(readFileSync('src/data/tuning.json', 'utf8')),
);

function validBike(): Record<string, unknown> {
  return {
    id: 'test-bike',
    make: 'Marwar',
    model: 'Test 100',
    class: 'street',
    price: 40000,
    power: 10,
    mass: 140,
    topSpeed: 160,
    timeToTopSpeed: 18,
    accelCurve: [1, 0.9, 0.7, 0.5, 0.2],
    handling: 0.6,
    stability: 0.5,
    nitro: 0,
    blurb: 'A bike.',
  };
}

function loadWith(mutate: (b: Record<string, unknown>) => void): () => void {
  const bike = validBike();
  mutate(bike);
  return () => loadBikes('bad-bikes.json', { bikes: [bike] }, tuning);
}

describe('the bike loader accepts good data', () => {
  it('loads and tunes a valid bike', () => {
    const [bike] = loadBikes('good.json', { bikes: [validBike()] }, tuning);
    expect(bike?.spec.id).toBe('test-bike');
    expect(bike?.topSpeedMs).toBeCloseTo(160 / 3.6, 9);
    expect(bike?.accelScale).toBeGreaterThan(0);
  });
});

describe('every bike error names the file and the field', () => {
  const cases: [string, (b: Record<string, unknown>) => void, RegExp][] = [
    ['missing id', (b) => delete b['id'], /bad-bikes\.json: bikes\[0\]\.id/],
    ['blank make', (b) => (b['make'] = ''), /bikes\[0\]\.make/],
    ['unknown class', (b) => (b['class'] = 'moped'), /bikes\[0\]\.class/],
    [
      'zero price',
      (b) => (b['price'] = 0),
      /bikes\[0\]\.price must be positive/,
    ],
    [
      'negative mass',
      (b) => (b['mass'] = -1),
      /bikes\[0\]\.mass must be positive/,
    ],
    ['zero topSpeed', (b) => (b['topSpeed'] = 0), /bikes\[0\]\.topSpeed/],
    [
      'zero timeToTopSpeed',
      (b) => (b['timeToTopSpeed'] = 0),
      /bikes\[0\]\.timeToTopSpeed/,
    ],
    [
      'accelCurve wrong length',
      (b) => (b['accelCurve'] = [1, 0.5]),
      /bikes\[0\]\.accelCurve must be an array of 5 numbers/,
    ],
    [
      'accelCurve not an array',
      (b) => (b['accelCurve'] = 'fast'),
      /bikes\[0\]\.accelCurve must be an array/,
    ],
    [
      'accelCurve entry not a number',
      (b) => (b['accelCurve'] = [1, 0.9, 'x', 0.5, 0.2]),
      /bikes\[0\]\.accelCurve\[2\] must be a finite number/,
    ],
    ['handling above 1', (b) => (b['handling'] = 1.5), /bikes\[0\]\.handling/],
    [
      'stability below 0',
      (b) => (b['stability'] = -0.1),
      /bikes\[0\]\.stability/,
    ],
    [
      'fractional nitro',
      (b) => (b['nitro'] = 1.5),
      /bikes\[0\]\.nitro must be a non-negative integer/,
    ],
    ['blank blurb', (b) => (b['blurb'] = ''), /bikes\[0\]\.blurb/],
  ];

  for (const [name, mutate, pattern] of cases) {
    it(`rejects: ${name}`, () => {
      expect(loadWith(mutate)).toThrow(pattern);
    });
  }

  it('rejects a bike that is not an object', () => {
    expect(() => loadBikes('bad-bikes.json', { bikes: [3] }, tuning)).toThrow(
      /bikes\[0\] must be an object/,
    );
  });

  it('rejects a file that is not an object, or has no bikes', () => {
    expect(() => loadBikes('bad-bikes.json', null, tuning)).toThrow(
      /bikes must be a JSON object/,
    );
    expect(() => loadBikes('bad-bikes.json', {}, tuning)).toThrow(
      /bikes must be a non-empty array/,
    );
    expect(() => loadBikes('bad-bikes.json', { bikes: [] }, tuning)).toThrow(
      /bikes must be a non-empty array/,
    );
  });

  it('rejects two bikes sharing an id', () => {
    expect(() =>
      loadBikes(
        'bad-bikes.json',
        { bikes: [validBike(), validBike()] },
        tuning,
      ),
    ).toThrow(/duplicate id "test-bike"/);
  });
});

describe('the strictly-positive accelCurve rule', () => {
  it('rejects a zero, because it makes time-to-top-speed infinite', () => {
    expect(loadWith((b) => (b['accelCurve'] = [1, 0.9, 0.7, 0.5, 0]))).toThrow(
      /accelCurve\[4\] must be strictly positive/,
    );
  });

  it('rejects a negative entry too', () => {
    expect(
      loadWith((b) => (b['accelCurve'] = [1, 0.9, -0.1, 0.5, 0.2])),
    ).toThrow(/accelCurve\[2\] must be strictly positive/);
  });

  it('explains why in the message', () => {
    expect(loadWith((b) => (b['accelCurve'] = [1, 0.9, 0.7, 0.5, 0]))).toThrow(
      /time-to-top-speed infinite/,
    );
  });

  it('accepts a small but positive tail', () => {
    expect(
      loadWith((b) => (b['accelCurve'] = [1, 0.9, 0.7, 0.5, 0.001])),
    ).not.toThrow();
  });
});

describe('the tuning loader', () => {
  it('loads the real file', () => {
    expect(tuning.gearCount).toBeGreaterThan(0);
    expect(tuning.brakeDecel).toBeGreaterThan(0);
  });

  it('rejects a file that is not an object', () => {
    expect(() => loadTuning('bad-tuning.json', null)).toThrow(
      /tuning must be a JSON object/,
    );
  });

  it('names the first missing key rather than defaulting it', () => {
    // A silently-defaulted tuning constant is a bug that only shows up as
    // "the handling feels wrong", which is the worst kind to chase.
    expect(() => loadTuning('bad-tuning.json', { brakeDecel: 11 })).toThrow(
      /bad-tuning\.json: accelIntegralSlices must be a finite number/,
    );
  });

  it('rejects a non-numeric value', () => {
    const raw = JSON.parse(
      readFileSync('src/data/tuning.json', 'utf8'),
    ) as Record<string, unknown>;
    raw['brakeDecel'] = 'hard';
    expect(() => loadTuning('bad-tuning.json', raw)).toThrow(
      /brakeDecel must be a finite number/,
    );
  });
});
