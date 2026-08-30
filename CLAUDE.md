# RASHTA — project instructions

Read this file completely before doing anything. It is binding.

`rashta` is an original arcade motorcycle combat racer. It is inspired by the
1994 game Road Rash but it is **not** that game and must never contain that
game's names, trademarks, characters, bike names, track names, logos, or
assets. All bikes, racers, tracks, and branding in this project are original.
If you catch yourself typing a name you recognise from Road Rash, stop and
invent one.

The same rule applies to the real world. Real Delhi place names are geography
and are fine — Ring Road, the Yamuna, Chandni Chowk. Real *brands* are not.
No real motorcycle manufacturer or model name appears anywhere, in data files
or in prose. Vehicles are generic silhouettes in plausible livery colours,
with no wordmarks, logos, or reproduced liveries on any mesh or texture.

## Setting

Delhi, at night. Ring Road, Yamuna bank, DND flyway, the Ridge, Chandni Chowk
back lanes. Sodium-vapour streetlights, city buses, autos, stray dogs,
police motorcycles. This is the visual identity — do not default to
California.

## Stack (do not change without being asked)

| Concern        | Choice                           |
|----------------|----------------------------------|
| Language       | TypeScript, `strict: true`       |
| 3D             | Three.js                         |
| Bundler        | Vite                             |
| Tests          | Vitest                           |
| Lint / format  | ESLint + Prettier                |
| Desktop        | Tauri v2 (Windows + macOS)       |
| Web            | Static build, deployable to any static host |
| Runtime deps   | Keep minimal. Justify every new one in the phase devlog. |

No game engine, no React, no physics engine, no state-management library.
This game does not need them and every one of them costs load time.

## Hard architectural rules

These are not suggestions. Violating one is a bug, even if the game runs.

1. **`src/core/` must never import from `src/render/`, `src/input/`,
   `src/audio/`, or `three`.** Core is pure TypeScript. If you need a vector,
   write or use a tiny local one. This is what makes the simulation testable
   and deterministic.
2. **Everything positional lives in track space `(s, t)`** — `s` is metres
   travelled along the track centreline, `t` is metres left (negative) or
   right (positive) of it. World-space `x, y, z` is computed at render time
   only. See `docs/ARCHITECTURE.md`.
3. **Fixed timestep.** The simulation ticks at exactly 60 Hz with a constant
   `dt`. Rendering runs at display rate and interpolates between the last two
   sim states. Never advance the sim by a variable frame delta.
4. **The simulation is bit-exactly deterministic.** Same seed plus same input
   sequence produces the same result, every time, on every machine. All
   randomness goes through the seeded RNG in `src/core/rng.ts`. Never call
   `Math.random()` outside that file.

   This guarantee is achievable only because of a second, less obvious rule:
   **`step()` and everything it calls use no transcendental functions.** No
   `Math.sin`, `cos`, `tan`, `atan2`, `pow`, `exp`, or `log` inside the
   simulation. IEEE-754 makes `+ - * /` and `Math.sqrt` bit-identical on every
   conforming engine; the transcendentals are explicitly *not* specified to
   agree across engines or platforms, so a single `cos` in the sim downgrades
   the guarantee from "every machine" to "this machine, this browser build".
   Trigonometry belongs in two places only: track precompute at load time, and
   rendering. The sim reads precomputed tables and interpolates linearly.
   Nothing else in this file is enforceable by lint, so this rule is enforced
   by a replay test in `npm run check`.
5. **Data lives in JSON, not in code.** Tracks, bikes, racers, and tuning
   constants are data files in `src/data/`, validated on load. Do not hardcode
   a bike's top speed in a class.
6. **Every module in `src/core/` has a matching test file.** Core stays at or
   above 80% line coverage. `npm run check` must pass before a phase is done.

## Repository layout

```
rashta/
  CLAUDE.md              <- this file
  README.md              <- how to run and share it
  LICENSE                <- MIT
  Explanation.html       <- the explainer. See docs/EXPLANATION_SPEC.md
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  src/
    core/                pure logic, no Three.js, fully tested
      rng.ts
      types.ts
      track/
      sim/
      ai/
      combat/
      economy/
      reputation/
    render/              Three.js only. Reads core state, never mutates it.
    input/
    audio/
    ui/                  HUD and menus (plain DOM, no framework)
    app/                 bootstrap, game loop, screen flow
    data/                tracks/*.json, bikes.json, racers.json, tuning.json
  tests/
  docs/
    ARCHITECTURE.md
    ROADMAP.md
    GAME_DESIGN.md
    EXPLANATION_SPEC.md
    PROMPTS.md
    DEVLOG_GUIDE.md
    devlog/
      phase-00.md ... phase-11.md
  src-tauri/             added in Phase 10
```

## The phase workflow

Work is done in numbered phases, defined in `docs/ROADMAP.md`. Never start a
phase before the previous one's acceptance criteria all pass.

For each phase, in this order:

1. **Read** `docs/ROADMAP.md` for that phase, plus `docs/ARCHITECTURE.md` and
   the relevant part of `docs/GAME_DESIGN.md`.
2. **Open a devlog** at `docs/devlog/phase-NN.md` before writing any code.
   Keep it open as you work and append to it honestly as things happen:
   - what you tried
   - what broke, and the actual symptom you observed
   - what you changed and why
   - anything that surprised you
   This file is raw working notes. It is allowed to be messy.
3. **Build** the phase.
4. **Verify.** `npm run check` (typecheck + lint + test) must be clean, and
   every acceptance criterion in the roadmap must actually be demonstrated,
   not assumed.
5. **Update `Explanation.html`** — add the page for this phase, following
   `docs/EXPLANATION_SPEC.md` exactly, and rewrite the final "90 seconds"
   page to account for the new work.
6. **Report** to the user: what was built, what the acceptance criteria show,
   what you noted in the devlog, and what the next phase will need.

### The devlog rule (important)

`Explanation.html` requires a section on dead ends — approaches that were
tried and failed. **These must be real.** Pull them from the devlog. If a
phase genuinely had no dead ends, say so on the page in one honest line
rather than inventing plausible-sounding failures. A fabricated dead end is
worse than no dead end, because the whole point of that section is that it
survives a follow-up question from someone who knows the field.

## Code standards

- Named exports. No default exports except where a tool requires one.
- Files under ~250 lines. Split when a file grows past that.
- Functions do one thing; if a function needs a comment explaining its
  sections, it should be several functions.
- Comments explain **why**, never what. `// clamp to track width` is noise;
  `// riders can briefly ride the shoulder, but not past it — see GDD §4.2`
  is useful.
- Public functions and all exported types get a one-line doc comment.
- No `any`. No non-null assertions (`!`) except immediately after a checked
  guard. No `@ts-ignore` without an adjacent explanation.
- Errors on bad data are loud and early. Validate JSON on load and throw with
  the file name and field.
- Performance: the frame budget is 16.6 ms. No allocation inside the per-frame
  loop — preallocate and reuse. No `new Vector3()` inside `update()`.

## Commands

```
npm run dev       # local dev server with hot reload
npm run build     # production web build into dist/
npm run preview   # serve the production build locally
npm run test      # vitest
npm run check     # typecheck + lint + test — must pass to close a phase
npm run tauri dev # desktop app in dev mode (Phase 10 onward)
npm run tauri build
```

## Working economically

Context is resent in full on every tool call, so the cost of a phase is roughly
context size multiplied by number of turns. These four rules cut that without
cutting corners.

1. **Read narrowly.** Grep for the symbol, then read the range around it. Do
   not read a file over ~100 lines end to end unless you are about to rewrite
   it wholesale. If the range proves too small, widen it — guessing at what a
   file contains costs more than reading it did.
2. **Truncate output on success, never on failure.** `npm run check 2>&1 | tail -25`
   when you expect it to pass. The moment something fails, read the whole
   failure. A truncated stack trace costs far more than the tokens it saved.
3. **One phase per session.** Stop at each phase boundary and report. Do not
   carry a session across phases: a context full of abandoned hypotheses and
   stale diagnostics reasons worse than a fresh one reading a clean devlog.
   The devlog is what makes this handoff free — write it well enough that it is.
4. **Report short.** Ten lines: what was built, what the acceptance criteria
   measured, what the devlog records, what the next phase needs. The devlog
   holds the detail and the report should not repeat it.

None of this licenses thinking less about a hard problem, or deferring
verification to the end of a phase. Both cost more than they save. A wrong fix
confidently applied is the most expensive thing that can happen here.

## Scope discipline

Do only what the current phase asks. If you spot something worth doing that
belongs to a later phase, write it in the devlog under "deferred" and move on.
Do not add features, screens, settings, or abstractions that no phase has
asked for. A speculative abstraction written in Phase 2 for a need imagined in
Phase 8 is always the wrong shape by the time Phase 8 arrives.
