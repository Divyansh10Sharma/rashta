/** Rival riders: who they are, and what the AI remembers between ticks. */

/** A racer as written in `src/data/racers.json`. Immutable once loaded. */
export interface RacerProfile {
  id: string;
  name: string;
  /** 0..1 — racing line quality and how often they reconsider it. */
  skill: number;
  /** 0..1 — how readily they attack. Read in Phase 6; shapes lines here. */
  aggression: number;
  /** 0..1 — how much a hit shifts their standing toward the attacker. */
  vengefulness: number;
  /** 0..1 — traffic avoidance versus commitment. */
  caution: number;
  startingBike: string;
  startingCash: number;
  startingWeapon: string | null;
  bio: string;
}

/**
 * What a rival is currently trying to do.
 *
 * Held per rider and carried across ticks because a decision that is retaken
 * every tick is not a decision — a rider that recomputes its line sixty times
 * a second oscillates between two equally good gaps and takes neither.
 */
export interface RacerBrain {
  /** Metres right of the centreline the rider is steering toward. */
  targetT: number;
  /** Seconds until the line is reconsidered. Lower for higher skill. */
  thinkTimer: number;
  /** Speed cap in m/s from the corner ahead, recomputed with the line. */
  cornerLimit: number;
  /**
   * Multiplier on every speed limit this rider obeys. Exactly 1 unless
   * rubber-banding is switched on in the tuning data, and written by the race,
   * not by the brain — catching up needs to know where the player is, and the
   * brain deliberately does not.
   */
  pace: number;
  /**
   * Stamina the rider had last tick.
   *
   * The only way a rival notices it is being attacked: an unexplained drop is
   * a hit. Cheaper and more honest than telling the AI who swung at it —
   * a rider on a motorcycle at night does not know either.
   */
  lastStamina: number;
  /** Seconds of wanting to hit back, set when stamina drops unexpectedly. */
  grudge: number;
  /** Seconds until this rider may throw another attack. */
  swingTimer: number;
}
