# Roadmap

Eleven phases. Each one ends with a working, runnable thing and a new page in
`Explanation.html`. Do not start a phase until the previous phase's acceptance
criteria all demonstrably pass.

"Demonstrably" means you ran it and observed it, or a test asserts it. Not
"the code looks correct".

## Standing criteria — every phase, from Phase 0 onward

These are in force for every phase below, in addition to that phase's own
list. A phase does not close unless all four hold.

1. **`npm run check` passes with zero warnings.**
2. **Production JS stays under 500 KB gzipped.** Checked by a script in
   `check`, so the number is measured and not estimated. This budget does not
   grow as the game does; if a phase needs more, that is a conversation, not a
   default.
3. **Coverage thresholds are enforced and fail the build.** 80% lines on
   `src/core/**`, 100% lines on `src/core/track/**`.
4. **Every frame-rate figure is measured under 4x CPU throttling** in Chrome
   DevTools, never on raw hardware — the dev machine is fast enough to hold 60
   fps on bad code, which makes an unthrottled figure worthless as a signal.
   Record the throttled number in the devlog every time, and say it is
   throttled.

---

## Phase 0 — Skeleton

Set up a project that builds, tests, lints, and runs in a browser, with
nothing in it but an empty lit scene. Web only — no Tauri and no Rust
toolchain until Phase 10.

**Build**
- Vite + TypeScript with `strict: true` and `noUncheckedIndexedAccess: true`.
- ESLint (including a rule banning `Math.random` outside `src/core/rng.ts`)
  and Prettier.
- Vitest with coverage thresholds that fail the build, not just report:
  80% lines on `src/core/**`, 100% on `src/core/track/**`.
- The folder structure from `CLAUDE.md`, with `.gitkeep` where empty.
- `npm run check` wired to typecheck + lint + test.
- A Three.js scene: ground plane, directional light, ambient light, a camera,
  and a frame counter in the corner.
- `README.md` covering: how to run it, how to build it, how to share it.
- A GitHub Actions workflow that runs `npm run check` and builds the web bundle.

**Acceptance**
- `npm run dev` opens a browser showing a lit plane at a stable 60 fps under
  4x CPU throttling.
- `npm run build` produces `dist/` and `npm run preview` serves it.
- The standing criteria above all hold.

---

## Phase 1 — Track space (no graphics at all)

The mathematical core. Deliberately headless — if this is wrong, everything
built on it is wrong, and you will not find out by looking at a screen.

**Build**
- `src/core/types.ts`, `src/core/rng.ts`, `src/core/vec.ts` (a minimal Vec3).
- `src/core/track/Track.ts`: load segments, precompute cumulative start
  frames, `sample(s, out)` filling a caller-owned frame and allocating
  nothing, `widthAt(s)`, `lanesAt(s)`, `totalLength`. Trigonometry runs at
  load time only; `sample` interpolates the precomputed table.
- `trackDistance(a, b, track)` per `ARCHITECTURE.md` §1.4 — the curvature
  correction, trig-free so it is legal inside `step()`.
- Fork support per `ARCHITECTURE.md` §1.2, including `progress(entity)`
  mapping `(branchId, s)` to a branch-independent monotone scalar, kept
  distinct from `s`.
- JSON schema + loader with validation that throws on bad data, naming the
  offending file and field. Including the degenerate-corner rule: reject any
  segment with `curvature != 0` and `halfWidth + shoulder >= 1/abs(curvature)`.
- One hand-written test track with a straight, a left, a right, a hill, a
  banked curve, and a fork.

**Acceptance**
- Tests prove: sampling a pure straight gives a straight line; sampling a
  constant-curvature arc of radius R over length L rotates heading by exactly
  L/R; elevation integrates correctly; sampling at a segment boundary from
  either side agrees to within 1e-9.
- A property test: for 10,000 random `s`, `sample(s)` and
  `sample(s + 0.001)` are within 0.002 of each other — the spline is
  continuous with no seams.
- `trackDistance` agrees with the exact chord to within 0.1% across the full
  road width on the tightest corner in the test track, and both branches of
  the test fork rejoin at equal `progress`.
- `sample()` allocates nothing: calling it 10,000 times does not grow the
  frame object it was handed.
- Track validation rejects a deliberately degenerate segment, and the thrown
  error names the file and the segment index.
- 100% line coverage on `track/`.
- Still zero Three.js imports in `src/core/`, and no transcendental call
  reachable from `step()` — asserted, not assumed.

---

## Phase 2 — The feel gate

An endless straight road, one bike, a chase camera. This phase is not about
features. It is about whether riding is fun before anything is at stake.

**Build**
- `src/core/sim/Bike.ts`: the arcade model from `ARCHITECTURE.md` §3.
- Fixed-timestep loop with render interpolation.
- `src/input/`: keyboard and gamepad, with rebindable actions.
- `src/render/RoadMeshBuilder.ts`: chunked road geometry from track segments.
- `src/render/ChaseCamera.ts`: FOV widening with speed, drop and pull-back,
  lateral lag.
- Roadside scenery pool: streetlights, poles, kerbs.
- A HUD with speed and a tachometer.
- A dev overlay: current `s`, `t`, speed, fps, sim step time.

**Acceptance**
- Holding throttle on a straight reaches the bike's `topSpeed` in its
  `timeToTopSpeed`, within 5%, for every bike in the data file.
- Frame rate holds 60 fps with 400 scenery objects visible, under 4x CPU
  throttling.
- Sim step costs under 1 ms.
- The bike's position is bit-identical after replaying a recorded input
  sequence twice from the same seed, and identical again when the same
  sequence is replayed under a jittered wall clock.
- **The subjective gate:** riding in a straight line with nothing happening is
  already enjoyable. If it isn't, do not proceed. Tune, and say in the devlog
  what you changed and what it did.

---

## Phase 3 — Real tracks

**Build**
- Five original Delhi-set tracks, five tiers each, per `GAME_DESIGN.md`.
- Tier extension (tier N = tier N−1 plus appended segments).
- Fork rendering and route selection.
- Per-scenery-tag environment: skybox, fog, lighting, road material,
  roadside object sets.
- Chunk culling and a simple LOD for distant scenery.

**Acceptance**
- All 25 tier-tracks load, validate, and are rideable end to end.
- Track load takes under 200 ms.
- Both branches of every fork are traversable and rejoin at equal
  `progress`, and their lengths differ by no more than 5% — checked by a test
  over all 25 tracks, per `GAME_DESIGN.md`.
- 60 fps maintained on the densest track, under 4x CPU throttling.

---

## Phase 4 — Traffic and hazards

**Build**
- Traffic entities in track space: cars, autos, DTC buses, trucks. Lane
  assignment, direction, speed profiles, occasional lane changes.
- A spawn ring: populate ahead of the player, recycle behind.
- Hazards: oil slicks, potholes, road works, barricades, stray dogs, cows.
- Collision resolution: rider-vs-traffic, rider-vs-hazard, rider-vs-cliff.
- Crash sequence: rider thrown, bike slides, remount with a time penalty.

**Acceptance**
- Traffic density is a per-tier data value and observably changes with tier.
- No two traffic entities are ever closer than their combined footprint,
  measured with `trackDistance`, not with a raw `(s, t)` box.
- Crash and remount round-trips reliably from every crash cause.
- Entity count stays bounded — memory flat over a ten-minute ride.

---

## Phase 5 — Racers and the race loop

**Build**
- `src/core/ai/`: rival riders with per-racer skill, aggression, caution, and
  preferred lane. Target-`t` steering, overtaking, traffic avoidance.
- Mild rubber-banding, tunable, off by default in the data file.
- Race state machine: countdown, racing, finished, failed.
- Live position tracking sorted by `progress`, never raw `s`, so standings
  stay correct while riders are on different fork branches. Lap-free
  point-to-point finish, results screen.
- 13 rivals, matching `GAME_DESIGN.md`.

**Acceptance**
- A full race runs start to finish with 14 riders at 60 fps, under 4x CPU
  throttling.
- AI riders complete every track without getting stuck, on every tier — prove
  it with a headless test that simulates all 25 tracks to completion.
- Finishing order is deterministic for a given seed, and standings are
  correct mid-fork with riders split across both branches.
- The player starts last and finishing top three is achievable but not easy.

---

## Phase 6 — Combat

**Build**
- Attack states: punch, kick, backhand. Windup, active, recovery frames.
- Range check in track space; damage, stagger, knockdown.
- Stamina bars for the player and the nearest engaged rival.
- Weapons: pipe, chain, cricket bat. Pick up from a downed rider, or steal by
  landing a hit on an armed one.
- Getting hit: stagger, loss of line, possible crash.

**Acceptance**
- Every attack connects only within its stated range in **metres**, measured
  with `trackDistance`, proven by unit test on a tight corner as well as a
  straight — a range check that passes only on a straight is not passing.
- Knockdown, weapon drop, and weapon steal all work and are testable headless.
- Combat is legible on screen — you can always tell who is hitting whom.
- Frame budget unchanged, measured under 4x CPU throttling.

---

## Phase 7 — Police

**Build**
- Police riders as a distinct AI type: pursue, ram, block.
- Arrest: crashing within a `trackDistance` radius of an officer triggers a
  bust.
- Fines, and the consequence of not being able to pay.
- Bike damage accumulating across a race; wreck state and repair cost.

**Acceptance**
- Police presence scales with tier from the data file.
- Arrest, fine, and wreck each produce the right money change and the right
  end-of-race screen.
- Escaping pursuit is possible and feels earned.

---

## Phase 8 — The art pass

Everything so far is untextured primitives in flat colours. That was the right
trade while the simulation was being proven, and it is not what ships. This
phase makes the game look like the thing it is: Delhi, at night, at speed.

Constraints that do not move: no new runtime dependencies, the 500 KB gzipped
bundle budget, `src/core/` untouched (this is a render-layer phase and the
simulation must not notice it happened), and no real manufacturer's marks on
any mesh or texture.

**Build**
- Bikes rebuilt as real silhouettes: fairing, forks, spoked wheels, exhaust,
  a rider who leans off rather than a box that tilts. Three visually distinct
  classes matching the three bike classes.
- Traffic rebuilt: an auto with its canopy and three wheels, a bus with window
  bands and a roof rack, a truck with a cab and a bed. Silhouette first — you
  should know what is in front of you from its outline alone.
- Procedural textures generated at load: asphalt, lane markings, kerbs,
  concrete, dust. Generated into canvases in code rather than shipped as image
  files, so the bundle cost is the generator and not the pixels.
- Materials that read under sodium light: roughness and metalness per surface,
  emissive lamps and signage, wet-road variation on the Yamuna bank.
- Particles: crash sparks, tyre smoke under braking, dust off the shoulder,
  an impact flash on a landed hit, exhaust haze on the autos.
- Damage shown on the bike as it accumulates, so the repair bill is legible
  before the results screen says it.
- A quality setting that turns particles and texture resolution down, wired to
  the same place Phase 11's settings screen will read from.

**Acceptance**
- **60 fps under 4x CPU throttling, measured in Chrome DevTools with the
  figure written into the devlog.** This has been open since Phase 2 and this
  is the phase that closes it — an art pass that cannot hold frame rate is not
  an art pass, it is a regression.
- Bundle stays inside the 500 KB gzipped budget, with the number recorded.
- `src/core/` has no new imports and the determinism replay test still passes
  unchanged — the simulation must not be able to tell this phase happened.
- Every vehicle is identifiable by silhouette alone, in a screenshot with
  colour removed.
- No wordmarks, logos or reproduced liveries on any mesh or texture.

---

## Phase 9 — Career

**Build**
- Money, prize tables per tier and finishing position.
- Bike shop: three classes, fifteen original bikes, trade-in pricing.
- Progression: finish top three on all five tracks to unlock the next tier.
- Menus: garage, shop, track select, results — plain DOM, no framework.
- Save and load with schema versioning.
- Quick Race mode alongside Career.

**Acceptance**
- A full career from tier 1 to tier 5 is completable.
- Economy is balanced: the player can afford a class-appropriate bike at each
  tier without grinding more than about two repeat races.
- Save survives a browser refresh and an app restart, and a version bump
  migrates cleanly.

---

## Phase 10 — Reputation

**Build**
- A relationship graph across all 14 racers: ally, neutral, enemy, with a
  numeric standing per pair.
- Standing shifts from in-race behaviour: hitting someone, hitting their
  ally, taking hits without retaliating.
- Standing changes AI behaviour: allies block rivals for you, enemies gang up.
- A between-races social screen where allies pass tips and enemies posture.

**Acceptance**
- Standing changes are visible in AI behaviour within the next race, and this
  is provable in a headless test.
- The graph saves and loads.
- Two careers played with opposite social strategies produce measurably
  different race dynamics.

---

## Phase 11 — Ship it

**Build**
- Audio: engine with RPM-mapped pitch, wind, impacts, ambience, music hooks.
- Settings: graphics quality, audio, controls, accessibility (reduced motion,
  colourblind-safe HUD, remappable everything).
- Tauri v2 wrappers for Windows and macOS.
- Web deploy: hashed assets, compression, a loading screen.
- Performance pass and a memory-leak soak test.
- `README.md` finalised with three install paths.

**Acceptance**
- Signed-or-not installers build for Windows and macOS from one command.
- Web build loads to playable in under 5 seconds on a mid-range connection,
  simulated with DevTools network throttling.
- A 30-minute soak shows flat memory and holds frame rate under 4x CPU
  throttling.
- A person with no dev tools can install and play from the README alone.
