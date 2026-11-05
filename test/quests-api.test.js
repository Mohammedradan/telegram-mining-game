'use strict';
// مهام المغامرة على الخادم (الدفعة 3ب): عدّاداتها تأتي من جولات المنصّات المُعاد تشغيلها فقط، والاستلام عملية `quest` مرقّمة
// تُسجَّل في الدفتر وتُصرف مرة واحدة. جولات حقيقية بالروبوت المشترك نفسه الذي تستخدمه اختبارات المنصّات (لا أرقام مختلقة).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), net = require('node:net');
const { createStore } = require('../db');
const R = require('../public/platform-rules');
const solution = require('./fixtures/platform-solution.cjs');
const Quests = require('../quests');

let PORT = 0, BASE = '', child = null, store = null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-quests-'));
const DB_FILE = path.join(dir, 'game.db'), PG_URL = process.env.TEST_DATABASE_URL || '';
const RUN = `${process.pid}_${Date.now().toString(36)}`;
const user = (n) => `quests_${RUN}_${n}`;
const owner = (n) => `guest_${user(n)}`;
const H = (n) => ({ 'X-Guest-Id': user(n), 'Content-Type': 'application/json' });
const freePort = () => new Promise((resolve, reject) => { const p = net.createServer(); p.on('error', reject); p.listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)); }); });
const me = async (n) => (await fetch(`${BASE}/api/me`, { headers: H(n) })).json();
async function post(n, route, body = {}) {
  const res = await fetch(`${BASE}/api/platform/${route}`, { method: 'POST', headers: H(n), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function sendOps(n, ops, { session = 'dev', from = 1 } = {}) {
  const res = await fetch(`${BASE}/api/ops`, { method: 'POST', headers: H(n), body: JSON.stringify({ session, ops: ops.map((op, i) => ({ seq: from + i, ...op })) }) });
  return { status: res.status, body: await res.json() };
}
async function patchUser(n, mutate) {
  await me(n);
  await store.withUsers([owner(n)], async () => { const u = await store.getUser(owner(n)); await mutate(u); await store.putUser(u); });
}
const readUser = (n) => store.withUsers([owner(n)], async () => store.getUser(owner(n)));
const gear = { ...R.normalizeLoadout({}), pickaxe: 1 };
const rows = (view) => Object.fromEntries(view.items.map((i) => [i.id, i]));

// a winning run for this config, recorded as if it had been played in real time (the server replays it and checks the clock)
async function winningRun(n, config, hero = 'miner') {
  await post(n, 'start');
  const id = crypto.randomUUID();
  const s = solution(R.seedFromId(id), hero, config);
  const row = { id, user_id: owner(n), version: R.VERSION, status: 'playing', config_json: JSON.stringify(config), started_at: Math.floor(Date.now() - s.state.tick / 60 * 1000 - 2000) };
  await store.withUsers([row.user_id], async () => { const a = await store.activePlatformRun(row.user_id); a.status = 'expired'; await store.savePlatformRun(a); await store.savePlatformRun(row); });
  return { id, inputs: s.inputs, state: s.state };
}
// a LOST run that still mined something: the first frames of a winning path, then standing still until the time is up
async function losingRun(n, config, hero = 'miner') {
  await post(n, 'start');
  const id = crypto.randomUUID(), seed = R.seedFromId(id), sol = solution(seed, hero, config);
  for (const keep of [300, 500, 800, 1200, 2000]) {
    const inputs = []; let left = keep;
    for (const seg of sol.inputs) { if (left <= 0) break; const f = Math.min(seg.frames, left); inputs.push({ mask: seg.mask, frames: f }); left -= f; }
    inputs.push({ mask: 0, frames: R.MAX_TICKS - keep });
    const { ok, state } = R.replay(inputs, hero, seed, config);
    if (!ok || state.status === 'won' || state.mined < 1) continue;
    const row = { id, user_id: owner(n), version: R.VERSION, status: 'playing', config_json: JSON.stringify(config), started_at: Math.floor(Date.now() - R.MAX_TICKS / 60 * 1000 - 2000) };
    await store.withUsers([row.user_id], async () => { const a = await store.activePlatformRun(row.user_id); a.status = 'expired'; await store.savePlatformRun(a); await store.savePlatformRun(row); });
    return { id, inputs, state };
  }
  throw new Error('no losing run that mines something was found');
}

before(async () => {
  PORT = await freePort(); BASE = `http://127.0.0.1:${PORT}`;
  child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development', BOT_TOKEN: '', DATABASE_FILE: DB_FILE, DATABASE_URL: PG_URL }, stdio: 'inherit' });
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`the quests test server exited (${child.exitCode}): is port ${PORT} taken?`);
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  const oldFile = process.env.DATABASE_FILE, oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_FILE = DB_FILE; process.env.DATABASE_URL = PG_URL; store = createStore();
  if (oldFile === undefined) delete process.env.DATABASE_FILE; else process.env.DATABASE_FILE = oldFile;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});
after(async () => {
  if (child?.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill('SIGTERM'); await done; }
  await store?.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('a new player has twelve untouched quests in the profile and in every ops reply', async () => {
  const profile = await me('fresh');
  assert.equal(profile.quests.total, 12); assert.equal(profile.quests.claimedCount, 0);
  assert.deepEqual([profile.quests.totalGold, profile.quests.totalXp], [2_500, 800]);
  assert.ok(profile.quests.items.every((i) => i.value === 0 && !i.done && !i.claimed));
  const reply = await sendOps('fresh', [{ type: 'mine', clicks: 1 }]);
  assert.deepEqual(reply.body.quests, profile.quests, 'an ops reply carries the same view');
});

test('a verified win feeds every counter from its own replay, and a repeated finish counts nothing twice', async () => {
  const n = 'win-feed';
  const run = await winningRun(n, { zone: 0, loadout: R.normalizeLoadout({}) });
  assert.equal(run.state.status, 'won');
  const ores = R.oreSummary(run.state);
  const res = await post(n, 'finish', { id: run.id, inputs: run.inputs });
  assert.equal(res.status, 200); assert.equal(res.body.won, true);
  const after = await readUser(n);
  assert.equal(after.sync.quests.rocks, run.state.mined, 'rocks mined = what the replay says');
  assert.equal(after.sync.quests.enemies, run.state.defeated);
  assert.deepEqual(after.sync.quests.ores, ores, 'ores = the ores the server credited');
  assert.deepEqual(after.sync.quests.bosses, { colossus: 0, warden: 0 }, 'no boss in the first mine');
  const q = rows(res.body.profile.quests);
  assert.equal(q.first_rock.done, run.state.mined >= 1); assert.equal(q.win_stone.done, true, 'the win comes from the mines record');
  assert.equal(q.win_crystal.done, false);
  const again = await post(n, 'finish', { id: run.id, inputs: run.inputs });
  assert.equal(again.body.duplicate, true);
  assert.deepEqual((await readUser(n)).sync.quests, after.sync.quests, 'a second finish of the same round counts nothing');
});

test('a lost round still counts the rocks and ores it gave, but never a win or a boss', async () => {
  const n = 'lost-feed';
  const run = await losingRun(n, { zone: 0, loadout: R.normalizeLoadout({}) });
  assert.notEqual(run.state.status, 'won'); assert.ok(run.state.mined >= 1);
  const res = await post(n, 'finish', { id: run.id, inputs: run.inputs });
  assert.equal(res.status, 200); assert.equal(res.body.won, false);
  const saved = await readUser(n);
  assert.equal(saved.sync.quests.rocks, run.state.mined); assert.equal(saved.sync.quests.enemies, run.state.defeated);
  assert.deepEqual(saved.sync.quests.ores, R.oreSummary(run.state));
  assert.deepEqual(saved.state.mines.wins, [0, 0, 0, 0, 0, 0]);
  assert.equal(rows(res.body.profile.quests).win_stone.done, false);
  // counters add up across rounds
  const won = await winningRun(n, { zone: 0, loadout: R.normalizeLoadout({}) });
  await post(n, 'finish', { id: won.id, inputs: won.inputs });
  const total = (await readUser(n)).sync.quests;
  assert.equal(total.rocks, run.state.mined + won.state.mined, 'two rounds, one running total');
});

test('beating a boss counts that boss under its own key, and an ordinary mine never does', async () => {
  const n = 'boss-feed';
  await patchUser(n, (u) => { u.state.equipment = { ...gear }; u.state.mines.wins = [1, 1, 0, 0, 0, 0]; });
  const plain = await winningRun(n, { zone: 1, loadout: gear });
  assert.equal(plain.state.bossDefeated, false);
  await post(n, 'finish', { id: plain.id, inputs: plain.inputs });
  assert.deepEqual((await readUser(n)).sync.quests.bosses, { colossus: 0, warden: 0 });
  const boss = await winningRun(n, { zone: 2, loadout: gear }, 'warrior');
  assert.equal(boss.state.bossDefeated, true);
  const res = await post(n, 'finish', { id: boss.id, inputs: boss.inputs, hero: 'warrior' });
  assert.equal(res.body.boss, true);
  const saved = await readUser(n);
  assert.deepEqual(saved.sync.quests.bosses, { colossus: 1, warden: 0 }, 'the Colossus of mine 3 fell; the Warden did not');
  const q = rows(res.body.profile.quests);
  assert.equal(q.colossus.done, true); assert.equal(q.warden.done, false);
  assert.ok(saved.sync.quests.ores.gold >= 1 && saved.sync.quests.ores.crystal >= 2, 'the boss loot is counted with the other ores');
  const dup = await post(n, 'finish', { id: boss.id, inputs: boss.inputs, hero: 'warrior' });
  assert.equal(dup.body.duplicate, true);
  assert.equal((await readUser(n)).sync.quests.bosses.colossus, 1, 'a repeated finish never counts a second kill');
  // losing in the boss's own mine, with the boss still standing, counts no kill
  const idle = crypto.randomUUID();
  await store.withUsers([owner(n)], async () => { const a = await store.activePlatformRun(owner(n)); if (a) { a.status = 'expired'; await store.savePlatformRun(a); } await store.savePlatformRun({ id: idle, user_id: owner(n), version: R.VERSION, status: 'playing', config_json: JSON.stringify({ zone: 2, loadout: gear }), started_at: Date.now() - R.MAX_TICKS / 60 * 1000 - 2000 }); });
  const lost = await post(n, 'finish', { id: idle, inputs: [{ mask: 0, frames: R.MAX_TICKS }] });
  assert.equal(lost.body.won, false); assert.equal(lost.body.boss, false);
  assert.equal((await readUser(n)).sync.quests.bosses.colossus, 1, 'a loss in the boss mine, boss alive, adds no kill');
});

test('counters cannot be forged: a finish body, classic rounds, missions and a hand-made quests field change nothing', async () => {
  const n = 'forge';
  const run = await winningRun(n, { zone: 0, loadout: R.normalizeLoadout({}) });
  const res = await post(n, 'finish', { id: run.id, inputs: run.inputs, mined: 9_999, defeated: 9_999, ores: { gold: 9_999, lava: 9_999 }, boss: 'warden', bosses: { warden: 9 }, quests: { rocks: 9_999 }, counters: { rocks: 9_999 } });
  assert.equal(res.status, 200);
  const honest = (await readUser(n)).sync.quests;
  assert.equal(honest.rocks, run.state.mined); assert.equal(honest.enemies, run.state.defeated);
  assert.deepEqual(honest.ores, R.oreSummary(run.state)); assert.deepEqual(honest.bosses, { colossus: 0, warden: 0 });
  // classic rounds are the client's claim, never verified: they do not feed quests (even a "boss kill")
  await patchUser(n, (u) => { u.sync.lastRunAt = Date.now() - 900_000; u.sync.lastRewardAt.adventure = Date.now() - 900_000; });
  const ops = await sendOps(n, [{ type: 'run', mode: 'boss', difficulty: 'normal', score: 600, gems: 20, combo: 10, duration: 40, boss: true, ago: 0, quests: { rocks: 9_999 }, mined: 9_999 }]);
  assert.equal(ops.body.results[0].boss, true, 'the classic boss round itself counted as before');
  assert.deepEqual((await readUser(n)).sync.quests, honest, 'but no quest counter moved');
  assert.deepEqual(ops.body.quests.items.map((i) => i.value), (await me(n)).quests.items.map((i) => i.value));
});

test('claim: a finished quest pays its table reward once, through the ledger; unfinished, unknown and repeated claims pay nothing', async () => {
  const n = 'claim';
  await patchUser(n, (u) => { u.sync.quests = Quests.addRun(Quests.normalize(), { mined: 1 }); });
  const before = await me(n);
  // locked / unknown first: no gold, no mark
  const locked = await sendOps(n, [{ type: 'quest', id: 'rocks_200' }, { type: 'quest', id: 'no_such_quest' }, { type: 'quest' }]);
  assert.deepEqual(locked.body.results.map((r) => [r.status, r.reason || null]), [['rejected', 'locked'], ['invalid', null], ['invalid', null]]);
  assert.deepEqual([locked.body.results[0].value, locked.body.results[0].target], [1, 200]);
  assert.equal(locked.body.state.gold, before.state.gold);
  const ok = await sendOps(n, [{ type: 'quest', id: 'first_rock' }], { from: 4 });
  const r = ok.body.results[0];
  assert.deepEqual([r.status, r.gold, r.xp], ['ok', 50, 20]);
  assert.equal(ok.body.state.gold, before.state.gold + 50); assert.equal(ok.body.state.xp, before.state.xp + 20);
  assert.equal(ok.body.state.totalEarned, before.state.totalEarned + 50);
  assert.equal(rows(ok.body.quests).first_rock.claimed, true); assert.equal(ok.body.quests.claimedCount, 1);
  const ledger = (await store.ledgerFor(owner(n), 20)).filter((e) => e.kind === 'quest');
  assert.equal(ledger.length, 1); assert.equal(ledger[0].goldDelta, 50); assert.deepEqual(ledger[0].detail, { id: 'first_rock', xp: 20 });
  // the same claim again (new op number) and the same op replayed (same number)
  const second = await sendOps(n, [{ type: 'quest', id: 'first_rock' }], { from: 5 });
  assert.deepEqual([second.body.results[0].status, second.body.results[0].reason], ['rejected', 'claimed']);
  const replay = await sendOps(n, [{ type: 'quest', id: 'first_rock' }], { from: 4 });
  assert.equal(replay.body.results[0].status, 'duplicate');
  assert.equal(replay.body.state.gold, before.state.gold + 50, 'neither paid again');
  assert.equal((await store.ledgerFor(owner(n), 20)).filter((e) => e.kind === 'quest').length, 1);
});

test('the whole book is worth 2,500 gold and 800 XP — exactly, and outside the daily cap', async () => {
  const n = 'whole-book';
  await patchUser(n, (u) => {
    u.sync.quests = Quests.addRun(Quests.normalize(), { mined: 1_000, defeated: 1_000, ores: { copper: 1_000, iron: 1_000, gold: 1_000, crystal: 1_000, lava: 1_000 }, boss: 'colossus' });
    Quests.addRun(u.sync.quests, { boss: 'warden' });
    u.state.mines.wins = [1, 1, 1, 1, 1, 1];
    u.sync.platformDay = new Date().toISOString().slice(0, 10); u.sync.platformGold = 10_000; // today's purse is empty
  });
  const before = await me(n);
  assert.equal(before.dailyGold.remaining, 0);
  const all = await sendOps(n, Quests.QUESTS.map((q) => ({ type: 'quest', id: q.id })));
  assert.deepEqual(all.body.results.map((r) => r.status), Array(12).fill('ok'));
  assert.equal(all.body.results.reduce((a, r) => a + r.gold, 0), 2_500);
  assert.equal(all.body.results.reduce((a, r) => a + r.xp, 0), 800);
  assert.equal(all.body.state.gold, before.state.gold + 2_500, 'an empty daily purse does not stop one-time quest gold');
  assert.equal(all.body.quests.claimedCount, 12);
  assert.equal((await readUser(n)).sync.platformGold, 10_000, 'and quest gold is not charged to the purse');
  assert.equal((await store.ledgerFor(owner(n), 30)).filter((e) => e.kind === 'quest').reduce((a, e) => a + e.goldDelta, 0), 2_500);
  const again = await sendOps(n, Quests.QUESTS.map((q) => ({ type: 'quest', id: q.id })), { from: 13 });
  assert.deepEqual(again.body.results.map((r) => r.reason), Array(12).fill('claimed'));
  assert.equal(again.body.state.gold, all.body.state.gold);
});

test('stored garbage in the quests record is cleaned on the next request, and a missing record becomes an empty one', async () => {
  const n = 'garbage';
  await patchUser(n, (u) => { u.sync.quests = { rocks: -3, enemies: 'lots', ores: { copper: 9e99, hacked: 5 }, bosses: { colossus: 2.9 }, claimed: { first_rock: 123, nope: 5 }, extra: true }; });
  const q = rows((await me(n)).quests);
  assert.equal(q.first_rock.claimed, true, 'the one known claim survives');
  assert.equal(q.copper_40.value, 40, 'a huge counter shows at most its target');
  assert.equal(q.colossus.done, true);
  const saved = (await readUser(n)).sync.quests;
  assert.deepEqual(Object.keys(saved).sort(), ['bosses', 'claimed', 'enemies', 'ores', 'rocks']);
  assert.equal(saved.rocks, 0); assert.equal(saved.ores.copper, 1_000_000_000); assert.equal(saved.bosses.colossus, 2); assert.deepEqual(Object.keys(saved.claimed), ['first_rock']);
  await patchUser('no-record', (u) => { delete u.sync.quests; });
  assert.equal((await me('no-record')).quests.total, 12);
});
