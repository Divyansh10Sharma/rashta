# Phase 6 — Combat

Raw working notes. Messy on purpose.

## What Phase 5 handed me that matters here

Two things, one good and one a warning.

The good one: every rider in the field is the same `Rider` structure driven by
an `InputFrame`, and `think()` already returns one. Adding an attack is adding
a field to that frame, not adding a second way for the world to change. The
player and thirteen rivals get combat on the same day, through the same code.

The warning: the race tick already costs **0.83 ms of a 1 ms budget** at
tier-5 density, measured at the end of Phase 5. The roadmap says "frame budget
unchanged". There is no room to spend, so anything that scans the field for
every rider every tick has to be cheap by construction — and Phase 5 spent a
whole session paying for exactly that mistake in the traffic pool.

`aggression` and `vengefulness` have been loaded and validated since Phase 5
and read almost nowhere. This is the phase they are for.

## Decisions taken before writing anything

### 1. Attacks are input, not events

An attack is a field on `InputFrame` — the same latched, replayable structure
the throttle is. Not a method call, not a queued event. This keeps the
determinism guarantee intact for free: a replay that reproduces the inputs
reproduces the fight, and there is no second channel through which the world
can change.

### 2. Windup and recovery lock steering, and that is the whole design

GAME_DESIGN is explicit: you cannot steer during windup and recovery, and
attacking on a corner is how you crash. That means the attack state machine
has to sit *upstream* of `stepLateral`, suppressing lean, rather than being a
thing bolted on beside it. If steering still works during an attack, the whole
risk/reward of combat evaporates and it becomes a free action.

### 3. Range is measured with `trackDistance`, and tested on a bend

The acceptance criterion says so, and says why: a range check that passes only
on a straight is not passing. Two riders three metres apart on the inside of a
tight bend are not three metres apart, and a raw `(s, t)` box would say they
are. There is already a `trackDistance` for this and it has been correct since
Phase 1.

### 4. Weapons circulate and are never created

GAME_DESIGN: weapons are not bought, they only move between riders. So the set
of weapons in a race is fixed at the start line by the roster, and every
transfer is a move, never a copy. That makes it testable as a conservation
law — count the weapons at the start, count them at the end, and the number
cannot change. A duplication bug becomes a failing test rather than an
economy.

### 5. Stamina already exists and has never been used

`Rider.stamina` has been on the struct since Phase 2, initialised to 100 and
touched by nothing. It is the damage model. At zero the rider goes down, which
is the crash path Phase 4 already built — combat should not need a second way
to put someone on the tarmac.

## What happened

### The range test that would have passed for the wrong reason

The acceptance criterion is specific: prove the range check on a tight corner
as well as a straight, because a check that only passes on a straight is not
passing. I wrote that test first and it failed — and it failed because *my
expectation* was wrong, not the code.

I had assumed two riders at the same `(s, t)` offsets are always further apart
on a bend. They are not. It depends which side of the road they are on:

```
2.4 m apart along the road, 40 m radius bend
  straight        2.400 m
  outside (t=-3.5) 2.610 m   further
  inside  (t=+3.5) 2.190 m   closer
```

Which is a better demonstration than the one I meant to write. A raw `(s, t)`
box says 2.4 in all three cases and is wrong twice, in opposite directions. The
test now asserts both, and then puts a punch — 2.5 m of reach — between them:
it connects on the straight and misses from identical coordinates on the
outside of the bend.

### A steal that lasted one frame

Knocking a weapon loose worked, and did nothing. The rider who lost it picked
it straight back up, because it lands at their feet and `collect` runs in the
same tick.

Dropped weapons now have a `settle` timer — a second and a bit during which
nobody can take them. At racing speed everyone involved is thirty metres away
by the time it expires, which is both the fix and roughly what a thing bouncing
down a road actually does.

### A rider that kept swinging after being knocked off

`stepCombat` clears an attack when the rider is no longer riding, but
collisions resolve *after* combat in the tick, so a rider knocked down by a bus
mid-backhand kept the attack for a tick. Rather than reorder the tick — which
would have traded this for some other ordering bug — the swing is now cleared
in `crash()` itself, which every cause already goes through.

### The fourth timing test to measure the machine

The frame-budget test measured 0.63 ms a tick on an idle machine and **4.22 ms**
inside `npm run check`. Not noise, and not fixable by taking the best of N: the
suite is twenty-seven files, several of which simulate entire races, so the
machine is oversubscribed for the whole run rather than in bursts.

Phases 2, 3, 4 and 5 each hit a version of this and each time the answer was a
better sampling strategy. That has run out. The budget is now asserted as a
**ratio** against a lone rider stepped in the same conditions — both are
CPU-bound, both inflate together, and the ratio is the part that means anything
on a machine you do not control:

```
ring-road-t5, idle machine
  race tick (14 riders, 135 vehicles, combat)  0.633 ms
  lone tick (1 rider, 40 vehicles)             0.046 ms
  ratio                                       13.7
```

Asserted under 20. The absolute number lives here, measured on an idle machine,
which is the only place it can be measured honestly.

Worth recording that combat itself cost almost nothing: fourteen riders is a
196-pair worst case, against 135 vehicles that were already the expensive part.

### Attacks are input, and that turned out to matter twice

Making an attack a field on `InputFrame` rather than a method call paid off in
two places I had not planned for.

The first: replay determinism came free. There is no second channel, so the
existing determinism test covers combat without knowing combat exists.

The second: the AI got combat for nothing. `think()` already returned an
`InputFrame`; it now sets one more field. A rival attacks through exactly the
same path the player does, so there is no AI-only attack code that could drift
away from what the player experiences.

Thirty-four `InputFrame` literals across fifteen files meant `attack` had to be
optional. That is not a compromise — absent is precisely what "no button
pressed" means, and the alternative was editing fourteen files that have
nothing to do with combat.

### How a rival knows it is being hit

It does not, exactly. A rival compares its stamina with last tick's, and an
unexplained drop sets a grudge timer scaled by `vengefulness`. It never learns
who hit it, which is both cheaper than tracking an attacker and closer to true:
a rider on a motorcycle at night does not necessarily know either.

`aggression` sets how often a rival swings at all and how long it waits between
swings. Pritam Sodhi — aggression 0.21, vengefulness 0.94 — never starts
anything and does not let go, which is what his bio says, and it is now
mechanically true rather than flavour text.

## Deferred

- `StaminaBars` and the rest of the HUD have no tests: the suite runs in Node
  with no DOM, and adding jsdom is a runtime dependency this phase does not
  need. Only the pure parts — `revsFor`, `glowFor` — are covered.
- The test suite now takes seven minutes. Most of it is race simulation, and
  it is heading somewhere unpleasant.
- A spatial index for the traffic pool, still. Carried from Phase 5.
- `traffic.ts` is 440 lines, still past the 250 the standards ask for.
- Whether combat is *fun* is not something a headless test can answer, and it
  joins the 4x-throttled frame rate and the top-three question on the list of
  things only playtesting settles.
