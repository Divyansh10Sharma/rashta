import * as THREE from 'three';
import type { Track } from '../core/track/Track.ts';
import { buildBike, type BikeBuild } from './meshes/bike.ts';
import { createFrame } from '../core/track/path.ts';

/**
 * The player's bike and rider.
 *
 * A low-poly silhouette in a plain livery colour — CLAUDE.md forbids any real
 * manufacturer's wordmark or livery, so this is a shape, not a model of
 * anything. Rivals in Phase 5 share this geometry with a per-instance colour.
 *
 * This is the one place track space becomes world space:
 *   world = sample(s).position + right * t
 */

export interface RiderView {
  group: THREE.Group;
  update: (
    track: Track,
    s: number,
    t: number,
    lean: number,
    wheelAngle: number,
    branchId: number,
  ) => void;
  /**
   * Lights the rider up while they are swinging, 0 to 1.
   *
   * Combat has to be legible from behind at night: who is winding up, and who
   * just took it. Nothing else about a rider changes shape when they attack,
   * so the glow is doing all the work.
   */
  highlight: (amount: number, hostile: boolean) => void;
  dispose: () => void;
}

export function createRiderView(
  colour = 0xc4402c,
  build: BikeBuild = 'street',
): RiderView {
  const group = new THREE.Group();
  // `lean` rotates this inner node about the direction of travel, so the whole
  // bike banks without disturbing its position on the road.
  const banked = new THREE.Group();
  group.add(banked);

  // Three merged geometries instead of six primitives: the whole machine is
  // three draw calls, and the shapes come from an extruded side profile rather
  // than a stack of boxes. See meshes/bike.ts.
  const shape = buildBike(build);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.42,
    metalness: 0.35,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x1b1b20,
    roughness: 0.85,
  });
  const chromeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9aa0a8,
    roughness: 0.28,
    metalness: 0.85,
  });

  const body = new THREE.Mesh(shape.body, bodyMaterial);
  banked.add(body);
  const dark = new THREE.Mesh(shape.dark, darkMaterial);
  banked.add(dark);
  const chrome = new THREE.Mesh(shape.chrome, chromeMaterial);
  banked.add(chrome);

  const front = new THREE.Mesh(shape.wheel, darkMaterial);
  front.position.set(0, shape.wheelRadius, -shape.wheelbase / 2);
  banked.add(front);

  const rear = new THREE.Mesh(shape.wheel, darkMaterial);
  rear.position.set(0, shape.wheelRadius, shape.wheelbase / 2);
  banked.add(rear);

  // Scratch — this runs every frame.
  const frame = createFrame();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const origin = new THREE.Vector3();

  const update = (
    track: Track,
    s: number,
    t: number,
    lean: number,
    wheelAngle: number,
    branchId: number,
  ): void => {
    track.sample(s, frame, branchId);

    group.position.set(
      frame.position.x + frame.right.x * t,
      frame.position.y + frame.right.y * t,
      frame.position.z + frame.right.z * t,
    );

    forward.set(frame.forward.x, frame.forward.y, frame.forward.z);
    up.set(frame.up.x, frame.up.y, frame.up.z);
    matrix.lookAt(origin, forward, up);
    group.quaternion.setFromRotationMatrix(matrix);

    banked.rotation.z = -lean;
    front.rotation.x = wheelAngle;
    rear.rotation.x = wheelAngle;
  };

  const glowColour = new THREE.Color();
  let lastGlow = -1;
  const highlight = (amount: number, hostile: boolean): void => {
    const clamped = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    const key = clamped * (hostile ? -1 : 1);
    if (key === lastGlow) return;
    lastGlow = key;
    // Warm for a rider winding up, cold-white for one that has just been hit.
    glowColour.setHex(hostile ? 0xfff0e0 : 0xff7a2a);
    bodyMaterial.emissive.copy(glowColour);
    bodyMaterial.emissiveIntensity = clamped * 1.8;
  };

  return {
    group,
    update,
    highlight,
    dispose: () => {
      shape.body.dispose();
      shape.dark.dispose();
      shape.chrome.dispose();
      shape.wheel.dispose();
      bodyMaterial.dispose();
      darkMaterial.dispose();
      chromeMaterial.dispose();
    },
  };
}
