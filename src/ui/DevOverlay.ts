import { FrameMeter, type FrameStats } from './FrameMeter.ts';

/**
 * The developer readout: track position, speed, frame timing, and how long a
 * simulation tick actually costs.
 *
 * Phase 2's acceptance criteria are numbers, and this is where they are read
 * from. Toggled with `\`` so it can be turned off before judging feel — a
 * readout in the corner changes how a game feels to play.
 */

export interface DevSample {
  s: number;
  t: number;
  speedMs: number;
  branchId: number;
  /** Milliseconds spent in `step()` per tick, averaged. */
  simMs: number;
  ticksThisFrame: number;
  droppedTicks: number;
  visibleChunks: number;
  sceneryCount: number;
  drawCalls: number;
}

export interface DevOverlay {
  root: HTMLElement;
  update: (sample: DevSample, stats: FrameStats) => void;
  readonly visible: boolean;
  dispose: () => void;
}

/** Rolling mean of the last `capacity` sim-step timings. */
export class StepTimer {
  private readonly samples: number[] = [];
  private index = 0;

  constructor(private readonly capacity = 120) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(
        `StepTimer: capacity must be a positive integer, got ${capacity}`,
      );
    }
  }

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.samples.length < this.capacity) this.samples.push(ms);
    else {
      this.samples[this.index] = ms;
      this.index = (this.index + 1) % this.capacity;
    }
  }

  /** Mean milliseconds per tick, or 0 before anything is recorded. */
  mean(): number {
    if (this.samples.length === 0) return 0;
    let total = 0;
    for (const sample of this.samples) total += sample;
    return total / this.samples.length;
  }

  /** The worst tick seen in the window — where a budget overrun shows up. */
  worst(): number {
    let worst = 0;
    for (const sample of this.samples) if (sample > worst) worst = sample;
    return worst;
  }
}

const MS_TO_KMH = 3.6;

export function createDevOverlay(parent: HTMLElement): DevOverlay {
  const root = document.createElement('pre');
  root.className = 'dev';
  parent.appendChild(root);

  let shown = true;
  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== 'Backquote') return;
    shown = !shown;
    root.style.display = shown ? '' : 'none';
  };
  window.addEventListener('keydown', onKey);

  const update = (sample: DevSample, stats: FrameStats): void => {
    if (!shown) return;
    root.textContent = [
      `s ${sample.s.toFixed(1).padStart(9)} m   t ${sample.t.toFixed(2).padStart(6)} m   branch ${sample.branchId}`,
      `speed ${(sample.speedMs * MS_TO_KMH).toFixed(1).padStart(6)} km/h  (${sample.speedMs.toFixed(2)} m/s)`,
      '',
      FrameMeter.format(stats),
      `sim   ${sample.simMs.toFixed(3)} ms/tick   ticks/frame ${sample.ticksThisFrame}   dropped ${sample.droppedTicks}`,
      `draw  ${sample.drawCalls} calls   chunks ${sample.visibleChunks}   scenery ${sample.sceneryCount}`,
      '',
      '` toggles this readout',
    ].join('\n');
  };

  return {
    root,
    update,
    get visible() {
      return shown;
    },
    dispose: () => {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
