import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseTrack } from '../../src/core/track/load.ts';
import { createFrame } from '../../src/core/track/path.ts';
import { createHazardField } from '../../src/render/HazardView.ts';
import { createTrafficView } from '../../src/render/TrafficView.ts';
import { TRAFFIC_SIZES } from '../../src/core/sim/traffic.ts';
import { MAIN_BRANCH } from '../../src/core/types.ts';
import type { Track } from '../../src/core/track/Track.ts';
import type { TrafficKind, TrafficVehicle } from '../../src/core/sim/types.ts';

/**
 * What is on the road, drawn.
 *
 * Both of these turn track space into world space, which is the one thing the
 * render layer is allowed to do and the one thing worth checking without a
 * GPU: given `(s, t)`, is the box where the simulation thinks it is?
 *
 * Tolerances here are millimetres, not epsilons: an instance matrix lives in a
 * Float32Array, so a point a kilometre down the road is only good to about a
 * tenth of a millimetre. Anything tighter is measuring the storage.
 */

function load(name: string): Track {
  const path = `src/data/tracks/${name}.json`;
  return parseTrack(path, readFileSync(path, 'utf8'));
}

const hazardous = load('test-track');
const bare = load('straight');

/** Where the renderer should have put something at `(s, t)`. */
function expected(track: Track, s: number, t: number, branchId: number) {
  const frame = createFrame();
  track.sample(s, frame, branchId);
  return new THREE.Vector3(
    frame.position.x + frame.right.x * t,
    frame.position.y + frame.right.y * t,
    frame.position.z + frame.right.z * t,
  );
}

function instanceAt(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(position, quaternion, scale);
  return position;
}

function instanceScale(mesh: THREE.InstancedMesh, index: number): number {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(position, quaternion, scale);
  return scale.length();
}

function meshNamed(group: THREE.Object3D, name: string): THREE.InstancedMesh {
  const found: THREE.Object3D | undefined = group.getObjectByName(name);
  // `instanceof InstancedMesh` narrows to its all-`any` generic form, which is
  // worse than the flag Three.js puts there for exactly this purpose.
  if (!found || !(found as Partial<THREE.InstancedMesh>).isInstancedMesh) {
    throw new Error(`no instanced mesh named ${name}`);
  }
  return found as THREE.InstancedMesh;
}

describe('hazards, drawn', () => {
  it('draws every hazard on the route exactly once', () => {
    const field = createHazardField(hazardous);
    expect(hazardous.hazards.length).toBeGreaterThan(0);
    expect(field.count).toBe(hazardous.hazards.length);

    let instances = 0;
    for (const child of field.group.children) {
      if (child instanceof THREE.InstancedMesh) instances += child.count;
    }
    expect(instances).toBe(hazardous.hazards.length);
    field.dispose();
  });

  it('puts each one where the simulation says it is', () => {
    const field = createHazardField(hazardous);
    // Instances are grouped by kind and written in route order within a kind,
    // so walking the hazards of one kind walks that mesh's indices.
    const seen = new Map<string, number>();
    for (const hazard of hazardous.hazards) {
      const index = seen.get(hazard.kind) ?? 0;
      seen.set(hazard.kind, index + 1);
      const mesh = meshNamed(field.group, `hazards:${hazard.kind}`);
      const want = expected(hazardous, hazard.s, hazard.t, hazard.branchId);
      expect(instanceAt(mesh, index).distanceTo(want)).toBeLessThan(1e-3);
    }
    field.dispose();
  });

  it('draws nothing at all on a route with no hazards', () => {
    const field = createHazardField(bare);
    expect(bare.hazards.length).toBe(0);
    expect(field.count).toBe(0);
    expect(field.group.children.length).toBe(0);
    field.dispose();
  });
});

/** A pool slot, with only the fields the renderer reads. */
function vehicle(
  kind: TrafficKind,
  s: number,
  t: number,
  extra: Partial<TrafficVehicle> = {},
): TrafficVehicle {
  return {
    kind,
    pos: { s, t, branchId: MAIN_BRANCH },
    speed: 12,
    cruise: 12,
    lane: 0,
    oncoming: false,
    laneChangeTimer: 1,
    active: true,
    ...extra,
  };
}

/** How many lamp instances in `mesh` are actually being drawn. */
function litCount(view: { group: THREE.Object3D }, name: string): number {
  const mesh = meshNamed(view.group, name);
  let lit = 0;
  for (let i = 0; i < mesh.count; i += 1) {
    if (instanceScale(mesh, i) > 1e-6) lit += 1;
  }
  return lit;
}

describe('traffic, drawn', () => {
  it('puts an active vehicle where the simulation says it is', () => {
    const view = createTrafficView(bare, 2);
    view.update([vehicle('bus', 100, 2)], [vehicle('bus', 100, 2)], 0.5);

    const want = expected(bare, 100, 2, MAIN_BRANCH);
    const mesh = meshNamed(view.group, 'traffic:bus');
    expect(instanceAt(mesh, 0).distanceTo(want)).toBeLessThan(1e-3);
    view.dispose();
  });

  it('scales an inactive slot to nothing rather than moving it away', () => {
    // Parking a hidden vehicle under the map is a bug waiting for the day
    // someone drives under the map. Zero scale draws no pixels.
    const idle = vehicle('car', 100, 0, { active: false });
    const view = createTrafficView(bare, 2);
    view.update([idle], [idle], 0.5);

    for (const kind of ['auto', 'car', 'bus', 'truck'] as TrafficKind[]) {
      expect(instanceScale(meshNamed(view.group, `traffic:${kind}`), 0)).toBe(
        0,
      );
    }
    expect(litCount(view, 'traffic:heads')).toBe(0);
    expect(litCount(view, 'traffic:tails')).toBe(0);
    view.dispose();
  });

  it('interpolates between the two most recent sim states', () => {
    const view = createTrafficView(bare, 1);
    const before = [vehicle('car', 100, 0)];
    const now = [vehicle('car', 102, 0)];
    const mesh = meshNamed(view.group, 'traffic:car');

    for (const [alpha, s] of [
      [0, 100],
      [0.5, 101],
      [1, 102],
    ] as const) {
      view.update(before, now, alpha);
      const want = expected(bare, s, 0, MAIN_BRANCH);
      expect(instanceAt(mesh, 0).distanceTo(want)).toBeLessThan(1e-3);
    }
    view.dispose();
  });

  it('hides a slot that was recycled between the two states', () => {
    // The pool reuses slot 0 for a new vehicle 800 m away. Interpolating that
    // would fire a car across the whole visible road in one frame.
    const view = createTrafficView(bare, 1);
    view.update([vehicle('car', 100, 0)], [vehicle('car', 900, 0)], 0.5);
    expect(instanceScale(meshNamed(view.group, 'traffic:car'), 0)).toBe(0);
    expect(
      litCount(view, 'traffic:heads') + litCount(view, 'traffic:tails'),
    ).toBe(0);
    view.dispose();
  });

  it('shows tail lights going away and headlights coming at you', () => {
    const away = [vehicle('car', 100, 3)];
    const at = [vehicle('car', 100, -3, { oncoming: true })];

    const going = createTrafficView(bare, 1);
    going.update(away, away, 1);
    expect(litCount(going, 'traffic:tails')).toBe(1);
    expect(litCount(going, 'traffic:heads')).toBe(0);
    going.dispose();

    const coming = createTrafficView(bare, 1);
    coming.update(at, at, 1);
    expect(litCount(coming, 'traffic:heads')).toBe(1);
    expect(litCount(coming, 'traffic:tails')).toBe(0);
    coming.dispose();
  });

  it('puts the lamps on the end of the vehicle that faces the rider', () => {
    // A bus is 11 m long; its tail lights belong 5 m behind its centre, not
    // at its centre, or a bus reads as a car until you are inside it.
    const bus = [vehicle('bus', 200, 0)];
    const view = createTrafficView(bare, 1);
    view.update(bus, bus, 1);

    const body = instanceAt(meshNamed(view.group, 'traffic:bus'), 0);
    const lamp = instanceAt(meshNamed(view.group, 'traffic:tails'), 0);
    const along = Math.hypot(lamp.x - body.x, lamp.z - body.z);
    expect(along).toBeCloseTo(TRAFFIC_SIZES.bus.length * 0.46, 3);
    view.dispose();
  });
});
