# Phase 02 — The feel gate

An endless straight road, one bike, a chase camera. Not a features phase. The
question is whether riding is enjoyable before anything is at stake, and the
roadmap is explicit that I do not get to answer that one myself.

## Decisions taken before writing anything

### 1. How `accelCurve` gets rescaled to `timeToTopSpeed`

This is the interesting piece of arithmetic in the phase, and it follows
directly from the authority split Divyansh set: `topSpeed` owns the ceiling,
`timeToTopSpeed` owns the magnitude, and `accelCurve` carries shape only, with
no magnitude of its own. Doubling every entry in the curve must change the
character of the acceleration and *not* the time to top speed.

So the curve cannot be read as acceleration directly. It has to be scaled by
a constant the sim solves for at load.

Let `u = v / topSpeed`, and `f(u)` be the curve interpolated linearly between
its five control points. Under full throttle, acceleration is `K · f(u)` for
some constant `K`. The time from rest to `topSpeed` is then

```
T = integral(0..vmax) dv / (K·f(v/vmax))
  = (vmax / K) · integral(0..1) du / f(u)
```

so, writing `I` for that dimensionless integral,

```
K = vmax · I / T
```

`I` depends only on the curve's shape, so a bike's `K` is solved once at load
and the acceleration is exact by construction rather than tuned until it looks
about right. Doubling the curve halves `I` and doubles `K`, leaving `T`
untouched — which is precisely the property the authority split asks for.

Two consequences worth writing down:

- **`I` is computed with Simpson's rule at load**, over a few hundred slices.
  Arithmetic only, so it would be legal in `step()` anyway, but there is no
  reason to do it more than once per bike.
- **Every entry in `accelCurve` must be strictly positive**, and validation
  enforces it. If the curve reaches zero at the top, `1/f(u)` diverges and the
  bike never actually arrives at `topSpeed` — the honest physical answer, and
  a useless one for a criterion that says "reaches top speed in
  `timeToTopSpeed`, within 5%". Keeping the last control point small but
  positive means acceleration tails off hard near the ceiling, which feels
  right, and the speed clamps at `topSpeed` exactly.

### 2. Three bikes now, fifteen in Phase 8

`GAME_DESIGN.md` calls for fifteen bikes across three classes, but that is
Phase 8's shop. Phase 2's criterion is "for every bike in the data file", which
bites just as hard with three as with fifteen. Authoring one Street, one Sport
and one Super covers the full speed range the test needs and leaves the
remaining twelve to the phase that actually asks for them. Deferred, noted
below.

### 3. Input is sampled per tick, not per frame

The determinism criterion now includes replaying under a jittered wall clock.
That is only achievable if the simulation never sees a real timestamp — so
input is latched into an `InputFrame` and the loop hands the same frame to
`step()` for every fixed tick it runs in a given render frame. The renderer may
run at 144 Hz or 30; the simulation cannot tell.

## What happened

### Attempt 1 — a test that read a field off the wrong object

The time-to-top-speed test returned `NaN` for every bike, and the failure read
`expected NaN to be less than NaN`, which says nothing about where it came
from.

Instrumented the loop and printed the state every few hundred ticks. Speed was
fine — climbing smoothly and settling exactly on `topSpeedMs`. So the
simulation was right and the measurement was wrong: the helper was reading
`world.player.tick`, and `tick` lives on `WorldState`, not on the rider.
`undefined * (1/60)` is `NaN`.

Worth noting because `tsc` would have caught it instantly — `Rider` has no
`tick` — but Vitest does not typecheck, so a plain `vitest run` sailed past it.
The type error only surfaces in `npm run check`. The lesson is not "write
better tests", it is that running the test file alone is a weaker signal than
it feels like.

### Attempt 2 — a frame-rate assertion that was too precise to be true

`FixedStepDriver` fed 1440 frames at 144 Hz should produce exactly 600 ticks.
It produced 599.

Not a bug. Ten seconds of 144 Hz frames is 600 ticks in exact arithmetic, but
`1/144` is not representable in binary, so 1440 of them sum to a hair under ten
seconds and the last tick has genuinely not fallen due yet. The remainder stays
in the accumulator rather than being discarded, so this does not accumulate —
added a second test that runs ten minutes of 144 Hz frames and asserts the
total is within one tick of ideal, which is the property actually worth
holding.

The first assertion was wrong in an interesting way: it was asserting a
property of exact arithmetic against a system deliberately built out of
inexact arithmetic.

### Attempt 3 — the scenery pool recycled by the wrong number, twice

Two separate bugs in the same expression, found by the same test.

**First**: the recycle shift used `spacing * slotS.length`. For a pool with
instances on both sides of the road there are two instances per position, so
that is twice the distance the pattern actually repeats over. Objects shifted
too far and left gaps — visible as half the kerb line missing. Fixed by storing
the real cycle length, `perSide * spacing`, on the pool.

**Second**, and more interesting: with that fixed, an instance still sat
outside the visible window at some values of `s`. The recycle clamped into
`[s - behind, s + ahead]`, but a pool holds `ceil(span / spacing) + 1`
positions — the `+ 1` being a deliberate spare so nothing pops into existence
at the far edge. That makes the cycle *longer* than the visible span, so one
slot has nowhere legal to sit and oscillates back out of view every frame.

The fix is to treat it as what it is: a modulo. Normalise into the half-open
interval `[lo, lo + window)` rather than into the visible range. Every slot
then lands somewhere legal, and the spare sits just past the far edge doing its
job. Sitting the two constants next to each other and noticing `window > span`
is what made it obvious; the failing assertion only said "646 is not less than
637".

### Attempt 4 — three allocations a frame in the chase camera

No test caught this one; I caught it reading back what I had just written.
`ChaseCamera.update` built three `new THREE.Vector3()` per call to convert the
core frame's vectors into Three.js ones. That is 180 allocations a second at 60
fps, in the one function guaranteed to run every single frame, in a file whose
whole job is the thing CLAUDE.md's performance rule exists to protect.

Replaced with two reused scratch vectors. Worth recording precisely because
nothing failed — the game would have run, the garbage collector would have
absorbed it, and it would have shown up in Phase 10's soak test as an
unexplained sawtooth.

### Attempt 5 — two more pieces of speculative code, caught the same way as last phase

The coverage gate flagged `world.ts` at 93%. The uncovered line was
`neutralInput()`, which nothing calls. Same category as Phase 1's `lengthOf()`
— written because it looked like something the module ought to offer.

Then, checking for others of the same kind, `revsPerGear` in `tuning.json` was
being validated and loaded and never read: the tachometer derives its gear from
`gearCount` alone. A tuning constant that does nothing is worse than an unused
function, because someone will eventually change it to fix a feel problem and
conclude the value does not matter.

Both deleted. Third phase running, third time a strict gate has found dead code
rather than a bug — which is a better argument for the 100% threshold than the
threshold itself.

## Measurements

- **Sim step: 0.21 µs/tick** (300,000 ticks on the test track, after JIT warmup).
  The budget is 1 ms. That is roughly 4,700x of headroom, and even under 4x CPU
  throttling it is about 0.8 µs.
- **World copy: well under 0.01 ms**, and it happens once per tick.
- **Scenery: 440 instances** — 30 masts, 30 lamp heads, 262 kerb stones, 118
  bollards, across four instanced draws. Above the 400 the criterion asks for.
- **Bundle: 128.7 KB gzipped**, 25.7% of the 500 KB budget. Up from 117 KB in
  Phase 1; the road mesh, scenery and HUD cost about 12 KB between them.
- **Determinism**: 3,600 ticks of twitchy recorded input replay bit-identically,
  and produce the same fingerprint again when driven through the real
  accumulator on a wall clock jittered between 240 Hz and 12 Hz.
- **Time to top speed**, against what `bikes.json` promises:
  Gully 19.5 s, Nagin 15.0 s, Shaitan 11.0 s — all inside 5%.

## Surprises

- **The render layer is far more testable than expected.** Three.js builds
  geometry and scene graphs on the CPU and only needs a WebGL context to draw,
  so chunk coverage, culling, pooling and the track-space-to-world conversion
  are all provable headlessly. Thirteen render tests run with no browser. What
  remains untestable is exactly what a human has to judge anyway.
- **The accelCurve rescaling is exact, not fitted.** Solving
  `K = vmax·I/T` means every bike hits its stated time to top speed by
  construction. I had assumed this would need a tuning pass and it needed none.
- **Vitest not typechecking is a real gap.** Attempt 1 was a type error that a
  targeted `vitest run` cannot see. Running the single relevant test file is
  the fast loop, and it is strictly weaker than `npm run check`.

## Deferred

- **Twelve more bikes.** `GAME_DESIGN.md` calls for fifteen; three cover the
  speed range the acceptance criterion needs. Phase 8 owns the shop.
- **Nitro.** The `Shaitan` carries three charges and nothing reads them.
- **Engine audio.** The tachometer derives a fake gearbox from speed precisely
  so an engine note can hang off it later. Phase 10.
- **The gearbox is a lie and should stay one.** There is no gearbox in the
  simulation — the arcade model has one continuous speed. If the fake gears
  ever stop matching what the ear expects, the fix is in the HUD, not the sim.
- **Grip scrub is untested against a real corner at speed**, because Phase 2's
  road is deliberately straight. The unit tests cover it on synthetic curves;
  Phase 3 is where it gets ridden.

---

## After the feel gate — Divyansh rode it

### The bug: steering right moved the bike left

Reported from the seat, not from a test: "press right key is making the rider
lean right but going left". The lean looked correct, the travel did not.

**Cause: a handedness error mapping track space to world space.** The frame
used `forward = +Z` with `right = up x forward = +X`. In a right-handed Y-up
system, facing +Z your right hand points to **-X**. And Three.js cameras look
down their own local -Z with local +X on the right of the screen, so world +X
was landing on the viewer's left. Positive `t` moved the rider toward +X —
correct in the simulation, mirrored on the screen. The lean read correctly
because it is applied about the bike model's own local axis, which was itself
mirrored, so the two errors cancelled for the roll and not for the travel.

Verified rather than assumed before touching anything: computed the camera's
screen-right vector from the Three.js `lookAt` construction and compared it
against both `up x forward` and `forward x up`. `up x forward` was mirrored in
both possible forward conventions.

**Fix:** adopt `forward = -Z`, which is Three.js's native forward, making
`right = forward x up = +X`. In `geometry.ts` the straight case advances along
`-cos(theta)` in Z, the arc's Z displacement flips sign so the centre still
sits one radius along `right`, and `headingOf` becomes `atan2(x, -z)`. In
`path.ts` the two cross products swap order.

Nothing in the simulation changed. `s`, `t` and curvature never referenced a
world axis, and the `(1 - t*k)` derivation only assumed positive `t` is the
inside of a positive-curvature bend — still true. Five tests failed and all
five were assertions about the old convention, not about behaviour.

### Why no test caught it

This is the part worth keeping. Thirteen render tests passed against a
mirrored world, because **every one of them asserted world coordinates against
a convention this codebase had itself chosen.** They were self-consistent. Not
one of them connected track space to what the camera actually displays, so a
mirror image satisfied all of them equally well.

Added five tests that do close that loop: project a rider at positive `t` into
camera space through the real `ChaseCamera` and assert the sign of its x. That
is the question "which way did it appear to go", asked in code. Also asserts a
right-hand bend curves toward the right of the frame, and that the rider is in
front of the camera rather than behind it.

The general lesson: a test that checks a system against its own convention
proves consistency, not correctness. Somewhere there has to be one test that
crosses the boundary to the thing a person actually perceives.

### A flaky test replaced while in there

`allocates nothing while recycling` measured `heapUsed` before and after 3,000
recycles. Adding the handedness tests pushed it to 6.3 MB against a 4 MB bound
— and it passed when run alone. It was measuring the shared process heap, so
its result depended on which other tests had run first.

Replaced with identity checks: the same `InstancedMesh` objects, the same
instance counts, and the same backing `instanceMatrix` buffers before and
after. Recycling that allocated would have to produce new ones. Deterministic,
and it tests the actual claim rather than a side effect of it.

### Measurements from the seat

Divyansh's readout, riding the Nagin on the straight:

```
speed 151.4 km/h    60.0 fps   16.66 ms mean   16.90 p95   17.20 worst
sim 0.006 ms/tick   ticks/frame 1   dropped 11
draw 16 calls       chunks 3        scenery 440
```

Sim step 0.006 ms against a 1 ms budget — 166x of headroom in a real browser,
against 0.21 microseconds measured in Node. 16 draw calls for 440 scenery
objects plus three road chunks, which is instancing doing its job. Frame time
pinned to vsync at 16.66 ms; the "63 over 16.6" counter is vsync jitter a
hair over the threshold rather than dropped frames.

Still outstanding: whether that reading was taken under 4x CPU throttling, and
the subjective verdict itself.

### The handedness fix did not resolve it — open defect

Divyansh reported the same symptom after the fix: right leans right, drifts
left. Reported twice, so not a misread.

What I know:

- The source on disk carries the fix (`geometry.ts` advances `-cos(theta)` in
  Z, `headingOf` is `atan2(x, -z)`, `path.ts` crosses `forward x up`).
- An end-to-end test drives the real key binding, the real `step()`, the real
  `RiderView` and the real `ChaseCamera`, then projects the rider into camera
  space. Pressing right gives `t > 0`, `lean > 0`, and camera-space `x > 0`.
  Pressing left mirrors it. Five assertions, all green.

So either the browser is running code older than the fix, or the discrepancy
lives in a link the test does not cover — `Stage.sync` or the interpolation in
`main.ts` — or in perception rather than geometry.

That last one is worth taking seriously and I had not considered it properly.
**The chase camera tracks the rider laterally**, with a lag constant of about
0.3 s. Hold a direction for a second and the camera has almost caught up, so
the bike sits near the middle of the frame and it is the *road* that slides.
A rider who is barely displaced on screen while the world slides underneath
could easily read as drifting the wrong way — the honest cue for direction is
mostly the scenery, not the bike's offset. If that is what is happening, the
geometry is right and the camera tuning is wrong, which is a feel problem
rather than a handedness one, and belongs to this phase either way.

Rather than ask for another round of manual testing, added a diagnostic line
to the dev overlay:

```
steer  t says RIGHT   screen says RIGHT   — agree
```

It prints which side the simulation thinks the rider is on, which side the
picture actually puts them on, and whether those agree. `MISMATCH` means the
handedness is still inverted somewhere; `agree` means the geometry is correct
and what is wrong is the camera's lateral tracking, i.e. tuning. That splits
the problem in one glance instead of one exchange.

Deferred at Divyansh's request, with the diagnostic in place to resolve it
cheaply next time the overlay is open. Recording plainly that this is a defect
and not intended behaviour: a racer where right goes left is broken, and
Phase 3 onward would author every track against a mirrored world.

### Resolved — it was a stale browser the whole time

Divyansh reran it and steering is correct in both directions. The handedness
fix was right; the two reports after it were a page still holding the module
graph from before the change.

Correcting the section above rather than deleting it, because the wrong
reasoning is the useful part. On the second report I started constructing an
explanation for why the code might be correct *and* the symptom real — the
chase-camera lateral tracking theory. It was plausible, it was specific, and
it was wrong. The evidence at the time already pointed the other way: the
source on disk had the fix, and an end-to-end test through the real binding,
the real `step()`, the real `RiderView` and the real `ChaseCamera` was green.
When the code says one thing and the screen says another, "the screen is
showing old code" deserves to be eliminated before a new theory gets built.
The cost of that hypothesis was a round trip and a diagnostic written to
answer a question that was already answered.

I killed the dev server with `pkill` during the previous session, so the tab
had no chance of picking the change up. That is on me, and "hard-reload after
a server restart" should have been the first thing said rather than the third.

The diagnostic stays. It cost little and it now reads `— agree` on every
frame, so a future handedness inversion announces itself on screen instead of
being argued about. Along with the end-to-end steering test, the class of bug
is now covered from both sides — one guard that fails in CI, one that is
visible while riding.

### A second flaky heap test, and the pattern behind both

`allocates nothing per tick` in `perf.test.ts` failed at 6.6 MB against a 4 MB
bound during the very next full run — and passed on its own. Identical failure
mode to the scenery pool test earlier in the phase: `process.memoryUsage()`
measures the whole process, so the result depends on which tests ran first and
when the collector happened to run.

Two of these in one phase is a pattern rather than bad luck. **Measuring the
heap to prove "this allocates nothing" is the wrong instrument.** It measures a
consequence, through a noisy shared channel, and its threshold is a guess.

Replaced with two deterministic checks that test the actual claim:

- *Runtime*: `step()` mutates in place, so after 100,000 ticks the world holds
  the same rider object, the same position object, the same bike reference,
  and the same set of fields. Anything that allocated a replacement would fail.
- *Source*: the hot files are scanned for `new`, `.map(`, `.filter(`,
  `.slice(`, `Array.from`, `JSON.` and friends, next to the existing rules that
  lint cannot see. Crude, but it fails on the commit that introduces the
  problem rather than on whichever unlucky run notices it later.

Ran the full suite three times to confirm the flakiness is gone: 220 passing
each time.

## The feel gate

Divyansh rode it and cleared it. Recording plainly what that does and does not
mean: the gate is subjective by design and belongs to him, so this is the
verdict rather than a measurement. No tuning pass was needed — the constants
in `tuning.json` are the ones written before anything was ridden, which is
either good instinct or a straight line being an easy thing to make feel fine.
Phase 3 puts real corners under it and is the first honest test of the lateral
model.

**Carried forward, unmeasured:** the 60 fps reading under 4x CPU throttling.
Raised twice; the reading taken was 60.0 fps at a 16.66 ms mean, which is
vsync-locked and so almost certainly unthrottled. Not blocking Phase 3 at
Divyansh's direction, but the number is unknown rather than good, and Phase 3
adds far denser scenery — so it should be taken there rather than assumed.
