import * as THREE from 'three';
import { createRiderView } from './Rider.ts';
import type { RiderView } from './Rider.ts';
import type { Track } from '../core/track/Track.ts';
import type { RaceEntry, Rider } from '../core/sim/types.ts';
import type { CombatData } from '../core/combat/types.ts';
import { phaseOf } from '../core/combat/combat.ts';

/**
 * How brightly a rider is lit, 0 to 1.
 *
 * A swing builds through the windup and peaks as it lands, so you can see it
 * coming and see it connect. Being staggered lights you up too — that is how
 * you tell who just took the hit.
 */
export function glowFor(rider: Rider, combat: CombatData): number {
  if (rider.staggerTimer > 0) return Math.min(1, rider.staggerTimer * 2.5);
  const phase = phaseOf(rider, combat);
  if (phase === null) return 0;
  if (phase === 'recovery') return 0.15;
  if (phase === 'active') return 1;
  const spec = combat.attacks[rider.attack ?? 'punch'];
  return 0.2 + 0.6 * (rider.attackElapsed / spec.windup);
}

/**
 * The thirteen rivals, drawn.
 *
 * One `RiderView` each rather than an instanced mesh: a bike is a handful of
 * small parts that lean independently of the road, and thirteen of them is a
 * small enough number that the simpler thing is also the right thing. Traffic
 * is instanced because there are ten times as many of it.
 *
 * The player is not drawn here. `Stage` already owns that one, because the
 * camera is attached to it.
 */

export interface FieldView {
  group: THREE.Group;
  /** Rival views, in entry order. The player's slot is absent. */
  count: number;
  /** Draws the rivals, interpolating between two race states. */
  update: (
    previous: readonly RaceEntry[],
    current: readonly RaceEntry[],
    alpha: number,
    track: Track,
    combat: CombatData,
  ) => void;
  dispose: () => void;
}

/**
 * Livery colours. Thirteen distinguishable at night under sodium light, which
 * rules out most of the blues and all of the browns.
 */
const LIVERY = [
  0x2f6fd0, 0xe0d24a, 0x3fae5a, 0xd8582f, 0xb14fc4, 0x2fc0bd, 0xe07ab0,
  0x8fbe2f, 0xd94f6a, 0x4f6fe0, 0xe09a2f, 0x7fd4a0, 0xc0c4cc,
];

export function createField(riders: number): FieldView {
  const group = new THREE.Group();
  const views: RiderView[] = [];
  for (let i = 0; i < riders; i += 1) {
    const view = createRiderView(LIVERY[i % LIVERY.length] ?? 0xc4402c);
    view.group.visible = false;
    views.push(view);
    group.add(view.group);
  }

  const update = (
    previous: readonly RaceEntry[],
    current: readonly RaceEntry[],
    alpha: number,
    track: Track,
    combat: CombatData,
  ): void => {
    let slot = 0;
    for (let i = 0; i < current.length; i += 1) {
      const now = current[i];
      const before = previous[i];
      if (!now || !before || now.isPlayer) continue;
      const view = views[slot];
      slot += 1;
      if (!view) continue;

      // A rider who has finished is off the road, and one on the far side of
      // a fork is drawn on their own path, not guessed onto this one.
      const drawable =
        now.finishTick === null &&
        before.finishTick === null &&
        now.rider.pos.branchId === before.rider.pos.branchId;
      if (!drawable) {
        view.group.visible = false;
        continue;
      }

      const a = before.rider;
      const b = now.rider;
      const s = a.pos.s + (b.pos.s - a.pos.s) * alpha;
      const t = a.pos.t + (b.pos.t - a.pos.t) * alpha;
      const lean = a.lean + (b.lean - a.lean) * alpha;
      const wheel = a.wheelAngle + (b.wheelAngle - a.wheelAngle) * alpha;

      view.group.visible = true;
      view.update(track, s, t, lean, wheel, b.pos.branchId);
      view.highlight(glowFor(b, combat), b.staggerTimer > 0);
    }
  };

  return {
    group,
    count: views.length,
    update,
    dispose: () => {
      for (const view of views) view.dispose();
    },
  };
}
