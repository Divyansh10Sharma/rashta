# Phase 04 — Traffic and hazards

The road stops being empty. Traffic that occupies lanes and changes them,
hazards sitting where the track data says they are, collisions resolved
through `trackDistance`, and a crash that ends with the rider getting back on.

This is the first phase where `trackDistance` is load-bearing rather than
tested. Every collision runs through it, and the roadmap's acceptance criterion
now says so explicitly: separation is measured with it, not with a raw `(s, t)`
box.

## Decisions taken before writing anything

### 1. Traffic density is a field on the track, not a tier lookup

The criterion says density is a per-tier data value and observably changes with
tier. There are two ways to do that: put a `tier` number on the track and look
the density up in a table, or put the density on the track itself.

Going with the density on the track. A tier lookup adds a second place the
answer lives, which is the exact shape of the bug the bike authority table
exists to prevent — and it stops a route ever being unusually busy for reasons
of character rather than difficulty. The Ring Road should be able to carry more
traffic than the Ridge at the same tier, because that is what those roads are.

So `trafficDensity` is a field in the track JSON, in vehicles per kilometre,
authored per route *and* per tier.

### 2. Traffic never overlaps, and the enforcement is a following model

The criterion could be satisfied by rejecting overlapping spawns and hoping.
That would fail the first time two vehicles with different speed profiles ended
up in the same lane.

So there are three mechanisms, and they compose:

- **Spawn rejection.** A vehicle only enters a lane with a clear gap.
- **Lane-change rejection.** A vehicle only moves into a lane with a clear gap.
- **Car following.** A vehicle that catches the one ahead in its lane matches
  its speed rather than driving through it.

The third is what makes the guarantee hold rather than be likely. It also
produces the thing that makes traffic read as traffic: vehicles bunching behind
a slow bus, which is a queue rather than a spawn pattern.

### 3. Crashes are a state machine with a fixed cost, not a physics event

`ARCHITECTURE.md` §3 already lists `crashing` and `remounting` as rider states.
The rider is thrown, the bike slides to a stop, and remounting takes a fixed
number of ticks. No ragdoll, no simulated tumble — the cost of a crash is
*time*, and time is the thing the race is measured in.

Two consequences worth stating. A crash must be escapable from every cause, or
a rider can be stuck forever, which is why the acceptance criterion says
"round-trips reliably from every crash cause" and there is a test per cause.
And crash duration lives in `tuning.json`, because how punishing a crash feels
is a tuning question and will be argued about after someone rides it.

### 4. The cliff edge is a property of the road, not a new hazard type

The DND Flyway has no barrier on one side — leaving the road there ends your
race. Every other route has a shoulder you can survive.

Rather than add a hazard for it, this falls out of data that already exists:
`shoulder` is how much survivable ground there is past the road edge. The
flyway's is 0.6 m against the Ring Road's 2 m. So "rider-vs-cliff" is: you left
the road, and there was not enough shoulder to catch you. One rule, no new
field, and it scales with the road rather than with a list of special cases.

## What happened

### The lane-count change that put NPCs head-on

The route-selection work in Phase 3 assumed lane count was fixed. It is not:
Old City drops from two lanes to one at every alley. A same-direction vehicle
whose lane index was clamped into the surviving lane landed in the *oncoming*
half, where car-following deliberately ignores it — two NPCs closing head-on at
combined speed with nothing watching.

Fixed by recycling any vehicle whose lane has either vanished or changed
direction under it. A vehicle vanishing behind you is invisible; a head-on
between two NPCs is not.

### The fatal-edge rule was derived from the wrong field

Decision 4 above said "rider-vs-cliff" falls out of `shoulder`, the survivable
margin past the road edge — no new field, scales with the road. That was wrong,
and the data says so plainly:

```
ridge-run     road 1.5      branches 0.8, 1.0
yamuna-bank   road 3.0      branches 1.5, 2.0
ring-road     road 2.0      branches 1.0
old-city      road 0.3-0.4  branches 0.2
dnd-flyway    road 0.6      branches 0.4-0.5
```

The Old City's shoulders are *narrower* than the flyway's, so any width
threshold makes the wrong route lethal. The Old City is lined with walls you
scrape along; the flyway is elevated with nothing beside it. That is a fact
about the place, not about the margin — so it reads from the scenery tag,
which is the field that records which place you are in.

Worth keeping because the reasoning that produced the wrong answer was
appealing: reuse existing data, no special cases, scales automatically. It was
just describing a different quantity than the one that matters.

### Crashing into the same thing forever

The rideability test hung. A rider who went off the edge finished remounting
still against the edge, went off again, and repeated until the tick cap.
Same shape for hazards: remount on top of the pothole that got you.

Two fixes, both needed: a short immunity after remounting, and the rider being
put back toward the middle of the road rather than where they left it. Which
is what actually happens — you push the bike back on before getting on it.

### Traffic non-overlap: four attempts, and the one that was measuring wrong

The acceptance criterion says no two vehicles are ever closer than their
combined footprint, measured with `trackDistance`. Getting there took four
goes, and the first failure was mine, not the code's.

**Attempt 1 — the test was wrong.** Reported a 7.5 m overlap. It was comparing
along-track gap against combined *lengths* and ignoring width entirely, so two
buses abreast in different lanes counted as overlapping. A footprint is two
dimensional.

**Attempt 2 — the positional clamp.** Car following sets a *speed*, and a speed
cannot undo a gap that is already too small, because deceleration is
rate-limited. So the follower was clamped back out of its leader. That helped
(−2.2 m to −0.83 m) and was the wrong idea: pushing A backward shoves it into
whatever is behind A, which nothing was checking. The overlap moved down the
queue rather than going away. Replaced with a velocity cap — the gap *cannot*
close past the minimum — which has no such side effect, because nothing is ever
moved, only slowed.

**Attempt 3 — lane-exclusive ordering.** Rewrote the gap test as a pure
along-track question inside one lane. Correct in principle, and it made things
worse (−1.48 m) *and* took one test from seconds to **684 seconds**, because
respawn now retried an O(n) placement test six times per inactive vehicle per
tick. Reverted.

**Attempt 4 — `trackDistance` outside its range.** The debug output showed a
pair "4.30 m apart" whose `s` values differed by 273 m. The Maclaurin series in
`trackDistance` is documented as a near-field measure and clamps to zero past
its valid sweep — so a distant pair on a tight road reported as touching. Now
it saturates to `2R + |dt|`, an upper bound on any chord, because the only
property a collision check needs is that far things never read as close.

### Attempt 5 — and the diagnosis that was wrong

At this point the worst case was about **-0.79 m** on `ring-road-t5`, down from
around -7.5 m. I wrote down what I believed the cause was: the lateral
crossing, `lane` committing instantly while `t` drifts across over a couple of
seconds, so a vehicle mid-change occupies both lanes. The fix that followed
from it was to keep the simulation's `t` exactly on a lane centre and let the
renderer smooth the crossing.

Before writing that, I dumped the worst pair every seven ticks with every
number that went into it. It was not the crossing, and it was not one cause.

```
ring-road-t5
  clear=-0.79 auto/bus lat=1.21 needWide=2.00 lanes=2/2 t=2.75/3.96
                                              nlanes=4 hw=11.00
old-city-t5
  clear=-0.60 bus/bus   lat=2.00 needWide=2.60 lanes=1/0 t=2.00/0.00
                        onc=0/1                nlanes=2 hw=4.00
```

Both pairs are doing something no lane-change decision explains.

**The Ring Road pair is in the same lane already** — `lanes=2/2` — and 3 m
apart laterally. Lane 2 of a four-lane 11 m road is centred at 2.75; the bus
is at 3.96 and sliding down. Nobody decided to change lane. `halfWidth` and
`lanes` are step functions of `s`: the Ring Road goes from three lanes across
10 m to four across 11 m at a segment boundary, so lane 2's centre jumps from
6.67 to 2.75 and every vehicle in it is dragged 3.9 m sideways. The road moved,
not the vehicle. No gap was checked because no decision was taken.

And `leaderFor` did not order the pair, because it asked only whether the two
overlapped laterally *now*. Mid-slide they did not, so the bus was never
constrained against the auto it was sliding into.

**The Old City pair is head-on.** A two-way road that narrows to one lane has
its single lane centred on the divider, and `respawn` placed an oncoming bus
at exactly `t = 0` — half of it in the other direction's half from the moment
it appeared. Nothing was going to fix that afterwards.

Three changes, and each one closes a hole the others do not:

1. **`leaderFor` orders by lane index *or* lateral overlap.** Attempt 3 tried
   replacing lateral overlap with lane index and made things worse; the union
   is strictly more constraining than either, and it is what actually
   describes a vehicle part-way through a crossing — it is genuinely in two
   lanes, so it is ordered against both.
2. **Lateral movement is movement, so it only happens into free space.** The
   drift toward a lane centre now passes the same `hasRoom` test a spawn does.
   Blocked, a vehicle holds its line until the road beside it clears. If
   holding leaves it hanging off the road it is recycled, which is invisible.
3. **On a two-way road the centreline is a wall.** A vehicle's whole footprint
   stays on its own side, at spawn as well as while driving. Two vehicles
   going opposite ways are then at least their combined width apart *by
   construction* — which is the acceptance criterion itself, not a margin
   tuned until it passed.

Worst-case clearance, from -7.53 m at the start of the phase:

```
ring-road-t5   +0.61 m
old-city-t5    +1.40 m
yamuna-bank-t3 +1.23 m
```

The Ring Road's +0.61 is the interesting one: it is `ABREAST_MARGIN`, almost
exactly. That pair is a bus held mid-slide against an auto it cannot get past,
stopped at the width where the two start minding each other. The margin is
what the number is made of, which is the sign that the mechanism is doing the
work rather than the luck.

Worth keeping: the fix I was about to write was aimed at a cause that was not
producing the failure. It would have been a real change, it would probably have
moved the number, and it would have left both actual bugs in — the geometry
drag and the head-on spawn — for something later to trip over. Four attempts of
tuning had got to -0.79 m; fifteen minutes of printing the numbers got to +0.61
and explained every one of them.

### Two tests that were measuring the machine

`builds any single track in well under 200 ms` failed in the full run and
passed on its own, three times. It was timing a build under a parallel test
run and reading scheduler contention as build cost — the same shape as the
three flaky heap-delta tests in Phases 2 and 3. Both timing budgets now take
the fastest of three runs: contention can only inflate a reading, never deflate
one below the true cost, so the minimum is the least contaminated sample and a
genuinely slow build still fails every run.

The two ten-minute-ride tests were at 4.85 s against Vitest's 5 s default. Ten
simulated minutes is the acceptance criterion, so the timeout moved rather than
the ride.

### Coverage found two untested error paths and one dead getter

`src/core/track/**` is held at 100% lines, and it caught that both
`trafficDensity` validators — the one in `library.ts` that runs during
`extends` resolution and the one in `validate.ts` that runs on an assembled
track — had no test. Also `TrackLibrary.ids`, which nothing has ever called.
Deleted rather than tested: it is an API invented for a caller that does not
exist.

### Drawing it: two new render modules

`HazardView` and `TrafficView`. They divide on one fact: hazards never move.
So hazards are not a pool — every matrix is written once at build time and
never touched again, one instanced draw per kind, and Three.js frustum-culls
what is behind you. Traffic needs the full pool treatment: one `InstancedMesh`
per kind sized to the *whole* pool, because any slot can be recycled into any
kind.

Two things fell out of writing it that I had not planned.

Livery colour is per *slot*, not per tick. The obvious implementation picks a
colour from the kind's palette when the vehicle is drawn, and the result is a
bus that changes colour the moment the pool recycles it. Assigning at build
time by slot index fixes it and costs nothing.

Headlights and tail lights are separate instanced pools rather than paint. At
night, whether a pair of lights is coming at you or going away from you is the
single most useful thing on the road, and it is the one piece of information a
box in sodium light does not carry. The lamps sit at the end of the vehicle
facing the rider, offset along `frame.forward` by `length * 0.46`, so one lamp
mesh serves all four kinds.

Interpolation needed a guard I did not anticipate. `update()` reads the same
pool at two ticks, index `i` being the same slot in both — which is exactly
what makes a recycled slot dangerous: a vehicle that respawned this tick is
100 m behind in one state and 900 m ahead in the other, and interpolating that
fires a car across the whole visible road in one frame. A slot is only drawn
when both states agree it is active, on the same branch, and within 5 m.

### The tolerance that was measuring the storage

Two of the nine new render tests failed on first run, both by about 2e-6 m
against a 1e-6 bound. Not a geometry bug: `InstancedMesh` keeps its matrices
in a `Float32Array`, so a point a kilometre down the road is only good to
roughly a tenth of a millimetre. The bound was tighter than the storage can
represent, so it was testing float32, not the renderer. Tolerances are now
millimetres, which is still three orders of magnitude below anything visible
and still catches a real mistake — a lane is three metres wide.

### A third timing test that was measuring the machine

`keeps every pair apart by their combined footprint` timed out at Vitest's 5 s
default, but only in `npm run check`, never on its own. `check` runs the tests
under v8 coverage instrumentation; the test rides three tier-5 routes for 90
simulated seconds each and checks every pair. It is slow by construction and
slower again when instrumented. Same call as the two ten-minute rides: the
ride is the acceptance criterion, so the timeout moved.

### Still not measured

Frame rate under 4× CPU throttling. This has been open since Phase 2 and it
needs someone with DevTools in front of the running game — a headless proxy is
not the criterion and would not be honest to write down as one. Phase 4 has
just added the two heaviest draw paths in the game so far, which makes this
the phase where the number stops being a formality.

## Deferred

- Traffic and hazards have no audio. Phase 6.
- Hazards are static boxes; a cow that moves is a Phase 7 problem at the
  earliest and possibly never.
- Tier-5 races still run 6.4–11.6 minutes flat out. Raised in Phase 3 with
  numbers, unchanged here, and it starts to bite in Phase 5 where every route
  is simulated to completion.

---

# Phase 04, reopened

Phase 8 was paused mid-flight. The crash specification in `ROADMAP.md`
§Phase 4 and `ARCHITECTURE.md` §3.1 was rewritten after this phase closed, and
Phase 4 no longer passes against it: the acceptance criteria now demand a
derived crash cost, and what was built has a configured one. Phase 8's crash
visuals animate whatever state machine exists, so building them on the old one
means writing them twice. Same phase, reopened — hence the same file.

What the rewrite changes, precisely. Decision 3 above says "a state machine
with a **fixed** cost, not a physics event", and was right against the spec as
it stood. The spec now says the opposite and says why: a constant
`crashSeconds` makes a 90 km/h tip-over cost exactly what a 250 km/h highside
costs, which turns the worst moment in the game into a pause. The cost has to
fall out of the physics. Decision 3 is superseded, not wrong when taken.

## Blast radius, surveyed before writing anything

### What survives in `collide.ts`

Everything that decides *whether* you crash. None of it knows what a crash
costs, so none of it moves:

- `checkTraffic`, `checkHazards`, `checkOffRoad` — all three call `crash()`
  and are otherwise untouched.
- `trackDistance` everywhere instead of an `(s, t)` box, and the comment
  explaining why a rectangle in track space is a curved wedge in the world.
- `FATAL_EDGE` as a scenery-tag set, and the note recording that deriving it
  from `shoulder` was wrong. That is a corrected dead end and it stays visible.
- `CRASHING_HAZARDS` / `SLIP_HAZARDS`, `HAZARD_REACH`, `RIDER_HALF_*`.
- The swept-`lastS` hazard test — hazards hit once on the edge of being driven
  over, not every tick while near. Phase 5 bug, still fixed.
- The two behaviours the user has explicitly protected: the `graceTimer` guard
  at the top of `crash()`, and the remount recentre in `step.ts:231-236`. Both
  fixed real bugs, both are named as keepers in ROADMAP and ARCHITECTURE.

`crash()` itself survives in shape — same signature, same early-outs, same
attack cancellation — and changes only in what it sets up: a severity band and
launch velocities instead of `stateTimer = tuning.crashSeconds`.

### What gets replaced

- **`stepCrash()`, entirely.** It is two states and a countdown. The spec
  wants seven: `airborne → sliding → downed → rising → running → remounting`,
  each with its own advance rule, plus `staggered`. The bike-slides-on branch
  becomes the bike's own integration, not the rider's.
- **`crashSeconds` as the cost.** Replaced by severity thresholds, friction
  coefficients, gravity and a run speed. The key goes from `tuning.json`;
  `crashDecel` survives in spirit as the bike's friction term.
- **`RiderState`.** Currently five values of which only three are ever
  assigned — nothing anywhere writes `'attacking'` or `'staggered'`; combat
  uses `rider.attack !== null` and `staggerTimer` instead. The spec's nine
  values make those two live, so the dead pair stops being dead.

### New simulation fields, and who has to be told

The rider gains `h` (height above the road along the track up vector — still
track space, rule 2 holds) and its velocity; the bike gains its own
`(s, t, branchId)` and speed, separate from the rider's. That is the contract
Phase 8 animates against.

Every one of these must be added to **`copyRider()` in `world.ts:54`**. The
render loop interpolates between two states and a field missed there is a
teleport, not a crash. `createRider()` at `world.ts:10` initialises them.

### What reads rider state in a way this breaks

Nothing reads `stateTimer` or `crashCause` for meaning outside the sim, which
is the good news. What exists is a wide, shallow set of `state !== 'riding'`
tests, and every one of them is asking "is this rider out of the fight right
now?" — a question the nine-state machine answers differently.

| Site | Reads | Breaks how |
|---|---|---|
| `step.ts:217` | `stepCrash` return | Rewritten with it. |
| `step.ts:268` | `state === 'riding'` gates collision checks | Fine as written, but `airborne` needs to skip traffic and hazards while `sliding` may not. |
| `race.ts:310` `resolveFor` | same gate, for all fourteen | Same, times fourteen. |
| `race.ts:297` `accrueDamage` | `state !== 'riding'` as the crash edge | **Wrong under nine states.** Charges `perCrash` on the transition into any non-riding state, so `staggered` from a punch would bill a crash. Needs the edge to be entry into `airborne` specifically. |
| `combat.ts:65,164,201,220` | `state !== 'riding'` to block attacking, weapon pickup, and being a target | Mostly right by accident. `staggered` becoming a real state means these start firing where they previously did not — the stagger lock currently lives in `canSteer`/`staggerTimer`, and the two must not both apply it. |
| `combat.ts:86` | `state === 'crashing'` skips as a target | Names a state that will not exist. Must become "down in any crash state". |
| `police.ts:216` `arrestedBy` | `state === 'riding'` → no arrest | **Semantics change.** You become arrestable the instant you are non-riding, which under the new machine includes mid-air. An officer should be arresting a rider who is `downed`/`rising`/`running`, not one still in the air. |
| `ai/racer.ts:248` | `state !== 'riding'` → no swing | Correct as-is; a rider in any crash state should not swing. |
| `main.ts:210` | `state !== 'riding'` as the spark edge | Same edge bug as `accrueDamage`: sparks on stagger. Phase 8 work, paused, and this is one reason it is paused. |
| `FieldView.ts` | interpolates `pos.s/t`, `lean`, `wheelAngle` | Does not know about `h` or a separate bike. A crashed rider currently just slides along the road at `h = 0`. Not broken, but not the crash either — this is exactly the Phase 8 surface that would have been written twice. |
| `Stage.ts:132`, `Rider.update` | `(track, s, t, lean, wheelAngle, branchId)` | Signature has no `h` and no second body. Phase 8 changes it; better it changes once. |

### Tests that will need rewriting rather than fixing

`tests/sim/collide.test.ts:162-228`, the four tests under "the crash sequence
itself", assert against the fixed-cost model directly — `downFor` bounded by
`crashSeconds + remountSeconds`, `stateTimer` unchanged by a second crash. The
round-trip tests at :111-160 and the hazard tests at :229-299 should survive on
their assertions, since they test that a crash happens and ends, not how long
it takes. `tests/police/*` calls `crash()` directly four times and reads state
straight after; those need the new post-crash state name.

The new criterion — time lost scales monotonically with impact speed, printed
at 80/140/200/260 km/h — has no test yet at all.


## What happened, second time round

### The shape it landed in

`collide.ts` was 180 lines and adding a nine-state machine to it would have
put it past 300, so the machine moved to its own file. `collide.ts` now
decides *whether* you crash; `crash.ts` owns what happens next. That split was
not planned, it fell out of the file-length rule, and it is better than what
was there — the detection code and the recovery code share nothing but a
function call.

`stepCrash` is a switch over six states with one helper each. The bike slides
in `slideBike`, called before the switch, because it keeps sliding through
`downed` and `rising` whether or not the rider is doing anything.

### The measured cost, which is the acceptance criterion

Time from impact to riding again, on a straight ring-road segment, sport bike,
no traffic:

| Impact | Band | Crashed into traffic | Knocked off in a fight |
|---|---|---|---|
| 80 km/h | tip-over | 3.78 s | 3.78 s |
| 140 km/h | thrown | 5.87 s | 4.78 s |
| 200 km/h | highside | 10.25 s | 6.47 s |
| 260 km/h | highside | 14.23 s | 8.02 s |

The floor is deliberately set near the 3.5 s the old fixed cost charged, so a
low-speed tip-over feels about as it always did and everything above it is new
information. The first tuning I tried put the floor at 2.96 s and the top at
18.4 s; both ends were wrong, and the second one is what the next section is
about.

Monotonic, and the sweep test checks every 10 km/h from 40 to 280 rather than
these four points — a model that is monotonic at four samples and not between
them is still wrong.

The two columns are the same speeds and different causes, which is the part
worth keeping: `crashLaunchCombat` is roughly half `crashLaunchTraffic`, so
being kicked off throws you less far than riding into a bus does, and the walk
back is correspondingly shorter. That fell out of the launch-per-cause rule
rather than being tuned in.

**14.2 s at 260 km/h is a long time** and I am flagging it rather than quietly
choosing it. It is defensible — the spec says the crash is the punishment and
the cost must be derived — but whether it is *fun* is a question that needs
somebody to ride it, exactly as decision 3 above predicted would happen. The
numbers to turn are `runSpeed` (5.5 m/s) and the two impact factors.

### The surprise: a highside throws you past your own bike

I wrote the test asserting the bike always ends up further down the road than
the rider, and it failed: rider 97.6 m, bike 79.8 m.

The reason is obvious in hindsight and I had not thought about it. A thrown
rider is in the air, and nothing decelerates them there — meanwhile the bike
has been grinding along tarmac since the tick of impact. So the launch that
makes a highside spectacular is also what carries the rider *past* the machine
they came off. About 10% of crashes on a real route end with the rider ahead
of the bike, walking backwards to it.

I kept the behaviour and fixed the assertion, because it is right: it makes
the run to the bike literally a walk back, which is the image the whole stage
is for. The test now asserts a gap exists rather than asserting its direction.

### Making `attacking` and `staggered` real cost more than it looked

Those two were in the `RiderState` union before this phase and nothing ever
assigned them — combat carried the same truth in `rider.attack` and
`rider.staggerTimer`. The spec wants nine live states, so they became real,
and that turned every `state !== 'riding'` in the codebase into a question
that needed re-asking one at a time.

The thing that made it tractable was refusing to assign `state` at the five
points that can change a timer. Instead `syncState` derives it once at the end
of the combat tick from the two flags, with stagger beating attacking — which
is what `canSteer` already said, so there is now one rule instead of two. Any
ordering bug I would otherwise have written is unreachable.

The call sites that were actually wrong, as opposed to merely renamed:

- `accrueDamage` charged bike damage on the edge of leaving `riding`. Under
  nine states a punch that staggers you leaves `riding` too, so every stagger
  would have billed a full crash's worth of damage. Now keyed to `isDown`.
- `arrestedBy` let an officer arrest anyone not riding, which now includes a
  rider mid-air. Narrowed to `downed | rising | running` — the stages where
  somebody is actually on the ground to be reached.
- `engagedWith` and the attack-resolution loop both named `'crashing'`, a
  state that no longer exists.

### The one that could have stranded a rider

`running` walks the rider toward the bike at `runSpeed`. If the bike were
still sliding faster than that, the rider would never arrive — and "no state
can strand a rider" is an acceptance criterion, not a nicety.

By the numbers it cannot happen: the bike stops well inside the `downed` and
`rising` pause at every speed the game can produce. But "by the numbers"
depends on four tuning values staying in a relationship nobody wrote down, so
entering `running` now stops the bike outright. It is a guarantee by
construction rather than by arithmetic, and it costs nothing because in every
reachable case the bike had already stopped.

### old-city-t5 was already broken, and the crash rewrite is what showed it

The rideability test failed on exactly one of twenty-five routes. The first
guess — that crashes now cost more — was wrong, and measuring said so:

|  | Crashes per rider | Down-time per crash | Race length |
|---|---|---|---|
| Before (bb1bec3) | ~195 | 3.54 s | 2407 s |
| After | ~262 | 3.05 s | over the 2700 s limit |

The new crash is **cheaper** per event. What moved was the *count*, up 34%,
and 87% of all crashes were rider-into-traffic. So the crash was not the
problem; it was the thing that pushed a route already at 89% of the test's
budget over the line.

What the route actually is:

| Route | Density | Road width | Vehicles per metre of width |
|---|---|---|---|
| old-city-t5 | 50.4 | 7.4 m | **6.81** |
| ring-road-t5 | 79.2 | 21.3 m | 3.71 |
| yamuna-bank-t5 | 32.4 | 18.0 m | 1.80 |
| dnd-flyway-t5 | 25.2 | 20.0 m | 1.26 |
| ridge-run-t5 | 14.4 | 13.0 m | 1.11 |

The Old City ladder was authored on the same absolute scale as the wide roads
without anyone accounting for the fact that it is half as wide as anything
else and a third the width of the Ring Road. A vehicle every twenty metres on
a road two cars across is not dense traffic, it is a wall. A 25 km race took
forty minutes and the riders spent 800 of those seconds on the tarmac.

Every Old City tier is scaled by 0.6, which preserves the tier ladder exactly
and lands the route at 4.08 vehicles per metre — just above the Ring Road,
which is right for the tightest route in the game rather than double it.

The whole 25-route suite went from 524 s to **148 s** afterwards, which is the
same finding from the other end: most of that time was thirteen riders
crashing into a traffic jam.

I want to be honest about what this was. I did not find this by reading the
data. I found it because a test I had made 12% slower failed, and the 12% was
not the bug. The margin was hiding it, and had the crash rewrite been cheaper
rather than dearer, it would still be hiding it.

### Tests that were measuring the machine, for the third and fourth time

`race.test.ts` timed out at 60 s inside `npm run check` and passes in 13.2 s
run on its own. Same call as the three already recorded above: `check` runs
every file in parallel under v8 coverage instrumentation, and these are
simulation tests that ride real routes to the line. The ride is the criterion.


### The thing I could not fix, and am not going to paper over

`racer.test.ts > does not hand a top-three finish to a rider who only holds
throttle` fails. It is the last failing test and it is a real one.

On `ridge-run-t2`, a player who holds the throttle and never touches the bars
finished **9th** before this phase and finishes **3rd** after it. That is a
six-place swing and it is caused by the crash rewrite, not by anything else —
I checked the Old City density change first, and this route is not Old City.

The mechanism is not subtle once measured. In that race:

- The player crashes **zero** times.
- Every one of the thirteen rivals crashes one to three times, almost all of
  them on hazards.

So the player's finishing position is entirely a function of how much time the
*rest of the field* loses. The old flat cost charged 3.5 s per crash. The
derived cost charges 4–10 s at the speeds that route is ridden at, because
that is precisely what the spec asked for. Making the punishment scale with
impact speed necessarily punishes the riders who crash, and on this route the
player is not one of them.

I tried four things and none of them is the answer:

| Attempt | Result |
|---|---|
| `downedSeconds` 0.7 → 1.4 (costlier crashes) | place **2** — worse |
| impact factors 0.58/0.63 → 0.45/0.52 (cheaper, floor restored) | place 3 |
| Three `ridge-run-t2` hazards moved onto the centreline | place 3 |
| Original tuning | place 3 |

The direction of the first row is the tell: making crashes *cheaper* does not
walk it back toward 9th, and making them dearer makes it worse. Magnitude is
not the lever. What changed structurally is that a crashed rider now resumes
where the **bike** stopped rather than where their own slide ended, which is
several metres further back per crash, and it compounds over thirteen riders.

Two things I found while chasing it that are worth writing down whatever gets
decided:

1. **Every hazard on every `ridge-run` tier is authored off the centreline** —
   `t` values of ±1.95 to ±3.45, never near zero. So the racing line crosses
   hazards and the lazy straight-ahead line does not, which inverts the
   difficulty gradient the test is asserting. I moved three of them onto the
   line to see if it mattered, it did not, and I reverted it rather than leave
   an unmotivated content change in the tree.
2. **The AI does not avoid hazards.** It reads the road geometry ahead through
   `aiLookahead` and steers a racing line; hazards are not part of that. That
   is why the rivals eat them and the player does not. It was survivable when
   a crash cost a flat 3.5 s and it is not now.

I do not think either of those is mine to fix inside a reopened Phase 4 about
the crash. Fixing (2) is a Phase 5 AI feature. Fixing (1) is a content pass
over 25 routes. And tuning the crash physics until this one assertion flips
would be fitting the model to the test, which is the thing this devlog exists
to stop me doing.

So: the crash is built, specified, measured and tested. The difficulty
assertion that sits on top of it needs a decision that is not a tuning value.
