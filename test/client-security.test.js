// Regression guard: server-mode achievement rewards must not trust browser-only stats.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('in cloud mode the achievements UI is driven by the server list, never by local stats', () => {
  // الصفوف تُبنى من profile.achievements (الخادم) عند الاتصال، ومن القائمة المحلية فقط دون خادم
  assert.match(html, /const rows = cloud\s*\? cloud\.items\.map\(/);
  assert.match(html, /: ADV_ACHIEVEMENTS\.map\(\(a\) => \(\{ id: a\.id/);
  assert.match(html, /btn\.disabled = a\.claimed \|\| !a\.met;/);
});

test('claimAchievement never grants cloud gold from local stats: the server path claims through the ops queue and returns before the local branch', () => {
  const start = html.indexOf('function claimAchievement(id)');
  const end = html.indexOf('// 🛠️ ترقيات المغامرة الدائمة', start);
  assert.ok(start >= 0 && end > start, 'achievement claim function should exist');
  const fn = html.slice(start, end);
  const cloud = fn.indexOf('const cloud = serverAchievements();');
  const queue = fn.indexOf("enqueueOp({ type: 'achievement', id, expected: a.gold })");
  const localAward = fn.indexOf('state.gold += a.reward');
  assert.ok(cloud >= 0 && queue > cloud, 'cloud claims go through the sequenced ops queue');
  assert.ok(localAward > queue, 'the local (offline) award comes after the cloud branch');
  assert.match(fn.slice(queue, localAward), /return;/, 'the cloud branch must exit before the local award');
  assert.match(fn.slice(cloud, queue), /if \(!a \|\| a\.claimed \|\| !a\.done\) \{ haptic\('error'\); return; \}/, 'only what the server marked done can be claimed');
});


test('cloud bootstrap keeps offline backup but never requests trusted migration', () => {
  assert.match(html, /localStorage\.setItem\('mining_offline_backup', JSON\.stringify\(state\)\)/);
  assert.doesNotMatch(html, /migrate:|saveToServer\(true\)/);
});


test('all inline browser scripts are syntactically valid', () => {
  const { Script } = require('node:vm');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  for (const [, code] of scripts) new Script(code);
});


function raceConnectionHarness() {
  const vm = require('node:vm');
  const start = html.indexOf('    function ensureRaceSocket() {');
  const end = html.indexOf('    function handleRaceMessage', start);
  assert.ok(start >= 0 && end > start);
  const instances = [];
  const timers = new Map();
  let timerId = 0;
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; instances.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(data) { this.onmessage?.({ data }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const race = { ws: null, connecting: null, inRace: false };
  const context = vm.createContext({
    race, WebSocket: FakeSocket, tg: null, guestId: 'test',
    location: { protocol: 'https:', host: 'example.test' },
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    handleRaceMessage: (msg) => { if (msg.type === 'welcome') race.myId = msg.id; },
    raceStatus: () => {},
  });
  const ensure = vm.runInContext(`(${html.slice(start, end).trim()})`, context);
  return { race, instances, timers, ensure };
}

test('browser race connection waits for welcome, not transport open', async () => {
  const h = raceConnectionHarness();
  let ready = false;
  const pending = h.ensure().then(() => { ready = true; });
  const socket = h.instances[0];
  socket.open();
  for (const data of ['null', '[]', '{', '{"type":"waiting"}']) socket.message(data);
  await Promise.resolve();
  assert.equal(ready, false);
  socket.message('{"type":"welcome","id":"player"}');
  await pending;
  assert.equal(h.race.socketReady, true);
  assert.equal(h.race.myId, 'player');
  assert.equal(h.timers.size, 0);
});

test('browser concurrent race actions share one readiness promise and socket', async () => {
  const h = raceConnectionHarness();
  const first = h.ensure();
  h.instances[0].open();
  assert.equal(h.ensure(), first);
  assert.equal(h.instances.length, 1);
  h.instances[0].message('{"type":"welcome","id":"player"}');
  await first;
  await h.ensure();
  assert.equal(h.instances.length, 1);
});

test('browser close before welcome rejects readiness and permits reconnection', async () => {
  const h = raceConnectionHarness();
  const first = h.ensure();
  const rejected = assert.rejects(first, /قبل تجهيز السباق/);
  h.instances[0].open(); h.instances[0].close();
  await rejected;
  assert.equal(h.race.connecting, null);
  assert.equal(h.race.socketReady, false);
  const retry = h.ensure();
  assert.equal(h.instances.length, 2);
  h.instances[1].open();
  h.instances[1].message('{"type":"welcome","id":"player"}');
  await retry;
});

test('browser welcome timeout releases readiness and ignores stale socket messages', async () => {
  const h = raceConnectionHarness();
  const first = h.ensure();
  const rejected = assert.rejects(first, /مهلة/);
  h.instances[0].open();
  [...h.timers.values()][0]();
  await rejected;
  assert.equal(h.race.connecting, null);
  const retry = h.ensure();
  h.instances[0].message('{"type":"welcome","id":"stale"}');
  assert.equal(h.race.socketReady, false);
  h.instances[1].open();
  h.instances[1].message('{"type":"welcome","id":"current"}');
  await retry;
  assert.equal(h.race.myId, 'current');
});
