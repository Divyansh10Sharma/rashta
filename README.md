# RASHTA

An original arcade motorcycle combat racer. Night races across Delhi, fourteen
riders, no rules. Inspired by the 90s point-to-point brawler-racers; not a
copy of any of them.

> **Note for Claude Code:** start with `CLAUDE.md`, then `docs/ROADMAP.md`.

---

## Play it

Three ways, easiest first.

**In a browser** — open the live link. Nothing to install.
`<deploy URL goes here in Phase 10>`

**Desktop app (Windows or macOS)** — download the installer from the releases
page, run it. Around 8 MB.
`<releases URL goes here in Phase 10>`

**From source** — needs [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone <repo-url>
cd rashta
npm install
npm run dev
```

Then open the URL it prints.

## Controls

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

All rebindable in Settings.

## Development

```bash
npm run dev          # dev server, hot reload
npm run build        # production web build → dist/
npm run preview      # serve the production build
npm run test         # unit tests
npm run check        # typecheck + lint + test — must pass to close a phase
npm run tauri dev    # desktop app, dev mode
npm run tauri build  # desktop installers
```

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

All code, art, audio, names, and design in this project are original. It takes
inspiration from a genre, not assets or trademarks from any specific game.
