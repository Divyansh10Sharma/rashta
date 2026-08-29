/**
 * The accumulator that turns a variable render clock into a fixed simulation
 * clock.
 *
 * The simulation must never see a real timestamp. This is the piece that makes
 * that true: it takes however much wall time has actually passed and answers
 * only "how many identical ticks should run now", plus the leftover fraction
 * the renderer uses to interpolate between the two most recent states.
 *
 * Deliberately has no dependency on `performance.now` or anything else that
 * ticks — the caller supplies elapsed time, so a test can feed it a
 * deliberately jittered clock and prove the simulation does not notice.
 */

import { FIXED_DT } from '../core/sim/step.ts';

/** Most ticks run for one render frame, so a stalled tab cannot death-spiral. */
export const MAX_SUB_STEPS = 5;

export class FixedStepDriver {
  private accumulator = 0;
  private dropped = 0;

  constructor(
    private readonly fixedDt: number = FIXED_DT,
    private readonly maxSubSteps: number = MAX_SUB_STEPS,
  ) {}

  /**
   * Takes real elapsed seconds and returns how many fixed steps to run.
   *
   * Time beyond `maxSubSteps` worth of ticks is discarded rather than banked:
   * catching up on a five-second stall by running three hundred ticks would
   * freeze the tab harder than the stall did.
   */
  advance(realElapsed: number): number {
    if (!Number.isFinite(realElapsed) || realElapsed <= 0) return 0;

    this.accumulator += realElapsed;
    let steps = Math.floor(this.accumulator / this.fixedDt);

    if (steps > this.maxSubSteps) {
      this.dropped += steps - this.maxSubSteps;
      steps = this.maxSubSteps;
      this.accumulator = this.fixedDt * steps;
    }

    this.accumulator -= steps * this.fixedDt;
    return steps;
  }

  /** How far between the previous and current state the renderer should draw. */
  get alpha(): number {
    return this.accumulator / this.fixedDt;
  }

  /** Ticks thrown away to avoid a catch-up spiral. Shown in the dev overlay. */
  get droppedTicks(): number {
    return this.dropped;
  }
}
