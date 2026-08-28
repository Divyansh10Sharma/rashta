# Explanation.html — specification

`Explanation.html` is a deliverable, not a byproduct. It is updated at the end
of every phase, and it is the thing that turns this project from something
that was built into something that can be explained.

## Who it is for

One reader: an intelligent person who knows nothing about game development,
3D graphics, TypeScript, or any library used here. He is not stupid and does
not want to be talked down to. He wants to be able to hold his own in a
conversation with a senior engineer about this project.

That produces the central rule.

## The central rule: plain first, then the word

**Every technical idea gets explained twice, in this order, every single
time.**

1. The plain explanation. As if to a bright ten-year-old. No jargon at all —
   not even jargon you defined earlier on the page. Use analogy, use concrete
   images, use "imagine you…".
2. Immediately after, the real vocabulary. "That's called *X*." Then the
   precise definition an engineer would recognise.

Both, in that order, no exceptions. The plain version alone leaves him unable
to talk to engineers. The vocabulary alone leaves him reciting words he can't
defend. Never merge them into one hedged sentence that does neither well.

Mark the vocabulary handoff visually so the pattern is obvious — wrap the
term in `<dfn class="term">` the first time it appears in a page's prose.

Bad:

> We use a fixed timestep so the physics stay deterministic across framerates.

Good:

> Imagine you're filming someone walking and your camera sometimes records 30
> pictures a second and sometimes 120. If you worked out how far they'd walked
> from the pictures alone, you'd get a different answer each time. So instead
> we decide up front: the world always moves forward in identical little
> nudges, exactly sixty a second, no matter how fast the screen is drawing.
>
> That's called a **fixed timestep**. The simulation advances by a constant
> `dt` decoupled from the render rate, which is what makes the physics
> deterministic — the same inputs produce the same result on any machine.

## Structure

- One HTML file. Self-contained: no build step, no bundler, no external
  requests, no CDN links, no Google Fonts. It must work offline, opened by
  double-clicking, and it must work if emailed as an attachment.
- Vanilla HTML, CSS, and JavaScript. No framework.
- **Paginated. Exactly one page visible at a time.** All other pages are in
  the DOM but hidden.
- One page per phase, in order, plus one final page.
- Navigation: previous / next buttons, a jump-to-page index, left and right
  arrow key support, and URL hash deep links (`#phase-04`) that survive a
  refresh.
- The current page and total count are always visible.
- Accessible: real headings in order, `aria-current` on the active nav item,
  visible keyboard focus, hidden pages use `hidden` or `display: none` so
  screen readers skip them, and a skip-to-content link.
- Responsive down to a phone.
- Print stylesheet: printing shows all pages, each starting on a new sheet.

## Every phase page has exactly these seven sections, in this order

Use these exact headings. Do not add sections, reorder them, or skip one
because it felt thin — a thin section is information too.

### 1. What we were trying to do

The goal of this piece of work in plain language. Zero jargon, including zero
jargon defined elsewhere. Three to six sentences. Someone should be able to
read only this and know what the phase was for.

### 2. Why this was hard

The actual obstacle. Not "we needed to implement the track system". The real
thing that made it non-obvious: a constraint that couldn't be relaxed, two
goals that pulled against each other, or something that behaved in a way
nobody expected.

If it genuinely wasn't hard, say that plainly and say why — that is a real
and interesting answer, and it is far better than manufacturing difficulty.

### 3. What we tried that didn't work

**At least two genuine dead ends.** Each one gets: what was tried, what
actually happened, and a plain explanation of why it failed.

This is the most valuable section in the file. It is the difference between
sounding like someone who built the thing and someone who read about it, and
it is what survives a follow-up question.

**These must be real.** Take them from `docs/devlog/phase-NN.md`. Do not
invent plausible-sounding failures. If a phase truly produced fewer than two
dead ends, write one honest line saying so and describe whatever friction
there was instead. A fabricated dead end is the one thing that can make this
whole document worthless.

### 4. What we went with, and why

The decision, and what it costs. Every choice trades something away — name the
trade explicitly, in its own sentence. If a well-known alternative was
rejected, say which and why, because that is the first thing anyone will ask.

Template to hit, not to copy verbatim: what we chose → why → what we gave up →
the obvious alternative and why not.

### 5. Words to know

A `<dl>` definition list of **every** technical term that appears anywhere on
the page. Not a curated selection — every one. Include library names,
protocols, patterns, file formats, and tools, not only concepts. If `Vitest`,
`BufferGeometry`, `gzip`, `PRNG`, or `JSON` appear on the page, each gets an
entry.

Each entry has two parts, in this order:
- **Plain meaning** — one sentence, no jargon.
- **Precise meaning** — one or two sentences, the definition an engineer
  would accept.

Alphabetical. Terms may repeat across pages; each page is self-contained.

### 6. Show me in the code

Which file and which function this work produced — give real paths. Then the
single most important snippet from the phase, **copied verbatim from the
repository**, not paraphrased and not pseudocode.

Annotate it line by line wherever a line earns it. Not every line earns it;
annotating `const x = 0;` is noise. Put annotations as an adjacent commentary
column or as numbered notes below the block, not as invented comments injected
into the source — the code shown must match the code in the repo exactly, so
that someone can open the file and find it.

If the snippet in the repo changes in a later phase, update this section on
the affected page when you notice.

### 7. Say it out loud

Three to five sentences, written to be spoken, answering: "how did you build
this part?" — credibly, to a senior engineer.

Confident and specific. Name the real thing. No hedging, no "basically", no
"essentially", no "we kind of", no filler. It should read like something a
person would actually say in an interview and be believed.

## The final page: "The whole thing in 90 seconds"

Always the last page. Rewritten from scratch at the end of every phase so it
reflects everything built so far.

Three parts:

1. **The elevator version** — what this is and what's interesting about it, in
   under 150 words, spoken aloud in about 45 seconds.
2. **The architecture in one diagram or list** — the whole system on one
   screen. An inline SVG or a compact nested list. It must fit without
   scrolling on a laptop.
3. **The three decisions that most shaped the project** — the three choices
   that, if reversed, would have produced a different project. Each gets the
   decision, the reason, and the cost. Choose these on merit and be willing to
   change them as the project develops; do not just pick the three most recent
   phases.

This page does not use the seven-section structure.

## Visual direction

Do not produce the default technical-document look. Specific direction:

**Concept — road markings and a highway milestone.** The document is built out
of the visual language of a road: lane paint, signage, kilometre stones.

- **Palette.** Concrete ground `#E6E4DE`. Ink `#1A1A18`. Lane-paint white
  `#FAFAF7`. Centre-line yellow `#F2B705` used only for the current position
  and live emphasis. Signage blue `#1B4D89` for links and structural rules.
  Milestone red-oxide `#8C2F1B` for the dead-ends section only. Nothing else.
- **Type.** System stacks only, since no external requests are allowed.
  Headings: a grotesque with tight tracking and `font-stretch: condensed`
  where available. Body: the system serif or a readable sans at 17–18px with
  generous line height. Code and eyebrow labels: `ui-monospace,
  SFMono-Regular, Menlo, Consolas, monospace`, uppercase, letterspaced.
- **Signature element.** A thin vertical road down the left gutter of every
  page, with a dashed centre line, and the phase number rendered as a
  milestone stone — the rounded-top marker on Indian highways — showing the
  current phase, with the previous and next phases faintly above and below.
  This is the pagination indicator. Spend the design budget here and keep
  everything else disciplined.
- **Section eyebrows.** Each of the seven sections gets a small monospace
  uppercase label. Do not number them 01/02/03 — the order is fixed and
  meaningful, so use the heading text itself.
- **The dead-ends section** is the one section with a distinct treatment: a
  left rule in red-oxide, no rounded corners. It should be visually obvious
  that it is the interesting part.
- Motion: one thing only — pages cross-fade over ~180 ms. Respect
  `prefers-reduced-motion`.
- Dark mode via `prefers-color-scheme`, with the palette inverted
  thoughtfully rather than mechanically.

## Page skeleton

Follow this structure. It is a skeleton, not a style ceiling.

```html
<section class="page" id="phase-04" hidden>
  <header class="page-head">
    <p class="eyebrow">Phase 04</p>
    <h2>Traffic and hazards</h2>
    <p class="standfirst">One-sentence summary of the phase.</p>
  </header>

  <section class="s-goal">
    <p class="eyebrow">What we were trying to do</p>
    …
  </section>

  <section class="s-hard">
    <p class="eyebrow">Why this was hard</p>
    …
  </section>

  <section class="s-deadends">
    <p class="eyebrow">What we tried that didn't work</p>
    <article class="deadend">
      <h4>Spawning traffic from a global pool</h4>
      <p class="plain">…what happened, in plain language…</p>
      <p class="why">…why it failed…</p>
    </article>
    <article class="deadend">…</article>
  </section>

  <section class="s-decision">
    <p class="eyebrow">What we went with, and why</p>
    <p>…the decision…</p>
    <p class="tradeoff">What this costs: …</p>
    <p class="rejected">We didn't use X because …</p>
  </section>

  <section class="s-words">
    <p class="eyebrow">Words to know</p>
    <dl>
      <dt>Object pool</dt>
      <dd class="plain">Keeping a box of spare parts instead of buying a new
        one every time you need it.</dd>
      <dd class="precise">A set of pre-allocated, reusable instances handed out
        and returned rather than constructed and garbage-collected, used to
        avoid allocation pressure inside a per-frame loop.</dd>
    </dl>
  </section>

  <section class="s-code">
    <p class="eyebrow">Show me in the code</p>
    <p class="file-ref">src/core/sim/Traffic.ts → <code>recycleBehind()</code></p>
    <pre><code>…verbatim from the repo…</code></pre>
    <ol class="annotations">
      <li data-line="3">Why this line matters.</li>
    </ol>
  </section>

  <section class="s-spoken">
    <p class="eyebrow">Say it out loud</p>
    <blockquote>…three to five spoken sentences…</blockquote>
  </section>
</section>
```

## Update procedure, end of every phase

1. Read `docs/devlog/phase-NN.md`. Pull the dead ends from it.
2. Add the new `<section class="page">` in phase order.
3. Copy the code snippet **from the actual file**, not from memory.
4. Rewrite the final "90 seconds" page completely.
5. Update the nav index and the total page count.
6. Open the file in a browser and click through every page. Confirm: only one
   page is visible at a time, deep links work, arrow keys work, and every one
   of the seven sections is present on every phase page.
7. Confirm every technical term on the new page has an entry in its "Words to
   know" list. This is the check most likely to be skipped — do it explicitly.
