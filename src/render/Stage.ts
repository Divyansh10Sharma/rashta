import * as THREE from 'three';
import type { Track } from '../core/track/Track.ts';
import { ChaseCamera } from './ChaseCamera.ts';
import { createRiderView, type RiderView } from './Rider.ts';
import { createScenery, type SceneryField } from './Scenery.ts';
import { buildRoadMesh, cullChunks, type RoadMesh } from './RoadMeshBuilder.ts';

/** Everything Three.js, assembled. Reads core state and never writes to it. */
export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  chase: ChaseCamera;
  rider: RiderView;
  road: RoadMesh;
  scenery: SceneryField;
  /**
   * Where the rider currently is on screen, as -1 (hard left) to +1 (hard
   * right). Diagnostic: it answers whether the simulation and the picture
   * agree about which way is right, without anyone having to reason about
   * cross products.
   */
  riderScreenX: () => number;
  /** Repositions everything for the current interpolated state. */
  sync: (
    s: number,
    t: number,
    lean: number,
    wheelAngle: number,
    speedFraction: number,
    branchId: number,
    dt: number,
  ) => number;
  dispose: () => void;
}

/** How far ahead and behind road chunks stay resident. */
const CHUNK_AHEAD = 460;
const CHUNK_BEHIND = 90;

/**
 * Delhi at night: sodium vapour, deep blue ambient bounce, and fog tight
 * enough that the road fades rather than ending. See CLAUDE.md — this is the
 * visual identity and it is not California.
 */
export function createStage(canvas: HTMLCanvasElement, track: Track): Stage {
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
  scene.add(new THREE.AmbientLight(0x2b3452, 1.1));
  // A faint warm haze at road level, as if the whole city is under one lamp.
  scene.add(new THREE.HemisphereLight(0xffa94d, 0x14141c, 0.55));

  const road = buildRoadMesh(track);
  scene.add(road.group);

  const scenery = createScenery(track);
  scene.add(scenery.group);

  const rider = createRiderView();
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
    probe.copy(rider.group.position).project(camera);
    return probe.x;
  };

  const sync = (
    s: number,
    t: number,
    lean: number,
    wheelAngle: number,
    speedFraction: number,
    branchId: number,
    dt: number,
  ): number => {
    rider.update(track, s, t, lean, wheelAngle, branchId);
    chase.update(track, s, t, speedFraction, branchId, dt);
    scenery.update(s);
    return cullChunks(road, s, CHUNK_AHEAD, CHUNK_BEHIND);
  };

  return {
    renderer,
    scene,
    camera,
    chase,
    rider,
    road,
    scenery,
    riderScreenX,
    sync,
    dispose: () => {
      window.removeEventListener('resize', resize);
      road.dispose();
      scenery.dispose();
      rider.dispose();
      renderer.dispose();
    },
  };
}
