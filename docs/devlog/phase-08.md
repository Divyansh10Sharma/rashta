# Phase 8 — The art pass

Raw working notes. Messy on purpose.

## Where this phase came from

It is not in the original roadmap. Seven phases in, the game was asked to be
looked at rather than reasoned about, and the honest answer was that everything
on screen is untextured primitives: twelve calls to `BoxGeometry` and
`CylinderGeometry`, zero texture loaders, zero model loaders. A bus is a box. A
cow is a box. The bike is four boxes and two cylinders.

That was the right trade while the simulation was being proven — none of the
previous seven phases would have gone better with prettier boxes — and it is
not what ships. So: a new Phase 8, and Career, Reputation and Ship it move to
9, 10 and 11. Nothing was committed for those yet, so the renumbering cost
nothing.

## The question I got wrong first, and had to correct out loud

Asked how to build the assets, I offered three routes and framed one of them as
"modelled assets have a higher fidelity ceiling". That framing was wrong and I
corrected it before writing any code.

**The file format does not set the fidelity ceiling. Whoever authors the models
does.** If I generate `.glb` files with a script, they contain exactly the
shapes my code would have built at runtime, except now they cost one to four
megabytes of bundle instead of a few kilobytes of generator. That is strictly
worse, and shipping it while calling it "modelled assets" would have been a lie
told with a straight face.

What actually raises the ceiling is a person with Blender, or a marketplace
licence. What I can raise on my own is how good the procedural geometry is,
which is considerable and is not nothing.

So the phase does both, and the split is honest:

- **The loading path is real.** A manifest, async GLTF loading, a loading
  screen, per-vehicle overrides, graceful fallback when a file is absent. Drop
  a `.glb` in and it is used.
- **The procedural geometry is the shipped default,** and it gets the serious
  upgrade — silhouettes you can identify with the colour removed.

Which means the game looks much better today with no assets at all, and looks
however good the assets are the moment there are any.

## Decisions taken before writing anything

### 1. `src/core/` must not be able to tell this phase happened

This is a render-layer phase. The acceptance criteria say the determinism
replay test passes unchanged and core gains no imports. If an art pass changes
a single simulation number, it has stopped being an art pass.

The one thing that tempts a violation is damage: showing a bent bike needs
`rider.damage`, which already exists and is already simulation state. Reading
it is fine. Anything that wants a *new* simulation field for a visual reason
does not get one.

### 2. Textures are generated, not shipped

Asphalt, lane markings, kerbs, concrete, dust — all drawn into a canvas at load
and uploaded as a texture. The bundle cost is the generator, not the pixels,
which keeps the 500 KB budget intact and keeps the repository free of binary
files nobody can diff.

This is also the only way to get five districts that genuinely differ without
five sets of images.

### 3. Silhouette before detail

The acceptance criterion I care most about: every vehicle identifiable from its
outline alone, colour removed. At sixty miles an hour under sodium light you do
not read a texture, you read a shape. An auto's canopy and three wheels, a
bus's height and window band, a truck's cab-and-bed step — those are what tell
you what is about to be in front of you.

Detail that does not change the silhouette is the last thing to add, not the
first.

### 4. The 4x throttled frame rate gets measured this phase

It has been open since Phase 2 and I have flagged it every phase since without
producing a number. An art pass is exactly the wrong phase to keep deferring
it: this is the one that spends frame budget rather than saving it. If it does
not hold 60 fps under 4x CPU throttling, the art pass has failed regardless of
how it looks.

## What happened

### The GLTF loader was built, then removed

`src/render/assets.ts` (a slot-keyed manifest type, `parseManifest`, a scene
flattener that baked mesh transforms and merged the tree into one geometry,
and an async `loadModels` that failed soft to the procedural mesh),
`src/data/models.json`, and seven tests in `tests/render/meshes.test.ts` —
five on the manifest parser, two on the flattener.

**Why it went.** ROADMAP.md §Phase 8 says it in as many words: "Everything is
generated in code. No `.glb` files, no texture images, no asset loader... do
not quietly add a loader." I built one against that constraint on the strength
of a later paragraph in my own notes above, which reversed a decision made
earlier in the same session. The user caught it. The reversal was theirs and
unintentional, but the loader is still the wrong side of it.

**The deciding fact is that `models.json` was `{}`.** Nothing in `src/`
imported `assets.ts` — the only importer was the test file. No mesh, no
vehicle, no bootstrap path went through it. It is infrastructure for a
decision that was never acted on, not work being thrown away. Bundle size
did not move when it went (161.7 KB gzipped, 32.3% of budget), which is the
same fact from the other end: tree-shaking had already dropped `GLTFLoader`
because nothing reachable referenced it.

**Recovering it.** `git show bb1bec3~1:src/render/assets.ts` and the same for
`src/data/models.json`; the tests are the two `describe` blocks at
`tests/render/meshes.test.ts:119-175` in that commit. It is 143 lines and it
is additive — no existing module changes shape to take it back.

**What would justify bringing it back.** One thing, concretely: *a real `.glb`
that a person authored or licensed, in hand, that looks better than the
procedural mesh for the same slot.* Not the intent to get one, not a slot
reserved for one — the file. That is the evidence the loader was always
waiting on, and until it exists the loader has nothing to load.

Two things that would specifically **not** justify it, because they are the
arguments that produced it the first time:

- "Modelled assets have a higher fidelity ceiling." They do not, on their own.
  The authoring does. This is already written up above and it was still the
  reasoning that leaked back in.
- "The loading path should be ready for when we have assets." Ready costs
  bundle, tests, and a manifest to keep valid, and it expires: the loader that
  is right for the assets we eventually get is the loader written after we
  have them. Adding it then is a day's work and it is additive.

If it comes back, it should come back with the roadmap paragraph edited in the
same commit, so the constraint and the code agree.


## Direction change: sprites, not meshes

Phase 8 is still paused on Phase 4. This records a decision made while it
waits, so the session that builds it works against it rather than
rediscovering it.

The user's point: the 1994 game looked beautiful and this one does not, and
images beat built components. On textures I had already agreed. On vehicles I
had said an image cannot work because a flat picture does not turn or lean —
true of one image, and not what the genre did. Road racers of that era drew
every object as a handful of frames from the chase camera's angle and scaled
them by distance. That is the look, and it is less work than the procedural
meshes, not more.

It fits this codebase unusually well. A sprite-scaling renderer places
everything by distance along the road and offset across it, which is exactly
`(s, t)`. The simulation does not change at all — `src/core/` untouched is
already a Phase 8 acceptance criterion.

Plan for the building session:

1. Load `public/sprites/**` with `THREE.TextureLoader`. A missing file falls
   back to today's mesh, so art can land one file at a time.
2. Riders, traffic, police, hazards and roadside objects become billboards
   anchored bottom-centre, scaled by real width (`TRAFFIC_SIZES` for traffic),
   mirrored for negative lean.
3. Frame chosen from `state`, `lean`, `attack`; vertical offset from `h`.
   Rivals tint one neutral sheet.
4. Road and buildings stay generated geometry.

File names and prompts: `docs/ASSET_PROMPTS.md`, sprite section.

Still open from Phase 4: `racer.test.ts` "does not hand a top-three finish to
a rider who only holds throttle" — see `phase-04.md`. Undecided, not
forgotten.

### Built before the art arrived

Two pieces of the sprite renderer that need no pictures:

- `scripts/check-images.mjs`, run by `npm run size` and on its own as
  `npm run images`. It enforces the 1.5 MB image budget and WebP-only, and
  checks every file against the names in `docs/ASSET_PROMPTS.md`. That last
  part is the one that matters day to day: a misspelt picture does not error,
  it silently falls back to the old drawing and looks like a renderer bug. A
  planted `Centre.webp` failed the check with exit 1, as it should — Windows
  would have loaded it and a static host would not.
- `src/render/sprites/frames.ts`, the pure choice of which rider picture to
  draw from `state`, `lean`, `attack`, `weapon` and `hVel`, writing into a
  caller-owned object so the frame loop allocates nothing. Six tests,
  including one that fails if a frame name drifts out of the prompt file.
  Airborne picks its two tumble frames by the sign of `hVel` rather than a
  clock, so a replay draws the same tumble.

The sim records no side for an attack, so the swing is drawn to whichever
side the rider leans, and a backhand to the other. Good enough to see; worth
revisiting if it reads wrong on screen.

## Setting change: out of Delhi

The user asked for the game to leave India — New York, Switzerland,
Thailand, Europe, Miami — and for more variety in the cars. Their pictures
1–4 (three rider frames and a hatchback) are setting-neutral and keep their
names.

Each place is mapped onto an existing route by its road, not its name (table
at the top of ROADMAP): the Old City's narrow walled lanes become a European
old town, the flyway's raised deck with nothing beside it becomes Bangkok's
elevated expressway, and so on. Nothing in the simulation changes — no widths,
densities, hazards or tests move. That is the reason to map rather than invent
five new tracks.

Traffic variety is render-only. The simulation keeps four traffic kinds,
because four is what it collides with; each kind now has several pictures and
the renderer picks one per pool slot. `car` → hatchback, sedan, taxi, sports,
SUV, convertible, pink taxi, van; `auto` (the small one) → tiny city car; `bus`
→ city bus, school bus, coach; `truck` → box truck, semi. Which appear where —
yellow cabs in New York, convertibles in Miami — is a per-scenery list for the
building session, and belongs in a data file, not in code.

Shared sprites keep the one lighting style pictures 1–4 were made in, so every
vehicle can drive every route. The place comes from skylines, building fronts
and props, each prompted in its own light, and from tinting sprites toward the
route's light at draw time.

`check-images.mjs` now accepts `<name>-front.webp` for any listed
`<name>-rear.webp`, so oncoming traffic can be added without listing every
front view in the prompt file.

Deferred, for one rename pass in a fresh session:

- scenery tags `ringroad / oldcity / yamuna / flyway / ridge` →
  `newyork / oldtown / miami / bangkok / alps`, plus route ids and names,
  across data, code and tests;
- `GAME_DESIGN.md` setting and district text, and the racer names in
  `racers.json`, which are all Indian;
- `Explanation.html`;
- `CLAUDE.md`'s Setting section — not edited here, because a mid-session edit
  to it does not apply until restart. Proposed text:

  > ## Setting
  >
  > Five night rides in five places: New York, a European old town, Miami,
  > Bangkok and the Swiss Alps. Neon, streetlight, wet asphalt, skylines.
  > Real place names are geography and are fine; real brands are not. This
  > is the visual identity — every route should be recognisable as its place
  > from a single screenshot.

## The image budget moved from 1.5 MB to 3.5 MB

All 77 pictures are in. As generated they came to 29.5 MB — 1000–2000 px and
250–900 KB each. Resized to game size (sprites 512 px, skylines 1024, building
fronts 768, road textures 512 except asphalt at 1024) and re-encoded at WebP
quality 72, they total **3.36 MB**: sprites 1.96, road textures 0.48,
skylines 0.47, building fronts 0.45. Originals are kept in
`art-source/originals/` (git-ignored) and in git history at 7209d04.

1.5 MB was a number I set when the plan was about 40 pictures in one city.
There are now 77 across five places, and reaching 1.5 MB would take sprites at
around 256 px under heavy compression — a visible loss on the things the
player looks at most. The user agreed to 3.5 MB, on the condition that the
renderer loads per place: shared sprites plus one place's skyline, building
front and road texture, about 2.3 MB per race.

One mistake on the way: a chained `sed` meant to set skylines to 1024 and
building fronts to 768 matched both lines and put skylines at 768 too. The
breakdown caught it — a 768 px panorama is too thin to stretch across a
screen — and they were redone from the originals, which is why every pass
re-encodes from the backup rather than from the previous output.
