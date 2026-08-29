import * as THREE from 'three';
import type { Track } from '../core/track/Track.ts';
import { createFrame } from '../core/track/path.ts';
import { ENVIRONMENTS } from './environments.ts';

/**
 * Roadside furniture: streetlights, poles, kerb stones.
 *
 * A pool, not a spawner. Every object that will ever be seen is allocated once
 * at startup and then recycled — as `s` advances, whatever has fallen behind
 * the rider is moved to the far end of the visible window rather than
 * destroyed and replaced. Nothing is allocated inside the frame loop.
 *
 * Instanced, so several hundred objects cost a handful of draw calls.
 */

export interface SceneryConfig {
  /** Metres between streetlights on one side. */
  lightSpacing: number;
  /** Metres between kerb stones. Equal to the stone length, so they abut. */
  kerbSpacing: number;
  /** Metres between roadside bollards. */
  bollardSpacing: number;
  /** How far ahead of the rider scenery is placed. */
  ahead: number;
  /** How far behind before it is recycled. */
  behind: number;
}

export const DEFAULT_SCENERY: SceneryConfig = {
  lightSpacing: 38,
  kerbSpacing: 4,
  bollardSpacing: 9,
  ahead: 460,
  behind: 60,
};

/**
 * Beyond this distance, small roadside objects are hidden.
 *
 * The crudest level of detail there is, and the right one here: a bollard at
 * 300 m is under a pixel, so the cheapest way to draw it well is not to. Masts
 * and lamp heads are exempt — a receding line of streetlights is most of what
 * sells the distance, and losing it is instantly visible.
 */
export const SMALL_OBJECT_LOD_METRES = 220;

/** Scenery tuned for a district: spacing and colours from the environment. */
export function sceneryFor(scenery: keyof typeof ENVIRONMENTS): SceneryConfig {
  const env = ENVIRONMENTS[scenery];
  return {
    lightSpacing: env.lightSpacing,
    kerbSpacing: 4,
    bollardSpacing: env.bollardSpacing,
    ahead: env.sceneryAhead,
    behind: 60,
  };
}

interface Pool {
  mesh: THREE.InstancedMesh;
  /** Hidden past `SMALL_OBJECT_LOD_METRES` — see the constant. */
  small: boolean;
  spacing: number;
  /**
   * The `s` distance one full cycle of this pool covers. Recycling shifts a
   * slot by whole windows, so this must be the span of *distinct positions* —
   * a two-sided pool has two instances per position, and using the instance
   * count here would shift everything twice as far as it should and leave
   * gaps in the road.
   */
  window: number;
  /** Track-space `s` of each instance, so recycling is a numeric decision. */
  slotS: Float64Array;
  side: Int8Array;
  lateral: number;
}

export interface SceneryField {
  group: THREE.Group;
  /** Total instances across every pool. */
  count: number;
  update: (s: number) => void;
  dispose: () => void;
}

function poleGeometry(): THREE.BufferGeometry {
  // A streetlight: a mast with a short arm. Merged into one geometry so the
  // whole thing is a single instanced draw.
  const mast = new THREE.CylinderGeometry(0.09, 0.13, 8, 6);
  mast.translate(0, 4, 0);
  return mast;
}

function lampGeometry(): THREE.BufferGeometry {
  const lamp = new THREE.BoxGeometry(1.5, 0.22, 0.5);
  lamp.translate(0.75, 7.9, 0);
  return lamp;
}

function kerbGeometry(): THREE.BufferGeometry {
  // Length matches `kerbSpacing`, so consecutive stones meet and read as one
  // continuous kerb that still follows the bend.
  return new THREE.BoxGeometry(0.32, 0.28, 4);
}

function bollardGeometry(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.08, 0.1, 0.9, 6);
  post.translate(0, 0.45, 0);
  return post;
}

/**
 * Builds the pools and returns a field that recycles itself as `s` advances.
 *
 * `capacity` is derived from the visible window and the spacing, so the pool
 * is exactly big enough and never grows.
 */
export function createScenery(
  track: Track,
  config: SceneryConfig = sceneryFor(track.data.scenery),
): SceneryField {
  const env = ENVIRONMENTS[track.data.scenery];
  const group = new THREE.Group();
  const frame = createFrame();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3();

  const span = config.ahead + config.behind;
  const pools: Pool[] = [];

  const addPool = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    spacing: number,
    lateral: number,
    bothSides: boolean,
    small = false,
  ): void => {
    const perSide = Math.ceil(span / spacing) + 1;
    const total = bothSides ? perSide * 2 : perSide;
    const mesh = new THREE.InstancedMesh(geometry, material, total);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    const slotS = new Float64Array(total);
    const side = new Int8Array(total);
    for (let i = 0; i < total; i += 1) {
      const index = bothSides ? Math.floor(i / 2) : i;
      side[i] = bothSides && i % 2 === 1 ? 1 : -1;
      slotS[i] = index * spacing;
    }

    group.add(mesh);
    pools.push({
      mesh,
      small,
      spacing,
      window: perSide * spacing,
      slotS,
      side,
      lateral,
    });
  };

  const mastMaterial = new THREE.MeshStandardMaterial({
    color: env.furniture,
    roughness: 0.85,
  });
  // Sodium vapour. The lamp heads are the only warm thing in the scene.
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: env.keyColour,
    emissive: env.keyColour,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  const kerbMaterial = new THREE.MeshStandardMaterial({
    color: env.kerb,
    roughness: 0.95,
  });
  const bollardMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8b0a0,
    roughness: 0.88,
  });

  addPool(poleGeometry(), mastMaterial, config.lightSpacing, 1.6, true);
  addPool(lampGeometry(), lampMaterial, config.lightSpacing, 1.6, true);
  addPool(kerbGeometry(), kerbMaterial, config.kerbSpacing, 0.4, true);
  addPool(
    bollardGeometry(),
    bollardMaterial,
    config.bollardSpacing,
    1.05,
    true,
  );

  let count = 0;
  for (const pool of pools) count += pool.mesh.count;

  const place = (
    pool: Pool,
    index: number,
    s: number,
    hidden = false,
  ): void => {
    if (hidden) {
      // Scaled to nothing rather than removed: the instance count stays fixed,
      // so this costs a matrix write and no allocation.
      matrix.makeScale(0, 0, 0);
      pool.mesh.setMatrixAt(index, matrix);
      return;
    }
    track.sample(s, frame);
    const edge = frame.halfWidth + frame.shoulder + pool.lateral;
    const offset = edge * (pool.side[index] ?? -1);

    position.set(
      frame.position.x + frame.right.x * offset,
      frame.position.y + frame.right.y * offset,
      frame.position.z + frame.right.z * offset,
    );
    forward.set(frame.forward.x, frame.forward.y, frame.forward.z);
    // Face the object along the road. A kerb stone that ignores the bend
    // reads as a fence of loose bricks.
    matrix.lookAt(ORIGIN, forward, up);
    quaternion.setFromRotationMatrix(matrix);
    // Lamps on the left arm out to the right, and vice versa.
    if ((pool.side[index] ?? -1) > 0) {
      quaternion.multiply(FLIP);
    }
    matrix.compose(position, quaternion, scale);
    pool.mesh.setMatrixAt(index, matrix);
  };

  const update = (s: number): void => {
    const lo = s - config.behind;
    for (const pool of pools) {
      const window = pool.window;
      for (let i = 0; i < pool.slotS.length; i += 1) {
        let slot = pool.slotS[i] ?? 0;
        // Recycle by shifting whole windows into the half-open interval
        // [lo, lo + window). Note the bound is the window, not `s + ahead`:
        // a pool carries one spare position beyond the visible span, so
        // testing against `ahead` leaves that slot with nowhere legal to sit
        // and it oscillates back out of view every frame.
        while (slot < lo) slot += window;
        while (slot >= lo + window) slot -= window;
        pool.slotS[i] = slot;
        place(pool, i, slot, pool.small && slot - s > SMALL_OBJECT_LOD_METRES);
      }
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  update(0);

  return {
    group,
    count,
    update,
    dispose: () => {
      for (const pool of pools) {
        pool.mesh.geometry.dispose();
        pool.mesh.dispose();
      }
      mastMaterial.dispose();
      lampMaterial.dispose();
      kerbMaterial.dispose();
      bollardMaterial.dispose();
    },
  };
}

const ORIGIN = new THREE.Vector3(0, 0, 0);
const FLIP = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI,
);
