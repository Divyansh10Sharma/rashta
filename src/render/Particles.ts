import * as THREE from 'three';
import { puffTexture, texturesSupported } from './meshes/textures.ts';

/**
 * Sparks, smoke and dust.
 *
 * One fixed pool of camera-facing quads, drawn as a single instanced mesh, so
 * the whole effects layer is one draw call however much is happening. Nothing
 * is allocated after construction: emitting reuses a dead slot, and a pool
 * that is full simply drops the request, because a missing spark is invisible
 * and a stutter is not.
 *
 * This is render-only. The simulation has no idea it exists and must not: a
 * particle that fed back into `step()` would break determinism.
 */

export type PuffKind = 'spark' | 'smoke' | 'dust';

interface Look {
  colour: number;
  /** Metres per second, before the per-particle spread. */
  speed: number;
  /** Seconds a particle lives. */
  life: number;
  /** Starting size in metres, and how much it grows over its life. */
  size: number;
  growth: number;
  /** Metres per second squared. Sparks fall, smoke rises. */
  gravity: number;
}

const LOOKS: Record<PuffKind, Look> = {
  spark: {
    colour: 0xffb45a,
    speed: 7.5,
    life: 0.5,
    size: 0.1,
    growth: -0.06,
    gravity: -14,
  },
  smoke: {
    colour: 0x6d6a66,
    speed: 1.6,
    life: 1.5,
    size: 0.34,
    growth: 1.5,
    gravity: 1.2,
  },
  dust: {
    colour: 0xa08b62,
    speed: 2.4,
    life: 1.1,
    size: 0.3,
    growth: 1.1,
    gravity: 0.4,
  },
};

export interface ParticleField {
  points: THREE.Object3D;
  /** How many slots are alive right now. Diagnostic. */
  readonly live: number;
  /** Throws `count` particles from a world position. */
  emit: (
    kind: PuffKind,
    x: number,
    y: number,
    z: number,
    count: number,
  ) => void;
  /** Ages every particle. `dt` is real seconds, not simulation ticks. */
  update: (dt: number, camera: THREE.Camera) => void;
  dispose: () => void;
}

/** Deterministic enough for sparks, and it never touches the sim's RNG. */
function spread(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2147483648 - 1;
  };
}

export function createParticles(capacity = 240): ParticleField {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    ...(texturesSupported() ? { map: puffTexture() } : null),
  });

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = capacity;

  // Parallel arrays rather than an array of objects: this is the only part of
  // the renderer that touches every element every frame.
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  const vx = new Float32Array(capacity);
  const vy = new Float32Array(capacity);
  const vz = new Float32Array(capacity);
  const age = new Float32Array(capacity);
  const span = new Float32Array(capacity);
  const size = new Float32Array(capacity);
  const grow = new Float32Array(capacity);
  const fall = new Float32Array(capacity);
  const alive = new Uint8Array(capacity);

  const colour = new THREE.Color();
  for (let i = 0; i < capacity; i += 1) mesh.setColorAt(i, colour);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const random = spread(0x9e3779b9);
  let live = 0;
  let cursor = 0;

  const hide = (i: number): void => {
    matrix.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, matrix);
  };
  for (let i = 0; i < capacity; i += 1) hide(i);

  const emit = (
    kind: PuffKind,
    x: number,
    y: number,
    z: number,
    count: number,
  ): void => {
    const look = LOOKS[kind];
    colour.setHex(look.colour);
    for (let n = 0; n < count; n += 1) {
      // One pass round the pool looking for a dead slot. A full pool drops the
      // request rather than stealing a live particle mid-flight.
      let slot = -1;
      for (let probe = 0; probe < capacity; probe += 1) {
        const i = (cursor + probe) % capacity;
        if (alive[i] === 0) {
          slot = i;
          cursor = (i + 1) % capacity;
          break;
        }
      }
      if (slot < 0) return;

      px[slot] = x;
      py[slot] = y;
      pz[slot] = z;
      vx[slot] = random() * look.speed;
      vy[slot] = Math.abs(random()) * look.speed * 0.8 + 0.4;
      vz[slot] = random() * look.speed;
      age[slot] = 0;
      span[slot] = look.life * (0.7 + Math.abs(random()) * 0.6);
      size[slot] = look.size;
      grow[slot] = look.growth;
      fall[slot] = look.gravity;
      alive[slot] = 1;
      mesh.setColorAt(slot, colour);
      live += 1;
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const update = (dt: number, camera: THREE.Camera): void => {
    // Every quad faces the camera, which is what stops a flat plane reading as
    // a flat plane the moment you ride past it.
    quaternion.copy(camera.quaternion);

    for (let i = 0; i < capacity; i += 1) {
      if (alive[i] === 0) continue;
      const next = (age[i] ?? 0) + dt;
      if (next >= (span[i] ?? 0)) {
        alive[i] = 0;
        live -= 1;
        hide(i);
        continue;
      }
      age[i] = next;

      vy[i] = (vy[i] ?? 0) + (fall[i] ?? 0) * dt;
      px[i] = (px[i] ?? 0) + (vx[i] ?? 0) * dt;
      py[i] = (py[i] ?? 0) + (vy[i] ?? 0) * dt;
      pz[i] = (pz[i] ?? 0) + (vz[i] ?? 0) * dt;

      const t = next / (span[i] ?? 1);
      const s = Math.max(0.01, (size[i] ?? 0) + (grow[i] ?? 0) * t);
      position.set(px[i] ?? 0, py[i] ?? 0, pz[i] ?? 0);
      // Fading by shrinking rather than by opacity: one shared material means
      // per-particle opacity would need a shader, and this reads the same.
      scale.setScalar(s * (1 - t * 0.65));
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    points: mesh,
    get live() {
      return live;
    },
    emit,
    update,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
