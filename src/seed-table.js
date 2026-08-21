'use strict';

// Binary seed table for Pipelines.
//
// A level is generated from (size, colours, seed) and nothing else, so a level
// that has been verified offline needs only those three numbers to be rebuilt
// bit for bit in the browser. That makes the table a flat array of fixed-size
// records: level N lives at a known offset, so serving one is a slice, never a
// parse, and the whole file for a million levels is 8 MB.
//
//   header (40 bytes)
//     0  magic      'PLSEEDS1'
//     8  u16        format version
//    10  u16        record size
//    12  u32        record count
//    16  u32        first level (records are contiguous from here)
//    20  u32        build id, changes every build so caches can tell them apart
//    24  f64        build time, ms since the epoch
//    32  u32        generator version: which build of the generator made these
//    36  u32        reserved
//
// The generator version is the important one. A seed only means anything to
// the code that produced it, so a table built before a change to how boards
// are cut or climbed describes different boards afterwards -- silently, and
// with its verification no longer true of what the player sees. The game
// compares this against its own constant and ignores a table that disagrees.
//
//   record (8 bytes)
//     0  u32        seed
//     4  u8         board size
//     5  u8         pipe count
//     6  u8         flags: bit 0 = verified as having exactly one solution
//     7  u8         reserved

const fs = require('node:fs');

const MAGIC = 'PLSEEDS1';
const VERSION = 1;
const HEADER_SIZE = 40;
const RECORD_SIZE = 8;
const FLAG_VERIFIED = 1;

function encodeHeader(header) {
  const buf = Buffer.alloc(HEADER_SIZE);
  buf.write(MAGIC, 0, 'latin1');
  buf.writeUInt16LE(VERSION, 8);
  buf.writeUInt16LE(RECORD_SIZE, 10);
  buf.writeUInt32LE(header.count, 12);
  buf.writeUInt32LE(header.firstLevel, 16);
  buf.writeUInt32LE(header.buildId, 20);
  buf.writeDoubleLE(header.generatedAt, 24);
  buf.writeUInt32LE(header.generator >>> 0, 32);
  return buf;
}

function decodeHeader(buf) {
  if (buf.length < HEADER_SIZE || buf.toString('latin1', 0, 8) !== MAGIC) {
    throw new Error('not a Pipelines seed table');
  }
  const version = buf.readUInt16LE(8);
  if (version !== VERSION) throw new Error('unsupported seed table version ' + version);
  const recordSize = buf.readUInt16LE(10);
  if (recordSize !== RECORD_SIZE) throw new Error('unexpected record size ' + recordSize);
  return {
    version: version,
    recordSize: recordSize,
    count: buf.readUInt32LE(12),
    firstLevel: buf.readUInt32LE(16),
    buildId: buf.readUInt32LE(20),
    generatedAt: buf.readDoubleLE(24),
    generator: buf.readUInt32LE(32),
  };
}

function encodeRecord(buf, offset, record) {
  buf.writeUInt32LE(record.seed >>> 0, offset);
  buf.writeUInt8(record.size, offset + 4);
  buf.writeUInt8(record.colors, offset + 5);
  buf.writeUInt8(record.verified ? FLAG_VERIFIED : 0, offset + 6);
  buf.writeUInt8(0, offset + 7);
}

function decodeRecord(buf, offset) {
  return {
    seed: buf.readUInt32LE(offset),
    size: buf.readUInt8(offset + 4),
    colors: buf.readUInt8(offset + 5),
    verified: (buf.readUInt8(offset + 6) & FLAG_VERIFIED) !== 0,
  };
}

// ------------------------------------------------------------------- writing

// Records are buffered and written a chunk at a time: a build that appended
// every level as it finished would be millions of tiny writes, and the header
// only becomes true once, at the end.
class TableWriter {
  constructor(filePath, options) {
    const opts = options || {};
    this.path = filePath;
    this.chunkRecords = Math.max(1, opts.chunkRecords || 4096);
    this.chunk = Buffer.alloc(this.chunkRecords * RECORD_SIZE);
    this.pending = 0;
    this.header = {
      count: 0,
      firstLevel: opts.firstLevel || 1,
      buildId: (opts.buildId || ((Math.random() * 0xffffffff) >>> 0)) >>> 0,
      generatedAt: Date.now(),
      generator: (opts.generator || 0) >>> 0,
    };

    if (opts.resume && fs.existsSync(filePath)) {
      this.fd = fs.openSync(filePath, 'r+');
      const head = Buffer.alloc(HEADER_SIZE);
      fs.readSync(this.fd, head, 0, HEADER_SIZE, 0);
      const existing = decodeHeader(head);
      if (this.header.generator && existing.generator !== this.header.generator) {
        throw new Error('cannot resume: that table was built by generator version ' +
          existing.generator + ', this one is ' + this.header.generator);
      }
      this.header.firstLevel = existing.firstLevel;
      this.header.buildId = existing.buildId;
      this.header.count = existing.count;
      // Anything past the recorded count is a half-written chunk from a build
      // that was interrupted; drop it so appends stay aligned.
      fs.ftruncateSync(this.fd, HEADER_SIZE + existing.count * RECORD_SIZE);
      this.offset = HEADER_SIZE + existing.count * RECORD_SIZE;
    } else {
      this.fd = fs.openSync(filePath, 'w');
      fs.writeSync(this.fd, encodeHeader(this.header), 0, HEADER_SIZE, 0);
      this.offset = HEADER_SIZE;
    }
  }

  // Levels must arrive in order; the caller owns the reordering.
  append(record) {
    encodeRecord(this.chunk, this.pending * RECORD_SIZE, record);
    this.pending += 1;
    this.header.count += 1;
    if (this.pending === this.chunkRecords) this.flush();
  }

  flush() {
    if (!this.pending) return;
    const bytes = this.pending * RECORD_SIZE;
    fs.writeSync(this.fd, this.chunk, 0, bytes, this.offset);
    this.offset += bytes;
    this.pending = 0;
  }

  // Rewrites the header so a torn-off build still reads as the levels it
  // actually finished, then syncs: this is the only durability point.
  close() {
    if (this.fd === null) return this.header;
    this.flush();
    fs.writeSync(this.fd, encodeHeader(this.header), 0, HEADER_SIZE, 0);
    fs.fsyncSync(this.fd);
    fs.closeSync(this.fd);
    this.fd = null;
    return this.header;
  }

  get resumeFrom() {
    return this.header.firstLevel + this.header.count;
  }
}

// ------------------------------------------------------------------- reading

// The file is small enough to hold whole (8 MB per million levels), so the
// server reads it once and answers from memory. mtime is re-checked at most
// once a poll interval, which is what lets a rebuild land without a restart.
class TableReader {
  constructor(filePath, options) {
    const opts = options || {};
    this.path = filePath;
    this.pollMs = opts.pollMs === undefined ? 5000 : opts.pollMs;
    this.buffer = null;
    this.header = null;
    this.error = null;
    this.mtimeMs = 0;
    this.checkedAt = 0;
    this.load();
  }

  load() {
    try {
      const stat = fs.statSync(this.path);
      this.buffer = fs.readFileSync(this.path);
      this.header = decodeHeader(this.buffer);
      this.mtimeMs = stat.mtimeMs;
      this.error = null;
    } catch (err) {
      this.buffer = null;
      this.header = null;
      this.error = err;
    }
    this.checkedAt = Date.now();
  }

  refresh() {
    if (Date.now() - this.checkedAt < this.pollMs) return;
    this.checkedAt = Date.now();
    try {
      const stat = fs.statSync(this.path);
      if (stat.mtimeMs !== this.mtimeMs) this.load();
    } catch (err) {
      if (this.buffer) this.load(); // the file went away; report it as missing
    }
  }

  get available() {
    this.refresh();
    return this.buffer !== null;
  }

  get info() {
    this.refresh();
    if (!this.header) return null;
    return {
      total: this.header.count,
      firstLevel: this.header.firstLevel,
      buildId: this.header.buildId,
      generatedAt: this.header.generatedAt,
      generator: this.header.generator,
    };
  }

  get(level) {
    this.refresh();
    if (!this.header) return null;
    const index = level - this.header.firstLevel;
    if (!Number.isInteger(index) || index < 0 || index >= this.header.count) return null;
    const record = decodeRecord(this.buffer, HEADER_SIZE + index * RECORD_SIZE);
    record.level = level;
    return record;
  }

  range(from, count) {
    const out = [];
    for (let level = from; level < from + count; level += 1) {
      const record = this.get(level);
      if (record) out.push(record);
    }
    return out;
  }
}

module.exports = {
  MAGIC: MAGIC,
  VERSION: VERSION,
  HEADER_SIZE: HEADER_SIZE,
  RECORD_SIZE: RECORD_SIZE,
  TableWriter: TableWriter,
  TableReader: TableReader,
  decodeHeader: decodeHeader,
  decodeRecord: decodeRecord,
};
