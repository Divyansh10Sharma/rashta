import { ATTACK_KINDS, WEAPON_KINDS } from './types.ts';
import type {
  AttackKind,
  AttackSpec,
  CombatData,
  WeaponKind,
  WeaponSpec,
} from './types.ts';

/**
 * Validation and loading for `src/data/combat.json`.
 *
 * Same contract as every other loader: loud, early, naming the file and field.
 */

const ATTACK_FIELDS = [
  'windup',
  'active',
  'recovery',
  'damage',
  'range',
  'push',
  'cost',
  'stagger',
] as const;

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

function validateAttack(
  file: string,
  kind: AttackKind,
  raw: unknown,
): AttackSpec {
  const a = group(file, `attacks.${kind}`, raw);
  const spec = {} as AttackSpec;
  for (const field of ATTACK_FIELDS) {
    const at = `attacks.${kind}.${field}`;
    // `push` is the only one allowed to be zero: an attack that does not shove
    // is a real design choice, an attack with no windup is not.
    spec[field] =
      field === 'push' ? num(file, at, a[field]) : positive(file, at, a[field]);
  }
  if (spec.push < 0) fail(file, `attacks.${kind}.push`, 'must not be negative');
  return spec;
}

function validateWeapon(
  file: string,
  kind: WeaponKind,
  raw: unknown,
): WeaponSpec {
  const w = group(file, `weapons.${kind}`, raw);
  const name = w['name'];
  if (typeof name !== 'string' || name.length === 0) {
    fail(file, `weapons.${kind}.name`, 'must be a non-empty string');
  }
  const damage = positive(file, `weapons.${kind}.damage`, w['damage']);
  if (damage < 1) {
    // A weapon that makes you hit softer is not a weapon.
    fail(file, `weapons.${kind}.damage`, `must be at least 1, got ${damage}`);
  }
  return {
    name,
    damage,
    reach: positive(file, `weapons.${kind}.reach`, w['reach']),
  };
}

/** Parses and validates the combat data. Throws on the first problem. */
export function loadCombat(file: string, raw: unknown): CombatData {
  const root = group(file, 'combat', raw);
  const attacksRaw = group(file, 'attacks', root['attacks']);
  const weaponsRaw = group(file, 'weapons', root['weapons']);

  const attacks = {} as Record<AttackKind, AttackSpec>;
  for (const kind of ATTACK_KINDS) {
    if (!(kind in attacksRaw)) fail(file, `attacks.${kind}`, 'is missing');
    attacks[kind] = validateAttack(file, kind, attacksRaw[kind]);
  }

  const weapons = {} as Record<WeaponKind, WeaponSpec>;
  for (const kind of WEAPON_KINDS) {
    if (!(kind in weaponsRaw)) fail(file, `weapons.${kind}`, 'is missing');
    weapons[kind] = validateWeapon(file, kind, weaponsRaw[kind]);
  }

  return {
    attacks,
    weapons,
    staminaRegen: positive(file, 'staminaRegen', root['staminaRegen']),
    pickupRange: positive(file, 'pickupRange', root['pickupRange']),
    engageRange: positive(file, 'engageRange', root['engageRange']),
  };
}
