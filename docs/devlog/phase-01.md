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
