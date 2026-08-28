import { describe, expect, it } from 'vitest';
import { FrameMeter } from '../src/ui/FrameMeter.ts';

describe('FrameMeter', () => {
  it('reports zeroes before any frame is recorded', () => {
    const stats = new FrameMeter(10).stats();
    expect(stats).toEqual({
      fps: 0,
      meanMs: 0,
      worstMs: 0,
      p95Ms: 0,
      overBudget: 0,
    });
  });

  it('derives 60 fps from a steady 16.667 ms frame', () => {
    const meter = new FrameMeter(60);
    for (let i = 0; i < 60; i += 1) meter.record(1000 / 60);
    expect(meter.stats().fps).toBeCloseTo(60, 6);
  });

  it('keeps only the most recent `capacity` samples', () => {
    const meter = new FrameMeter(4);
    for (const ms of [100, 100, 100, 100, 10, 10, 10, 10]) meter.record(ms);
    expect(meter.size).toBe(4);
    expect(meter.stats().meanMs).toBeCloseTo(10, 6);
  });

  it('counts frames that missed the 16.6 ms budget', () => {
    const meter = new FrameMeter(10);
    for (const ms of [10, 10, 20, 30, 10]) meter.record(ms);
    expect(meter.stats().overBudget).toBe(2);
  });

  it('reports the worst frame, which the mean hides', () => {
    const meter = new FrameMeter(100);
    for (let i = 0; i < 99; i += 1) meter.record(16);
    meter.record(120);
    const stats = meter.stats();
    expect(stats.worstMs).toBe(120);
    expect(stats.meanMs).toBeLessThan(18);
  });

  it('surfaces a slow tail in p95 that the mean does not show', () => {
    const meter = new FrameMeter(100);
    for (let i = 0; i < 90; i += 1) meter.record(9);
    for (let i = 0; i < 10; i += 1) meter.record(100);
    const stats = meter.stats();
    expect(stats.p95Ms).toBe(100);
    expect(stats.meanMs).toBeCloseTo(18.1, 6);
  });

  it('uses nearest-rank, so a tail of exactly 5% sits above p95', () => {
    // 95 samples at or below, 5 above: rank 95 of 100 is still the fast value.
    // This is the correct boundary, not an off-by-one — it is asserted so that
    // a later "fix" to the index has to argue with a test.
    const meter = new FrameMeter(100);
    for (let i = 0; i < 95; i += 1) meter.record(9);
    for (let i = 0; i < 5; i += 1) meter.record(100);
    expect(meter.stats().p95Ms).toBe(9);
    expect(meter.stats().worstMs).toBe(100);
  });

  it('ignores non-finite and negative deltas', () => {
    const meter = new FrameMeter(10);
    meter.record(Number.NaN);
    meter.record(Number.POSITIVE_INFINITY);
    meter.record(-5);
    expect(meter.size).toBe(0);
  });

  it('rejects a nonsensical capacity loudly', () => {
    expect(() => new FrameMeter(0)).toThrow(/positive integer/);
    expect(() => new FrameMeter(2.5)).toThrow(/positive integer/);
  });

  it('formats a fixed-width readout', () => {
    const meter = new FrameMeter(10);
    for (let i = 0; i < 10; i += 1) meter.record(1000 / 60);
    const lines = FrameMeter.format(meter.stats()).split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('fps');
  });
});
