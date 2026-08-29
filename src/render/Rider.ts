import * as THREE from 'three';
import type { Track } from '../core/track/Track.ts';
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

const WHEEL_RADIUS = 0.31;
const WHEELBASE = 1.34;

export function createRiderView(colour = 0xc4402c): RiderView {
  const group = new THREE.Group();
  // `lean` rotates this inner node about the direction of travel, so the whole
  // bike banks without disturbing its position on the road.
  const banked = new THREE.Group();
  group.add(banked);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.55,
    metalness: 0.25,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x1b1b20,
    roughness: 0.8,
  });
  const riderMaterial = new THREE.MeshStandardMaterial({
    color: 0x2e3340,
    roughness: 0.9,
  });

  const tank = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.34, 1.15),
    bodyMaterial,
  );
  tank.position.set(0, 0.72, 0);
  banked.add(tank);

  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.3, 0.5),
    bodyMaterial,
  );
  nose.position.set(0, 0.66, -0.78);
  banked.add(nose);

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 0.5, 4, 8),
    riderMaterial,
  );
  torso.position.set(0, 1.16, 0.16);
  torso.rotation.x = 0.42;
  banked.add(torso);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 12, 10),
    darkMaterial,
  );
  helmet.position.set(0, 1.5, -0.06);
  banked.add(helmet);

  const wheelGeometry = new THREE.CylinderGeometry(
    WHEEL_RADIUS,
    WHEEL_RADIUS,
    0.14,
    14,
  );
  wheelGeometry.rotateZ(Math.PI / 2);

  const front = new THREE.Mesh(wheelGeometry, darkMaterial);
  front.position.set(0, WHEEL_RADIUS, -WHEELBASE / 2);
  banked.add(front);

  const rear = new THREE.Mesh(wheelGeometry, darkMaterial);
  rear.position.set(0, WHEEL_RADIUS, WHEELBASE / 2);
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
      tank.geometry.dispose();
      nose.geometry.dispose();
      torso.geometry.dispose();
      helmet.geometry.dispose();
      wheelGeometry.dispose();
      bodyMaterial.dispose();
      darkMaterial.dispose();
      riderMaterial.dispose();
    },
  };
}
