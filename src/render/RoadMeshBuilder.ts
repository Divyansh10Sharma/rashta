import * as THREE from 'three';
import type { Track } from '../core/track/Track.ts';
import { createFrame } from '../core/track/path.ts';
import { MAIN_BRANCH } from '../core/types.ts';

/**
 * Builds the road surface as a quad strip walked along the track centreline.
 *
 * Split into chunks so the ones behind the rider can be skipped — a 20 km road
 * is one draw call per 200 m rather than one enormous buffer the GPU has to
 * consider in its entirety every frame.
 *
 * Reads the track and writes geometry. Never the other way round.
 */

/** Metres of road per chunk. */
export const CHUNK_METRES = 200;
/** Metres between cross-sections. Finer than the eye needs on a straight. */
const STEP_METRES = 4;

export interface RoadChunk {
  mesh: THREE.Mesh;
  /** Lane markings, parented to `mesh` so they inherit its visibility. */
  paint: THREE.Mesh;
  /** Track-space span this chunk covers. */
  startS: number;
  endS: number;
}

export interface RoadMesh {
  group: THREE.Group;
  chunks: RoadChunk[];
  dispose: () => void;
}

/** Lane paint, as a repeating dashed line down the centre of each lane join. */
function buildMaterials(): { road: THREE.Material; paint: THREE.Material } {
  return {
    road: new THREE.MeshStandardMaterial({
      color: 0x24242a,
      roughness: 0.92,
      metalness: 0.02,
    }),
    paint: new THREE.MeshStandardMaterial({
      color: 0xd8d4c4,
      roughness: 0.7,
      emissive: 0x2a2620,
    }),
  };
}

/**
 * Emits one chunk's vertices by sampling the track at fixed intervals and
 * laying a quad between consecutive cross-sections.
 */
function buildChunkGeometry(
  track: Track,
  startS: number,
  endS: number,
  branchId: number,
): THREE.BufferGeometry {
  const frame = createFrame();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const steps = Math.max(1, Math.ceil((endS - startS) / STEP_METRES));
  const step = (endS - startS) / steps;

  for (let i = 0; i <= steps; i += 1) {
    const s = startS + i * step;
    track.sample(s, frame, branchId);
    const edge = frame.halfWidth + frame.shoulder;

    for (const side of [-1, 1]) {
      positions.push(
        frame.position.x + frame.right.x * edge * side,
        frame.position.y + frame.right.y * edge * side,
        frame.position.z + frame.right.z * edge * side,
      );
      normals.push(frame.up.x, frame.up.y, frame.up.z);
      uvs.push(side === -1 ? 0 : 1, s / 8);
    }
  }

  for (let i = 0; i < steps; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Dashed lane markings, as thin flat quads slightly above the road. */
function buildPaintGeometry(
  track: Track,
  startS: number,
  endS: number,
  branchId: number,
): THREE.BufferGeometry {
  const frame = createFrame();
  const positions: number[] = [];
  const indices: number[] = [];
  const DASH = 3;
  const GAP = 5;
  const HALF_WIDTH = 0.09;
  const LIFT = 0.012;

  let vertex = 0;
  for (let s = startS; s < endS; s += DASH + GAP) {
    const dashEnd = Math.min(s + DASH, endS);
    track.sample(s, frame, branchId);
    const lanes = frame.lanes;

    for (let lane = 1; lane < lanes; lane += 1) {
      const t = frame.halfWidth * (-1 + (2 * lane) / lanes);
      for (const at of [s, dashEnd]) {
        track.sample(at, frame, branchId);
        for (const side of [-1, 1]) {
          const offset = t + side * HALF_WIDTH;
          positions.push(
            frame.position.x + frame.right.x * offset + frame.up.x * LIFT,
            frame.position.y + frame.right.y * offset + frame.up.y * LIFT,
            frame.position.z + frame.right.z * offset + frame.up.z * LIFT,
          );
        }
      }
      indices.push(
        vertex,
        vertex + 1,
        vertex + 2,
        vertex + 1,
        vertex + 3,
        vertex + 2,
      );
      vertex += 4;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Builds the whole road, chunked. Called once per track load. */
export function buildRoadMesh(
  track: Track,
  branchId: number = MAIN_BRANCH,
): RoadMesh {
  const materials = buildMaterials();
  const group = new THREE.Group();
  const chunks: RoadChunk[] = [];
  const total = track.totalLength;

  for (let startS = 0; startS < total; startS += CHUNK_METRES) {
    const endS = Math.min(startS + CHUNK_METRES, total);

    const surface = new THREE.Mesh(
      buildChunkGeometry(track, startS, endS, branchId),
      materials.road,
    );
    const paint = new THREE.Mesh(
      buildPaintGeometry(track, startS, endS, branchId),
      materials.paint,
    );
    surface.add(paint);
    group.add(surface);
    chunks.push({ mesh: surface, paint, startS, endS });
  }

  return {
    group,
    chunks,
    dispose: () => {
      for (const chunk of chunks) {
        chunk.mesh.geometry.dispose();
        chunk.paint.geometry.dispose();
      }
      materials.road.dispose();
      materials.paint.dispose();
    },
  };
}

/**
 * Hides chunks outside a window around the rider.
 *
 * Cheap because chunks are indexed by track-space `s` — visibility is a
 * numeric comparison rather than a frustum test, which is the track-space
 * dividend showing up in the renderer.
 */
export function cullChunks(
  road: RoadMesh,
  s: number,
  ahead: number,
  behind: number,
): number {
  let visible = 0;
  for (const chunk of road.chunks) {
    const shown = chunk.endS > s - behind && chunk.startS < s + ahead;
    chunk.mesh.visible = shown;
    if (shown) visible += 1;
  }
  return visible;
}
