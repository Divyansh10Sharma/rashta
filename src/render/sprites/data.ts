import type { HazardKind, SceneryTag } from '../../core/types.ts';
import type { TrafficKind } from '../../core/sim/types.ts';
import { SCENERY_TAGS } from '../../core/track/validate.ts';
import { RIDER_FRAMES } from './frames.ts';

/**
 * Validation and loading for `src/data/sprites.json`: how big each picture is
 * in metres, and which pictures each place uses.
 *
 * Same contract as every other loader: loud, early, naming the file and field.
 * Render-only data — the simulation never reads it, which is why it lives
 * beside the renderer and not in core.
 */

/** A picture's real size. Exactly one dimension; the other follows the art. */
export interface SpriteSize {
  width?: number;
  height?: number;
  /** Lies flat on the road — oil, a pothole — rather than standing up. */
  lying: boolean;
}

/** What one place looks like from the road. */
export interface PlaceSprites {
  /** Multiplies every sprite, pulling the shared art toward this place's light. */
  light: string;
  /** The streetlight, or null to keep the generated mast. */
  lamp: string | null;
  /** Roadside things, cycled in order. Repeats weight the mix. */
  props: string[];
  /** Metres between props on one side. */
  propSpacing: number;
  /** Per kind, the pictures to cycle through, without `-rear`/`-front`. */
  traffic: Record<TrafficKind, string[]>;
}

/** The whole file, validated. */
export interface SpriteData {
  sizes: Record<string, SpriteSize>;
  hazards: Record<HazardKind, string | null>;
  places: Record<SceneryTag, PlaceSprites>;
}

const TRAFFIC_KINDS: readonly TrafficKind[] = ['car', 'auto', 'bus', 'truck'];
// A Record rather than a list so the compiler notices a new hazard kind.
const HAZARD_KINDS = Object.keys({
  oil: 0,
  sand: 0,
  pothole: 0,
  roadworks: 0,
  barricade: 0,
  cow: 0,
  dog: 0,
} satisfies Record<HazardKind, 0>) as HazardKind[];

function fail(file: string, path: string, problem: string): never {
  throw new Error(`${file}: ${path} ${problem}`);
}

function group(
  file: string,
  path: string,
  raw: unknown,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(file, path, 'must be an object');
  }
  return raw as Record<string, unknown>;
}

function positive(file: string, path: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(file, path, `must be a positive number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function name(
  file: string,
  path: string,
  value: unknown,
  sized: object,
): string {
  if (typeof value !== 'string' || value === '') {
    fail(file, path, `must be a picture name, got ${JSON.stringify(value)}`);
  }
  if (!(value in sized))
    fail(file, path, `names "${value}", which has no entry in sizes`);
  return value;
}

function loadSize(file: string, path: string, raw: unknown): SpriteSize {
  const entry = group(file, path, raw);
  const hasWidth = entry['width'] !== undefined;
  const hasHeight = entry['height'] !== undefined;
  if (hasWidth === hasHeight)
    fail(file, path, 'must give exactly one of width or height');
  const lying = entry['lying'] ?? false;
  if (typeof lying !== 'boolean')
    fail(file, `${path}.lying`, 'must be true or false');
  return hasWidth
    ? { width: positive(file, `${path}.width`, entry['width']), lying }
    : { height: positive(file, `${path}.height`, entry['height']), lying };
}

function names(
  file: string,
  path: string,
  raw: unknown,
  check: (v: unknown, p: string) => string,
) {
  if (!Array.isArray(raw)) fail(file, path, 'must be a list');
  return raw.map((value, i) => check(value, `${path}[${i}]`));
}

function loadPlace(
  file: string,
  path: string,
  raw: unknown,
  sizes: object,
): PlaceSprites {
  const place = group(file, path, raw);
  const light = place['light'];
  if (typeof light !== 'string' || !/^#[0-9a-f]{6}$/i.test(light)) {
    fail(
      file,
      `${path}.light`,
      `must be a colour like "#ffe0c0", got ${JSON.stringify(light)}`,
    );
  }
  const lamp =
    place['lamp'] === null
      ? null
      : name(file, `${path}.lamp`, place['lamp'], sizes);
  const props = names(file, `${path}.props`, place['props'], (v, p) =>
    name(file, p, v, sizes),
  );
  const spacing = place['propSpacing'];
  const propSpacing =
    props.length === 0 && spacing === 0
      ? 0
      : positive(file, `${path}.propSpacing`, spacing);

  const trafficRaw = group(file, `${path}.traffic`, place['traffic']);
  const traffic = {} as Record<TrafficKind, string[]>;
  for (const kind of TRAFFIC_KINDS) {
    const at = `${path}.traffic.${kind}`;
    const list = names(file, at, trafficRaw[kind], (v, p) => {
      if (typeof v !== 'string' || !v.startsWith('traffic/')) {
        fail(
          file,
          p,
          `must be a traffic picture like "traffic/sedan", got ${JSON.stringify(v)}`,
        );
      }
      return v;
    });
    if (list.length === 0) fail(file, at, 'must name at least one picture');
    traffic[kind] = list;
  }
  return { light, lamp, props, propSpacing, traffic };
}

/** Parses and validates the sprite data. Throws on the first problem. */
export function loadSpriteData(file: string, raw: unknown): SpriteData {
  const root = group(file, 'root', raw);

  const sizesRaw = group(file, 'sizes', root['sizes']);
  const sizes: Record<string, SpriteSize> = {};
  for (const [key, value] of Object.entries(sizesRaw)) {
    sizes[key] = loadSize(file, `sizes.${key}`, value);
  }
  // Every frame the rider sheet can ask for must have a size, or the first
  // crash of the race is the first time anyone finds out.
  for (const frame of RIDER_FRAMES) {
    if (!(`rider/${frame}` in sizes))
      fail(file, `sizes.rider/${frame}`, 'is missing');
  }
  for (const required of ['police/centre', 'police/lean', 'bike/down']) {
    if (!(required in sizes)) fail(file, `sizes.${required}`, 'is missing');
  }

  const hazardsRaw = group(file, 'hazards', root['hazards']);
  const hazards = {} as Record<HazardKind, string | null>;
  for (const kind of HAZARD_KINDS) {
    const value = hazardsRaw[kind];
    hazards[kind] =
      value === null ? null : name(file, `hazards.${kind}`, value, sizes);
  }

  const placesRaw = group(file, 'places', root['places']);
  const places = {} as Record<SceneryTag, PlaceSprites>;
  for (const tag of SCENERY_TAGS) {
    places[tag] = loadPlace(file, `places.${tag}`, placesRaw[tag], sizes);
  }
  return { sizes, hazards, places };
}

/**
 * Width and height in metres for a picture of the given aspect (height over
 * width), from whichever dimension the data gives.
 */
export function metresFor(
  size: SpriteSize,
  aspect: number,
  out: { w: number; h: number },
) {
  if (size.width !== undefined) {
    out.w = size.width;
    out.h = size.width * aspect;
  } else {
    out.h = size.height ?? 1;
    out.w = out.h / aspect;
  }
  return out;
}
