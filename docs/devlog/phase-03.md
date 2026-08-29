# Phase 03 — Real tracks

Five Delhi routes, five tiers each, forks that can actually be taken, and an
environment per scenery tag. The first phase where the track code written
blind in Phase 1 gets ridden.

## Decisions taken before writing anything

### 1. Tier extension: `extends`, resolved at load

`ARCHITECTURE.md` §1.3 is explicit that tier N is tier N−1's segment list plus
appended segments, and that the JSON must reference the previous tier rather
than duplicate it. So a tier file carries `"extends": "<track-id>"` and only
the segments it adds.

That breaks the current loader's assumption that one file is one track. Branch
`forkS` and `rejoinS` are validated against the main path's total length, and
with `extends` that length is not known until the chain is resolved. So
validation splits in two: each file's own segments are checked in isolation,
then the chain is resolved, and only then are branch ranges checked against
the assembled length.

Appending never shifts earlier segments, so a fork declared in tier 1 keeps its
`forkS` and `rejoinS` in tier 5 unchanged. That makes it worth putting both of
a route's forks in tier 1 and inheriting them — one closure problem solved per
route instead of five.

### 2. Which fork you take is decided by the branch's own geometry

Nothing in the docs says how a rider ends up on one branch rather than the
other. The obvious approach is a new data field naming the side, but the
branch already knows: its first segment's curvature says which way it peels
off. Positive curves right, negative curves left.

So: at the tick where `s` crosses `forkS`, a rider whose `t` is on the same
side as the branch's opening curvature, by more than a threshold, is captured
onto it. Everyone else stays on the main path. No schema change, nothing to
keep in sync, and the rule reads the same way it looks on screen — drift right
at the split and you take the right-hand road.

Coming back is unconditional: at `forkS + branchLength` the rider returns to
the main path at `rejoinS`, carrying `t` across.

### 3. Track length, and a number I want to put in front of Divyansh

`GAME_DESIGN.md` says tier 1 runs ~8 km and each tier adds 4–6 km, so tier 5
is around 28 km. I raised the race-duration implication before Phase 0 and it
was the one question that did not get an answer, so I am building to spec and
measuring rather than guessing.

At the Nagin's realistic average — call it 150 km/h with traffic still to come
— 8 km is about three and a half minutes and 28 km is about eleven. Eleven
minutes is long for an arcade race with no checkpoints, where an arrest ends
the run outright. The headless rideability test times every tier, so the real
figures go in this devlog and the decision can be made on numbers.

### 4. The 25 files are generated, and that is worth admitting

Each fork has to close geometrically to within 0.5 m *and* differ from the
main span by no more than 5%. Those are simultaneous constraints on radius,
angle and the length of the straight it replaces — solvable, but not by typing
JSON by hand ten times.

So the route descriptions are compact and a script solves the closure and
emits the JSON, which is what gets committed and what the game loads. The
script is a tool for authoring, not part of the build: nothing at runtime
depends on it, and the JSON is the source of truth the loader validates. If
tracks end up needing frequent hand-editing, the honest answer is a real
authoring tool, and that is not something any phase has asked for yet.

## What happened

### The fork mouth was in the middle of the road

The route-selection rule — take the branch whose opening curvature matches the
side you are on — failed its first test. Holding full right lean down the Ring
Road, the rider never took the right-hand slip road.

The cause was a modelling error I had not noticed writing it. A branch's
centreline started at the *main* centreline, so at the split the two roads
were coincident and the slip road's mouth was in the middle of a 26 m
carriageway. A rider pinned to the right edge at `t = 13` is 13 m from a
branch that is only 7 m wide, so the width check I had just added — correctly,
to stop riders being snapped sideways on entry — refused them.

Both halves were wrong in the same way: a slip road leaves from the *edge* of
the road it leaves, not from the centre of it.

So branches gained `entryT`, the lateral offset of their centreline at the
split, and `t` on a branch is measured from the branch's own centreline. Entry
is then a translation rather than a snap — a rider on the outside edge of a
wide road is exactly on the outside edge of the slip road leaving it — and the
generator computes `entryT` so the two outer edges line up.

Closure had to follow: a branch now rejoins offset by `entryT`, so
`assertBranchesRejoin` compares against the main frame displaced by it.
Measured after the change: all ten forks close to **0.0000 m**. The first run
reported a 2.5 m miss, and that turned out to be the *test* comparing without
the offset while the production check already had it — worth checking which of
the two is wrong before assuming it is the code.

### Tier growth targets, and a generator that argues back

Two routes missed the spec on the first generation: Old City came out at 2.3 km
against a target of ~8, and its tiers grew by 2.7 km against a required 4–6.
DND Flyway overshot at 9.8 km.

Rather than hand-tune segment lists until the sums came out, each tier is now
authored for character and padded with one closing straight to hit an explicit
target, and `padTo` throws if the authored content already exceeds it. That
threw immediately on DND — 8036 m of authored road against an 8000 m target —
which is the generator refusing to silently produce a route that does not match
its own spec.

Lengths were then varied per route rather than left identical, because five
routes all exactly 8.000 km reads as generated. Old City is the shortest at
7.2 km and the flyway the longest at 8.6, which is also the right ordering by
character.

### Race durations — the number I flagged before Phase 0

This was the one question from the pre-phase review that never got answered, so
here are the measurements rather than an argument. Flat out, no traffic, no
combat, no crashes — so a floor, not a realistic time:

```
                tier 1              tier 5
Street  (Gully)   3.0-3.3 min     10.3-11.6 min
Sport   (Nagin)   2.3-2.5 min      7.9-8.8 min
Super (Shaitan)   1.9-2.0 min      6.4-7.0 min
```

Tier 1 is 2–3 minutes, which is right for an arcade race. **Tier 5 on a Street
bike is over ten minutes**, and that is before traffic, police, or a crash
costs anything. Tier 5 is meant to require a Super bike, which brings it to
about 6.5–7 minutes — still long for a race with no checkpoints where an
arrest ends the run outright.

Nothing is blocked on this. But the roadmap has Phase 5 running a headless
simulation of all 25 tracks to completion, and Phase 8 balancing an economy
around repeat races, so the number matters more each phase. Flagging it here
with figures attached rather than raising it again as a hunch.

Also visible in the table: Old City averages 138 km/h on the Street bike where
the other routes give 156. That is the cornering grip model doing real work for
the first time — Phase 2's road was deliberately straight, so this is the first
evidence the scrub term does anything.

### A fourth flaky heap test, and then no more

`allocates nothing per tick` failed the same way the scenery and sampling ones
had. That made three replaced in two phases, so the pattern got a rule rather
than another patch: **measuring `heapUsed` to prove "this allocates nothing" is
the wrong instrument** — it measures a consequence through a shared, noisy
channel with a threshold that is a guess.

All three are now deterministic: identity checks that the same objects and
buffers survive the loop, plus a source scan of the hot files for `new`,
`.map(`, `.filter(` and friends, sitting alongside the existing
no-transcendental guard. `new Error(...)` is exempt and says why in a comment.
