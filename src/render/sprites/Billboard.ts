import * as THREE from 'three';

/**
 * The pieces every sprite shares: one quad, one way to face it, one way to
 * stand it on the road.
 *
 * The genre's trick is that every object is drawn from the one angle the
 * chase camera sees. In a 3D scene that means a flat card turned to face the
 * camera about the vertical axis only — the camera never rolls (ChaseCamera
 * uses a plain `lookAt`), and turning the cards about any other axis would
 * tip cars backwards on a crest.
 */

/** The direction every camera-facing card faces this frame. */
export interface Facing {
  quaternion: THREE.Quaternion;
  /** The card's +x in world space, for shifting it to its ground anchor. */
  right: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);
const scratchDirection = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();

/** A unit quad with its origin at bottom-centre, facing +z. */
export function createCard(): THREE.PlaneGeometry {
  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, 0.5, 0);
  return card;
}

/**
 * A sprite material. Alpha-tested with alpha-to-coverage rather than blended:
 * blended cards have to be depth-sorted every frame and still pop where two
 * overlap, and with the MSAA the renderer already has, coverage gives the
 * same soft edge for free.
 */
export function createSpriteMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    alphaTest: 0.5,
    alphaToCoverage: true,
    // Mirroring is a negative x scale. three.js flips the winding for an
    // object's own matrix but not per instance, so a mirrored instance would
    // be back-face culled — every left-side streetlight vanished until this.
    side: THREE.DoubleSide,
  });
}

/** Points `material` at `texture`, recompiling only the first time. */
export function useTexture(
  material: THREE.MeshBasicMaterial,
  texture: THREE.Texture,
): void {
  if (material.map === texture) return;
  // Going from no map to a map changes the shader; texture to texture does not.
  if (material.map === null) material.needsUpdate = true;
  material.map = texture;
}

/** Turns cards to face horizontal direction `(x, z)` pointing *toward* them. */
export function faceAlong(x: number, z: number, out: Facing): Facing {
  out.quaternion.setFromAxisAngle(UP, Math.atan2(-x, -z));
  out.right.set(1, 0, 0).applyQuaternion(out.quaternion);
  return out;
}

/** Turns cards to face the camera. Once per frame. */
export function faceCamera(camera: THREE.Camera, out: Facing): Facing {
  camera.getWorldDirection(scratchDirection);
  return faceAlong(scratchDirection.x, scratchDirection.z, out);
}

/** A facing, allocated once. */
export function createFacing(): Facing {
  return {
    quaternion: new THREE.Quaternion(),
    right: new THREE.Vector3(1, 0, 0),
  };
}

/**
 * The matrix for a standing card whose ground contact is at `ground`.
 *
 * `anchor` is where along the picture's width it touches the ground (see
 * bounds.ts); the card is shifted sideways so that point, not its middle,
 * lands on `ground`. Mirroring is a negative x scale, which three.js handles
 * by flipping the winding, so the same picture serves both sides.
 */
export function composeCard(
  out: THREE.Matrix4,
  ground: THREE.Vector3,
  facing: Facing,
  width: number,
  height: number,
  anchor: number,
  mirror: boolean,
): THREE.Matrix4 {
  const sign = mirror ? -1 : 1;
  const shift = (anchor - 0.5) * width * sign;
  scratchPosition.copy(ground).addScaledVector(facing.right, -shift);
  scratchScale.set(width * sign, height, 1);
  return out.compose(scratchPosition, facing.quaternion, scratchScale);
}
