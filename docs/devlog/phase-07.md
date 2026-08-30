# Phase 7 — Police

Raw working notes. Messy on purpose.

## What Phase 6 handed me that matters here

Two things I intend to lean on hard, and one number I have to respect.

Police are riders. They are the same `Rider` struct, on the same road, through
the same `stepRider`. So pursuit is a `think()`-shaped function returning an
`InputFrame`, and "ram to destabilise you" is a kick — an attack the combat
system already has, already tested, already legible on screen because the
attacker glows while swinging. Building police as a distinct entity type with
its own movement and its own way of shoving people would be a second physics
and a second set of bugs.

The number: the simulation used 0.63 ms of its 1 ms budget at the end of Phase
6. Police add riders to a field that is scanned pairwise. Fourteen was 196
pairs; twenty is 400. It is still small next to 135 traffic vehicles, but it is
not free and I should measure rather than assume.

## Decisions taken before writing anything

### 1. Police are riders in the field, not a parallel system

They go into `race.riders`, so rivals see them, combat works against them, and
collision works with them. They do **not** go into `race.entries`, because they
are not racing and must never appear in the standings. That split — same road,
different list — is the whole design.

A consequence I am accepting deliberately: you can punch a police officer. The
GDD does not forbid it and the mechanics all work. It should be a bad idea
rather than an impossible one.

### 2. Police density is per-tier data, like traffic

`policeDensity` joins `trafficDensity` in every route file, validated on load,
and **zero at tier 1** — GAME_DESIGN's difficulty curve says tier 1 teaches
riding with no police, so the data has to say that rather than the code
special-casing a tier number.

### 3. Pursuit triggers on speeding, and has to be escapable

GDD: they pursue when you are "speeding noticeably". So there is a threshold,
it lives in the data file, and — this is the acceptance criterion that will be
hardest — dropping back below it for long enough has to actually lose them.
"Escaping pursuit is possible and feels earned" is not testable as written, so
what I will test is the mechanism: pursuit starts, pursuit ends, and there is a
speed and a duration at which it reliably ends.

### 4. Arrest is a crash near an officer, not a state a cop decides

Crashing within a radius of a pursuing officer ends the race. Measured with
`trackDistance` like every other range in this project — Phase 6's lesson was
that a range measured by subtracting coordinates is wrong on a bend in both
directions, and there is no reason an arrest radius should be exempt.

### 5. Money is computed here and spent in Phase 8

Phase 7 owns fines, repairs and the wreck state; Phase 8 owns the career that
pays for them. So this phase produces a `RaceOutcome` — what happened and what
it costs — and stops there. No wallet, no shop, no persistence. A speculative
economy written now is the wrong shape by the time Phase 8 arrives.

### 6. Damage is a second, slower health bar

Stamina is the rider and resets between races. Damage is the bike, accumulates
across a whole race, and at 100 the bike is wrecked. They must not be the same
number: one is a fight you can recover from in seconds, the other is a bill.

## What happened

### Police as riders paid off immediately

`createPolice` makes `Rider`s. `stepPolice` writes an `InputFrame`. `stepRider`
moves them. A ram is `startAttack(rider, 'kick', combat)` — the attack that
already existed for shoving people sideways, already tested, and already lit up
on screen because Phase 6 made an attacker glow while winding up.

The whole police module is about 200 lines and most of it is the pursuit state
machine. Nothing in it knows how a motorcycle moves.

One consequence I took deliberately: police are in `race.riders` and not in
`race.entries`. Rivals see them, collisions see them, combat works against
them, and the standings cannot. A test asserts that `order` is exactly fourteen
long on a route with police on it, because that is the sort of thing that would
otherwise be found by a player seeing a policeman in second place.

### Three of my own tests were wrong before the code was

None of the first three failures were bugs in the game.

**Breaking out of the loop during the countdown.** The pursuit test ran
`if (race.phase !== 'racing') break;` — and the first three seconds of every
race are `countdown`, so it broke on iteration one and reported that no officer
had ever taken an interest in anybody. It had simulated nothing.

**Expecting `clampToRoad` not to work.** Two tests put a rider off the road by
setting `t = 900` and expected a crash. `stepLateral` clamps `t` back onto the
road before the collision check ever runs, so the rider was never off it. That
clamp has been correct since Phase 2. Both tests now call `crash()` directly,
which is honest about what is being tested.

**Forcing a pursuit without a target.** Setting `unit.state = 'pursuing'`
achieved nothing, because `unit.target` is an index into the rider array and an
officer whose target does not resolve drops straight back to patrolling on the
next tick. Correct behaviour; my test had only set half the state.

I am recording these because the alternative is a devlog that only contains the
project's bugs and not mine, and because two of the three were the same mistake
in different clothes: asserting on a system I had not actually put into the
state I thought I had.

### Escaping had to have three exits

"Escaping pursuit is possible and feels earned" is not directly testable, so
what is tested is the mechanism, and the mechanism needed to be more than one
thing. An officer gives up when the rider has been under `dropSpeed` for six
sustained seconds, or when the gap exceeds `loseDistance`, or when the target
stops resolving at all.

Sustained matters. A test asserts that lifting off for one second does *not*
work and that `slowFor` resets the moment you speed back up, because an escape
you can perform by briefly blipping the throttle is not an escape.

There is also a reaction delay after being shaken off, so the officer you just
lost does not re-acquire you on the next tick. Without it, "escaping" lasted
one frame — the same shape of bug as Phase 6's weapon steal, which also lasted
one frame for the same structural reason: the state changed but nothing stopped
it changing straight back.

The loader refuses a `police.json` where `dropSpeed >= triggerSpeed`, because
that file describes police who can never let go, and a data file that makes an
acceptance criterion unsatisfiable should not load.

### Damage is charged on the edge, not while inside

Phase 5's stray dog subtracted six metres per second for every tick a rider was
near it, which pinned a slow rider permanently. The same shape would have made
bike damage accumulate for every tick of a crash slide. So a crash is charged
once, on the tick the rider goes down — `RaceEntry` remembers whether it was
down last tick — and a test asserts that the whole slide and remount adds
nothing further.

### Fifty-eight policemen on the Ring Road

The frame-budget test from Phase 6 failed, which is the first time in this
project a performance test has caught something real rather than measuring the
machine.

The cause was not the code. `policeDensity` is officers per kilometre, and I
had written the numbers by analogy with `trafficDensity` without checking what
they multiply by. Tier-5 routes are assembled from all five tiers' segments, so
they are twenty-five to thirty kilometres long:

```
                t1     t2     t3     t4     t5
ring-road        0      6     16     32     58
dnd-flyway       0      5     13     28     50
ridge-run        0      2      4      9     16
```

Fifty-eight police on one road is not a performance problem that needs
optimising, it is a design problem wearing a performance problem's clothes. The
field goes from fourteen riders to seventy-two, and every pairwise scan in the
game — combat, engagement, the AI's view of the road — grows with the square of
it.

Fixed by choosing counts and deriving the densities, rather than choosing
densities and discovering the counts:

```
                t1     t2     t3     t4     t5
ring-road        0      3      7     10     14
dnd-flyway       0      2      4      6      9
ridge-run        0      1      2      3      5
```

Still strictly rising per tier, still four times as policed on the Ring Road as
on the Ridge, and the worst case is now twenty-eight riders instead of
seventy-two. The budget test passes again.

Worth noting what caught it: not a frame-rate observation, not a profile, but a
ratio assertion added in the previous phase specifically because absolute
timings had become unreliable. It failed for exactly the reason it exists.

### Blocking, which I had nearly shipped as a no-op

The roadmap's build list says police "pursue, ram, block", and I had written
the first two and quietly listed the third as deferred. Looking again, an
officer ahead of its quarry was already steering onto their line — which looks
like blocking, and is not, because it was also at full throttle and therefore
driving away from them.

Blocking is being in front and *staying* there. An officer within twenty-two
metres ahead now matches the quarry's speed instead of its own maximum. Three
lines, and the difference between an obstruction and a bike leaving.

I am recording this because deferring it would have been the easy call and it
would have been wrong: the behaviour was nearly there, and "deferred" would
have meant "I did not look closely at what I had built".

### What the money does and does not do

`outcomeOf` returns what a race cost and stops. There is no wallet, no shop,
nothing persisted, and prize money is a parameter that defaults to zero because
the prize table arrives in Phase 8 with the career that spends it.

Fines and repairs scale with the bike's price, which is GAME_DESIGN's rule
rather than a knob: a bad night on the super bike is genuinely expensive. There
is a step at the wreck point, so a written-off bike costs distinctly more than
one at 99% damage — the difference between "expensive" and "you are walking
home" should be visible in the number.

### The suite finally became unable to verify itself

After the police were in, `npm run check` failed four timing assertions at
once — the frame-budget ratio, the track-build budget, and two timeouts — every
one of which passed when run on its own. That is not four bugs. That is the
suite having grown heavy enough that nothing in it can be timed.

Two causes, and both are mine.

**Vitest runs one worker per core less one.** On this eight-core machine that
is seven workers, each running a whole race at 60 Hz, so the machine is
saturated for the entire run and there is no quiet moment for any sample to
land in. Capped at four — and the first attempt at capping it used
`poolOptions.threads.maxThreads`, which this version of Vitest does not have.
It typechecked as an error and was silently ignored at runtime, so the suite
ran exactly as before while I believed otherwise. The option here is
`maxWorkers`. Half the machine stays idle, the wall time goes up
somewhat, and every measurement in the suite starts meaning something again.

**The ratio test was comparing samples of very different lengths.** A race tick
is about fourteen times a lone tick, and I timed sixty of each — a 38 ms sample
against a 3 ms one. On a busy machine the short sample finds a quiet slice and
the long one cannot, so the minimum of the short one is clean and the minimum
of the long one is not, and the ratio inflates for reasons that have nothing to
do with the code. Both samples now take about the same wall time: sixty race
ticks against eight hundred lone ticks.

The second one is the more embarrassing, because the whole point of the ratio
was to be immune to a busy machine and it was not. It was immune to the
*machine* and not to the *sampling*.

## Deferred

- The suite still takes over ten minutes and capping the workers made it
  longer. Third phase running to say so. The real fix is that several race-level
  tests each simulate three or four minutes of the same routes and could share
  one simulated race; that is a day's work and it is owed.
- The end-of-race screen does not exist yet: `outcomeOf` produces the numbers
  and nothing displays them. That belongs with Phase 8's career screens.
- Officers do not coordinate with each other — two of them will block the same
  line rather than covering both sides. That needs the field-coordination
  machinery Phase 9's enemies will also want, and it is the honest remaining
  gap in "pursue, ram, block".
- A spatial index for the traffic pool, still. Third phase carried.
- `traffic.ts` is still 440 lines.
