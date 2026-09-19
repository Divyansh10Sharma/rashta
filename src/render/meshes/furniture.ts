import * as THREE from 'three';

/** Roadside furniture geometry, for `Scenery`. */

/** A streetlight mast. */
export function poleGeometry(): THREE.BufferGeometry {
  // A streetlight: a mast with a short arm. Merged into one geometry so the
  // whole thing is a single instanced draw.
  const mast = new THREE.CylinderGeometry(0.09, 0.13, 8, 6);
  mast.translate(0, 4, 0);
  return mast;
}

/** A streetlight's lamp head, on its arm. */
export function lampGeometry(): THREE.BufferGeometry {
  const lamp = new THREE.BoxGeometry(1.5, 0.22, 0.5);
  lamp.translate(0.75, 7.9, 0);
  return lamp;
}

/** One kerb stone. */
export function kerbGeometry(): THREE.BufferGeometry {
  // Length matches `kerbSpacing`, so consecutive stones meet and read as one
  // continuous kerb that still follows the bend.
  return new THREE.BoxGeometry(0.32, 0.28, 4);
}

/** A roadside bollard. */
export function bollardGeometry(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.08, 0.1, 0.9, 6);
  post.translate(0, 0.45, 0);
  return post;
}
