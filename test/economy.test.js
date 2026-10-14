// اختبارات الاقتصاد الخادمي: الخادم مصدر الحقيقة للذهب والطاقة والمشتريات والتعزيز.
// تشغّل خادماً حقيقياً (SQLite مؤقتة أو PostgreSQL عند TEST_DATABASE_URL) وتتحقق من
// ميزانيات النقر/الطاقة، تسوية الدخل السلبي بزمن الخادم، التكرار الآمن، وترحيل الصفوف القديمة.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../db');

const PORT = 3223;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-economy-'));
const DB_FILE = path.join(tmpDir, 'game.db');
const PG_URL = process.env.TEST_DATABASE_URL || '';
const RUN = `${process.pid}_${Date.now().toString(36)}`; // معرفات فريدة لأن PostgreSQL تُشارك بين ملفات الاختبار
let child = null;
let store = null;

function startServer(env = {}) {
  child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '', DATABASE_FILE: DB_FILE, DATABASE_URL: PG_URL, ...env },
    stdio: 'inherit',
  });
}
async function waitReady(base = BASE) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${base}/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('خادم اختبار الاقتصاد لم يبدأ');
}
async function stopServer() {
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  child = null;
}
const uid = (name) => `eco_${RUN}_${name}`;
const guest = (id) => ({ 'X-Guest-Id': id, 'Content-Type': 'application/json' });
const me = async (id, qs = '') => (await fetch(`${BASE}/api/me${qs}`, { headers: guest(id) })).json();
const fund = async (id) => { await me(id); await me(`${id}-friend`, `?ref=ref_guest_${id}`); }; // 1000 ذهب موثوق عبر دعوة
async function sendOps(id, ops, { session = 'dev', from = 1 } = {}) {
  const body = { session, ops: ops.map((op, i) => ({ seq: from + i, ...op })) };
  const res = await fetch(`${BASE}/api/ops`, { method: 'POST', headers: guest(id), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function raw(id, body) {
  const res = await fetch(`${BASE}/api/ops`, { method: 'POST', headers: guest(id), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
// تعديل دفتر المزامنة مباشرة في قاعدة البيانات (نفس القفل الذي يستخدمه الخادم) لمحاكاة مرور الوقت
async function patchUser(id, mutate) {
  await store.withUsers([id], async () => {
    const user = await store.getUser(id);
    mutate(user);
    await store.putUser(user);
  });
}

before(async () => {
  startServer();
  await waitReady();
  process.env.DATABASE_FILE = DB_FILE;
  process.env.DATABASE_URL = PG_URL;
  store = createStore();
});
after(async () => {
  await stopServer();
  if (store) await store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('mine: clicks are credited at click power and cost energy; the server reports the settled state', async () => {
  const id = uid('miner');
  const fresh = await me(id);
  assert.equal(fresh.revision, 0);
  const { body } = await sendOps(id, [{ type: 'mine', clicks: 12, boosted: 0 }]);
  assert.equal(body.ok, true);
  assert.deepEqual(body.results, [{ seq: 1, type: 'mine', status: 'ok', clicks: 12, boosted: 0, gold: 12 }]);
  assert.equal(body.state.gold, 12);
  assert.equal(body.state.totalEarned, 12);
  assert.ok(body.state.energy <= 988.5 && body.state.energy >= 987, `energy ${body.state.energy}`);
  assert.ok(body.revision > fresh.revision);
  assert.equal(body.sessionSeq, 1);
});

test('mine: click bursts are bounded by the click-rate window, not by what the client claims', async () => {
  const id = uid('burst');
  await me(id);
  const { body } = await sendOps(id, [{ type: 'mine', clicks: 5000, boosted: 0 }]);
  assert.equal(body.results[0].status, 'clamped');
  // نافذة شبه صفرية + تسامح ثانية واحدة ⇒ ≤ 20 نقرة + هامش زمن الاختبار
  assert.ok(body.results[0].clicks <= 60, `accepted ${body.results[0].clicks}`);
  assert.equal(body.state.gold, body.results[0].clicks);
  assert.equal(body.violations, 1);
});

test('mine: energy is the hard bound — spent energy is not recreated by the next request', async () => {
  const id = uid('energy');
  await me(id);
  const now = Date.now();
  await patchUser(`guest_${id}`, (u) => { u.state.energy = 10; u.sync.energyAt = now; });
  const first = await sendOps(id, [{ type: 'mine', clicks: 15, boosted: 0 }]);
  assert.equal(first.body.results[0].status, 'clamped');
  assert.equal(first.body.results[0].clicks, 10);
  assert.equal(first.body.state.gold, 10);
  const second = await sendOps(id, [{ type: 'mine', clicks: 15, boosted: 0 }], { from: 2 });
  assert.ok(second.body.results[0].clicks <= 1, `second batch accepted ${second.body.results[0].clicks}`);
  // بعد 100 ثانية حقيقية من التجدد (3/ث) تتاح 300 طاقة فقط
  await patchUser(`guest_${id}`, (u) => { u.sync.energyAt = Date.now() - 100_000; u.state.energy = 0; });
  const regen = await sendOps(id, [{ type: 'mine', clicks: 1000, boosted: 0 }], { from: 3 });
  assert.ok(regen.body.results[0].clicks >= 300 && regen.body.results[0].clicks <= 303, `regen clicks ${regen.body.results[0].clicks}`);
  assert.ok(regen.body.state.energy < 3, `leftover ${regen.body.state.energy}`);
});

test('mine: unsynced clicking is honoured for at most ten minutes of regeneration', async () => {
  const id = uid('offline-clicks');
  await me(id);
  await patchUser(`guest_${id}`, (u) => { u.sync.energyAt = Date.now() - 7 * 24 * 3600e3; u.state.energy = 1000; });
  const { body } = await sendOps(id, [{ type: 'mine', clicks: 1_000_000, boosted: 0 }]);
  const max = 1000 + 600 * 3 + 20;
  assert.ok(body.results[0].clicks <= max, `accepted ${body.results[0].clicks} > ${max}`);
  assert.ok(body.results[0].clicks >= 1000 + 600 * 3, `accepted ${body.results[0].clicks}`);
  assert.equal(body.state.energy, 1000); // أسبوع من التجدد يعيد المخزون لحده الأقصى، لا أكثر
  const again = await sendOps(id, [{ type: 'mine', clicks: 1_000_000, boosted: 0 }], { from: 2 });
  assert.ok(again.body.results[0].clicks <= 1000 + 20, `second burst ${again.body.results[0].clicks}`);
});

test('buy: prices and powers are derived server-side; unfunded purchases are rejected', async () => {
  const id = uid('buyer');
  await fund(id);
  const { body } = await sendOps(id, [
    { type: 'buy', item: 'click' }, { type: 'buy', item: 'bot' }, { type: 'buy', item: 'rig' }, { type: 'buy', item: 'hack' },
  ]);
  assert.deepEqual(body.results.map((r) => r.status), ['ok', 'ok', 'rejected', 'invalid']);
  assert.equal(body.state.gold, 1000 - 50 - 200);
  assert.deepEqual(body.state.owned, { click: 1, bot: 1, rig: 0 });
  assert.equal(body.state.clickPower, 2);
  assert.equal(body.state.passiveIncome, 5);
  assert.deepEqual(body.state.costs, { click: 75, bot: 280, rig: 1000 });
  assert.equal(body.violations, 1);
  const ledger = await store.ledgerFor(`guest_${id}`);
  assert.deepEqual(ledger.map((e) => [e.kind, e.goldDelta]).sort(), [['buy', -200], ['buy', -50]]);
});

test('ops batches are idempotent per session: retries never double-apply, new sessions start fresh', async () => {
  const id = uid('retry');
  await fund(id);
  const batch = [{ type: 'buy', item: 'click' }, { type: 'mine', clicks: 5, boosted: 0 }];
  const first = await sendOps(id, batch, { session: 'phone' });
  assert.deepEqual(first.body.results.map((r) => r.status), ['ok', 'ok']);
  assert.equal(first.body.state.gold, 1000 - 50 + 10); // النقرات بقوة 2 بعد الشراء
  for (let i = 0; i < 3; i++) {
    const retry = await sendOps(id, batch, { session: 'phone' });
    assert.deepEqual(retry.body.results.map((r) => r.status), ['duplicate', 'duplicate']);
    assert.equal(retry.body.applied, 0);
    assert.equal(retry.body.state.gold, 960);
    assert.equal(retry.body.state.owned.click, 1);
  }
  // دفعة تحوي عمليات مؤكدة وأخرى جديدة: تُطبَّق الجديدة فقط
  const mixed = await sendOps(id, [...batch, { type: 'mine', clicks: 3, boosted: 0 }], { session: 'phone' });
  assert.deepEqual(mixed.body.results.map((r) => r.status), ['duplicate', 'duplicate', 'ok']);
  assert.equal(mixed.body.state.gold, 966);
  assert.equal(mixed.body.sessionSeq, 3);
  // جهاز آخر بجلسة جديدة يبدأ ترقيمه من 1 دون أن يُعدّ مكرراً
  const other = await sendOps(id, [{ type: 'mine', clicks: 2, boosted: 0 }], { session: 'desktop' });
  assert.equal(other.body.results[0].status, 'ok');
  assert.equal(other.body.state.gold, 970);
  assert.equal((await me(id)).state.gold, 970);
});

test('ops requests with malformed shapes or non-increasing sequences are rejected without side effects', async () => {
  const id = uid('malformed');
  await me(id);
  const cases = [
    { session: 'x', ops: [{ seq: 2, type: 'mine', clicks: 1 }, { seq: 1, type: 'mine', clicks: 1 }] },
    { session: 'x', ops: [{ seq: 1, type: 'mine', clicks: 1 }, { seq: 1, type: 'mine', clicks: 1 }] },
    { session: 'x', ops: [{ seq: 1, type: 'print_money' }] },
    { session: 'x', ops: [null] },
    { session: 'x', ops: 'mine' },
    { session: '', ops: [] },
    { session: 'x', ops: Array.from({ length: 65 }, (_, i) => ({ seq: i + 1, type: 'mine', clicks: 1 })) },
    [],
  ];
  for (const body of cases) assert.equal((await raw(id, body)).status, 400, JSON.stringify(body).slice(0, 60));
  assert.equal((await me(id)).state.gold, 0);
});

test('boost: server-owned window — doubles boosted clicks and passive income, enforces the cooldown', async () => {
  const id = uid('boost');
  await fund(id);
  const { body } = await sendOps(id, [
    { type: 'buy', item: 'bot' },
    { type: 'boost' },
    { type: 'mine', clicks: 10, boosted: 10 },
    { type: 'boost' },
  ]);
  assert.deepEqual(body.results.map((r) => r.status), ['ok', 'ok', 'ok', 'active']);
  assert.equal(body.results[2].gold, 20);
  assert.ok(body.state.boostUntil > Date.now() && body.state.boostUntil <= Date.now() + 30_000);
  assert.ok(Math.abs(body.state.boostCooldownUntil - body.state.boostUntil - 270_000) < 1000);
  assert.equal(body.state.gold, 1000 - 200 + 20);
  // تعزيز منتهٍ وتهدئة سارية ⇒ يُرفض؛ ولا يُقبل تعزيز مزوّر عبر الحفظ القديم
  await patchUser(`guest_${id}`, (u) => { u.state.boostUntil = Date.now() - 1000; });
  const during = await sendOps(id, [{ type: 'boost' }], { from: 5 });
  assert.equal(during.body.results[0].status, 'cooldown');
  // الدخل السلبي يُضاعف فقط داخل نافذة التعزيز الحقيقية: 100 ثانية سابقة منها 30 معزّزة ⇒ 5×(100+30)
  await patchUser(`guest_${id}`, (u) => {
    u.sync.settledAt = Date.now() - 100_000;
    u.state.boostUntil = Date.now() - 10_000; // التعزيز كان نشطاً بين −40ث و−10ث
  });
  const before = 820;
  const settled = await me(id);
  const gained = settled.state.gold - before;
  assert.ok(Math.abs(gained - 5 * 130) < 6, `passive gain ${gained}`);
});

test('passive income is settled from server time, capped at eight hours, and reported as offline earnings', async () => {
  const id = uid('passive');
  await fund(id);
  const bought = await sendOps(id, [{ type: 'buy', item: 'rig' }]);
  assert.equal(bought.body.state.passiveIncome, 25);
  await patchUser(`guest_${id}`, (u) => { u.sync.settledAt = Date.now() - 100_000; });
  const short = await me(id);
  assert.ok(Math.abs(short.state.gold - 2500) < 6, `gold ${short.state.gold}`);
  assert.ok(Math.abs(short.offline.gold - 2500) < 6);
  assert.ok(short.offline.seconds >= 100 && short.offline.seconds <= 102);
  await patchUser(`guest_${id}`, (u) => { u.sync.settledAt = Date.now() - 10 * 24 * 3600e3; });
  const long = await me(id);
  assert.ok(Math.abs(long.state.gold - (short.state.gold + 25 * 8 * 3600)) < 6, `gold ${long.state.gold}`);
  assert.ok(long.revision > short.revision);
});

test('legacy /api/save never credits client balances or purchases, before or after ops', async () => {
  const id = uid('legacy');
  await fund(id);
  const forged = {
    gold: 1e12, totalEarned: 1e12, clickPower: 1e5, passiveIncome: 1e9, energy: 1000,
    owned: { click: 999, bot: 999, rig: 999 }, adventureUpgrades: { magnet: 5, cart: 5 }, boostUntil: Date.now() + 3600e3,
  };
  const res = await fetch(`${BASE}/api/save`, { method: 'POST', headers: guest(id), body: JSON.stringify({ state: forged, migrate: true }) });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.legacy, true);
  assert.equal(body.corrected, true);
  assert.equal(body.state.gold, 1000);
  assert.deepEqual(body.state.owned, { click: 0, bot: 0, rig: 0 });
  assert.equal(body.state.adventureUpgrades.magnet, 0);
  assert.equal(body.state.boostUntil, 0);
  assert.equal((await me(id)).state.gold, 1000);
});

test('rewards: arena payouts are rate-limited; adventure gold is only paid through verified run reports', async () => {
  const id = uid('rewards');
  await me(id);
  const { body } = await sendOps(id, [
    { type: 'reward', game: 'arena' },
    { type: 'reward', game: 'arena' },
    { type: 'reward', game: 'casino', score: 99999 },
    { type: 'reward', game: 'adventure', score: 99999, mode: 'boss', boss: true },
  ]);
  assert.deepEqual(body.results.map((r) => r.status), ['ok', 'too_soon', 'invalid', 'invalid']);
  assert.equal(body.results[0].gold, 50);
  assert.equal(body.results[3].reason, 'use_run');
  assert.equal(body.state.gold, 50);
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRewardAt = { arena: Date.now() - 60_000 }; });
  const later = await sendOps(id, [{ type: 'reward', game: 'arena' }], { from: 5 });
  assert.equal(later.body.results[0].gold, 50);
  assert.equal(later.body.state.gold, 100);
});

test('run: a finished round updates the server-side adventure stats, pays the capped reward and unlocks zones', async () => {
  const id = uid('runner');
  const fresh = await me(id);
  assert.deepEqual(fresh.state.adventure, { runs: 0, gems: 0, maxCombo: 0, bestScore: 0, bestSurvival: 0, bossWins: 0, rewardEarned: 0, playSec: 0, zones: 1 });
  assert.deepEqual(fresh.race, { races: 0, wins: 0, bestScore: 0 });
  const { body } = await sendOps(id, [{ type: 'run', mode: 'classic', difficulty: 'hard', score: 700, gems: 30, combo: 12, duration: 60, boss: false, race: false, ago: 0 }]);
  const r = body.results[0];
  assert.equal(r.status, 'ok');
  assert.equal(r.gold, 100); // سقف الكلاسيك
  assert.equal(r.zones, 2);
  assert.equal(r.unlocked, true); // 30 جوهرة ≥ 25
  assert.equal(body.state.gold, 100);
  assert.deepEqual(body.state.adventure, { runs: 1, gems: 30, maxCombo: 12, bestScore: 700, bestSurvival: 0, bossWins: 0, rewardEarned: 100, playSec: 60, zones: 2 });
  const ledger = await store.ledgerFor(`guest_${id}`, 10);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, 'run');
  assert.equal(ledger[0].goldDelta, 100);
  assert.deepEqual(ledger[0].detail, { mode: 'classic', difficulty: 'hard', score: 700, gems: 30, combo: 12, duration: 60, boss: false, race: false, zones: 2 });
  // الإحصاءات تُقرأ من الملف الشخصي بعد إعادة الدخول
  const again = await me(id);
  assert.equal(again.state.adventure.zones, 2);
  assert.equal(again.state.adventure.gems, 30);
});

test('run: reported play time cannot exceed real time since the previous round; short rounds do not count', async () => {
  const id = uid('runtime');
  await me(id);
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 10_000; });
  const tooFast = await sendOps(id, [{ type: 'run', mode: 'classic', score: 500, gems: 10, combo: 5, duration: 60, ago: 0 }]);
  assert.equal(tooFast.body.results[0].status, 'rejected');
  assert.equal(tooFast.body.results[0].reason, 'time');
  assert.equal(tooFast.body.state.adventure.runs, 0);
  assert.equal(tooFast.body.state.gold, 0);
  assert.equal(tooFast.body.violations, 1);
  const short = await sendOps(id, [{ type: 'run', mode: 'survival', score: 40, gems: 2, combo: 2, duration: 3, ago: 0 }], { from: 2 });
  assert.equal(short.body.results[0].status, 'rejected');
  assert.equal(short.body.results[0].reason, 'short');
  assert.equal(short.body.violations, 1); // ليست مخالفة
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 70_000; });
  const ok = await sendOps(id, [{ type: 'run', mode: 'classic', score: 500, gems: 10, combo: 5, duration: 60, ago: 0 }], { from: 3 });
  assert.equal(ok.body.results[0].status, 'ok');
  assert.equal(ok.body.state.adventure.runs, 1);
  assert.equal(ok.body.state.gold, 100);
});

test('run: physically impossible numbers are clamped to what the game can produce and flagged', async () => {
  const id = uid('runclamp');
  await me(id);
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 120_000; });
  const { body } = await sendOps(id, [{ type: 'run', mode: 'classic', score: 1_000_000, gems: 9999, combo: 9999, duration: 60, boss: true, ago: 0 }]);
  const r = body.results[0];
  assert.equal(r.status, 'clamped');
  assert.equal(r.gems, 305);     // ≤ 5 عناصر/ثانية × 60 + 5
  assert.equal(r.combo, 305);
  assert.equal(r.score, 18_300); // سقف فيزيائي 300 نقطة/ثانية
  assert.equal(r.boss, false);   // لا زعيم خارج وضع الزعيم
  assert.equal(r.gold, 100);     // المكافأة من النقاط التي يسمح بها زمن اللعب، بسقف الوضع
  assert.equal(body.violations, 1);
  assert.deepEqual(body.state.adventure, { runs: 1, gems: 305, maxCombo: 305, bestScore: 18_300, bestSurvival: 0, bossWins: 0, rewardEarned: 100, playSec: 60, zones: 3 });
});

test('run: reward follows play time — a 5-second round cannot claim a full-score payout', async () => {
  const id = uid('runshort');
  await me(id);
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 120_000; });
  const { body } = await sendOps(id, [{ type: 'run', mode: 'survival', score: 1500, gems: 5, combo: 5, duration: 5, ago: 0 }]);
  assert.equal(body.results[0].status, 'ok');
  assert.equal(body.results[0].gold, Math.floor(5 * 40 / 5 * 1.4)); // 56 بدل سقف 150
  assert.equal(body.state.adventure.bestSurvival, 1500);
  assert.equal(body.state.adventure.rewardEarned, 56);
});

test('run: rounds queued offline are accepted on their own timeline; the 20-second reward gap applies to round ends', async () => {
  const id = uid('runqueue');
  await me(id);
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 200_000; });
  const { body } = await sendOps(id, [
    { type: 'run', mode: 'classic', score: 500, gems: 10, combo: 5, duration: 60, ago: 130_000 },
    { type: 'run', mode: 'classic', score: 500, gems: 10, combo: 5, duration: 60, ago: 65_000 },
    { type: 'run', mode: 'classic', score: 500, gems: 10, combo: 5, duration: 60, ago: 0 },
  ]);
  assert.deepEqual(body.results.map((r) => [r.status, r.gold]), [['ok', 100], ['ok', 100], ['ok', 100]]);
  assert.equal(body.state.adventure.runs, 3);
  assert.equal(body.state.adventure.zones, 2); // 3 جولات
  assert.equal(body.state.gold, 300);
  // جولتا بقاء قصيرتان متتاليتان: كلتاهما تُحتسبان في السجل، الثانية بلا ذهب (فاصل 6 ثوانٍ < 20)
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 60_000; u.sync.lastRewardAt.adventure = Date.now() - 60_000; });
  const quick = await sendOps(id, [
    { type: 'run', mode: 'survival', score: 200, gems: 4, combo: 4, duration: 6, ago: 6_000 },
    { type: 'run', mode: 'survival', score: 200, gems: 4, combo: 4, duration: 6, ago: 0 },
  ], { from: 4 });
  assert.deepEqual(quick.body.results.map((r) => [r.status, r.gold, r.reason || null]), [['ok', 56, null], ['ok', 0, 'too_soon']]);
  assert.equal(quick.body.state.adventure.runs, 5);
  assert.equal(quick.body.state.gold, 356);
});

test('run: after a long absence at most 30 minutes of play can be reported, however many rounds are claimed', async () => {
  const id = uid('runwindow');
  await me(id);
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 10 * 3600_000; });
  const ops = Array.from({ length: 40 }, (_, i) => ({ type: 'run', mode: 'classic', score: 500, gems: 10, combo: 5, duration: 60, ago: (39 - i) * 60_000 })); // 40 جولة «منذ 39 دقيقة» حتى الآن
  const { body } = await sendOps(id, ops);
  const statuses = body.results.map((r) => r.status);
  assert.equal(statuses.filter((x) => x === 'ok').length, 30);
  assert.equal(statuses.filter((x) => x === 'rejected').length, 10);
  assert.equal(body.state.adventure.runs, 30);
  assert.equal(body.state.adventure.playSec, 1800);
  assert.equal(body.state.gold, 3000);
});

test('run: boss kills need boss mode and a plausible duration; race rounds build stats but pay no gold', async () => {
  const id = uid('runboss');
  await me(id);
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 600_000; });
  const { body } = await sendOps(id, [
    { type: 'run', mode: 'boss', score: 300, gems: 5, combo: 5, duration: 6, boss: true, ago: 200_000 },       // أقصر من الحد: لا يُحتسب القتل
    { type: 'run', mode: 'boss', score: 600, gems: 20, combo: 10, duration: 40, boss: true, ago: 120_000 },    // قتل زعيم حقيقي
    { type: 'run', mode: 'classic', score: 400, gems: 15, combo: 8, duration: 60, race: true, ago: 0 },        // سباق: للمجد
  ]);
  assert.equal(body.results[0].status, 'clamped');
  assert.equal(body.results[0].boss, false);
  assert.equal(body.results[1].status, 'ok');
  assert.equal(body.results[1].boss, true);
  assert.equal(body.results[1].gold, 100 + 150);
  assert.equal(body.results[1].zones, 3); // اهزم الزعيم مرة
  assert.equal(body.results[2].status, 'ok');
  assert.equal(body.results[2].race, true);
  assert.equal(body.results[2].gold, 0);
  assert.equal(body.state.adventure.bossWins, 1);
  assert.equal(body.state.adventure.runs, 3);
  assert.equal(body.state.adventure.gems, 40);
  assert.equal(body.state.gold, 250 + Math.floor(6 * 40 / 5 * 1.1)); // الجولة القصيرة تكافأ بقدر زمنها فقط
  assert.equal(body.results[0].gold, Math.floor(6 * 40 / 5 * 1.1));
});

test('profile exposes server-sealed race totals as a trusted adventure stat', async () => {
  const id = uid('racer');
  await me(id);
  await store.recordRaceResult('2026-W01', { id: `guest_${id}`, name: 'r', score: 420, won: true });
  await store.recordRaceResult('2026-W02', { id: `guest_${id}`, name: 'r', score: 380, won: false });
  const profile = await me(id);
  assert.deepEqual(profile.race, { races: 2, wins: 1, bestScore: 420 });
});

test('referral credits reach the inviter through the authoritative state without a client save', async () => {
  const id = uid('inviter2');
  await me(id);
  const before = await sendOps(id, [{ type: 'mine', clicks: 3, boosted: 0 }]);
  assert.equal(before.body.state.gold, 3);
  await me(`${id}-pal`, `?ref=ref_guest_${id}`);
  const after = await sendOps(id, [{ type: 'mine', clicks: 2, boosted: 0 }], { from: 2 });
  assert.equal(after.body.state.gold, 1005);
  assert.equal(after.body.referralCount, 1);
  assert.ok(after.body.revision > before.body.revision + 1);
});

test('concurrent duplicate batches from a flaky network apply exactly once', async () => {
  const id = uid('concurrent');
  await fund(id);
  const batch = { session: 'flaky', ops: [{ seq: 1, type: 'buy', item: 'bot' }, { seq: 2, type: 'mine', clicks: 4, boosted: 0 }] };
  const responses = await Promise.all(Array.from({ length: 6 }, () => raw(id, batch)));
  assert.ok(responses.every((r) => r.status === 200));
  const applied = responses.map((r) => r.body.applied).sort();
  assert.deepEqual(applied, [0, 0, 0, 0, 0, 2]);
  const final = await me(id);
  assert.ok(Math.abs(final.state.gold - (1000 - 200 + 4)) < 2, `gold ${final.state.gold}`); // + ثوانٍ قليلة من دخل العامل الآلي
  assert.equal(final.state.owned.bot, 1);
});

test('existing player rows created before the ops protocol keep their balances (SQLite schema upgrade)', async () => {
  // قاعدة قديمة بلا أعمدة revision/sync_json وبلا op_ledger
  const legacyFile = path.join(tmpDir, 'legacy.db');
  const Database = require('better-sqlite3');
  const conn = new Database(legacyFile);
  conn.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, state_json TEXT NOT NULL,
    referral_count INTEGER NOT NULL DEFAULT 0, referral_earnings REAL NOT NULL DEFAULT 0,
    referred_by TEXT, daily_last_claim TEXT, daily_streak INTEGER NOT NULL DEFAULT 0,
    unacked_credits REAL NOT NULL DEFAULT 0, violations INTEGER NOT NULL DEFAULT 0,
    last_save_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE pending_referrals (id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);`);
  const lastSave = Date.now() - 120_000;
  const legacyState = {
    gold: 4321.5, totalEarned: 9000, clickPower: 3, passiveIncome: 10, energy: 400, maxEnergy: 1000,
    owned: { click: 2, bot: 2, rig: 0 }, costs: { click: 112, bot: 392, rig: 1000 },
    adventureUpgrades: { magnet: 1, cart: 0, speed: 0, shield: 0, heart: 0, clock: 0, luck: 0, skill: 0 },
    boostUntil: 0, boostCooldownUntil: 0, lastSeen: lastSave,
  };
  conn.prepare(`INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('guest_veteran', 'Veteran', JSON.stringify(legacyState), 2, 2000, null, null, 0, 0, 1, lastSave, lastSave - 86400e3, lastSave);
  conn.close();

  const port = PORT + 10;
  const base = `http://127.0.0.1:${port}`;
  const legacyServer = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), BOT_TOKEN: '', DATABASE_FILE: legacyFile, DATABASE_URL: '' },
    stdio: 'inherit',
  });
  try {
    await waitReady(base);
    const headers = guest('veteran');
    const profile = await (await fetch(`${base}/api/me`, { headers })).json();
    // ~120 ثانية من الدخل السلبي (10/ث) تُسوّى من آخر حفظ قديم؛ لا تصفير ولا فقدان
    assert.ok(profile.state.gold >= 4321.5 + 1200 && profile.state.gold < 4321.5 + 1230, `gold ${profile.state.gold}`);
    assert.deepEqual(profile.state.owned, { click: 2, bot: 2, rig: 0 });
    assert.equal(profile.state.adventureUpgrades.magnet, 1);
    assert.equal(profile.state.clickPower, 3);
    assert.equal(profile.referralCount, 2);
    assert.ok(profile.state.energy >= 760 && profile.state.energy <= 1000, `energy ${profile.state.energy}`); // 400 + 120ث × 3
    assert.equal(profile.revision, 1);
    // ملف قديم بلا إحصاءات مغامرة: يبدأ من الصفر بمنطقة واحدة، والجولة الأولى تُسجَّل عادياً
    assert.deepEqual(profile.state.adventure, { runs: 0, gems: 0, maxCombo: 0, bestScore: 0, bestSurvival: 0, bossWins: 0, rewardEarned: 0, playSec: 0, zones: 1 });
    const res = await fetch(`${base}/api/ops`, { method: 'POST', headers, body: JSON.stringify({ session: 'old-phone', ops: [{ seq: 1, type: 'buy', item: 'click' }, { seq: 2, type: 'mine', clicks: 4, boosted: 0 }, { seq: 3, type: 'run', mode: 'blitz', score: 200, gems: 8, combo: 6, duration: 30, ago: 0 }] }) });
    const body = await res.json();
    assert.deepEqual(body.results.map((r) => r.status), ['ok', 'ok', 'ok']);
    assert.equal(body.state.adventure.runs, 1);
    assert.equal(body.results[2].gold, Math.floor(200 / 5 * 1.15));
    assert.equal(body.results[0].cost, 112);
    assert.equal(body.state.owned.click, 3);
    assert.equal(body.results[1].gold, 16); // قوة النقر 4 بعد الشراء
    const reopened = new Database(legacyFile, { readonly: true });
    const cols = reopened.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    assert.ok(cols.includes('revision') && cols.includes('sync_json'));
    assert.equal(reopened.prepare('SELECT COUNT(*) AS c FROM op_ledger').get().c, 2);
    reopened.close();
  } finally {
    if (legacyServer.exitCode === null) {
      const exit = new Promise((resolve) => legacyServer.once('exit', resolve));
      legacyServer.kill('SIGTERM');
      await exit;
    }
  }
});

test('balances and session sequences survive a server restart', async () => {
  const id = uid('restart');
  await fund(id);
  await sendOps(id, [{ type: 'buy', item: 'click' }], { session: 'persist' });
  await stopServer();
  startServer();
  await waitReady();
  const retry = await sendOps(id, [{ type: 'buy', item: 'click' }], { session: 'persist' });
  assert.equal(retry.body.results[0].status, 'duplicate');
  assert.equal(retry.body.state.gold, 950);
  assert.equal(retry.body.state.owned.click, 1);
});
