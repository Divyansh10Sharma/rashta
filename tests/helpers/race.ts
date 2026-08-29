import { readFileSync, readdirSync } from 'node:fs';
import { loadTrackLibrary } from '../../src/core/track/library.ts';
import { loadBikes, loadTuning } from '../../src/core/sim/load.ts';
import { loadRacers } from '../../src/core/ai/load.ts';
import { createRace } from '../../src/core/sim/race.ts';
import type { TrackLibrary } from '../../src/core/track/library.ts';
import type { Track } from '../../src/core/track/Track.ts';
import type { RacerProfile } from '../../src/core/ai/types.ts';
import type { RaceState, TunedBike, Tuning } from '../../src/core/sim/types.ts';

/** The real game data, loaded once and shared by every race test. */

function routeFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const name of readdirSync('src/data/tracks')) {
    if (!/-t\d\.json$/.test(name)) continue;
    files[name] = JSON.parse(readFileSync(`src/data/tracks/${name}`, 'utf8'));
  }
  return files;
}

export const library: TrackLibrary = loadTrackLibrary(routeFiles());

export const tuning: Tuning = loadTuning(
  'tuning.json',
  JSON.parse(readFileSync('src/data/tuning.json', 'utf8')),
);

export const bikes: TunedBike[] = loadBikes(
  'bikes.json',
  JSON.parse(readFileSync('src/data/bikes.json', 'utf8')),
  tuning,
);

export const racers: RacerProfile[] = loadRacers(
  'racers.json',
  JSON.parse(readFileSync('src/data/racers.json', 'utf8')),
);

const byId = new Map(bikes.map((b) => [b.spec.id, b]));

/** The bike a profile starts on. Throws rather than quietly substituting. */
export function bikeFor(profile: RacerProfile): TunedBike {
  const bike = byId.get(profile.startingBike);
  if (!bike) throw new Error(`no bike "${profile.startingBike}"`);
  return bike;
}

export function trackFor(id: string): Track {
  const track = library.get(id);
  if (!track) throw new Error(`no track "${id}"`);
  return track;
}

/** Every route id in the library, tier 1 through 5. */
export const ROUTE_IDS: string[] = [
  'ridge-run',
  'yamuna-bank',
  'ring-road',
  'old-city',
  'dnd-flyway',
].flatMap((route) => [1, 2, 3, 4, 5].map((tier) => `${route}-t${tier}`));

export function raceOn(track: Track, seed = 1): RaceState {
  return createRace(racers, 'player', bikeFor, track, seed);
}
