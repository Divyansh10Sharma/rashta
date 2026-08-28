# Architecture

## 1. Track space

Every entity in the world — the player, rival riders, traffic, police,
pedestrians, obstacles, pickups — stores its position as two numbers:

- `s` — metres travelled along the track centreline from the start line.
- `t` — metres perpendicular to the centreline. Negative is left, positive is
  right, zero is the centreline.

Nothing in `src/core/` ever stores a world-space position. World space is
derived, at render time only, by sampling the track spline:

```
const frame = track.sample(entity.s);          // position, tangent, normal, up
const world = frame.position
  .clone()
  .addScaledVector(frame.right, entity.t);
```

This is the single most important decision in the project and everything else
follows from it.

**What it buys:**

| Problem | In world space | In track space |
|---|---|---|
| Who is ahead? | project onto racing line, handle curves | `a.s > b.s` |
| Am I in punching range? | sphere overlap query | `abs(ds) < 2 && abs(dt) < 1.5` |
| Did I leave the road? | raycast or collider | `abs(t) > track.widthAt(s)` |
| Spawn traffic ahead | frustum maths, culling | insert at `player.s + 300` |
| Race positions | sort by projected progress | sort by `s` |
| AI overtaking | steering behaviours, pathfinding | pick a target `t`, lerp toward it |
| Rewind / replay | store transforms | store two floats per entity |

**What it costs:** the track cannot fold back over itself, cross itself, or
branch arbitrarily. Forks are handled explicitly (§1.2) rather than emerging
from geometry. Free-roam is impossible. For this game that is not a loss.

### 1.1 The track spline

A track is an ordered list of segments. Each segment is a constant-curvature
arc with linear elevation and banking:

```ts
interface TrackSegment {
  length: number;        // metres
  curvature: number;     // 1/radius; 0 = straight, positive = right turn
  gradient: number;      // metres risen per metre travelled
  bank: number;          // radians of camber
  halfWidth: number;     // drivable half-width in metres
  shoulder: number;      // extra metres of survivable-but-slow surface
  lanes: number;
  oneWay: boolean;
  scenery: SceneryTag;   // 'ridge' | 'ringroad' | 'yamuna' | 'oldcity' | ...
  hazards: HazardSpec[];
}
```

Sampling walks the segment list and integrates. Because segments have constant
curvature, the integration is closed-form, not numerical — the frame at any
`s` is computed directly from the accumulated heading. Cache the accumulated
start state of each segment on load so `sample()` is a binary search plus
arithmetic, not a walk from zero.

`sample(s)` returns a `TrackFrame`: `{ position, forward, right, up, halfWidth,
lanes }`.

### 1.2 Forks

A fork is a segment with a `branch` pointing at a second segment list. Both
branches carry a `rejoinS` — the `s` value on the main path they merge back
into, and a `lengthDelta` so the two routes can differ in distance. An entity
carries a `branchId` alongside `s` and `t`. Two entities on different branches
cannot collide or fight, which is exactly right.

### 1.3 Track authoring

Tracks are JSON in `src/data/tracks/`. Tiers extend rather than replace: tier 2
of a track is tier 1's segment list plus more segments appended. Do not
duplicate the segments across files — the JSON references the previous tier.

## 2. The loop

```
accumulator += realElapsed
while (accumulator >= FIXED_DT) {
  previousState = copyOf(currentState)
  step(currentState, sampledInput, FIXED_DT)   // exactly 1/60 s
  accumulator -= FIXED_DT
}
render(previousState, currentState, accumulator / FIXED_DT)
```

`FIXED_DT` is `1 / 60`. Cap the accumulator loop at ~5 iterations so a stalled
tab doesn't produce a death spiral; drop the excess time instead.

Rendering interpolates `s`, `t`, lean angle, and wheel rotation between the two
most recent states using the alpha. Without this, a 144 Hz monitor shows
60 Hz stutter.

## 3. Simulation model

The bike is **not** rigid-body simulated. It is an arcade model driven by a
small number of scalars:

- `speed` — m/s along the track. Integrated from throttle, brake, drag, the
  bike's power curve, and a grip penalty when cornering hard.
- `lateral` — velocity in `t`. Lean input sets a target lateral velocity,
  scaled down as speed rises so the bike feels heavier fast.
- `lean` — cosmetic angle for rendering, derived from `lateral` and curvature.
- `stamina` — combat health, 0–100.
- `state` — `riding | attacking | staggered | crashing | remounting`.

A well-tuned arcade model beats a physics simulation here on both feel and
effort. Naming the trade explicitly: you give up emergent behaviour like real
weight transfer, wheelies, and stoppies. Road Rash never had those either.

Tuning constants live in `src/data/tuning.json` and are hot-reloadable in dev.

## 4. Systems

Core is organised as plain functions over a `WorldState`, not as an entity
component system. There are at most a few hundred entities and they are all
homogeneous — an ECS would be ceremony without payoff.

```ts
function step(w: WorldState, input: InputFrame, dt: number): void {
  stepPlayer(w, input, dt);
  stepAI(w, dt);
  stepTraffic(w, dt);
  stepCombat(w, dt);
  stepPolice(w, dt);
  stepRace(w, dt);
}
```

Order matters and is fixed. Each `step*` reads the whole state and mutates only
its own slice. Collisions are resolved once, at the end, in `stepRace`.

## 5. Rendering

`src/render/` owns all Three.js. It reads `WorldState` and never writes to it.

- **Road mesh** is built once per track load with `BufferGeometry`, walking the
  segment list and emitting a quad strip. Split into chunks of ~200 m so
  chunks outside the view can be skipped.
- **Riders** are low-poly meshes; rivals share one geometry with per-instance
  colour. Use `InstancedMesh` for traffic and scenery.
- **Scenery** is spawned from a per-segment density table into a pool, recycled
  as `s` advances. Never allocate during the loop.
- **Sense of speed** is the responsibility of `ChaseCamera` and
  `SpeedEffects`: FOV widening, camera drop and pull-back, lateral lag, road
  texture, roadside object density, wind and engine audio. See Phase 2.

## 6. Determinism and the RNG

`src/core/rng.ts` exports a seeded PRNG (mulberry32 or xoshiro128). The world
carries its RNG state so a saved game resumes identically. `Math.random()` is
banned everywhere else and the lint config enforces it.

This matters for more than tidiness: it makes race outcomes reproducible from
a seed, which makes AI and balance bugs debuggable instead of anecdotal.

## 7. Save format

A single JSON blob in `localStorage` (web) or an app-data file (Tauri), holding
career progress, money, owned bike, and the reputation graph. Versioned with a
`schemaVersion` field and a migration function per version bump. Never write a
save the loader can't identify.
