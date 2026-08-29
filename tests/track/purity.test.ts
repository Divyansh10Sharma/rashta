import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, posix, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two hard rules in CLAUDE.md that lint cannot fully see, asserted rather
 * than assumed.
 *
 * Rule 1 — `src/core/` is pure TypeScript and imports no renderer.
 * Rule 4 — the simulation is bit-exactly deterministic, which requires that
 * nothing it reaches calls a transcendental function.
 */

const CORE = 'src/core';

/** The one file allowed trigonometry: it runs at load, never inside `step()`. */
const TRIG_EXEMPT = 'src/core/track/geometry.ts';

/**
 * IEEE-754 pins `+ - * /` and `sqrt` to a single correctly-rounded result on
 * every conforming engine. Everything below is left to the implementation, so
 * two machines may disagree in the last bits — enough to desynchronise a
 * replay. `Math.hypot` is on the list precisely because it looks safe: it is
 * only `sqrt` in spirit, and the spec explicitly permits an approximation.
 */
const FORBIDDEN = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'pow',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'hypot',
  'cbrt',
  'random',
];

/**
 * Strips comments before scanning.
 *
 * Without this the checks are theatre: a `/**` doc-comment opener reads as an
 * exponentiation operator, and prose describing the rule ("no `Math.sin`
 * here") reads as a violation of it. The guard has to look at code only.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (extname(path) === '.ts') out.push(path);
  }
  return out;
}

const files = sourceFiles(CORE).map((f) => ({
  path: f.split(sep).join(posix.sep),
  text: stripComments(readFileSync(f, 'utf8')),
}));

describe('rule 1: core is pure TypeScript', () => {
  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports three nowhere', () => {
    for (const { path, text } of files) {
      expect(`${path}: ${String(/from\s+['"]three/.test(text))}`).toBe(
        `${path}: false`,
      );
    }
  });

  it('imports no renderer, input, audio, or ui module', () => {
    for (const { path, text } of files) {
      const offending = /from\s+['"][^'"]*\/(render|input|audio|ui)\//.test(
        text,
      );
      expect(`${path}: ${String(offending)}`).toBe(`${path}: false`);
    }
  });

  it('touches no browser or wall-clock global', () => {
    // A `Date.now()` in the simulation breaks determinism exactly as surely as
    // a `Math.random()`, and no lint rule is watching for it.
    for (const { path, text } of files) {
      const offending =
        /\b(document|window|performance\.now|Date\.now|localStorage|process)\b/.test(
          text,
        );
      expect(`${path}: ${String(offending)}`).toBe(`${path}: false`);
    }
  });
});

describe('the simulation allocates nothing per tick', () => {
  // CLAUDE.md: no allocation inside the per-frame loop. Checked at the source
  // rather than by measuring the heap, because a heap delta in a shared test
  // process depends on what else has run and fails on ordering alone.
  /**
   * `new Error(...)` is exempt. Throwing does allocate, but it is a terminal
   * path — the frame it would have cost is not going to be drawn either way,
   * and the alternative is preallocating exception objects, which is the kind
   * of optimisation that makes code worse to read for no measurable gain.
   */
  const withoutThrows = (text: string): string =>
    text.replace(/new Error\(/g, 'THROW(');

  const ALLOCATING = [
    'new ',
    '.map(',
    '.filter(',
    '.slice(',
    '.concat(',
    '.split(',
    'Object.assign',
    'Array.from',
    'JSON.',
  ];

  const HOT = ['src/core/sim/step.ts', 'src/core/sim/bike.ts'];

  for (const path of HOT) {
    it(`${path} constructs nothing`, () => {
      const file = files.find((f) => f.path === path);
      expect(file).toBeDefined();
      const text = withoutThrows(file?.text ?? '');
      const found = ALLOCATING.filter((token) => text.includes(token));
      expect(`${path}: ${found.join(', ')}`).toBe(`${path}: `);
    });
  }

  it('Path.sample() constructs nothing', () => {
    // path.ts as a whole *does* allocate — the node tables and the scratch
    // vectors are built in its constructor, which runs once. Only the sampling
    // path has to stay clean, so the check is scoped to that function.
    const file = files.find((f) => f.path === 'src/core/track/path.ts');
    expect(file).toBeDefined();
    const body = file?.text.slice(
      file.text.indexOf('sample(s: number'),
      file.text.indexOf('export function createFrame'),
    );
    expect(body).toBeDefined();
    const text = withoutThrows(body ?? '');
    const found = ALLOCATING.filter((token) => text.includes(token));
    expect(`sample(): ${found.join(', ')}`).toBe('sample(): ');
  });
});

describe('rule 4: no transcendental is reachable from the simulation', () => {
  const pattern = new RegExp(`\\bMath\\.(${FORBIDDEN.join('|')})\\s*\\(`, 'g');

  it('finds none outside the load-time geometry module', () => {
    for (const { path, text } of files) {
      if (path === TRIG_EXEMPT) continue;
      const found = text.match(pattern) ?? [];
      expect(`${path}: ${found.join(', ')}`).toBe(`${path}: `);
    }
  });

  it('uses no ** operator, which is Math.pow by another name', () => {
    for (const { path, text } of files) {
      expect(`${path}: ${String(/[^*]\*\*[^*]/.test(text))}`).toBe(
        `${path}: false`,
      );
    }
  });

  it('confirms the exemption is real and still needed', () => {
    // If this ever stops matching, the exemption should be deleted rather than
    // left lying around as a licence nobody is using.
    const geometry = files.find((f) => f.path === TRIG_EXEMPT);
    expect(geometry).toBeDefined();
    expect(geometry?.text).toMatch(/Math\.(sin|cos|atan2)\s*\(/);
  });

  it('keeps the exemption out of the sampling path', () => {
    // geometry.ts is allowed trigonometry, so the guarantee rests on nothing
    // in the runtime path importing it for anything but load-time work.
    const path = files.find((f) => f.path === 'src/core/track/path.ts');
    expect(path?.text).toBeDefined();
    // `sample()` is the hot function; assert it calls nothing from geometry.
    const sampleBody = path?.text.slice(path.text.indexOf('sample(s: number'));
    expect(sampleBody).not.toMatch(
      /positionAt|forwardAt|advanceCursor|headingOf/,
    );
  });
});
