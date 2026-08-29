import type { InputFrame } from '../core/sim/types.ts';
import type { Action, KeyBindings, PadBindings } from './bindings.ts';

/**
 * Turning device state into an `InputFrame`.
 *
 * Kept free of any DOM or Gamepad API reference so it can be tested without a
 * browser — the wiring that actually listens lives in `Input.ts`.
 */

/** A gamepad reduced to what this game reads. */
export interface PadState {
  /** Pressed state per button index. */
  buttons: number[];
  /** Axis values in [-1, 1]. Axis 0 is the left stick's horizontal. */
  axes: number[];
}

/** Below this a stick is treated as centred, so a worn pad does not creep. */
export const STICK_DEADZONE = 0.18;

function keyHeld(
  pressed: ReadonlySet<string>,
  bindings: KeyBindings,
  action: Action,
): boolean {
  return (bindings[action] ?? []).some((code) => pressed.has(code));
}

function padValue(
  pad: PadState | null,
  bindings: PadBindings,
  action: Action,
): number {
  if (!pad) return 0;
  let best = 0;
  for (const index of bindings[action] ?? []) {
    best = Math.max(best, pad.buttons[index] ?? 0);
  }
  return best;
}

/** Removes the deadzone and rescales so the usable range still reaches 1. */
export function applyDeadzone(
  value: number,
  deadzone = STICK_DEADZONE,
): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  const clamped = scaled > 1 ? 1 : scaled;
  return value < 0 ? -clamped : clamped;
}

/**
 * Resolves held keys and an optional gamepad into one tick of input.
 *
 * Keyboard is digital and the pad is analog, so the two are combined by taking
 * whichever is asking for more — holding a trigger halfway and tapping the key
 * gives full throttle, which is what a player expects.
 */
export function resolveInput(
  pressed: ReadonlySet<string>,
  keys: KeyBindings,
  pad: PadState | null,
  padBindings: PadBindings,
): InputFrame {
  const throttle = Math.max(
    keyHeld(pressed, keys, 'throttle') ? 1 : 0,
    padValue(pad, padBindings, 'throttle'),
  );
  const brake = Math.max(
    keyHeld(pressed, keys, 'brake') ? 1 : 0,
    padValue(pad, padBindings, 'brake'),
  );

  let lean = 0;
  if (keyHeld(pressed, keys, 'leanLeft')) lean -= 1;
  if (keyHeld(pressed, keys, 'leanRight')) lean += 1;

  if (lean === 0 && pad) {
    const stick = applyDeadzone(pad.axes[0] ?? 0);
    const dpad =
      padValue(pad, padBindings, 'leanRight') -
      padValue(pad, padBindings, 'leanLeft');
    lean = Math.abs(stick) > Math.abs(dpad) ? stick : dpad;
  }

  return {
    throttle: clamp01(throttle),
    brake: clamp01(brake),
    lean: lean < -1 ? -1 : lean > 1 ? 1 : lean,
  };
}

function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}
