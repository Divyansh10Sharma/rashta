# Phase 5 — Racers and the race loop

Raw working notes. Messy on purpose.

## What Phase 4 handed me that matters here

`stepRider(rider, input, track, tuning, dt)` was already factored out of
`step()` in Phase 2, taking an `InputFrame` rather than reading a keyboard.
That is the whole seam this phase needs: an AI rider is a `Rider` plus a
function that produces an `InputFrame`. Rivals and the player go through
identical physics, which is the only way "the player starts last and finishing
top three is achievable but not easy" can be tuned honestly — if the AI cheats
at the physics level there is nothing to tune.

`progress(pos, track)` from Phase 3 already exists and already normalises
across fork branches. Standings are a sort on it.

## Decisions taken before writing anything

### 1. AI outputs an `InputFrame`, nothing else

An AI rider may not write to its own position, speed, or lateral. It returns
throttle, brake and lean, and `stepRider` does the rest. This is a rule, not a
preference: the moment AI can set a position directly, every physics guarantee
built in Phases 2 and 4 stops applying to thirteen of the fourteen riders on
the road, and the non-overlap and crash work becomes decorative.

The cost is that some behaviours get harder. "Move to the left lane" is not an
assignment, it is a lean input held for as long as it takes.

### 2. Rubber-banding is a tuning value, default zero

The roadmap says "mild rubber-banding, tunable, off by default in the data
file". Off by default means the acceptance criterion "finishing top three is
achievable but not easy" has to be true of the honest race, not of a race that
is quietly waiting for the player. If it can only be met with rubber-banding
on, the answer is to fix the AI or the field's bikes, not to turn it on.

### 3. The race state machine lives in `src/core/sim/`, not a new directory

`ARCHITECTURE.md` lists the core subdirectories and there is no `race/`. The
state machine is simulation state that ticks at 60 Hz alongside everything
else, so `sim/race.ts` is where it belongs. `ai/` gets the rival brains only.

### 4. Fourteen profiles in `racers.json`, one of which is the player

The GDD says fourteen racers, the player plus thirteen rivals, and "invent all
fourteen". So the player is a profile like anyone else — a name, a bio, a
starting bike, starting cash. `skill` and `aggression` are meaningless for the
player and are still there, because a fourteenth shape that is almost the same
as the other thirteen is worse than one that is identical. The race builder
takes the player's id and races the other thirteen.

### 5. Standings sort on `progress`, and the test has to prove it mid-fork

Sorting on raw `s` is correct until two riders are on different branches of a
fork, at which point it is silently wrong — and it is silently wrong in the
most visible place in the game. The acceptance criterion asks for standings
proven correct with riders split across both branches, so the test has to
actually put them there rather than assert on a straight road and hope.

## What happened

### The stray dog that ate the race

First run of the twenty-five-track acceptance test: seven routes failed, riders
frozen at specific metre marks. 3431 m on old-city-t1, 15326 m on t4 and t5 —
whoever arrived there stopped, so it was geography, not a rider.

My first theory was car-following: a rider stopped behind something, and a
speed limit of exactly zero is absorbing. I dumped everything within twenty
metres ahead of a stuck rider and the answer came back `NOTHING`. Wrong again,
and in the same shape as Phase 4 — the plausible cause was not the cause.

What the dump did show was speed 0.0 at full throttle, state `riding`, and `s`
creeping about 0.6 m every eight seconds. So the rider was accelerating and
something was taking it back off, sixty times a second. Both marks had a stray
dog on them.

`checkHazards` applies a hazard to any rider within `HAZARD_REACH`, and it runs
every tick. A dog costs six metres a second below the crash speed. A rider who
arrives at one slowly enough loses six every tick and gains about 0.025, so it
is pinned at a standstill one and a half metres short of clear road, forever.
The hazard system was written for a rider passing through at speed, and only
fourteen riders arriving at every hazard in every possible state found it.

Fixed by making a hazard something you drive *over*, once: `Rider` now carries
`lastS`, the position at the start of the tick, and a hazard triggers only if
it lies in `(lastS, s]`. A rider standing still crosses nothing. All twenty-five
routes passed after that, including the throttle-only player, which had been
failing for the same reason.

### The race was being decided by the traffic spawn ring

With everybody finishing, the results still made no sense: skill barely
correlated with finishing time. Sabina Thapa, skill 0.89, came twelfth; Dev
Tandon, 0.59, came third.

Dumping crashes per rider against the fraction of the race each spent more than
420 m ahead of the player produced this, and it is close to a straight line:

```
place  crashes  % of race outside the traffic window
  1       3      87%
  2       4      68%
  3       1      75%
 ...
 12      13       0%
 13      13       0%
 14      13       0%
```

Phase 4's spawn ring populates a window around *the player* — 420 m ahead, 90 m
behind — because in Phase 4 there was only one rider. In a fourteen-rider race
anybody who gets more than 420 m clear is on a completely empty road, and the
result is decided by who got out of the traffic first rather than by riding.

The window now spans the field: from behind the last rider to ahead of the
leader, with spawning still only ahead of the leader so nothing pops into
existence beside somebody. `createTraffic` takes the span so the pool is sized
for it.

### Which cost 6x the traffic and 4x the tick

Pool size is density times window length, so a 1.2 km field span is roughly
three and a half times the vehicles. The twenty-five-track test went from 57
seconds to over ten minutes, and a measured race tick on ring-road-t5 went to
**3.86 ms** against a 1 ms budget. That fails the 60 fps criterion on its own.

Both hot scans — `leaderFor` and `hasRoom` — walked the whole pool testing the
expensive condition first: two table lookups and arithmetic to compute how wide
two vehicles are, before ever asking whether they were anywhere near each
other. Reordering to test distance first, with a conservative bound derived
from the longest vehicle in the game, took ring-road-t5 from 3.86 ms to
**1.57 ms** without changing a single outcome.

Trimming the field span from 2000 m to 1200 m took it to **0.83 ms**, inside
the budget. Measured, best of five, after a warm-up:

```
ridge-run-t1   pool=  7   0.042 ms/tick
old-city-t5    pool= 86   0.416 ms/tick
ring-road-t5   pool=135   0.831 ms/tick
```

A proper spatial index would beat all of this and is deferred: the scans are
still O(n²), just with a very cheap inner test.

### Skill was cancelling itself out

Even with traffic fair, finishing order tracked `caution` and not `skill`. The
reason was in the corner-speed calculation. It took the sharpest curvature
anywhere within the lookahead and capped speed at what that corner would take —
so a rider who read *further* ahead was limited by a sharper corner further
away, and went slower. Reading the road better made you worse.

Replaced with the braking-distance form: for each sample at distance `d` ahead
with curvature `k`, the corner takes `sqrt(grip/k)`, so the speed that may be
carried `d` metres before it is `sqrt(grip/k + 2*a*d)`. Minimum over the
samples. Now a longer lookahead finds constraints earlier *and* allows more
speed on the approach, which is what looking further ahead is for.

Square roots only. Nothing transcendental gets into `step()`.

### A queue of riders that parked permanently

Old City t4 and t5 then failed with riders stuck in two places: around 160 m,
which is the start, and near the finish. This time it *was* the absorbing-zero
problem I had wrongly blamed for the dog. On a narrow two-way street a rider
stopped by traffic stops the rider behind it, and a stopped rider looks only
fourteen metres ahead, so nothing can ever change.

Riders now always creep at 2.2 m/s. If that creeps them into a bus, the crash
slide is still progress; parking forever is not.

### The roster had to be rebuilt around what the bikes do

The first roster gave five of thirteen rivals sport or super bikes for the very
first race. A 162 km/h starter bike cannot finish top three against a field on
268 km/h machinery no matter how well it is ridden, which contradicts both the
acceptance criterion and the GDD's difficulty curve.

Now twelve of fourteen start on the street bike. Ishaan Marwah gets the super
bike and Zoya Mirchandani the sport one — Ishaan because "too much machine and
not enough road under him" should be mechanically true and not just a line in
his bio. Two riders on better machinery means third place is the target, which
is exactly what "achievable but not easy" should feel like.

### What I could not demonstrate

Whether a human can finish top three. A rival-grade brain driving the player's
bike from the back of the grid finishes eighth on ridge-run-t2, about ten
seconds behind third over a five-and-a-half minute race. That is close, and the
brain has none of the route knowledge a player accumulates, but "close" is not
"achievable" and I am not going to write a test that claims otherwise. The
acceptance criterion is tested as two honest halves: the throttle-only player
is nowhere near the podium, and the podium is within seconds of a competent
line. The rest is playtesting, and it is the open risk of this phase.

Frame rate under 4x CPU throttling is still not measured. It is now the only
acceptance criterion in the project with no number against it, and Phase 5 has
added thirteen riders and three and a half times the traffic.

## Deferred

- A spatial index for the traffic pool. The scans are O(n²) with a cheap inner
  test; at tier-5 density that is 0.83 ms of a 1 ms budget and there is no room
  left for Phase 6's combat.
- Tier-appropriate fields. Every race currently uses the roster's starting
  bikes, so tier 5 is fought on the same machinery as tier 1. The economy in
  Phase 8 owns this.
- `traffic.ts` is 440 lines, well past the 250 the standards ask for.
- `aggression` and `vengefulness` are loaded and validated but only aggression
  is read, and only to weight how much a rival fears oncoming traffic. Both are
  Phase 6's.
