import './style.css';
import { createStage } from '../render/Stage.ts';
import { FrameMeter } from '../ui/FrameMeter.ts';

const READOUT_INTERVAL_MS = 1000;

/**
 * Phase 0 has no simulation, so this is a plain render loop. The fixed-timestep
 * accumulator arrives in Phase 2 — see ARCHITECTURE.md §2.
 */
function run(canvas: HTMLCanvasElement, readout: HTMLElement): void {
  const stage = createStage(canvas);
  const meter = new FrameMeter(120);

  let last = performance.now();
  let lastReadout = last;

  const frame = (now: number): void => {
    meter.record(now - last);
    last = now;

    stage.renderer.render(stage.scene, stage.camera);

    // Once a second, not once a frame: writing to the DOM every frame is
    // itself a measurable cost, and it would be measuring itself.
    if (now - lastReadout >= READOUT_INTERVAL_MS) {
      readout.textContent = FrameMeter.format(meter.stats());
      lastReadout = now;
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const readout = document.querySelector<HTMLElement>('#fps');
if (!canvas || !readout) {
  throw new Error('index.html is missing #stage or #fps');
}
run(canvas, readout);
