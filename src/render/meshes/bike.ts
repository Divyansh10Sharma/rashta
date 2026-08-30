import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A motorcycle, built from its side profile.
 *
 * A bike is read from the side — tank, seat, tail, the line of the fairing —
 * so the shapes here are 2D profiles extruded across the machine's width
 * rather than boxes stacked into an approximation. It costs the same and it is
 * the difference between a silhouette and a suggestion.
 *
 * Everything is merged into one geometry per material, so a whole bike is
 * three draw calls rather than twenty, and the field can be instanced.
 *
 * All original: no manufacturer's shape, wordmark or livery. CLAUDE.md.
 */

/** Which class of machine to build. Matches `Bike['class']` in the data. */
export type BikeBuild = 'street' | 'sport' | 'super';

export interface BikeGeometry {
  /** Painted bodywork — takes the rider's livery colour. */
  body: THREE.BufferGeometry;
  /** Engine, frame, tyres, rider. Always dark. */
  dark: THREE.BufferGeometry;
  /** Pipes, forks, rims. */
  chrome: THREE.BufferGeometry;
  /** One wheel, centred on its axle, ready to be spun and instanced. */
  wheel: THREE.BufferGeometry;
  wheelRadius: number;
  wheelbase: number;
}

/** Side-profile control points per class, in metres, x forward and y up. */
interface Profile {
  wheelRadius: number;
  wheelbase: number;
  /** Tank-to-tail outline, front to back. */
  body: [number, number][];
  /** Front cowl outline. Empty for a naked bike. */
  fairing: [number, number][];
  bodyWidth: number;
  /** How far forward the rider is folded. Higher is more aggressive. */
  crouch: number;
}

const PROFILES: Record<BikeBuild, Profile> = {
  street: {
    wheelRadius: 0.31,
    wheelbase: 1.34,
    bodyWidth: 0.34,
    crouch: 0.18,
    body: [
      [-0.62, 0.52],
      [-0.36, 0.74],
      [0.02, 0.8],
      [0.3, 0.74],
      [0.58, 0.72],
      [0.66, 0.62],
      [0.34, 0.56],
      [-0.4, 0.44],
    ],
    fairing: [],
  },
  sport: {
    wheelRadius: 0.32,
    wheelbase: 1.4,
    bodyWidth: 0.36,
    crouch: 0.34,
    body: [
      [-0.7, 0.6],
      [-0.42, 0.82],
      [0.0, 0.86],
      [0.26, 0.78],
      [0.62, 0.82],
      [0.74, 0.7],
      [0.3, 0.58],
      [-0.46, 0.48],
    ],
    fairing: [
      [-0.86, 0.5],
      [-0.72, 0.86],
      [-0.5, 0.9],
      [-0.44, 0.56],
    ],
  },
  super: {
    wheelRadius: 0.33,
    wheelbase: 1.46,
    bodyWidth: 0.38,
    crouch: 0.46,
    body: [
      [-0.76, 0.62],
      [-0.46, 0.88],
      [0.0, 0.92],
      [0.24, 0.82],
      [0.68, 0.9],
      [0.82, 0.76],
      [0.32, 0.6],
      [-0.5, 0.5],
    ],
    fairing: [
      [-0.96, 0.48],
      [-0.84, 0.94],
      [-0.52, 0.98],
      [-0.44, 0.54],
    ],
  },
};

/** Extrudes a closed side profile across the bike, centred on its axis. */
function extrude(
  points: [number, number][],
  width: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const first = points[0];
  if (!first) throw new Error('bike profile has no points');
  shape.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point) shape.lineTo(point[0], point[1]);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.025,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // Extrusion runs along +z; the profile was drawn in the bike's x-y plane, so
  // rotate it upright and centre it across the machine.
  geometry.rotateY(Math.PI / 2);
  geometry.translate(-width / 2, 0, 0);
  return geometry;
}

function cylinder(
  radius: number,
  length: number,
  from: [number, number, number],
  rotation: [number, number, number],
  segments = 8,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments);
  geometry.rotateX(rotation[0]);
  geometry.rotateY(rotation[1]);
  geometry.rotateZ(rotation[2]);
  geometry.translate(from[0], from[1], from[2]);
  return geometry;
}

/** A tyre, its rim, and six spokes. Built lying in the bike's plane. */
function buildWheel(radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const tyre = new THREE.TorusGeometry(radius * 0.88, radius * 0.13, 6, 18);
  parts.push(tyre);

  const rim = new THREE.TorusGeometry(radius * 0.62, radius * 0.05, 4, 16);
  parts.push(rim);

  for (let i = 0; i < 6; i += 1) {
    const spoke = new THREE.BoxGeometry(radius * 0.05, radius * 1.24, 0.02);
    spoke.rotateZ((i * Math.PI) / 6);
    parts.push(spoke);
  }

  const hub = new THREE.CylinderGeometry(radius * 0.14, radius * 0.14, 0.1, 8);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);

  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('could not merge wheel');
  // A wheel is drawn in x-y and has to stand up across the bike.
  merged.rotateY(Math.PI / 2);
  return merged;
}

/** The rider: folded further forward the more serious the machine. */
function buildRider(profile: Profile): THREE.BufferGeometry {
  const { crouch } = profile;
  const parts: THREE.BufferGeometry[] = [];

  const torso = new THREE.CapsuleGeometry(0.17, 0.42, 3, 8);
  torso.rotateX(0.5 + crouch);
  torso.translate(0, 1.1 - crouch * 0.24, 0.06 + crouch * 0.1);
  parts.push(torso);

  const head = new THREE.SphereGeometry(0.155, 10, 8);
  head.translate(0, 1.4 - crouch * 0.4, -0.16 - crouch * 0.3);
  parts.push(head);

  // Arms reaching to the bars, and legs folded onto the pegs. Two thin
  // cylinders each: enough to read as a person at speed, and no more.
  for (const side of [-1, 1]) {
    parts.push(
      cylinder(
        0.055,
        0.52,
        [side * 0.17, 1.06 - crouch * 0.22, -0.3 - crouch * 0.16],
        [1.15 - crouch * 0.4, 0, 0],
      ),
    );
    parts.push(cylinder(0.075, 0.46, [side * 0.15, 0.66, 0.3], [0.9, 0, 0]));
  }

  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('could not merge rider');
  return merged;
}

/** Builds every geometry a bike of this class needs, merged by material. */
export function buildBike(build: BikeBuild): BikeGeometry {
  const profile = PROFILES[build];
  const { wheelRadius, wheelbase, bodyWidth } = profile;

  const bodyParts = [extrude(profile.body, bodyWidth)];
  if (profile.fairing.length > 0) {
    bodyParts.push(extrude(profile.fairing, bodyWidth * 0.92));
  }
  const body = mergeGeometries(bodyParts, false);

  const darkParts = [
    // Engine block, slung under the tank and the heaviest thing on the bike.
    (() => {
      const block = new THREE.BoxGeometry(bodyWidth * 0.86, 0.3, 0.46);
      block.translate(0, 0.44, 0.02);
      return block;
    })(),
    buildRider(profile),
  ];
  const dark = mergeGeometries(darkParts, false);

  const forkAngle = 0.42;
  const chromeParts = [
    ...[-1, 1].map((side) =>
      cylinder(
        0.032,
        0.66,
        [side * 0.11, 0.58, -wheelbase / 2 - 0.06],
        [forkAngle, 0, 0],
      ),
    ),
    cylinder(0.022, 0.5, [0, 0.9, -wheelbase / 2 + 0.12], [0, 0, Math.PI / 2]),
    cylinder(0.045, 0.62, [0.13, 0.42, 0.42], [0.1, 0, 0]),
  ];
  const chrome = mergeGeometries(chromeParts, false);

  if (!body || !dark || !chrome) throw new Error('could not merge bike');
  return {
    body,
    dark,
    chrome,
    wheel: buildWheel(wheelRadius),
    wheelRadius,
    wheelbase,
  };
}
