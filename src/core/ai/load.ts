import type { RacerProfile } from './types.ts';

/**
 * Validation and loading for `racers.json`.
 *
 * Same contract as the track and bike loaders: loud, early, and naming the
 * file and the exact field.
 */

/** The id of the profile the human plays. Present in the file like any other. */
export const PLAYER_ID = 'player';

const UNIT_FIELDS = ['skill', 'aggression', 'vengefulness', 'caution'] as const;

function fail(file: string, path: string, problem: string): never {
  throw new Error(`${file}: ${path} ${problem}`);
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

function unitRange(file: string, path: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(file, path, `must be a finite number, got ${JSON.stringify(value)}`);
  }
  if (value < 0 || value > 1) {
    fail(file, path, `must be within [0, 1], got ${value}`);
  }
  return value;
}

function cash(file: string, path: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(
      file,
      path,
      `must be a non-negative number, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function validateRacer(file: string, path: string, raw: unknown): RacerProfile {
  if (typeof raw !== 'object' || raw === null) {
    fail(file, path, 'must be an object');
  }
  const r = raw as Record<string, unknown>;

  const profile = {
    id: text(file, `${path}.id`, r['id']),
    name: text(file, `${path}.name`, r['name']),
    startingBike: text(file, `${path}.startingBike`, r['startingBike']),
    startingCash: cash(file, `${path}.startingCash`, r['startingCash']),
    startingWeapon: null as string | null,
    bio: text(file, `${path}.bio`, r['bio']),
  } as RacerProfile;

  for (const field of UNIT_FIELDS) {
    profile[field] = unitRange(file, `${path}.${field}`, r[field]);
  }

  // A racer with no weapon writes null rather than omitting the field, so a
  // typo in the key cannot silently read as "unarmed".
  const weapon = r['startingWeapon'];
  if (weapon !== null) {
    profile.startingWeapon = text(file, `${path}.startingWeapon`, weapon);
  }

  return profile;
}

/** Parses and validates the whole racer roster. Throws on the first problem. */
export function loadRacers(file: string, raw: unknown): RacerProfile[] {
  if (typeof raw !== 'object' || raw === null) {
    fail(file, 'racers', 'must be a JSON object');
  }
  const list = (raw as Record<string, unknown>)['racers'];
  if (!Array.isArray(list)) fail(file, 'racers', 'must be an array');

  const profiles = list.map((entry, i) =>
    validateRacer(file, `racers[${i}]`, entry),
  );

  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.id)) {
      fail(file, `racers.${profile.id}`, 'is a duplicate id');
    }
    seen.add(profile.id);
  }
  if (!seen.has(PLAYER_ID)) {
    fail(file, 'racers', `must contain a profile with id "${PLAYER_ID}"`);
  }

  return profiles;
}
