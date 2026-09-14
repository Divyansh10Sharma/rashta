import './style.css';
import bikesJson from '../data/bikes.json';
import tuningJson from '../data/tuning.json';
import racersJson from '../data/racers.json';
import combatJson from '../data/combat.json';
import policeJson from '../data/police.json';
import { loadTrackLibrary } from '../core/track/library.ts';

import { loadBikes, loadTuning } from '../core/sim/load.ts';
import { loadRacers, PLAYER_ID } from '../core/ai/load.ts';
import { loadCombat } from '../core/combat/load.ts';
import { loadPolice } from '../core/police/load.ts';
import {
  copyRace,
  createRace,
  playerEntry,
  stepRace,
} from '../core/sim/race.ts';
import { Input } from '../input/Input.ts';
import { createStage } from '../render/Stage.ts';
import { createHud } from '../ui/Hud.ts';
import { createStaminaBars } from '../ui/StaminaBars.ts';
import { engagedWith } from '../core/combat/combat.ts';
import { glowFor } from '../render/FieldView.ts';
import { createFrame } from '../core/track/path.ts';
import { createDevOverlay, StepTimer } from '../ui/DevOverlay.ts';
import { FrameMeter } from '../ui/FrameMeter.ts';
import { FixedStepDriver } from './FixedStepDriver.ts';
import { isDown } from '../core/sim/crash.ts';

/**
 * The game loop, exactly as ARCHITECTURE.md 2 describes it.
 *
 * The simulation advances in identical 1/60 s ticks. Rendering happens at
 * whatever rate the display runs at, and interpolates between the two most
 * recent simulation states — without that, a 144 Hz monitor shows 60 Hz
 * stutter, and with it a 30 Hz one still looks smooth.
 */

const READOUT_INTERVAL_MS = 250;

function run(canvas: HTMLCanvasElement): void {
  const tuning = loadTuning('tuning.json', tuningJson);
  const bikes = loadBikes('bikes.json', bikesJson, tuning);
  // Every route file, resolved as one library so `extends` can find its base.
  const files = import.meta.glob('../data/tracks/*-t*.json', { eager: true });
  const raw: Record<string, unknown> = {};
  for (const [path, module] of Object.entries(files)) {
    raw[path.split('/').pop() ?? path] = (
      module as { default: unknown }
    ).default;
  }
  const library = loadTrackLibrary(raw);

  // Which route to ride is a menu in Phase 8; until then it is the URL, so
  // every one of the 25 can actually be looked at.
  const wanted =
    new URLSearchParams(location.search).get('track') ?? 'ring-road-t1';
  const track = library.get(wanted) ?? library.get('ring-road-t1');
  if (!track)
    throw new Error(`no track "${wanted}" and no ring-road-t1 either`);

  const racers = loadRacers('racers.json', racersJson);
  const combat = loadCombat('combat.json', combatJson);
  const police = loadPolice('police.json', policeJson);
  const byId = new Map(bikes.map((b) => [b.spec.id, b]));
  const bikeFor = (profile: { startingBike: string }) => {
    const found = byId.get(profile.startingBike);
    if (!found)
      throw new Error(`racers.json: no bike "${profile.startingBike}"`);
    return found;
  };

  // Two states so the renderer can interpolate between them.
  // Seeded from the URL so a race can be handed to someone else exactly.
  const asked = Number(new URLSearchParams(location.search).get('seed') ?? 1);
  const seed = Number.isFinite(asked) ? asked : 1;
  const current = createRace(
    racers,
    PLAYER_ID,
    bikeFor,
    track,
    combat,
    police,
    seed,
  );
  const previous = createRace(
    racers,
    PLAYER_ID,
    bikeFor,
    track,
    combat,
    police,
    seed,
  );
  const me = playerEntry(current);
  const bike = me.rider.bike;

  const input = new Input();
  input.attach();

  const stage = createStage(
    canvas,
    track,
    current.traffic.length,
    current.entries.length - 1,
    current.police.length,
  );
  stage.chase.reset(0);

  const hud = createHud(document.body);
  const stamina = createStaminaBars(document.body);
  const dev = createDevOverlay(document.body);
  const meter = new FrameMeter(120);
  const stepTimer = new StepTimer(120);
  const driver = new FixedStepDriver();

  // Scratch for turning a track position into a world one for effects. Reused
  // rather than allocated: this runs every frame.
  const effectFrame = createFrame();
  const world = {
    x: 0,
    y: 0,
    z: 0,
    set(s: number, t: number, branchId: number) {
      track.sample(s, effectFrame, branchId);
      this.x = effectFrame.position.x + effectFrame.right.x * t;
      this.y = effectFrame.position.y + effectFrame.right.y * t;
      this.z = effectFrame.position.z + effectFrame.right.z * t;
    },
  };
  const downLast = new Map<string, boolean>();

  let lastFrameMs = performance.now();
  let lastReadout = lastFrameMs;
  let visibleChunks = 0;

  const frame = (now: number): void => {
    const elapsedMs = now - lastFrameMs;
    lastFrameMs = now;
    meter.record(elapsedMs);

    const ticks = driver.advance(elapsedMs / 1000);
    if (ticks > 0) {
      // Input is latched once and reused for every tick this frame, so the
      // simulation cannot tell how the loop was scheduled.
      const frameInput = input.sample();
      const before = performance.now();
      for (let i = 0; i < ticks; i += 1) {
        copyRace(current, previous);
        stepRace(current, frameInput, track, tuning);
      }
      stepTimer.record((performance.now() - before) / ticks);
    }

    const alpha = driver.alpha;
    const a = playerEntry(previous).rider;
    const b = me.rider;
    const s = a.pos.s + (b.pos.s - a.pos.s) * alpha;
    const t = a.pos.t + (b.pos.t - a.pos.t) * alpha;
    const lean = a.lean + (b.lean - a.lean) * alpha;
    const wheel = a.wheelAngle + (b.wheelAngle - a.wheelAngle) * alpha;
    const speed = a.speed + (b.speed - a.speed) * alpha;

    // Traffic is interpolated from the same pair of states the rider is, so a
    // bus and the bike it is about to hit move in the same time.
    stage.traffic.update(previous.traffic, current.traffic, alpha);
    // Rivals interpolate off the same pair of states, so the bike you are
    // about to be pushed into is where the simulation says it is.
    stage.field.update(previous.entries, current.entries, alpha, track, combat);
    stage.field.updatePolice(
      previous.police,
      current.police,
      alpha,
      track,
      combat,
    );

    visibleChunks = stage.sync(
      s,
      t,
      lean,
      wheel,
      speed / bike.topSpeedMs,
      b.pos.branchId,
      elapsedMs / 1000,
    );

    stage.renderer.render(stage.scene, stage.camera);
    hud.update(speed, bike.topSpeedMs, tuning);

    // Who you are fighting is the nearest rider in range, which is also who
    // the second bar belongs to — see GAME_DESIGN.md, Combat.
    const foe = engagedWith(b, current.riders, track, combat);
    const foeEntry =
      foe === null
        ? null
        : (current.entries.find((e) => e.rider === foe) ?? null);
    stamina.update(
      b.stamina,
      foe === null ? null : foe.stamina,
      foeEntry?.profile.name ?? '',
      b.weapon === null ? null : combat.weapons[b.weapon].name,
    );
    stage.rider.highlight(glowFor(b, combat), b.staggerTimer > 0);

    // Effects read the simulation and never write to it. A rider going down
    // throws sparks once, on the tick they go down — the same edge the damage
    // model uses, so one crash is one shower rather than one a frame.
    for (const entry of current.entries) {
      const down = isDown(entry.rider);
      const wasDown = downLast.get(entry.profile.id) === true;
      if (down && !wasDown) {
        world.set(
          entry.rider.pos.s,
          entry.rider.pos.t,
          entry.rider.pos.branchId,
        );
        stage.particles.emit('spark', world.x, world.y + 0.4, world.z, 14);
        stage.particles.emit('smoke', world.x, world.y + 0.5, world.z, 5);
      }
      downLast.set(entry.profile.id, down);

      // Dust off the shoulder: only the player, and only when actually out
      // near the edge, or every race is a sandstorm.
      if (entry.isPlayer && !isDown(entry.rider)) {
        const edge = track.driveableHalfWidthAt(
          entry.rider.pos.s,
          entry.rider.pos.branchId,
        );
        const near = Math.abs(entry.rider.pos.t) > edge - 0.9;
        if (near && entry.rider.speed > 12 && current.tick % 4 === 0) {
          world.set(
            entry.rider.pos.s,
            entry.rider.pos.t,
            entry.rider.pos.branchId,
          );
          stage.particles.emit('dust', world.x, world.y, world.z, 1);
        }
      }
    }
    stage.particles.update(Math.min(elapsedMs / 1000, 0.05), stage.camera);

    if (now - lastReadout >= READOUT_INTERVAL_MS) {
      dev.update(
        {
          s,
          t,
          speedMs: speed,
          branchId: b.pos.branchId,
          screenX: stage.riderScreenX(),
          simMs: stepTimer.mean(),
          ticksThisFrame: ticks,
          droppedTicks: driver.droppedTicks,
          visibleChunks,
          sceneryCount: stage.scenery.count,
          drawCalls: stage.renderer.info.render.calls,
        },
        meter.stats(),
      );
      lastReadout = now;
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (!canvas) throw new Error('index.html is missing #stage');
run(canvas);
