'use strict';

// Audits a seed table: rebuilds sampled levels and re-counts their solutions.
//
// The table is 8 bytes per level with nothing human-readable in it, and it is
// only as true as the generator that wrote it. This re-does the work for a
// sample and says whether the file still describes what it claims.
//
//   node tools/check-seeds.js data/pipelines-seeds.bin --sample 200

const path = require('node:path');
const seedTable = require('../src/seed-table.js');
const pipelines = require('../public/games/pipelines/game.js');

const args = process.argv.slice(2);
let file = null;
let sample = 100;
let stepBudget = 3000000;
for (let i = 0; i < args.length; i += 1) {
  // A flag's value is not the file name, however much it looks like one.
  if (args[i] === '--sample') { sample = Number(args[++i]); continue; }
  if (args[i] === '--step-budget') { stepBudget = Number(args[++i]); continue; }
  if (args[i].startsWith('--')) {
    console.error('unknown option: ' + args[i]);
    process.exit(2);
  }
  file = args[i];
}
if (!file) file = path.join(__dirname, '..', 'data', 'pipelines-seeds.bin');
if (!Number.isFinite(sample) || !Number.isFinite(stepBudget)) {
  console.error('--sample and --step-budget take numbers');
  process.exit(2);
}

const reader = new seedTable.TableReader(file, { pollMs: Infinity });
const info = reader.info;
if (!info) {
  console.error('cannot read ' + file + ': ' + (reader.error && reader.error.message));
  process.exit(1);
}

console.log('table    ' + path.resolve(file));
console.log('levels   ' + info.total + ' from ' + info.firstLevel);
console.log('build    ' + info.buildId + ', generator v' + info.generator +
  ', ' + new Date(info.generatedAt).toISOString());

if (info.generator !== pipelines.generatorVersion) {
  console.error('\nMISMATCH: this generator is v' + pipelines.generatorVersion +
    ', the table was built by v' + info.generator + '. The game will ignore this table.');
  process.exit(1);
}

const step = Math.max(1, Math.floor(info.total / Math.max(1, sample)));
let checked = 0;
let verifiedClaims = 0;
let broken = 0;
let unproven = 0;
const t0 = Date.now();

for (let level = info.firstLevel; level < info.firstLevel + info.total; level += step) {
  const record = reader.get(level);
  const board = pipelines.buildBoard(record.size, record.colors, record.seed);
  checked += 1;

  if (!board) {
    console.log('L' + level + ': the seed builds no board at all');
    broken += 1;
    continue;
  }
  const cells = record.size * record.size;
  const covered = new Set();
  for (const seg of board.solution) for (const cell of seg) covered.add(cell);
  if (covered.size !== cells || board.colors !== record.colors) {
    console.log('L' + level + ': board does not match its record');
    broken += 1;
    continue;
  }
  if (!record.verified) {
    unproven += 1;
    continue;
  }
  verifiedClaims += 1;
  const found = pipelines.countSolutions(board.endA, board.endB, true, stepBudget);
  if (pipelines.wasAborted()) {
    console.log('L' + level + ': claims one solution, but the count did not finish inside the budget');
    broken += 1;
  } else if (found !== 1) {
    console.log('L' + level + ': claims one solution, found ' + found);
    broken += 1;
  }
}

console.log('');
console.log('checked  ' + checked + ' levels (every ' + step + ')');
console.log('verified ' + verifiedClaims + ' claims re-counted, ' + unproven + ' unverified levels skipped');
console.log('problems ' + broken);
console.log('elapsed  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
process.exit(broken ? 1 : 0);
