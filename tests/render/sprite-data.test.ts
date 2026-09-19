import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSpriteData, metresFor } from '../../src/render/sprites/data.ts';
import {
  RIDER_FRAMES,
  resolveFrame,
  type RiderFrame,
} from '../../src/render/sprites/frames.ts';
import { spriteData } from '../helpers/sprites.ts';

/**
 * sprites.json: what size each picture is, and which ones each place uses.
 *
 * The test that earns its keep here is the file check. A picture named in the
 * data but absent from `public/` does not error — it quietly draws the old
 * mesh, which on screen looks exactly like a renderer bug.
 */

const raw = (): Record<string, unknown> =>
  JSON.parse(readFileSync('src/data/sprites.json', 'utf8')) as Record<
    string,
    unknown
  >;

function file(path: string): string {
  return `public/sprites/${path}.webp`;
}

describe('sprites.json', () => {
  it('names only pictures that exist', () => {
    const named = new Set<string>(Object.keys(spriteData.sizes));
    for (const place of Object.values(spriteData.places)) {
      for (const list of Object.values(place.traffic)) {
        for (const name of list) {
          named.add(`${name}-rear`);
          named.add(`${name}-front`);
        }
      }
    }
    const absent = [...named].filter((path) => !existsSync(file(path)));
    expect(absent).toEqual([]);
  });

  it('gives every place a streetlight or keeps the mast on purpose', () => {
    for (const [tag, place] of Object.entries(spriteData.places)) {
      expect(place.lamp === null || place.lamp in spriteData.sizes, tag).toBe(
        true,
      );
    }
  });

  it('rejects a size with both dimensions, naming the file and field', () => {
    const bad = raw();
    (bad['sizes'] as Record<string, unknown>)['scenery/lamp'] = {
      width: 1,
      height: 8,
    };
    expect(() => loadSpriteData('sprites.json', bad)).toThrow(
      /sprites\.json: sizes\.scenery\/lamp must give exactly one/,
    );
  });

  it('rejects a place that names a picture with no size', () => {
    const bad = raw();
    const places = bad['places'] as Record<string, Record<string, unknown>>;
    const ridge = places['ridge'];
    if (!ridge) throw new Error('no ridge');
    ridge['props'] = ['scenery/tree'];
    expect(() => loadSpriteData('sprites.json', bad)).toThrow(
      /places\.ridge\.props\[0\] names "scenery\/tree"/,
    );
  });

  it('rejects a place with no pictures for a traffic kind', () => {
    const bad = raw();
    const places = bad['places'] as Record<string, Record<string, unknown>>;
    const traffic = places['oldcity']?.['traffic'] as Record<string, unknown>;
    traffic['bus'] = [];
    expect(() => loadSpriteData('sprites.json', bad)).toThrow(
      /places\.oldcity\.traffic\.bus must name at least one/,
    );
  });

  it('rejects a missing place', () => {
    const bad = raw();
    delete (bad['places'] as Record<string, unknown>)['flyway'];
    expect(() => loadSpriteData('sprites.json', bad)).toThrow(
      /places\.flyway must be an object/,
    );
  });

  it('turns one real dimension and the art’s shape into metres', () => {
    const out = { w: 0, h: 0 };
    metresFor({ width: 2, lying: false }, 1.5, out);
    expect(out).toEqual({ w: 2, h: 3 });
    metresFor({ height: 8, lying: false }, 4, out);
    expect(out).toEqual({ w: 2, h: 8 });
  });
});

describe('when a rider frame is missing', () => {
  const only =
    (...frames: RiderFrame[]) =>
    (frame: RiderFrame): boolean =>
      frames.includes(frame);

  it('draws the frame itself when it is there', () => {
    for (const frame of RIDER_FRAMES) {
      expect(resolveFrame(frame, () => true)).toBe(frame);
    }
  });

  it('falls back from a riding frame toward upright', () => {
    expect(resolveFrame('hard', only('centre'))).toBe('centre');
    expect(resolveFrame('punch', only('centre', 'lean'))).toBe('centre');
  });

  it('never falls back from a crash frame to one with a bike in it', () => {
    // The bike has its own card once it is down; two bikes would be wrong.
    const riding = new Set<RiderFrame>(['centre', 'lean', 'hard']);
    const crash: RiderFrame[] = [
      'tumble-1',
      'tumble-2',
      'slide',
      'rise',
      'run',
    ];
    for (const frame of crash) {
      const drawn = resolveFrame(
        frame,
        only('centre', 'lean', 'hard', 'slide'),
      );
      expect(drawn === null || !riding.has(drawn), frame).toBe(true);
    }
    // The three frames that arrived without a transparent background today.
    expect(resolveFrame('run', only('centre', 'slide'))).toBe('slide');
  });

  it('gives up, so the mesh is drawn, when nothing in the chain is there', () => {
    expect(resolveFrame('lean', () => false)).toBeNull();
    expect(resolveFrame('run', only('centre'))).toBeNull();
  });
});
