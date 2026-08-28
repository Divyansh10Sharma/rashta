# Phase 00 — Skeleton

Goal: a project that builds, tests, lints, and runs in a browser, containing
nothing but an empty lit scene. Web only — no Tauri until Phase 10.

Opened before writing any code.

## Plan

- Vite + TS (`strict`, `noUncheckedIndexedAccess`)
- ESLint flat config + Prettier
- Vitest + v8 coverage, thresholds that fail the build
- Folder structure from CLAUDE.md, `.gitkeep` in the empty ones
- `npm run check` = typecheck + lint + test + bundle size
- Three.js scene: ground plane, directional + ambient light, camera, frame counter
- MIT LICENSE, README, GitHub Actions workflow

## Open questions going in

1. **Coverage thresholds with no code to cover.** The standing criteria say
   80% on `src/core/**` and 100% on `src/core/track/**`, failing the build.
   But Phase 0 puts nothing in `src/core/` — `rng.ts`, `types.ts`, and
   `vec.ts` are Phase 1 deliverables. What does Vitest do with a glob
   threshold that matches zero files? Find out rather than guess. If it errors,
   the options are to defer the thresholds to Phase 1 or configure them now in
   a form that tolerates an empty glob. Do not fix it by writing Phase 1 code
   early.
2. **Vitest needs at least one test file** or it exits non-zero. Phase 0 has
   no simulation to test. The frame counter is genuine Phase 0 scope and its
   rolling-average maths is pure, so that is the honest thing to test.
3. **CRLF.** Git warned on every file in both commits so far. Prettier will
   normalise to LF and git will convert to CRLF on checkout, and they will
   disagree forever. Wants a `.gitattributes`.

## Attempt log

### Attempt 1 — Vite 5 + Vitest 2, as first pinned

Tried: pinned `vite@^5.4`, `vitest@^2.1`, `@vitest/coverage-v8@^2.1`.

Observed: `npm install` reported **6 vulnerabilities (3 moderate, 1 high, 2
critical)**. All six traced to a single root: `esbuild <=0.24.2`, reachable
through `vite` -> `vite-node` -> `@vitest/mocker` -> `vitest` ->
`@vitest/coverage-v8`. The advisory (GHSA-67mh-4wv8-2f99) is a dev-server
issue — any website can send requests to the dev server and read the response.

Why it failed: not a code problem, a starting-point problem. There is nothing
in a two-commit-old repository worth pinning an old major for. Upgraded to
`vite@8.2.2` and `vitest@4.1.11`; `eslint-config-prettier` went 9 -> 10 in the
same pass. `npm audit` now reports 0 vulnerabilities. Node 20.19.6 is new
enough for Vite 8.

Worth noting for later: the exposure was dev-only and would never have
shipped, but "it doesn't ship" is a bad reason to run a knowingly vulnerable
dev server for ten phases.

### Attempt 2 — `disableTypeChecked` spread with a `rules` key after it

Tried:

```js
{ files: [...], ...tseslint.configs.disableTypeChecked, rules: { 'no-console': 'off' } }
```

Observed: `Error while loading rule '@typescript-eslint/await-thenable': You
have used a rule which requires type information ... Occurred while linting
scripts/check-bundle-size.mjs`.

Why it failed: obvious in hindsight and invisible while typing it. The spread
sets `rules` to disableTypeChecked's ~50 opt-outs, and then my own `rules:`
key immediately **replaces** that whole object rather than merging into it. So
every typed rule came back on, for a `.mjs` file with no type information.
Fix: `rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' }`.

Two follow-on errors from the same file once that was fixed: `eslint.config.js`
"was not found by the project service" (it is outside tsconfig's `include`),
and `'console' is not defined` / `'process' is not defined` in the `.mjs`
script. Fixed with `projectService.allowDefaultProject` and by declaring the
two Node globals by hand rather than adding the `globals` package for two
names.

### Attempt 3 — narrowing across a hoisted function declaration

Tried: query `#stage` and `#fps` at module scope, guard both with one
`if (!canvas || !readout) throw`, then use `readout` inside a
`function frame()`.

Observed: `src/app/main.ts(28,5): error TS18047: 'readout' is possibly 'null'.`

Why it failed: the guard narrows at module scope, but the narrowing does not
follow into a hoisted function declaration — TypeScript cannot prove the
function is not called before the guard runs. The tempting fix is `readout!`,
which CLAUDE.md bans outright. Restructured instead: `run(canvas, readout)`
takes both as non-nullable parameters and the guard sits at the call site.
Better code than the version that provoked the error, which is usually the
sign the compiler was right.

### Attempt 4 — a test guarding a bug that cannot happen

Tried: a test named "sorts numerically, not lexicographically, for the
percentile", feeding 95 samples of 9 ms and 5 of 100 ms, expecting
`p95 === 100`.

Observed: `AssertionError: expected 9 to be 100`.

Why it failed: **two** wrong assumptions in one test, and the code was right
both times.

1. The window is a `Float64Array`, and `TypedArray.prototype.sort()` is
   numeric by default. The lexicographic trap I was guarding against only
   exists for `Array.prototype.sort()`. The test could not have caught
   anything.
2. The expectation was wrong anyway. By nearest-rank, with exactly 95 of 100
   samples at 9 ms, the 95th-percentile value *is* 9 ms. Rank 95 is the last
   fast frame.

Replaced with two honest tests: one that a 10% slow tail does show up in p95
(90 samples at 9 ms plus 10 at 100 ms gives p95 = 100 ms), and one pinning the
nearest-rank boundary explicitly, with a comment saying it is deliberate, so a
future "off-by-one fix" has to argue with a test.

This is the one I would have got wrong quietly if the test had passed.

### Attempt 5 — Prettier over the docs

Tried: `prettier --check .` across everything, docs included.

Observed: 11 files flagged, including all of `docs/`. Inspecting the diff for
`GAME_DESIGN.md` alone: 95 changed lines, all of it padding markdown table
cells to equal width and re-aligning the trailing comments inside the fenced
`interface Bike` block.

Why it failed: the docs are hand-wrapped prose deliverables written by a
person, and the `Bike` interface comments are aligned deliberately to make the
authority split readable. Prettier's markdown pass buys nothing here and
actively fights that. Added `*.md` to `.prettierignore` with the reason. Code,
CSS, JSON, and HTML are still formatted.

## Answers to the open questions

**1. Coverage thresholds on an empty glob are vacuous — they pass silently.**
With `src/core/` containing only `.gitkeep`, the report prints
`All files 0 | 0 | 0 | 0`, the summary says `Unknown% ( 0/0 )`, and
`npm run check` exits 0. So the gate is configured but inert until Phase 1
puts a file in `src/core/`. That is acceptable, but "configured" is not
"working", so I proved it fires rather than assuming it:

- Probe file in `src/core/` with 1 of 5 functions covered ->
  `ERROR: Coverage for lines (20%) does not meet "src/core/**/*.ts" threshold
  (80%)`, exit code 1.
- Probe in `src/core/track/` at 50% -> **both** errors fired independently,
  the 80% core rule and the 100% track rule, correctly scoped.

Both probes deleted afterwards. No Phase 1 code was written to make the gate
work.

**2. Vitest needs a test file.** Tested `src/ui/FrameMeter.ts`, which is
genuine Phase 0 scope — the roadmap asks for "a frame counter in the corner",
and its ring buffer and percentile maths are pure and worth pinning. 10 tests.
Coverage thresholds do not apply to it; only `src/core/**` is held to a bar.

**3. CRLF.** Added `.gitattributes` with `* text=auto eol=lf` plus binary
rules. The warnings stop and Prettier's `endOfLine: lf` no longer disagrees
with what git checks out.

## Surprises

- The gzipped bundle is **117.0 KB, 23.4% of the 500 KB budget**, for a full
  Three.js scene. I expected to be nearer half. Note the raw figure is 483 KB
  — the budget is gzipped, and the roughly 4:1 ratio on this kind of code is
  the whole reason the criterion is written that way.
- Vite's own "computing gzip size" line reports 120.81 KB against my script's
  117.0 KB. Different compression levels, not a bug. Mentioning it so nobody
  spends an afternoon on it later.
- `Float64Array.prototype.sort()` being numeric while `Array.prototype.sort()`
  is lexicographic is the kind of asymmetry that is obvious once you have been
  bitten and invisible until then. See Attempt 4.

## Deliberate additions beyond the phase's Build list

Small, and flagged rather than smuggled:

- **ESLint `no-restricted-imports` enforcing CLAUDE.md rule 1** (core may not
  import `three`, render, input, audio, or ui). The roadmap only asks for the
  `Math.random` ban. This is ten lines in a lint config Phase 0 already owns,
  and rule 1 is the rule most worth making mechanically impossible to break
  from the first commit rather than the fiftieth.
- **`.gitattributes`** — not in the Build list, but git warned on every file in
  both prior commits.
- **Extra `tsconfig` strictness** beyond the two flags named:
  `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
  `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`. Cheap now, painful to turn on in Phase 6.

## Deferred

- **The no-transcendentals-in-`step()` rule has no enforcement yet.** There is
  no `step()` and no `src/core/sim/` to point a rule at. Phase 1 or 2 needs a
  lint rule or a test that walks the call graph from `step()` and fails on
  `Math.sin|cos|tan|atan2|pow|exp|log`. Written down here so it does not get
  lost — it is the guard for the rule that is hardest to notice breaking.
- **The replay determinism test** (CLAUDE.md rule 4) likewise has nothing to
  replay yet. Phase 2.
- **Frame-rate figures under 4x throttle** need a human with DevTools; the
  instrumentation is in place (`FrameMeter` reports fps, mean, p95, worst, and
  a count of frames over 16.6 ms) but the throttled reading is not mine to
  take.
- **CI is unverified.** The workflow is written and targets `main`, but there
  is no remote yet, so it has never run. To be confirmed once the GitHub repo
  exists. *(Resolved — see below.)*

## CI — now verified

Resolved the deferral above. Remote is
`https://github.com/Divyansh10Sharma/rashta.git`, pushed at commit `65417bb`.

I could not push it myself: the credential manager on this machine is
authenticated as GitHub user `DivyanshTR`, and the repository belongs to
`Divyansh10Sharma`, so `git push` returned
`403 — Permission to Divyansh10Sharma/rashta.git denied to DivyanshTR`.
Divyansh pushed it. Noting it because the same mismatch will recur every
phase unless the credential is changed.

Run #1 of the `check` workflow on `65417bb`: **success**. Every step passed —
checkout, `setup-node` at 20, `npm ci`, `npm run check`, artifact upload.

Worth more than it looks. The local check runs against an incrementally-built
`node_modules` on Windows; CI ran a clean `npm ci` on Ubuntu with no cached
state. So the phase is now known to build from nothing on a second operating
system, which is the actual claim "it builds" is supposed to mean.

Still outstanding from Phase 0, and only this: the 60 fps reading under 4x CPU
throttling, which needs a human with DevTools.
