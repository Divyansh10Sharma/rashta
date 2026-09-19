import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isFlat, measureSprite } from '../../src/render/sprites/bounds.ts';
import {
  createSpriteLibrary,
  type LoadedPicture,
} from '../../src/render/sprites/library.ts';
import {
  composeCard,
  createFacing,
  faceAlong,
} from '../../src/render/sprites/Billboard.ts';

/**
 * Loading a picture and standing it on the road, without a browser.
 *
 * The pixel buffers here are drawn by hand, a few pixels at a time, so every
 * expected number can be worked out on paper.
 */

/** A transparent `w`×`h` picture with the given pixels filled opaque. */
function picture(
  w: number,
  h: number,
  fill: (x: number, y: number) => boolean,
): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (fill(x, y)) rgba[(y * w + x) * 4 + 3] = 255;
    }
  }
  return rgba;
}

describe('where the drawn part of a picture is', () => {
  it('finds the opaque bounds inside an empty margin', () => {
    // A 4×6 block at x 3..6, y 2..7, in a 10×10 picture.
    const rgba = picture(10, 10, (x, y) => x >= 3 && x < 7 && y >= 2 && y < 8);
    const box = measureSprite(rgba, 10, 10);
    expect(box).toMatchObject({ left: 3, top: 2, right: 7, bottom: 8 });
    expect(box?.anchor).toBeCloseTo(0.5, 9);
  });

  it('puts the anchor on what touches the ground, not the middle', () => {
    // A leaning shape: wide at the top, one pixel at the bottom-left.
    const rgba = picture(20, 20, (x, y) =>
      y === 19 ? x === 2 : y >= 5 && x >= 2 && x < 18,
    );
    const box = measureSprite(rgba, 20, 20);
    // The ground pixel's centre, 2.5, is 0.5 px into a 16 px-wide box.
    expect(box?.anchor).toBeCloseTo(0.5 / 16, 9);
  });

  it('ignores soft edges too faint to see', () => {
    const rgba = picture(8, 8, (x, y) => x >= 2 && x < 6 && y >= 2 && y < 6);
    rgba[3] = 20; // the corner pixel, faintly
    expect(measureSprite(rgba, 8, 8)).toMatchObject({ left: 2, top: 2 });
  });

  it('refuses a picture that was never cut out', () => {
    // A black square, or a checkerboard painted in: an opaque border.
    const solid = picture(8, 8, () => true);
    expect(isFlat(solid, 8, 8)).toBe(true);
    expect(measureSprite(solid, 8, 8)).toBeNull();
  });

  it('refuses a picture with nothing in it', () => {
    expect(
      measureSprite(
        picture(8, 8, () => false),
        8,
        8,
      ),
    ).toBeNull();
  });
});

describe('the sprite library', () => {
  const block = picture(10, 10, (x, y) => x >= 2 && x < 8 && y >= 4 && y < 10);
  const loaded = (): LoadedPicture => ({
    texture: new THREE.Texture(),
    rgba: block,
    width: 10,
    height: 10,
  });

  it('crops the texture to the drawn part and records its shape', () => {
    const library = createSpriteLibrary('/s/', (_url, done) => done(loaded()));
    const car = library.get('traffic/car-rear');
    expect(car.status).toBe('ready');
    expect(car.aspect).toBeCloseTo(1, 9); // 6 wide, 6 tall
    // Six of ten columns from column 2; six of ten rows, ending at the bottom.
    expect(car.texture?.repeat.x).toBeCloseTo(0.6, 9);
    expect(car.texture?.repeat.y).toBeCloseTo(0.6, 9);
    expect(car.texture?.offset.x).toBeCloseTo(0.2, 9);
    expect(car.texture?.offset.y).toBeCloseTo(0, 9);
  });

  it('fetches each picture once, by its file name', () => {
    const urls: string[] = [];
    const library = createSpriteLibrary('/base/sprites/', (url, done) => {
      urls.push(url);
      done(loaded());
    });
    expect(library.get('rider/lean')).toBe(library.get('rider/lean'));
    expect(urls).toEqual(['/base/sprites/rider/lean.webp']);
  });

  it('marks absent and uncut pictures missing, so the mesh stays up', () => {
    const quiet = console.warn;
    const warnings: string[] = [];
    console.warn = (message: string) => warnings.push(message);
    try {
      const absent = createSpriteLibrary('/', (_u, done) => done(null));
      expect(absent.get('rider/run').status).toBe('missing');

      const solid = picture(8, 8, () => true);
      const flat = createSpriteLibrary('/', (_u, done) =>
        done({
          texture: new THREE.Texture(),
          rgba: solid,
          width: 8,
          height: 8,
        }),
      );
      const punch = flat.get('rider/punch');
      expect(punch.status).toBe('missing');
      expect(punch.texture).toBeNull();
    } finally {
      console.warn = quiet;
    }
    // Loud enough to find: each warning names the file.
    expect(warnings[0]).toContain('rider/run.webp');
    expect(warnings[1]).toContain('rider/punch.webp');
  });

  it('stays loading until the file arrives', () => {
    let arrive: (() => void) | undefined;
    const library = createSpriteLibrary('/', (_u, done) => {
      arrive = () => done(loaded());
    });
    const lamp = library.get('scenery/lamp');
    expect(lamp.status).toBe('loading');
    arrive?.();
    expect(lamp.status).toBe('ready');
  });
});

describe('standing a card on the road', () => {
  const ground = new THREE.Vector3(10, 0, -40);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();

  it('puts a centred picture’s middle on the ground point', () => {
    composeCard(matrix, ground, createFacing(), 2, 3, 0.5, false);
    matrix.decompose(position, rotation, scale);
    expect(position.distanceTo(ground)).toBeLessThan(1e-9);
    expect(scale.x).toBeCloseTo(2, 9);
    expect(scale.y).toBeCloseTo(3, 9);
  });

  it('shifts the card so the anchor, not the middle, is on the ground', () => {
    // Anchor a quarter of the way in: the middle sits 0.25 × 2 m to the right.
    composeCard(matrix, ground, createFacing(), 2, 3, 0.25, false);
    const bottomAtAnchor = new THREE.Vector3(0.25 - 0.5, 0, 0).applyMatrix4(
      matrix,
    );
    expect(bottomAtAnchor.distanceTo(ground)).toBeLessThan(1e-9);
  });

  it('mirrors about the anchor, so a flipped frame does not jump sideways', () => {
    composeCard(matrix, ground, createFacing(), 2, 3, 0.25, true);
    const bottomAtAnchor = new THREE.Vector3(0.25 - 0.5, 0, 0).applyMatrix4(
      matrix,
    );
    expect(bottomAtAnchor.distanceTo(ground)).toBeLessThan(1e-9);
    expect(matrix.determinant()).toBeLessThan(0);
  });

  it('turns cards to face whoever is looking along a direction', () => {
    const facing = faceAlong(1, 0, createFacing()); // looking along +x
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      facing.quaternion,
    );
    expect(normal.x).toBeCloseTo(-1, 9);
    expect(normal.z).toBeCloseTo(0, 9);
    // Never tipped: the card's up stays world up.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(facing.quaternion);
    expect(up.y).toBeCloseTo(1, 9);
  });
});
