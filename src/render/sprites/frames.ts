import type { Rider } from '../../core/sim/types.ts';

/**
 * Which picture of a rider to draw.
 *
 * Kept apart from anything that touches Three.js so it can be tested without a
 * screen. Frame names are the file names in `public/sprites/rider/`, as listed
 * in docs/ASSET_PROMPTS.md — a test holds the two together.
 */

/** A rider picture, by file name without the extension. */
export type RiderFrame =
  | 'centre'
  | 'lean'
  | 'hard'
  | 'punch'
  | 'kick'
  | 'swing'
  | 'tumble-1'
  | 'tumble-2'
  | 'slide'
  | 'rise'
  | 'run';

/** Every rider picture, for preloading. */
export const RIDER_FRAMES: readonly RiderFrame[] = [
  'centre',
  'lean',
  'hard',
  'punch',
  'kick',
  'swing',
  'tumble-1',
  'tumble-2',
  'slide',
  'rise',
  'run',
];

/** A frame, and whether to flip it. Only right-facing art is drawn. */
export interface FrameChoice {
  frame: RiderFrame;
  mirror: boolean;
}

/** Fraction of `leanMax` past which the leaning picture replaces upright. */
const LEAN_FROM = 0.25;
/** Fraction of `leanMax` past which it is the hard-over picture. */
const HARD_FROM = 0.65;

function attackFrame(rider: Rider, out: FrameChoice): FrameChoice {
  if (rider.weapon !== null) out.frame = 'swing';
  else if (rider.attack === 'kick') out.frame = 'kick';
  else out.frame = 'punch';
  // A backhand comes across the body, so it is the punch thrown to the other
  // side. The sim records no side for an attack; the lean is the best proxy.
  if (rider.attack === 'backhand') out.mirror = !out.mirror;
  return out;
}

/**
 * Chooses the picture for a rider, writing into `out` so the per-frame loop
 * allocates nothing.
 */
export function riderFrame(
  rider: Rider,
  leanMax: number,
  out: FrameChoice,
): FrameChoice {
  // The art leans right; a left lean is the same picture flipped. A crash
  // zeroes the lean, so no crash picture is ever flipped.
  out.mirror = rider.lean < 0;

  switch (rider.state) {
    case 'airborne':
      // Chosen by whether the rider is still rising rather than by a clock, so
      // a replay draws the same tumble.
      out.frame = rider.hVel > 0 ? 'tumble-1' : 'tumble-2';
      return out;
    case 'sliding':
    case 'downed':
      out.frame = 'slide';
      return out;
    case 'rising':
      out.frame = 'rise';
      return out;
    case 'running':
      out.frame = 'run';
      return out;
    case 'attacking':
      return attackFrame(rider, out);
    default: {
      const amount = Math.abs(rider.lean) / leanMax;
      if (amount >= HARD_FROM) out.frame = 'hard';
      else if (amount >= LEAN_FROM) out.frame = 'lean';
      else out.frame = 'centre';
      return out;
    }
  }
}
