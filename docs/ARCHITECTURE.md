# Architecture

## 1. Track space

Every entity in the world — the player, rival riders, traffic, police,
pedestrians, obstacles, pickups — stores its position as two numbers:

- `s` — metres travelled along the track centreline from the start line.
- `t` — metres perpendicular to the centreline. Negative is left, positive is
  right, zero is the centreline.

Nothing in `src/core/` ever stores a world-space position. World space is
derived, at render time only, by sampling the track spline:

```ts
// Both `frame` and `out` are preallocated and reused. Nothing here allocates —
// this runs once per visible entity per frame. See §5.
track.sample(entity.s, frame);
out.copy(frame.position).addScaledVector(frame.right, entity.t);
```

This is the single most important decision in the project and everything else
follows from it.

**What it buys:**

| Problem | In world space | In track space |
|---|---|---|
| Who is ahead? | project onto racing line, handle curves | `a.s > b.s` |
| Am I in punching range? | sphere overlap query | `trackDistance(a, b) < 2` (§1.4) |
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

`sample(s, out)` fills a caller-owned `TrackFrame` — `{ position, forward,
right, up, halfWidth, lanes }` — and returns it. It never allocates: it is
called once per visible entity per frame, and a fresh object plus four vectors
per call is the single easiest way to blow the frame budget (§5).

The closed-form integration uses trigonometry, so it runs **at load time
only**, filling a per-segment table of accumulated start frames. `sample()`
itself is a binary search plus linear interpolation between table entries —
no `sin` or `cos` at runtime. This is what lets the simulation keep the
bit-exactness guarantee in `CLAUDE.md` rule 4.

### 1.2 Forks

A fork is a segment with a `branch` pointing at a second segment list. Both
branches carry a `rejoinS` — the `s` value on the main path they merge back
into, and a `lengthDelta` so the two routes can differ in distance. An entity
carries a `branchId` alongside `s` and `t`. Two entities on different branches
cannot collide or fight, which is exactly right.

**`s` is an odometer, not a race position.** The moment a fork exists these
stop being the same number: two riders on different branches have `s` values
measured along different curves, so `a.s > b.s` is meaningless between them.
Core therefore exports `progress(entity)`, mapping `(branchId, s)` to a single
monotone scalar that is comparable across branches and normalised so both
branches of a fork rejoin at equal progress. Sort race position by `progress`,
never by raw `s`. Keep the two distinct in the code — a `progress` that quietly
becomes an alias for `s` is a bug that shows up mid-fork, in one race, at one
moment, which is the worst possible time to find it.

### 1.3 Track authoring

Tracks are JSON in `src/data/tracks/`. Tiers extend rather than replace: tier 2
of a track is tier 1's segment list plus more segments appended. Do not
duplicate the segments across files — the JSON references the previous tier.

### 1.4 Distance in track space

Track space is not metric. A rectangle in `(s, t)` is a curved wedge in the
world, because arc length at lateral offset `t` is stretched or compressed by
curvature. On a right turn of curvature `k`, an arc of length `ds` at offset
`t` covers a real distance of `ds * (1 - t * k)` — the inside of the bend is
shorter than the centreline, the outside is longer.

Ignoring this is fine on a motorway and wrong in Old City. On a 20 m-radius
corner, two riders separated by `ds = 2, dt = 1` are 1.84 m apart at
`t ~ +4.5` and 2.64 m apart at `t ~ -4.5` — the same two numbers, a 43%
difference in real separation, decided entirely by where on the road they sit.
At `t ~ +/-1.5` the same swing is 12.8%. Derivation and figures are in
`docs/devlog/phase-01.md`.

So core exports:

```ts
/** Approximate metric separation between two entities, in metres. */
function trackDistance(a: TrackPos, b: TrackPos, track: Track): number;
```

implemented by scaling `ds` by `(1 - tMean * k)` and taking the hypotenuse
with `dt`. That approximation tracks the exact chord to within 0.08% across
the full width of the road, and — importantly — it uses no trigonometry, so it
is legal inside `step()` under rule 4.

Use `trackDistance` for every question that is really about metres: combat
range, the police arrest radius, and traffic occupancy. Keep using raw `s` and
`t` comparisons for the questions that are really about the road: who is
ahead, which lane, on the tarmac or off it.

The factor `(1 - t * k)` collapses to zero when `|t| >= 1/|k|` — a corner
tighter than the road is wide, where the inside edge has folded through the
centre of curvature. This is not a runtime guard but a data error, so track
validation rejects it at load: any segment with `curvature != 0` and
`halfWidth + shoulder >= 1 / abs(curvature)` throws, naming the file and
segment index.

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
  bike's `accelCurve` scaled to its `timeToTopSpeed`, and a grip penalty when
  cornering hard. Not from `power` — see the authority table under "Bikes" in
  `GAME_DESIGN.md` for which bike fields the sim is allowed to read.
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

The seeded RNG is necessary but not sufficient. Bit-exactness across machines
also requires that `step()` contains no transcendental function — no `sin`,
`cos`, `tan`, `atan2`, `pow`, `exp`, or `log`. IEEE-754 pins `+ - * /` and
`sqrt` to a single correctly-rounded result on every conforming engine, but
deliberately leaves the transcendentals to the implementation, so their last
bits differ between V8, JavaScriptCore, and SpiderMonkey, and sometimes
between CPU targets of the same engine. One `Math.cos` in the sim silently
reduces "the same on every machine" to "the same on this one".

Everything that genuinely needs trigonometry is therefore pushed to one of two
places where determinism does not matter: track precompute at load, and
rendering. Inside the sim, curvature and heading come from precomputed
per-segment tables read by linear interpolation. `trackDistance` (§1.4) is
built to respect this, which is why it approximates the chord instead of
computing it.

Two things guard this, since lint cannot: a replay test that runs a recorded
input sequence twice and asserts bit-identical final state, and a second run
of the same sequence under a deliberately jittered wall clock, asserting the
same result — which also catches `Date.now()` or `performance.now()` leaking
into the simulation.

## 7. Save format

A single JSON blob in `localStorage` (web) or an app-data file (Tauri), holding
career progress, money, owned bike, and the reputation graph. Versioned with a
`schemaVersion` field and a migration function per version bump. Never write a
save the loader can't identify.
