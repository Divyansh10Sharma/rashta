import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';
import { step } from '../../src/core/sim/step.ts';
import { createWorld, copyWorld } from '../../src/core/sim/world.ts';
import { parseTrack } from '../../src/core/track/load.ts';

/**
 * The frame-budget criteria that can be measured without a screen.
 *
 * A tick has to fit inside 16.6 ms alongside everything else, and the roadmap
 * asks for under 1 ms. This machine is fast, so the number here is a floor
 * rather than a verdict — the 4x-throttled browser reading is the real test,
 * and only a human can take it.
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
  'src/data/tracks/test-track.json',
  readFileSync('src/data/tracks/test-track.json', 'utf8'),
);
const bike = bikes[0];
if (!bike) throw new Error('no bikes');

describe('simulation cost', () => {
  it('runs a tick in well under 1 ms', () => {
    const world = createWorld(bike);
    const input = { throttle: 1, brake: 0, lean: 0.3 };
    const TICKS = 200_000;

    // Warm the JIT before measuring, or the first thousand ticks dominate.
    for (let i = 0; i < 20_000; i += 1) step(world, input, track, tuning);

    const start = performance.now();
    for (let i = 0; i < TICKS; i += 1) step(world, input, track, tuning);
    const msPerTick = (performance.now() - start) / TICKS;

    expect(msPerTick).toBeLessThan(1);
    // A tick doing real work should not be free either — if this ever trips,
    // the loop has probably been optimised into nothing.
    expect(msPerTick).toBeGreaterThan(0);
  });

  it('copies a world state in well under a tick', () => {
    // The loop copies state every tick so the renderer can interpolate, so the
    // copy is part of the per-tick budget.
    const from = createWorld(bike);
    const to = createWorld(bike);
    const COPIES = 500_000;

    for (let i = 0; i < 50_000; i += 1) copyWorld(from, to);
    const start = performance.now();
    for (let i = 0; i < COPIES; i += 1) copyWorld(from, to);
    const msPerCopy = (performance.now() - start) / COPIES;

    expect(msPerCopy).toBeLessThan(0.01);
  });

  it('allocates nothing per tick', () => {
    const world = createWorld(bike);
    const input = { throttle: 1, brake: 0, lean: -0.4 };
    for (let i = 0; i < 10_000; i += 1) step(world, input, track, tuning);

    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 400_000; i += 1) step(world, input, track, tuning);
    const grown = process.memoryUsage().heapUsed - before;

    expect(grown).toBeLessThan(4_000_000);
  });

  it('keeps a rider on the road for a long ride', () => {
    // Ten minutes at full throttle with the bars hard over. Nothing should
    // drift off the road, go negative, or turn into a NaN.
    const world = createWorld(bike);
    const input = { throttle: 1, brake: 0, lean: 1 };
    for (let i = 0; i < 60 * 600; i += 1) {
      step(world, input, track, tuning);
      if (world.player.pos.s > track.totalLength) world.player.pos.s = 0;
    }
    const limit = track.driveableHalfWidthAt(world.player.pos.s);
    expect(Number.isFinite(world.player.pos.t)).toBe(true);
    expect(Math.abs(world.player.pos.t)).toBeLessThanOrEqual(limit + 1e-9);
    expect(world.player.speed).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(world.player.wheelAngle)).toBe(true);
  });
});
