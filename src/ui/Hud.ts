import type { Tuning } from '../core/sim/types.ts';

/**
 * Speed readout and tachometer.
 *
 * Plain DOM, no framework, per CLAUDE.md. Written to at display rate, so it
 * touches the DOM only when a value actually changes — a HUD that rewrites
 * itself sixty times a second is a measurable slice of the frame budget for no
 * visible benefit.
 */

const MS_TO_KMH = 3.6;

export interface Hud {
  root: HTMLElement;
  update: (speedMs: number, topSpeedMs: number, tuning: Tuning) => void;
  dispose: () => void;
}

/**
 * A fake gearbox, purely for the tachometer.
 *
 * There is no gearbox in the simulation — the bike is an arcade model with one
 * continuous speed. But an engine note and a needle that climb and reset are
 * most of what makes acceleration legible, so the HUD derives a plausible gear
 * and rev fraction from speed alone.
 */
export function revsFor(
  speedFraction: number,
  tuning: Tuning,
): { gear: number; revs: number } {
  const clamped = Math.max(0, Math.min(1, speedFraction));
  const scaled = clamped * tuning.gearCount;
  const gear = Math.min(tuning.gearCount, Math.floor(scaled) + 1);
  const withinGear = scaled - Math.floor(scaled);
  const revs = tuning.revsIdle + (1 - tuning.revsIdle) * withinGear;
  return { gear, revs: clamped >= 1 ? 1 : revs };
}

export function createHud(parent: HTMLElement): Hud {
  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <div class="hud-tacho" aria-hidden="true"><span class="hud-tacho-fill"></span></div>
    <div class="hud-speed">
      <b class="hud-speed-value">0</b>
      <span class="hud-speed-unit">km/h</span>
      <span class="hud-gear">N</span>
    </div>`;
  parent.appendChild(root);

  const fill = root.querySelector<HTMLElement>('.hud-tacho-fill');
  const value = root.querySelector<HTMLElement>('.hud-speed-value');
  const gearEl = root.querySelector<HTMLElement>('.hud-gear');
  if (!fill || !value || !gearEl) throw new Error('hud: markup did not build');

  let lastKmh = -1;
  let lastGear = -1;
  let lastRevs = -1;

  const update = (
    speedMs: number,
    topSpeedMs: number,
    tuning: Tuning,
  ): void => {
    const kmh = Math.round(speedMs * MS_TO_KMH);
    if (kmh !== lastKmh) {
      value.textContent = String(kmh);
      lastKmh = kmh;
    }

    const { gear, revs } = revsFor(
      topSpeedMs > 0 ? speedMs / topSpeedMs : 0,
      tuning,
    );
    if (gear !== lastGear) {
      gearEl.textContent = speedMs < 0.5 ? 'N' : String(gear);
      lastGear = gear;
    }
    // Only redraw the needle when it has moved a visible amount.
    if (Math.abs(revs - lastRevs) > 0.004) {
      fill.style.transform = `scaleX(${revs.toFixed(3)})`;
      lastRevs = revs;
    }
  };

  return {
    root,
    update,
    dispose: () => root.remove(),
  };
}
