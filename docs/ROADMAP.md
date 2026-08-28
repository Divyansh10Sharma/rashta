# Roadmap

Eleven phases. Each one ends with a working, runnable thing and a new page in
`Explanation.html`. Do not start a phase until the previous phase's acceptance
criteria all demonstrably pass.

"Demonstrably" means you ran it and observed it, or a test asserts it. Not
"the code looks correct".

---

## Phase 0 — Skeleton

Set up a project that builds, tests, lints, and runs on web and desktop, with
nothing in it but an empty lit scene.

**Build**
- Vite + TypeScript with `strict: true` and `noUncheckedIndexedAccess: true`.
- ESLint (including a rule banning `Math.random` outside `src/core/rng.ts`)
  and Prettier.
- Vitest with coverage reporting.
- The folder structure from `CLAUDE.md`, with `.gitkeep` where empty.
- `npm run check` wired to typecheck + lint + test.
- A Three.js scene: ground plane, directional light, ambient light, a camera,
  and a frame counter in the corner.
- `README.md` covering: how to run it, how to build it, how to share it.
- A GitHub Actions workflow that runs `npm run check` and builds the web bundle.

**Acceptance**
- `npm run dev` opens a browser showing a lit plane at a stable 60 fps.
- `npm run build` produces `dist/` and `npm run preview` serves it.
- `npm run check` passes with zero warnings.
- Total production JS under 500 KB gzipped.

---

## Phase 1 — Track space (no graphics at all)

The mathematical core. Deliberately headless — if this is wrong, everything
built on it is wrong, and you will not find out by looking at a screen.

**Build**
- `src/core/types.ts`, `src/core/rng.ts`, `src/core/vec.ts` (a minimal Vec3).
- `src/core/track/Track.ts`: load segments, precompute cumulative start
  frames, `sample(s)`, `widthAt(s)`, `lanesAt(s)`, `totalLength`.
- Fork support per `ARCHITECTURE.md` §1.2.
- JSON schema + loader with validation that throws on bad data, naming the
  offending file and field.
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
- 100% line coverage on `track/`.
- Still zero Three.js imports in `src/core/`.

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
- Holding throttle on a straight reaches the bike's top speed in the time the
  data file says it should, within 5%.
- Frame rate holds 60 fps with 400 scenery objects visible.
- Sim step costs under 1 ms.
- The bike's position is identical after replaying a recorded input sequence
  twice from the same seed.
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
- Both branches of every fork are traversable and rejoin correctly.
- 60 fps maintained on the densest track.

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
- No traffic entity ever occupies the same `(s, t)` cell as another.
- Crash and remount round-trips reliably from every crash cause.
- Entity count stays bounded — memory flat over a ten-minute ride.

---

## Phase 5 — Racers and the race loop

**Build**
- `src/core/ai/`: rival riders with per-racer skill, aggression, caution, and
  preferred lane. Target-`t` steering, overtaking, traffic avoidance.
- Mild rubber-banding, tunable, off by default in the data file.
- Race state machine: countdown, racing, finished, failed.
- Live position tracking, lap-free point-to-point finish, results screen.
- 13 rivals, matching `GAME_DESIGN.md`.

**Acceptance**
- A full race runs start to finish with 14 riders at 60 fps.
- AI riders complete every track without getting stuck, on every tier — prove
  it with a headless test that simulates all 25 tracks to completion.
- Finishing order is deterministic for a given seed.
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
- Every attack connects only within its stated range, proven by unit test.
- Knockdown, weapon drop, and weapon steal all work and are testable headless.
- Combat is legible on screen — you can always tell who is hitting whom.
- Frame budget unchanged.

---

## Phase 7 — Police

**Build**
- Police riders as a distinct AI type: pursue, ram, block.
- Arrest: crashing within a radius of an officer triggers a bust.
- Fines, and the consequence of not being able to pay.
- Bike damage accumulating across a race; wreck state and repair cost.

**Acceptance**
- Police presence scales with tier from the data file.
- Arrest, fine, and wreck each produce the right money change and the right
  end-of-race screen.
- Escaping pursuit is possible and feels earned.

---

## Phase 8 — Career

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

## Phase 9 — Reputation

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

## Phase 10 — Ship it

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
- Web build loads to playable in under 5 seconds on a mid-range connection.
- A 30-minute soak shows flat memory.
- A person with no dev tools can install and play from the README alone.
