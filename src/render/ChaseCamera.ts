import * as THREE from 'three';
import type { Track } from '../core/track/Track.ts';
import { createFrame } from '../core/track/path.ts';

/**
 * The chase camera, and most of this game's sense of speed.
 *
 * Speed on a screen is not a number, it is a set of cues: the field of view
 * opening up, the camera dropping and falling back, and the whole frame
 * lagging a beat behind a change of direction. None of it is physical. All of
 * it is tuned by eye, which is why the constants are here and named rather
 * than buried in an expression.
 */

const BASE_FOV = 62;
const MAX_FOV_GAIN = 22;

const BASE_DISTANCE = 7.2;
const MAX_DISTANCE_GAIN = 3.4;

const BASE_HEIGHT = 3.1;
const MAX_HEIGHT_DROP = 0.85;

/** How quickly the camera's lateral position catches up with the bike's. */
const LATERAL_LAG = 3.4;
/** How quickly FOV and distance respond, so a speed change is felt not snapped. */
const RESPONSE = 2.6;

const LOOK_AHEAD_METRES = 26;

export class ChaseCamera {
  private readonly frame = createFrame();
  private readonly aheadFrame = createFrame();
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  // Scratch. CLAUDE.md: no allocation inside the per-frame loop, and this
  // runs every frame at display rate.
  private readonly scratchRight = new THREE.Vector3();
  private readonly scratchForward = new THREE.Vector3();

  private laggedT = 0;
  private smoothedSpeed = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Snaps to the rider with no easing. Use when a race starts. */
  reset(t: number): void {
    this.laggedT = t;
    this.smoothedSpeed = 0;
  }

  /**
   * Places the camera behind the rider.
   *
   * `speedFraction` is speed as a fraction of the bike's top speed — the cues
   * are proportional to how fast this bike goes, not to an absolute number, so
   * a Street bike flat out still feels fast.
   */
  update(
    track: Track,
    s: number,
    t: number,
    speedFraction: number,
    branchId: number,
    dt: number,
  ): void {
    const ease = Math.min(1, RESPONSE * dt);
    this.smoothedSpeed += (speedFraction - this.smoothedSpeed) * ease;
    const gain = Math.max(0, Math.min(1, this.smoothedSpeed));

    // Lateral lag: the camera trails a change of line rather than tracking it,
    // so weaving reads as the bike moving under a steady camera.
    this.laggedT += (t - this.laggedT) * Math.min(1, LATERAL_LAG * dt);

    track.sample(s, this.frame, branchId);
    track.sample(s + LOOK_AHEAD_METRES, this.aheadFrame, branchId);

    const distance = BASE_DISTANCE + MAX_DISTANCE_GAIN * gain;
    const height = BASE_HEIGHT - MAX_HEIGHT_DROP * gain;

    this.scratchRight.set(
      this.frame.right.x,
      this.frame.right.y,
      this.frame.right.z,
    );
    this.scratchForward.set(
      this.frame.forward.x,
      this.frame.forward.y,
      this.frame.forward.z,
    );

    this.desired
      .set(this.frame.position.x, this.frame.position.y, this.frame.position.z)
      .addScaledVector(this.scratchRight, this.laggedT)
      .addScaledVector(this.scratchForward, -distance);
    this.desired.y += height;

    this.camera.position.copy(this.desired);

    this.scratchRight.set(
      this.aheadFrame.right.x,
      this.aheadFrame.right.y,
      this.aheadFrame.right.z,
    );
    this.target
      .set(
        this.aheadFrame.position.x,
        this.aheadFrame.position.y,
        this.aheadFrame.position.z,
      )
      .addScaledVector(this.scratchRight, t * 0.5);
    this.target.y += 1.1;
    this.camera.lookAt(this.target);

    const fov = BASE_FOV + MAX_FOV_GAIN * gain;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
