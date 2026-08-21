'use strict';

// Pre-compiles a Pipelines seed table.
//
// A board is a pure function of (size, colours, seed), so verifying one offline
// and recording its seed lets the browser rebuild exactly that board without
// repeating the search. That is the only way the big boards get a guarantee:
// counting the solutions of an 11x11 takes longer than a page load can spare,
// and a 12x12 can take longer than a player would ever wait.
//
// The search walks each level's pipe ladder from sparse to dense and keeps the
// first board with exactly one solution -- sparse first because few long pipes
// on a big board is the interesting kind of level and also the hard kind to
// pin down. A level that will not verify inside its time budget is still
// written, marked unverified, with the best-formed board found; it is always
// completable, it just has not been proven singular.
//
//   node tools/build-seeds.js --levels 20000 --jobs 64
//
// Run with --help for the full set of knobs.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { fork } = require('node:child_process');

const seedTable = require('../src/seed-table.js');
const pipelines = require('../public/games/pipelines/game.js');

const DEFAULTS = {
  levels: 10000,
  from: 1,
  out: path.join(__dirname, '..', 'data', 'pipelines-seeds.bin'),
  jobs: Math.max(1, os.cpus().length),
  block: 32, // levels handed to a worker at a time
  chunk: 4096, // records buffered before a write
  levelTimeout: 20000, // ms of searching before a level settles for what it has
  maxSeeds: 20000, // seeds tried per rung of the pipe ladder
  stepBudget: 3000000, // solver steps before a count is abandoned
  resume: false,
  quiet: false,
};

function parseArgs(argv) {
  const opts = Object.assign({}, DEFAULTS);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--resume') { opts.resume = true; continue; }
    if (arg === '--quiet') { opts.quiet = true; continue; }
    const eq = arg.indexOf('=');
    const key = (eq === -1 ? arg : arg.slice(0, eq))
      .replace(/^--/, '')
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const raw = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (!(key in DEFAULTS)) {
      console.error('unknown option: ' + arg);
      process.exit(2);
    }
    opts[key] = key === 'out' ? raw : Number(raw);
    if (key !== 'out' && !Number.isFinite(opts[key])) {
      console.error('option --' + key + ' needs a number');
      process.exit(2);
    }
  }
  return opts;
}

function usage() {
  console.log([
    'Usage: node tools/build-seeds.js [options]',
    '',
    '  --levels N          how many levels to build (default ' + DEFAULTS.levels + ')',
    '  --from N            first level number (default 1)',
    '  --out PATH          output file (default data/pipelines-seeds.bin)',
    '  --jobs N            worker processes (default: one per core)',
    '  --block N           levels per work unit (default ' + DEFAULTS.block + ')',
    '  --chunk N           records buffered per file write (default ' + DEFAULTS.chunk + ')',
    '  --level-timeout MS  search budget per level (default ' + DEFAULTS.levelTimeout + ')',
    '  --max-seeds N       seeds tried per pipe count (default ' + DEFAULTS.maxSeeds + ')',
    '  --step-budget N     solver steps before a count is abandoned (default ' + DEFAULTS.stepBudget + ')',
    '  --resume            continue an interrupted build of the same file',
    '  --quiet             no progress output',
  ].join('\n'));
}

// ------------------------------------------------------------------ searching

// Shared by the worker and by --jobs 1 runs.
function searchLevel(level, opts) {
  const size = pipelines.sizeForLevel(level);
  const ladder = pipelines.pipeLadder(level, size);
  const started = Date.now();
  const perRung = Math.max(1, Math.floor(opts.levelTimeout / ladder.length));
  let fallback = null;

  for (let rung = 0; rung < ladder.length; rung += 1) {
    const colors = ladder[rung];
    // Each rung gets its own slice of the budget, so a hopeless sparse target
    // cannot eat the whole level and leave nothing for the counts that would
    // have succeeded a pipe or two denser.
    const deadline = started + perRung * (rung + 1);
    for (let attempt = 0; attempt < opts.maxSeeds; attempt += 1) {
      if (Date.now() > deadline) break;
      const seed = pipelines.seedFor(level, colors, attempt);
      const board = pipelines.buildBoard(size, colors, seed);
      if (!board) break; // this pipe count does not fit the board at all
      // Only touch-free boards are worth counting: a pipe that runs alongside
      // itself can be short-cut, and in testing no board with one ever came
      // back singular -- while being the slowest kind to give up on.
      if (board.touches === 0) {
        const found = pipelines.countSolutions(board.endA, board.endB, true, opts.stepBudget);
        if (found === 1 && !pipelines.wasAborted()) {
          return { seed: seed, size: size, colors: colors, verified: true, touches: 0 };
        }
      }
      if (!fallback || board.touches < fallback.touches) {
        fallback = { seed: seed, size: size, colors: colors, verified: false, touches: board.touches };
      }
    }
  }
  if (fallback) return fallback;
  // Nothing was built at all, which means the ladder does not fit this board.
  // Record the densest rung so the level still has a definition; the browser
  // rebuilds it the same way and simply gets an unverified board.
  const colors = ladder[ladder.length - 1];
  return { seed: pipelines.seedFor(level, colors, 0), size: size, colors: colors, verified: false, touches: 255 };
}

// -------------------------------------------------------------------- worker

if (process.env.PIPELINES_SEED_WORKER === '1') {
  process.on('message', (msg) => {
    if (msg.type === 'stop') process.exit(0);
    const records = [];
    for (let level = msg.from; level < msg.from + msg.count; level += 1) {
      records.push(searchLevel(level, msg.opts));
    }
    process.send({ type: 'done', from: msg.from, records: records });
  });
  process.send({ type: 'ready' });
  return;
}

// -------------------------------------------------------------------- parent

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 90) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 90) return m + 'm ' + (s % 60) + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });

  const writer = new seedTable.TableWriter(opts.out, {
    firstLevel: opts.from,
    chunkRecords: opts.chunk,
    resume: opts.resume,
    generator: pipelines.generatorVersion,
  });
  let nextToAssign = writer.resumeFrom;
  const lastLevel = opts.from + opts.levels - 1;
  let nextToWrite = nextToAssign;
  const alreadyDone = nextToAssign - opts.from;

  if (alreadyDone > 0 && !opts.quiet) {
    console.error('resuming at level ' + nextToAssign + ' (' + alreadyDone + ' already built)');
  }
  if (nextToAssign > lastLevel) {
    console.error('nothing to do: the table already covers level ' + lastLevel);
    writer.close();
    return;
  }

  const jobs = Math.max(1, Math.min(opts.jobs, Math.ceil((lastLevel - nextToAssign + 1) / opts.block)));
  const pending = new Map(); // block start -> records, held until writable in order
  const stats = { done: 0, verified: 0, sparse: 0, bySize: new Map() };
  const startedAt = Date.now();
  let closed = false;

  function record(records) {
    records.forEach((rec) => {
      stats.done += 1;
      if (rec.verified) stats.verified += 1;
      const range = pipelines.pipeRange(rec.size);
      if (rec.colors === range.sparse) stats.sparse += 1;
      const bucket = stats.bySize.get(rec.size) || { n: 0, verified: 0, pipes: 0 };
      bucket.n += 1;
      bucket.verified += rec.verified ? 1 : 0;
      bucket.pipes += rec.colors;
      stats.bySize.set(rec.size, bucket);
    });
  }

  // Workers finish out of order; the file must not. Buffer completed blocks
  // and drain whatever contiguous run starts at the next unwritten level.
  function drain() {
    while (pending.has(nextToWrite)) {
      const records = pending.get(nextToWrite);
      pending.delete(nextToWrite);
      for (const rec of records) writer.append(rec);
      nextToWrite += records.length;
    }
  }

  function finish(reason) {
    if (closed) return;
    closed = true;
    drain();
    const header = writer.close();
    for (const child of children) child.kill();
    if (!opts.quiet) report(header, reason);
  }

  function report(header, reason) {
    const elapsed = Date.now() - startedAt;
    console.error('');
    console.error(reason === 'signal' ? 'interrupted -- table is valid up to what it holds' : 'done');
    console.error('  file      ' + path.resolve(opts.out));
    console.error('  levels    ' + header.count + ' (levels ' + header.firstLevel + '..' + (header.firstLevel + header.count - 1) + ')');
    console.error('  verified  ' + stats.verified + '/' + stats.done + ' of this run');
    console.error('  sparsest  ' + stats.sparse + ' levels kept their board\'s longest pipes');
    console.error('  build id  ' + header.buildId + ' (generator v' + header.generator + ')');
    console.error('  elapsed   ' + formatDuration(elapsed));
    const sizes = [...stats.bySize.keys()].sort((a, b) => a - b);
    for (const size of sizes) {
      const b = stats.bySize.get(size);
      console.error('    ' + size + 'x' + size + ': ' + b.n + ' levels, ' +
        b.verified + ' verified, ' + (b.pipes / b.n).toFixed(1) + ' pipes avg');
    }
  }

  let lastTick = 0;
  function tick() {
    if (opts.quiet || Date.now() - lastTick < 2000) return;
    lastTick = Date.now();
    const elapsed = Date.now() - startedAt;
    const total = lastLevel - opts.from + 1 - alreadyDone;
    const rate = stats.done / (elapsed / 1000);
    const eta = rate > 0 ? ((total - stats.done) / rate) * 1000 : 0;
    process.stderr.write('\r' + [
      stats.done + '/' + total + ' levels',
      (100 * stats.done / total).toFixed(1) + '%',
      rate.toFixed(1) + '/s',
      'verified ' + (100 * stats.verified / Math.max(1, stats.done)).toFixed(0) + '%',
      'eta ' + formatDuration(eta),
    ].join('  ') + '   ');
  }

  function assign(child) {
    if (nextToAssign > lastLevel) {
      child.send({ type: 'stop' });
      return false;
    }
    const from = nextToAssign;
    const count = Math.min(opts.block, lastLevel - from + 1);
    nextToAssign += count;
    child.send({ type: 'work', from: from, count: count, opts: {
      levelTimeout: opts.levelTimeout,
      maxSeeds: opts.maxSeeds,
      stepBudget: opts.stepBudget,
    } });
    return true;
  }

  const children = [];
  let live = 0;
  for (let i = 0; i < jobs; i += 1) {
    const child = fork(__filename, [], { env: Object.assign({}, process.env, { PIPELINES_SEED_WORKER: '1' }) });
    children.push(child);
    live += 1;
    child.on('message', (msg) => {
      if (msg.type === 'ready') {
        assign(child);
        return;
      }
      pending.set(msg.from, msg.records);
      record(msg.records);
      drain();
      tick();
      assign(child);
    });
    child.on('exit', (code) => {
      if (code && !closed) console.error('\nworker exited with code ' + code + '; its block is missing and the file stops before it');
      live -= 1;
      if (live === 0) finish('complete');
    });
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { finish('signal'); process.exit(130); });
  }

  if (!opts.quiet) {
    console.error('building levels ' + nextToAssign + '..' + lastLevel + ' with ' + jobs + ' workers');
  }
}

main();
