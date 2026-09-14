# Prompts

Paste these into Claude Code, one at a time. This file is for you, not for
Claude — but Claude reading it is harmless.

Twelve phases, 0 through 11. `docs/ROADMAP.md` is the source of truth for what
each one contains.

---

## The per-phase prompt

Replace `NN` with the phase number. This is the whole workflow — use it
verbatim every time.

```
Start Phase NN.

1. Re-read docs/ROADMAP.md for Phase NN, plus docs/ARCHITECTURE.md and the
   relevant sections of docs/GAME_DESIGN.md. Read those files end to end,
   not by grep — they are the specification.
2. Create docs/devlog/phase-NN.md before you write any code, and append to it
   honestly as you go — what you tried, what broke and the actual symptom,
   what you changed, what surprised you. Messy is fine. Truthful is required.
3. Build the phase. Nothing outside its scope. Anything you want to do that
   belongs to a later phase goes in the devlog under "deferred".
4. Run `npm run check` until it's clean, then demonstrate every acceptance
   criterion, including the four standing criteria at the top of the roadmap.
   Show me the evidence, don't assert it. Every frame-rate figure is measured
   under 4x CPU throttling and recorded as such.
5. Update Explanation.html per docs/EXPLANATION_SPEC.md: add the Phase NN page
   with all seven sections in order, and rewrite the final "90 seconds" page
   from scratch.
6. Report back in about ten lines: what you built, the acceptance evidence,
   what's in the devlog, and what Phase NN+1 will need from this.

Two things I'll check specifically:
- The dead ends on the Explanation page must come from the devlog. If nothing
  genuinely failed this phase, say so in one honest line rather than inventing
  something.
- Every technical term on the new page must have a "Words to know" entry, with
  the plain meaning first and the precise meaning second.
```

### If the phase edited CLAUDE.md

`CLAUDE.md` is loaded once at session start and held in memory. An edit does
not take effect until a new session. So: let it finish the edit, quit, restart
Claude Code, and start the next phase fresh. Otherwise it spends the whole
next phase working from the version it loaded at boot.

---

## The two subjective gates

Two phases have acceptance criteria Claude Code cannot certify. Only you can,
and if you wave them through you get a game that passes every test and is no
good.

### Phase 2 — the feel gate

You have to actually ride it.

```
I've played it. Here's what's wrong with the feel:
<be specific — "it feels slow at 200 km/h", "the camera makes corners
disorienting", "the bike turns like a boat">

Change one variable at a time, tell me what you changed and what you expected,
and log each attempt in the devlog. Don't change five things at once.
```

### Phase 8 — the art gate

You have to actually look at it. Screenshots you skimmed are not screenshots
you looked at.

```
Before you call Phase 8 done, show me three screenshots per scenery tag —
ridge, ringroad, yamuna, oldcity, flyway — plus one mid-crash and one of the
bike in the garage.

For each set, tell me what you were going for and what you think is weakest
about it. Then wait. I'll come back with specifics.

Also give me, as numbers and not as adjectives: fps under 4x CPU throttling on
the densest track, milliseconds spent in the post-processing chain, and the
gzipped bundle size against the 500 KB budget.
```

Then, once you've looked:

```
Here's what's wrong:
<be specific — "the ringroad and the flyway look identical", "the bloom is
blowing out the lane markings", "the buildings read as boxes, not buildings">

One change at a time, screenshots after each, devlog as you go.
```

---

## The crash work

Phase 4's crash sequence has its own subjective edge — the timings have to be
felt, not just ordered correctly.

```
Show me the crash timings as a table: total seconds lost at 80, 140, 200 and
260 km/h, broken into airborne / sliding / downed / rising / running /
remounting.

I'll check the arithmetic, and then I'll ride it. Monotonic is the test you
can run; "does a highside feel like a disaster" is the one I have to.
```

---

## When something goes sideways

```
Stop. Before you fix anything:
- What is the actual observed symptom, precisely?
- What are three different things that could cause it?
- Which is cheapest to rule out?

Rule that one out first and tell me the result. Don't start editing.
```

---

## The audit — every few phases

```
Audit the repo against CLAUDE.md's hard architectural rules. Report only —
fix nothing yet.

For each, show me either the evidence it holds or the specific place it's
broken, with file and line:

1. Does anything under src/core/ import three, ../render, ../input, or
   ../audio?
2. Is there a Math.random() call outside src/core/rng.ts?
3. Is any transcendental — sin, cos, tan, atan2, pow, exp, log — reachable
   from step()?
4. Is any positional state stored in world space, or any world position
   cached on an entity?
5. Is race position ever sorted on raw s rather than progress()?
6. Is anything allocating inside a per-frame update?
7. Does any file exceed 250 lines?
8. Does the replay test still assert bit-identical state, and does it pass?
   Does the jittered-clock variant still pass?
9. What is the actual coverage number on src/core/ right now, and on
   src/core/track/?
10. What is the current gzipped bundle size against the 500 KB budget?

Then tell me honestly: is there anything in the phases so far you'd build
differently now, knowing what you know?
```

---

## Before you show it to anyone

```
Do a shareability pass:
- npm run build, then give me the gzipped bundle size and the load time on a
  throttled Fast 3G profile
- confirm the PWA installs on Chrome and Edge, and that it still runs with
  the network disconnected
- reread README.md as if you'd never seen this project, and fix anything a
  non-developer would get stuck on. Two ways to play: the link, or from
  source.
- open Explanation.html by double-clicking it from a fresh folder, with no
  dev server running and no network, and confirm every page renders, only one
  page is visible at a time, deep links work, and arrow keys work
```

---

## Rules of thumb

- **One phase per session, finished in one sitting.** Long sessions drift, and
  resuming an old one reprocesses the whole history uncached — the first turn
  back is the most expensive request of the phase.
- **Check the numbers.** When it gives you a worked example — crash timings,
  a coverage percentage, a frame budget, a distance calculation — do the
  arithmetic yourself. Confident prose with wrong figures in it is the
  characteristic failure, and it is invisible if you don't look.
- **Read the devlog yourself.** It's the honest record and it's where you'll
  actually learn what happened. The Explanation page is downstream of it.
- **If a phase's Explanation page reads smoothly but you couldn't defend a
  sentence of it under questioning, the page is wrong.** Send it back.
- **Never let it fix and report in the same breath.** Report first, then you
  decide what gets fixed.
- **Don't accept "should work".** Every acceptance criterion is either
  observed or asserted by a test. There is no third state.