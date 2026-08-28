/** Rolling frame-timing statistics for the on-screen counter and dev overlay. */
export interface FrameStats {
  /** Frames per second over the sample window. */
  fps: number;
  /** Mean frame time over the window, in milliseconds. */
  meanMs: number;
  /** Worst frame time in the window, in milliseconds. */
  worstMs: number;
  /** 95th-percentile frame time, in milliseconds. */
  p95Ms: number;
  /** Frames in the window that missed the 16.6 ms budget. */
  overBudget: number;
}

const BUDGET_MS = 1000 / 60;

/**
 * Fixed-capacity ring buffer of frame durations.
 *
 * A mean alone hides the thing that actually matters: a run of 58 fps frames
 * and a run of 60s with a 40 ms spike both average out fine, and only one of
 * them is a stutter you can see. Hence p95 and a miss count alongside it.
 */
export class FrameMeter {
  private readonly samples: Float64Array;
  private readonly sorted: Float64Array;
  private count = 0;
  private next = 0;

  constructor(private readonly capacity = 120) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(
        `FrameMeter capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.samples = new Float64Array(capacity);
    this.sorted = new Float64Array(capacity);
  }

  /** Record one frame duration in milliseconds. Ignores non-finite values. */
  record(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return;
    this.samples[this.next] = deltaMs;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  /** Number of samples currently held, up to the capacity. */
  get size(): number {
    return this.count;
  }

  /**
   * Statistics over the current window. Allocates nothing: the sort scratch
   * buffer is owned by the meter and the result is a fresh small object read
   * once per second by the HUD, not per frame.
   */
  stats(): FrameStats {
    if (this.count === 0) {
      return { fps: 0, meanMs: 0, worstMs: 0, p95Ms: 0, overBudget: 0 };
    }

    let total = 0;
    let worst = 0;
    let overBudget = 0;
    for (let i = 0; i < this.count; i += 1) {
      const ms = this.samples[i] ?? 0;
      total += ms;
      if (ms > worst) worst = ms;
      if (ms > BUDGET_MS) overBudget += 1;
      this.sorted[i] = ms;
    }

    const window = this.sorted.subarray(0, this.count);
    window.sort();

    const meanMs = total / this.count;
    const p95Index = Math.min(this.count - 1, Math.ceil(this.count * 0.95) - 1);

    return {
      fps: meanMs > 0 ? 1000 / meanMs : 0,
      meanMs,
      worstMs: worst,
      p95Ms: window[p95Index] ?? worst,
      overBudget,
    };
  }

  /** Formats stats for the corner readout. Deliberately dense and fixed-width. */
  static format(stats: FrameStats): string {
    return (
      `${stats.fps.toFixed(1).padStart(5)} fps\n` +
      `${stats.meanMs.toFixed(2).padStart(5)} ms mean\n` +
      `${stats.p95Ms.toFixed(2).padStart(5)} ms p95\n` +
      `${stats.worstMs.toFixed(2).padStart(5)} ms worst\n` +
      `${String(stats.overBudget).padStart(5)} over 16.6`
    );
  }
}
