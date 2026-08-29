import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTrackLibrary } from '../../src/core/track/library.ts';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';
import { FORK_CAPTURE_T, step } from '../../src/core/sim/step.ts';
import { createWorld } from '../../src/core/sim/world.ts';
import { progress } from '../../src/core/track/distance.ts';
import { MAIN_BRANCH } from '../../src/core/types.ts';
import type { Track } from '../../src/core/track/Track.ts';
import type { TunedBike, WorldState } from '../../src/core/sim/types.ts';

/**
 * Taking a fork, and coming back off it.
 *
 * Which branch a rider takes is decided by the branch's own opening curvature
 * rather than by a field in the data — drift toward the side the road peels
 * off and you are on it. These tests pin that rule and the rejoin.
 */

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
const bike = requireBike(0);

function trackFor(id: string): Track {
  const track = library.get(id);
  if (!track) throw new Error(`missing ${id}`);
  return track;
}

/**
 * Rides a track, leaning toward one side as each fork approaches and
 * straightening up in between — which is what a rider does, and what makes
 * this a test of route selection rather than of survival.
 *
 * Holding full lean the whole way is not a neutral choice: on the DND Flyway
 * it means riding the edge of an elevated road with no barrier, so the rider
 * falls off over and over and covers a fifth of the route. Correct behaviour,
 * useless test.
 */
function rideHolding(
  track: Track,
  lean: number,
): {
  world: WorldState;
  branchesUsed: Set<number>;
  rejoined: boolean;
} {
  const world = createWorld(bike, track);
  // Route selection is the thing under test; traffic would just add crashes.
  world.traffic.length = 0;
  const approaching = (s: number): boolean =>
    track.branches.some((br) => s > br.forkS - 220 && s < br.forkS + 5);
  const input = { throttle: 1, brake: 0, lean: 0 };
  const branchesUsed = new Set<number>();
  let leftMainAt = -1;
  let rejoined = false;

  for (let i = 0; i < 60 * 60 * 20; i += 1) {
    input.lean =
      world.player.pos.branchId === MAIN_BRANCH &&
      approaching(world.player.pos.s)
        ? lean
        : 0;
    step(world, input, track, tuning);
    const id = world.player.pos.branchId;
    if (id !== MAIN_BRANCH) {
      branchesUsed.add(id);
      leftMainAt = id;
    } else if (leftMainAt !== -1) {
      rejoined = true;
    }
    if (id === MAIN_BRANCH && world.player.pos.s >= track.totalLength) break;
  }
  return { world, branchesUsed, rejoined };
}

describe('taking a fork', () => {
  it('puts a rider hugging the right onto the right-hand branch', () => {
    // ring-road's first fork, `flyover`, opens to the right.
    const track = trackFor('ring-road-t1');
    const { branchesUsed } = rideHolding(track, 1);
    expect(branchesUsed.has(1)).toBe(true);
  });

  it('puts a rider hugging the left onto the left-hand branch', () => {
    // and its second, `service-lane`, opens to the left.
    const track = trackFor('ring-road-t1');
    const { branchesUsed } = rideHolding(track, -1);
    expect(branchesUsed.has(2)).toBe(true);
  });

  it('leaves a rider on the centreline on the main path throughout', () => {
    const track = trackFor('ring-road-t1');
    const { branchesUsed } = rideHolding(track, 0);
    expect(branchesUsed.size).toBe(0);
  });

  it('returns to the main path at the rejoin', () => {
    const track = trackFor('ring-road-t1');
    const { world, rejoined } = rideHolding(track, 1);
    expect(rejoined).toBe(true);
    expect(world.player.pos.branchId).toBe(MAIN_BRANCH);
  });

  it('finishes the route however the forks were taken', () => {
    for (const route of ROUTES) {
      const track = trackFor(`${route}-t1`);
      for (const lean of [-1, 0, 1]) {
        const { world } = rideHolding(track, lean);
        expect(`${route} lean ${lean}: ${world.player.pos.branchId}`).toBe(
          `${route} lean ${lean}: ${MAIN_BRANCH}`,
        );
        expect(world.player.pos.s).toBeGreaterThanOrEqual(track.totalLength);
      }
    }
  });
});

describe('the capture rule', () => {
  it('ignores a rider barely off the centreline at the split', () => {
    const track = trackFor('ring-road-t1');
    const branch = track.branches[0];
    if (!branch) throw new Error('no branch');

    const world = createWorld(bike, track);
    world.player.pos.s = branch.forkS - 1;
    world.player.pos.t = FORK_CAPTURE_T - 0.2;
    world.player.speed = 30;
    step(world, { throttle: 0, brake: 0, lean: 0 }, track, tuning);
    expect(world.player.pos.branchId).toBe(MAIN_BRANCH);
  });

  it('will not let a rider enter a branch narrower than their offset', () => {
    // old-city's `spice-lane` is 2.6 m of road either side. A rider 3.5 m off
    // centre cannot be on it, and snapping them inward would read as the road
    // yanking them sideways.
    const track = trackFor('old-city-t1');
    const branch = track.branches[1];
    if (!branch) throw new Error('no second branch');

    const world = createWorld(bike, track);
    world.player.pos.s = branch.forkS - 1;
    world.player.pos.t = 3.5;
    world.player.speed = 30;
    step(world, { throttle: 0, brake: 0, lean: 0 }, track, tuning);
    expect(world.player.pos.branchId).toBe(MAIN_BRANCH);
  });
});

describe('progress across a fork', () => {
  it('never goes backwards, whichever route is taken', () => {
    const track = trackFor('ring-road-t1');
    const world = createWorld(bike, track);
    const input = { throttle: 1, brake: 0, lean: 1 };
    let previous = -Infinity;

    for (let i = 0; i < 60 * 60 * 20; i += 1) {
      step(world, input, track, tuning);
      const p = progress(world.player.pos, track);
      // The whole reason progress() exists: `s` jumps at a rejoin, and a race
      // standing sorted on it would show riders swapping places for no reason.
      expect(p).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = p;
      if (
        world.player.pos.branchId === MAIN_BRANCH &&
        world.player.pos.s >= track.totalLength
      )
        break;
    }
  });

  it('costs the long way round a little progress, not a lot', () => {
    const track = trackFor('ring-road-t1');
    const viaBranch = rideHolding(track, 1).world.tick;
    const viaMain = rideHolding(track, 0).world.tick;
    // Both routes exist to be a real choice: neither should be a shortcut.
    const delta = Math.abs(viaBranch - viaMain) / viaMain;
    expect(delta).toBeLessThan(0.15);
  });
});
