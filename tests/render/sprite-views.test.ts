import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRider } from '../../src/core/sim/world.ts';
import { createFrame } from '../../src/core/track/path.ts';
import { parseTrack } from '../../src/core/track/load.ts';
import { MAIN_BRANCH } from '../../src/core/types.ts';
import { TRAFFIC_SIZES } from '../../src/core/sim/traffic.ts';
import { createRiderDrawing } from '../../src/render/sprites/RiderSprite.ts';
import { createTrafficView } from '../../src/render/TrafficView.ts';
import { createHazardField } from '../../src/render/HazardView.ts';
import { createScenery, sceneryFor } from '../../src/render/Scenery.ts';
import { createRoadsideSprites } from '../../src/render/sprites/RoadsideSprites.ts';
import { bikes, trackFor } from '../helpers/race.ts';
import { fakeKit } from '../helpers/sprites.ts';
import type { Track } from '../../src/core/track/Track.ts';
import type { Rider, TrafficVehicle } from '../../src/core/sim/types.ts';

/**
 * The sprite views: is each picture where the simulation says the thing is,
 * and is the old mesh up exactly when the picture is not?
 *
 * Millimetre tolerances, as in the other view tests: matrices end up in
 * Float32 storage.
 */

const track = trackFor('ridge-run-t1');

function onRoad(on: Track, s: number, t: number, h = 0): THREE.Vector3 {
  const frame = createFrame();
  on.sample(s, frame, MAIN_BRANCH);
  return new THREE.Vector3(
    frame.position.x + frame.right.x * t + frame.up.x * h,
    frame.position.y + frame.right.y * t + frame.up.y * h,
    frame.position.z + frame.right.z * t + frame.up.z * h,
  );
}

function rider(setup: (r: Rider) => void = () => undefined): Rider {
  const bike = bikes[0];
  if (!bike) throw new Error('no bikes');
  const r = createRider(bike);
  r.pos.s = 300;
  r.pos.t = 1.5;
  r.bikePos.s = 300;
  r.bikePos.t = 1.5;
  setup(r);
  return r;
}

/** The two cards: the rider, then the bike. */
function cards(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter(
    (child): child is THREE.Mesh => (child as THREE.Mesh).isMesh === true,
  );
}

function translation(matrix: THREE.Matrix4): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

describe('a rider, drawn as a picture', () => {
  it('stands the picture on the road where the rider is, mesh hidden', () => {
    const kit = fakeKit('ridge');
    const view = createRiderDrawing(0x2f6fd0, kit);
    const r = rider();
    view.update(track, r, r, 0);

    const [card, bike] = cards(view.group);
    expect(card?.visible).toBe(true);
    expect(bike?.visible).toBe(false);
    expect(view.group.children[0]?.visible).toBe(false);
    expect(view.position.distanceTo(onRoad(track, 300, 1.5))).toBeLessThan(
      1e-3,
    );
    // A centred anchor, so the card's origin is the ground point itself.
    const at = translation(card?.matrix ?? new THREE.Matrix4());
    expect(at.distanceTo(view.position)).toBeLessThan(1e-3);
  });

  it('lifts a thrown rider by h, along the road’s up', () => {
    const kit = fakeKit('ridge');
    const view = createRiderDrawing(0x2f6fd0, kit);
    const r = rider((x) => {
      x.state = 'airborne';
      x.h = 2;
      x.hVel = 1;
    });
    view.update(track, r, r, 0);
    expect(view.position.distanceTo(onRoad(track, 300, 1.5, 2))).toBeLessThan(
      1e-3,
    );
  });

  it('draws the bike as its own picture where it slid to, while apart', () => {
    const kit = fakeKit('ridge');
    const view = createRiderDrawing(0x2f6fd0, kit);
    const r = rider((x) => {
      x.state = 'running';
      x.bikePos.s = 324;
      x.bikePos.t = -2;
    });
    view.update(track, r, r, 0);

    const [, bike] = cards(view.group);
    expect(bike?.visible).toBe(true);
    const at = translation(bike?.matrix ?? new THREE.Matrix4());
    expect(at.distanceTo(onRoad(track, 324, -2))).toBeLessThan(1e-3);
    expect(kit.library.asked).toContain('rider/run');
  });

  it('puts the rider back on the bike while remounting', () => {
    const kit = fakeKit('ridge');
    const view = createRiderDrawing(0x2f6fd0, kit);
    const r = rider((x) => (x.state = 'remounting'));
    view.update(track, r, r, 0);
    expect(cards(view.group)[1]?.visible).toBe(false);
  });

  it('flips the picture for a left lean', () => {
    const kit = fakeKit('ridge');
    const view = createRiderDrawing(0x2f6fd0, kit);
    const r = rider((x) => (x.lean = -kit.leanMax));
    view.update(track, r, r, 0);
    expect(cards(view.group)[0]?.matrix.determinant()).toBeLessThan(0);
  });

  it('interpolates between the two states it is given', () => {
    const kit = fakeKit('ridge');
    const view = createRiderDrawing(0x2f6fd0, kit);
    const before = rider();
    const now = rider((x) => (x.pos.s = 310));
    view.update(track, before, now, 0.5);
    expect(view.position.distanceTo(onRoad(track, 305, 1.5))).toBeLessThan(
      1e-3,
    );
  });

  it('draws the old mesh when the sheet cannot show this state', () => {
    const kit = fakeKit('ridge', (path) => path.startsWith('rider/'));
    const view = createRiderDrawing(0x2f6fd0, kit);
    const r = rider();
    view.update(track, r, r, 0);
    expect(view.group.children[0]?.visible).toBe(true);
    expect(cards(view.group).every((card) => !card.visible)).toBe(true);
  });

  it('draws the police from their own pictures', () => {
    const kit = fakeKit('ridge');
    const view = createRiderDrawing(0xe8ecf2, kit, 'police');
    const r = rider();
    view.update(track, r, r, 0);
    expect(kit.library.asked).toContain('police/centre');
  });
});

function vehicle(extra: Partial<TrafficVehicle> = {}): TrafficVehicle {
  return {
    kind: 'car',
    pos: { s: 200, t: 2, branchId: MAIN_BRANCH },
    speed: 12,
    cruise: 12,
    lane: 0,
    oncoming: false,
    laneChangeTimer: 1,
    active: true,
    ...extra,
  };
}

function named(group: THREE.Object3D, name: string): THREE.InstancedMesh {
  const found = group.getObjectByName(name);
  if (!found || !(found as Partial<THREE.InstancedMesh>).isInstancedMesh) {
    throw new Error(`no instanced mesh named ${name}`);
  }
  return found as THREE.InstancedMesh;
}

describe('traffic, drawn as pictures', () => {
  it('stands the picture at the vehicle’s near end, sized to what you hit', () => {
    const kit = fakeKit('ridge');
    const view = createTrafficView(track, 1, kit);
    const car = vehicle({ kind: 'bus' });
    view.update([car], [car], 0);

    // Ridge buses are coaches (sprites.json); the one picture in the list.
    const batch = named(view.group, 'traffic-sprite:traffic/coach-rear');
    expect(batch.count).toBe(1);
    const matrix = new THREE.Matrix4();
    batch.getMatrixAt(0, matrix);
    const near = onRoad(track, 200 - TRAFFIC_SIZES.bus.length / 2, 2);
    expect(translation(matrix).distanceTo(near)).toBeLessThan(1e-3);
    const scale = new THREE.Vector3().setFromMatrixScale(matrix);
    expect(scale.x).toBeCloseTo(TRAFFIC_SIZES.bus.width, 5);
  });

  it('hides the mesh and its lamps for a slot drawn as a picture', () => {
    const kit = fakeKit('ridge');
    const view = createTrafficView(track, 1, kit);
    const car = vehicle();
    view.update([car], [car], 0);
    const matrix = new THREE.Matrix4();
    named(view.group, 'traffic:car').getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).length()).toBe(0);
    named(view.group, 'traffic:tails').getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).length()).toBe(0);
  });

  it('shows oncoming traffic from the front', () => {
    const kit = fakeKit('ridge');
    const view = createTrafficView(track, 1, kit);
    const car = vehicle({
      kind: 'truck',
      oncoming: true,
      pos: { s: 200, t: -2, branchId: MAIN_BRANCH },
    });
    view.update([car], [car], 0);
    expect(named(view.group, 'traffic-sprite:traffic/truck-front').count).toBe(
      1,
    );
    expect(named(view.group, 'traffic-sprite:traffic/truck-rear').count).toBe(
      0,
    );
  });

  it('keeps each slot’s picture, so a recycled car does not change model', () => {
    const kit = fakeKit('ridge');
    const view = createTrafficView(track, 4, kit);
    const pool = [0, 1, 2, 3].map((i) =>
      vehicle({ pos: { s: 100 + i * 20, t: 2, branchId: MAIN_BRANCH } }),
    );
    view.update(pool, pool, 0);
    const drawn = (name: string): number =>
      named(view.group, `traffic-sprite:traffic/${name}-rear`).count;
    // Ridge cars cycle suv, car, sedan, van — one slot each.
    expect(['suv', 'car', 'sedan', 'van'].map(drawn)).toEqual([1, 1, 1, 1]);
  });

  it('falls back to the mesh for a picture that is not in', () => {
    const kit = fakeKit('ridge', (path) => path.includes('coach'));
    const view = createTrafficView(track, 1, kit);
    const bus = vehicle({ kind: 'bus' });
    view.update([bus], [bus], 0);
    const matrix = new THREE.Matrix4();
    named(view.group, 'traffic:bus').getMatrixAt(0, matrix);
    expect(
      new THREE.Vector3().setFromMatrixScale(matrix).length(),
    ).toBeGreaterThan(0);
  });
});

describe('hazards and roadside, drawn as pictures', () => {
  const path = 'src/data/tracks/test-track.json';
  const hazardous = parseTrack(path, readFileSync(path, 'utf8'));

  it('swaps each kind’s mesh for its picture once the picture is in', () => {
    const kit = fakeKit(hazardous.data.scenery);
    const field = createHazardField(hazardous, kit);
    field.refresh();
    const kinds = new Set(hazardous.hazards.map((h) => h.kind));
    for (const kind of kinds) {
      const pictured = kit.data.hazards[kind] !== null;
      expect(named(field.group, `hazards:${kind}`).visible, kind).toBe(
        !pictured,
      );
      if (pictured) {
        expect(named(field.group, `hazard-sprite:${kind}`).visible, kind).toBe(
          true,
        );
      }
    }
  });

  it('lays a pothole flat on the road instead of standing it up', () => {
    const kit = fakeKit(hazardous.data.scenery);
    const field = createHazardField(hazardous, kit);
    field.refresh();
    expect(hazardous.hazards.some((h) => h.kind === 'pothole')).toBe(true);
    const matrix = new THREE.Matrix4();
    named(field.group, 'hazard-sprite:pothole').getMatrixAt(0, matrix);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
    expect(normal.y).toBeGreaterThan(0.95);
  });

  it('replaces the generated streetlights with the place’s lamp picture', () => {
    const kit = fakeKit('ridge');
    const config = sceneryFor('ridge');
    const scenery = createScenery(track, config);
    const roadside = createRoadsideSprites(
      track,
      kit,
      config,
      scenery.streetlights,
    );
    roadside.update(0);
    expect(scenery.streetlights.every((mesh) => !mesh.visible)).toBe(true);
    expect(
      named(roadside.group, 'roadside-sprite:scenery/lamp').count,
    ).toBeGreaterThan(0);
    expect(
      named(roadside.group, 'roadside-sprite:scenery/pine').count,
    ).toBeGreaterThan(0);
  });

  it('keeps the generated streetlights while the lamp picture is missing', () => {
    const kit = fakeKit('ridge', (p) => p === 'scenery/lamp');
    const config = sceneryFor('ridge');
    const scenery = createScenery(track, config);
    const roadside = createRoadsideSprites(
      track,
      kit,
      config,
      scenery.streetlights,
    );
    roadside.update(0);
    expect(scenery.streetlights.every((mesh) => mesh.visible)).toBe(true);
  });
});
