import * as THREE from 'three';
import type { SceneryTag } from '../../core/types.ts';
import type { SpriteLibrary } from './library.ts';
import type { PlaceSprites, SpriteData } from './data.ts';
import { createCard, createFacing, type Facing } from './Billboard.ts';

/**
 * Everything a view needs to draw sprites, built once per race by `Stage`.
 *
 * Views that are given no kit draw their meshes, exactly as before — which is
 * also what the unit tests exercise, since they have no browser to load into.
 */
export interface SpriteKit {
  library: SpriteLibrary;
  data: SpriteData;
  /** This race's place. */
  place: PlaceSprites;
  /** Updated by `Stage` each frame, read by every camera-facing card. */
  facing: Facing;
  /** The place's light, multiplied into every sprite. */
  light: THREE.Color;
  /** The quad every card is drawn on. */
  card: THREE.PlaneGeometry;
  /** From tuning.json: the lean at which a rider is fully over. */
  leanMax: number;
}

/** Builds the kit for a race in `scenery`. */
export function createSpriteKit(
  library: SpriteLibrary,
  data: SpriteData,
  scenery: SceneryTag,
  leanMax: number,
): SpriteKit {
  const place = data.places[scenery];
  return {
    library,
    data,
    place,
    facing: createFacing(),
    light: new THREE.Color(place.light),
    card: createCard(),
    leanMax,
  };
}
