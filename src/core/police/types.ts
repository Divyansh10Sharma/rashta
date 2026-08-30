import type { InputFrame, Rider } from '../sim/types.ts';

/** Police riders: pursuit, ramming, and what a bust costs. */

/** What a police rider is doing. */
export type PursuitState = 'patrolling' | 'pursuing';

/** `src/data/police.json`, validated. */
export interface PoliceData {
  pursuit: {
    /** m/s above which an officer takes an interest. */
    triggerSpeed: number;
    /** m/s below which the target stops looking worth chasing. */
    dropSpeed: number;
    /** Seconds under `dropSpeed` before pursuit is abandoned. */
    dropSeconds: number;
    /** Metres of gap at which an officer gives up regardless of speed. */
    loseDistance: number;
    /** Metres an officer tries to sit behind its target before ramming. */
    closeGap: number;
    /** Metres ahead of a target at which an officer holds station to block. */
    blockGap: number;
    /** Seconds between rams, so an officer is not a machine gun. */
    ramCooldown: number;
    /** Seconds an officer takes to notice. Keeps a brief burst survivable. */
    reactionSeconds: number;
  };
  arrest: {
    /** Metres, measured with `trackDistance` like every other range. */
    radius: number;
    /** Flat part of the fine, in rupees. */
    fineBase: number;
    /** Fraction of the bike's price added to the fine. */
    fineBikeFraction: number;
  };
  damage: {
    /** Damage added by one crash, of 100. */
    perCrash: number;
    /** Damage added by one landed hit. */
    perHit: number;
    /** Damage at which the bike is wrecked. */
    wreckAt: number;
    /** Repair cost as a fraction of bike price, at full damage. */
    repairFraction: number;
    /** Extra cost as a fraction of bike price when the bike is wrecked. */
    wreckFraction: number;
  };
}

/** One police rider on the road. Not a race entry: they are not racing. */
export interface PoliceUnit {
  rider: Rider;
  /** This tick's input. Reused, never reallocated — same rule as a rival. */
  input: InputFrame;
  state: PursuitState;
  /** Index into `race.entries` of whoever is being chased, or -1. */
  target: number;
  /** Seconds the target has been slow enough to lose interest in. */
  slowFor: number;
  /** Seconds until this officer will ram again. */
  ramTimer: number;
  /** True while sitting in front of the quarry rather than chasing it down. */
  blocking: boolean;
  /** Seconds before an officer reacts to a speeding rider. */
  noticeTimer: number;
  /** Lateral line it is steering toward. */
  targetT: number;
  active: boolean;
}

/** Why a race ended badly. */
export type FailReason = 'retired' | 'arrested' | 'wrecked';

/** What a race cost or paid, in rupees. Phase 8 spends it; Phase 7 computes it. */
export interface RaceOutcome {
  place: number;
  finished: boolean;
  failReason: FailReason | null;
  /** Prize money. Zero until Phase 8 brings the table. */
  prize: number;
  fine: number;
  repair: number;
  /** Bike damage at the end, 0–100. */
  damage: number;
  wrecked: boolean;
  /** `prize - fine - repair`. Negative is a bad night. */
  net: number;
}
