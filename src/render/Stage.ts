import * as THREE from 'three';

/** The Three.js objects the render loop needs to keep hold of. */
export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dispose: () => void;
}

const GROUND_METRES = 400;

/**
 * Builds the Phase 0 scene: a ground plane and two lights, lit the colour a
 * Delhi street is at night. There is no game in here yet — this exists to
 * prove the render path works end to end and to give the frame counter
 * something to measure.
 */
export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0c);
  scene.fog = new THREE.Fog(0x0a0a0c, 60, 260);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 4.5, 12);
  camera.lookAt(0, 1, -20);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_METRES, GROUND_METRES),
    new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Sodium vapour, not daylight. See CLAUDE.md — do not default to California.
  const key = new THREE.DirectionalLight(0xffb765, 2.2);
  key.position.set(-30, 40, 20);
  scene.add(key);

  scene.add(new THREE.AmbientLight(0x35405e, 0.9));

  const resize = (): void => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    dispose: () => {
      window.removeEventListener('resize', resize);
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
    },
  };
}
