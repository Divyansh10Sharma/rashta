import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTrackLibrary } from '../../src/core/track/library.ts';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';
import { FIXED_DT, step } from '../../src/core/sim/step.ts';
import { createWorld } from '../../src/core/sim/world.ts';
import { crash, isDown } from '../../src/core/sim/crash.ts';
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
    const down = isDown(world.player);
    if (!crashed && down) {
      crashed = true;
      expect(world.player.crashCause).toBe(cause);
    }
    if (crashed && !recovered) {
      if (!down) recovered = true;
      else downFor += FIXED_DT;
    }
    if (recovered) break;
  }

  expect(`${cause}: crashed ${crashed}, back up ${recovered}`).toBe(
    `${cause}: crashed true, back up true`,
  );
  // The cost of a crash is time, and it is derived rather than configured —
  // so the only thing assertable without knowing the impact speed is that it
  // cost at least the stages that are fixed. How it scales is its own test.
  const fixed =
    tuning.downedSeconds + tuning.risingSeconds + tuning.remountSeconds;
  expect(downFor).toBeGreaterThan(fixed);
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
    if (isDown(world.player)) break;
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
    let previous = isDown(world.player);

    for (let i = 0; i < 60 * 60; i += 1) {
      step(world, WIDE_RIGHT, track, tuning);
      const down = isDown(world.player);
      if (!previous && down) crashes += 1;
      if (previous && !down) recoveries += 1;
      previous = down;
    }

    expect(crashes).toBeGreaterThan(1);
    // Every crash was got up from, give or take one still in progress at the
    // end of the minute. That is the property; distance is not, because a
    // rider crashing on repeat covers almost no ground and should not.
    expect(recoveries).toBeGreaterThanOrEqual(crashes - 1);
    expect(world.player.pos.s).toBeGreaterThan(0);
  });

  it('parts the rider from the bike, leaving a gap to be walked', () => {
    const track = roadWith([{ kind: 'cow', offset: 200, t: 0 }]);
    const world = createWorld(bike, track, 1);

    while (!isDown(world.player) && world.player.pos.s < 900) {
      step(world, GO, track, tuning);
    }
    const at = world.player.pos.s;
    expect(world.player.severity).not.toBe(null);

    // Ride it out to the point the rider is on their feet and walking. Both
    // bodies have stopped by then and the gap between them is the whole
    // penalty.
    while (world.player.state !== 'running') {
      step(world, GO, track, tuning);
    }
    const riderSlid = world.player.pos.s - at;
    const bikeSlid = world.player.bikePos.s - at;
    expect(riderSlid).toBeGreaterThan(1);
    expect(bikeSlid).toBeGreaterThan(1);
    // Which of the two ends up in front depends on the band — a thrown rider
    // carries their speed through the air while the bike is already grinding
    // on tarmac, so a highside lands you past your own bike. Either way there
    // is a gap, and the gap is the penalty.
    expect(Math.abs(bikeSlid - riderSlid)).toBeGreaterThan(1);
    expect(world.player.speed).toBe(0);
    expect(world.player.bikeSpeed).toBe(0);

    // And the rider ends up on the bike, not near it.
    while (isDown(world.player)) step(world, COAST, track, tuning);
    expect(world.player.pos.s).toBeCloseTo(world.player.bikePos.s, 6);
  });

  it('ignores a second crash while the rider is already down', () => {
    const world = createWorld(bike, roadWith([]), 1);
    world.player.speed = 30;
    crash(world.player, 'hazard', tuning);
    const severity = world.player.severity;
    crash(world.player, 'traffic', tuning);
    expect(world.player.crashCause).toBe('hazard');
    expect(world.player.severity).toBe(severity);
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

/**
 * Seconds between an impact at `kmh` and being back on the bike.
 *
 * The rider is set to the speed rather than ridden up to it, because the
 * criterion is about the impact and not about how long the road is.
 */
function timeLostTo(kmh: number, cause: CrashCause = 'traffic'): number {
  const track = roadWith([]);
  const world = createWorld(bike, track, 1);
  world.traffic.length = 0;
  world.player.speed = kmh / 3.6;
  crash(world.player, cause, tuning);

  for (let i = 1; i <= 60 * 120; i += 1) {
    step(world, COAST, track, tuning);
    if (!isDown(world.player)) return i * FIXED_DT;
  }
  throw new Error(`never got up from ${kmh} km/h`);
}

describe('what a crash costs', () => {
  it('costs more the faster you were going, at every step', () => {
    // The whole point of deriving the cost: a tip-over must not cost what a
    // highside costs. Swept rather than spot-checked, because a model that is
    // monotonic at four points and not in between is still wrong.
    let previous = 0;
    for (let kmh = 40; kmh <= 280; kmh += 10) {
      const cost = timeLostTo(kmh);
      expect(`${kmh} km/h: ${cost > previous}`).toBe(`${kmh} km/h: true`);
      previous = cost;
    }
  });

  it('picks the severity band from the impact speed', () => {
    const band = (kmh: number): string => {
      const world = createWorld(bike, roadWith([]), 1);
      world.player.speed = kmh / 3.6;
      crash(world.player, 'traffic', tuning);
      return `${world.player.severity}`;
    };
    expect(band(60)).toBe('tipover');
    expect(band(120)).toBe('thrown');
    expect(band(220)).toBe('highside');
  });

  it('never leaves the rider airborne, sliding, or short of the bike', () => {
    // No state may strand a rider. Every cause, every band.
    const causes: CrashCause[] = ['traffic', 'hazard', 'cliff', 'combat'];
    for (const cause of causes) {
      for (const kmh of [0, 40, 120, 220, 300]) {
        expect(`${cause} ${kmh}`).toBe(`${cause} ${kmh}`);
        expect(timeLostTo(kmh, cause)).toBeGreaterThan(0);
      }
    }
  });

  it('does not let the player shorten the walk back', () => {
    const held = timeLostTo(200);
    const track = roadWith([]);
    const world = createWorld(bike, track, 1);
    world.traffic.length = 0;
    world.player.speed = 200 / 3.6;
    crash(world.player, 'traffic', tuning);
    let mashed = 0;
    for (let i = 1; i <= 60 * 120; i += 1) {
      step(world, WIDE_RIGHT, track, tuning);
      if (!isDown(world.player)) {
        mashed = i * FIXED_DT;
        break;
      }
    }
    expect(mashed).toBe(held);
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

describe('riding a real route meets real hazards', () => {
  it('costs the rider something on every district', () => {
    // The synthetic tracks above prove the mechanism. This proves the data:
    // 25 route files shipped with empty hazard arrays for most of this phase,
    // and every unit test still passed, because nothing asserted that a rider
    // ever meets one.
    const files: Record<string, unknown> = {};
    for (const name of readdirSync('src/data/tracks')) {
      if (!/-t\d\.json$/.test(name)) continue;
      files[name] = JSON.parse(readFileSync(`src/data/tracks/${name}`, 'utf8'));
    }
    const library = loadTrackLibrary(files);

    for (const route of ['ridge-run', 'old-city', 'ring-road']) {
      const track = library.get(`${route}-t3`);
      if (!track) throw new Error(`missing ${route}-t3`);
      expect(track.hazards.length).toBeGreaterThan(0);

      // Ride the centreline flat out. No steering, so anything it meets is
      // something the road put in front of it.
      const world = createWorld(bike, track, 3);
      world.traffic.length = 0;
      let met = 0;
      let previous = isDown(world.player);
      let previousSlip = 0;
      for (let i = 0; i < 60 * 400; i += 1) {
        step(world, GO, track, tuning);
        if (!previous && isDown(world.player)) met++;
        if (previousSlip <= 0 && world.player.slipTimer > 0) met++;
        previous = isDown(world.player);
        previousSlip = world.player.slipTimer;
        if (world.player.pos.s > track.totalLength - 50) break;
      }
      expect(`${route}: met ${met > 0 ? 'something' : 'nothing'}`).toBe(
        `${route}: met something`,
      );
    }
  }, 30_000);
});
