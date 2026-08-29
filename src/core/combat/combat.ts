import { trackDistance } from '../track/distance.ts';
import { crash } from '../sim/collide.ts';
import type { Track } from '../track/Track.ts';
import type { Rider, Tuning } from '../sim/types.ts';
import type {
  AttackKind,
  AttackSpec,
  CombatData,
  DroppedWeapon,
  WeaponKind,
} from './types.ts';

/**
 * Fighting, resolved in track space.
 *
 * Range is `trackDistance`, never a raw `(s, t)` box: two riders three metres
 * apart on the inside of a tight bend are not three metres apart, and a box
 * says they are. A range check that only passes on a straight is not passing.
 *
 * Nothing here is transcendental. `trackDistance` is a square root over a
 * series expansion, and everything else is arithmetic.
 */

/** Seconds a knocked-loose weapon spends tumbling before anyone can take it. */
const SETTLE_SECONDS = 1.2;

/** Which phase of an attack a rider is in, or null if not attacking. */
export type AttackPhase = 'windup' | 'active' | 'recovery';

/** Whether a rider can act at all: down, staggered, or mid-swing all say no. */
export function canSteer(rider: Rider): boolean {
  return rider.staggerTimer <= 0 && rider.attack === null;
}

/** The phase of `rider`'s attack, or null if it is not attacking. */
export function phaseOf(rider: Rider, data: CombatData): AttackPhase | null {
  if (rider.attack === null) return null;
  const spec = data.attacks[rider.attack];
  if (rider.attackElapsed < spec.windup) return 'windup';
  if (rider.attackElapsed < spec.windup + spec.active) return 'active';
  return 'recovery';
}

/** How far this rider's attack reaches, in metres, weapon included. */
export function reachOf(
  rider: Rider,
  spec: AttackSpec,
  data: CombatData,
): number {
  const weapon = rider.weapon;
  return spec.range + (weapon === null ? 0 : data.weapons[weapon].reach);
}

/**
 * Begins an attack, if the rider is in a position to throw one.
 *
 * Returns whether it started. A rider already swinging, staggered, down, or
 * too tired to pay for it cannot throw.
 */
export function startAttack(
  rider: Rider,
  kind: AttackKind,
  data: CombatData,
): boolean {
  if (rider.state !== 'riding') return false;
  if (rider.attack !== null || rider.staggerTimer > 0) return false;
  const spec = data.attacks[kind];
  if (rider.stamina <= spec.cost) return false;

  rider.stamina -= spec.cost;
  rider.attack = kind;
  rider.attackElapsed = 0;
  return true;
}

/** The nearest other rider within `engageRange`, or null. */
export function engagedWith(
  rider: Rider,
  field: readonly Rider[],
  track: Track,
  data: CombatData,
): Rider | null {
  let best: Rider | null = null;
  let bestAt = data.engageRange;
  for (const other of field) {
    if (other === rider || other.state === 'crashing') continue;
    if (other.pos.branchId !== rider.pos.branchId) continue;
    // Cheap rejection before the expensive curved measurement.
    if (Math.abs(other.pos.s - rider.pos.s) > bestAt) continue;
    const at = trackDistance(rider.pos, other.pos, track);
    if (at < bestAt) {
      bestAt = at;
      best = other;
    }
  }
  return best;
}

/** Puts `weapon` on the road at a rider's feet. Never creates one. */
function drop(pool: DroppedWeapon[], weapon: WeaponKind, rider: Rider): void {
  for (const slot of pool) {
    if (slot.active) continue;
    slot.kind = weapon;
    slot.s = rider.pos.s;
    slot.t = rider.pos.t;
    slot.branchId = rider.pos.branchId;
    slot.settle = SETTLE_SECONDS;
    slot.active = true;
    return;
  }
  // The pool is sized to the number of weapons in the race, so this cannot
  // happen unless a weapon was created somewhere. Losing one silently would
  // hide exactly that bug.
  throw new Error('combat: no free slot to drop a weapon into');
}

/** Lands `attacker`'s blow on `target`. */
function land(
  attacker: Rider,
  target: Rider,
  spec: AttackSpec,
  dropped: DroppedWeapon[],
  data: CombatData,
  tuning: Tuning,
): void {
  const weapon = attacker.weapon;
  const damage =
    spec.damage * (weapon === null ? 1 : data.weapons[weapon].damage);
  target.stamina -= damage;
  target.staggerTimer = Math.max(target.staggerTimer, spec.stagger);

  // The shove is away from the attacker. Near the flyway's open edge this is
  // the whole danger, and it is why a kick exists.
  const away = target.pos.t >= attacker.pos.t ? 1 : -1;
  target.pos.t += away * spec.push;
  target.lateral = 0;

  // A clean hit knocks a weapon loose. An unarmed attacker takes it; an armed
  // one puts it in the road. Either way it moves and is never copied.
  if (target.weapon !== null) {
    const loose = target.weapon;
    target.weapon = null;
    if (attacker.weapon === null) attacker.weapon = loose;
    else drop(dropped, loose, target);
  }

  if (target.stamina <= 0) {
    target.stamina = 0;
    if (target.weapon !== null) {
      drop(dropped, target.weapon, target);
      target.weapon = null;
    }
    crash(target, 'combat', tuning);
  }
}

/** Picks up anything lying in the road that an unarmed rider rides over. */
function collect(
  rider: Rider,
  dropped: DroppedWeapon[],
  track: Track,
  data: CombatData,
): void {
  if (rider.weapon !== null || rider.state !== 'riding') return;
  for (const slot of dropped) {
    if (!slot.active || slot.settle > 0) continue;
    if (slot.branchId !== rider.pos.branchId) continue;
    if (Math.abs(slot.s - rider.pos.s) > data.pickupRange) continue;
    if (trackDistance(rider.pos, slot, track) > data.pickupRange) continue;
    rider.weapon = slot.kind;
    slot.active = false;
    return;
  }
}

/**
 * Advances every rider's attack by one tick and resolves what connects.
 *
 * Two passes, for the same reason collisions resolve after movement: with one
 * pass the outcome would depend on the order the field happens to be stored
 * in, and whoever was stored first would win every exchange.
 */
export function stepCombat(
  field: readonly Rider[],
  dropped: DroppedWeapon[],
  track: Track,
  data: CombatData,
  tuning: Tuning,
  dt: number,
): void {
  for (const slot of dropped) {
    if (slot.active && slot.settle > 0) slot.settle -= dt;
  }

  for (const rider of field) {
    if (rider.staggerTimer > 0) rider.staggerTimer -= dt;
    if (rider.stamina < 100 && rider.state === 'riding') {
      rider.stamina = Math.min(100, rider.stamina + data.staminaRegen * dt);
    }
    // A rider knocked off mid-swing is not still swinging.
    if (rider.attack !== null && rider.state !== 'riding') {
      rider.attack = null;
      rider.attackElapsed = 0;
    }
  }

  for (const attacker of field) {
    const kind = attacker.attack;
    if (kind === null) continue;
    const spec = data.attacks[kind];
    const before = attacker.attackElapsed;
    attacker.attackElapsed += dt;

    // The blow lands on the tick the active window opens, once. Resolving it
    // every tick of the window would make a punch a machine gun.
    const opens = before < spec.windup && attacker.attackElapsed >= spec.windup;
    if (opens) {
      const reach = reachOf(attacker, spec, data);
      for (const target of field) {
        if (target === attacker || target.state !== 'riding') continue;
        if (target.pos.branchId !== attacker.pos.branchId) continue;
        if (Math.abs(target.pos.s - attacker.pos.s) > reach) continue;
        if (trackDistance(attacker.pos, target.pos, track) > reach) continue;
        land(attacker, target, spec, dropped, data, tuning);
      }
    }

    if (attacker.attackElapsed >= spec.windup + spec.active + spec.recovery) {
      attacker.attack = null;
      attacker.attackElapsed = 0;
    }
  }

  for (const rider of field) collect(rider, dropped, track, data);
}
