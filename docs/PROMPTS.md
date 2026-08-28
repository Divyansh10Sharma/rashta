# Prompts

Paste these into Claude Code, one at a time. This file is for you, not for
Claude — but Claude reading it is harmless.

## First time only

```
cd ~/projects
mkdir rashta && cd rashta
# copy CLAUDE.md, README.md and the docs/ folder in here first
claude
```

Then:

```
Read CLAUDE.md and everything in docs/. Don't write any code yet.

Tell me back, in your own words:
- the one architectural rule you think is most likely to get violated as this
  project grows, and how you'd notice
- anything in the docs that is ambiguous, contradictory, or that you'd push
  back on
- what you'd need to know before starting Phase 0

Then wait for me.
```

Answer whatever comes back, then start Phase 0.

## The per-phase prompt

Replace `NN` with the phase number. This is the whole workflow — use it
verbatim every time.

```
Start Phase NN.

1. Re-read docs/ROADMAP.md for Phase NN, plus docs/ARCHITECTURE.md and the
   relevant sections of docs/GAME_DESIGN.md.
2. Create docs/devlog/phase-NN.md before you write any code, and append to it
   honestly as you go — what you tried, what broke and the actual symptom,
   what you changed, what surprised you. Messy is fine. Truthful is required.
3. Build the phase. Nothing outside its scope. Anything you want to do that
   belongs to a later phase goes in the devlog under "deferred".
4. Run `npm run check` until it's clean, then demonstrate every acceptance
   criterion. Show me the evidence, don't assert it.
5. Update Explanation.html per docs/EXPLANATION_SPEC.md: add the Phase NN page
   with all seven sections in order, and rewrite the final "90 seconds" page
   from scratch.
6. Report back: what you built, the acceptance evidence, what's in the devlog,
   and what Phase NN+1 will need from this.

Two things I'll check specifically:
- The dead ends on the Explanation page must come from the devlog. If nothing
  genuinely failed this phase, say so in one honest line rather than inventing
  something.
- Every technical term on the new page must have a "Words to know" entry, with
  the plain meaning first and the precise meaning second.
```

## After Phase 2 specifically

Phase 2 has a subjective acceptance criterion. Do not let it pass on your say-so
alone — you have to actually ride it.

```
I've played it. Here's what's wrong with the feel:
<be specific — "it feels slow at 200km/h", "the camera makes corners
disorienting", "the bike turns like a boat">

Change one variable at a time, tell me what you changed and what you expected,
and log each attempt in the devlog. Don't change five things at once.
```

## When something goes sideways

```
Stop. Before you fix anything:
- What is the actual observed symptom, precisely?
- What are three different things that could cause it?
- Which is cheapest to rule out?

Rule that one out first and tell me the result. Don't start editing.
```

## Weekly, once you're a few phases in

```
Audit the repo against CLAUDE.md's hard architectural rules. For each one,
show me either the evidence it holds or the specific place it's been broken.
Check especially:
- does anything in src/core/ import from three, render, input, or audio?
- is there a Math.random() call outside src/core/rng.ts?
- is anything allocating inside a per-frame update?
- does any file exceed 250 lines?
- is any positional state stored in world space?

Report first. Fix only what I tell you to.
```

## Before you show it to anyone

```
Do a shareability pass:
- npm run build, then confirm the dist/ bundle size and load time
- build the Tauri apps for Windows and macOS
- reread README.md as if you'd never seen this project, and fix anything a
  non-developer would get stuck on
- open Explanation.html by double-clicking it from a fresh folder, with no
  dev server running, and confirm every page renders and every link works
  with no network connection
```

## Rules of thumb

- One phase per session. Start a fresh Claude Code session for each — long
  sessions drift.
- Read the devlog yourself. It's the honest record and it's where you'll
  actually learn what happened.
- If a phase's Explanation page reads smoothly and confidently but you
  couldn't defend a single sentence of it under questioning, the page is
  wrong. Send it back.
- Resist the urge to skip ahead to combat. Phase 2 is the phase that decides
  whether this game is any good.
