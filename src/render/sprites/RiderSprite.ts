import * as THREE from 'three';
import type { Track } from '../../core/track/Track.ts';
import type { Rider } from '../../core/sim/types.ts';
import { isDown } from '../../core/sim/crash.ts';
import { createFrame } from '../../core/track/path.ts';
import { createRiderView } from '../Rider.ts';
import {
  RIDER_FRAMES,
  resolveFrame,
  riderFrame,
  type FrameChoice,
  type RiderFrame,
} from './frames.ts';
import { composeCard, createSpriteMaterial, useTexture } from './Billboard.ts';
import { metresFor, type SpriteSize } from './data.ts';
import type { Picture } from './library.ts';
import type { SpriteKit } from './kit.ts';

/**
 * One rider, drawn: the sprite when its pictures are in, the old mesh when
 * they are not.
 *
 * This is where the crash becomes visible. Phase 4 left the contract — `h`
 * for height, `bikePos` for where the machine went — and this reads it: the
 * rider card rides at `(s, t, h)`, and once they are down the bike is its own
 * card at `bikePos`, so the gap the rider has to run is on screen.
 */

/** Which picture set a rider is drawn from. */
export type Sheet = 'rider' | 'police';

/** A rider view that interpolates between two sim states itself. */
export interface RiderDrawing {
  group: THREE.Group;
  /** Where the rider was last drawn, on or above the road. */
  position: THREE.Vector3;
  update: (track: Track, before: Rider, now: Rider, alpha: number) => void;
  /** Combat glow, 0 to 1. See `RiderView.highlight`. */
  highlight: (amount: number, hostile: boolean) => void;
  dispose: () => void;
}

interface Framed {
  picture: Picture;
  size: SpriteSize;
}

/** How far a rival's livery pulls the neutral grey sheet toward its colour. */
const LIVERY_TINT = 0.55;

/**
 * The police have only upright and leaning pictures of their own. Down, they
 * are a rider like any other.
 */
function pathFor(sheet: Sheet, frame: RiderFrame): string {
  if (sheet === 'police') {
    if (frame === 'lean' || frame === 'hard') return 'police/lean';
    const upright = frame === 'centre' || frame === 'punch';
    if (upright || frame === 'kick' || frame === 'swing')
      return 'police/centre';
  }
  return `rider/${frame}`;
}

function framed(kit: SpriteKit, path: string): Framed {
  const size = kit.data.sizes[path];
  if (!size) throw new Error(`sprites.json: sizes.${path} is missing`);
  return { picture: kit.library.get(path), size };
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/** A rider drawing with the mesh only: what every view had before sprites. */
function meshOnly(colour: number): RiderDrawing {
  const mesh = createRiderView(colour);
  return {
    group: mesh.group,
    position: mesh.group.position,
    update: (track, a, b, alpha) =>
      mesh.update(
        track,
        lerp(a.pos.s, b.pos.s, alpha),
        lerp(a.pos.t, b.pos.t, alpha),
        lerp(a.lean, b.lean, alpha),
        lerp(a.wheelAngle, b.wheelAngle, alpha),
        b.pos.branchId,
      ),
    highlight: mesh.highlight,
    dispose: mesh.dispose,
  };
}

/** Creates a rider drawing in `colour`; with no kit, it is the mesh alone. */
export function createRiderDrawing(
  colour: number,
  kit: SpriteKit | null,
  sheet: Sheet = 'rider',
): RiderDrawing {
  if (!kit) return meshOnly(colour);

  const group = new THREE.Group();
  const mesh = createRiderView(colour);
  group.add(mesh.group);

  const frames = new Map<RiderFrame, Framed>();
  for (const frame of RIDER_FRAMES)
    frames.set(frame, framed(kit, pathFor(sheet, frame)));
  const bike = framed(kit, 'bike/down');
  const drawable = (frame: RiderFrame): boolean =>
    frames.get(frame)?.picture.status === 'ready';

  const riderMaterial = createSpriteMaterial();
  const bikeMaterial = createSpriteMaterial();
  const riderCard = new THREE.Mesh(kit.card, riderMaterial);
  const bikeCard = new THREE.Mesh(kit.card, bikeMaterial);
  for (const card of [riderCard, bikeCard]) {
    card.matrixAutoUpdate = false;
    card.visible = false;
    group.add(card);
  }

  // The police sheet is already painted; the rider sheet is grey on purpose,
  // so each rival is the one sheet pulled toward their livery.
  const base = new THREE.Color(1, 1, 1);
  if (sheet === 'rider') base.lerp(new THREE.Color(colour), LIVERY_TINT);
  base.multiply(kit.light);
  riderMaterial.color.copy(base);
  bikeMaterial.color.copy(base);

  // Scratch — this runs every frame for every rider.
  const trackFrame = createFrame();
  const choice: FrameChoice = { frame: 'centre', mirror: false };
  const metres = { w: 1, h: 1 };
  const position = new THREE.Vector3();
  const bikeAt = new THREE.Vector3();

  const onRoad = (
    track: Track,
    s: number,
    t: number,
    h: number,
    branchId: number,
    out: THREE.Vector3,
  ): void => {
    track.sample(s, trackFrame, branchId);
    const f = trackFrame;
    out.set(
      f.position.x + f.right.x * t + f.up.x * h,
      f.position.y + f.right.y * t + f.up.y * h,
      f.position.z + f.right.z * t + f.up.z * h,
    );
  };

  const draw = (
    card: THREE.Mesh,
    material: THREE.MeshBasicMaterial,
    entry: Framed,
    at: THREE.Vector3,
    mirror: boolean,
  ): void => {
    const { picture } = entry;
    if (!picture.texture) return;
    useTexture(material, picture.texture);
    metresFor(entry.size, picture.aspect, metres);
    composeCard(
      card.matrix,
      at,
      kit.facing,
      metres.w,
      metres.h,
      picture.anchor,
      mirror,
    );
    card.matrixWorldNeedsUpdate = true;
    card.visible = true;
  };

  const update = (track: Track, a: Rider, b: Rider, alpha: number): void => {
    const s = lerp(a.pos.s, b.pos.s, alpha);
    const t = lerp(a.pos.t, b.pos.t, alpha);
    riderFrame(b, kit.leanMax, choice);
    const shown = resolveFrame(choice.frame, drawable);
    const entry = shown === null ? undefined : frames.get(shown);

    if (!entry) {
      riderCard.visible = false;
      bikeCard.visible = false;
      mesh.group.visible = true;
      mesh.update(
        track,
        s,
        t,
        lerp(a.lean, b.lean, alpha),
        lerp(a.wheelAngle, b.wheelAngle, alpha),
        b.pos.branchId,
      );
      position.copy(mesh.group.position);
      return;
    }

    mesh.group.visible = false;
    onRoad(track, s, t, lerp(a.h, b.h, alpha), b.pos.branchId, position);
    draw(riderCard, riderMaterial, entry, position, choice.mirror);

    // Remounting is drawn with the rider already on the bike, so the bike is
    // only its own card while the two are apart.
    const apart = isDown(b) && b.state !== 'remounting';
    if (!apart || bike.picture.status !== 'ready') {
      // A missing bike picture draws no bike rather than the mesh, which has a
      // rider built into it and would put a second one on the road.
      bikeCard.visible = false;
      return;
    }
    const bs = lerp(a.bikePos.s, b.bikePos.s, alpha);
    const bt = lerp(a.bikePos.t, b.bikePos.t, alpha);
    onRoad(track, bs, bt, 0, b.bikePos.branchId, bikeAt);
    draw(bikeCard, bikeMaterial, bike, bikeAt, false);
  };

  const glow = new THREE.Color();
  let lastGlow = -1;
  const highlight = (amount: number, hostile: boolean): void => {
    mesh.highlight(amount, hostile);
    const clamped = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    const key = clamped * (hostile ? -1 : 1);
    if (key === lastGlow) return;
    lastGlow = key;
    // An unlit card has no emissive, so the glow is the tint pushed toward
    // the same warm or cold-white the mesh uses, and past full brightness.
    glow.setHex(hostile ? 0xfff0e0 : 0xff7a2a);
    riderMaterial.color
      .copy(base)
      .lerp(glow, clamped * 0.6)
      .multiplyScalar(1 + clamped * 0.9);
  };

  return {
    group,
    position,
    update,
    highlight,
    dispose: () => {
      mesh.dispose();
      riderMaterial.dispose();
      bikeMaterial.dispose();
    },
  };
}
