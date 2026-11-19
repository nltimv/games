import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../../public/shared/js/storage.js';
import { analyticsEnabled, bucketMinutes, deviceInfo, initTelemetry, setAnalyticsEnabled, telemetry, track } from '../../public/shared/js/telemetry.js';

function setup({ storage = createMemoryStorage(), nav = { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36', language: 'nl-NL' }, status = 204, fail = false } = {}) {
  let clock = Date.parse('2026-11-19T10:00:00Z');
  const sent = [];
  const fetchFn = async (url, init) => {
    if (fail) throw new Error('offline');
    sent.push({ url, body: JSON.parse(init.body), init });
    return { status, ok: status < 300 };
  };
  const t = initTelemetry({ game: 'snake', version: '1.0.0', storage, fetchFn, nav, now: () => clock, base: '', platform: 'web', autoStart: false, doc: { referrer: '' } });
  return { t, sent, storage, advance: (ms) => (clock += ms) };
}

test('a page opens with a session and app_open, with coarse device facts', async () => {
  const { t, sent } = setup();
  assert.deepEqual(
    t.queue.map((e) => e.name),
    ['session_start', 'app_open'],
  );
  const open = t.queue[1];
  assert.equal(open.props.os, 'windows');
  assert.equal(open.props.browser, 'chrome');
  assert.equal(open.props.lang, 'nl-NL');
  assert.equal(open.props.first_open, true);
  await t.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/events');
  assert.equal(sent[0].body.platform, 'web');
  assert.match(sent[0].body.install_id, /^[0-9a-f-]{36}$/);
  assert.equal(sent[0].body.events[0].game, 'snake');
  assert.equal(sent[0].init.credentials, 'omit');
  assert.equal(t.queue.length, 0);
  t.stop();
});

test('track() goes to the running tracker and never throws', async () => {
  const { t } = setup();
  track('game_started', { mode: 'easy' });
  assert.equal(t.queue.at(-1).name, 'game_started');
  t.stop();
  assert.equal(telemetry(), null);
  assert.doesNotThrow(() => track('game_started'));
});

test('a new session starts after 30 minutes without events', () => {
  const { t, advance } = setup();
  const first = t.queue[0].session_id;
  advance(10 * 60_000);
  track('session_heartbeat');
  assert.equal(t.queue.at(-1).session_id, first);
  advance(45 * 60_000);
  track('session_heartbeat');
  const [start, beat] = t.queue.slice(-2);
  assert.equal(start.name, 'session_start');
  assert.equal(start.props.away_min, 60);
  assert.notEqual(beat.session_id, first);
  t.stop();
});

test('the install id lasts across pages; a second page is not a first open', () => {
  const storage = createMemoryStorage();
  const a = setup({ storage });
  const id = a.t.installId;
  a.t.stop();
  const b = setup({ storage });
  assert.equal(b.t.installId, id);
  assert.equal(b.t.queue.find((e) => e.name === 'app_open').props.first_open, false);
  b.t.stop();
});

test('failed sends are kept and retried; a server without telemetry stops it', async () => {
  const offline = setup({ fail: true });
  await offline.t.flush();
  assert.equal(offline.t.queue.length, 2);
  offline.t.stop();

  const none = setup({ status: 404 });
  await none.t.flush();
  track('game_started');
  await none.t.flush();
  assert.equal(none.sent.length, 1);
  none.t.stop();
});

test('turning usage data off sends a last event, forgets the id and stops', async () => {
  const { t, storage, sent } = setup();
  await t.flush();
  setAnalyticsEnabled(false, { storage });
  await Promise.resolve();
  assert.equal(sent.at(-1).body.events.at(-1).name, 'analytics_off');
  assert.equal(analyticsEnabled({ storage, nav: {} }), false);
  assert.equal(storage.getItem('games-telemetry-id'), null);
  assert.equal(telemetry(), null);
  assert.equal(initTelemetry({ game: 'snake', storage, fetchFn: async () => ({}), nav: {}, autoStart: false }), null);
  setAnalyticsEnabled(true, { storage });
  assert.equal(analyticsEnabled({ storage, nav: {} }), true);
});

test('Global Privacy Control and Do Not Track turn it off', () => {
  const storage = createMemoryStorage();
  assert.equal(analyticsEnabled({ storage, nav: { globalPrivacyControl: true } }), false);
  assert.equal(analyticsEnabled({ storage, nav: { doNotTrack: '1' } }), false);
  assert.equal(initTelemetry({ game: 'snake', storage, fetchFn: async () => ({}), nav: { doNotTrack: '1' }, autoStart: false }), null);
});

test('device facts are coarse', () => {
  const phone = deviceInfo({ nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', maxTouchPoints: 5 }, screen: { width: 393, height: 852 }, doc: {} });
  assert.equal(phone.os, 'ios');
  assert.equal(phone.device, 'phone');
  assert.equal(phone.browser, 'safari');
  assert.equal(phone.screen, '400x850');
  const ipad = deviceInfo({ nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 }, screen: { width: 1024, height: 1366 }, doc: {} });
  assert.equal(ipad.os, 'ios');
  assert.equal(ipad.device, 'tablet');
  assert.equal(bucketMinutes(0), 1);
  assert.equal(bucketMinutes(90 * 60_000), 120);
});
