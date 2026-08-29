import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseTrack } from '../src/core/track/load.ts';
import {
  buildRoadMesh,
  cullChunks,
  CHUNK_METRES,
} from '../src/render/RoadMeshBuilder.ts';
import { createScenery, DEFAULT_SCENERY } from '../src/render/Scenery.ts';
import { createRiderView } from '../src/render/Rider.ts';
import { ChaseCamera } from '../src/render/ChaseCamera.ts';

/**
 * The render layer, tested without a GPU.
 *
 * Three.js builds its scene graph and geometry on the CPU and only needs a
 * WebGL context to draw, so geometry, pooling, and culling are all provable
 * headlessly. What cannot be checked here is what it looks like, which is
 * exactly the part a human has to judge.
 */

const track = parseTrack(
  'src/data/tracks/straight.json',
  readFileSync('src/data/tracks/straight.json', 'utf8'),
);
const testTrack = parseTrack(
  'src/data/tracks/test-track.json',
  readFileSync('src/data/tracks/test-track.json', 'utf8'),
);

describe('the road mesh', () => {
  it('covers the whole track in chunks', () => {
    const road = buildRoadMesh(track);
    expect(road.chunks.length).toBe(
      Math.ceil(track.totalLength / CHUNK_METRES),
    );
    expect(road.chunks[0]?.startS).toBe(0);
    expect(road.chunks[road.chunks.length - 1]?.endS).toBeCloseTo(
      track.totalLength,
      6,
    );
    road.dispose();
  });

  it('leaves no gap between consecutive chunks', () => {
    const road = buildRoadMesh(testTrack);
    for (let i = 1; i < road.chunks.length; i += 1) {
      expect(road.chunks[i]?.startS).toBeCloseTo(
        road.chunks[i - 1]?.endS ?? -1,
        9,
      );
    }
    road.dispose();
  });

  it('builds real geometry with finite vertices', () => {
    const road = buildRoadMesh(testTrack);
    for (const chunk of road.chunks) {
      const position = chunk.mesh.geometry.getAttribute('position');
      expect(position.count).toBeGreaterThan(3);
      for (let i = 0; i < position.count; i += 1) {
        expect(Number.isFinite(position.getX(i))).toBe(true);
        expect(Number.isFinite(position.getY(i))).toBe(true);
        expect(Number.isFinite(position.getZ(i))).toBe(true);
      }
    }
    road.dispose();
  });

  it('lays the road across the full width including the shoulder', () => {
    const road = buildRoadMesh(track);
    const chunk = road.chunks[0];
    if (!chunk) throw new Error('no chunks');
    const position = chunk.mesh.geometry.getAttribute('position');
    // The straight runs along -Z, so the road's extent is in X.
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
    }
    const expected = track.driveableHalfWidthAt(0);
    expect(maxX).toBeCloseTo(expected, 6);
    expect(minX).toBeCloseTo(-expected, 6);
    road.dispose();
  });

  it('shows only the chunks near the rider', () => {
    const road = buildRoadMesh(track);
    const visible = cullChunks(road, 5000, 460, 90);
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(road.chunks.length);

    for (const chunk of road.chunks) {
      const near = chunk.endS > 5000 - 90 && chunk.startS < 5000 + 460;
      expect(`${chunk.startS}: ${chunk.mesh.visible}`).toBe(
        `${chunk.startS}: ${near}`,
      );
    }
    road.dispose();
  });

  it('keeps the chunk under the rider visible at every point on the track', () => {
    const road = buildRoadMesh(testTrack);
    for (let s = 0; s <= testTrack.totalLength; s += 25) {
      cullChunks(road, s, 460, 90);
      const covering = road.chunks.find((c) => c.startS <= s && c.endS >= s);
      expect(`${s}: ${covering?.mesh.visible ?? 'missing'}`).toBe(`${s}: true`);
    }
    road.dispose();
  });
});

describe('the scenery pool', () => {
  it('holds more than the 400 objects the acceptance criterion asks for', () => {
    const scenery = createScenery(track);
    expect(scenery.count).toBeGreaterThanOrEqual(400);
    scenery.dispose();
  });

  it('keeps every instance inside the visible window as s advances', () => {
    // The whole point of a pool: objects are recycled, never spawned. If this
    // holds, nothing is ever allocated and nothing is ever missing.
    const scenery = createScenery(track);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();

    for (const s of [0, 137, 1000, 4321, 9999]) {
      scenery.update(s);
      for (const child of scenery.group.children) {
        if (!(child instanceof THREE.InstancedMesh)) continue;
        for (let i = 0; i < child.count; i += 1) {
          child.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix);
          // The straight runs along -Z, so track s is -z.
          //
          // A pool's cycle is `ceil(span / spacing) + 1` positions, so it is
          // longer than the visible span by under two spacings — the rounding
          // up, plus one deliberate spare so nothing pops into view at the far
          // edge. That excess is the most any instance can sit beyond `ahead`.
          const slack = 2 * DEFAULT_SCENERY.lightSpacing;
          const along = -position.z;
          expect(along).toBeGreaterThan(s - DEFAULT_SCENERY.behind - 2);
          expect(along).toBeLessThan(s + DEFAULT_SCENERY.ahead + slack);
        }
      }
    }
    scenery.dispose();
  });

  it('leaves no gap in the kerb line after recycling', () => {
    // The bug this pins: a two-sided pool has two instances per position, so
    // recycling by the instance count shifts twice as far as it should and
    // leaves half the road without a kerb.
    const scenery = createScenery(track);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();

    scenery.update(3000);
    const kerbs: number[] = [];
    for (const child of scenery.group.children) {
      if (!(child instanceof THREE.InstancedMesh)) continue;
      if (child.count < 200) continue; // the kerb pool is much the largest
      for (let i = 0; i < child.count; i += 1) {
        child.getMatrixAt(i, matrix);
        position.setFromMatrixPosition(matrix);
        if (position.x > 0) kerbs.push(-position.z);
      }
    }
    kerbs.sort((a, b) => a - b);
    expect(kerbs.length).toBeGreaterThan(50);
    for (let i = 1; i < kerbs.length; i += 1) {
      const gap = (kerbs[i] ?? 0) - (kerbs[i - 1] ?? 0);
      expect(`gap ${gap.toFixed(2)}`).toBe(
        `gap ${DEFAULT_SCENERY.kerbSpacing.toFixed(2)}`,
      );
    }
    scenery.dispose();
  });

  it('reuses the same meshes and buffers rather than replacing them', () => {
    // Deterministic, unlike a heap measurement: if recycling ever allocated,
    // it would have to produce new instances or new backing buffers, and
    // these identity checks would fail. An earlier version of this test read
    // `heapUsed` instead and passed or failed depending on which other tests
    // had run first in the same process, which is worse than no test.
    const scenery = createScenery(track);
    scenery.update(0);

    const meshes = scenery.group.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
    );
    const before = meshes.map((m) => ({
      mesh: m,
      count: m.count,
      buffer: m.instanceMatrix.array,
    }));

    for (let i = 0; i < 3000; i += 1) scenery.update(i * 3);

    const after = scenery.group.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
    );
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i += 1) {
      const was = before[i];
      const now = after[i];
      expect(now).toBe(was?.mesh);
      expect(now?.count).toBe(was?.count);
      expect(now?.instanceMatrix.array).toBe(was?.buffer);
    }
    scenery.dispose();
  });
});

describe('the rider view', () => {
  it('places the rider at the track-space position it is given', () => {
    const rider = createRiderView();
    rider.update(track, 500, 3, 0, 0, 0);
    // Forward is -Z, and positive t is the rider's right, which is +X — the
    // handedness that makes steering right also move right on screen.
    expect(rider.group.position.z).toBeCloseTo(-500, 6);
    expect(rider.group.position.x).toBeCloseTo(3, 6);
    rider.dispose();
  });

  it('follows a bend rather than driving straight through it', () => {
    const rider = createRiderView();
    rider.update(testTrack, 300, 0, 0, 0, 0);
    const straightOn = rider.group.position.x;
    expect(Math.abs(straightOn)).toBeGreaterThan(1);
    rider.dispose();
  });

  it('banks the bike without moving it', () => {
    const rider = createRiderView();
    rider.update(track, 100, 0, 0, 0, 0);
    const upright = rider.group.position.clone();
    rider.update(track, 100, 0, 0.4, 0, 0);
    expect(rider.group.position.distanceTo(upright)).toBeCloseTo(0, 9);
    rider.dispose();
  });
});

describe("handedness: the rider's right is the viewer's right", () => {
  /**
   * The test that was missing.
   *
   * Every earlier render test asserted world coordinates against a convention
   * this file itself had chosen, so a mirrored convention satisfied all of
   * them. Nothing connected track space to what the camera actually shows —
   * and the result was a bike that leaned right and travelled left, found by
   * riding it rather than by running anything.
   *
   * Three.js cameras look down their own -Z with +X to the right of the
   * screen, so projecting a rider into camera space and reading the sign of x
   * is exactly the question "which way did they appear to go".
   */
  function cameraSpaceX(t: number, s = 400): number {
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 900);
    const chase = new ChaseCamera(camera);
    chase.reset(0);
    // Settle the easing so the camera is actually behind the rider.
    for (let i = 0; i < 240; i += 1) chase.update(track, s, 0, 0.5, 0, 1 / 60);
    camera.updateMatrixWorld(true);

    const rider = createRiderView();
    rider.update(track, s, t, 0, 0, 0);
    const local = rider.group.position
      .clone()
      .applyMatrix4(camera.matrixWorldInverse);
    rider.dispose();
    return local.x;
  }

  it('puts positive t on the right of the screen', () => {
    expect(cameraSpaceX(4)).toBeGreaterThan(0);
  });

  it('puts negative t on the left of the screen', () => {
    expect(cameraSpaceX(-4)).toBeLessThan(0);
  });

  it('puts the centreline in the middle', () => {
    expect(Math.abs(cameraSpaceX(0))).toBeLessThan(0.01);
  });

  it('keeps the rider in front of the camera, not behind it', () => {
    // Camera space -Z is forward, so a rider ahead of the camera has z < 0.
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 900);
    const chase = new ChaseCamera(camera);
    chase.reset(0);
    for (let i = 0; i < 240; i += 1)
      chase.update(track, 400, 0, 0.5, 0, 1 / 60);
    camera.updateMatrixWorld(true);

    const rider = createRiderView();
    rider.update(track, 400, 0, 0, 0, 0);
    const local = rider.group.position
      .clone()
      .applyMatrix4(camera.matrixWorldInverse);
    expect(local.z).toBeLessThan(0);
    rider.dispose();
  });

  it('turns the road right for positive curvature, on screen', () => {
    // The same question asked of the track itself: a right-hand bend must
    // bend toward the right of the frame.
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 900);
    const chase = new ChaseCamera(camera);
    chase.reset(0);
    // Segment 1 of the test track is a right-hander (curvature +1/150).
    for (let i = 0; i < 240; i += 1)
      chase.update(testTrack, 210, 0, 0.5, 0, 1 / 60);
    camera.updateMatrixWorld(true);

    const rider = createRiderView();
    rider.update(testTrack, 300, 0, 0, 0, 0);
    const ahead = rider.group.position
      .clone()
      .applyMatrix4(camera.matrixWorldInverse);
    rider.dispose();
    expect(testTrack.curvatureAt(250)).toBeGreaterThan(0);
    expect(ahead.x).toBeGreaterThan(0);
  });
});
