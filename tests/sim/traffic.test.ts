import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTrackLibrary } from '../../src/core/track/library.ts';
import { trackDistance } from '../../src/core/track/distance.ts';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';
import { step } from '../../src/core/sim/step.ts';
import { createWorld } from '../../src/core/sim/world.ts';
import {
  TRAFFIC_AHEAD,
  TRAFFIC_BEHIND,
  TRAFFIC_SIZES,
  laneCentre,
} from '../../src/core/sim/traffic.ts';
import type { Track } from '../../src/core/track/Track.ts';
import type { TunedBike, WorldState } from '../../src/core/sim/types.ts';

const ROUTES = [
  'ridge-run',
  'yamuna-bank',
  'ring-road',
  'old-city',
  'dnd-flyway',
];

function routeFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const name of readdirSync('src/data/tracks')) {
    if (!ROUTES.some((r) => name.startsWith(`${r}-t`))) continue;
    files[name] = JSON.parse(readFileSync(`src/data/tracks/${name}`, 'utf8'));
  }
  return files;
}

const library = loadTrackLibrary(routeFiles());
const tuning = loadTuning(
  't',
  JSON.parse(readFileSync('src/data/tuning.json', 'utf8')),
);
const bikes = loadBikes(
  'b',
  JSON.parse(readFileSync('src/data/bikes.json', 'utf8')),
  tuning,
);

function requireBike(index: number): TunedBike {
  const found = bikes[index] ?? bikes[0];
  if (!found) throw new Error('no bikes');
  return found;
}
const bike = requireBike(1);

function trackFor(id: string): Track {
  const track = library.get(id);
  if (!track) throw new Error(`missing ${id}`);
  return track;
}

/** Rides down the centre for `seconds`, returning the world. */
function ride(track: Track, seconds: number, seed = 7): WorldState {
  const world = createWorld(bike, track, seed);
  const input = { throttle: 1, brake: 0, lean: 0 };
  for (let i = 0; i < 60 * seconds; i += 1) step(world, input, track, tuning);
  return world;
}

describe('traffic density is a per-tier data value', () => {
  it('rises with every tier, on every route', () => {
    for (const route of ROUTES) {
      const densities = [1, 2, 3, 4, 5].map(
        (t) => trackFor(`${route}-t${t}`).data.trafficDensity,
      );
      for (let i = 1; i < densities.length; i += 1) {
        expect(`${route} t${i + 1}`).toBe(`${route} t${i + 1}`);
        expect(densities[i] ?? 0).toBeGreaterThan(densities[i - 1] ?? 0);
      }
    }
  });

  it('differs between routes at the same tier, by character', () => {
    // The Ring Road is busier than the Ridge because that is what those roads
    // are, not because it is harder. A tier lookup table could not say that.
    const ring = trackFor('ring-road-t1').data.trafficDensity;
    const ridge = trackFor('ridge-run-t1').data.trafficDensity;
    expect(ring).toBeGreaterThan(ridge * 3);
  });

  it('observably changes how many vehicles are on the road', () => {
    const sparse = ride(trackFor('ridge-run-t1'), 20).traffic.length;
    const heavy = ride(trackFor('ring-road-t5'), 20).traffic.length;
    expect(heavy).toBeGreaterThan(sparse * 3);
  });
});

describe('no two vehicles ever overlap', () => {
  it('keeps every pair apart by their combined footprint, in metres', () => {
    // Measured with trackDistance, not a raw (s, t) box — the roadmap says so
    // explicitly, because a box is a curved wedge in the world and would let
    // vehicles overlap on the inside of a bend.
    for (const id of ['ring-road-t5', 'old-city-t5', 'yamuna-bank-t3']) {
      const track = trackFor(id);
      const world = createWorld(bike, track, 3);
      const input = { throttle: 1, brake: 0, lean: 0 };

      let worst = Infinity;
      let worstPair = '';
      for (let i = 0; i < 60 * 90; i += 1) {
        step(world, input, track, tuning);
        if (i % 7 !== 0) continue;
        for (let a = 0; a < world.traffic.length; a += 1) {
          const va = world.traffic[a];
          if (!va?.active) continue;
          for (let b = a + 1; b < world.traffic.length; b += 1) {
            const vb = world.traffic[b];
            if (!vb?.active) continue;
            if (va.pos.branchId !== vb.pos.branchId) continue;

            // A footprint is two-dimensional. Two buses abreast in different
            // lanes are within a bus-length of each other and are not
            // touching, so the along-track gap is measured with the lateral
            // difference removed, and width is checked separately.
            const lateral = Math.abs(va.pos.t - vb.pos.t);
            const along = trackDistance(
              va.pos,
              { s: vb.pos.s, t: va.pos.t, branchId: vb.pos.branchId },
              track,
            );
            const needAlong =
              (TRAFFIC_SIZES[va.kind].length + TRAFFIC_SIZES[vb.kind].length) /
              2;
            const needWide =
              (TRAFFIC_SIZES[va.kind].width + TRAFFIC_SIZES[vb.kind].width) / 2;

            // Clearance is how far from overlapping they are on the axis that
            // separates them best.
            const clear = Math.max(along - needAlong, lateral - needWide);
            if (clear < worst) {
              worst = clear;
              worstPair = `${va.kind}/${vb.kind}`;
            }
          }
        }
      }
      expect(`${id}: closest ${worst.toFixed(2)} m clear (${worstPair})`).toBe(
        `${id}: closest ${worst.toFixed(2)} m clear (${worstPair})`,
      );
      expect(worst).toBeGreaterThan(0);
    }
  });

  it('bunches vehicles behind a slow one rather than driving through it', () => {
    // Car following is what makes the guarantee hold rather than be likely,
    // and the queue it produces is what makes traffic read as a city.
    const track = trackFor('ring-road-t5');
    const world = ride(track, 60, 11);
    const slowed = world.traffic.filter(
      (v) => v.active && v.speed < v.cruise - 0.5,
    );
    expect(slowed.length).toBeGreaterThan(0);
  });
});

describe('the spawn ring', () => {
  it('never changes the entity count', () => {
    const track = trackFor('ring-road-t5');
    const world = createWorld(bike, track, 5);
    const before = world.traffic.length;
    expect(before).toBeGreaterThan(10);

    const input = { throttle: 1, brake: 0, lean: 0 };
    for (let i = 0; i < 60 * 600; i += 1) {
      step(world, input, track, tuning);
      if (i % 3600 === 0) expect(world.traffic.length).toBe(before);
    }
    expect(world.traffic.length).toBe(before);
  });

  it('keeps traffic in a window around the rider over a ten-minute ride', () => {
    const track = trackFor('ring-road-t5');
    const world = createWorld(bike, track, 9);
    const input = { throttle: 1, brake: 0, lean: 0 };

    let worstBehind = 0;
    for (let i = 0; i < 60 * 600; i += 1) {
      step(world, input, track, tuning);
      if (i % 60 !== 0) continue;
      for (const v of world.traffic) {
        if (!v.active) continue;
        const behind = world.player.pos.s - v.pos.s;
        if (behind > worstBehind) worstBehind = behind;
      }
    }
    // Oncoming traffic runs the other way, so it goes further behind before
    // the recycle catches it. A generous bound still proves it is bounded.
    expect(worstBehind).toBeLessThan(TRAFFIC_BEHIND + TRAFFIC_AHEAD);
  });

  it('reuses the same vehicle objects rather than allocating new ones', () => {
    const track = trackFor('ring-road-t3');
    const world = createWorld(bike, track, 2);
    const identities = world.traffic.map((v) => v);
    const positions = world.traffic.map((v) => v.pos);

    const input = { throttle: 1, brake: 0, lean: 0 };
    for (let i = 0; i < 60 * 300; i += 1) step(world, input, track, tuning);

    for (let i = 0; i < identities.length; i += 1) {
      expect(world.traffic[i]).toBe(identities[i]);
      expect(world.traffic[i]?.pos).toBe(positions[i]);
    }
  });
});

describe('lanes', () => {
  it('places lane centres symmetrically across the road', () => {
    expect(laneCentre(2, 0, 8)).toBeCloseTo(-4, 9);
    expect(laneCentre(2, 1, 8)).toBeCloseTo(4, 9);
    expect(laneCentre(4, 0, 8)).toBeCloseTo(-6, 9);
    expect(laneCentre(4, 3, 8)).toBeCloseTo(6, 9);
    expect(laneCentre(1, 0, 5)).toBeCloseTo(0, 9);
  });

  it('runs oncoming traffic only on two-way roads', () => {
    // The flyway is one-way, which is most of why it is the fastest route.
    const flyway = ride(trackFor('dnd-flyway-t3'), 40, 4);
    expect(flyway.traffic.some((v) => v.active)).toBe(true);
    expect(flyway.traffic.some((v) => v.active && v.oncoming)).toBe(false);

    const ring = ride(trackFor('ring-road-t3'), 40, 4);
    expect(ring.traffic.some((v) => v.active && v.oncoming)).toBe(true);
  });

  it('keeps every vehicle within the road it is on', () => {
    const track = trackFor('old-city-t4');
    const world = createWorld(bike, track, 6);
    const input = { throttle: 1, brake: 0, lean: 0 };

    let worstOverrun = 0;
    for (let i = 0; i < 60 * 120; i += 1) {
      step(world, input, track, tuning);
      if (i % 11 !== 0) continue;
      for (const v of world.traffic) {
        if (!v.active) continue;
        const limit = track.driveableHalfWidthAt(v.pos.s, v.pos.branchId);
        worstOverrun = Math.max(worstOverrun, Math.abs(v.pos.t) - limit);
      }
    }
    expect(worstOverrun).toBeLessThanOrEqual(0.5);
  });
});
