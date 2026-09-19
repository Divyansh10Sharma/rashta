import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { loadSpriteData } from '../../src/render/sprites/data.ts';
import {
  createSpriteKit,
  type SpriteKit,
} from '../../src/render/sprites/kit.ts';
import type {
  Picture,
  SpriteLibrary,
} from '../../src/render/sprites/library.ts';
import type { SceneryTag } from '../../src/core/types.ts';
import { tuning } from './race.ts';

/** The real sprites.json, validated. */
export const spriteData = loadSpriteData(
  'sprites.json',
  JSON.parse(readFileSync('src/data/sprites.json', 'utf8')),
);

/**
 * A library with no network: every picture is ready at once unless `missing`
 * says otherwise. Aspect 2 (twice as tall as wide) and a centred anchor, so
 * sizes in tests are easy to reason about.
 */
export function fakeLibrary(
  missing: (path: string) => boolean = () => false,
): SpriteLibrary & {
  asked: string[];
} {
  const pictures = new Map<string, Picture>();
  const asked: string[] = [];
  return {
    asked,
    get: (path) => {
      const known = pictures.get(path);
      if (known) return known;
      asked.push(path);
      const gone = missing(path);
      const picture: Picture = {
        path,
        status: gone ? 'missing' : 'ready',
        texture: gone ? null : new THREE.Texture(),
        aspect: 2,
        anchor: 0.5,
      };
      pictures.set(path, picture);
      return picture;
    },
    dispose: () => pictures.clear(),
  };
}

/** A kit over a fake library, facing straight down -z like a fresh camera. */
export function fakeKit(
  scenery: SceneryTag = 'ringroad',
  missing?: (path: string) => boolean,
): SpriteKit & { library: ReturnType<typeof fakeLibrary> } {
  const library = fakeLibrary(missing);
  const kit = createSpriteKit(library, spriteData, scenery, tuning.leanMax);
  return { ...kit, library };
}
