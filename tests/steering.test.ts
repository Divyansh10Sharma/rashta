import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  defaultKeyBindings,
  defaultPadBindings,
} from '../src/input/bindings.ts';
import { resolveInput } from '../src/input/resolve.ts';
import { loadBikes, loadTuning } from '../src/core/sim/load.ts';
import { step } from '../src/core/sim/step.ts';
import { createWorld } from '../src/core/sim/world.ts';
import { parseTrack } from '../src/core/track/load.ts';
import { createRiderView } from '../src/render/Rider.ts';
import { ChaseCamera } from '../src/render/ChaseCamera.ts';
import type { TunedBike } from '../src/core/sim/types.ts';

/**
 * The whole chain, from a key press to a pixel's worth of direction.
 *
 * Every other test in this repo checks one link. This one runs the actual
 * binding, the actual simulation, the actual rider view and the actual chase
 * camera, and asks the only question a player asks: I pressed right — did it
 * go right?
 */

const tuning = loadTuning(
  't',
  JSON.parse(readFileSync('src/data/tuning.json', 'utf8')),
);
const bikes = loadBikes(
  'b',
  JSON.parse(readFileSync('src/data/bikes.json', 'utf8')),
  tuning,
);
const track = parseTrack(
  's',
  readFileSync('src/data/tracks/straight.json', 'utf8'),
);
function requireBike(index: number): TunedBike {
  const found = bikes[index] ?? bikes[0];
  if (!found) throw new Error('no bikes in the data file');
  return found;
}
const bike = requireBike(1);

const keys = defaultKeyBindings();
const pads = defaultPadBindings();

/** Presses a key for a second and returns where the rider ends up on screen. */
function ride(code: string): { t: number; lean: number; screenX: number } {
  const world = createWorld(bike, track);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 900);
  const chase = new ChaseCamera(camera);
  const rider = createRiderView();

  // Get up to speed first, then steer.
  const straight = resolveInput(new Set(['KeyW']), keys, null, pads);
  for (let i = 0; i < 180; i += 1) step(world, straight, track, tuning);

  chase.reset(world.player.pos.t);
  for (let i = 0; i < 60; i += 1) {
    chase.update(
      track,
      world.player.pos.s,
      world.player.pos.t,
      world.player.speed / bike.topSpeedMs,
      0,
      1 / 60,
    );
  }

  const turning = resolveInput(new Set(['KeyW', code]), keys, null, pads);
  for (let i = 0; i < 60; i += 1) {
    step(world, turning, track, tuning);
    chase.update(
      track,
      world.player.pos.s,
      world.player.pos.t,
      world.player.speed / bike.topSpeedMs,
      0,
      1 / 60,
    );
  }

  camera.updateMatrixWorld(true);
  rider.update(
    track,
    world.player.pos.s,
    world.player.pos.t,
    world.player.lean,
    world.player.wheelAngle,
    0,
  );
  const local = rider.group.position
    .clone()
    .applyMatrix4(camera.matrixWorldInverse);
  rider.dispose();
  return { t: world.player.pos.t, lean: world.player.lean, screenX: local.x };
}

describe('press right, go right', () => {
  const right = ride('KeyD');
  const left = ride('KeyA');

  it('moves the rider to positive t when right is pressed', () => {
    expect(right.t).toBeGreaterThan(0.5);
  });

  it('leans the bike right when right is pressed', () => {
    expect(right.lean).toBeGreaterThan(0);
  });

  it('puts the rider RIGHT of screen centre when right is pressed', () => {
    expect(right.screenX).toBeGreaterThan(0);
  });

  it('agrees: lean direction and screen direction have the same sign', () => {
    // The reported bug in one assertion. Leaning one way while travelling the
    // other is exactly the mismatch this catches.
    expect(Math.sign(right.lean)).toBe(Math.sign(right.screenX));
    expect(Math.sign(left.lean)).toBe(Math.sign(left.screenX));
  });

  it('mirrors for left', () => {
    expect(left.t).toBeLessThan(-0.5);
    expect(left.lean).toBeLessThan(0);
    expect(left.screenX).toBeLessThan(0);
  });
});
