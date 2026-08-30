import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTrackLibrary } from '../../src/core/track/library.ts';
import { progress } from '../../src/core/track/distance.ts';
import { createFrame } from '../../src/core/track/path.ts';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';
import { step } from '../../src/core/sim/step.ts';
import { createWorld } from '../../src/core/sim/world.ts';
import { MAIN_BRANCH } from '../../src/core/types.ts';
import type { Track } from '../../src/core/track/Track.ts';
import type { TunedBike } from '../../src/core/sim/types.ts';

const DIR = 'src/data/tracks';
const ROUTES = [
  'ridge-run',
  'yamuna-bank',
  'ring-road',
  'old-city',
  'dnd-flyway',
];
const TIERS = [1, 2, 3, 4, 5];

/** Every route file on disk, keyed by filename, as the loader wants them. */
function routeFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const name of readdirSync(DIR)) {
    if (!ROUTES.some((r) => name.startsWith(`${r}-t`))) continue;
    files[name] = JSON.parse(readFileSync(`${DIR}/${name}`, 'utf8'));
  }
  return files;
}

const library = loadTrackLibrary(routeFiles());

const tuning = loadTuning(
  'src/data/tuning.json',
  JSON.parse(readFileSync('src/data/tuning.json', 'utf8')),
);
const bikes = loadBikes(
  'src/data/bikes.json',
  JSON.parse(readFileSync('src/data/bikes.json', 'utf8')),
  tuning,
);
function requireBike(index: number): TunedBike {
  const found = bikes[index] ?? bikes[0];
  if (!found) throw new Error('no bikes in the data file');
  return found;
}
const bike = requireBike(1);

function trackFor(route: string, tier: number): Track {
  const track = library.get(`${route}-t${tier}`);
  if (!track) throw new Error(`missing ${route}-t${tier}`);
  return track;
}

/** Rides a track flat out and reports whether it completed, and how long it took. */
function rideToEnd(track: Track): { finished: boolean; seconds: number } {
  const world = createWorld(bike, track);
  // These tests are about the road, not about what is on it. A rider holding
  // full throttle down the centre of a two-way road meets oncoming traffic
  // head-on forever, which says nothing about whether the route is traversable.
  world.traffic.length = 0;
  const input = { throttle: 1, brake: 0, lean: 0 };
  const maxTicks = 60 * 60 * 30; // half an hour of sim, far beyond any route
  for (let i = 0; i < maxTicks; i += 1) {
    step(world, input, track, tuning);
    if (!Number.isFinite(world.player.pos.s))
      return { finished: false, seconds: 0 };
    if (
      world.player.pos.branchId === MAIN_BRANCH &&
      world.player.pos.s >= track.totalLength
    ) {
      return { finished: true, seconds: world.tick / 60 };
    }
  }
  return { finished: false, seconds: maxTicks / 60 };
}

describe('the five routes, five tiers each', () => {
  it('loads all 25', () => {
    expect(library.size).toBe(25);
    for (const route of ROUTES) {
      for (const tier of TIERS) {
        expect(library.has(`${route}-t${tier}`)).toBe(true);
      }
    }
  });

  /**
   * Milliseconds for the fastest of three runs.
   *
   * A single wall-clock reading is not a measurement of this code — it is a
   * measurement of whatever else the machine was doing, and under the parallel
   * test run that is a lot. Contention can only ever inflate a timing, never
   * deflate one below the true cost, so the minimum is the sample least
   * contaminated by it. A genuinely slow build still fails every run.
   */
  function fastestMs(run: () => unknown): number {
    let best = Infinity;
    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();
      run();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  }

  it('validates all 25 files in well under 200 ms', () => {
    const files = routeFiles();
    expect(fastestMs(() => loadTrackLibrary(files))).toBeLessThan(200);
  });

  it('builds any single track in well under 200 ms', () => {
    // The criterion that matters at runtime: the game rides one track. Tier 5
    // is the worst case at roughly 28 km of precomputed frames. A fresh
    // library each run, because a built track is cached and the second read
    // would measure the cache rather than the build.
    for (const route of ROUTES) {
      let track;
      const ms = fastestMs(() => {
        track = loadTrackLibrary(routeFiles()).get(`${route}-t5`);
      });
      expect(track).toBeDefined();
      expect(`${route}-t5 built in ${ms < 200 ? 'under' : 'over'} 200 ms`).toBe(
        `${route}-t5 built in under 200 ms`,
      );
    }
  });

  it('caches a built track rather than rebuilding it', () => {
    const fresh = loadTrackLibrary(routeFiles());
    expect(fresh.get('ring-road-t1')).toBe(fresh.get('ring-road-t1'));
  });

  it('runs about 8 km at tier 1, per GAME_DESIGN.md', () => {
    for (const route of ROUTES) {
      const km = trackFor(route, 1).totalLength / 1000;
      expect(km).toBeGreaterThanOrEqual(7);
      expect(km).toBeLessThanOrEqual(9);
    }
  });

  it('gives every route a different length, so they are not one road', () => {
    const lengths = ROUTES.map((r) => Math.round(trackFor(r, 1).totalLength));
    expect(new Set(lengths).size).toBe(ROUTES.length);
  });

  it('gives every route a distinct scenery character', () => {
    const tags = new Set(ROUTES.map((r) => trackFor(r, 1).data.scenery));
    expect(tags.size).toBe(5);
  });

  it('never names a real brand', () => {
    const text = JSON.stringify(routeFiles()).toLowerCase();
    for (const word of [
      'bullet',
      'honda',
      'hero',
      'bajaj',
      'royal enfield',
      'dtc',
    ]) {
      expect(`${word}: ${String(text.includes(word))}`).toBe(`${word}: false`);
    }
  });
});

describe('tier extension', () => {
  it('makes each tier a strict prefix-extension of the one below', () => {
    for (const route of ROUTES) {
      for (const tier of [2, 3, 4, 5]) {
        const below = trackFor(route, tier - 1).data.segments;
        const above = trackFor(route, tier).data.segments;
        expect(above.length).toBeGreaterThan(below.length);
        // The shared prefix must be identical, not merely similar: a tier that
        // silently re-authored an earlier corner would break every lap time
        // and every fork position in the tiers below it.
        expect(above.slice(0, below.length)).toEqual(below);
      }
    }
  });

  it('grows each tier by 4-6 km, per GAME_DESIGN.md', () => {
    for (const route of ROUTES) {
      for (const tier of [2, 3, 4, 5]) {
        const added =
          trackFor(route, tier).totalLength -
          trackFor(route, tier - 1).totalLength;
        expect(added).toBeGreaterThanOrEqual(4000);
        expect(added).toBeLessThanOrEqual(6000);
      }
    }
  });

  it('inherits tier 1 forks into every tier above, unmoved', () => {
    for (const route of ROUTES) {
      const base = trackFor(route, 1).branches;
      for (const tier of [2, 3, 4, 5]) {
        const above = trackFor(route, tier).branches;
        expect(above.length).toBe(base.length);
        for (let i = 0; i < base.length; i += 1) {
          expect(above[i]?.forkS).toBe(base[i]?.forkS);
          expect(above[i]?.rejoinS).toBe(base[i]?.rejoinS);
        }
      }
    }
  });
});

describe('every fork on every tier', () => {
  it('has at least two per route', () => {
    for (const route of ROUTES) {
      expect(trackFor(route, 1).branches.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('closes geometrically and rejoins at equal progress', () => {
    const branchEnd = createFrame();
    const mainAt = createFrame();
    for (const route of ROUTES) {
      for (const tier of TIERS) {
        const track = trackFor(route, tier);
        track.branches.forEach((branch, i) => {
          const branchId = i + 1;
          const endS = branch.forkS + branch.path.length;

          track.sample(endS, branchEnd, branchId);
          track.sample(branch.rejoinS, mainAt, MAIN_BRANCH);
          // The branch rejoins offset by `entryT` — a slip road merges back at
          // the edge of the road, not down its centre.
          mainAt.position.addScaledVector(mainAt.right, branch.entryT);
          expect(branchEnd.position.distanceTo(mainAt.position)).toBeLessThan(
            0.5,
          );

          const viaBranch = progress({ s: endS, t: 0, branchId }, track);
          const viaMain = progress(
            { s: branch.rejoinS, t: 0, branchId: MAIN_BRANCH },
            track,
          );
          expect(viaBranch).toBeCloseTo(viaMain, 6);
        });
      }
    }
  });

  it('differs from the route it replaces by no more than 5%', () => {
    for (const route of ROUTES) {
      for (const tier of TIERS) {
        for (const branch of trackFor(route, tier).branches) {
          const span = branch.rejoinS - branch.forkS;
          const delta = Math.abs(branch.path.length - span) / span;
          expect(delta).toBeLessThanOrEqual(0.05);
        }
      }
    }
  });

  it('is traversable end to end without a NaN', () => {
    const frame = createFrame();
    for (const route of ROUTES) {
      const track = trackFor(route, 1);
      track.branches.forEach((branch, i) => {
        const branchId = i + 1;
        for (let d = 0; d <= branch.path.length; d += 2) {
          track.sample(branch.forkS + d, frame, branchId);
          expect(Number.isFinite(frame.position.x)).toBe(true);
          expect(Number.isFinite(frame.position.z)).toBe(true);
        }
      });
    }
  });
});

describe('rideability', () => {
  it('rides all 25 tier-tracks from start to finish', () => {
    for (const route of ROUTES) {
      for (const tier of TIERS) {
        const track = trackFor(route, tier);
        const { finished } = rideToEnd(track);
        expect(`${route}-t${tier}: ${finished ? 'finished' : 'STUCK'}`).toBe(
          `${route}-t${tier}: finished`,
        );
      }
    }
  });

  it('keeps the rider on the road the whole way', () => {
    for (const route of ROUTES) {
      const track = trackFor(route, 5);
      const world = createWorld(bike, track);
      world.traffic.length = 0;
      const input = { throttle: 1, brake: 0, lean: 0.35 };

      // Accumulate the worst overrun and assert once. An `expect` per tick is
      // ~150,000 assertions across five 28 km routes, which is slow enough to
      // trip the default timeout and tells you nothing extra when it passes.
      let worstOverrun = 0;
      let worstAt = 0;
      while (
        world.player.pos.s < track.totalLength &&
        world.tick < 60 * 60 * 30
      ) {
        step(world, input, track, tuning);
        const limit = track.driveableHalfWidthAt(
          world.player.pos.s,
          world.player.pos.branchId,
        );
        const overrun = Math.abs(world.player.pos.t) - limit;
        if (overrun > worstOverrun) {
          worstOverrun = overrun;
          worstAt = world.player.pos.s;
        }
      }
      expect(`${route} worst overrun ${worstOverrun.toFixed(9)} m`).toBe(
        `${route} worst overrun ${(0).toFixed(9)} m`,
      );
      expect(worstAt).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the library rejects bad data, naming the file', () => {
  const good = () => ({
    id: 'a',
    name: 'A',
    scenery: 'ringroad',
    trafficDensity: 0,
    policeDensity: 0,
    segments: [
      {
        length: 100,
        curvature: 0,
        gradient: 0,
        bank: 0,
        halfWidth: 8,
        shoulder: 2,
        lanes: 3,
        oneWay: false,
        scenery: 'ringroad',
        hazards: [],
      },
    ],
    branches: [],
  });

  const withFile = (raw: unknown) => () =>
    loadTrackLibrary({ 'bad.json': raw });

  it('rejects a file that is not an object', () => {
    expect(withFile(null)).toThrow(/bad\.json: track must be a JSON object/);
    expect(withFile(7)).toThrow(/bad\.json: track must be a JSON object/);
  });

  it('rejects a missing or blank id', () => {
    expect(withFile({ ...good(), id: '' })).toThrow(/bad\.json: id/);
  });

  it('rejects a missing name', () => {
    expect(withFile({ ...good(), name: 42 })).toThrow(/bad\.json: name/);
  });

  it('rejects an unknown scenery tag', () => {
    expect(withFile({ ...good(), scenery: 'mars' })).toThrow(
      /bad\.json: scenery/,
    );
  });

  it('rejects a traffic density that is missing or negative', () => {
    // Density is read during extends resolution, before a track is ever built,
    // so a bad value has to be caught there as well as in full validation.
    expect(withFile({ ...good(), trafficDensity: -1 })).toThrow(
      /bad\.json: trafficDensity/,
    );
    expect(withFile({ ...good(), trafficDensity: 'lots' })).toThrow(
      /bad\.json: trafficDensity/,
    );
    expect(withFile({ ...good(), policeDensity: -1 })).toThrow(
      /bad\.json: policeDensity/,
    );
    expect(withFile({ ...good(), policeDensity: 'some' })).toThrow(
      /bad\.json: policeDensity/,
    );
  });

  it('rejects a non-string extends', () => {
    expect(withFile({ ...good(), extends: 5 })).toThrow(/bad\.json: extends/);
    expect(withFile({ ...good(), extends: '' })).toThrow(/bad\.json: extends/);
  });

  it('rejects branches that are not an array', () => {
    expect(withFile({ ...good(), branches: {} })).toThrow(
      /bad\.json: branches/,
    );
  });

  it('rejects extending a track that does not exist', () => {
    expect(withFile({ ...good(), extends: 'nowhere' })).toThrow(
      /extends "nowhere", which is not a known track id/,
    );
  });

  it('rejects two files claiming the same id', () => {
    expect(() =>
      loadTrackLibrary({ 'one.json': good(), 'two.json': good() }),
    ).toThrow(/id "a" is already used by one\.json/);
  });

  it('rejects an extends cycle rather than recursing forever', () => {
    const a = { ...good(), id: 'a', extends: 'b' };
    const b = { ...good(), id: 'b', extends: 'a' };
    expect(() => loadTrackLibrary({ 'a.json': a, 'b.json': b })).toThrow(
      /extends forms a cycle/,
    );
  });

  it('rejects a branch whose span does not fit the assembled track', () => {
    // The point of resolving before checking. The branch's own span is
    // self-consistent, so the 5% rule passes during file validation; only once
    // the chain is assembled is its 200 m total known and the fork revealed to
    // be off the end of it.
    const base = { ...good(), id: 'base' };
    const tier2 = {
      ...good(),
      id: 'tier2',
      extends: 'base',
      branches: [
        {
          id: 'b',
          entryT: 0,
          forkS: 500,
          rejoinS: 600,
          segments: good().segments,
        },
      ],
    };
    expect(() =>
      loadTrackLibrary({ 'base.json': base, 'tier2.json': tier2 }),
    ).toThrow(/branches\[0\]\.forkS must be within \[0, 200\)/);
  });
});

describe('the routes actually carry hazards', () => {
  /** Ends your race rather than merely costing you. Mirrors collide.ts. */
  const CRASHING = new Set(['barricade', 'roadworks', 'cow']);
  /** How close the rider must be to a hazard to be affected. See collide.ts. */
  const REACH = 1.6;

  function trackFor(id: string): Track {
    const track = library.get(id);
    if (!track) throw new Error(`missing ${id}`);
    return track;
  }

  it('puts some on every route, and more on every tier', () => {
    // A hazard system nothing ever meets is a system that does not exist.
    for (const route of ROUTES) {
      const counts = TIERS.map(
        (t) => trackFor(`${route}-t${t}`).hazards.length,
      );
      expect(`${route} t1 hazards`).toBe(`${route} t1 hazards`);
      expect(counts[0] ?? 0).toBeGreaterThan(0);
      for (let i = 1; i < counts.length; i += 1) {
        // Tiers inherit the road below them, so they inherit its hazards too.
        expect(counts[i] ?? 0).toBeGreaterThan(counts[i - 1] ?? 0);
      }
    }
  });

  it('never blocks the whole road with something that ends your race', () => {
    // A barricade you cannot get round is not a hazard, it is a wall. Oil and
    // potholes are exempt: riding through them is meant to be an option.
    for (const route of ROUTES) {
      const track = trackFor(`${route}-t5`);
      let tightest = Infinity;
      let where = '';

      for (const hazard of track.hazards) {
        if (!CRASHING.has(hazard.kind)) continue;
        const limit = track.driveableHalfWidthAt(hazard.s, hazard.branchId);
        const left = hazard.t - REACH - -limit;
        const right = limit - (hazard.t + REACH);
        const gap = Math.max(left, right);
        if (gap < tightest) {
          tightest = gap;
          where = `${hazard.kind} at s=${hazard.s.toFixed(0)}`;
        }
      }
      if (tightest === Infinity) continue;

      expect(`${route}: tightest way past is ${tightest.toFixed(2)} m`).toBe(
        `${route}: tightest way past is ${tightest.toFixed(2)} m`,
      );
      expect(`${route} ${where}: ${tightest > 1 ? 'passable' : 'walled'}`).toBe(
        `${route} ${where}: passable`,
      );
    }
  });

  it('spaces them, so you never meet two at once', () => {
    for (const route of ROUTES) {
      const track = trackFor(`${route}-t5`);
      const hazards = track.hazards;
      let closest = Infinity;
      for (let i = 1; i < hazards.length; i += 1) {
        const a = hazards[i - 1];
        const b = hazards[i];
        if (!a || !b || a.branchId !== b.branchId) continue;
        closest = Math.min(closest, b.s - a.s);
      }
      expect(`${route} closest pair ${closest.toFixed(1)} m`).toBe(
        `${route} closest pair ${closest.toFixed(1)} m`,
      );
      expect(closest).toBeGreaterThan(2 * REACH);
    }
  });
});
