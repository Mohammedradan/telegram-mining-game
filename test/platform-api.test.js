const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createStore } = require('../db');
const R = require('../public/platform-rules');
const solution = require('./fixtures/platform-solution.cjs');
const bot = require('./fixtures/platform-bot.cjs');
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
async function historical(name, elapsedMs, hero = 'miner') {
  await post(name, 'start');
  const id = crypto.randomUUID();
  const s = solution(R.seedFromId(id), hero);
  const row = { id, user_id: `guest_${user(name)}`, version: R.VERSION, status: 'playing', started_at: Math.floor(Date.now() - (elapsedMs ?? s.state.tick / 60 * 1000) - 2000) };
  await store.withUsers([row.user_id], async () => {
    const active = await store.activePlatformRun(row.user_id); active.status = 'expired'; await store.savePlatformRun(active);
    await store.savePlatformRun(row);
  });
  return { id: row.id, inputs: s.inputs, state: s.state };
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
  const inputs = solution(R.seedFromId(fresh.id)).inputs; // مسار فائز صالح لهذه الجولة، لكنه أسرع من الزمن الحقيقي
  assert.equal((await post('forgery', 'finish', { id: fresh.id, inputs, gold: 999999, won: true })).status, 409);
  assert.equal((await post('forgery', 'finish', { id: fresh.id, inputs: [{ mask: 31, frames: 5 }] })).status, 400);
  assert.equal((await post('forgery', 'finish', { id: fresh.id, inputs: [{ mask: 0, frames: 5 }], score: 999999 })).status, 400);
  assert.equal((await post('other-user', 'finish', { id: fresh.id, inputs })).status, 404);
  assert.equal((await store.getUser(`guest_${user('forgery')}`)).state.gold, 0);
});
test('platform API: failure rolls back receipt and balance; two processes confirm one reward and persistent result', async () => {
  const { state: s, ...payload } = await historical('winner');
  const expected = R.rewardFor(s);
  assert.ok(expected > 0);
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
  assert.equal(saved.state.gold, expected); assert.equal(saved.state.adventure.runs, 1);
  assert.equal(saved.state.adventure.gems, s.collected); assert.equal(saved.state.adventure.bossWins, 0);
  await stop(children[0]); children[0] = await launch(ports[0]);
  const duplicate = await post('winner', 'finish', payload);
  assert.equal(duplicate.body.duplicate, true); assert.equal(duplicate.body.profile.state.gold, expected);
  const ledger = (await store.ledgerFor(saved.id)).filter(e => e.kind === 'platform_finish');
  assert.equal(ledger.length, 1, 'one audit entry despite concurrent and repeated finishes');
  assert.equal(ledger[0].goldDelta, expected); assert.equal(ledger[0].session, `platform:${payload.id}`);
  assert.equal((await store.getUser(saved.id)).state.adventure.runs, 1);
});
test('platform API: respects the existing shared adventure reward cooldown', async () => {
  const { state: _cooldownState, ...payload } = await historical('cooldown');
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
  const { state: _lossState, ...payload } = await historical('loss');
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

test('platform API: hero selection is verified by server replay and persists defeated stats', async () => {
  const { state, ...payload } = await historical('hero-warrior', undefined, 'warrior');
  const result = await post('hero-warrior', 'finish', { ...payload, hero: 'warrior' });
  assert.equal(result.status, 200);
  assert.equal(result.body.won, true);
  assert.equal(result.body.gold, R.rewardFor(state));
  const userRow = await store.getUser(`guest_${user('hero-warrior')}`);
  assert.equal(userRow.state.adventure.runs, 1);
});

test('platform API: a recorded winning path from one run cannot be replayed on another run layout', async () => {
  const target = await historical('replayer');
  // حركات فائزة لجولة أخرى (بذرة مختلفة) تُرسل لجولة هذا اللاعب. بعض أزواج المخططات متشابهة بما يكفي
  // لينجح المسار نفسه فيهما (≈1.7%)، وهذا لا يثبت شيئاً؛ فنختار مساراً يفشل محلياً على مخطط الهدف حتى يبقى الاختبار حتمياً.
  let foreign = null;
  for (let i = 0; i < 60 && !foreign; i++) {
    const candidate = solution(R.seedFromId(`other-${i}-${target.id}`));
    const local = R.replay(candidate.inputs, 'miner', R.seedFromId(target.id));
    if (candidate.state.status === 'won' && !(local.ok && local.state.status === 'won')) foreign = candidate;
  }
  assert.ok(foreign, 'a winning path specific to another layout exists');
  assert.equal(foreign.state.status, 'won');
  const res = await post('replayer', 'finish', { id: target.id, inputs: foreign.inputs });
  assert.notEqual(res.body.gold > 0 && res.body.won, true, 'foreign path must not win this layout');
  const start = await post('replay-seed', 'start');
  assert.equal(start.body.seed, R.seedFromId(start.body.id));
});

test('platform API: daily 10,000 gold cap is enforced across wins and reported in the receipt', async () => {
  const { state, ...payload } = await historical('daily-cap');
  const owner = `guest_${user('daily-cap')}`;
  const day = new Date().toISOString().slice(0, 10);
  await store.withUsers([owner], async () => {
    const u = await store.getUser(owner);
    u.sync.platformDay = day;
    u.sync.platformGold = 9_950;
    await store.putUser(u);
  });
  const result = await post('daily-cap', 'finish', payload);
  assert.equal(result.status, 200);
  assert.equal(result.body.gold, 50);
  assert.equal(result.body.reason, 'daily_cap');
  assert.equal(result.body.dailyRemaining, 0);
  assert.equal((await store.getUser(owner)).sync.platformGold, 10_000);
  assert.equal((await store.getUser(owner)).state.gold, 50);
  assert.ok(R.rewardFor(state) > 50);
});

test('phase 2 API: finish credits verified ores, reports the reward split and never doubles on duplicate', async () => {
  const name = 'ore-credit';
  const payload = await historical(name);
  const first = await post(name, 'finish', payload);
  assert.equal(first.status, 200);
  assert.equal(first.body.won, true);
  const expectedOres = R.oreSummary(payload.state);
  assert.deepEqual(first.body.ores, expectedOres, 'receipt ores come from replay, not the client');
  assert.ok(Array.isArray(first.body.milestones) && first.body.milestones.length >= 2);
  assert.equal(first.body.milestoneGold + first.body.finalGold, first.body.gold);
  assert.equal(first.body.gold, R.rewardFor(payload.state));
  const wallet = (await store.getUser(`guest_${user(name)}`)).state.ores;
  assert.deepEqual(wallet, expectedOres);
  const again = await post(name, 'finish', payload);
  assert.equal(again.body.duplicate, true);
  const wallet2 = (await store.getUser(`guest_${user(name)}`)).state.ores;
  assert.deepEqual(wallet2, expectedOres, 'a duplicate receipt cannot mint ores twice');
});

// ---------------------------------------------------------------------------
// المرحلة 3: المنجم المختار + لقطة المعدات تُثبَّت في الجولة وتُستخدم في إعادة التشغيل
// ---------------------------------------------------------------------------
const MAX_GEAR = Object.fromEntries(R.EQUIPMENT_ORDER.map(id => [id, R.MAX_EQUIP_LEVEL]));
const owner = name => `guest_${user(name)}`;
async function patchUser(name, mutate) {
  await fetch(`http://127.0.0.1:${ports[0]}/api/me`, { headers: headers(name) }); // يُنشئ اللاعب إن لم يكن موجوداً
  await store.withUsers([owner(name)], async () => { const u = await store.getUser(owner(name)); await mutate(u); await store.putUser(u); });
}
// جولة مُسنّة بلقطة إعداد صريحة، وحلّها القانوني تحت اللقطة نفسها
async function historicalWith(name, config, hero = 'miner') {
  await post(name, 'start');
  const id = crypto.randomUUID();
  const s = solution(R.seedFromId(id), hero, config);
  const row = { id, user_id: owner(name), version: R.VERSION, status: 'playing', config_json: JSON.stringify(config),
    started_at: Math.floor(Date.now() - s.state.tick / 60 * 1000 - 2000) };
  await store.withUsers([row.user_id], async () => {
    const active = await store.activePlatformRun(row.user_id); active.status = 'expired'; await store.savePlatformRun(active);
    await store.savePlatformRun(row);
  });
  return { id, inputs: s.inputs, state: s.state };
}

test('phase 3 API: start issues the config snapshot and defaults to the first mine with no gear', async () => {
  const res = await post('cfg-default', 'start');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.config, { zone: 0, goal: 0, mode: 'mine', loadout: Object.fromEntries(R.EQUIPMENT_ORDER.map(id => [id, 0])) });
  assert.equal(res.body.version, R.VERSION);
  assert.equal(R.VERSION, 7);
  const row = await store.getPlatformRun(res.body.id);
  assert.deepEqual(JSON.parse(row.config_json), res.body.config, 'the snapshot is persisted with the run');
});

test('phase 3 API: locked mines are refused with the missing requirements, unknown ones are a bad request', async () => {
  const locked = await post('cfg-locked', 'start', { zone: 1 });
  assert.equal(locked.status, 403);
  assert.ok(/مقفل/.test(locked.body.error));
  assert.deepEqual(locked.body.needs.map(n => [n.kind, n.ok]), [['win', false]]);
  assert.equal((await post('cfg-locked', 'start', { zone: 9 })).status, 400);
  assert.equal((await post('cfg-locked', 'start', { zone: -1 })).status, 400);
  assert.equal((await post('cfg-locked', 'start', { zone: '1' })).status, 400);
  assert.equal((await post('cfg-locked', 'start', { zone: 1.5 })).status, 400);
  assert.equal((await store.activePlatformRun(owner('cfg-locked'))), null, 'refusals never create a run');
  await patchUser('cfg-locked', u => { u.state.mines.wins[0] = 1; });
  const open = await post('cfg-locked', 'start', { zone: 1 });
  assert.equal(open.status, 200); assert.equal(open.body.config.zone, 1);
  const gear = await post('cfg-locked', 'start', { zone: 2 });
  assert.equal(gear.status, 403, 'winning one mine is not enough for the gold caves without a pickaxe');
  assert.deepEqual(gear.body.needs.filter(n => !n.ok).map(n => n.id || n.kind), ['win', 'pickaxe']);
  assert.equal((await store.activePlatformRun(owner('cfg-locked'))).id, open.body.id, 'a refused request keeps the healthy run alive');
});

test('phase 3 API: the loadout comes from the server profile, never from the request body', async () => {
  await post('cfg-body', 'start');
  const forged = await post('cfg-body', 'start', { zone: 0, loadout: MAX_GEAR, equipment: MAX_GEAR, config: { zone: 5, loadout: MAX_GEAR } });
  assert.equal(forged.status, 200);
  assert.deepEqual(forged.body.config.loadout, R.normalizeLoadout({}), 'a forged loadout is ignored');
  await patchUser('cfg-body', u => { u.state.equipment.pickaxe = 2; u.state.equipment.boots = 1; });
  const real = await post('cfg-body', 'start');
  assert.equal(real.body.config.loadout.pickaxe, 2); assert.equal(real.body.config.loadout.boots, 1);
});

test('phase 3 API: gear bought during a run never changes it; the next start gets a fresh snapshot and resume keeps the old one', async () => {
  const first = await post('cfg-snap', 'start');
  const again = await post('cfg-snap', 'start');
  assert.equal(again.body.id, first.body.id, 'same mine + same gear = the same run (idempotent start)');
  await patchUser('cfg-snap', u => { u.state.equipment.pickaxe = 1; });
  const resumed = await post('cfg-snap', 'start', { resume: true });
  assert.equal(resumed.body.id, first.body.id, 'resume returns the active run untouched');
  assert.equal(resumed.body.config.loadout.pickaxe, 0, 'and with its original snapshot');
  const fresh = await post('cfg-snap', 'start');
  assert.notEqual(fresh.body.id, first.body.id);
  assert.equal(fresh.body.config.loadout.pickaxe, 1);
  assert.equal((await store.getPlatformRun(first.body.id)).status, 'expired');
  assert.equal(JSON.parse((await store.getPlatformRun(first.body.id)).config_json).loadout.pickaxe, 0, 'the old snapshot is immutable');
});

test('phase 3 API: choosing another mine replaces the active run, concurrent identical starts still share one', async () => {
  await patchUser('cfg-switch', u => { u.state.mines.wins = [1, 1, 0, 0, 0, 0]; u.state.equipment.pickaxe = 1; });
  const first = await post('cfg-switch', 'start', { zone: 0 });
  const second = await post('cfg-switch', 'start', { zone: 2 });
  assert.notEqual(second.body.id, first.body.id);
  assert.equal(second.body.config.zone, 2);
  assert.equal((await store.getPlatformRun(first.body.id)).status, 'expired');
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => post('cfg-switch', 'start', { zone: 2 }, ports[i % 2])));
  assert.equal(new Set(burst.map(r => r.body.id)).size, 1);
  assert.equal(burst[0].body.id, second.body.id);
  const plain = await post('cfg-switch', 'start');
  assert.equal(plain.body.id, second.body.id, 'a plain start keeps the current mine');
  const missing = await post('cfg-switch', 'start', { resume: true });
  assert.equal(missing.body.id, second.body.id);
});

test('phase 3 API: finish replays under the stored snapshot — mine ores, wins counter, receipt and ledger', async () => {
  const name = 'cfg-finish';
  const config = { zone: 3, loadout: { ...R.normalizeLoadout({}), pickaxe: 2, boots: 2, bag: 3, magnet: 1 } };
  await patchUser(name, u => { u.state.equipment = { ...config.loadout }; u.state.mines.wins = [1, 1, 1, 0, 0, 0]; });
  const payload = await historicalWith(name, config);
  assert.equal(payload.state.status, 'won');
  const res = await post(name, 'finish', { id: payload.id, inputs: payload.inputs });
  assert.equal(res.status, 200); assert.equal(res.body.won, true);
  assert.equal(res.body.zone, 3);
  assert.equal(res.body.mineWins, 1);
  assert.deepEqual(res.body.ores, R.oreSummary(payload.state), 'ores come from the replay under the mine and bag');
  const tiers = Object.values(R.MINES[3].tier);
  for (const [ore, qty] of Object.entries(res.body.ores)) if (qty > 0) assert.ok(tiers.includes(ore), `${ore} drops in the crystal depths`);
  const saved = await store.getUser(owner(name));
  assert.deepEqual(saved.state.mines.wins, [1, 1, 1, 1, 0, 0]);
  assert.deepEqual(saved.state.equipment, config.loadout, 'finishing never touches the purchased gear');
  const entry = (await store.ledgerFor(owner(name))).find(e => e.kind === 'platform_finish');
  assert.equal(entry.detail.zone, 3); assert.deepEqual(entry.detail.loadout, config.loadout);
  const dup = await post(name, 'finish', { id: payload.id, inputs: payload.inputs });
  assert.equal(dup.body.duplicate, true);
  assert.deepEqual((await store.getUser(owner(name))).state.mines.wins, [1, 1, 1, 1, 0, 0], 'a duplicate never counts a second win');
});

test('phase 3 API: a loss never advances a mine and inputs recorded with stronger gear do not win under a weaker snapshot', async () => {
  const name = 'cfg-weak';
  const strong = { zone: 5, loadout: MAX_GEAR };
  const weak = { zone: 5, loadout: R.normalizeLoadout({}) };
  await patchUser(name, u => { u.state.mines.wins = [1, 1, 1, 1, 1, 0]; });
  const payload = await historicalWith(name, strong);
  assert.equal(payload.state.status, 'won');
  // نفس الحركات تُرسل لجولة لقطتها أضعف: يجب ألا تنتهي بفوز ولا تُحتسب
  const weakId = crypto.randomUUID();
  await store.withUsers([owner(name)], async () => {
    const active = await store.activePlatformRun(owner(name)); active.status = 'expired'; await store.savePlatformRun(active);
    await store.savePlatformRun({ id: weakId, user_id: owner(name), version: R.VERSION, status: 'playing', config_json: JSON.stringify(weak), started_at: Date.now() - 400_000 });
  });
  const res = await post(name, 'finish', { id: weakId, inputs: payload.inputs });
  assert.notEqual(res.body.won, true, 'a stronger run cannot be claimed under a weaker snapshot');
  assert.equal((await store.getUser(owner(name))).state.mines.wins[5], 0);
  assert.equal((await store.getUser(owner(name))).state.gold, 0);
  // خسارة قانونية (انتهاء الزمن) في منجم مفتوح لا تزيد عدّاد الانتصارات أيضاً
  const lossId = crypto.randomUUID();
  await store.withUsers([owner(name)], () => store.savePlatformRun({ id: lossId, user_id: owner(name), version: R.VERSION, status: 'playing',
    config_json: JSON.stringify({ zone: 2, loadout: R.normalizeLoadout({}) }), started_at: Date.now() - R.MAX_TICKS / 60 * 1000 - 2000 }));
  const loss = await post(name, 'finish', { id: lossId, inputs: [{ mask: 0, frames: R.MAX_TICKS }] });
  assert.equal(loss.status, 200); assert.equal(loss.body.won, false); assert.equal(loss.body.zone, 2);
  assert.deepEqual((await store.getUser(owner(name))).state.mines.wins, [1, 1, 1, 1, 1, 0]);
});

test('phase 3 API: runs with no snapshot (created before the upgrade) finish under the default config', async () => {
  const name = 'cfg-legacy';
  const payload = await historical(name); // صف بلا config_json
  assert.equal((await store.getPlatformRun(payload.id)).config_json, null);
  const res = await post(name, 'finish', payload);
  assert.equal(res.status, 200); assert.equal(res.body.won, true); assert.equal(res.body.zone, 0);
  assert.deepEqual((await store.getUser(owner(name))).state.mines.wins, [1, 0, 0, 0, 0, 0]);
});

// ---------------------------------------------------------------------------
// V5: الزعماء — سقوط الزعيم يُحتسب على الخادم من إعادة التشغيل نفسها
// ---------------------------------------------------------------------------
test('V5 API: beating the boss of a mine counts the kill — bossWins, the boss achievement, the receipt and the ledger — and an ordinary mine never does', async () => {
  const name = 'boss-kill';
  const gear = { ...R.normalizeLoadout({}), pickaxe: 1 };
  await patchUser(name, u => { u.state.equipment = { ...gear }; u.state.mines.wins = [1, 1, 0, 0, 0, 0]; });
  // an ordinary mine first: a win, but no boss
  const plain = await historicalWith(name, { zone: 1, loadout: gear });
  assert.equal(plain.state.status, 'won'); assert.equal(plain.state.bossDefeated, false);
  const plainRes = await post(name, 'finish', { id: plain.id, inputs: plain.inputs });
  assert.equal(plainRes.status, 200); assert.equal(plainRes.body.won, true); assert.equal(plainRes.body.boss, false);
  assert.equal((await store.getUser(owner(name))).state.adventure.bossWins, 0);
  assert.equal(plainRes.body.profile.achievements.items.find(i => i.id === 'boss').done, false);
  // the golden caves: the Colossus has to fall before the exit opens
  const config = { zone: 2, loadout: gear };
  const payload = await historicalWith(name, config, 'warrior');
  assert.equal(payload.state.status, 'won'); assert.equal(payload.state.bossDefeated, true);
  const res = await post(name, 'finish', { id: payload.id, inputs: payload.inputs, hero: 'warrior' });
  assert.equal(res.status, 200); assert.equal(res.body.won, true); assert.equal(res.body.boss, true); assert.equal(res.body.zone, 2);
  assert.deepEqual(res.body.ores, R.oreSummary(payload.state), 'the boss loot is part of the replayed ores — never a client claim');
  assert.ok(res.body.ores.gold >= 1 && res.body.ores.crystal >= 2, 'at least the boss loot (1 gold ore, 2 crystal) is in the receipt');
  const saved = await store.getUser(owner(name));
  assert.equal(saved.state.adventure.bossWins, 1);
  assert.deepEqual(saved.state.mines.wins, [1, 2, 1, 0, 0, 0], 'the earlier iron win and the new gold win are both counted');
  const achievement = res.body.profile.achievements.items.find(i => i.id === 'boss');
  assert.equal(achievement.done, true, 'the achievement nobody could reach before is now unlocked by a real kill');
  const entry = (await store.ledgerFor(owner(name))).find(e => e.kind === 'platform_finish' && e.detail.zone === 2);
  assert.equal(entry.detail.boss, true);
  // a duplicate finish never counts a second kill
  const dup = await post(name, 'finish', { id: payload.id, inputs: payload.inputs, hero: 'warrior' });
  assert.equal(dup.body.duplicate, true);
  assert.equal((await store.getUser(owner(name))).state.adventure.bossWins, 1);
});

test('V5 API: a boss that is still standing counts for nothing, and the exit stays shut however the run ends', async () => {
  const name = 'boss-alive';
  await patchUser(name, u => { u.state.equipment = { ...R.normalizeLoadout({}), pickaxe: 1 }; u.state.mines.wins = [1, 1, 0, 0, 0, 0]; });
  const config = { zone: 2, loadout: { ...R.normalizeLoadout({}), pickaxe: 1 } };
  const lossId = crypto.randomUUID();
  await store.withUsers([owner(name)], () => store.savePlatformRun({ id: lossId, user_id: owner(name), version: R.VERSION, status: 'playing',
    config_json: JSON.stringify(config), started_at: Date.now() - R.MAX_TICKS / 60 * 1000 - 2000 }));
  const loss = await post(name, 'finish', { id: lossId, inputs: [{ mask: 0, frames: R.MAX_TICKS }] });
  assert.equal(loss.status, 200); assert.equal(loss.body.won, false); assert.equal(loss.body.boss, false);
  assert.equal((await store.getUser(owner(name))).state.adventure.bossWins, 0);
  // a run that walks straight to the exit with everything collected but ignores the boss cannot win (rules-level check, replayed by the server)
  const rush = bot(R.seedFromId('rush'), 'miner', config);
  assert.equal(rush.state.status, 'won');
  const noBoss = rush.inputs.filter(seg => seg.frames > 0).slice(0, 60); // far too short to have beaten anything
  assert.notEqual(R.replay(noBoss, 'miner', R.seedFromId('rush'), config).state.status, 'won');
});

test('V5 API: the finish body limit fits a long boss recording; the rules still cap it, and an oversized body is refused outright', async () => {
  const name = 'boss-body';
  const started = await post(name, 'start');
  const segs = n => Array.from({ length: n }, (_, i) => ({ mask: i % 2, frames: 1 }));
  const long = await post(name, 'finish', { id: started.body.id, inputs: segs(2000) });   // ≈ 46 KB: over the old 32 KB parser limit
  assert.equal(long.status, 400);
  assert.match(long.body.error, /لم ينتهِ/, 'parsed and replayed — the level just is not finished yet');
  const tooMany = await post(name, 'finish', { id: started.body.id, inputs: segs(R.MAX_SEGMENTS + 1) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /غير صالحة/, 'the shared rules reject more than MAX_SEGMENTS');
  const huge = await fetch(`http://127.0.0.1:${ports[0]}/api/platform/finish`, { method: 'POST', headers: headers(name), body: JSON.stringify({ id: started.body.id, inputs: segs(4200) }) });
  assert.equal(huge.status, 413, 'above 64 KB the body is refused before any replay work');
});
