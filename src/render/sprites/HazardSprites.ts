import * as THREE from 'three';
import type { Track } from '../../core/track/Track.ts';
import type { HazardKind } from '../../core/types.ts';
import { createFrame } from '../../core/track/path.ts';
import {
  composeCard,
  createFacing,
  createSpriteMaterial,
  faceAlong,
  useTexture,
} from './Billboard.ts';
import { metresFor, type SpriteSize } from './data.ts';
import type { Picture } from './library.ts';
import type { SpriteKit } from './kit.ts';

/**
 * Hazards as pictures.
 *
 * Hazards never move, so their cards are written once — on the first frame
 * their picture is ready — and never touched again; until then, and forever if
 * it never arrives, the kind's mesh stays up. Standing things face straight
 * back down the road at the rider approaching them, which on a straight is
 * exactly the camera and on a bend is close enough not to read as turned.
 * Oil and potholes are drawn from above, so they lie on the road instead.
 */

interface Pending {
  kind: HazardKind;
  picture: Picture;
  size: SpriteSize;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  done: boolean;
}

/** The sprite layer over a hazard field. */
export interface HazardSprites {
  group: THREE.Group;
  /** Swaps in any picture that has arrived since the last call. Cheap. */
  refresh: () => void;
  dispose: () => void;
}

/** Lifted off the tarmac so a lying picture does not fight the road surface. */
const DECAL_LIFT = 0.03;

/** Builds cards for every hazard whose kind has a picture in sprites.json. */
export function createHazardSprites(
  track: Track,
  kit: SpriteKit,
  meshes: ReadonlyMap<HazardKind, THREE.InstancedMesh>,
): HazardSprites {
  const group = new THREE.Group();
  const pending: Pending[] = [];

  for (const [kind, mesh] of meshes) {
    const path = kit.data.hazards[kind];
    const size = path === null ? undefined : kit.data.sizes[path];
    if (path === null || !size) continue;
    const material = createSpriteMaterial();
    material.color.copy(kit.light);
    const cards = new THREE.InstancedMesh(kit.card, material, mesh.count);
    cards.name = `hazard-sprite:${kind}`;
    cards.visible = false;
    group.add(cards);
    pending.push({
      kind,
      picture: kit.library.get(path),
      size,
      mesh: cards,
      material,
      done: false,
    });
  }

  const frame = createFrame();
  const ground = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const facing = createFacing();
  const metres = { w: 1, h: 1 };
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const stretch = new THREE.Vector3();

  const lying = (w: number, h: number): void => {
    // Picture x across the road, picture up pointing away down it.
    right.crossVectors(forward, up).normalize();
    matrix.makeBasis(right, forward, up);
    matrix.scale(stretch.set(w, h, 1));
  };

  const build = (entry: Pending): void => {
    const { picture } = entry;
    if (!picture.texture) return;
    useTexture(entry.material, picture.texture);
    metresFor(entry.size, picture.aspect, metres);
    let index = 0;
    for (const hazard of track.hazards) {
      if (hazard.kind !== entry.kind) continue;
      track.sample(hazard.s, frame, hazard.branchId);
      forward.set(frame.forward.x, frame.forward.y, frame.forward.z);
      up.set(frame.up.x, frame.up.y, frame.up.z);
      if (entry.size.lying) {
        lying(metres.w, metres.h);
        // Centred on the hazard: the quad's origin is its near edge.
        const back = -metres.h / 2;
        matrix.setPosition(
          frame.position.x +
            frame.right.x * hazard.t +
            forward.x * back +
            up.x * DECAL_LIFT,
          frame.position.y +
            frame.right.y * hazard.t +
            forward.y * back +
            up.y * DECAL_LIFT,
          frame.position.z +
            frame.right.z * hazard.t +
            forward.z * back +
            up.z * DECAL_LIFT,
        );
      } else {
        ground.set(
          frame.position.x + frame.right.x * hazard.t,
          frame.position.y + frame.right.y * hazard.t,
          frame.position.z + frame.right.z * hazard.t,
        );
        faceAlong(forward.x, forward.z, facing);
        composeCard(
          matrix,
          ground,
          facing,
          metres.w,
          metres.h,
          picture.anchor,
          false,
        );
      }
      entry.mesh.setMatrixAt(index, matrix);
      index += 1;
    }
    entry.mesh.instanceMatrix.needsUpdate = true;
    // The bounds were taken from identity matrices before the picture landed.
    entry.mesh.computeBoundingSphere();
    entry.mesh.visible = true;
    const old = meshes.get(entry.kind);
    if (old) old.visible = false;
  };

  return {
    group,
    refresh: () => {
      for (const entry of pending) {
        if (entry.done || entry.picture.status === 'loading') continue;
        entry.done = true;
        if (entry.picture.status === 'ready') build(entry);
      }
    },
    dispose: () => {
      for (const entry of pending) {
        entry.mesh.dispose();
        entry.material.dispose();
      }
    },
  };
}
