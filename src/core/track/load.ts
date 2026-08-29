import { Track } from './Track.ts';
import { validateTrackData } from './validate.ts';

/**
 * Turns raw parsed track JSON into a built `Track`, validating first.
 *
 * `file` is only ever used to name the offending file in error messages, which
 * is the difference between a fixable error and a five-minute hunt.
 */
export function loadTrack(file: string, raw: unknown): Track {
  return new Track(file, validateTrackData(file, raw));
}

/** Parses and loads track JSON from text, naming `file` on a syntax error too. */
export function parseTrack(file: string, text: string): Track {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${file}: is not valid JSON — ${detail}`);
  }
  return loadTrack(file, raw);
}
