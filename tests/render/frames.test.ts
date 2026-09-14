import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crash } from '../../src/core/sim/crash.ts';
import { createRider } from '../../src/core/sim/world.ts';
import { RIDER_FRAMES, riderFrame } from '../../src/render/sprites/frames.ts';
import { bikes, combat, tuning } from '../helpers/race.ts';
import type { WeaponKind } from '../../src/core/combat/types.ts';
import type { Rider } from '../../src/core/sim/types.ts';
import type { FrameChoice } from '../../src/render/sprites/frames.ts';

/**
 * Which rider picture gets drawn, checked without a screen.
 *
 * What the pictures look like is a human's job. Whether the right one is on
 * screen for the state the simulation is in can be proved here.
 */

function pick(setup: (rider: Rider) => void): FrameChoice {
  const bike = bikes[0];
  if (!bike) throw new Error('no bikes');
  const rider = createRider(bike);
  setup(rider);
  return riderFrame(rider, tuning.leanMax, { frame: 'centre', mirror: false });
}

describe('which rider picture is drawn', () => {
  it('draws upright, leaning or hard over by how far the bike leans', () => {
    const at = (fraction: number) =>
      pick((r) => {
        r.lean = tuning.leanMax * fraction;
      }).frame;
    expect(at(0)).toBe('centre');
    expect(at(0.1)).toBe('centre');
    expect(at(0.45)).toBe('lean');
    expect(at(0.9)).toBe('hard');
  });

  it('flips the right-leaning art for a left lean', () => {
    const left = pick((r) => {
      r.lean = -tuning.leanMax * 0.9;
    });
    expect(left).toEqual({ frame: 'hard', mirror: true });
    const right = pick((r) => {
      r.lean = tuning.leanMax * 0.9;
    });
    expect(right).toEqual({ frame: 'hard', mirror: false });
  });

  it('draws the attack, and a weapon swing over a bare fist', () => {
    const attack = (kind: Rider['attack'], armed: boolean) =>
      pick((r) => {
        r.state = 'attacking';
        r.attack = kind;
        const [weapon] = Object.keys(combat.weapons) as WeaponKind[];
        if (armed && weapon) r.weapon = weapon;
      }).frame;
    expect(attack('punch', false)).toBe('punch');
    expect(attack('kick', false)).toBe('kick');
    expect(attack('punch', true)).toBe('swing');
  });

  it('throws a backhand to the other side', () => {
    const backhand = pick((r) => {
      r.state = 'attacking';
      r.attack = 'backhand';
    });
    expect(backhand).toEqual({ frame: 'punch', mirror: true });
  });

  it('follows a crash from the air to the get-up, never flipped', () => {
    const frames: string[] = [];
    const bike = bikes[0];
    if (!bike) throw new Error('no bikes');
    const rider = createRider(bike);
    const out: FrameChoice = { frame: 'centre', mirror: false };
    const record = () => {
      riderFrame(rider, tuning.leanMax, out);
      expect(out.mirror).toBe(false);
      frames.push(out.frame);
    };

    rider.lean = -tuning.leanMax;
    rider.speed = 40;
    crash(rider, 'traffic', tuning);
    record();
    rider.hVel = -1;
    record();
    for (const state of [
      'sliding',
      'downed',
      'rising',
      'running',
      'remounting',
    ] as const) {
      rider.state = state;
      record();
    }

    expect(frames).toEqual([
      'tumble-1',
      'tumble-2',
      'slide',
      'slide',
      'rise',
      'run',
      'centre',
    ]);
  });

  it('only names pictures the prompt file tells you to make', () => {
    // The file names are the contract between the art and the code. A frame
    // the prompts never ask for is a picture nobody will ever draw.
    const prompts = readFileSync('docs/ASSET_PROMPTS.md', 'utf8');
    for (const frame of RIDER_FRAMES) {
      expect(prompts).toContain(`public/sprites/rider/${frame}.webp`);
    }
  });
});
