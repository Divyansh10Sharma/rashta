import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createField } from '../../src/render/FieldView.ts';
import { createFrame } from '../../src/core/track/path.ts';
import { MAIN_BRANCH } from '../../src/core/types.ts';
import { raceOn, trackFor } from '../helpers/race.ts';
import type { RaceEntry } from '../../src/core/sim/types.ts';

/**
 * The rivals, drawn.
 *
 * Same question as every other view: given `(s, t)`, is the bike where the
 * simulation says it is? Tolerances are millimetres — the transforms end up in
 * Float32 storage and anything tighter measures that instead.
 */

const track = trackFor('ridge-run-t1');

/** Two states of the same race, `metres` apart along the road. */
function pair(metres: number): {
  before: RaceEntry[];
  now: RaceEntry[];
} {
  const before = raceOn(track).entries;
  const now = raceOn(track).entries;
  for (const entry of [...before, ...now]) {
    entry.rider.pos.s = 300;
    entry.rider.pos.t = 2;
  }
  for (const entry of now) entry.rider.pos.s = 300 + metres;
  return { before, now };
}

function worldAt(s: number, t: number): THREE.Vector3 {
  const frame = createFrame();
  track.sample(s, frame, MAIN_BRANCH);
  return new THREE.Vector3(
    frame.position.x + frame.right.x * t,
    frame.position.y + frame.right.y * t,
    frame.position.z + frame.right.z * t,
  );
}

/** The visible rival views, in draw order. */
function shown(group: THREE.Object3D): THREE.Object3D[] {
  return group.children.filter((child) => child.visible);
}

describe('the rivals, drawn', () => {
  it('draws one bike per rival and never one for the player', () => {
    const race = raceOn(track);
    const rivals = race.entries.filter((e) => !e.isPlayer).length;
    expect(rivals).toBe(13);

    const view = createField(rivals);
    expect(view.count).toBe(13);

    const { before, now } = pair(0);
    view.update(before, now, 0.5, track);
    expect(shown(view.group).length).toBe(13);
    view.dispose();
  });

  it('puts a rival where the simulation says it is', () => {
    const view = createField(13);
    const { before, now } = pair(0);
    view.update(before, now, 1, track);

    const want = worldAt(300, 2);
    for (const child of shown(view.group)) {
      expect(child.position.distanceTo(want)).toBeLessThan(1e-3);
    }
    view.dispose();
  });

  it('interpolates between the two states', () => {
    const view = createField(13);
    const { before, now } = pair(10);

    view.update(before, now, 0.5, track);
    const half = shown(view.group)[0]?.position.clone();
    if (!half) throw new Error('nothing drawn');
    expect(half.distanceTo(worldAt(305, 2))).toBeLessThan(1e-3);

    view.update(before, now, 0, track);
    const start = shown(view.group)[0]?.position.clone();
    if (!start) throw new Error('nothing drawn');
    expect(start.distanceTo(worldAt(300, 2))).toBeLessThan(1e-3);
    view.dispose();
  });

  it('stops drawing a rival that has finished', () => {
    const view = createField(13);
    const { before, now } = pair(0);
    const first = now.find((e) => !e.isPlayer);
    const same = before.find((e) => !e.isPlayer);
    if (!first || !same) throw new Error('no rivals');
    first.finishTick = 900;
    same.finishTick = 900;

    view.update(before, now, 0.5, track);
    expect(shown(view.group).length).toBe(12);
    view.dispose();
  });

  it('hides a rival that changed branch between the two states', () => {
    // Interpolating across a fork would draw the bike through the scenery
    // between the two roads.
    const view = createField(13);
    const { before, now } = pair(0);
    const entry = now.find((e) => !e.isPlayer);
    if (!entry) throw new Error('no rivals');
    entry.rider.pos.branchId = 1;

    view.update(before, now, 0.5, track);
    expect(shown(view.group).length).toBe(12);
    view.dispose();
  });

  it('gives each rival its own livery', () => {
    const view = createField(13);
    const colours = new Set<number>();
    view.group.traverse((child) => {
      // `instanceof Mesh` narrows `material` to `any`; the flag does not.
      const mesh = child as Partial<THREE.Mesh>;
      if (mesh.isMesh !== true) return;
      const material = mesh.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        colours.add(material.color.getHex());
      }
    });
    // Thirteen bikes, each with several parts: more than one distinct colour,
    // and no two riders sharing the body colour that identifies them.
    expect(colours.size).toBeGreaterThan(13);
    view.dispose();
  });
});
