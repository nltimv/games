import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../../public/shared/js/storage.js';
import { createCloudSync, decideSync, formatCode } from '../../public/shared/js/cloudSync.js';

const played = { fresh: false };
const meta = (patch) => ({ revision: 3, dirty: false, device: 'me', ...patch });

test('decideSync: an empty cloud save gets the local one, an empty device pulls', () => {
  assert.equal(decideSync({ local: played, cloud: null, meta: meta() }), 'push');
  assert.equal(decideSync({ local: null, cloud: null, meta: meta() }), 'none');
  assert.equal(decideSync({ local: null, cloud: { revision: 1 }, meta: meta() }), 'pull');
  assert.equal(decideSync({ local: { fresh: true }, cloud: { revision: 9 }, meta: meta({ dirty: true, revision: 0 }) }), 'pull');
});

test('decideSync: same revision pushes only local changes', () => {
  assert.equal(decideSync({ local: played, cloud: { revision: 3 }, meta: meta() }), 'none');
  assert.equal(decideSync({ local: played, cloud: { revision: 3 }, meta: meta({ dirty: true }) }), 'push');
});

test('decideSync: a newer cloud save is taken only when this device has nothing new', () => {
  assert.equal(decideSync({ local: played, cloud: { revision: 5, device: 'other' }, meta: meta() }), 'pull');
  assert.equal(decideSync({ local: played, cloud: { revision: 5, device: 'other' }, meta: meta({ dirty: true }) }), 'conflict');
});

test('decideSync: the cloud holding this device’s own last write is not a conflict', () => {
  assert.equal(decideSync({ local: played, cloud: { revision: 4, device: 'me' }, meta: meta({ dirty: true }) }), 'adopt');
  // Two writes ahead means another device wrote in between.
  assert.equal(decideSync({ local: played, cloud: { revision: 5, device: 'me' }, meta: meta({ dirty: true }) }), 'conflict');
  assert.equal(decideSync({ local: played, cloud: { revision: 2 }, meta: meta() }), 'conflict');
});

test('codes are shown in groups of four', () => {
  assert.equal(formatCode('1234567890123456'), '1234 5678 9012 3456');
  assert.equal(formatCode('1234-5678 90123456'), '1234 5678 9012 3456');
  assert.equal(formatCode(null), '');
});

// A fake server with the same rules as server/cloud.js, shared by "devices".
function fakeServer() {
  const server = { saves: new Map(), online: true, next: 1000000000000000 };
  server.fetch = async (url, { method, body, headers }) => {
    if (!server.online) throw new TypeError('Failed to fetch');
    const path = url.replace('/api', '');
    const json = body ? JSON.parse(body) : undefined;
    const reply = (status, payload) => ({ status, json: async () => payload ?? null });
    if (path === '/config') return reply(200, { cloud: true, recovery: false });
    if (path === '/saves/game' && method === 'POST') {
      const code = String(server.next++);
      server.saves.set(code, { revision: 0, data: null, summary: {}, device: null, updatedAt: 1 });
      return reply(201, { code: formatCode(code), revision: 0 });
    }
    const save = server.saves.get((headers.authorization ?? '').replace('Code ', ''));
    if (!save) return reply(401, { error: 'No save has that code.' });
    if (method === 'GET') return reply(200, { ...save, hasEmail: false });
    if (method === 'PUT') {
      if (json.baseRevision !== save.revision) return reply(409, { revision: save.revision });
      Object.assign(save, { revision: save.revision + 1, data: json.data, summary: json.summary, device: json.device });
      return reply(200, { revision: save.revision });
    }
    return reply(404);
  };
  return server;
}

const KEY = 'game-slot-a';
const META = 'game-slot-a-cloud';
/** One device holding a save, optionally one added with a code. */
function device(server, data, { code, revision = 0 } = {}) {
  const storage = createMemoryStorage();
  if (data) storage.setItem(KEY, JSON.stringify(data));
  if (code) storage.setItem(META, JSON.stringify({ code, revision, dirty: false }));
  const cloud = createCloudSync({
    game: 'game',
    saveKey: KEY,
    metaKey: META,
    getName: () => 'Aurel Mining',
    storage,
    fetchFn: server.fetch,
    summarize: (d) => ({ credits: d.credits, fresh: !d.played }),
    canLoad: (d) => d.version <= 1,
  });
  const play = (credits) => cloud.storage.setItem(KEY, JSON.stringify({ version: 1, played: true, credits }));
  const local = () => JSON.parse(storage.getItem(KEY));
  return { cloud, play, local, storage };
}
const company = (credits) => ({ version: 1, played: true, credits });

test('a save gets a code on start and goes to the cloud with its name; autosave pushes changes', async () => {
  const server = fakeServer();
  const phone = device(server, company(100));
  await phone.cloud.start();
  const { code, state } = phone.cloud.status();
  assert.match(code, /^\d{16}$/);
  assert.equal(state, 'synced');
  assert.equal(server.saves.get(code).data.credits, 100);
  assert.equal(server.saves.get(code).summary.name, 'Aurel Mining');

  phone.play(150);
  await phone.cloud.sync();
  assert.equal(server.saves.get(code).revision, 2);
  assert.equal(server.saves.get(code).data.credits, 150);
});

test('a new game gets its code before there is anything to save', async () => {
  const server = fakeServer();
  const phone = device(server, null);
  await phone.cloud.start();
  const { code } = phone.cloud.status();
  assert.match(code, /^\d{16}$/);
  assert.equal(server.saves.get(code).revision, 0);
  phone.play(1);
  await phone.cloud.sync();
  assert.equal(server.saves.get(code).data.credits, 1);
});

test('without cloud saves on the server the save stays local and nothing is sent', async () => {
  const server = fakeServer();
  const phone = device(server, company(1));
  await phone.cloud.start({ knownConfig: { cloud: false } });
  assert.deepEqual([phone.cloud.status().enabled, phone.cloud.status().state, phone.cloud.status().code], [false, 'local', null]);
  phone.play(2);
  await phone.cloud.sync();
  assert.equal(server.saves.size, 0);
});

test('a second device with the code takes newer cloud progress when it has none of its own', async () => {
  const server = fakeServer();
  const phone = device(server, company(100));
  await phone.cloud.start();
  const { code } = phone.cloud.status();
  // The laptop added the save with its code at revision 1, and did not play.
  const laptop = device(server, company(100), { code, revision: 1 });
  phone.play(900);
  await phone.cloud.sync();
  await laptop.cloud.start();
  assert.equal(laptop.local().credits, 900);
  assert.equal(laptop.cloud.status().state, 'synced');
});

test('two devices that both played get the choice, and nothing is overwritten meanwhile', async () => {
  const server = fakeServer();
  const phone = device(server, company(100));
  await phone.cloud.start();
  const { code } = phone.cloud.status();
  const laptop = device(server, company(100), { code, revision: 1 });
  await laptop.cloud.start();
  laptop.play(50);
  phone.play(900);
  await phone.cloud.sync();
  await laptop.cloud.sync();

  const { conflict, state } = laptop.cloud.status();
  assert.equal(state, 'conflict');
  assert.equal(conflict.local.credits, 50);
  assert.equal(conflict.cloud.credits, 900);
  laptop.play(60);
  await laptop.cloud.sync();
  assert.equal(server.saves.get(code).data.credits, 900);
  assert.equal(laptop.local().credits, 60);
});

async function conflicted() {
  const server = fakeServer();
  const phone = device(server, company(100));
  await phone.cloud.start();
  const { code } = phone.cloud.status();
  const laptop = device(server, company(100), { code, revision: 1 });
  await laptop.cloud.start();
  laptop.play(50);
  phone.play(900);
  await phone.cloud.sync();
  await laptop.cloud.sync();
  return { server, laptop, save: server.saves.get(code) };
}

test('conflict choice "this device" writes it to the cloud and keeps the cloud save as a backup', async () => {
  const { laptop, save } = await conflicted();
  const result = await laptop.cloud.resolve('device');
  assert.equal(result.ok, true);
  assert.equal(save.revision, 3);
  assert.equal(save.data.credits, 50);
  assert.equal(laptop.cloud.status().backup.data.credits, 900);
  assert.equal(laptop.cloud.status().backup.from, 'cloud');
});

test('conflict choice "cloud" loads it, keeps this device’s save as a backup and blocks stale writes', async () => {
  const { laptop } = await conflicted();
  const result = await laptop.cloud.resolve('cloud');
  assert.deepEqual(result, { ok: true, reload: true });
  assert.equal(laptop.local().credits, 900);
  assert.equal(laptop.cloud.status().backup.data.credits, 50);
  // The running game saving its old state before the reload is ignored.
  laptop.play(51);
  assert.equal(laptop.local().credits, 900);
});

test('offline play keeps the local save and pushes when the server is back', async () => {
  const server = fakeServer();
  const phone = device(server, company(100));
  await phone.cloud.start();
  const { code } = phone.cloud.status();
  server.online = false;
  phone.play(300);
  await phone.cloud.sync();
  assert.equal(phone.cloud.status().state, 'offline');
  assert.equal(phone.local().credits, 300);
  server.online = true;
  await phone.cloud.sync();
  assert.equal(phone.cloud.status().state, 'synced');
  assert.equal(server.saves.get(code).data.credits, 300);
});

test('a save started offline gets its code once the server is reachable', async () => {
  const server = fakeServer();
  server.online = false;
  const phone = device(server, company(5));
  await phone.cloud.start({ knownConfig: { cloud: true } });
  assert.equal(phone.cloud.status().code, null);
  assert.equal(phone.cloud.status().state, 'offline');
  server.online = true;
  await phone.cloud.sync();
  const { code } = phone.cloud.status();
  assert.equal(server.saves.get(code).data.credits, 5);
});

test('a cloud save from a newer game version is never loaded over the local one', async () => {
  const server = fakeServer();
  server.saves.set('1111222233334444', { revision: 2, data: { version: 2, played: true, credits: 1 }, device: 'phone', updatedAt: 1 });
  const old = device(server, company(7), { code: '1111222233334444', revision: 1 });
  await old.cloud.start();
  assert.equal(old.cloud.status().state, 'error');
  assert.equal(old.local().credits, 7);
});

test('a code that stopped working is replaced by a new one, and the save is kept', async () => {
  const server = fakeServer();
  const phone = device(server, company(100));
  await phone.cloud.start();
  const first = phone.cloud.status().code;
  server.saves.delete(first); // recovered by email elsewhere, or deleted
  phone.play(120);
  await phone.cloud.sync();
  await phone.cloud.sync();
  const { code, codeReplaced } = phone.cloud.status();
  assert.notEqual(code, first);
  assert.equal(codeReplaced, true);
  assert.equal(server.saves.get(code).data.credits, 120);
});
