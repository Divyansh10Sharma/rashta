import type {
  HazardSpec,
  SceneryTag,
  TrackBranch,
  TrackData,
  TrackSegment,
} from '../types.ts';

/**
 * Validation of track JSON, run before anything is built from it.
 *
 * CLAUDE.md: errors on bad data are loud and early, and name the file and the
 * field. Every throw here quotes a path like
 * `ridge-run.json: segments[7].halfWidth` so the author can go straight to it.
 */

const SCENERY: readonly SceneryTag[] = [
  'ridge',
  'yamuna',
  'ringroad',
  'oldcity',
  'flyway',
];

const HAZARDS = [
  'oil',
  'pothole',
  'roadworks',
  'barricade',
  'dog',
  'cow',
  'sand',
] as const;

/** Largest length difference between a fork's two routes. See GAME_DESIGN.md. */
export const MAX_BRANCH_LENGTH_DELTA = 0.05;

class TrackDataError extends Error {}

function fail(file: string, path: string, problem: string): never {
  throw new TrackDataError(`${file}: ${path} ${problem}`);
}

function requireFiniteNumber(
  file: string,
  path: string,
  value: unknown,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(file, path, `must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireNonEmptyString(
  file: string,
  path: string,
  value: unknown,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(
      file,
      path,
      `must be a non-empty string, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireArray(file: string, path: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    fail(file, path, `must be an array, got ${JSON.stringify(value)}`);
  }
  return value;
}

function validateHazard(
  file: string,
  path: string,
  raw: unknown,
  segmentLength: number,
): HazardSpec {
  if (typeof raw !== 'object' || raw === null) {
    fail(file, path, 'must be an object');
  }
  const h = raw as Record<string, unknown>;
  const kind = h['kind'];
  if (
    typeof kind !== 'string' ||
    !HAZARDS.includes(kind as HazardSpec['kind'])
  ) {
    fail(file, `${path}.kind`, `must be one of ${HAZARDS.join(', ')}`);
  }
  const offset = requireFiniteNumber(file, `${path}.offset`, h['offset']);
  if (offset < 0 || offset > segmentLength) {
    fail(
      file,
      `${path}.offset`,
      `must be within [0, ${segmentLength}], got ${offset}`,
    );
  }
  return {
    kind: kind as HazardSpec['kind'],
    offset,
    t: requireFiniteNumber(file, `${path}.t`, h['t']),
  };
}

function validateSegment(
  file: string,
  path: string,
  raw: unknown,
): TrackSegment {
  if (typeof raw !== 'object' || raw === null) {
    fail(file, path, 'must be an object');
  }
  const s = raw as Record<string, unknown>;

  const length = requireFiniteNumber(file, `${path}.length`, s['length']);
  if (length <= 0)
    fail(file, `${path}.length`, `must be positive, got ${length}`);

  const curvature = requireFiniteNumber(
    file,
    `${path}.curvature`,
    s['curvature'],
  );

  const gradient = requireFiniteNumber(file, `${path}.gradient`, s['gradient']);
  if (Math.abs(gradient) >= 1) {
    fail(file, `${path}.gradient`, `must be within (-1, 1), got ${gradient}`);
  }

  const bank = requireFiniteNumber(file, `${path}.bank`, s['bank']);
  if (Math.abs(bank) >= Math.PI / 2) {
    fail(
      file,
      `${path}.bank`,
      `must be within (-pi/2, pi/2) radians, got ${bank}`,
    );
  }

  const halfWidth = requireFiniteNumber(
    file,
    `${path}.halfWidth`,
    s['halfWidth'],
  );
  if (halfWidth <= 0) {
    fail(file, `${path}.halfWidth`, `must be positive, got ${halfWidth}`);
  }

  const shoulder = requireFiniteNumber(file, `${path}.shoulder`, s['shoulder']);
  if (shoulder < 0) {
    fail(file, `${path}.shoulder`, `must not be negative, got ${shoulder}`);
  }

  // ARCHITECTURE.md 1.4: beyond this the inside edge of the road has folded
  // through the centre of curvature and (1 - t*k) goes non-positive, which
  // would make trackDistance return nonsense instead of failing.
  if (curvature !== 0) {
    const radius = 1 / Math.abs(curvature);
    if (halfWidth + shoulder >= radius) {
      fail(
        file,
        path,
        `is degenerate: halfWidth + shoulder (${halfWidth + shoulder}) must be ` +
          `less than the corner radius (${radius}) for curvature ${curvature}`,
      );
    }
  }

  const lanes = requireFiniteNumber(file, `${path}.lanes`, s['lanes']);
  if (!Number.isInteger(lanes) || lanes < 1) {
    fail(
      file,
      `${path}.lanes`,
      `must be an integer of at least 1, got ${lanes}`,
    );
  }

  const oneWay = s['oneWay'];
  if (typeof oneWay !== 'boolean') {
    fail(
      file,
      `${path}.oneWay`,
      `must be a boolean, got ${JSON.stringify(oneWay)}`,
    );
  }

  const scenery = s['scenery'];
  if (typeof scenery !== 'string' || !SCENERY.includes(scenery as SceneryTag)) {
    fail(file, `${path}.scenery`, `must be one of ${SCENERY.join(', ')}`);
  }

  const hazards = requireArray(file, `${path}.hazards`, s['hazards']).map(
    (h, i) => validateHazard(file, `${path}.hazards[${i}]`, h, length),
  );

  return {
    length,
    curvature,
    gradient,
    bank,
    halfWidth,
    shoulder,
    lanes,
    oneWay,
    scenery: scenery as SceneryTag,
    hazards,
  };
}

function validateSegmentList(
  file: string,
  path: string,
  raw: unknown,
): TrackSegment[] {
  const list = requireArray(file, path, raw);
  if (list.length === 0) fail(file, path, 'must contain at least one segment');
  return list.map((seg, i) => validateSegment(file, `${path}[${i}]`, seg));
}

function validateBranch(
  file: string,
  path: string,
  raw: unknown,
  mainLength: number,
): TrackBranch {
  if (typeof raw !== 'object' || raw === null)
    fail(file, path, 'must be an object');
  const b = raw as Record<string, unknown>;

  const id = requireNonEmptyString(file, `${path}.id`, b['id']);
  const forkS = requireFiniteNumber(file, `${path}.forkS`, b['forkS']);
  const rejoinS = requireFiniteNumber(file, `${path}.rejoinS`, b['rejoinS']);

  if (forkS < 0 || forkS >= mainLength) {
    fail(
      file,
      `${path}.forkS`,
      `must be within [0, ${mainLength}), got ${forkS}`,
    );
  }
  if (rejoinS <= forkS || rejoinS > mainLength) {
    fail(
      file,
      `${path}.rejoinS`,
      `must be within (${forkS}, ${mainLength}], got ${rejoinS}`,
    );
  }

  const segments = validateSegmentList(file, `${path}.segments`, b['segments']);
  const branchLength = segments.reduce((sum, seg) => sum + seg.length, 0);
  const mainSpan = rejoinS - forkS;
  const delta = Math.abs(branchLength - mainSpan) / mainSpan;

  // GAME_DESIGN.md: a fork balanced with raw distance is not a choice, it is
  // an arithmetic problem with one answer.
  if (delta > MAX_BRANCH_LENGTH_DELTA) {
    fail(
      file,
      `${path}.segments`,
      `total length ${branchLength.toFixed(3)} differs from the main span ` +
        `${mainSpan.toFixed(3)} by ${(delta * 100).toFixed(1)}%, over the ` +
        `${(MAX_BRANCH_LENGTH_DELTA * 100).toFixed(0)}% limit`,
    );
  }

  return { id, forkS, rejoinS, segments };
}

/** Validates raw parsed JSON and returns it typed. Throws on the first problem. */
export function validateTrackData(file: string, raw: unknown): TrackData {
  if (typeof raw !== 'object' || raw === null) {
    fail(file, 'track', 'must be a JSON object');
  }
  const t = raw as Record<string, unknown>;

  const id = requireNonEmptyString(file, 'id', t['id']);
  const name = requireNonEmptyString(file, 'name', t['name']);

  const scenery = t['scenery'];
  if (typeof scenery !== 'string' || !SCENERY.includes(scenery as SceneryTag)) {
    fail(file, 'scenery', `must be one of ${SCENERY.join(', ')}`);
  }

  const segments = validateSegmentList(file, 'segments', t['segments']);
  const mainLength = segments.reduce((sum, seg) => sum + seg.length, 0);

  const branches = requireArray(file, 'branches', t['branches']).map((b, i) =>
    validateBranch(file, `branches[${i}]`, b, mainLength),
  );

  return { id, name, scenery: scenery as SceneryTag, segments, branches };
}
