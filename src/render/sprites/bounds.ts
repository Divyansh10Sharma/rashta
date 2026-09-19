/**
 * Where the drawn part of a picture is.
 *
 * Generated art arrives with arbitrary empty margins — from 4 px to 98 px under
 * the wheels across the traffic set — so the image edge says nothing about
 * where the road is. This reads the pixels once, at load, and never again.
 *
 * Pure: takes an RGBA buffer, so it is testable without a browser.
 */

/** The opaque part of a picture, in pixels, y down. */
export interface SpriteBounds {
  left: number;
  top: number;
  /** Exclusive. */
  right: number;
  /** Exclusive. */
  bottom: number;
  /**
   * Where the thing touches the ground, as a fraction of the bounds' width.
   *
   * The mean x of the opaque pixels along the bottom rows: the tyre on a
   * leaning bike, between the wheels on a car. Not 0.5 — a hard-lean frame
   * hangs the rider off one side, and anchoring it at the middle would jump
   * the bike sideways every time the frame changed.
   */
  anchor: number;
}

/** Alpha at or above this counts as drawn. Soft edges below it do not. */
const OPAQUE = 40;
/** How deep a strip along the bottom decides the ground contact. */
const GROUND_ROWS = 0.04;
/**
 * A picture whose border is mostly opaque was never cut out: it is a black
 * square, or a checkerboard painted in by a generator faking transparency.
 */
const BORDER_OPAQUE_LIMIT = 0.5;

function alphaAt(rgba: ArrayLike<number>, width: number, x: number, y: number) {
  return rgba[(y * width + x) * 4 + 3] ?? 0;
}

/** True when most of the one-pixel border is opaque. */
export function isFlat(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): boolean {
  let opaque = 0;
  let total = 0;
  for (let x = 0; x < width; x += 1) {
    if (alphaAt(rgba, width, x, 0) >= OPAQUE) opaque += 1;
    if (alphaAt(rgba, width, x, height - 1) >= OPAQUE) opaque += 1;
    total += 2;
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (alphaAt(rgba, width, 0, y) >= OPAQUE) opaque += 1;
    if (alphaAt(rgba, width, width - 1, y) >= OPAQUE) opaque += 1;
    total += 2;
  }
  return total > 0 && opaque / total > BORDER_OPAQUE_LIMIT;
}

function groundAnchor(
  rgba: ArrayLike<number>,
  width: number,
  box: Omit<SpriteBounds, 'anchor'>,
): number {
  const rows = Math.max(1, Math.round((box.bottom - box.top) * GROUND_ROWS));
  let sum = 0;
  let count = 0;
  for (let y = box.bottom - rows; y < box.bottom; y += 1) {
    for (let x = box.left; x < box.right; x += 1) {
      if (alphaAt(rgba, width, x, y) >= OPAQUE) {
        sum += x + 0.5;
        count += 1;
      }
    }
  }
  const span = box.right - box.left;
  return count === 0 ? 0.5 : (sum / count - box.left) / span;
}

/**
 * Measures a picture, or returns null if it cannot be drawn as a cut-out —
 * nothing opaque at all, or an opaque border (see `isFlat`).
 */
export function measureSprite(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): SpriteBounds | null {
  if (isFlat(rgba, width, height)) return null;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alphaAt(rgba, width, x, y) < OPAQUE) continue;
      if (x < left) left = x;
      if (x >= right) right = x + 1;
      if (y < top) top = y;
      if (y >= bottom) bottom = y + 1;
    }
  }
  if (right <= left || bottom <= top) return null;
  const box = { left, top, right, bottom };
  return { ...box, anchor: groundAnchor(rgba, width, box) };
}
