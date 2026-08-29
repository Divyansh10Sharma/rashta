import './style.css';
import bikesJson from '../data/bikes.json';
import tuningJson from '../data/tuning.json';
import { loadTrackLibrary } from '../core/track/library.ts';

import { loadBikes, loadTuning } from '../core/sim/load.ts';
import { step } from '../core/sim/step.ts';
import { copyWorld, createWorld } from '../core/sim/world.ts';
import { Input } from '../input/Input.ts';
import { createStage } from '../render/Stage.ts';
import { createHud } from '../ui/Hud.ts';
import { createDevOverlay, StepTimer } from '../ui/DevOverlay.ts';
import { FrameMeter } from '../ui/FrameMeter.ts';
import { FixedStepDriver } from './FixedStepDriver.ts';

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

  const bike = bikes[1] ?? bikes[0];
  if (!bike) throw new Error('bikes.json contained no bikes');

  // Two states so the renderer can interpolate between them.
  const current = createWorld(bike);
  const previous = createWorld(bike);

  const input = new Input();
  input.attach();

  const stage = createStage(canvas, track);
  stage.chase.reset(0);

  const hud = createHud(document.body);
  const dev = createDevOverlay(document.body);
  const meter = new FrameMeter(120);
  const stepTimer = new StepTimer(120);
  const driver = new FixedStepDriver();

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
        copyWorld(current, previous);
        step(current, frameInput, track, tuning);
      }
      stepTimer.record((performance.now() - before) / ticks);
    }

    const alpha = driver.alpha;
    const a = previous.player;
    const b = current.player;
    const s = a.pos.s + (b.pos.s - a.pos.s) * alpha;
    const t = a.pos.t + (b.pos.t - a.pos.t) * alpha;
    const lean = a.lean + (b.lean - a.lean) * alpha;
    const wheel = a.wheelAngle + (b.wheelAngle - a.wheelAngle) * alpha;
    const speed = a.speed + (b.speed - a.speed) * alpha;

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
