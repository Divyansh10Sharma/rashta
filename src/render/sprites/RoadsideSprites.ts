import * as THREE from 'three';
import type { Track } from '../../core/track/Track.ts';
import { createFrame } from '../../core/track/path.ts';
import { wrapSlot } from '../pool.ts';
import { composeCard, createSpriteMaterial, useTexture } from './Billboard.ts';
import { metresFor, type SpriteSize } from './data.ts';
import type { Picture } from './library.ts';
import type { SpriteKit } from './kit.ts';

/**
 * The place's streetlights and roadside things, as pictures.
 *
 * Recycled exactly like the scenery meshes — a fixed set of slots, each shifted
 * by whole windows as the rider moves on — and on the same spacing, so the
 * streetlight pictures stand where the generated masts did and replace them
 * the moment the picture is in. Props (hydrants, palms, pines) are new and
 * have no mesh to replace, so a missing one is simply not drawn.
 */

/** The spacing and reach `Scenery` uses, so the two agree on where lamps go. */
export interface RoadsideConfig {
  lightSpacing: number;
  ahead: number;
  behind: number;
}

/** Roadside pictures, recycled as `s` advances. */
export interface RoadsideSprites {
  group: THREE.Group;
  update: (s: number) => void;
  dispose: () => void;
}

interface Batch {
  picture: Picture;
  size: SpriteSize;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  used: number;
}

interface Row {
  /** Metres beyond the edge of the shoulder. */
  setback: number;
  window: number;
  slotS: Float64Array;
  /** Which batch each slot draws, fixed for good so nothing changes on recycle. */
  slotBatch: Batch[];
  /** The lamp picture's arm points left; left-side lamps flip to reach the road. */
  mirrorLeft: boolean;
}

/** Where the masts stand in `Scenery`, beyond the shoulder. */
const LAMP_SETBACK = 1.6;
/** Far enough out that a palm's fronds do not hang over the kerb. */
const PROP_SETBACK = 4.5;

/** Builds the lamp row and the prop row for this place, where it has them. */
export function createRoadsideSprites(
  track: Track,
  kit: SpriteKit,
  config: RoadsideConfig,
  streetlights: readonly THREE.Object3D[],
): RoadsideSprites {
  const group = new THREE.Group();
  const span = config.ahead + config.behind;
  const batches = new Map<string, Batch>();
  // The same batches as a list, for the frame loop: no iterator per frame.
  const all: Batch[] = [];
  const rows: Row[] = [];

  const batchFor = (path: string, capacity: number): Batch => {
    const known = batches.get(path);
    if (known) return known;
    const size = kit.data.sizes[path];
    if (!size) throw new Error(`sprites.json: sizes.${path} is missing`);
    const material = createSpriteMaterial();
    material.color.copy(kit.light);
    const mesh = new THREE.InstancedMesh(kit.card, material, capacity);
    mesh.name = `roadside-sprite:${path}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    const batch = {
      picture: kit.library.get(path),
      size,
      mesh,
      material,
      used: 0,
    };
    batches.set(path, batch);
    all.push(batch);
    return batch;
  };

  const addRow = (
    paths: readonly string[],
    spacing: number,
    setback: number,
    offset: number,
    mirrorLeft: boolean,
  ): void => {
    const perSide = Math.ceil(span / spacing) + 1;
    const total = perSide * 2;
    const slotS = new Float64Array(total);
    const slotBatch: Batch[] = [];
    for (let i = 0; i < total; i += 1) {
      slotS[i] = Math.floor(i / 2) * spacing + offset;
      const path = paths[i % paths.length] ?? paths[0] ?? '';
      slotBatch.push(batchFor(path, total));
    }
    rows.push({
      setback,
      window: perSide * spacing,
      slotS,
      slotBatch,
      mirrorLeft,
    });
  };

  const { lamp, props, propSpacing } = kit.place;
  if (lamp !== null) addRow([lamp], config.lightSpacing, LAMP_SETBACK, 0, true);
  // Half a spacing out of step, so a palm never grows out of a lamp post.
  if (props.length > 0) {
    addRow(props, propSpacing, PROP_SETBACK, propSpacing / 2, false);
  }
  const lampBatch = lamp === null ? null : (batches.get(lamp) ?? null);

  const frame = createFrame();
  const ground = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const metres = { w: 1, h: 1 };

  const place = (row: Row, index: number, slot: number): void => {
    const batch = row.slotBatch[index];
    const picture = batch?.picture;
    if (!batch || !picture?.texture || picture.status !== 'ready') return;
    track.sample(slot, frame);
    // Even slots on the left, odd on the right, as in `Scenery`.
    const side = index % 2 === 1 ? 1 : -1;
    const offset = (frame.halfWidth + frame.shoulder + row.setback) * side;
    ground.set(
      frame.position.x + frame.right.x * offset,
      frame.position.y + frame.right.y * offset,
      frame.position.z + frame.right.z * offset,
    );
    useTexture(batch.material, picture.texture);
    metresFor(batch.size, picture.aspect, metres);
    const mirror = row.mirrorLeft && side < 0;
    composeCard(
      matrix,
      ground,
      kit.facing,
      metres.w,
      metres.h,
      picture.anchor,
      mirror,
    );
    batch.mesh.setMatrixAt(batch.used, matrix);
    batch.used += 1;
  };

  const update = (s: number): void => {
    for (const batch of all) batch.used = 0;
    const lo = s - config.behind;
    for (const row of rows) {
      for (let i = 0; i < row.slotS.length; i += 1) {
        const slot = wrapSlot(row.slotS[i] ?? 0, lo, row.window);
        row.slotS[i] = slot;
        place(row, i, slot);
      }
    }
    for (const batch of all) {
      batch.mesh.count = batch.used;
      batch.mesh.visible = batch.used > 0;
      if (batch.used > 0) batch.mesh.instanceMatrix.needsUpdate = true;
    }
    const pictured = lampBatch?.picture.status === 'ready';
    for (const mesh of streetlights) mesh.visible = !pictured;
  };

  return {
    group,
    update,
    dispose: () => {
      for (const batch of batches.values()) {
        batch.mesh.dispose();
        batch.material.dispose();
      }
    },
  };
}
