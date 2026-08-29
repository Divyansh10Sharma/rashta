import type { InputFrame } from '../core/sim/types.ts';
import type { AttackKind } from '../core/combat/types.ts';
import {
  defaultKeyBindings,
  defaultPadBindings,
  rebind,
  type Action,
  type KeyBindings,
  type PadBindings,
} from './bindings.ts';
import { resolveInput, type PadState } from './resolve.ts';

/**
 * The keyboard and gamepad wiring.
 *
 * Everything that touches the DOM lives here; the actual key-to-action
 * decision is in `resolve.ts`, which is pure and tested. This class only
 * gathers state and hands it over.
 */
export class Input {
  private readonly pressed = new Set<string>();
  private keys: KeyBindings = defaultKeyBindings();
  private pad: PadBindings = defaultPadBindings();
  private readonly padState: PadState = { buttons: [], axes: [] };
  private attached = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Arrows scroll the page and space activates focused controls; neither is
    // wanted while riding.
    if (this.isBound(event.code)) event.preventDefault();
    this.pressed.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  // A tab switch mid-corner would otherwise leave the throttle stuck on.
  private readonly onBlur = (): void => {
    this.pressed.clear();
  };

  /** Starts listening. Idempotent. */
  attach(target: Window = window): void {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** Stops listening and releases every held key. */
  detach(target: Window = window): void {
    if (!this.attached) return;
    this.attached = false;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }

  private isBound(code: string): boolean {
    for (const codes of Object.values(this.keys)) {
      if (codes.includes(code)) return true;
    }
    return false;
  }

  /** Reads the first connected gamepad into the reused state object. */
  private pollPad(): PadState | null {
    const getPads = navigator.getGamepads?.bind(navigator);
    if (!getPads) return null;

    for (const gamepad of getPads()) {
      if (!gamepad) continue;
      this.padState.buttons.length = 0;
      for (const button of gamepad.buttons)
        this.padState.buttons.push(button.value);
      this.padState.axes.length = 0;
      for (const axis of gamepad.axes) this.padState.axes.push(axis);
      return this.padState;
    }
    return null;
  }

  /** One tick of input. Called once per simulation tick, never per frame. */
  sample(): InputFrame {
    const frame = resolveInput(
      this.pressed,
      this.keys,
      this.pollPad(),
      this.pad,
    );
    // An attack fires on the press, not for as long as the key is held down.
    // Without this, leaning on the punch key is a machine gun.
    const held = frame.attack ?? null;
    frame.attack = held !== null && held !== this.lastAttack ? held : null;
    this.lastAttack = held;
    return frame;
  }

  /** The attack key that was down last tick, so a hold is not a repeat. */
  private lastAttack: AttackKind | null = null;

  /** The current key bindings, for a settings screen to render. */
  get keyBindings(): Readonly<KeyBindings> {
    return this.keys;
  }

  /** Rebinds an action, returning any actions that lost the key. */
  bind(action: Action, code: string): Action[] {
    return rebind(this.keys, action, code);
  }

  /** Restores the shipped bindings. */
  resetBindings(): void {
    this.keys = defaultKeyBindings();
    this.pad = defaultPadBindings();
  }
}
