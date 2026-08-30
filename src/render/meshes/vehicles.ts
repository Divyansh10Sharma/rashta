import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRAFFIC_SIZES } from '../../core/sim/traffic.ts';
import type { TrafficKind } from '../../core/sim/types.ts';

/**
 * City traffic, built to be recognised by outline.
 *
 * At speed under sodium light you do not read a texture, you read a shape: an
 * auto's canopy and single front wheel, a bus's height and window band, a
 * truck's cab-and-bed step. So each vehicle is a side profile extruded across
 * its width, with the details that change the silhouette and nothing else.
 *
 * Sizes come from `TRAFFIC_SIZES` so the drawn vehicle is the one the
 * simulation collides with. Generic silhouettes in plausible livery colours —
 * no manufacturer's shape, wordmark or reproduced livery. CLAUDE.md.
 */

export interface VehicleGeometry {
  /** Painted bodywork, coloured per slot. */
  body: THREE.BufferGeometry;
  /** Glass, wheels, grilles, and everything that is never body colour. */
  dark: THREE.BufferGeometry;
}

/** Extrudes a side profile across `width`, centred, sitting on the road. */
function profile(
  points: [number, number][],
  width: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const first = points[0];
  if (!first) throw new Error('vehicle profile has no points');
  shape.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point) shape.lineTo(point[0], point[1]);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 1,
    curveSegments: 3,
  });
  // Profiles are drawn with x along the vehicle and y up; the extrusion runs
  // across it.
  geometry.rotateY(Math.PI / 2);
  geometry.translate(-width / 2, 0, 0);
  return geometry;
}

/** A tyre standing upright at a position along the vehicle. */
function wheel(radius: number, x: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    radius * 0.55,
    10,
  );
  geometry.rotateZ(Math.PI / 2);
  geometry.translate(x, radius, z);
  return geometry;
}

/** A band of glass wrapped around the sides of a box-shaped body. */
function windowBand(
  length: number,
  width: number,
  y: number,
  height: number,
): THREE.BufferGeometry[] {
  return [-1, 1].map((side) => {
    const glass = new THREE.BoxGeometry(0.02, height, length);
    glass.translate((side * width) / 2, y, 0);
    return glass;
  });
}

function buildCar(): VehicleGeometry {
  const { length, width } = TRAFFIC_SIZES.car;
  const half = length / 2;
  const body = profile(
    [
      [-half, 0.32],
      [-half + 0.1, 0.72],
      [-half + 0.95, 0.86],
      [-0.35, 1.36],
      [0.5, 1.38],
      [half - 0.75, 0.88],
      [half - 0.08, 0.74],
      [half, 0.34],
    ],
    width,
  );
  const dark = mergeGeometries(
    [
      wheel(0.32, -width / 2 + 0.1, -half + 0.9),
      wheel(0.32, width / 2 - 0.1, -half + 0.9),
      wheel(0.32, -width / 2 + 0.1, half - 0.9),
      wheel(0.32, width / 2 - 0.1, half - 0.9),
      ...windowBand(1.9, width - 0.05, 1.12, 0.42),
    ],
    false,
  );
  if (!dark) throw new Error('could not merge car');
  return { body, dark };
}

/**
 * An auto: three wheels, a canopy, and a shape nobody mistakes for anything
 * else. The single front wheel is the whole silhouette.
 */
function buildAuto(): VehicleGeometry {
  const { length, width } = TRAFFIC_SIZES.auto;
  const half = length / 2;
  const body = profile(
    [
      [-half, 0.36],
      [-half + 0.06, 0.94],
      [-half + 0.5, 1.62],
      [half - 0.3, 1.66],
      [half, 1.2],
      [half, 0.4],
      [half - 0.5, 0.3],
      [-half + 0.4, 0.3],
    ],
    width,
  );
  const dark = mergeGeometries(
    [
      wheel(0.26, 0, -half + 0.18),
      wheel(0.26, -width / 2 + 0.08, half - 0.4),
      wheel(0.26, width / 2 - 0.08, half - 0.4),
      ...windowBand(1.3, width - 0.04, 1.24, 0.5),
    ],
    false,
  );
  if (!dark) throw new Error('could not merge auto');
  return { body, dark };
}

/** A city bus: tall, flat-fronted, a long window band and a roof rack. */
function buildBus(): VehicleGeometry {
  const { length, width } = TRAFFIC_SIZES.bus;
  const half = length / 2;
  const body = profile(
    [
      [-half, 0.5],
      [-half, 3.05],
      [half, 3.05],
      [half, 0.5],
      [half - 0.4, 0.42],
      [-half + 0.4, 0.42],
    ],
    width,
  );
  const rack = new THREE.BoxGeometry(width * 0.8, 0.12, length * 0.55);
  rack.translate(0, 3.16, 0.6);

  const dark = mergeGeometries(
    [
      wheel(0.5, -width / 2 + 0.12, -half + 1.3),
      wheel(0.5, width / 2 - 0.12, -half + 1.3),
      wheel(0.5, -width / 2 + 0.12, half - 1.6),
      wheel(0.5, width / 2 - 0.12, half - 1.6),
      ...windowBand(length - 1.4, width - 0.04, 2.16, 0.86),
      rack,
    ],
    false,
  );
  if (!dark) throw new Error('could not merge bus');
  return { body, dark };
}

/** A truck: a tall cab and a lower bed, which is the step you read it by. */
function buildTruck(): VehicleGeometry {
  const { length, width } = TRAFFIC_SIZES.truck;
  const half = length / 2;
  const body = profile(
    [
      [-half, 0.55],
      [-half, 2.85],
      [-half + 2.0, 2.85],
      [-half + 2.0, 2.15],
      [half, 2.15],
      [half, 0.55],
      [half - 0.4, 0.46],
      [-half + 0.4, 0.46],
    ],
    width,
  );
  const dark = mergeGeometries(
    [
      wheel(0.46, -width / 2 + 0.1, -half + 1.1),
      wheel(0.46, width / 2 - 0.1, -half + 1.1),
      wheel(0.46, -width / 2 + 0.1, half - 1.2),
      wheel(0.46, width / 2 - 0.1, half - 1.2),
      ...windowBand(1.5, width - 0.04, 2.42, 0.5),
    ],
    false,
  );
  if (!dark) throw new Error('could not merge truck');
  return { body, dark };
}

const BUILDERS: Record<TrafficKind, () => VehicleGeometry> = {
  car: buildCar,
  auto: buildAuto,
  bus: buildBus,
  truck: buildTruck,
};

/** Builds the geometry for one kind of traffic, merged by material. */
export function buildVehicle(kind: TrafficKind): VehicleGeometry {
  return BUILDERS[kind]();
}
