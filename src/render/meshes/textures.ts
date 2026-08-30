import * as THREE from 'three';

/**
 * Textures drawn in code, not shipped as images.
 *
 * The bundle cost of a texture generated into a canvas is the generator, not
 * the pixels — a few hundred bytes of code instead of a few hundred kilobytes
 * of PNG. It also keeps the repository free of binary files nobody can review,
 * and it is the only affordable way to give five districts genuinely different
 * road surfaces rather than five tints of one.
 *
 * Everything here runs once at load. Nothing in this file is on the frame path.
 */

/**
 * Whether a canvas can be drawn on at all.
 *
 * The test suite runs in Node with no DOM, and it checks geometry rather than
 * appearance, so every caller here has to cope with getting nothing back. A
 * material with no map is a flat colour, which is exactly what the tests were
 * looking at before this phase.
 */
export function texturesSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  );
}

/** Deterministic noise, so a rebuild produces the same asphalt every time. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function canvasOf(size: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('textures: no 2d context');
  return { canvas, ctx };
}

function finish(
  canvas: HTMLCanvasElement,
  repeat: number,
  anisotropy: number,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = anisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Speckle: the grain that stops a road reading as a flat plane at speed. */
function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: () => number,
  count: number,
  alpha: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 0.4 + rng() * 1.6;
    const shade = Math.floor(rng() * 90);
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 4},${alpha * rng()})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Asphalt, in the base colour the district asks for.
 *
 * `wear` darkens and smooths: the Ridge is coarse and unrepaired, the flyway is
 * newer and shinier, and the difference should be visible without reading the
 * scenery.
 */
export function asphaltTexture(
  base: number,
  wear: number,
  size = 256,
  anisotropy = 4,
): THREE.CanvasTexture {
  const { canvas, ctx } = canvasOf(size);
  const rng = noise(base ^ 0x9e3779b9);

  const colour = new THREE.Color(base);
  ctx.fillStyle = `#${colour.getHexString()}`;
  ctx.fillRect(0, 0, size, size);

  speckle(ctx, size, rng, Math.floor(size * size * 0.08), 0.5 * (1 - wear));

  // Patches: resurfacing, oil stains, the darker rectangles a city road picks
  // up over years. Sparse, or the road reads as camouflage.
  const patches = Math.round(4 + (1 - wear) * 6);
  for (let i = 0; i < patches; i += 1) {
    const w = size * (0.08 + rng() * 0.3);
    const h = size * (0.05 + rng() * 0.2);
    ctx.fillStyle = `rgba(0,0,0,${0.06 + rng() * 0.12})`;
    ctx.fillRect(rng() * size, rng() * size, w, h);
  }

  // Cracks, drawn as short polylines so they read as splits and not scratches.
  ctx.lineWidth = 1;
  const cracks = Math.round((1 - wear) * 14);
  for (let i = 0; i < cracks; i += 1) {
    ctx.strokeStyle = `rgba(0,0,0,${0.18 + rng() * 0.22})`;
    ctx.beginPath();
    let x = rng() * size;
    let y = rng() * size;
    ctx.moveTo(x, y);
    for (let step = 0; step < 5; step += 1) {
      x += (rng() - 0.5) * size * 0.14;
      y += (rng() - 0.5) * size * 0.14;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  return finish(canvas, 1, anisotropy);
}

/**
 * A roughness map for the same surface.
 *
 * Dark is smooth. Puddles and polished wheel tracks catch the sodium lights,
 * which is most of what makes a wet road look wet.
 */
export function asphaltRoughness(
  wet: number,
  size = 256,
  anisotropy = 4,
): THREE.CanvasTexture {
  const { canvas, ctx } = canvasOf(size);
  const rng = noise(0x5bf03635);

  const dry = Math.round(255 * (0.94 - wet * 0.25));
  ctx.fillStyle = `rgb(${dry},${dry},${dry})`;
  ctx.fillRect(0, 0, size, size);

  const pools = Math.round(wet * 22);
  for (let i = 0; i < pools; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const r = size * (0.02 + rng() * 0.09);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const centre = Math.round(255 * (0.18 + rng() * 0.2));
    gradient.addColorStop(0, `rgba(${centre},${centre},${centre},0.95)`);
    gradient.addColorStop(1, `rgba(${dry},${dry},${dry},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  speckle(ctx, size, rng, Math.floor(size * size * 0.02), 0.25);
  const texture = finish(canvas, 1, anisotropy);
  // A roughness map is data, not colour: sRGB would bend the values.
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Kerbstone: alternating blocks, for the edge of the road. */
export function kerbTexture(size = 128): THREE.CanvasTexture {
  const { canvas, ctx } = canvasOf(size);
  const rng = noise(0x2545f491);

  ctx.fillStyle = '#b9b3a4';
  ctx.fillRect(0, 0, size, size);
  const blocks = 4;
  const step = size / blocks;
  for (let i = 0; i < blocks; i += 1) {
    const shade = 150 + Math.floor(rng() * 55);
    ctx.fillStyle = `rgb(${shade},${shade - 6},${shade - 18})`;
    ctx.fillRect(0, i * step + 2, size, step - 4);
  }
  speckle(ctx, size, rng, size * 12, 0.3);
  return finish(canvas, 1, 2);
}

/**
 * Concrete, for barriers and the flyway's parapet.
 *
 * Streaked vertically, because that is what rain does to concrete and it is
 * the cheapest cue that a surface is outdoors and old.
 */
export function concreteTexture(size = 128): THREE.CanvasTexture {
  const { canvas, ctx } = canvasOf(size);
  const rng = noise(0x27d4eb2f);

  ctx.fillStyle = '#8d8b85';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i += 1) {
    const x = rng() * size;
    ctx.fillStyle = `rgba(60,58,54,${0.04 + rng() * 0.1})`;
    ctx.fillRect(x, 0, 1 + rng() * 3, size);
  }
  speckle(ctx, size, rng, size * 20, 0.35);
  return finish(canvas, 1, 2);
}

/** A soft round particle, for sparks, smoke and dust. */
export function puffTexture(size = 64): THREE.CanvasTexture {
  const { canvas, ctx } = canvasOf(size);
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
