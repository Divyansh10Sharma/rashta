# Phase 01 — Track space

> **Note on ordering.** This file was opened before Phase 0 began, not before
> Phase 1. It exists early because the curvature-correction derivation below
> was worked out during the doc-correction pass that preceded Phase 0, and the
> figures in `ARCHITECTURE.md` §1.4 cite it. Everything above the rule is
> pre-phase work. Phase 1 proper appends below it.

## Pre-phase — the curvature correction, derived properly

### Why this got redone

In my first pass over the docs I claimed that on a 20 m-radius corner, two
riders separated by `ds = 2, dt = 1` are "1.84 m apart on the inside and 2.9 m
apart on the outside — a 58% swing".

Divyansh checked it and it did not hold up. At `t = ±1` the factor
`(1 − t·κ)` is 0.95 / 1.05, so `ds = 2` becomes 1.9 / 2.1 m of arc, and the
separation is about 2.15 / 2.33 m. Nowhere near 1.84 and 2.9.

He was right, and the diagnosis is worth writing down because it is a failure
of *statement*, not of arithmetic:

- The numbers 1.84 and 2.9 were arithmetically correct — but for
  `t = +4/+5` and `t = −8/−7` respectively.
- My prose quoted only `ds` and `dt` and never mentioned `t`. Since `t` is the
  governing variable, that made a positional effect look like a property of
  the corner.
- Worse, the two figures came from *different* `|t|`, so it was not a
  like-for-like comparison. That inflated the swing a second time.

Corrected, matched-`|t|`: the swing is 43.5%, not 58%, and only at `|t| ≈ 4.5`.
At the `|t| ≈ 1.5` he checked, it is 12.8%.

Rule going forward: never quote a figure derived from a parametrised setup
without stating every parameter. If the setup will not fit in the sentence, it
goes in a table.

### The geometry

Convention, per `ARCHITECTURE.md` §1: `κ > 0` is a right turn, `t > 0` is
right of the centreline, so **positive `t` is the inside of a right turn**.

On a constant-curvature segment of centreline radius `R = 1/κ`, a point at
`(s, t)` sits at polar radius `r = R − t` and polar angle `φ = s/R`. Two
entities are then separated by the chord:

```
d = sqrt( r1² + r2² − 2·r1·r2·cos(Δφ) )    where Δφ = ds/R
```

Arc length at offset `t` scales by `(1 − t·κ)`: the inside of the bend is
shorter than the centreline, the outside longer. That factor is the whole
effect.

### Figures

`R = 20 m`, `κ = 0.05`, `ds = 2`, `dt = 1`. Naive `sqrt(ds² + dt²)` = 2.2361 m.

| pair | t1 | t2 | exact | approx | approx err | vs naive |
|---|---|---|---|---|---|---|
| centreline | 0 | 1 | 2.1902 | 2.1915 | 0.059% | −2.1% |
| inside, \|t\|~1.5 | 1 | 2 | 2.1017 | 2.1030 | 0.061% | −6.0% |
| outside, \|t\|~1.5 | −2 | −1 | 2.3698 | 2.3712 | 0.057% | +6.0% |
| inside, \|t\|~4.5 | 4 | 5 | 1.8434 | 1.8446 | 0.066% | −17.6% |
| outside, \|t\|~4.5 | −5 | −4 | 2.6448 | 2.6462 | 0.054% | +18.3% |
| inside, \|t\|~8.5 | 8 | 9 | 1.5228 | 1.5240 | 0.078% | −31.9% |
| outside, \|t\|~8.5 | −9 | −8 | 3.0188 | 3.0203 | 0.051% | +35.0% |

Inside/outside swing at matched `|t|`:

| \|t\| | inside | outside | swing |
|---|---|---|---|
| ~1.5 | 2.1017 m | 2.3698 m | 12.8% |
| ~4.5 | 1.8434 m | 2.6448 m | 43.5% |
| ~8.5 | 1.5228 m | 3.0188 m | 98.2% |

The effect is governed by `t·κ`. It is negligible on a motorway sweeper and
decisive in Old City, which is exactly where combat will be tightest.

### Surprise 1 — the cheap approximation is essentially exact

`approx` above is:

```
tMean = (t1 + t2) / 2
ds'   = ds · (1 − tMean·κ)
d     ≈ sqrt(ds'² + dt²)
```

It tracks the exact chord to within **0.078%** across every case tested,
including `|t| = 9` on a 20 m radius, which is most of the way to the centre
of curvature. I expected it to degrade badly at large `t·κ` and it does not.

This matters more than the accuracy: the approximation has **no trigonometry
in it**. Decision (f) bans transcendentals from `step()` to keep the
determinism guarantee bit-exact, and I had assumed `trackDistance` would need
a precomputed `cos` table to comply. It does not. Two multiplies, a subtract,
and a `sqrt` — all IEEE-754-exact operations. The constraint and the
correction turned out to be free of each other.

### Surprise 2 — the factor degenerates, and it is a data error

`(1 − t·κ)` hits zero at `|t| = 1/|κ|` and goes negative beyond it. That is
the case where the road is wider than its corner is tight, so the inside edge
has folded through the centre of curvature — geometrically nonsense, and it
would silently produce zero and then *negative* arc contributions.

| R | t | factor |
|---|---|---|
| 20 | 12 | 0.400 |
| 12 | 10 | 0.167 |
| 8 | 8 | 0.000 — degenerate |
| 8 | 10 | −0.250 — degenerate |

This should not be a runtime clamp in `trackDistance` — a clamp would hide a
broken track and produce quietly wrong combat ranges forever. It is a
validation rule: reject at load any segment where `curvature != 0` and
`halfWidth + shoulder >= 1/abs(curvature)`, naming the file and segment index.
Added to the Phase 1 build list.

### Reproducing the figures

```js
const R = 20, K = 1 / R;
const exact = (s1, t1, s2, t2) => {
  const r1 = R - t1, r2 = R - t2, dphi = (s2 - s1) / R;
  return Math.sqrt(r1 * r1 + r2 * r2 - 2 * r1 * r2 * Math.cos(dphi));
};
const approx = (s1, t1, s2, t2) => {
  const ds = (s2 - s1) * (1 - ((t1 + t2) / 2) * K);
  return Math.hypot(ds, t2 - t1);
};
for (const t of [0, 1, -2, 4, -5, 8, -9])
  console.log(t, exact(0, t, 2, t + 1).toFixed(4), approx(0, t, 2, t + 1).toFixed(4));
```

Run with `node`. This is throwaway — the real version lands as a test against
`trackDistance` in Phase 1.

### Deferred to Phase 1 proper

- `trackDistance` itself, plus the test asserting ≤0.1% agreement with the
  exact chord across the full road width on the tightest test-track corner.
- The degenerate-segment validation rule and its throwing test.
- Whether `trackDistance` should also account for `gradient` and `bank`. The
  derivation above is planar. A 6% gradient adds about 0.2% to a 2 m
  separation, which is below the noise of the approximation itself — but this
  should be checked rather than assumed once real track data exists.

---

## Phase 1 — starts here

### Decisions taken before writing anything

Four things the docs leave open that have to be settled to write a line of
this. Recording the reasoning now so the Explanation page and Phase 2 are not
guessing at it later.

**1. How `sample()` avoids trigonometry — a dense precomputed table.**

CLAUDE.md rule 4 bans `sin`/`cos` from anything the simulation reaches, and
`sample()` is reached constantly. But a point partway along a constant-
curvature arc is inherently `R·sin(θ)`, `R·(1−cos θ)`. There is no trig-free
closed form.

So the trig happens once, at load: each segment is subdivided into nodes, each
node's frame computed exactly, and stored in flat arrays. `sample()` is then a
binary search for the segment plus arithmetic for the node index plus a linear
interpolation between two nodes. Exact at every node, interpolated between.

Node spacing is chosen per segment from the sagitta error of a chord across a
circle, `d = sqrt(8·R·ε)`: on a 20 m corner that is 0.4 m, on a 500 m sweeper
2 m. Clamped to [0.25, 2.0]. Segment boundaries always land exactly on nodes,
which is what makes the 1e-9 boundary-agreement criterion achievable rather
than approximately achievable.

Storing the heading *angle* would not work — recovering a direction from an
angle needs `cos`. So the forward and right **vectors** are stored and
interpolated, then re-orthogonalised with cross products and a `sqrt`. All
IEEE-exact operations.

**2. `s` is horizontal distance; gradient is rise per unit `s`.**

`gradient` is documented as "metres risen per metre travelled", which is
ambiguous: travelled along the 3D path, or along the plan view? Taking it as
the 3D path length makes the closed-form integration messier and makes `s`
stop being the thing curvature integrates against.

So: heading and curvature are integrated in the horizontal plane, `s` advances
horizontally, and elevation rises by `gradient × s`. True 3D path length is
then `s·sqrt(1+g²)` — at the steepest gradient this project will use, about
0.5% longer than `s`. Documented rather than hidden, because a rider's
odometer and their `s` will differ by that much on the Ridge.

**3. Bank is constant within a segment, not interpolated across it.**

ARCHITECTURE §1.1 says segments have "linear elevation and banking", but the
data model gives each segment a single `bank` number. Those cannot both hold:
one number per segment cannot describe a ramp without also deciding what it
ramps *to*.

Going with constant-per-segment, because it is what the data model actually
says, and because the alternative silently redefines `bank` as a
boundary-specified value, which changes the meaning of every track file.
The cost is a discontinuity in the `up` vector where camber changes, and the
fix is the one real roads use: author a short transition segment. Flagged for
Phase 3, when real tracks exist and this becomes visible.

**4. Fork geometry must actually close, and it is validated.**

§1.2 gives branches a `rejoinS` and a `lengthDelta` but never says the branch
has to arrive where it claims to. Nothing forces the authored geometry to
return to the main path. A fork that rejoins 14 m sideways of where it says it
does would look broken and be very hard to diagnose from `(s, t)` alone.

So closure is a validation rule: a branch's endpoint must land within 0.5 m of
the main path at its `rejoinS`, or the load throws. Together with the
GAME_DESIGN rule that the two routes differ by at most 5% in length, that
makes the test track's fork a real constraint to author rather than a shape
drawn freehand — see below.

### Attempt 1 — the fork closure, worked out on paper first

The branch has to leave the main path, take a genuinely different route, and
arrive back at exactly the point `rejoinS` claims — while differing in length
by no more than 5%. Freehand shapes do not satisfy that; it needs solving.

Used a symmetric detour of four equal arcs, radius R, angle phi, in the pattern
right–left–left–right. Net heading change is `+phi −phi −phi +phi = 0`, and by
symmetry the lateral displacement cancels, so the branch ends on the original
line facing the original way. Forward displacement works out at `4R sin(phi)`
while the branch itself is `4R·phi` long, so the length ratio is `phi/sin(phi)`
— independent of R, which is the useful part.

Solving `phi/sin(phi) ≤ 1.05` gives `phi ≈ 0.53`. Picked `phi = 0.5` and
`R = 60`, giving a 4.291% overshoot — deliberately close to the 5% ceiling so
the validation rule is actually exercised rather than trivially satisfied. The
main path gets a straight of exactly `240·sin(0.5) = 115.06212926500872` m.

Closure came out at under 1 mm on the first run, which was the one thing this
phase got right first time.

### Attempt 2 — a boundary test that failed for a real reason

Wrote a test asserting the forward vector has no seam at any segment boundary,
alongside the position one. It failed: `expected 0.049953 to be less than
1e-6`.

`0.04995` is not noise, it is `0.05` — the gradient of the hill segment. So the
tangent genuinely is discontinuous there, and the test was right to complain.

Why: **curvature and gradient are not the same kind of quantity**, though the
segment record lists them side by side as if they were. Curvature is the second
derivative of position, so it integrates into a heading that is continuous even
when curvature itself steps between segments. Gradient *is* the first
derivative of elevation, so a step in it is a step in the tangent — a crest of
zero radius.

Position is continuous. Heading is continuous. Pitch is not, wherever gradient
changes. That is a property of the data model, not a bug, and it is the same
issue as the bank discontinuity predicted in decision 3 above. Replaced the
test with two: heading continuity, which is guaranteed, and an explicit test
pinning the pitch kink as known behaviour, with a comment explaining it so
whoever tries to "fix" it later has to argue with a test first.

Real roads solve this with vertical transition curves. This project solves it
by authoring a short transition segment, which is a Phase 3 authoring concern.

### Attempt 3 — the naive curvature correction is not good enough, and I had only tested it at one point

The acceptance criterion asks that `trackDistance` agree with the exact chord
to within 0.1% across the full road width on the tightest corner. Wrote the
sweep — full width, and along-track gaps of 0.5, 1, 2, 4, 8 m. Worst error:
**0.9089%**, nine times over budget, at `ds = 8` across the full width.

This is the same mistake as the |t| error from the pre-phase notes, in a new
place. My derivation swept `t` thoroughly and fixed `ds = 2` throughout, so I
had characterised the approximation along one axis and quietly assumed the
other. The error grows as `dPhi²/24` where `dPhi = ds·k`, so it is invisible at
combat range and significant at, say, a 15 m police arrest radius on an Old
City corner.

A second test failed at the same time for a duller reason: I had asserted the
*approximation* equals the *exact* chord to four decimal places, when my own
table three sections up records a 0.066% gap for exactly that case. The test
was wrong, not the code.

The fix turned out to be better than a tolerance change. Writing the exact
separation out algebraically:

```
d^2 = r1^2 + r2^2 − 2·r1·r2·cos(dPhi)
    = (r2 − r1)^2 + 4·r1·r2·sin(dPhi/2)^2
    = dt^2 + 4·r1·r2·sin(dPhi/2)^2
```

because `r2 − r1` collapses to exactly `dt`. That identity is *exact*. So the
approximation was doing two unnecessary things — using an arithmetic mean where
the algebra calls for a geometric one, and using arc length where it calls for
chord length — and only one necessary thing, which is avoiding `sin`.

Replaced both. `sqrt(r1·r2)` is exact and costs a `sqrt`, which IEEE-754 pins.
The sine becomes a four-term Maclaurin series for `2·sin(u/2)/u`, which is pure
multiplication and addition and therefore bit-identical everywhere.

Worst error across the same sweep went from 0.9089% to **0.000000%** — the
remaining error is the series truncation at about 1e-7. Three orders of
magnitude inside the criterion, for about four extra arithmetic operations.

The lesson worth keeping: I had been approximating the geometry *and* the
transcendental, when only the transcendental needed approximating. Updated
`ARCHITECTURE.md` §1.4, which described the naive form and quoted the old 0.08%
figure.

### Attempt 4 — a purity guard that was mostly theatre

Wrote a test scanning `src/core/` for banned constructs. It failed on
`src/core/rng.ts` for using the `**` operator.

`rng.ts` contains no exponentiation. The regex `[^*]\*\*[^*]` was matching the
`/**` that opens a JSDoc comment.

Which exposed that the whole guard was scanning comments as if they were code.
The transcendental check was passing only by luck: `distance.ts` contains the
prose "CLAUDE.md rule 4 bans `Math.sin` from anything the simulation reaches",
and it escaped the net only because the pattern happened to require a following
`(`. A guard that reads prose as code will eventually fail on a comment and,
worse, could pass while missing real code. Now strips comments first.

Two things came out of writing it that I would not have thought of unprompted:

- **`Math.hypot` had to go on the banned list.** It looks like `sqrt` and is
  not: the spec explicitly permits an implementation-approximated result, so it
  is exactly as unsafe as `sin` for determinism while looking exactly as safe
  as `sqrt`. It is used in the tests, where it is harmless, and nowhere in
  core.
- **`Date.now`, `performance.now`, and `process` needed banning too.** Rule 4
  is usually discussed as being about `Math.random`, but a wall clock in the
  simulation breaks a replay just as completely, and no lint rule is watching
  for it.

### Attempt 5 — the coverage gate caught speculative API

Everything passed but `track/` sat at 99.63% against a 100% gate, with one
uncovered line: `Track.lengthOf()`.

Nothing called it. Not the tests, not `distance.ts` — which reaches
`branch.path.length` directly — and not the roadmap, which asks for
`totalLength` and never mentions a per-branch equivalent. I had written it
because it felt like something a Track ought to have.

Deleted it rather than writing a test to justify it. CLAUDE.md's scope
discipline says not to add abstractions no phase asked for, and the honest way
to reach 100% coverage is to not carry code nothing uses. Worth noting that a
100% line gate is what surfaced this at all — at 80% it would have sat there
indefinitely.

## Surprises

- **`sqrt` is a first-class citizen and `hypot` is not.** IEEE-754 requires
  `sqrt` to be correctly rounded — it is as deterministic as multiplication.
  `Math.hypot`, which exists precisely to compute `sqrt(a²+b²)` more carefully,
  carries no such guarantee. The careful function is the unsafe one.
- **The determinism constraint made the maths better, not worse.** Being
  forbidden `sin` forced me to write the separation out algebraically, which is
  where the exact `dt²  + 4·r1·r2·sin²(dPhi/2)` decomposition fell out. Had
  `Math.cos` been available I would have shipped the naive version with a
  tolerance and never found it.
- **Node spacing is cheap.** The full test track precomputes to a few thousand
  nodes; the whole precompute is imperceptible, and the density is set by a
  sagitta tolerance rather than a guess.

## Deferred

- **Elevation and bank are ignored by `trackDistance`.** The derivation is
  planar. A 6% gradient adds about 0.2% to a 2 m separation, below the
  approximation's own noise, but this was assumed rather than measured and
  should be checked once real tracks exist. Phase 3.
- **A pitch kink at every gradient change.** Documented and test-pinned, not
  fixed. Authoring transition segments is the intended answer; if Phase 3 makes
  it visible, the alternative is boundary-specified gradients.
- **`sample()` clamps out-of-range `s` silently.** Fine for now; when a rider
  can cross a fork rejoin in Phase 5, the branch-to-main transition needs
  explicit handling rather than a clamp.
- **The replay determinism test** (CLAUDE.md rule 4) still has nothing to
  replay — there is no `step()` until Phase 2. The purity guard is a proxy for
  it, not a substitute.
