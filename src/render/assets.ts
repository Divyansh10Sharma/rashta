import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Modelled assets, when there are any.
 *
 * Every vehicle in the game has a procedural mesh built in `meshes/`, and that
 * is what ships. This module lets a real modelled `.glb` replace one, keyed by
 * the same name — drop a file in, name it in `models.json`, and it is used.
 *
 * Everything here fails soft. A missing file, a corrupt file, a file that
 * contains no geometry: all of them log once and fall back to the procedural
 * mesh, because a game that refuses to start because an optional art asset is
 * absent is worse than a game that looks plainer.
 *
 * A note on why the procedural path is not merely a placeholder: the file
 * format does not set the fidelity ceiling, whoever authors the model does.
 * Generating `.glb` files from this project's own code would ship the same
 * shapes at a hundred times the download. See devlog phase-08.
 */

/** A slot a model can replace. Matches the procedural builders' names. */
export type ModelSlot =
  | 'bike:street'
  | 'bike:sport'
  | 'bike:super'
  | 'traffic:car'
  | 'traffic:auto'
  | 'traffic:bus'
  | 'traffic:truck';

export const MODEL_SLOTS: readonly ModelSlot[] = [
  'bike:street',
  'bike:sport',
  'bike:super',
  'traffic:car',
  'traffic:auto',
  'traffic:bus',
  'traffic:truck',
];

/** What `src/data/models.json` holds: slot name to file URL. */
export type ModelManifest = Partial<Record<ModelSlot, string>>;

/** Geometry pulled out of a loaded model, ready to instance. */
export interface LoadedModel {
  geometry: THREE.BufferGeometry;
  /** The model's own materials, in the order the merged groups reference them. */
  materials: THREE.Material[];
}

export type ModelSet = Partial<Record<ModelSlot, LoadedModel>>;

/** Reads and checks a manifest. Unknown slot names are a loud mistake. */
export function parseManifest(file: string, raw: unknown): ModelManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${file}: models must be a JSON object`);
  }
  const manifest: ModelManifest = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!MODEL_SLOTS.includes(key as ModelSlot)) {
      throw new Error(
        `${file}: "${key}" is not a model slot. Expected one of ${MODEL_SLOTS.join(', ')}`,
      );
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${file}: ${key} must be a non-empty file path`);
    }
    manifest[key as ModelSlot] = value;
  }
  return manifest;
}

/**
 * Flattens a loaded scene into one geometry per material.
 *
 * A model exported from any tool arrives as a tree of meshes with their own
 * transforms. Instancing needs one geometry, so the tree is walked, each
 * mesh's world transform baked into a copy of its geometry, and the lot
 * merged — which also collapses a forty-mesh model into one draw call.
 */
export function flatten(scene: THREE.Object3D): LoadedModel | null {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  scene.updateMatrixWorld(true);
  scene.traverse((child) => {
    const mesh = child as Partial<THREE.Mesh>;
    if (mesh.isMesh !== true || !mesh.geometry) return;
    const baked = mesh.geometry.clone();
    baked.applyMatrix4(child.matrixWorld);
    // Merging demands identical attribute sets; anything exotic is dropped
    // rather than allowed to fail the whole load.
    if (!baked.getAttribute('position')) return;
    if (!baked.getAttribute('normal')) baked.computeVertexNormals();
    geometries.push(baked);
    const material = mesh.material;
    materials.push(
      Array.isArray(material)
        ? (material[0] ?? new THREE.MeshStandardMaterial())
        : (material ?? new THREE.MeshStandardMaterial()),
    );
  });

  if (geometries.length === 0) return null;
  const merged = mergeGeometries(geometries, true);
  if (!merged) return null;
  return { geometry: merged, materials };
}

/**
 * Loads every model in the manifest.
 *
 * Resolves with whatever succeeded. Failures are reported and omitted, so the
 * caller's fallback is simply "this slot is not in the map".
 */
export async function loadModels(manifest: ModelManifest): Promise<ModelSet> {
  const entries = Object.entries(manifest) as [ModelSlot, string][];
  if (entries.length === 0) return {};

  const loader = new GLTFLoader();
  const models: ModelSet = {};

  await Promise.all(
    entries.map(async ([slot, url]) => {
      try {
        const gltf = await loader.loadAsync(url);
        const flat = flatten(gltf.scene);
        if (!flat) {
          console.warn(`models: ${url} contained no usable geometry`);
          return;
        }
        models[slot] = flat;
      } catch (error) {
        // Soft: the procedural mesh for this slot is used instead.
        console.warn(`models: could not load ${url} for ${slot}`, error);
      }
    }),
  );

  return models;
}
