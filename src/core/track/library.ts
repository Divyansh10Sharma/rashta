import type {
  SceneryTag,
  TrackBranch,
  TrackData,
  TrackSegment,
} from '../types.ts';
import { Track } from './Track.ts';
import {
  checkBranchRange,
  validateSegmentList,
  validateBranch,
} from './validate.ts';

/**
 * Tier extension: resolving `extends` chains into complete tracks.
 *
 * ARCHITECTURE.md 1.3 — tier N is tier N-1's segments plus the ones this file
 * appends, and the JSON references the previous tier rather than repeating it.
 * A 28 km tier-5 route therefore ships as five short files, and fixing a
 * corner in tier 1 fixes it in all five.
 *
 * Appending never shifts an earlier segment, so a fork declared in tier 1
 * keeps its `forkS` and `rejoinS` in every tier above it.
 */

/** A track file before its `extends` chain has been resolved. */
export interface TrackSource {
  id: string;
  name: string;
  scenery: SceneryTag;
  /** Id of the tier this one appends to, if any. */
  extends?: string;
  /** Only the segments this file adds. */
  segments: TrackSegment[];
  /** Only the branches this file adds. */
  branches: TrackBranch[];
}

const SCENERY: readonly SceneryTag[] = [
  'ridge',
  'yamuna',
  'ringroad',
  'oldcity',
  'flyway',
];

function fail(file: string, problem: string): never {
  throw new Error(`${file}: ${problem}`);
}

/** Validates one file's own fields, without resolving what it extends. */
export function validateTrackSource(file: string, raw: unknown): TrackSource {
  if (typeof raw !== 'object' || raw === null) {
    fail(file, 'track must be a JSON object');
  }
  const t = raw as Record<string, unknown>;

  const id = t['id'];
  if (typeof id !== 'string' || id.length === 0) {
    fail(file, `id must be a non-empty string, got ${JSON.stringify(id)}`);
  }
  const name = t['name'];
  if (typeof name !== 'string' || name.length === 0) {
    fail(file, `name must be a non-empty string, got ${JSON.stringify(name)}`);
  }
  const scenery = t['scenery'];
  if (typeof scenery !== 'string' || !SCENERY.includes(scenery as SceneryTag)) {
    fail(file, `scenery must be one of ${SCENERY.join(', ')}`);
  }

  const base = t['extends'];
  if (base !== undefined && (typeof base !== 'string' || base.length === 0)) {
    fail(
      file,
      `extends must be a non-empty string, got ${JSON.stringify(base)}`,
    );
  }

  const segments = validateSegmentList(file, 'segments', t['segments']);

  const rawBranches = t['branches'];
  if (!Array.isArray(rawBranches)) {
    fail(file, `branches must be an array, got ${JSON.stringify(rawBranches)}`);
  }
  // Branch spans are checked later, against the assembled length.
  const branches = rawBranches.map((b, i) =>
    validateBranch(file, `branches[${i}]`, b, Number.POSITIVE_INFINITY),
  );

  const source: TrackSource = {
    id,
    name,
    scenery: scenery as SceneryTag,
    segments,
    branches,
  };
  if (typeof base === 'string') source.extends = base;
  return source;
}

/** Walks the `extends` chain, appending as it goes. */
function assemble(
  file: string,
  source: TrackSource,
  sources: Map<string, { file: string; source: TrackSource }>,
  seen: Set<string>,
): TrackData {
  if (seen.has(source.id)) {
    fail(file, `extends forms a cycle: ${[...seen, source.id].join(' -> ')}`);
  }
  seen.add(source.id);

  if (source.extends === undefined) {
    return {
      id: source.id,
      name: source.name,
      scenery: source.scenery,
      segments: [...source.segments],
      branches: [...source.branches],
    };
  }

  const parent = sources.get(source.extends);
  if (!parent) {
    fail(file, `extends "${source.extends}", which is not a known track id`);
  }

  const base = assemble(parent.file, parent.source, sources, seen);
  return {
    id: source.id,
    name: source.name,
    scenery: source.scenery,
    segments: [...base.segments, ...source.segments],
    branches: [...base.branches, ...source.branches],
  };
}

/**
 * Resolves and builds every track in a set of files.
 *
 * Takes all the files at once because `extends` can point at any of them; a
 * loader that resolved one file at a time would need to go back to disk
 * mid-validation.
 */
export function loadTrackLibrary(
  files: Record<string, unknown>,
): Map<string, Track> {
  const sources = new Map<string, { file: string; source: TrackSource }>();

  for (const [file, raw] of Object.entries(files)) {
    const source = validateTrackSource(file, raw);
    const existing = sources.get(source.id);
    if (existing) {
      fail(file, `id "${source.id}" is already used by ${existing.file}`);
    }
    sources.set(source.id, { file, source });
  }

  const tracks = new Map<string, Track>();
  for (const [file, source] of [...sources.values()].map(
    (e) => [e.file, e.source] as const,
  )) {
    const data = assemble(file, source, sources, new Set());

    const mainLength = data.segments.reduce((sum, seg) => sum + seg.length, 0);
    data.branches.forEach((branch, i) => {
      checkBranchRange(file, `branches[${i}]`, branch, mainLength);
    });

    tracks.set(data.id, new Track(file, data));
  }
  return tracks;
}
