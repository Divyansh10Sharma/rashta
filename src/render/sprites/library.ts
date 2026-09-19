import * as THREE from 'three';
import { measureSprite } from './bounds.ts';

/**
 * The pictures in `public/sprites/`, loaded on first request and kept.
 *
 * Nothing waits on this. A view asks for a picture, gets a handle back at
 * once, and draws its old mesh until the handle says `ready` — so a race
 * starts immediately, art can land one file at a time, and a missing or
 * broken file costs a warning rather than a crash. Only what a route asks
 * for is fetched, which is what keeps a race to its own place's pictures.
 */

/** Where a picture is in its life. `missing` is final: absent or unusable. */
export type PictureStatus = 'loading' | 'ready' | 'missing';

/** One picture, as views see it. Mutated in place when it finishes loading. */
export interface Picture {
  /** Path under `sprites/`, without the extension: `rider/centre`. */
  readonly path: string;
  status: PictureStatus;
  /** Cropped to the drawn part. Null until ready. */
  texture: THREE.Texture | null;
  /** Height over width of the drawn part. */
  aspect: number;
  /** Ground contact, as a fraction of the drawn width from the left. */
  anchor: number;
}

/** A decoded picture and its pixels, as a loader hands it over. */
export interface LoadedPicture {
  texture: THREE.Texture;
  rgba: ArrayLike<number>;
  width: number;
  height: number;
}

/** Fetches and decodes one file; `null` when it is absent or undecodable. */
export type PictureLoader = (
  url: string,
  done: (loaded: LoadedPicture | null) => void,
) => void;

/** Loaded pictures, keyed by path. */
export interface SpriteLibrary {
  /** The picture at `path`, starting its load on first request. */
  get: (path: string) => Picture;
  dispose: () => void;
}

/** Crops the texture to the opaque bounds, so a quad of the right size fits. */
function crop(
  texture: THREE.Texture,
  width: number,
  height: number,
  box: { left: number; top: number; right: number; bottom: number },
): void {
  // Image textures are flipped on upload, so v runs up from the bottom row.
  texture.repeat.set(
    (box.right - box.left) / width,
    (box.bottom - box.top) / height,
  );
  texture.offset.set(box.left / width, 1 - box.bottom / height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
}

function settle(picture: Picture, loaded: LoadedPicture | null): void {
  if (!loaded) {
    picture.status = 'missing';
    console.warn(
      `sprites: ${picture.path}.webp did not load; drawing the mesh`,
    );
    return;
  }
  const box = measureSprite(loaded.rgba, loaded.width, loaded.height);
  if (!box) {
    picture.status = 'missing';
    loaded.texture.dispose();
    console.warn(
      `sprites: ${picture.path}.webp has no transparent background; ` +
        'cut it out again (docs/ASSET_PROMPTS.md, step 2)',
    );
    return;
  }
  crop(loaded.texture, loaded.width, loaded.height, box);
  picture.texture = loaded.texture;
  picture.aspect = (box.bottom - box.top) / (box.right - box.left);
  picture.anchor = box.anchor;
  picture.status = 'ready';
}

/** Creates a library that fetches `${base}${path}.webp`. */
export function createSpriteLibrary(
  base: string,
  load: PictureLoader = loadWithThree,
): SpriteLibrary {
  const pictures = new Map<string, Picture>();

  const get = (path: string): Picture => {
    const known = pictures.get(path);
    if (known) return known;
    const picture: Picture = {
      path,
      status: 'loading',
      texture: null,
      aspect: 1,
      anchor: 0.5,
    };
    pictures.set(path, picture);
    load(`${base}${path}.webp`, (loaded) => settle(picture, loaded));
    return picture;
  };

  return {
    get,
    dispose: () => {
      for (const picture of pictures.values()) picture.texture?.dispose();
      pictures.clear();
    },
  };
}

// One canvas for reading pixels, shared by every load. Load time only.
let scratch: HTMLCanvasElement | null = null;

function pixelsOf(image: CanvasImageSource, width: number, height: number) {
  scratch ??= document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

/** The browser loader: `THREE.TextureLoader`, then one pixel read. */
export const loadWithThree: PictureLoader = (url, done) => {
  new THREE.TextureLoader().load(
    url,
    (texture) => {
      const image = texture.image as HTMLImageElement;
      const rgba = pixelsOf(image, image.width, image.height);
      if (!rgba) {
        texture.dispose();
        done(null);
        return;
      }
      done({ texture, rgba, width: image.width, height: image.height });
    },
    undefined,
    () => done(null),
  );
};
