import type { Bike, TunedBike } from './types.ts';

/**
 * Turning a bike's data-file numbers into the constants the simulation
 * integrates.
 *
 * `GAME_DESIGN.md` fixes which field owns what: `topSpeed` is the ceiling,
 * `timeToTopSpeed` is the magnitude, and `accelCurve` is shape with no
 * magnitude at all. That last part is the whole reason this file exists —
 * the curve has to be rescaled by a constant solved from the other two, so
 * that doubling every entry changes the character of the acceleration and
 * leaves the time to top speed untouched.
 */

const KMH_TO_MS = 1 / 3.6;

/**
 * The normalised acceleration curve at `u`, the fraction of top speed.
 *
 * Linear interpolation between the five control points. Trig-free, so this is
 * legal inside `step()`.
 */
export function curveAt(accelCurve: number[], u: number): number {
  const last = accelCurve.length - 1;
  if (u <= 0) return accelCurve[0] ?? 0;
  if (u >= 1) return accelCurve[last] ?? 0;

  const scaled = u * last;
  const i = Math.floor(scaled);
  const a = accelCurve[i] ?? 0;
  const b = accelCurve[i + 1] ?? a;
  return a + (b - a) * (scaled - i);
}

/**
 * The dimensionless integral of `1 / f(u)` from 0 to 1.
 *
 * This is the shape's entire contribution to how long the bike takes to reach
 * top speed, and it is why the scale factor can be solved exactly instead of
 * tuned by hand. Simpson's rule over `slices` intervals; `slices` is forced
 * even because Simpson's needs pairs.
 */
export function inverseCurveIntegral(
  accelCurve: number[],
  slices: number,
): number {
  const n = slices % 2 === 0 ? slices : slices + 1;
  const h = 1 / n;
  let sum = 1 / curveAt(accelCurve, 0) + 1 / curveAt(accelCurve, 1);

  for (let i = 1; i < n; i += 1) {
    const weight = i % 2 === 0 ? 2 : 4;
    sum += weight * (1 / curveAt(accelCurve, i * h));
  }
  return (sum * h) / 3;
}

/**
 * Solves a bike's acceleration scale so that a full-throttle run from rest
 * reaches `topSpeed` in exactly `timeToTopSpeed`.
 *
 * From `T = (vmax / K) * integral(0..1) du/f(u)`, so `K = vmax * I / T`.
 */
export function tuneBike(spec: Bike, integralSlices: number): TunedBike {
  const topSpeedMs = spec.topSpeed * KMH_TO_MS;
  const integral = inverseCurveIntegral(spec.accelCurve, integralSlices);
  return {
    spec,
    topSpeedMs,
    accelScale: (topSpeedMs * integral) / spec.timeToTopSpeed,
  };
}
