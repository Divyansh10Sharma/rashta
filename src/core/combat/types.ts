/** Fighting on a moving motorcycle: what the attacks and weapons are. */

/** The three attacks, from `src/data/combat.json`. */
export type AttackKind = 'punch' | 'kick' | 'backhand';

/** The three weapons. They circulate; they are never bought or created. */
export type WeaponKind = 'pipe' | 'chain' | 'bat';

export const ATTACK_KINDS: readonly AttackKind[] = [
  'punch',
  'kick',
  'backhand',
];
export const WEAPON_KINDS: readonly WeaponKind[] = ['pipe', 'chain', 'bat'];

/**
 * One attack's shape in time and space.
 *
 * The three phases are the whole design: you cannot steer during `windup` or
 * `recovery`, so a heavy attack taken into a bend is how you crash. Only
 * during `active` can the attack connect.
 */
export interface AttackSpec {
  /** Seconds of commitment before the blow can land. Steering is locked. */
  windup: number;
  /** Seconds during which the blow connects. */
  active: number;
  /** Seconds of exposure afterwards. Steering is locked. */
  recovery: number;
  /** Stamina taken from whoever it lands on, before any weapon multiplier. */
  damage: number;
  /** Metres, measured with `trackDistance`. Never an `(s, t)` box. */
  range: number;
  /** Metres of lateral shove given to the target. A kick is mostly this. */
  push: number;
  /** Stamina it costs the attacker to throw. */
  cost: number;
  /** Seconds the target loses lateral control for. */
  stagger: number;
}

/** What carrying a weapon does. Multiplies damage and extends reach. */
export interface WeaponSpec {
  /** Shown on the HUD. Generic objects, no brands — see CLAUDE.md. */
  name: string;
  /** Damage multiplier. */
  damage: number;
  /** Metres added to every attack's range. */
  reach: number;
}

/** `src/data/combat.json`, validated. */
export interface CombatData {
  attacks: Record<AttackKind, AttackSpec>;
  weapons: Record<WeaponKind, WeaponSpec>;
  /** Stamina per second regained while not being hit. */
  staminaRegen: number;
  /** Metres within which a rider can collect a weapon lying in the road. */
  pickupRange: number;
  /** Metres within which a rider counts as engaged, for the HUD and the AI. */
  engageRange: number;
}

/** A weapon lying in the road, waiting to be picked up. */
export interface DroppedWeapon {
  kind: WeaponKind;
  s: number;
  t: number;
  branchId: number;
  /**
   * Seconds before anyone can pick it up.
   *
   * Without it the rider who just lost a weapon collects it again on the next
   * tick, because it lands at their feet — so a steal lasted one frame and the
   * whole mechanic did nothing. A second and a bit of it tumbling down the
   * road is enough for everyone to be somewhere else.
   */
  settle: number;
  /** Inactive entries are slots waiting for a weapon to be knocked loose. */
  active: boolean;
}
