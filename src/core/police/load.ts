import type { PoliceData } from './types.ts';

/**
 * Validation and loading for `src/data/police.json`.
 *
 * Same contract as every other loader: loud, early, naming the file and field.
 */

const PURSUIT_FIELDS = [
  'triggerSpeed',
  'dropSpeed',
  'dropSeconds',
  'loseDistance',
  'closeGap',
  'blockGap',
  'ramCooldown',
  'reactionSeconds',
] as const;

const ARREST_FIELDS = ['radius', 'fineBase', 'fineBikeFraction'] as const;

const DAMAGE_FIELDS = [
  'perCrash',
  'perHit',
  'wreckAt',
  'repairFraction',
  'wreckFraction',
] as const;

function fail(file: string, path: string, problem: string): never {
  throw new Error(`${file}: ${path} ${problem}`);
}

function group(
  file: string,
  path: string,
  raw: unknown,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    fail(file, path, 'must be an object');
  }
  return raw as Record<string, unknown>;
}

function positive(file: string, path: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(file, path, `must be a finite number, got ${JSON.stringify(value)}`);
  }
  if (value <= 0) fail(file, path, `must be positive, got ${value}`);
  return value;
}

/** Parses and validates the police data. Throws on the first problem. */
export function loadPolice(file: string, raw: unknown): PoliceData {
  const root = group(file, 'police', raw);
  const pursuitRaw = group(file, 'pursuit', root['pursuit']);
  const arrestRaw = group(file, 'arrest', root['arrest']);
  const damageRaw = group(file, 'damage', root['damage']);

  const pursuit = {} as PoliceData['pursuit'];
  for (const field of PURSUIT_FIELDS) {
    pursuit[field] = positive(file, `pursuit.${field}`, pursuitRaw[field]);
  }
  // An officer that gives up at a higher speed than it starts chasing at can
  // never let go, which is the opposite of the acceptance criterion.
  if (pursuit.dropSpeed >= pursuit.triggerSpeed) {
    fail(
      file,
      'pursuit.dropSpeed',
      `must be below pursuit.triggerSpeed (${pursuit.triggerSpeed}), got ${pursuit.dropSpeed}`,
    );
  }

  const arrest = {} as PoliceData['arrest'];
  for (const field of ARREST_FIELDS) {
    arrest[field] = positive(file, `arrest.${field}`, arrestRaw[field]);
  }

  const damage = {} as PoliceData['damage'];
  for (const field of DAMAGE_FIELDS) {
    damage[field] = positive(file, `damage.${field}`, damageRaw[field]);
  }

  return { pursuit, arrest, damage };
}
