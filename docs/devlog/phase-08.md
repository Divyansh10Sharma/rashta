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
