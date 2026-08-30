# RASHTA

An original arcade motorcycle combat racer. Night races across Delhi, fourteen
riders, no rules. Inspired by the 90s point-to-point brawler-racers; not a
copy of any of them.

> **Note for Claude Code:** start with `CLAUDE.md`, then `docs/ROADMAP.md`.

**Status: Phase 0 of 10.** The project builds, tests, lints, and renders a lit
scene. There is no game in it yet — no bike, no track, no racing. The roadmap
in `docs/ROADMAP.md` says what arrives when.

---

## Play it

Nothing to play yet. When there is, there will be two ways, easiest first.

**In a browser** — open the live link. Nothing to install, and it works
offline once it has loaded.
`<deploy URL goes here in Phase 11>`

**From source** — see below. This one works today.

## Run it from source

Needs [Node.js](https://nodejs.org) 20 or newer. Check with `node --version`.

```bash
git clone <repo-url>
cd rashta
npm install
npm run dev
```

Then open the URL it prints — usually <http://localhost:5173>. You should see a
dark ground plane lit sodium-orange, with frame timings in the top-left corner.

To build the version you would actually deploy:

```bash
npm run build     # production web build into dist/
npm run preview   # serve that build locally, to check it before shipping
```

`dist/` is a plain folder of static files. It needs no server-side anything and
can be dropped on any static host.

## Controls

Not wired up yet — input arrives in Phase 2. The intended scheme:

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle | ↑ / W | Right trigger |
| Brake | ↓ / S | Left trigger |
| Lean left | ← / A | Left stick |
| Lean right | → / D | Left stick |
| Punch | J | X / Square |
| Kick | K | B / Circle |
| Backhand | L | Y / Triangle |
| Nitro | Shift | A / Cross |

All rebindable in Settings, from Phase 2.

## Development

```bash
npm run dev          # dev server, hot reload
npm run build        # production web build → dist/
npm run preview      # serve the production build
npm run test         # vitest, watch mode
npm run test:run     # vitest once, with coverage
npm run typecheck    # tsc --noEmit
npm run lint         # eslint + prettier --check
npm run format       # prettier --write
npm run size         # build, then check the gzipped bundle budget
npm run check        # all of the above that matter — must pass to close a phase
```

`npm run check` is the gate. It runs typecheck, lint, tests with coverage
thresholds, and the bundle-size budget, and any one of them failing fails the
whole thing. CI runs exactly the same command, so a green local check means a
green build.

Two rules it enforces that are easy to trip over:

- **Coverage.** `src/core/**` must hold 80% lines, `src/core/track/**` must
  hold 100%. These fail the build, they do not warn.
- **Bundle size.** Production JS must stay under 500 KB gzipped. Currently
  117 KB. The budget does not grow as the game does.

Measure frame rate under **4x CPU throttling** in Chrome DevTools, never on raw
hardware — a fast machine will hold 60 fps on bad code and tell you nothing.

## How the project is organised

- `src/core/` — the simulation. Pure TypeScript, no Three.js, fully tested.
  Positions live in track space, not world space.
- `src/render/` — everything Three.js. Reads the simulation, never writes to it.
- `src/data/` — tracks, bikes, riders, and tuning, as JSON.
- `docs/` — architecture, roadmap, game design, and the working devlog.
- `Explanation.html` — a paginated walkthrough of how every phase was built,
  written for a non-specialist. Open it in a browser; it needs no server and
  no internet.

`docs/ARCHITECTURE.md` explains the track-space model, which is the idea the
whole codebase is built on. Read that before reading any code.

## Licence and attribution

MIT — see `LICENSE`.

All code, art, audio, names, and design in this project are original. It takes
inspiration from a genre, not assets or trademarks from any specific game. Real
Delhi place names are geography; real brands are not used anywhere.
