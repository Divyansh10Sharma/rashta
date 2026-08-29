import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';
import { FIXED_DT, step } from '../../src/core/sim/step.ts';
import { createWorld } from '../../src/core/sim/world.ts';
import { crash } from '../../src/core/sim/collide.ts';
import { segment, trackOf } from '../helpers/tracks.ts';
import type { Track } from '../../src/core/track/Track.ts';
import type {
  CrashCause,
  InputFrame,
  TunedBike,
  WorldState,
} from '../../src/core/sim/types.ts';
import { MAIN_BRANCH } from '../../src/core/types.ts';
import type { HazardSpec, SceneryTag } from '../../src/core/types.ts';

/**
 * What the rider hits, and whether they get back up from it.
 *
 * The acceptance criterion is "crash and remount round-trips reliably from
 * every crash cause", so there is a test per cause and a shared round-trip
 * assertion they all run. A cause you cannot get up from is a race that never
 * finishes, and no amount of playing would diagnose that quickly.
 */

const tuning = loadTuning(
  'src/data/tuning.json',
  JSON.parse(readFileSync('src/data/tuning.json', 'utf8')),
);

function requireBike(index: number): TunedBike {
  const bikes = loadBikes(
    'src/data/bikes.json',
    JSON.parse(readFileSync('src/data/bikes.json', 'utf8')),
    tuning,
  );
  const found = bikes[index] ?? bikes[0];
  if (!found) throw new Error('no bikes');
  return found;
}
const bike = requireBike(1);

const COAST: InputFrame = { throttle: 0, brake: 0, lean: 0 };
const GO: InputFrame = { throttle: 1, brake: 0, lean: 0 };
const WIDE_RIGHT: InputFrame = { throttle: 1, brake: 0, lean: 1 };

/** Runs `ticks` ticks, returning the world so a test can read it. */
function run(
  world: WorldState,
  track: Track,
  ticks: number,
  input: InputFrame = GO,
): WorldState {
  for (let i = 0; i < ticks; i += 1) step(world, input, track, tuning);
  return world;
}

/** A flat empty road with the given hazards on its second segment. */
function roadWith(
  hazards: HazardSpec[],
  scenery: SceneryTag = 'ringroad',
): Track {
  return trackOf(
    segment({ length: 200, scenery }),
    segment({ length: 400, scenery, hazards }),
    segment({ length: 400, scenery }),
  );
}

/**
 * Asserts the rider goes down and gets back up, and how long it cost them.
 *
 * Both halves matter. A rider who never crashed means the test proved nothing;
 * a rider who never remounts is stuck for the rest of the race.
 */
function expectRoundTrip(
  world: WorldState,
  track: Track,
  cause: CrashCause,
): void {
  let crashed = false;
  let recovered = false;
  let downFor = 0;

  for (let i = 0; i < 60 * 30; i += 1) {
    step(world, GO, track, tuning);
    const state = world.player.state;
    if (!crashed && state === 'crashing') {
      crashed = true;
      expect(world.player.crashCause).toBe(cause);
    }
    if (crashed && !recovered) {
      if (state === 'riding') recovered = true;
      else downFor += FIXED_DT;
    }
    if (recovered) break;
  }

  expect(`${cause}: crashed ${crashed}, back up ${recovered}`).toBe(
    `${cause}: crashed true, back up true`,
  );
  // The cost of a crash is time, and the data file says how much.
  expect(downFor).toBeGreaterThan(tuning.crashSeconds);
  expect(downFor).toBeLessThan(
    tuning.crashSeconds + tuning.remountSeconds + 0.2,
  );
}

describe('crash and remount round-trips from every cause', () => {
  it('rider versus traffic', () => {
    // A single-lane one-way road, so the lane centre is the centreline and a
    // stopped bus is unambiguously in the rider's way. On a two-lane road the
    // bus drives to its own lane centre and the rider goes straight past.
    const track = trackOf(
      segment({ length: 600, lanes: 1, halfWidth: 4, oneWay: true }),
      segment({ length: 600, lanes: 1, halfWidth: 4, oneWay: true }),
    );
    const world = createWorld(bike, track, 4);
    world.traffic.push({
      kind: 'bus',
      pos: { s: 120, t: 0, branchId: MAIN_BRANCH },
      speed: 0,
      cruise: 0,
      lane: 0,
      oncoming: false,
      laneChangeTimer: 999,
      active: true,
    });
    expectRoundTrip(world, track, 'traffic');
  });

  it('rider versus hazard', () => {
    const track = roadWith([{ kind: 'barricade', offset: 100, t: 0 }]);
    expectRoundTrip(createWorld(bike, track, 1), track, 'hazard');
  });

  it('rider versus cliff', () => {
    // Only on the flyway: everywhere else there is a wall to scrape.
    const track = roadWith([], 'flyway');
    expectRoundTripOffTheEdge(track);
  });
});

/** The cliff case, which needs steering input the shared helper does not give. */
function expectRoundTripOffTheEdge(track: Track): void {
  const world = createWorld(bike, track, 1);
  for (let i = 0; i < 60 * 30; i += 1) {
    step(world, WIDE_RIGHT, track, tuning);
    if (world.player.state === 'crashing') break;
  }
  expect(world.player.crashCause).toBe('cliff');

  const downAt = world.player.pos.s;
  run(world, track, 60 * 5, COAST);
  expect(world.player.state).toBe('riding');
  expect(world.player.crashCause).toBe(null);
  expect(world.player.pos.s).toBeGreaterThan(downAt);
}

describe('the crash sequence itself', () => {
  it('never locks the rider into crashing over and over', () => {
    // The infinite crash: remount where you went off, go straight off again.
    // Riding into the edge for a minute must produce repeated round trips, not
    // one crash that never ends.
    const track = roadWith([], 'flyway');
    const world = createWorld(bike, track, 1);
    let crashes = 0;
    let recoveries = 0;
    let previous = world.player.state;

    for (let i = 0; i < 60 * 60; i += 1) {
      step(world, WIDE_RIGHT, track, tuning);
      const state = world.player.state;
      if (previous !== 'crashing' && state === 'crashing') crashes += 1;
      if (previous === 'remounting' && state === 'riding') recoveries += 1;
      previous = state;
    }

    expect(crashes).toBeGreaterThan(1);
    // Every crash was got up from, give or take one still in progress at the
    // end of the minute. That is the property; distance is not, because a
    // rider crashing on repeat covers almost no ground and should not.
    expect(recoveries).toBeGreaterThanOrEqual(crashes - 1);
    expect(world.player.pos.s).toBeGreaterThan(0);
  });

  it('slides the bike on rather than stopping it dead', () => {
    const track = roadWith([{ kind: 'cow', offset: 200, t: 0 }]);
    const world = createWorld(bike, track, 1);

    while (world.player.state === 'riding' && world.player.pos.s < 900) {
      step(world, GO, track, tuning);
    }
    expect(world.player.state).toBe('crashing');

    let slid = 0;
    while (world.player.state === 'crashing') {
      const before = world.player.pos.s;
      step(world, GO, track, tuning);
      slid += world.player.pos.s - before;
    }
    expect(slid).toBeGreaterThan(1);
    expect(world.player.speed).toBe(0);
  });

  it('ignores a second crash while the rider is already down', () => {
    const world = createWorld(bike, roadWith([]), 1);
    crash(world.player, 'hazard', tuning);
    const timer = world.player.stateTimer;
    crash(world.player, 'traffic', tuning);
    expect(world.player.crashCause).toBe('hazard');
    expect(world.player.stateTimer).toBe(timer);
  });

  it('takes no steering input while the rider is down', () => {
    const track = roadWith([]);
    const world = createWorld(bike, track, 1);
    run(world, track, 60 * 8);
    crash(world.player, 'hazard', tuning);
    const t = world.player.pos.t;
    run(world, track, 30, WIDE_RIGHT);
    expect(world.player.pos.t).toBe(t);
    expect(world.player.lean).toBe(0);
  });
});

describe('hazards that cost you without taking you off', () => {
  it('takes grip away on oil and sand, and gives it back', () => {
    for (const kind of ['oil', 'sand'] as const) {
      const track = roadWith([{ kind, offset: 100, t: 0 }]);
      const world = createWorld(bike, track, 1);

      let slipped = false;
      for (let i = 0; i < 60 * 30; i += 1) {
        step(world, GO, track, tuning);
        if (world.player.slipTimer > 0) slipped = true;
        else if (slipped) break;
      }
      expect(`${kind} slipped: ${slipped}`).toBe(`${kind} slipped: true`);
      expect(world.player.state).toBe('riding');
      expect(world.player.slipTimer).toBeLessThanOrEqual(0);
    }
  });

  it('answers the bars less while the rider is on oil', () => {
    const oily = roadWith([{ kind: 'oil', offset: 100, t: 0 }]);
    const dry = roadWith([]);
    const slippery = createWorld(bike, oily, 1);
    const clean = createWorld(bike, dry, 1);

    // Both worlds get identical input; only one has oil under the wheels.
    let steered = 0;
    for (let i = 0; i < 60 * 30 && steered < 60; i += 1) {
      const slipping = slippery.player.slipTimer > 0;
      const input = slipping ? WIDE_RIGHT : GO;
      if (slipping) steered += 1;
      step(slippery, input, oily, tuning);
      step(clean, input, dry, tuning);
    }
    expect(steered).toBeGreaterThan(0);
    expect(slippery.player.pos.t).toBeLessThan(clean.player.pos.t);
  });

  it('costs speed on a pothole', () => {
    const track = roadWith([{ kind: 'pothole', offset: 300, t: 0 }]);
    const world = createWorld(bike, track, 1);

    let worstLoss = 0;
    let previous = 0;
    for (let i = 0; i < 60 * 30; i += 1) {
      step(world, GO, track, tuning);
      worstLoss = Math.max(worstLoss, previous - world.player.speed);
      previous = world.player.speed;
    }
    expect(worstLoss).toBeGreaterThan(tuning.potholeSpeedLoss - 0.5);
    expect(world.player.state).toBe('riding');
  });

  it('makes a dog survivable slowly and fatal quickly', () => {
    // The only hazard in the game whose outcome depends on how fast you are.
    const track = roadWith([{ kind: 'dog', offset: 100, t: 0 }]);

    const slow = createWorld(bike, track, 1);
    slow.player.pos.s = 295;
    slow.player.speed = tuning.dogCrashSpeed - 5;
    run(slow, track, 60 * 2, COAST);
    expect(slow.player.state).toBe('riding');
    expect(slow.player.speed).toBeLessThan(tuning.dogCrashSpeed - 5);

    const fast = createWorld(bike, track, 1);
    fast.player.pos.s = 295;
    fast.player.speed = tuning.dogCrashSpeed + 5;
    run(fast, track, 60 * 2, COAST);
    expect(fast.player.crashCause).toBe('hazard');
  });
});

describe('leaving the road', () => {
  it('is survivable anywhere there is something to scrape', () => {
    // The Old City has narrower shoulders than the flyway and is not lethal,
    // which is exactly why the rule reads the scenery tag and not the width.
    const track = roadWith([], 'oldcity');
    const world = createWorld(bike, track, 1);
    run(world, track, 60 * 20, WIDE_RIGHT);
    expect(world.player.state).toBe('riding');
    expect(world.player.crashCause).toBe(null);
  });

  it('runs out of road at the far edge of the shoulder, not the tarmac', () => {
    const track = trackOf(segment({ length: 900, scenery: 'flyway' }));
    const world = createWorld(bike, track, 1);
    for (let i = 0; i < 60 * 30; i += 1) {
      step(world, WIDE_RIGHT, track, tuning);
      if (world.player.state !== 'riding') break;
    }
    const seg = track.segmentAt(world.player.pos.s);
    // Past the tarmac, and only just past the shoulder: riders get to use it.
    expect(Math.abs(world.player.pos.t)).toBeGreaterThan(seg.halfWidth);
    expect(Math.abs(world.player.pos.t)).toBeCloseTo(
      seg.halfWidth + seg.shoulder,
      6,
    );
  });
});
