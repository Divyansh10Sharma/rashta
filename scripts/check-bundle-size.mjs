// Standing acceptance criterion, docs/ROADMAP.md: production JS stays under
// 500 KB gzipped. Measured, not estimated — a budget nobody measures is how a
// 500 KB bundle quietly becomes a 2 MB one by Phase 10.
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const BUDGET_BYTES = 500 * 1024;
const DIST = 'dist';

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...jsFiles(path));
    else if (extname(path) === '.js') out.push(path);
  }
  return out;
}

const files = jsFiles(DIST);
if (files.length === 0) {
  console.error(`No .js files found in ${DIST}/. Did the build run?`);
  process.exit(1);
}

let total = 0;
const rows = files.map((path) => {
  const bytes = gzipSync(readFileSync(path)).length;
  total += bytes;
  return { path, bytes };
});

const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
rows.sort((a, b) => b.bytes - a.bytes);
for (const { path, bytes } of rows)
  console.log(`  ${kb(bytes).padStart(10)}  ${path}`);

const pct = ((total / BUDGET_BYTES) * 100).toFixed(1);
console.log(
  `\n  total ${kb(total)} gzipped — ${pct}% of the ${kb(BUDGET_BYTES)} budget`,
);

if (total > BUDGET_BYTES) {
  console.error(`\nOver budget by ${kb(total - BUDGET_BYTES)}.`);
  process.exit(1);
}
