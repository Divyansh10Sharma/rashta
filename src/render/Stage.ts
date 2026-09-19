import * as THREE from 'three';
import type { Track } from '../core/track/Track.ts';
import { ChaseCamera } from './ChaseCamera.ts';
import { createScenery, sceneryFor, type SceneryField } from './Scenery.ts';
import { buildRoadMesh, cullChunks, type RoadMesh } from './RoadMeshBuilder.ts';
import { createHazardField, type HazardField } from './HazardView.ts';
import { createTrafficView, type TrafficView } from './TrafficView.ts';
import { createField, type FieldView } from './FieldView.ts';
import { createParticles, type ParticleField } from './Particles.ts';
import { ENVIRONMENTS, applyEnvironment } from './environments.ts';
import { createSpriteLibrary } from './sprites/library.ts';
import { createSpriteKit } from './sprites/kit.ts';
import type { SpriteData } from './sprites/data.ts';
import { faceCamera } from './sprites/Billboard.ts';
import {
  createRiderDrawing,
  type RiderDrawing,
} from './sprites/RiderSprite.ts';
import { createRoadsideSprites } from './sprites/RoadsideSprites.ts';

/** What the stage needs to draw pictures. Without it, everything is meshes. */
export interface StageArt {
  sprites: SpriteData;
  /** From tuning.json, for choosing lean frames. */
  leanMax: number;
}

/** Everything Three.js, assembled. Reads core state and never writes to it. */
export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  chase: ChaseCamera;
  /** The player. Updated by the caller, which owns the two race states. */
  rider: RiderDrawing;
  road: RoadMesh;
  scenery: SceneryField;
  traffic: TrafficView;
  hazards: HazardField;
  field: FieldView;
  particles: ParticleField;
  /**
   * Where the rider currently is on screen, as -1 (hard left) to +1 (hard
   * right). Diagnostic: it answers whether the simulation and the picture
   * agree about which way is right, without anyone having to reason about
   * cross products.
   */
  riderScreenX: () => number;
  /**
   * Moves the camera and everything tied to it. Call before updating the
   * riders and traffic, which face the camera this sets.
   */
  sync: (
    s: number,
    t: number,
    speedFraction: number,
    branchId: number,
    dt: number,
  ) => number;
  dispose: () => void;
}

/** How far ahead and behind road chunks stay resident. */
const CHUNK_BEHIND = 90;

/**
 * Delhi at night: sodium vapour, deep blue ambient bounce, and fog tight
 * enough that the road fades rather than ending. See CLAUDE.md — this is the
 * visual identity and it is not California.
 */
export function createStage(
  canvas: HTMLCanvasElement,
  track: Track,
  trafficPoolSize = 0,
  rivals = 0,
  police = 0,
  art: StageArt | null = null,
): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070b);
  scene.fog = new THREE.Fog(0x07070b, 90, 420);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
  const chase = new ChaseCamera(camera);

  const key = new THREE.DirectionalLight(0xffb765, 1.5);
  key.position.set(-30, 60, 20);
  scene.add(key);
  const ambient = new THREE.AmbientLight(0x2b3452, 1.1);
  scene.add(ambient);
  // A faint warm haze at road level, as if the whole city is under one lamp.
  const hemi = new THREE.HemisphereLight(0xffa94d, 0x14141c, 0.55);
  scene.add(hemi);

  // Sky, fog and light colours all come from the track's district.
  applyEnvironment(scene, key, ambient, hemi, ENVIRONMENTS[track.data.scenery]);

  const chunkAhead = ENVIRONMENTS[track.data.scenery].fogFar + 60;

  // Pictures come from public/, served rather than bundled. Only what this
  // route asks for is ever fetched.
  const library = createSpriteLibrary(`${import.meta.env.BASE_URL}sprites/`);
  const kit = art
    ? createSpriteKit(library, art.sprites, track.data.scenery, art.leanMax)
    : null;

  const road = buildRoadMesh(track);
  scene.add(road.group);

  const sceneryConfig = sceneryFor(track.data.scenery);
  const scenery = createScenery(track, sceneryConfig);
  scene.add(scenery.group);
  const roadside = kit
    ? createRoadsideSprites(track, kit, sceneryConfig, scenery.streetlights)
    : null;
  if (roadside) scene.add(roadside.group);

  // Hazards never move, so they are built once and never touched again.
  const hazards = createHazardField(track, kit);
  scene.add(hazards.group);

  const traffic = createTrafficView(track, trafficPoolSize, kit);
  scene.add(traffic.group);

  const field = createField(rivals, police, kit);
  scene.add(field.group);

  const particles = createParticles();
  scene.add(particles.points);

  const rider = createRiderDrawing(0xc4402c, kit);
  scene.add(rider.group);

  const resize = (): void => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const probe = new THREE.Vector3();
  const riderScreenX = (): number => {
    probe.copy(rider.position).project(camera);
    return probe.x;
  };

  const sync = (
    s: number,
    t: number,
    speedFraction: number,
    branchId: number,
    dt: number,
  ): number => {
    chase.update(track, s, t, speedFraction, branchId, dt);
    if (kit) faceCamera(camera, kit.facing);
    scenery.update(s);
    roadside?.update(s);
    hazards.refresh();
    // Chunks stay resident as far as the district's fog lets you see, so a
    // narrow lane loads three chunks and the flyway loads a dozen.
    return cullChunks(road, s, chunkAhead, CHUNK_BEHIND);
  };

  return {
    renderer,
    scene,
    camera,
    chase,
    rider,
    road,
    scenery,
    traffic,
    hazards,
    field,
    particles,
    riderScreenX,
    sync,
    dispose: () => {
      window.removeEventListener('resize', resize);
      road.dispose();
      scenery.dispose();
      roadside?.dispose();
      kit?.card.dispose();
      library.dispose();
      traffic.dispose();
      hazards.dispose();
      field.dispose();
      particles.dispose();
      rider.dispose();
      renderer.dispose();
    },
  };
}
