import type { TrackSegment } from '../../src/core/types.ts';
import { loadTrack } from '../../src/core/track/load.ts';
import type { Track } from '../../src/core/track/Track.ts';

/** A straight, flat, 3-lane segment. Override any field to make a test case. */
export function segment(overrides: Partial<TrackSegment> = {}): TrackSegment {
  return {
    length: 100,
    curvature: 0,
    gradient: 0,
    bank: 0,
    halfWidth: 8,
    shoulder: 2,
    lanes: 3,
    oneWay: false,
    scenery: 'ringroad',
    hazards: [],
    ...overrides,
  };
}

/** Builds a validated single-path track from raw segments. */
export function trackOf(...segments: TrackSegment[]): Track {
  return loadTrack('synthetic.json', {
    id: 'synthetic',
    name: 'Synthetic',
    scenery: 'ringroad',
    segments,
    branches: [],
  });
}

/** The raw JSON object for a valid track, for validation tests to corrupt. */
export function validTrackJson(): Record<string, unknown> {
  return {
    id: 'synthetic',
    name: 'Synthetic',
    scenery: 'ringroad',
    segments: [segment(), segment({ curvature: 0.004 })],
    branches: [],
  };
}
