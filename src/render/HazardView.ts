import * as THREE from 'three';
import type { Track } from '../core/track/Track.ts';
import { createFrame } from '../core/track/path.ts';
import type { HazardKind } from '../core/types.ts';
import type { SpriteKit } from './sprites/kit.ts';
import { createHazardSprites } from './sprites/HazardSprites.ts';

/**
 * What is sitting in the road.
 *
 * Hazards never move, so unlike traffic and scenery this is not a pool: every
 * hazard on the route gets its matrix written once at build time and never
 * touched again. There is nothing to recycle and nothing to do per frame,
 * which is the cheapest correct answer — one instanced draw per kind, and
 * Three.js frustum-culls what is behind you.
 *
 * Sizes are what the thing is, not what would be fair: a cow is cow-sized. How
 * close you have to be to hit one is `HAZARD_REACH` in collide.ts, and the two
 * numbers are deliberately not the same — the drawn object is what you read at
 * 60 mph, the reach is what the simulation asks.
 */

export interface HazardField {
  group: THREE.Group;
  /** Total instances drawn, across every kind. */
  count: number;
  /** Swaps in hazard pictures as they arrive. Once per frame; cheap. */
  refresh: () => void;
  dispose: () => void;
}

/** Colour and shape per kind. Sodium light makes everything amber anyway. */
interface Look {
  colour: number;
  geometry: () => THREE.BufferGeometry;
  /** Emissive kinds read at distance; a pothole should not. */
  glow?: boolean;
}

function lying(width: number, length: number): THREE.BufferGeometry {
  // Flat on the tarmac, lifted a hair so it does not fight the road surface.
  const slab = new THREE.BoxGeometry(width, 0.04, length);
  slab.translate(0, 0.03, 0);
  return slab;
}

function standing(
  width: number,
  height: number,
  length: number,
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(width, height, length);
  box.translate(0, height / 2, 0);
  return box;
}

const LOOKS: Record<HazardKind, Look> = {
  oil: { colour: 0x121217, geometry: () => lying(2.6, 4.5) },
  sand: { colour: 0x9a8358, geometry: () => lying(2.8, 3.6) },
  pothole: { colour: 0x0b0b0e, geometry: () => lying(1.1, 1.4) },
  roadworks: {
    colour: 0xe08a1e,
    geometry: () => standing(1.9, 1.0, 0.5),
    glow: true,
  },
  barricade: {
    colour: 0xd94f2b,
    geometry: () => standing(2.4, 1.1, 0.28),
    glow: true,
  },
  cow: { colour: 0xcfc4b0, geometry: () => standing(0.85, 1.4, 2.3) },
  dog: { colour: 0x6b5b45, geometry: () => standing(0.35, 0.55, 0.95) },
};

/** Builds every hazard on the route as one instanced mesh per kind. */
export function createHazardField(
  track: Track,
  kit: SpriteKit | null = null,
): HazardField {
  const group = new THREE.Group();
  const frame = createFrame();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const forward = new THREE.Vector3();

  const byKind = new Map<HazardKind, number>();
  for (const hazard of track.hazards) {
    byKind.set(hazard.kind, (byKind.get(hazard.kind) ?? 0) + 1);
  }

  const meshes = new Map<HazardKind, THREE.InstancedMesh>();
  const materials: THREE.Material[] = [];
  let count = 0;

  for (const [kind, total] of byKind) {
    const look = LOOKS[kind];
    const material = new THREE.MeshStandardMaterial({
      color: look.colour,
      roughness: kind === 'oil' ? 0.15 : 0.9,
      ...(look.glow
        ? { emissive: look.colour, emissiveIntensity: 0.55 }
        : null),
    });
    materials.push(material);

    const mesh = new THREE.InstancedMesh(look.geometry(), material, total);
    mesh.name = `hazards:${kind}`;
    let index = 0;
    for (const hazard of track.hazards) {
      if (hazard.kind !== kind) continue;
      track.sample(hazard.s, frame, hazard.branchId);
      position.set(
        frame.position.x + frame.right.x * hazard.t,
        frame.position.y + frame.right.y * hazard.t,
        frame.position.z + frame.right.z * hazard.t,
      );
      forward.set(frame.forward.x, frame.forward.y, frame.forward.z);
      // Square to the road. A barricade at forty degrees to the kerb reads as
      // something that has already been hit.
      matrix.lookAt(ORIGIN, forward, WORLD_UP);
      quaternion.setFromRotationMatrix(matrix);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      index += 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    meshes.set(kind, mesh);
    group.add(mesh);
    count += total;
  }

  const sprites = kit ? createHazardSprites(track, kit, meshes) : null;
  if (sprites) group.add(sprites.group);

  return {
    group,
    count,
    refresh: () => sprites?.refresh(),
    dispose: () => {
      sprites?.dispose();
      for (const mesh of meshes.values()) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      for (const material of materials) material.dispose();
    },
  };
}

const ORIGIN = new THREE.Vector3(0, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
