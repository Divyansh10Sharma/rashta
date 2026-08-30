import * as THREE from 'three';
import type { Track } from '../core/track/Track.ts';
import { createFrame } from '../core/track/path.ts';
import { TRAFFIC_SIZES } from '../core/sim/traffic.ts';
import { buildVehicle } from './meshes/vehicles.ts';
import type { TrafficKind, TrafficVehicle } from '../core/sim/types.ts';

/**
 * City traffic, drawn.
 *
 * Generic silhouettes in plausible livery colours — CLAUDE.md forbids any real
 * manufacturer's wordmark, model name, or reproduced livery, so these are
 * boxes of roughly the right proportions and nothing more.
 *
 * One instanced mesh per kind, each sized to the whole pool, because any slot
 * can be recycled into any kind. Plus two lamp pools: at night, whether a pair
 * of lights is coming at you or going away from you is the single most useful
 * thing on the road, so headlights and tail lights are drawn separately rather
 * than painted on.
 */

export interface TrafficView {
  group: THREE.Group;
  /** Total instances across every pool. */
  count: number;
  /**
   * Draws the pool, interpolating between the two most recent sim states.
   *
   * `previous` and `current` are the same pool at two ticks — index `i` is the
   * same vehicle in both, which is what makes recycling safe to interpolate
   * through: a slot that respawned this tick reads as active in one and not
   * the other, and is simply hidden.
   */
  update: (
    previous: readonly TrafficVehicle[],
    current: readonly TrafficVehicle[],
    alpha: number,
  ) => void;
  dispose: () => void;
}

const KINDS: TrafficKind[] = ['auto', 'car', 'bus', 'truck'];

/**
 * Livery colours per kind. Delhi at night: green-and-yellow autos, the green
 * of a city bus, and whatever the truck's owner could get.
 */
const PALETTE: Record<TrafficKind, number[]> = {
  auto: [0x1f5c34, 0x1b6b3a],
  car: [0xb9bcc4, 0x2b3a55, 0x7a2f2a, 0xd8d3c6, 0x36423b],
  bus: [0x2f6b46, 0x8a2f2b],
  truck: [0x2f4f7a, 0x8a5a1f, 0x6a2f4f],
};

/** How far a lamp sits from the vehicle's centre, as a fraction of length. */
const LAMP_ALONG = 0.46;

export function createTrafficView(track: Track, poolSize: number): TrafficView {
  const group = new THREE.Group();
  const frame = createFrame();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const colour = new THREE.Color();

  const paint = new THREE.MeshStandardMaterial({
    roughness: 0.62,
    metalness: 0.2,
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff2d0,
    emissive: 0xfff2d0,
    emissiveIntensity: 2.2,
  });
  const tailMaterial = new THREE.MeshStandardMaterial({
    color: 0xff3b24,
    emissive: 0xff2a12,
    emissiveIntensity: 1.8,
  });

  // Wheels, glass and grilles: one shared dark material, one instanced mesh per
  // kind riding along with the painted body at the same transform.
  const trim = new THREE.MeshStandardMaterial({
    color: 0x14161a,
    roughness: 0.45,
    metalness: 0.3,
  });

  const bodies = new Map<TrafficKind, THREE.InstancedMesh>();
  const trims = new Map<TrafficKind, THREE.InstancedMesh>();
  for (const kind of KINDS) {
    const shape = buildVehicle(kind);
    const dark = new THREE.InstancedMesh(shape.dark, trim, poolSize);
    dark.name = `traffic:${kind}:trim`;
    dark.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dark.frustumCulled = false;
    trims.set(kind, dark);
    group.add(dark);

    const mesh = new THREE.InstancedMesh(shape.body, paint, poolSize);
    mesh.name = `traffic:${kind}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    // Colour is per slot, not per tick: a bus that changes colour when it is
    // recycled is a bus that blinks.
    const palette = PALETTE[kind];
    for (let i = 0; i < poolSize; i += 1) {
      colour.setHex(palette[i % palette.length] ?? 0x888888);
      mesh.setColorAt(i, colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    bodies.set(kind, mesh);
    group.add(mesh);
  }

  const lampGeometry = new THREE.BoxGeometry(1.5, 0.22, 0.12);
  const heads = new THREE.InstancedMesh(lampGeometry, headMaterial, poolSize);
  const tails = new THREE.InstancedMesh(lampGeometry, tailMaterial, poolSize);
  heads.name = 'traffic:heads';
  tails.name = 'traffic:tails';
  for (const lamps of [heads, tails]) {
    lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    lamps.frustumCulled = false;
    group.add(lamps);
  }

  const hide = (mesh: THREE.InstancedMesh, index: number): void => {
    matrix.makeScale(0, 0, 0);
    mesh.setMatrixAt(index, matrix);
  };

  const update = (
    previous: readonly TrafficVehicle[],
    current: readonly TrafficVehicle[],
    alpha: number,
  ): void => {
    for (let i = 0; i < poolSize; i += 1) {
      const now = current[i];
      const before = previous[i];

      // A slot that respawned between these two ticks would interpolate
      // across the whole visible window, so it is simply not drawn until both
      // states agree it is somewhere.
      const drawable =
        now?.active === true &&
        before?.active === true &&
        now.pos.branchId === before.pos.branchId &&
        Math.abs(now.pos.s - before.pos.s) < 5;

      for (const kind of KINDS) {
        const spare = !drawable || now.kind !== kind;
        const mesh = bodies.get(kind);
        if (mesh && spare) hide(mesh, i);
        const dark = trims.get(kind);
        if (dark && spare) hide(dark, i);
      }
      if (!drawable) {
        hide(heads, i);
        hide(tails, i);
        continue;
      }

      const s = before.pos.s + (now.pos.s - before.pos.s) * alpha;
      const t = before.pos.t + (now.pos.t - before.pos.t) * alpha;
      track.sample(s, frame, now.pos.branchId);

      position.set(
        frame.position.x + frame.right.x * t,
        frame.position.y + frame.right.y * t,
        frame.position.z + frame.right.z * t,
      );
      SCRATCH_FORWARD.set(frame.forward.x, frame.forward.y, frame.forward.z);
      matrix.lookAt(ORIGIN, SCRATCH_FORWARD, WORLD_UP);
      quaternion.setFromRotationMatrix(matrix);
      if (now.oncoming) quaternion.multiply(FLIP);

      matrix.compose(position, quaternion, scale);
      const body = bodies.get(now.kind);
      if (body) body.setMatrixAt(i, matrix);
      const dark = trims.get(now.kind);
      if (dark) dark.setMatrixAt(i, matrix);

      // Lamps sit at the end of the vehicle that faces the rider: a vehicle
      // going your way shows you its tail lights, one coming at you its
      // headlights. Offsetting along the road rather than baking the offset
      // into the geometry keeps one lamp mesh for four kinds.
      const half = TRAFFIC_SIZES[now.kind].length * LAMP_ALONG;
      const reach = now.oncoming ? -half : half;
      position.set(
        position.x - frame.forward.x * reach,
        position.y - frame.forward.y * reach + 0.75,
        position.z - frame.forward.z * reach,
      );
      matrix.compose(position, quaternion, scale);
      (now.oncoming ? heads : tails).setMatrixAt(i, matrix);
      hide(now.oncoming ? tails : heads, i);
    }

    for (const mesh of bodies.values()) mesh.instanceMatrix.needsUpdate = true;
    for (const mesh of trims.values()) mesh.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    tails.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    count: poolSize * (KINDS.length * 2 + 2),
    update,
    dispose: () => {
      for (const mesh of [...bodies.values(), ...trims.values()]) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      heads.dispose();
      tails.dispose();
      lampGeometry.dispose();
      paint.dispose();
      trim.dispose();
      headMaterial.dispose();
      tailMaterial.dispose();
    },
  };
}

const ORIGIN = new THREE.Vector3(0, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const SCRATCH_FORWARD = new THREE.Vector3();
const FLIP = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI,
);
