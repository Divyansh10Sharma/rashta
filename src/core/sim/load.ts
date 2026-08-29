import { tuneBike } from './bike.ts';
import type { Bike, TunedBike, Tuning } from './types.ts';

/**
 * Validation and loading for `bikes.json` and `tuning.json`.
 *
 * Same contract as the track loader: loud, early, and naming the file and the
 * exact field.
 */

const CLASSES = ['street', 'sport', 'super'] as const;
const ACCEL_CURVE_POINTS = 5;

function fail(file: string, path: string, problem: string): never {
  throw new Error(`${file}: ${path} ${problem}`);
}

function num(file: string, path: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(file, path, `must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function positive(file: string, path: string, value: unknown): number {
  const n = num(file, path, value);
  if (n <= 0) fail(file, path, `must be positive, got ${n}`);
  return n;
}

function unitRange(file: string, path: string, value: unknown): number {
  const n = num(file, path, value);
  if (n < 0 || n > 1) fail(file, path, `must be within [0, 1], got ${n}`);
  return n;
}

function text(file: string, path: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(
      file,
      path,
      `must be a non-empty string, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function validateBike(file: string, path: string, raw: unknown): Bike {
  if (typeof raw !== 'object' || raw === null)
    fail(file, path, 'must be an object');
  const b = raw as Record<string, unknown>;

  const cls = b['class'];
  if (typeof cls !== 'string' || !CLASSES.includes(cls as Bike['class'])) {
    fail(file, `${path}.class`, `must be one of ${CLASSES.join(', ')}`);
  }

  const curveRaw = b['accelCurve'];
  if (!Array.isArray(curveRaw) || curveRaw.length !== ACCEL_CURVE_POINTS) {
    fail(
      file,
      `${path}.accelCurve`,
      `must be an array of ${ACCEL_CURVE_POINTS} numbers, got ${JSON.stringify(curveRaw)}`,
    );
  }
  const accelCurve = curveRaw.map((v, i) => {
    const n = num(file, `${path}.accelCurve[${i}]`, v);
    // Strictly positive, not merely non-negative: the time-to-top-speed solve
    // integrates 1/f(u), which diverges the moment any control point is zero,
    // and the bike would never reach the speed the data file promises.
    if (n <= 0) {
      fail(
        file,
        `${path}.accelCurve[${i}]`,
        `must be strictly positive — a zero makes time-to-top-speed infinite — got ${n}`,
      );
    }
    return n;
  });

  const nitro = num(file, `${path}.nitro`, b['nitro']);
  if (!Number.isInteger(nitro) || nitro < 0) {
    fail(file, `${path}.nitro`, `must be a non-negative integer, got ${nitro}`);
  }

  return {
    id: text(file, `${path}.id`, b['id']),
    make: text(file, `${path}.make`, b['make']),
    model: text(file, `${path}.model`, b['model']),
    class: cls as Bike['class'],
    price: positive(file, `${path}.price`, b['price']),
    power: positive(file, `${path}.power`, b['power']),
    mass: positive(file, `${path}.mass`, b['mass']),
    topSpeed: positive(file, `${path}.topSpeed`, b['topSpeed']),
    timeToTopSpeed: positive(
      file,
      `${path}.timeToTopSpeed`,
      b['timeToTopSpeed'],
    ),
    accelCurve,
    handling: unitRange(file, `${path}.handling`, b['handling']),
    stability: unitRange(file, `${path}.stability`, b['stability']),
    nitro,
    blurb: text(file, `${path}.blurb`, b['blurb']),
  };
}

/** Validates and tunes every bike in the file. */
export function loadBikes(
  file: string,
  raw: unknown,
  tuning: Tuning,
): TunedBike[] {
  if (typeof raw !== 'object' || raw === null) {
    fail(file, 'bikes', 'must be a JSON object');
  }
  const list = (raw as Record<string, unknown>)['bikes'];
  if (!Array.isArray(list) || list.length === 0) {
    fail(file, 'bikes', 'must be a non-empty array');
  }

  const bikes = list.map((b, i) => validateBike(file, `bikes[${i}]`, b));

  const seen = new Set<string>();
  for (const bike of bikes) {
    if (seen.has(bike.id))
      fail(file, `bikes`, `has a duplicate id "${bike.id}"`);
    seen.add(bike.id);
  }

  return bikes.map((b) => tuneBike(b, tuning.accelIntegralSlices));
}

const TUNING_KEYS: (keyof Tuning)[] = [
  'accelIntegralSlices',
  'brakeDecel',
  'coastDecel',
  'maxLateralSpeed',
  'lateralResponse',
  'lateralSpeedFalloff',
  'gripLateralLimit',
  'gripScrub',
  'leanFromLateral',
  'leanFromCurvature',
  'leanMax',
  'leanResponse',
  'wheelRadius',
  'revsIdle',
  'gearCount',
];

/** Validates `tuning.json`. Every key is required — a missing one is a bug. */
export function loadTuning(file: string, raw: unknown): Tuning {
  if (typeof raw !== 'object' || raw === null) {
    fail(file, 'tuning', 'must be a JSON object');
  }
  const t = raw as Record<string, unknown>;
  const out = {} as Tuning;
  for (const key of TUNING_KEYS) {
    out[key] = num(file, key, t[key]);
  }
  return out;
}
