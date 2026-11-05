'use strict';
// التبجيل على الخادم (الدفعة 3ج): عملية `prestige` مرقّمة واحدة. تصفّر العمال والمنصّات وأسعارهم وحدهم، وترفع الدخل السلبي 10% لكل مستوى،
// ولا تتكرر (تسلسل العمليات + المتطلبات + التسلسل في معاملة اللاعب). خادم حقيقي وقاعدة بيانات حقيقية.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { createStore } = require('../db');
const P = require('../public/prestige-rules');

let PORT = 0, BASE = '', child = null, store = null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-prestige-'));
const DB_FILE = path.join(dir, 'game.db'), PG_URL = process.env.TEST_DATABASE_URL || '';
const RUN = `${process.pid}_${Date.now().toString(36)}`;
const user = (n) => `prestige_${RUN}_${n}`;
const owner = (n) => `guest_${user(n)}`;
const H = (n) => ({ 'X-Guest-Id': user(n), 'Content-Type': 'application/json' });
const freePort = () => new Promise((resolve, reject) => { const p = net.createServer(); p.on('error', reject); p.listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)); }); });
const me = async (n) => (await fetch(`${BASE}/api/me`, { headers: H(n) })).json();
async function sendOps(n, ops, { session = 'dev', from = 1 } = {}) {
  const res = await fetch(`${BASE}/api/ops`, { method: 'POST', headers: H(n), body: JSON.stringify({ session, ops: ops.map((op, i) => ({ seq: from + i, ...op })) }) });
  return { status: res.status, body: await res.json() };
}
async function patchUser(n, mutate) {
  await me(n);
  await store.withUsers([owner(n)], async () => { const u = await store.getUser(owner(n)); await mutate(u); await store.putUser(u); });
}
const readUser = (n) => store.withUsers([owner(n)], async () => store.getUser(owner(n)));
const own = (bot, rig, level = 0, extra = {}) => (u) => { u.state.owned.bot = bot; u.state.owned.rig = rig; u.state.prestige = level; Object.assign(u.state, extra); u.sync.settledAt = Date.now(); };

before(async () => {
  PORT = await freePort(); BASE = `http://127.0.0.1:${PORT}`;
  child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development', BOT_TOKEN: '', DATABASE_FILE: DB_FILE, DATABASE_URL: PG_URL }, stdio: 'inherit' });
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`the prestige test server exited (${child.exitCode}): is port ${PORT} taken?`);
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

test('level 0 is the old economy exactly: a new player and a veteran see bot×5 + rig×25, and prestige is 0', async () => {
  const fresh = await me('level0');
  assert.equal(fresh.state.prestige, 0); assert.equal(fresh.state.passiveIncome, 0);
  await patchUser('level0', own(10, 2));
  const veteran = await me('level0');
  assert.equal(veteran.state.passiveIncome, 10 * 5 + 2 * 25, 'no multiplier before the first prestige');
  assert.equal(veteran.state.prestige, 0);
});

test('locked: one bot short, one rig short or nothing — refused with what is asked and what is owned, and nothing changes', async () => {
  const n = 'locked';
  for (const [bot, rig] of [[14, 3], [15, 2], [0, 0], [1000, 2]]) {
    await patchUser(n, own(bot, rig));
    const res = await sendOps(n, [{ type: 'prestige' }], { session: `s-${bot}-${rig}` });
    const r = res.body.results[0];
    assert.deepEqual([r.status, r.reason, r.level, r.need, r.have], ['rejected', 'locked', 0, { bots: 15, rigs: 3 }, { bots: bot, rigs: rig }], `${bot}/${rig}`);
    assert.deepEqual([res.body.state.owned.bot, res.body.state.owned.rig, res.body.state.prestige], [bot, rig, 0], 'the player keeps everything');
    assert.equal(res.body.violations, 0, 'asking early is not a violation');
  }
  assert.equal((await store.ledgerFor(owner(n), 20)).filter((e) => e.kind === 'prestige').length, 0, 'a refusal leaves no ledger entry');
});

test('the first prestige at exactly 15 bots and 3 rigs: only bots, rigs and their prices reset; everything else is untouched', async () => {
  const n = 'first';
  await patchUser(n, own(15, 3, 0, { gold: 500_000, totalEarned: 800_000, xp: 1234, ores: { copper: 5, iron: 4, gold: 3, crystal: 2, lava: 1 } }));
  await patchUser(n, (u) => {
    u.state.equipment = { ...u.state.equipment, pickaxe: 3, armor: 2 };
    u.state.mines.wins = [3, 1, 0, 0, 0, 0];
    u.state.owned.click = 4;
    u.state.adventureUpgrades = { ...u.state.adventureUpgrades, magnet: 2, cart: 1 };
    u.state.adventure = { ...u.state.adventure, runs: 7, gems: 90, bossWins: 1 };
    u.sync.quests.rocks = 12; u.sync.quests.claimed = { first_rock: 5 };
    u.sync.platformDay = new Date().toISOString().slice(0, 10); u.sync.platformGold = 321;
    u.sync.settledAt = Date.now();
  });
  const before = await me(n);
  assert.equal(before.state.passiveIncome, 150);
  const res = await sendOps(n, [{ type: 'prestige' }]);
  const r = res.body.results[0], after = res.body.state;
  assert.deepEqual([r.status, r.level, r.multiplier, r.passiveIncome], ['ok', 1, 1.1, 0], 'level 1 (×1.1), and with no bots yet there is no income');
  assert.deepEqual([after.owned.bot, after.owned.rig, after.prestige], [0, 0, 1]);
  assert.deepEqual([after.costs.bot, after.costs.rig], [200, 1000], 'prices are back to the base ones');
  assert.equal(after.costs.click, before.state.costs.click, 'the click price is not touched');
  // untouched: everything that is not a bot or a rig
  for (const k of ['ores', 'equipment', 'mines', 'adventureUpgrades', 'adventure']) assert.deepEqual(after[k], before.state[k], `${k} is untouched`);
  assert.equal(after.owned.click, 4); assert.equal(after.clickPower, 5, 'the pickaxe (clicks) is untouched');
  assert.equal(after.xp, before.state.xp); assert.equal(after.level, before.state.level);
  assert.ok(after.gold >= before.state.gold && after.gold - before.state.gold < 150 * 10, 'gold: only the income that accrued before the reset (150 a second for the milliseconds between the two requests: no spending, no loss)');
  assert.ok(Math.abs((after.totalEarned - before.state.totalEarned) - (after.gold - before.state.gold)) < 1e-6, 'and it is counted as earned like any income');
  const saved = await readUser(n);
  assert.equal(saved.sync.quests.rocks, 12); assert.deepEqual(Object.keys(saved.sync.quests.claimed), ['first_rock'], 'quests are untouched');
  assert.equal(saved.sync.platformGold, 321, 'the daily purse is untouched');
  const entry = (await store.ledgerFor(owner(n), 20)).find((e) => e.kind === 'prestige');
  assert.equal(entry.goldDelta, 0); assert.deepEqual(entry.detail, { from: 0, to: 1, bots: 15, rigs: 3, multiplier: 1.1 }, 'the audit log says what was given up');
});

test('after a prestige the shop starts again at base prices, and the same stock earns +10%', async () => {
  const n = 'rebuy';
  await patchUser(n, own(15, 3, 0, { gold: 10_000 }));
  await sendOps(n, [{ type: 'prestige' }]);
  const reset = await me(n);
  assert.equal(reset.state.costs.bot, 200);
  const bought = await sendOps(n, [{ type: 'buy', item: 'bot' }], { from: 2 });
  assert.equal(bought.body.results[0].cost, 200, 'the first bot of the new cycle costs 200, not the 22,211 of the sixteenth');
  assert.equal(bought.body.state.passiveIncome, 5.5, 'one bot at level 1 earns 5.5 a second');
  // the player has rebuilt the same stock: +10% over the same stock before
  await patchUser(n, own(15, 3, 1));
  assert.equal((await me(n)).state.passiveIncome, 165, '15 bots and 3 rigs: 150 before, 165 now');
  await patchUser(n, own(15, 3, 3));
  assert.equal((await me(n)).state.passiveIncome, 195);
});

test('the requirement rises with every level, all ten are reachable in turn, and the top refuses a further one', async () => {
  const n = 'ladder';
  let seq = 1;
  for (let L = 0; L < 10; L++) {
    const need = P.requirement(L);
    // one short of the requirement first: refused (a late level really asks for more than the first)
    await patchUser(n, own(need.bots - 1, need.rigs, L));
    const short = await sendOps(n, [{ type: 'prestige' }], { session: 'ladder', from: seq++ });
    assert.deepEqual([short.body.results[0].status, short.body.results[0].reason], ['rejected', 'locked'], `level ${L} with one bot short`);
    await patchUser(n, own(need.bots, need.rigs - 1, L));
    const lack = await sendOps(n, [{ type: 'prestige' }], { session: 'ladder', from: seq++ });
    assert.equal(lack.body.results[0].status, 'rejected', `level ${L} with one rig short`);
    await patchUser(n, own(need.bots, need.rigs, L));
    const ok = await sendOps(n, [{ type: 'prestige' }], { session: 'ladder', from: seq++ });
    assert.deepEqual([ok.body.results[0].status, ok.body.results[0].level, ok.body.state.prestige], ['ok', L + 1, L + 1], `level ${L} → ${L + 1}`);
  }
  // the top: any amount of stock, still refused
  await patchUser(n, own(5_000, 2_000, 10));
  const top = await sendOps(n, [{ type: 'prestige' }], { session: 'ladder', from: seq++ });
  assert.deepEqual([top.body.results[0].status, top.body.results[0].reason, top.body.results[0].need], ['rejected', 'max', null]);
  assert.equal(top.body.state.prestige, 10); assert.equal(top.body.state.owned.bot, 5_000, 'nothing is reset at the top');
  assert.equal(top.body.state.passiveIncome, (5_000 + 5 * 2_000) * 2 * 5, 'level 10 doubles the income: (bots×5 + rigs×25) × 2');
  const rows = (await store.ledgerFor(owner(n), 50)).filter((e) => e.kind === 'prestige');
  assert.equal(rows.length, 10, 'ten prestiges, ten ledger entries');
  assert.deepEqual(rows.map((e) => e.detail.to).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('it cannot be repeated: the same op, two in one batch, and two tabs at once give one level', async () => {
  // the same op replayed
  await patchUser('dup', own(15, 3));
  const first = await sendOps('dup', [{ type: 'prestige' }], { session: 'dup' });
  assert.equal(first.body.results[0].status, 'ok');
  const replay = await sendOps('dup', [{ type: 'prestige' }], { session: 'dup' });
  assert.equal(replay.body.results[0].status, 'duplicate');
  assert.equal(replay.body.state.prestige, 1);
  // two in one batch: the second finds nothing left to give
  await patchUser('batch', own(15, 3));
  const batch = await sendOps('batch', [{ type: 'prestige' }, { type: 'prestige' }, { type: 'prestige' }]);
  assert.deepEqual(batch.body.results.map((r) => [r.status, r.reason || null]), [['ok', null], ['rejected', 'locked'], ['rejected', 'locked']]);
  assert.equal(batch.body.state.prestige, 1);
  // two tabs (two sessions) at the same moment: the player's transaction serialises them
  await patchUser('tabs', own(15, 3));
  const both = await Promise.all([sendOps('tabs', [{ type: 'prestige' }], { session: 'tab-a' }), sendOps('tabs', [{ type: 'prestige' }], { session: 'tab-b' })]);
  assert.deepEqual(both.map((x) => x.body.results[0].status).sort(), ['ok', 'rejected']);
  assert.equal((await readUser('tabs')).state.prestige, 1, 'one level, not two');
  assert.equal((await store.ledgerFor(owner('tabs'), 20)).filter((e) => e.kind === 'prestige').length, 1);
  // buy then prestige in one batch: the purchase counts if it completes the requirement
  await patchUser('buyfirst', own(14, 3, 0, { gold: 1_000_000 }));
  const buy = await sendOps('buyfirst', [{ type: 'buy', item: 'bot' }, { type: 'prestige' }]);
  assert.deepEqual(buy.body.results.map((r) => r.status), ['ok', 'ok'], 'the 15th bot, then the prestige it unlocked');
  assert.equal(buy.body.state.prestige, 1);
});

test('the multiplier is real income: accrual (offline too) uses the new level, and a prestige pays the old one first', async () => {
  // level 3 with 10 bots: (10) × 13 / 2 = 65 a second; 100 seconds away = 6,500
  await patchUser('accrual', own(10, 0, 3, { gold: 0 }));
  const since = Date.now() - 100_000;
  await patchUser('accrual', (u) => { u.sync.settledAt = since; });
  const away = await me('accrual');
  // exactly the income of the real elapsed time at the level's rate (the clock of the request, so a slow machine cannot fail it)
  const expected = 65 * (away.serverTime - since) / 1000;
  assert.ok(Math.abs(away.offline.gold - expected) < 5, `100 s at 65/s ≈ 6,500, to the second of this request: ${away.offline.gold} against ${expected}`);
  assert.ok(away.offline.gold > 6_400, 'and nowhere near the 5,000 that level 0 would have paid');
  // a prestige in the middle of an accrual window pays the time before it at the OLD multiplier (level 0: 150/s, not 165/s)
  await patchUser('before-reset', own(15, 3, 0, { gold: 0 }));
  const began = Date.now() - 60_000;
  await patchUser('before-reset', (u) => { u.sync.settledAt = began; });
  const res = await sendOps('before-reset', [{ type: 'prestige' }]);
  assert.equal(res.body.results[0].status, 'ok');
  const oldRate = 150 * (res.body.serverTime - began) / 1000, newRate = 165 * (res.body.serverTime - began) / 1000;
  assert.ok(Math.abs(res.body.state.gold - oldRate) < 1, `the time before the reset is paid at the OLD rate: ${res.body.state.gold} against ${oldRate} (the new rate would have paid ${newRate})`);
  // and a window that begins after it earns at the new level: 0 bots now, so nothing; buy one and see 5.5/s
  const next = await sendOps('before-reset', [{ type: 'buy', item: 'bot' }], { from: 2 });
  assert.equal(next.body.state.passiveIncome, 5.5);
});

test('the "10 upgrades" achievement never goes backwards because prestige reset the stock', async () => {
  const n = 'achv';
  await patchUser(n, own(15, 3, 0));     // 18 bought pieces, none claimed yet
  const before = (await me(n)).achievements.items.find((i) => i.id === 'upgrades10');
  assert.equal(before.done, true);
  await sendOps(n, [{ type: 'prestige' }]);
  const after = (await me(n)).achievements.items.find((i) => i.id === 'upgrades10');
  assert.deepEqual([after.done, after.value], [true, 10], 'the 18 given up still count (otherwise a player with an unclaimed achievement would lose it)');
  await patchUser('achv-new', own(0, 0, 0));
  assert.equal((await me('achv-new')).achievements.items.find((i) => i.id === 'upgrades10').done, false, 'and a player who bought nothing still has not earned it');
});

test('stored garbage is clamped, and the client cannot write the level (not through the legacy save either)', async () => {
  for (const [stored, expected] of [[99, 10], [-3, 0], ['x', 0], [2.9, 2], [null, 0], [10, 10]]) {
    await patchUser('clamp', (u) => { u.state.prestige = stored; u.state.owned.bot = 10; });
    const s = (await me('clamp')).state;
    assert.equal(s.prestige, expected, `${JSON.stringify(stored)} → ${expected}`);
    assert.equal(s.passiveIncome, 10 * (10 + expected) / 2 * 1, `income follows the clamped level (${expected})`);
  }
  await patchUser('forge', own(3, 1, 0));
  const res = await fetch(`${BASE}/api/save`, { method: 'POST', headers: H('forge'), body: JSON.stringify({ state: { prestige: 10, owned: { bot: 999, rig: 999, click: 0 }, gold: 1e9, passiveIncome: 1e9 } }) });
  assert.equal(res.status, 200);
  const after = (await me('forge')).state;
  assert.deepEqual([after.prestige, after.owned.bot, after.owned.rig], [0, 3, 1], 'a claimed state changes nothing on the server');
  assert.ok(after.gold < 1e6);
  // an op carrying a level or counts in other fields is just an op: it grants nothing
  const odd = await sendOps('forge', [{ type: 'prestige', level: 10, count: 999, key: 'bot', id: 'x', clicks: 1e6 }], { session: 'odd' });
  assert.deepEqual([odd.body.results[0].status, odd.body.results[0].reason], ['rejected', 'locked']);
  assert.equal(odd.body.state.prestige, 0);
});
