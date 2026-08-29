import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  curveAt,
  inverseCurveIntegral,
  tuneBike,
} from '../../src/core/sim/bike.ts';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';
import { createWorld } from '../../src/core/sim/world.ts';
import { FIXED_DT, step } from '../../src/core/sim/step.ts';
import { parseTrack } from '../../src/core/track/load.ts';
import type { TunedBike } from '../../src/core/sim/types.ts';

const tuning = loadTuning(
  'src/data/tuning.json',
  JSON.parse(readFileSync('src/data/tuning.json', 'utf8')),
);
const bikes = loadBikes(
  'src/data/bikes.json',
  JSON.parse(readFileSync('src/data/bikes.json', 'utf8')),
  tuning,
);
const straight = parseTrack(
  'src/data/tracks/straight.json',
  readFileSync('src/data/tracks/straight.json', 'utf8'),
);

/** Runs full throttle from rest and returns seconds to reach `fraction` of top speed. */
function timeToReach(bike: TunedBike, fraction: number): number {
  const world = createWorld(bike);
  const input = { throttle: 1, brake: 0, lean: 0 };
  const target = bike.topSpeedMs * fraction;
  for (let tick = 0; tick < 60 * 120; tick += 1) {
    step(world, input, straight, tuning);
    if (world.player.speed >= target) return world.tick * FIXED_DT;
  }
  return Number.POSITIVE_INFINITY;
}

describe('the acceleration curve', () => {
  it('interpolates linearly between control points', () => {
    const curve = [1, 0.8, 0.6, 0.4, 0.2];
    expect(curveAt(curve, 0)).toBeCloseTo(1, 12);
    expect(curveAt(curve, 0.25)).toBeCloseTo(0.8, 12);
    expect(curveAt(curve, 1)).toBeCloseTo(0.2, 12);
    expect(curveAt(curve, 0.125)).toBeCloseTo(0.9, 12);
    expect(curveAt(curve, 0.875)).toBeCloseTo(0.3, 12);
  });

  it('clamps outside [0, 1]', () => {
    const curve = [1, 0.8, 0.6, 0.4, 0.2];
    expect(curveAt(curve, -5)).toBeCloseTo(1, 12);
    expect(curveAt(curve, 5)).toBeCloseTo(0.2, 12);
  });

  it('integrates 1/f exactly for a flat curve', () => {
    // f(u) = 0.5 everywhere, so the integral of 1/f over [0,1] is exactly 2.
    expect(inverseCurveIntegral([0.5, 0.5, 0.5, 0.5, 0.5], 400)).toBeCloseTo(
      2,
      9,
    );
  });

  it('forces an odd slice count even, since Simpson needs pairs', () => {
    const curve = [1, 0.9, 0.8, 0.7, 0.6];
    expect(inverseCurveIntegral(curve, 101)).toBeCloseTo(
      inverseCurveIntegral(curve, 102),
      12,
    );
  });
});

describe('the authority split in GAME_DESIGN.md', () => {
  it('reaches topSpeed in timeToTopSpeed, within 5%, for every bike', () => {
    for (const bike of bikes) {
      const seconds = timeToReach(bike, 0.999);
      const error =
        Math.abs(seconds - bike.spec.timeToTopSpeed) / bike.spec.timeToTopSpeed;
      expect(error).toBeLessThan(0.05);
    }
  });

  it('never exceeds topSpeed however long the throttle is held', () => {
    for (const bike of bikes) {
      const world = createWorld(bike);
      const input = { throttle: 1, brake: 0, lean: 0 };
      for (let i = 0; i < 60 * 90; i += 1) step(world, input, straight, tuning);
      expect(world.player.speed).toBeLessThanOrEqual(bike.topSpeedMs);
      expect(world.player.speed).toBeCloseTo(bike.topSpeedMs, 6);
    }
  });

  it('leaves time-to-top-speed unchanged when the curve is scaled', () => {
    // The property that makes accelCurve safe to tune by feel: it carries
    // shape, not magnitude. Doubling every entry must change nothing here.
    const bike = bikes[0];
    if (!bike) throw new Error('no bikes');
    const doubled = tuneBike(
      { ...bike.spec, accelCurve: bike.spec.accelCurve.map((v) => v * 2) },
      tuning.accelIntegralSlices,
    );
    expect(doubled.accelScale).toBeCloseTo(bike.accelScale / 2, 9);

    const a = timeToReach(bike, 0.99);
    const b = timeToReach(doubled, 0.99);
    expect(b).toBeCloseTo(a, 6);
  });

  it('gives a faster bike a shorter run to top speed', () => {
    const street = bikes.find((b) => b.spec.class === 'street');
    const superbike = bikes.find((b) => b.spec.class === 'super');
    if (!street || !superbike)
      throw new Error('need a street and a super bike');
    expect(timeToReach(superbike, 0.99)).toBeLessThan(
      timeToReach(street, 0.99),
    );
    expect(superbike.topSpeedMs).toBeGreaterThan(street.topSpeedMs);
  });
});

describe('the data file', () => {
  it('holds one bike of each class, all with distinct ids', () => {
    const classes = new Set(bikes.map((b) => b.spec.class));
    expect(classes.size).toBe(3);
    expect(new Set(bikes.map((b) => b.spec.id)).size).toBe(bikes.length);
  });

  it('keeps every class inside its GAME_DESIGN speed band', () => {
    const bands = {
      street: [150, 190],
      sport: [190, 235],
      super: [235, 280],
    } as const;
    for (const bike of bikes) {
      const [lo, hi] = bands[bike.spec.class];
      expect(bike.spec.topSpeed).toBeGreaterThanOrEqual(lo);
      expect(bike.spec.topSpeed).toBeLessThanOrEqual(hi);
    }
  });

  it('names no real manufacturer or model', () => {
    // CLAUDE.md is emphatic about this and it is easy to breach by accident.
    const banned = [
      'bullet',
      'pulsar',
      'splendor',
      'apache',
      'duke',
      'classic',
      'meteor',
      'hunter',
      'interceptor',
      'himalayan',
      'scram',
      'perak',
      'avenger',
      'dominar',
      'gixxer',
      'raider',
      'ronin',
      'karizma',
      'unicorn',
      'shine',
      'hornet',
      'ninja',
      'panigale',
      'monster',
      'harley',
      'royal enfield',
      'honda',
      'yamaha',
      'suzuki',
      'kawasaki',
      'bajaj',
      'hero',
      'tvs',
      'ktm',
      'jawa',
      'ducati',
      'triumph',
      'bmw',
      'aprilia',
      'benelli',
    ];
    const text = JSON.stringify(bikes.map((b) => b.spec)).toLowerCase();
    for (const word of banned) {
      expect(`${word}: ${String(text.includes(word))}`).toBe(`${word}: false`);
    }
  });
});
