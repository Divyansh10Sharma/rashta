import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { loadTrackLibrary } from './src/core/track/library.ts';
import { loadBikes, loadTuning } from './src/core/sim/load.ts';
import { step } from './src/core/sim/step.ts';
import { createWorld } from './src/core/sim/world.ts';

const R = ['ridge-run','yamuna-bank','ring-road','old-city','dnd-flyway'];
const files: Record<string, unknown> = {};
for (const n of readdirSync('src/data/tracks')) if (R.some(r=>n.startsWith(r+'-t'))) files[n]=JSON.parse(readFileSync('src/data/tracks/'+n,'utf8'));
const lib = loadTrackLibrary(files);
const tuning = loadTuning('t', JSON.parse(readFileSync('src/data/tuning.json','utf8')));
const bike = loadBikes('b', JSON.parse(readFileSync('src/data/bikes.json','utf8')), tuning)[1]!;

describe('hz', () => { it('counts', () => {
  for (const r of R) {
    const track = lib.get(`${r}-t3`)!;
    let hazardCrashes = 0, slips = 0, trafficCrashes = 0;
    const world = createWorld(bike, track, 3);
    let prev = world.player.state, prevSlip = 0;
    for (let i=0;i<60*400 && world.player.pos.s < track.totalLength-50;i++){
      step(world, {throttle:1,brake:0,lean:0}, track, tuning);
      if (prev!=='crashing' && world.player.state==='crashing') {
        if (world.player.crashCause==='hazard') hazardCrashes++; else trafficCrashes++;
      }
      if (prevSlip<=0 && world.player.slipTimer>0) slips++;
      prev = world.player.state; prevSlip = world.player.slipTimer;
    }
    appendFileSync('hz.txt', `${r}-t3 hazards=${track.hazards.length} hazardCrashes=${hazardCrashes} slips=${slips} trafficCrashes=${trafficCrashes} s=${world.player.pos.s.toFixed(0)}/${track.totalLength.toFixed(0)}\n`);
  }
}, 120000); });
