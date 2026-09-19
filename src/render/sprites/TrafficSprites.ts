import * as THREE from 'three';
import type { Track } from '../../core/track/Track.ts';
import type { TrafficKind, TrafficVehicle } from '../../core/sim/types.ts';
import { TRAFFIC_SIZES } from '../../core/sim/traffic.ts';
import { createFrame } from '../../core/track/path.ts';
import { composeCard, createSpriteMaterial, useTexture } from './Billboard.ts';
import type { Picture } from './library.ts';
import type { SpriteKit } from './kit.ts';

/**
 * Traffic as pictures.
 *
 * The simulation has four kinds because four is what it collides with; the
 * place's list in sprites.json gives each kind several pictures, and each
 * pool slot keeps its own for good — a car that changed model when it was
 * recycled would be a car that blinks. One instanced batch per picture, filled
 * front to back each frame, so a picture with nothing on screen costs nothing.
 *
 * Width is the width the simulation collides with, so what you see is what
 * you hit; height follows the art.
 */

interface Batch {
  picture: Picture;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  used: number;
}

/** A traffic pool's sprite layer. `TrafficView` draws the mesh for any slot this declines. */
export interface TrafficSprites {
  group: THREE.Group;
  /** Starts a frame. */
  begin: () => void;
  /** Draws a slot at interpolated `(s, t)`; false when its picture is not in. */
  draw: (
    slot: number,
    vehicle: TrafficVehicle,
    s: number,
    t: number,
  ) => boolean;
  /** Finishes a frame. */
  end: () => void;
  dispose: () => void;
}

const KINDS: readonly TrafficKind[] = ['car', 'auto', 'bus', 'truck'];

/** Creates the sprite layer for a pool of `poolSize` on `track`. */
export function createTrafficSprites(
  track: Track,
  kit: SpriteKit,
  poolSize: number,
): TrafficSprites {
  const group = new THREE.Group();
  const batches = new Map<string, Batch>();
  // The same batches as a list, for the frame loop: no iterator per frame.
  const all: Batch[] = [];

  const batchFor = (path: string): Batch => {
    const known = batches.get(path);
    if (known) return known;
    const material = createSpriteMaterial();
    material.color.copy(kit.light);
    const mesh = new THREE.InstancedMesh(kit.card, material, poolSize);
    mesh.name = `traffic-sprite:${path}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    group.add(mesh);
    const batch = { picture: kit.library.get(path), mesh, material, used: 0 };
    batches.set(path, batch);
    all.push(batch);
    return batch;
  };

  // Resolved once, so the frame loop never builds a string.
  const rear = new Map<TrafficKind, Batch[]>();
  const front = new Map<TrafficKind, Batch[]>();
  for (const kind of KINDS) {
    const names = kit.place.traffic[kind];
    rear.set(
      kind,
      names.map((name) => batchFor(`${name}-rear`)),
    );
    front.set(
      kind,
      names.map((name) => batchFor(`${name}-front`)),
    );
  }

  const frame = createFrame();
  const ground = new THREE.Vector3();
  const matrix = new THREE.Matrix4();

  const draw = (
    slot: number,
    vehicle: TrafficVehicle,
    s: number,
    t: number,
  ): boolean => {
    const list = (vehicle.oncoming ? front : rear).get(vehicle.kind);
    const batch = list?.[slot % list.length];
    const texture = batch?.picture.texture;
    if (!batch || !texture || batch.picture.status !== 'ready') return false;

    // The card stands at the end of the vehicle facing the rider — the rear
    // of one going your way, the nose of one coming at you, both at the low-s
    // end — so the picture is where the collision starts, not where the
    // middle of the vehicle is.
    const size = TRAFFIC_SIZES[vehicle.kind];
    track.sample(s - size.length / 2, frame, vehicle.pos.branchId);
    ground.set(
      frame.position.x + frame.right.x * t,
      frame.position.y + frame.right.y * t,
      frame.position.z + frame.right.z * t,
    );
    const { picture } = batch;
    useTexture(batch.material, texture);
    composeCard(
      matrix,
      ground,
      kit.facing,
      size.width,
      size.width * picture.aspect,
      picture.anchor,
      false,
    );
    batch.mesh.setMatrixAt(batch.used, matrix);
    batch.used += 1;
    return true;
  };

  return {
    group,
    begin: () => {
      for (const batch of all) batch.used = 0;
    },
    draw,
    end: () => {
      for (const batch of all) {
        batch.mesh.count = batch.used;
        batch.mesh.visible = batch.used > 0;
        if (batch.used > 0) batch.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose: () => {
      for (const batch of batches.values()) {
        batch.mesh.dispose();
        batch.material.dispose();
      }
    },
  };
}
