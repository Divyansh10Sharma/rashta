import { describe, expect, it } from 'vitest';
import { loadTrack, parseTrack } from '../../src/core/track/load.ts';
import { segment, validTrackJson } from '../helpers/tracks.ts';

/** Loads a track built by mutating a valid one, and returns the thrown error. */
function loadWith(mutate: (t: Record<string, unknown>) => void): () => void {
  const json = validTrackJson();
  mutate(json);
  return () => loadTrack('bad-track.json', json);
}

const segmentsOf = (t: Record<string, unknown>): Record<string, unknown>[] =>
  t['segments'] as Record<string, unknown>[];

describe('the loader accepts good data', () => {
  it('loads a valid track', () => {
    expect(() => loadTrack('good.json', validTrackJson())).not.toThrow();
  });

  it('parses valid JSON text', () => {
    const track = parseTrack('good.json', JSON.stringify(validTrackJson()));
    expect(track.totalLength).toBeCloseTo(200, 9);
  });
});

describe('every error names the file and the field', () => {
  const cases: [string, (t: Record<string, unknown>) => void, RegExp][] = [
    ['missing id', (t) => delete t['id'], /bad-track\.json: id/],
    ['blank name', (t) => (t['name'] = ''), /bad-track\.json: name/],
    [
      'unknown scenery',
      (t) => (t['scenery'] = 'mars'),
      /bad-track\.json: scenery/,
    ],
    [
      'segments not an array',
      (t) => (t['segments'] = 5),
      /segments must be an array/,
    ],
    ['segments empty', (t) => (t['segments'] = []), /at least one segment/],
    [
      'segment not an object',
      (t) => (segmentsOf(t)[0] = 7 as unknown as Record<string, unknown>),
      /segments\[0\] must be an object/,
    ],
    [
      'length not a number',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['length'] = 'far'),
      /segments\[0\]\.length must be a finite number/,
    ],
    [
      'length zero',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['length'] = 0),
      /segments\[0\]\.length must be positive/,
    ],
    [
      'curvature not finite',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['curvature'] = NaN),
      /segments\[0\]\.curvature/,
    ],
    [
      'gradient beyond vertical',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['gradient'] = 1.5),
      /segments\[0\]\.gradient must be within \(-1, 1\)/,
    ],
    [
      'bank beyond a right angle',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['bank'] = 2),
      /segments\[0\]\.bank/,
    ],
    [
      'halfWidth zero',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['halfWidth'] = 0),
      /segments\[0\]\.halfWidth must be positive/,
    ],
    [
      'negative shoulder',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['shoulder'] = -1),
      /segments\[0\]\.shoulder must not be negative/,
    ],
    [
      'fractional lanes',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['lanes'] = 2.5),
      /segments\[0\]\.lanes must be an integer/,
    ],
    [
      'zero lanes',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['lanes'] = 0),
      /segments\[0\]\.lanes must be an integer/,
    ],
    [
      'oneWay not a boolean',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['oneWay'] = 'yes'),
      /segments\[0\]\.oneWay must be a boolean/,
    ],
    [
      'segment scenery unknown',
      (t) =>
        ((segmentsOf(t)[0] as Record<string, unknown>)['scenery'] = 'moon'),
      /segments\[0\]\.scenery/,
    ],
    [
      'hazards not an array',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['hazards'] = {}),
      /segments\[0\]\.hazards must be an array/,
    ],
    [
      'hazard not an object',
      (t) => ((segmentsOf(t)[0] as Record<string, unknown>)['hazards'] = [1]),
      /segments\[0\]\.hazards\[0\] must be an object/,
    ],
    [
      'hazard kind unknown',
      (t) =>
        ((segmentsOf(t)[0] as Record<string, unknown>)['hazards'] = [
          { kind: 'tiger', offset: 1, t: 0 },
        ]),
      /segments\[0\]\.hazards\[0\]\.kind/,
    ],
    [
      'hazard past the end of its segment',
      (t) =>
        ((segmentsOf(t)[0] as Record<string, unknown>)['hazards'] = [
          { kind: 'oil', offset: 5000, t: 0 },
        ]),
      /segments\[0\]\.hazards\[0\]\.offset must be within \[0, 100\]/,
    ],
    [
      'hazard t not a number',
      (t) =>
        ((segmentsOf(t)[0] as Record<string, unknown>)['hazards'] = [
          { kind: 'oil', offset: 5, t: 'left' },
        ]),
      /segments\[0\]\.hazards\[0\]\.t/,
    ],
    [
      'branches not an array',
      (t) => (t['branches'] = 1),
      /branches must be an array/,
    ],
    [
      'negative traffic density',
      (t) => (t['trafficDensity'] = -3),
      /trafficDensity must not be negative/,
    ],
  ];

  for (const [name, mutate, pattern] of cases) {
    it(`rejects: ${name}`, () => {
      expect(loadWith(mutate)).toThrow(pattern);
    });
  }

  it('rejects a track that is not an object at all', () => {
    expect(() => loadTrack('bad-track.json', null)).toThrow(
      /bad-track\.json: track must be a JSON object/,
    );
    expect(() => loadTrack('bad-track.json', 42)).toThrow(
      /bad-track\.json: track must be a JSON object/,
    );
  });
});

describe('the degenerate-corner rule', () => {
  it('rejects a road wider than its corner radius', () => {
    // A 10 m radius with 12 m of road either side: the inside edge has folded
    // through the centre of curvature and (1 - t*k) goes negative.
    expect(
      loadWith((t) => {
        segmentsOf(t)[0] = {
          ...segment({ curvature: 0.1, halfWidth: 10, shoulder: 2 }),
        };
      }),
    ).toThrow(/bad-track\.json: segments\[0\] is degenerate/);
  });

  it('names the radius and the width in the message', () => {
    expect(
      loadWith((t) => {
        segmentsOf(t)[0] = {
          ...segment({ curvature: 0.1, halfWidth: 10, shoulder: 2 }),
        };
      }),
    ).toThrow(/corner radius \(10\)/);
  });

  it('accepts a road exactly inside its corner radius', () => {
    expect(
      loadWith((t) => {
        segmentsOf(t)[0] = {
          ...segment({ curvature: 0.1, halfWidth: 8, shoulder: 1 }),
        };
      }),
    ).not.toThrow();
  });
});

describe('branch validation', () => {
  const withBranch = (branch: unknown) => (t: Record<string, unknown>) => {
    t['branches'] = [branch];
  };

  it('rejects a branch that is not an object', () => {
    expect(loadWith(withBranch(3))).toThrow(/branches\[0\] must be an object/);
  });

  it('rejects a branch with no id', () => {
    expect(
      loadWith(
        withBranch({
          entryT: 0,
          forkS: 10,
          rejoinS: 50,
          segments: [segment({ length: 40 })],
        }),
      ),
    ).toThrow(/branches\[0\]\.id/);
  });

  it('rejects a fork point off the end of the track', () => {
    expect(
      loadWith(
        withBranch({
          id: 'b',
          entryT: 0,
          forkS: 900,
          rejoinS: 950,
          segments: [segment({ length: 50 })],
        }),
      ),
    ).toThrow(/branches\[0\]\.forkS must be within \[0, 200\)/);
  });

  it('rejects a rejoin before the fork', () => {
    expect(
      loadWith(
        withBranch({
          id: 'b',
          entryT: 0,
          forkS: 100,
          rejoinS: 50,
          segments: [segment({ length: 50 })],
        }),
      ),
    ).toThrow(/branches\[0\]\.rejoinS must be within \(100, 200\]/);
  });

  it('rejects a branch more than 5% longer than the route it replaces', () => {
    expect(
      loadWith(
        withBranch({
          id: 'scenic',
          entryT: 0,
          forkS: 50,
          rejoinS: 100,
          segments: [segment({ length: 80 })],
        }),
      ),
    ).toThrow(/over the 5% limit/);
  });

  it('rejects a branch whose geometry does not close', () => {
    // 50 m of main path replaced by 50 m of hard right turn: the length rule
    // passes and the geometry still ends nowhere near the rejoin.
    expect(
      loadWith(
        withBranch({
          id: 'nowhere',
          entryT: 0,
          forkS: 50,
          rejoinS: 100,
          segments: [segment({ length: 50, curvature: 0.02 })],
        }),
      ),
    ).toThrow(/do not close/);
  });

  it('accepts a branch that closes within tolerance', () => {
    expect(
      loadWith(
        withBranch({
          id: 'parallel',
          entryT: 0,
          forkS: 50,
          rejoinS: 100,
          segments: [segment({ length: 50 })],
        }),
      ),
    ).not.toThrow();
  });
});

describe('JSON parsing', () => {
  it('names the file when the text is not JSON at all', () => {
    expect(() => parseTrack('broken.json', '{ nope')).toThrow(
      /broken\.json: is not valid JSON/,
    );
  });
});
