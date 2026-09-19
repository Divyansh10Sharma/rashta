// Standing acceptance criterion, docs/ROADMAP.md Phase 8: game pictures are
// WebP and stay under 3.5 MB in total. It also checks every file against the
// names in docs/ASSET_PROMPTS.md, because a misspelt picture does not error —
// it silently falls back to the old drawing and looks like a renderer bug.
// Windows ignores letter case in file names; a static host does not.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const BUDGET_BYTES = 3.5 * 1024 * 1024;
const ROOTS = ['public/sprites', 'public/textures'];
const PROMPTS = 'docs/ASSET_PROMPTS.md';
const LIST = process.argv.includes('--list');

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path.replaceAll('\\', '/'));
  }
  return out;
}

const expected = [
  ...new Set(
    [...readFileSync(PROMPTS, 'utf8').matchAll(/`(public\/[^`]+\.webp)`/g)].map(
      (match) => match[1],
    ),
  ),
];
// Oncoming traffic: any listed `-rear` picture may have a `-front` twin,
// so the prompt file need not list every front view.
const fronts = expected
  .filter((path) => path.endsWith('-rear.webp'))
  .map((path) => path.replace(/-rear\.webp$/, '-front.webp'));
const found = ROOTS.flatMap(filesUnder);

const problems = [];
let total = 0;
for (const path of found) {
  total += statSync(path).size;
  if (extname(path) !== '.webp') {
    problems.push(`${path} is not a .webp file`);
  } else if (!expected.includes(path) && !fronts.includes(path)) {
    problems.push(
      `${path} is not a name in ${PROMPTS} — check spelling and letter case`,
    );
  }
}

const present = expected.filter((path) => found.includes(path));
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const pct = ((total / BUDGET_BYTES) * 100).toFixed(1);
console.log(
  `\n  ${present.length} of ${expected.length} pictures in place, ` +
    `${kb(total)} — ${pct}% of the ${kb(BUDGET_BYTES)} image budget`,
);

if (LIST) {
  for (const path of expected) {
    console.log(`  ${found.includes(path) ? '[x]' : '[ ]'} ${path}`);
  }
}

for (const problem of problems) console.error(`  ${problem}`);
if (total > BUDGET_BYTES) {
  console.error(`\nImages over budget by ${kb(total - BUDGET_BYTES)}.`);
}
if (problems.length > 0 || total > BUDGET_BYTES) process.exit(1);
