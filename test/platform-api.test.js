const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createStore } = require('../db');
const R = require('../public/platform-rules');
const solution = require('./fixtures/platform-solution.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-platform-'));
const file = path.join(dir, 'game.db'), url = process.env.TEST_DATABASE_URL || '';
const ports = [3231, 3232];
let children = [], store;
const runId = `${process.pid}_${Date.now()}`;
const user = name => `platform_${runId}_${name}`;
const headers = name => ({ 'X-Guest-Id': user(name), 'Content-Type': 'application/json' });
async function launch(port) {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BOT_TOKEN: '', BOT_MODE: 'polling', STARS_ENABLED: 'false', DATABASE_URL: url, DATABASE_FILE: file }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child); let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child; } catch (_) {}
    if (child.exitCode !== null) throw new Error(output);
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(output);
}
async function stop(child) { if (child?.exitCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await done; } }
async function post(name, route, body = {}, port = ports[0]) {
  const res = await fetch(`http://127.0.0.1:${port}/api/platform/${route}`, { method: 'POST', headers: headers(name), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function historical(name, elapsedMs) {
  await post(name, 'start');
  const s = solution();
  const row = { id: crypto.randomUUID(), user_id: `guest_${user(name)}`, version: R.VERSION, status: 'playing', started_at: Date.now() - (elapsedMs ?? s.state.tick / 60 * 1000) - 2000 };
  await store.withUsers([row.user_id], async () => {
    const active = await store.activePlatformRun(row.user_id); active.status = 'expired'; await store.savePlatformRun(active);
    await store.savePlatformRun(row);
  });
  return { id: row.id, inputs: s.inputs };
}
before(async () => {
  await launch(ports[0]); await launch(ports[1]);
  const oldFile = process.env.DATABASE_FILE, oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_FILE = file; process.env.DATABASE_URL = url; store = createStore();
  if (oldFile === undefined) delete process.env.DATABASE_FILE; else process.env.DATABASE_FILE = oldFile;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});
after(async () => { await Promise.all(children.map(stop)); await store?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('platform API: auth required and concurrent repeated start returns one ticket', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${ports[0]}/api/platform/start`, {method:'POST'})).status, 401);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => post('tickets', 'start', {}, ports[i % 2])));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(new Set(results.map(r => r.body.id)).size, 1);
  assert.equal(results[0].body.version, R.VERSION);
});
test('platform API: fake score, premature finish, malformed inputs, unfinished level and wrong owner cannot reward', async () => {
  const fresh = (await post('forgery', 'start')).body;
  const inputs = solution().inputs;
  assert.equal((await post('forgery', 'finish', { id: fresh.id, inputs, gold: 999999, won: true })).status, 409);
  assert.equal((await post('forgery', 'finish', { id: fresh.id, inputs: [{ mask: 31, frames: 5 }] })).status, 400);
  assert.equal((await post('forgery', 'finish', { id: fresh.id, inputs: [{ mask: 0, frames: 5 }], score: 999999 })).status, 400);
  assert.equal((await post('other-user', 'finish', { id: fresh.id, inputs })).status, 404);
  assert.equal((await store.getUser(`guest_${user('forgery')}`)).state.gold, 0);
});
test('platform API: failure rolls back receipt and balance; two processes confirm one reward and persistent result', async () => {
  const payload = await historical('winner');
  const s = solution().state;
  // Real transaction failure independent of HTTP transport.
  await assert.rejects(store.withUsers([`guest_${user('winner')}`], async () => {
    const row = await store.getPlatformRun(payload.id); row.status = 'finished'; row.result_json = '{}'; await store.savePlatformRun(row);
    const u = await store.getUser(row.user_id); u.state.gold += 10000; await store.putUser(u);
    throw new Error('simulated-commit-failure');
  }), /simulated-commit-failure/);
  assert.equal((await store.getPlatformRun(payload.id)).status, 'playing');
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => post('winner', 'finish', { ...payload, gold: 1000000, gems: 100000, won: true }, ports[i % 2])));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(results.filter(r => !r.body.duplicate).length, 1);
  assert.ok(results.every(r => r.body.gold === R.rewardFor(s)));
  const saved = await store.getUser(`guest_${user('winner')}`);
  assert.equal(saved.state.gold, 98); assert.equal(saved.state.adventure.runs, 1);
  assert.equal(saved.state.adventure.gems, s.collected); assert.equal(saved.state.adventure.bossWins, 0);
  await stop(children[0]); children[0] = await launch(ports[0]);
  const duplicate = await post('winner', 'finish', payload);
  assert.equal(duplicate.body.duplicate, true); assert.equal(duplicate.body.profile.state.gold, 98);
  assert.equal((await store.getUser(saved.id)).state.adventure.runs, 1);
});
test('platform API: respects the existing shared adventure reward cooldown', async () => {
  const payload = await historical('cooldown');
  await store.withUsers([`guest_${user('cooldown')}`], async () => {
    const u = await store.getUser(`guest_${user('cooldown')}`);
    u.sync.lastRewardAt.adventure = Date.now(); await store.putUser(u);
  });
  const result = await post('cooldown', 'finish', payload);
  assert.equal(result.status, 200); assert.equal(result.body.won, true);
  assert.equal(result.body.gold, 0); assert.equal(result.body.reason, 'cooldown');
  assert.equal((await store.getUser(`guest_${user('cooldown')}`)).state.gold, 0);
});

test('platform API: timeout loss closes once without gold, expired ticket cannot reward', async () => {
  const payload = await historical('loss');
  await store.withUsers([`guest_${user('loss')}`], async () => {
    const old = await store.getPlatformRun(payload.id); old.status = 'expired'; await store.savePlatformRun(old);
  });
  assert.equal((await post('loss', 'finish', payload)).status, 409);
  const id = crypto.randomUUID();
  await store.withUsers([`guest_${user('loss')}`], () => store.savePlatformRun({id,user_id:`guest_${user('loss')}`,version:R.VERSION,status:'playing',started_at:Date.now()-R.MAX_TICKS/60*1000-2000}));
  const loss = await post('loss', 'finish', {id,inputs:[{mask:0,frames:R.MAX_TICKS}]});
  assert.equal(loss.status, 200); assert.equal(loss.body.won, false); assert.equal(loss.body.gold, 0);
  assert.equal((await store.getUser(`guest_${user('loss')}`)).state.gold, 0);
});

test('platform API: a confirmed win is immutable under changed inputs, stolen IDs and ID reuse', async () => {
  const payload = await historical('immutable-win');
  const first = await post('immutable-win', 'finish', payload);
  assert.equal(first.status, 200); assert.equal(first.body.gold, 98);
  const owner = `guest_${user('immutable-win')}`;
  const before = await store.getUser(owner);
  const receipt = await store.getPlatformRun(payload.id);
  const changed = await post('immutable-win', 'finish', {
    id: payload.id, inputs: [{ mask: 0, frames: R.MAX_TICKS }], gold: 999999, score: 999999, won: false,
  }, ports[1]);
  assert.equal(changed.status, 200); assert.equal(changed.body.duplicate, true);
  for (const key of ['id', 'won', 'gold', 'xp', 'score', 'gems', 'mined', 'duration']) assert.equal(changed.body[key], first.body[key]);
  assert.deepEqual((await store.getUser(owner)).state, before.state);
  assert.equal((await store.getUser(owner)).revision, before.revision);
  assert.deepEqual(await store.getPlatformRun(payload.id), receipt);
  assert.equal((await post('stolen-ticket', 'finish', payload)).status, 404);
  assert.equal((await post('immutable-win', 'finish', { ...payload, id: crypto.randomUUID() })).status, 404);
  const next = await post('immutable-win', 'start', { id: payload.id });
  assert.equal(next.status, 200); assert.notEqual(next.body.id, payload.id);
  assert.equal((await post('immutable-win', 'finish', payload)).body.duplicate, true);
  assert.deepEqual((await store.getUser(owner)).state, before.state);
});

test('platform API: a confirmed legal loss cannot be upgraded to a win by replacing the input log', async () => {
  // Fixture-only ageing at INSERT: started_at is intentionally immutable on UPSERT.
  const payload = await historical('immutable-loss', R.MAX_TICKS / R.FPS * 1000);
  const owner = `guest_${user('immutable-loss')}`;
  const loss = await post('immutable-loss', 'finish', {
    id: payload.id, inputs: [{ mask: 0, frames: R.MAX_TICKS }], gold: 999999, won: true,
  });
  assert.equal(loss.status, 200); assert.equal(loss.body.won, false); assert.equal(loss.body.gold, 0);
  const before = await store.getUser(owner);
  const swapped = await post('immutable-loss', 'finish', payload, ports[1]);
  assert.equal(swapped.status, 200); assert.equal(swapped.body.duplicate, true);
  assert.equal(swapped.body.won, false); assert.equal(swapped.body.gold, 0);
  assert.deepEqual((await store.getUser(owner)).state, before.state);
  assert.equal((await store.getUser(owner)).state.adventure.runs, 1);
});
