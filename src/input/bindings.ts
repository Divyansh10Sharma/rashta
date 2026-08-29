/**
 * What the player can do, and which keys and buttons currently do it.
 *
 * Bindings are data, not constants scattered through the input reader, so the
 * settings screen in Phase 10 has something to edit and this phase has
 * something to test.
 */

/** Every action the game accepts. Combat actions land in Phase 6. */
export type Action =
  | 'throttle'
  | 'brake'
  | 'leanLeft'
  | 'leanRight'
  | 'punch'
  | 'kick'
  | 'backhand'
  | 'nitro';

export const ACTIONS: readonly Action[] = [
  'throttle',
  'brake',
  'leanLeft',
  'leanRight',
  'punch',
  'kick',
  'backhand',
  'nitro',
];

/** `KeyboardEvent.code` values, so bindings survive a non-QWERTY layout. */
export type KeyBindings = Record<Action, string[]>;

/** Indices into the standard gamepad mapping. */
export type PadBindings = Record<Action, number[]>;

export function defaultKeyBindings(): KeyBindings {
  return {
    throttle: ['ArrowUp', 'KeyW'],
    brake: ['ArrowDown', 'KeyS'],
    leanLeft: ['ArrowLeft', 'KeyA'],
    leanRight: ['ArrowRight', 'KeyD'],
    punch: ['KeyJ'],
    kick: ['KeyK'],
    backhand: ['KeyL'],
    nitro: ['ShiftLeft', 'ShiftRight'],
  };
}

export function defaultPadBindings(): PadBindings {
  return {
    throttle: [7],
    brake: [6],
    leanLeft: [14],
    leanRight: [15],
    punch: [2],
    kick: [1],
    backhand: [3],
    nitro: [0],
  };
}

/** Every key bound to anything, for detecting a conflict before committing it. */
export function conflictsFor(
  bindings: KeyBindings,
  action: Action,
  code: string,
): Action[] {
  return ACTIONS.filter(
    (other) => other !== action && (bindings[other] ?? []).includes(code),
  );
}

/**
 * Rebinds `action` to `code`, removing it from whatever else held it.
 *
 * Returns the actions that lost the binding, so a settings screen can say so
 * rather than silently stealing a key.
 */
export function rebind(
  bindings: KeyBindings,
  action: Action,
  code: string,
): Action[] {
  const stolen = conflictsFor(bindings, action, code);
  for (const other of stolen) {
    bindings[other] = bindings[other].filter((c) => c !== code);
  }
  bindings[action] = [code];
  return stolen;
}
