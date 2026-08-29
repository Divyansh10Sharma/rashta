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
