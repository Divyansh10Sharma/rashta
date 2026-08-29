import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FixedStepDriver } from '../../src/app/FixedStepDriver.ts';
import { createRng } from '../../src/core/rng.ts';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';
import { FIXED_DT, step } from '../../src/core/sim/step.ts';
import { createWorld } from '../../src/core/sim/world.ts';
import { parseTrack } from '../../src/core/track/load.ts';
import type {
  InputFrame,
  TunedBike,
  WorldState,
} from '../../src/core/sim/types.ts';

/**
 * CLAUDE.md rule 4, made testable.
 *
 * There is no `Math.random` to catch here — lint already does that. What this
 * proves is the harder half: that the simulation's result depends on the input
 * sequence and nothing else, in particular not on how the render loop happened
 * to be scheduled.
 */

const tuning = loadTuning(
  'src/data/tuning.json',
  JSON.parse(readFileSync('src/data/tuning.json', 'utf8')),
);
const bikes = loadBikes(
  'src/data/bikes.json',
  JSON.parse(readFileSync('src/data/bikes.json', 'utf8')),
  tuning,
);
const track = parseTrack(
  'src/data/tracks/straight.json',
  readFileSync('src/data/tracks/straight.json', 'utf8'),
);
function requireBike(index: number): TunedBike {
  const found = bikes[index] ?? bikes[0];
  if (!found) throw new Error('no bikes in the data file');
  return found;
}
const bike = requireBike(1);

const TICKS = 3600; // one minute of riding

/** A deterministic, twitchy input sequence — braking, weaving, lifting off. */
function recordInputs(seed: number, count: number): InputFrame[] {
  const rng = createRng(seed);
  const frames: InputFrame[] = [];
  let lean = 0;
  for (let i = 0; i < count; i += 1) {
    lean += rng.nextRange(-0.09, 0.09);
    lean = Math.max(-1, Math.min(1, lean));
    frames.push({
      throttle: rng.next() < 0.82 ? 1 : 0,
      brake: rng.next() < 0.06 ? rng.next() : 0,
      lean,
    });
  }
  return frames;
}

/** Runs the sequence straight through, one tick per frame. */
function runDirect(frames: InputFrame[]): WorldState {
  const world = createWorld(bike, track);
  for (const frame of frames) step(world, frame, track, tuning);
  return world;
}

/**
 * Runs the same sequence through the real accumulator, fed a jittered wall
 * clock — the situation a player on a laggy machine is actually in.
 */
function runJittered(frames: InputFrame[], seed: number): WorldState {
  const world = createWorld(bike, track);
  const driver = new FixedStepDriver();
  const rng = createRng(seed);
  let consumed = 0;

  while (consumed < frames.length) {
    // Anything from a 240 Hz frame to a 12 Hz stutter.
    const elapsed = rng.nextRange(1 / 240, 1 / 12);
    const steps = driver.advance(elapsed);
    for (let i = 0; i < steps && consumed < frames.length; i += 1) {
      const frame = frames[consumed];
      if (!frame) break;
      step(world, frame, track, tuning);
      consumed += 1;
    }
  }
  return world;
}

/** Every number the simulation owns, as an exact string. */
function fingerprint(world: WorldState): string {
  const p = world.player;
  return [
    world.tick,
    p.pos.s,
    p.pos.t,
    p.pos.branchId,
    p.speed,
    p.lateral,
    p.lean,
    p.wheelAngle,
    p.stamina,
    p.state,
  ]
    .map(String)
    .join('|');
}

describe('replay determinism', () => {
  const frames = recordInputs(0xbadc0de, TICKS);

  it('produces a bit-identical world when replayed twice', () => {
    expect(fingerprint(runDirect(frames))).toBe(fingerprint(runDirect(frames)));
  });

  it('produces the same world under a jittered wall clock', () => {
    // The whole point of the fixed timestep. A player at 30 fps and one at
    // 144 fps pressing the same buttons must get the same race.
    const steady = fingerprint(runDirect(frames));
    expect(fingerprint(runJittered(frames, 1))).toBe(steady);
    expect(fingerprint(runJittered(frames, 99))).toBe(steady);
  });

  it('actually moved, so the comparison is not of two empty worlds', () => {
    const world = runDirect(frames);
    expect(world.tick).toBe(TICKS);
    expect(world.player.pos.s).toBeGreaterThan(1000);
    expect(Math.abs(world.player.pos.t)).toBeGreaterThan(0.5);
  });

  it('diverges for a different input sequence', () => {
    const other = recordInputs(0xbadc0de + 1, TICKS);
    expect(fingerprint(runDirect(other))).not.toBe(
      fingerprint(runDirect(frames)),
    );
  });
});

describe('the fixed-step accumulator', () => {
  it('runs one tick per frame at exactly 60 fps', () => {
    const driver = new FixedStepDriver();
    for (let i = 0; i < 100; i += 1) expect(driver.advance(FIXED_DT)).toBe(1);
  });

  it('runs two ticks per frame at 30 fps', () => {
    const driver = new FixedStepDriver();
    for (let i = 0; i < 100; i += 1)
      expect(driver.advance(FIXED_DT * 2)).toBe(2);
  });

  it('runs a tick roughly every other frame at 144 fps', () => {
    const driver = new FixedStepDriver();
    let ticks = 0;
    for (let i = 0; i < 1440; i += 1) ticks += driver.advance(1 / 144);
    // Ten seconds of 144 Hz frames is 600 ticks in exact arithmetic, but
    // 1/144 is not representable in binary, so 1440 of them sum to a hair
    // under ten seconds and the last tick has not quite fired. Landing within
    // one tick is the correct expectation; the remainder stays in the
    // accumulator rather than being lost, so this does not drift.
    expect(ticks).toBeGreaterThanOrEqual(599);
    expect(ticks).toBeLessThanOrEqual(600);
  });

  it('does not drift over a long session', () => {
    const driver = new FixedStepDriver();
    let ticks = 0;
    const minutes = 10;
    for (let i = 0; i < 144 * 60 * minutes; i += 1)
      ticks += driver.advance(1 / 144);
    const ideal = 60 * 60 * minutes;
    expect(Math.abs(ticks - ideal)).toBeLessThanOrEqual(1);
  });

  it('caps a long stall instead of spiralling', () => {
    const driver = new FixedStepDriver();
    expect(driver.advance(5)).toBe(5);
    expect(driver.droppedTicks).toBe(295);
    // And recovers immediately rather than working through a backlog.
    expect(driver.advance(FIXED_DT)).toBe(1);
  });

  it('ignores a non-advancing or nonsensical clock', () => {
    const driver = new FixedStepDriver();
    expect(driver.advance(0)).toBe(0);
    expect(driver.advance(-1)).toBe(0);
    expect(driver.advance(Number.NaN)).toBe(0);
  });

  it('reports an interpolation alpha inside [0, 1)', () => {
    const driver = new FixedStepDriver();
    const rng = createRng(5);
    for (let i = 0; i < 500; i += 1) {
      driver.advance(rng.nextRange(0.001, 0.05));
      expect(driver.alpha).toBeGreaterThanOrEqual(0);
      expect(driver.alpha).toBeLessThan(1);
    }
  });
});
