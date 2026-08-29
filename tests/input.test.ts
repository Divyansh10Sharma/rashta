import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  conflictsFor,
  defaultKeyBindings,
  defaultPadBindings,
  rebind,
} from '../src/input/bindings.ts';
import {
  applyDeadzone,
  resolveInput,
  type PadState,
} from '../src/input/resolve.ts';

const keys = defaultKeyBindings();
const pad = defaultPadBindings();
const held = (...codes: string[]) => new Set(codes);
const noPad = null;

function padWith(overrides: Partial<PadState>): PadState {
  return { buttons: [], axes: [], ...overrides };
}

describe('default bindings', () => {
  it('binds every action', () => {
    for (const action of ACTIONS) {
      expect(`${action}: ${keys[action].length > 0}`).toBe(`${action}: true`);
      expect(`${action}: ${pad[action].length > 0}`).toBe(`${action}: true`);
    }
  });

  it('matches the control table in README.md', () => {
    expect(keys.throttle).toContain('KeyW');
    expect(keys.brake).toContain('KeyS');
    expect(keys.leanLeft).toContain('KeyA');
    expect(keys.leanRight).toContain('KeyD');
    expect(keys.punch).toContain('KeyJ');
    expect(keys.kick).toContain('KeyK');
    expect(keys.backhand).toContain('KeyL');
  });

  it('has no key bound to two actions', () => {
    for (const action of ACTIONS) {
      for (const code of keys[action]) {
        expect(`${code}: ${conflictsFor(keys, action, code).join()}`).toBe(
          `${code}: `,
        );
      }
    }
  });
});

describe('rebinding', () => {
  it('moves a key and reports what lost it', () => {
    const b = defaultKeyBindings();
    const stolen = rebind(b, 'nitro', 'KeyW');
    expect(stolen).toEqual(['throttle']);
    expect(b.nitro).toEqual(['KeyW']);
    expect(b.throttle).not.toContain('KeyW');
    expect(b.throttle).toContain('ArrowUp');
  });

  it('steals nothing when the key was free', () => {
    const b = defaultKeyBindings();
    expect(rebind(b, 'punch', 'KeyZ')).toEqual([]);
    expect(b.punch).toEqual(['KeyZ']);
  });

  it('leaves the action bound when rebound to a key it already had', () => {
    const b = defaultKeyBindings();
    expect(rebind(b, 'throttle', 'KeyW')).toEqual([]);
    expect(b.throttle).toEqual(['KeyW']);
  });
});

describe('resolving keyboard input', () => {
  it('reads nothing when nothing is pressed', () => {
    expect(resolveInput(held(), keys, noPad, pad)).toEqual({
      attack: null,
      throttle: 0,
      brake: 0,
      lean: 0,
    });
  });

  it('reads full throttle from either bound key', () => {
    expect(resolveInput(held('KeyW'), keys, noPad, pad).throttle).toBe(1);
    expect(resolveInput(held('ArrowUp'), keys, noPad, pad).throttle).toBe(1);
  });

  it('leans left and right', () => {
    expect(resolveInput(held('KeyA'), keys, noPad, pad).lean).toBe(-1);
    expect(resolveInput(held('KeyD'), keys, noPad, pad).lean).toBe(1);
  });

  it('cancels opposing lean keys rather than picking one', () => {
    expect(resolveInput(held('KeyA', 'KeyD'), keys, noPad, pad).lean).toBe(0);
  });

  it('allows throttle and brake together', () => {
    const frame = resolveInput(held('KeyW', 'KeyS'), keys, noPad, pad);
    expect(frame.throttle).toBe(1);
    expect(frame.brake).toBe(1);
  });
});

describe('resolving gamepad input', () => {
  it('reads analog triggers', () => {
    const state = padWith({ buttons: [0, 0, 0, 0, 0, 0, 0.4, 0.7] });
    const frame = resolveInput(held(), keys, state, pad);
    expect(frame.throttle).toBeCloseTo(0.7, 6);
    expect(frame.brake).toBeCloseTo(0.4, 6);
  });

  it('takes whichever of key or trigger asks for more', () => {
    const state = padWith({ buttons: [0, 0, 0, 0, 0, 0, 0, 0.3] });
    expect(resolveInput(held('KeyW'), keys, state, pad).throttle).toBe(1);
    expect(resolveInput(held(), keys, state, pad).throttle).toBeCloseTo(0.3, 6);
  });

  it('reads the left stick for lean', () => {
    const state = padWith({ axes: [-0.8] });
    expect(resolveInput(held(), keys, state, pad).lean).toBeLessThan(-0.5);
  });

  it('lets the keyboard override a resting stick', () => {
    const state = padWith({ axes: [0.05] });
    expect(resolveInput(held('KeyA'), keys, state, pad).lean).toBe(-1);
  });

  it('ignores stick drift inside the deadzone', () => {
    const state = padWith({ axes: [0.12] });
    expect(resolveInput(held(), keys, state, pad).lean).toBe(0);
  });

  it('still reaches full lean at the edge of the stick', () => {
    const state = padWith({ axes: [1] });
    expect(resolveInput(held(), keys, state, pad).lean).toBeCloseTo(1, 6);
  });

  it('reads the d-pad when the stick is idle', () => {
    const state = padWith({
      buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    });
    expect(resolveInput(held(), keys, state, pad).lean).toBe(1);
  });

  it('survives a pad reporting fewer buttons and axes than expected', () => {
    const frame = resolveInput(held(), keys, padWith({}), pad);
    expect(frame).toEqual({ attack: null, throttle: 0, brake: 0, lean: 0 });
  });
});

describe('the stick deadzone', () => {
  it('is zero at rest and one at the edge', () => {
    expect(applyDeadzone(0)).toBe(0);
    expect(applyDeadzone(1)).toBeCloseTo(1, 9);
    expect(applyDeadzone(-1)).toBeCloseTo(-1, 9);
  });

  it('rescales so the usable range still spans the whole travel', () => {
    // Without rescaling, a stick pushed fully would only ever report 0.82.
    expect(applyDeadzone(0.18)).toBe(0);
    expect(applyDeadzone(0.59)).toBeCloseTo(0.5, 2);
  });

  it('clamps an over-range axis', () => {
    expect(applyDeadzone(1.4)).toBeCloseTo(1, 9);
  });
});
