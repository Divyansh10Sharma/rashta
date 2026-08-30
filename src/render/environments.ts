import * as THREE from 'three';
import type { SceneryTag } from '../core/types.ts';

/**
 * What each part of Delhi looks like at night.
 *
 * One table, keyed by the scenery tag a track segment carries, holding sky,
 * fog, light colours, road surface and roadside furniture. Adding a sixth
 * district is a row here, not a change to the renderer.
 *
 * All five are sodium-vapour and blue shadow. See CLAUDE.md — this is the
 * visual identity, and it is not California.
 */

export interface Environment {
  /** Background and fog colour — they must match or the horizon shows a seam. */
  sky: number;
  fogNear: number;
  fogFar: number;
  /** The warm key light, standing in for streetlights. */
  keyColour: number;
  keyIntensity: number;
  /** Cool bounce, for everything the lamps do not reach. */
  ambientColour: number;
  ambientIntensity: number;
  road: number;
  roadRoughness: number;
  /**
   * How wet the surface looks, 0 to 1.
   *
   * Puddles catching the sodium lights are most of what makes a road read as
   * wet, and the Yamuna bank is the one place in the game it should.
   */
  roadWet: number;
  paint: number;
  kerb: number;
  /** How far ahead scenery is placed. Narrow streets need less. */
  sceneryAhead: number;
  lightSpacing: number;
  bollardSpacing: number;
  /** Colour of the roadside masts and railings. */
  furniture: number;
}

export const ENVIRONMENTS: Record<SceneryTag, Environment> = {
  // Forested, unlit, and the darkest thing in the game. Fog close in so the
  // blind crests stay blind.
  ridge: {
    sky: 0x05070a,
    fogNear: 45,
    fogFar: 260,
    keyColour: 0x9fb4d8,
    keyIntensity: 0.7,
    ambientColour: 0x141d2e,
    ambientIntensity: 0.85,
    road: 0x1e2024,
    roadRoughness: 0.95,
    roadWet: 0.05,
    paint: 0xc8c4b0,
    kerb: 0x3d4038,
    sceneryAhead: 340,
    lightSpacing: 95,
    bollardSpacing: 14,
    furniture: 0x2e3630,
  },

  // Wide, open, and hazy off the water. Long sightlines, few lamps.
  yamuna: {
    sky: 0x0a0d14,
    fogNear: 70,
    fogFar: 520,
    keyColour: 0xffc98a,
    keyIntensity: 1.1,
    ambientColour: 0x1c2740,
    ambientIntensity: 1.0,
    road: 0x26262c,
    roadRoughness: 0.9,
    roadWet: 0.55,
    paint: 0xd8d4c4,
    kerb: 0x55525a,
    sceneryAhead: 520,
    lightSpacing: 54,
    bollardSpacing: 11,
    furniture: 0x3a3a42,
  },

  // The default: lit end to end, four lanes, everything orange.
  ringroad: {
    sky: 0x07070b,
    fogNear: 90,
    fogFar: 420,
    keyColour: 0xffb765,
    keyIntensity: 1.5,
    ambientColour: 0x2b3452,
    ambientIntensity: 1.1,
    road: 0x24242a,
    roadRoughness: 0.92,
    roadWet: 0.18,
    paint: 0xd8d4c4,
    kerb: 0x55525a,
    sceneryAhead: 460,
    lightSpacing: 38,
    bollardSpacing: 9,
    furniture: 0x3a3a42,
  },

  // Tight, close, and lit by whatever is hanging off the buildings. Fog is
  // pulled right in — you cannot see round the next corner anyway.
  oldcity: {
    sky: 0x0c0806,
    fogNear: 25,
    fogFar: 150,
    keyColour: 0xffd9a0,
    keyIntensity: 1.7,
    ambientColour: 0x33251c,
    ambientIntensity: 1.25,
    road: 0x2c2722,
    roadRoughness: 0.98,
    roadWet: 0.3,
    paint: 0xb8ae94,
    kerb: 0x5c5044,
    sceneryAhead: 160,
    lightSpacing: 22,
    bollardSpacing: 6,
    furniture: 0x4a4038,
  },

  // Elevated, fast, and empty. The longest sightlines in the game, and no
  // barrier on one side — so the edge has to read clearly.
  flyway: {
    sky: 0x04060e,
    fogNear: 120,
    fogFar: 700,
    keyColour: 0xdfe8ff,
    keyIntensity: 1.2,
    ambientColour: 0x18213c,
    ambientIntensity: 0.95,
    road: 0x2a2a30,
    roadRoughness: 0.86,
    roadWet: 0.1,
    paint: 0xe8e4d4,
    kerb: 0x6b6b73,
    sceneryAhead: 700,
    lightSpacing: 44,
    bollardSpacing: 8,
    furniture: 0x4a4a52,
  },
};

/** Applies an environment's sky, fog and lights to a scene. Reuses the lights. */
export function applyEnvironment(
  scene: THREE.Scene,
  key: THREE.DirectionalLight,
  ambient: THREE.AmbientLight,
  hemi: THREE.HemisphereLight,
  env: Environment,
): void {
  if (scene.background instanceof THREE.Color) scene.background.setHex(env.sky);
  else scene.background = new THREE.Color(env.sky);

  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.setHex(env.sky);
    scene.fog.near = env.fogNear;
    scene.fog.far = env.fogFar;
  } else {
    scene.fog = new THREE.Fog(env.sky, env.fogNear, env.fogFar);
  }

  key.color.setHex(env.keyColour);
  key.intensity = env.keyIntensity;
  ambient.color.setHex(env.ambientColour);
  ambient.intensity = env.ambientIntensity;
  hemi.color.setHex(env.keyColour);
  hemi.groundColor.setHex(env.ambientColour);
}
