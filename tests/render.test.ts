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
    // The straight runs along +Z, so the road's extent is in X.
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
          // The straight runs along +Z, so world Z is track s.
          //
          // A pool's cycle is `ceil(span / spacing) + 1` positions, so it is
          // longer than the visible span by under two spacings — the rounding
          // up, plus one deliberate spare so nothing pops into view at the far
          // edge. That excess is the most any instance can sit beyond `ahead`.
          const slack = 2 * DEFAULT_SCENERY.lightSpacing;
          expect(position.z).toBeGreaterThan(s - DEFAULT_SCENERY.behind - 2);
          expect(position.z).toBeLessThan(s + DEFAULT_SCENERY.ahead + slack);
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
        if (position.x > 0) kerbs.push(position.z);
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

  it('allocates nothing while recycling', () => {
    const scenery = createScenery(track);
    scenery.update(0);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 3000; i += 1) scenery.update(i * 3);
    const grown = process.memoryUsage().heapUsed - before;
    expect(grown).toBeLessThan(4_000_000);
    scenery.dispose();
  });
});

describe('the rider view', () => {
  it('places the rider at the track-space position it is given', () => {
    const rider = createRiderView();
    rider.update(track, 500, 3, 0, 0, 0);
    // Straight along +Z with t measured in +X.
    expect(rider.group.position.z).toBeCloseTo(500, 6);
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
