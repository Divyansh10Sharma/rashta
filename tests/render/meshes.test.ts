import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBike } from '../../src/render/meshes/bike.ts';
import { buildVehicle } from '../../src/render/meshes/vehicles.ts';
import { texturesSupported } from '../../src/render/meshes/textures.ts';
import { flatten, parseManifest } from '../../src/render/assets.ts';
import { createParticles } from '../../src/render/Particles.ts';
import { TRAFFIC_SIZES } from '../../src/core/sim/traffic.ts';
import type { BikeBuild } from '../../src/render/meshes/bike.ts';
import type { TrafficKind } from '../../src/core/sim/types.ts';

/**
 * The art pass, checked without a screen.
 *
 * What can be proved headlessly is that the shapes are the right size, that
 * they differ from each other, and that nothing leaks. What they look like is
 * a human's job.
 */

const BUILDS: BikeBuild[] = ['street', 'sport', 'super'];
const KINDS: TrafficKind[] = ['car', 'auto', 'bus', 'truck'];

function extent(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('no bounding box');
  return box.getSize(new THREE.Vector3());
}

describe('bikes are built, not stacked', () => {
  it('produces geometry for every class', () => {
    for (const build of BUILDS) {
      const bike = buildBike(build);
      for (const part of [bike.body, bike.dark, bike.chrome, bike.wheel]) {
        expect(part.getAttribute('position').count).toBeGreaterThan(0);
      }
      expect(bike.wheelRadius).toBeGreaterThan(0.2);
      expect(bike.wheelbase).toBeGreaterThan(1);
    }
  });

  it('gives each class a different silhouette', () => {
    // Three classes that measure the same are one class drawn three times.
    const sizes = BUILDS.map((build) => {
      const size = extent(buildBike(build).body);
      return `${size.y.toFixed(2)}x${size.z.toFixed(2)}`;
    });
    expect(new Set(sizes).size).toBe(3);
  });

  it('makes the faster machines longer and lower-slung', () => {
    const street = buildBike('street');
    const fast = buildBike('super');
    expect(fast.wheelbase).toBeGreaterThan(street.wheelbase);
    expect(fast.wheelRadius).toBeGreaterThan(street.wheelRadius);
  });

  it('keeps a bike roughly bike-sized', () => {
    for (const build of BUILDS) {
      const bike = buildBike(build);
      const size = extent(bike.body);
      // Across the machine: a motorcycle is narrow, and that is most of why it
      // can do what it does in traffic.
      expect(size.x).toBeLessThan(0.6);
      expect(size.z).toBeLessThan(2.2);
    }
  });

  it('builds a wheel that stands up across the bike', () => {
    const size = extent(buildBike('sport').wheel);
    // Thin across, round in the other two: if x were the largest, the wheel
    // would be lying flat on the road like a dinner plate.
    expect(size.x).toBeLessThan(size.y);
    expect(size.x).toBeLessThan(size.z);
    expect(size.y).toBeCloseTo(size.z, 1);
  });
});

describe('traffic is recognisable by outline', () => {
  it('draws every kind at the size the simulation collides with', () => {
    for (const kind of KINDS) {
      const size = extent(buildVehicle(kind).body);
      const spec = TRAFFIC_SIZES[kind];
      // The drawn vehicle has to be the one the sim thinks is there, or you
      // get hit by something you rode past. Bevels add a few centimetres.
      expect(size.z).toBeGreaterThan(spec.length - 0.4);
      expect(size.z).toBeLessThan(spec.length + 0.4);
      expect(size.x).toBeGreaterThan(spec.width - 0.4);
      expect(size.x).toBeLessThan(spec.width + 0.4);
    }
  });

  it('makes a bus tall and a car low', () => {
    const bus = extent(buildVehicle('bus').body);
    const car = extent(buildVehicle('car').body);
    const auto = extent(buildVehicle('auto').body);
    expect(bus.y).toBeGreaterThan(car.y * 1.8);
    // An auto is taller than a car and much shorter — the whole silhouette.
    expect(auto.y).toBeGreaterThan(car.y);
    expect(auto.z).toBeLessThan(car.z);
  });

  it('gives every kind wheels and glass', () => {
    for (const kind of KINDS) {
      const dark = buildVehicle(kind).dark;
      expect(dark.getAttribute('position').count).toBeGreaterThan(0);
    }
  });
});

describe('textures degrade rather than crash', () => {
  it('reports that it cannot draw without a DOM', () => {
    // The suite runs in Node. Every caller has to cope with getting nothing,
    // and a material with no map is the flat colour this project had before.
    expect(texturesSupported()).toBe(false);
  });
});

describe('the model manifest', () => {
  it('accepts an empty manifest, which is what ships', () => {
    expect(parseManifest('models.json', {})).toEqual({});
  });

  it('accepts a known slot', () => {
    expect(
      parseManifest('models.json', { 'bike:sport': '/models/sport.glb' }),
    ).toEqual({ 'bike:sport': '/models/sport.glb' });
  });

  it('rejects a slot name nobody will ever notice is wrong', () => {
    expect(() =>
      parseManifest('models.json', { 'bike:racer': '/x.glb' }),
    ).toThrow(/"bike:racer" is not a model slot/);
  });

  it('rejects an empty path', () => {
    expect(() => parseManifest('models.json', { 'traffic:bus': '' })).toThrow(
      /must be a non-empty file path/,
    );
  });

  it('rejects a file that is not an object', () => {
    expect(() => parseManifest('models.json', null)).toThrow(
      /must be a JSON object/,
    );
  });
});

describe('flattening a loaded model', () => {
  it('bakes each mesh transform and merges the tree into one geometry', () => {
    const scene = new THREE.Group();
    const a = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    b.position.set(4, 0, 0);
    scene.add(a, b);

    const flat = flatten(scene);
    if (!flat) throw new Error('nothing flattened');
    // Four metres apart plus half a box each way: the transform was baked in
    // rather than dropped, which is the whole job.
    expect(extent(flat.geometry).x).toBeCloseTo(5, 5);
    expect(flat.materials.length).toBe(2);
  });

  it('returns nothing for a scene with no meshes, rather than throwing', () => {
    expect(flatten(new THREE.Group())).toBeNull();
  });
});

describe('the particle pool', () => {
  it('starts empty and stays inside its capacity', () => {
    const field = createParticles(8);
    expect(field.live).toBe(0);
    field.emit('spark', 0, 0, 0, 50);
    // Asked for fifty, has eight: a full pool drops the request rather than
    // growing, because a missing spark is invisible and a stutter is not.
    expect(field.live).toBe(8);
    field.dispose();
  });

  it('ages particles out and frees their slots', () => {
    const field = createParticles(16);
    const camera = new THREE.PerspectiveCamera();
    field.emit('spark', 0, 0, 0, 6);
    expect(field.live).toBe(6);

    for (let i = 0; i < 200; i += 1) field.update(1 / 60, camera);
    expect(field.live).toBe(0);

    // And the freed slots are reusable, which is the point of a pool.
    field.emit('smoke', 0, 0, 0, 6);
    expect(field.live).toBe(6);
    field.dispose();
  });

  it('draws everything in one instanced mesh', () => {
    const field = createParticles(32);
    expect(field.points).toBeInstanceOf(THREE.InstancedMesh);
    field.dispose();
  });
});
