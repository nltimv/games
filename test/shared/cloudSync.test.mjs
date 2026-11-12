import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../../public/shared/js/storage.js';
import { createCloudSync, decideSync, shouldOfferMigration } from '../../public/shared/js/cloudSync.js';

const played = { fresh: false };
const meta = (patch) => ({ revision: 3, dirty: false, device: 'me', ...patch });

test('decideSync: no cloud save pushes, an empty device pulls', () => {
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
  // Logged in on a device that already has a company: both have progress.
  assert.equal(decideSync({ local: played, cloud: { revision: 1, device: 'other' }, meta: meta({ revision: 0, dirty: true }) }), 'conflict');
});

test('decideSync: the cloud holding this device’s own last write is not a conflict', () => {
  assert.equal(decideSync({ local: played, cloud: { revision: 4, device: 'me' }, meta: meta({ dirty: true }) }), 'adopt');
  // Two writes ahead means another device wrote in between.
  assert.equal(decideSync({ local: played, cloud: { revision: 5, device: 'me' }, meta: meta({ dirty: true }) }), 'conflict');
  assert.equal(decideSync({ local: played, cloud: { revision: 2 }, meta: meta() }), 'conflict');
});

test('migration offer: once, for a played local save, when logged out', () => {
  const m = { signedIn: false, prompted: false };
  assert.equal(shouldOfferMigration({ enabled: true, meta: m, local: played }), true);
  assert.equal(shouldOfferMigration({ enabled: false, meta: m, local: played }), false);
  assert.equal(shouldOfferMigration({ enabled: true, meta: { ...m, prompted: true }, local: played }), false);
  assert.equal(shouldOfferMigration({ enabled: true, meta: { ...m, signedIn: true }, local: played }), false);
  assert.equal(shouldOfferMigration({ enabled: true, meta: m, local: { fresh: true } }), false);
  assert.equal(shouldOfferMigration({ enabled: true, meta: m, local: null }), false);
});

// A fake server with the same rules as server/cloud.js, shared by "devices".
function fakeServer() {
  const server = { save: null, accounts: new Set(['1111 2222 3333 4444']), online: true };
  server.fetch = async (url, { method, body }) => {
    if (!server.online) throw new TypeError('Failed to fetch');
    const path = url.replace('/api', '');
    const json = body ? JSON.parse(body) : undefined;
    const reply = (status, payload) => ({ status, json: async () => payload ?? null });
    if (path === '/config') return reply(200, { cloud: true, recovery: false });
    if (path === '/account' && method === 'POST') return reply(201, { number: '1111 2222 3333 4444' });
    if (path === '/session' && method === 'POST') return server.accounts.has(json.number) ? reply(204) : reply(401, { error: 'No account has that number.' });
    if (path === '/session') return reply(204);
    if (path.startsWith('/saves/') && method === 'GET') return server.save ? reply(200, server.save) : reply(404);
    if (path.startsWith('/saves/') && method === 'PUT') {
      const revision = server.save?.revision ?? 0;
      if (json.baseRevision !== revision) return reply(409, { revision });
      server.save = { revision: revision + 1, data: json.data, summary: json.summary, device: json.device, updatedAt: 1 };
      return reply(200, { revision: revision + 1 });
    }
    return reply(404);
  };
  return server;
}

const KEY = 'game-save';
function device(server, data) {
  const storage = createMemoryStorage();
  if (data) storage.setItem(KEY, JSON.stringify(data));
  const cloud = createCloudSync({
    game: 'game',
    saveKey: KEY,
    storage,
    fetchFn: server.fetch,
    summarize: (d) => ({ credits: d.credits, fresh: !d.played }),
    canLoad: (d) => d.version <= 1,
  });
  const play = (credits) => cloud.storage.setItem(KEY, JSON.stringify({ version: 1, played: true, credits }));
  const local = () => JSON.parse(storage.getItem(KEY));
  return { cloud, play, local, storage };
}

test('sign up moves the local save to the cloud; autosave pushes changes', async () => {
  const server = fakeServer();
  const phone = device(server, { version: 1, played: true, credits: 100 });
  await phone.cloud.start();
  assert.equal(phone.cloud.status().state, 'signed-out');
  assert.equal(phone.cloud.shouldOfferMigration(), true);
  const { ok, number } = await phone.cloud.signUp();
  assert.ok(ok);
  assert.equal(number, '1111 2222 3333 4444');
  assert.equal(server.save.data.credits, 100);
  assert.equal(phone.cloud.shouldOfferMigration(), false);

  phone.play(150);
  await phone.cloud.sync();
  assert.equal(server.save.revision, 2);
  assert.equal(server.save.data.credits, 150);
  assert.equal(phone.cloud.status().state, 'synced');
});

test('a second device that has not played takes the cloud save; one that played gets the choice', async () => {
  const server = fakeServer();
  server.save = { revision: 4, data: { version: 1, played: true, credits: 900 }, summary: { credits: 900 }, device: 'phone', updatedAt: 1 };

  const fresh = device(server, { version: 1, played: false, credits: 0 });
  await fresh.cloud.start();
  const outcome = await fresh.cloud.logIn('1111 2222 3333 4444');
  assert.deepEqual(outcome, { ok: true, reload: true, conflict: false, outdated: false });
  assert.equal(fresh.local().credits, 900);

  const laptop = device(server, { version: 1, played: true, credits: 50 });
  await laptop.cloud.start();
  const clash = await laptop.cloud.logIn('1111 2222 3333 4444');
  assert.equal(clash.conflict, true);
  const { conflict } = laptop.cloud.status();
  assert.equal(conflict.local.credits, 50);
  assert.equal(conflict.cloud.credits, 900);
  // Nothing was overwritten while the player decides, and autosave waits.
  laptop.play(60);
  await laptop.cloud.sync();
  assert.equal(server.save.data.credits, 900);
  assert.equal(laptop.local().credits, 60);
});

test('conflict choice "this device" writes it to the cloud and keeps the cloud save as a backup', async () => {
  const server = fakeServer();
  server.save = { revision: 2, data: { version: 1, played: true, credits: 900 }, device: 'phone', updatedAt: 1 };
  const laptop = device(server, { version: 1, played: true, credits: 50 });
  await laptop.cloud.start();
  await laptop.cloud.logIn('1111 2222 3333 4444');
  const result = await laptop.cloud.resolve('device');
  assert.equal(result.ok, true);
  assert.equal(server.save.revision, 3);
  assert.equal(server.save.data.credits, 50);
  assert.equal(laptop.cloud.status().backup.data.credits, 900);
  assert.equal(laptop.cloud.status().backup.from, 'cloud');
});

test('conflict choice "cloud" loads it, keeps this device’s save as a backup and blocks stale writes', async () => {
  const server = fakeServer();
  server.save = { revision: 2, data: { version: 1, played: true, credits: 900 }, device: 'phone', updatedAt: 1 };
  const laptop = device(server, { version: 1, played: true, credits: 50 });
  await laptop.cloud.start();
  await laptop.cloud.logIn('1111 2222 3333 4444');
  const result = await laptop.cloud.resolve('cloud');
  assert.deepEqual(result, { ok: true, reload: true });
  assert.equal(laptop.local().credits, 900);
  assert.equal(laptop.cloud.status().backup.data.credits, 50);
  // The running game saving its old state before the reload is ignored.
  laptop.play(51);
  assert.equal(laptop.local().credits, 900);
});

test('a write rejected because another device saved first turns into a conflict', async () => {
  const server = fakeServer();
  const phone = device(server, { version: 1, played: true, credits: 100 });
  await phone.cloud.start();
  await phone.cloud.signUp();
  // Another device saves revision 2 meanwhile.
  server.save = { ...server.save, revision: 2, data: { version: 1, played: true, credits: 7 }, device: 'tablet' };
  phone.play(120);
  await phone.cloud.sync();
  assert.equal(phone.cloud.status().state, 'conflict');
  assert.equal(server.save.data.credits, 7);
});

test('offline play keeps the local save and pushes when the server is back', async () => {
  const server = fakeServer();
  const phone = device(server, { version: 1, played: true, credits: 100 });
  await phone.cloud.start();
  await phone.cloud.signUp();
  server.online = false;
  phone.play(300);
  await phone.cloud.sync();
  assert.equal(phone.cloud.status().state, 'offline');
  assert.equal(phone.local().credits, 300);
  server.online = true;
  await phone.cloud.sync();
  assert.equal(phone.cloud.status().state, 'synced');
  assert.equal(server.save.data.credits, 300);
});

test('a cloud save from a newer game version is never loaded over the local one', async () => {
  const server = fakeServer();
  server.save = { revision: 1, data: { version: 2, played: true, credits: 1 }, device: 'phone', updatedAt: 1 };
  const old = device(server, { version: 1, played: false, credits: 0 });
  await old.cloud.start();
  const outcome = await old.cloud.logIn('1111 2222 3333 4444');
  assert.equal(outcome.outdated, true);
  assert.equal(old.local().credits, 0);
});

test('a wrong number is refused and leaves the device logged out', async () => {
  const server = fakeServer();
  const phone = device(server, { version: 1, played: true, credits: 1 });
  await phone.cloud.start();
  const res = await phone.cloud.logIn('0000 0000 0000 0000');
  assert.equal(res.ok, false);
  assert.equal(phone.cloud.status().signedIn, false);
});
