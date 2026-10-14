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

// ⚔️ الساحة: نلعب المباراة بالمحرك المشترك نفسه (كما يفعل المتصفح) ثم نرسل الحركات فقط
const ArenaRules = require('../public/arena-rules');
function playArena(level, seed, policy) {
  const b = ArenaRules.newBattle({ level, seed });
  while (b.active) {
    if (ArenaRules.playerMove(b, policy(b)).error) throw new Error('سياسة اختبار غير قانونية');
    if (!b.active) break;
    ArenaRules.enemyMove(b);
    if (!b.active) break;
    ArenaRules.nextRound(b);
  }
  return { outcome: b.outcome, moves: b.moves, rounds: b.round, enemyTurns: b.enemyTurns };
}
const firstLegal = (b, prefs) => prefs.find((a) => ArenaRules.canAct(b.player, a)) || 'WAIT';
const ARENA_POLICIES = [
  (b) => firstLegal(b, b.player.hp <= 40 ? ['HEAL', 'ATTACK', 'WAIT'] : ['ATTACK', 'WAIT']),
  (b) => firstLegal(b, b.player.hp <= 55 ? ['HEAL', 'ATTACK', 'DEFEND'] : ['ATTACK', 'DEFEND', 'WAIT']),
  (b) => firstLegal(b, ['ATTACK', 'WAIT']),
];
// مباراة فائزة لبذرة معيّنة: سياسات بسيطة ثم بحث عشوائي حتمي — الفوز ممكن دائماً لمن يعرف البذرة (موثّق في PR-10)
function winningArena(level, seed) {
  for (const policy of ARENA_POLICIES) { const r = playArena(level, seed, policy); if (r.outcome === 'win') return r; }
  const rng = ArenaRules.mulberry32(seed ^ 0xABCDEF);
  for (let i = 0; i < 500; i++) {
    const r = playArena(level, seed, (b) => { const legal = ArenaRules.ACTIONS.filter((a) => ArenaRules.canAct(b.player, a)); return legal[Math.floor(rng() * legal.length)]; });
    if (r.outcome === 'win') return r;
  }
  throw new Error(`لا مباراة فائزة للبذرة ${seed}`);
}
const losingArena = (level, seed) => playArena(level, seed, () => 'WAIT'); // الانتظار الدائم: الروبوت يفوز أو يُحسم بنسبة الصحة
// تثبيت تذكرة الساحة (بذرة معروفة وزمن إصدار قديم) حتى تكون المباراة حتمية وليست «أسرع من الزمن»
const fixArenaTicket = (id, patch) => patchUser(`guest_${id}`, (u) => { u.sync.arena.ticket = { ...u.sync.arena.ticket, issuedAt: Date.now() - 60_000, ...patch }; });

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
  assert.deepEqual(body.results, [{ seq: 1, type: 'mine', status: 'ok', xp: 1, clicks: 12, boosted: 0, gold: 12 }]); // 12 طاقة → 1 خبرة (البقية 2 تُرحَّل)
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

test('arena: /api/me issues a match ticket (number, seed, enemy level) and the record starts sealed at zero', async () => {
  const id = uid('arena_ticket');
  const first = await me(id);
  assert.deepEqual(first.arena.record, { wins: 0, losses: 0, draws: 0 });
  assert.equal(first.arena.winReward, 50);
  assert.equal(first.arena.minIntervalMs, 10_000);
  assert.equal(first.arena.ticket.matchNo, 1);
  assert.equal(first.arena.ticket.level, 1);
  assert.ok(Number.isInteger(first.arena.ticket.seed) && first.arena.ticket.seed >= 0 && first.arena.ticket.seed < 2 ** 32);
  // التذكرة ثابتة حتى تُستهلك: إعادة التحميل لا تبدّل البذرة (جهاز ثانٍ يرى المباراة نفسها)
  const again = await me(id);
  assert.deepEqual(again.arena.ticket, first.arena.ticket);
  const stored = await store.getUser(`guest_${id}`);
  assert.ok(stored.sync.arena.ticket.issuedAt > 0, 'issue time is kept server-side for the minimum-duration rule');
});

test('arena: the server replays the submitted moves with the ticket seed — a verified win pays 50 gold + 10 XP once per 10 seconds, losses and draws are recorded', async () => {
  const id = uid('arena_win');
  await me(id);
  await fixArenaTicket(id, { seed: 4242, level: 1 });
  const win = winningArena(1, 4242);
  assert.equal(win.outcome, 'win');
  const { body } = await sendOps(id, [{ type: 'arena', matchNo: 1, moves: win.moves }]);
  const r = body.results[0];
  assert.equal(r.status, 'ok');
  assert.equal(r.outcome, 'win');
  assert.equal(r.gold, 50);
  assert.equal(r.xp, 10);
  assert.equal(r.rounds, win.rounds);
  assert.deepEqual(r.record, { wins: 1, losses: 0, draws: 0 });
  assert.equal(r.ticket.matchNo, 2, 'a new ticket is issued in the same response');
  assert.notEqual(r.ticket.seed, 4242);
  assert.deepEqual(body.arena.record, { wins: 1, losses: 0, draws: 0 });
  assert.equal(body.state.gold, 50);
  assert.equal(body.state.xp, 10);
  const ledger = await store.ledgerFor(`guest_${id}`, 10);
  assert.deepEqual(ledger.map((e) => [e.kind, e.goldDelta, e.detail.outcome, e.detail.matchNo]), [['arena', 50, 'win', 1]]);
  // نفس التذكرة مرة ثانية (جهاز آخر/إعادة إرسال بتسلسل جديد): مرفوضة ولا تستهلك شيئاً
  const stale = await sendOps(id, [{ type: 'arena', matchNo: 1, moves: win.moves }], { from: 2 });
  assert.equal(stale.body.results[0].status, 'rejected');
  assert.equal(stale.body.results[0].reason, 'stale_match');
  assert.equal(stale.body.results[0].matchNo, 2);
  assert.equal(stale.body.arena.ticket.matchNo, 2);
  assert.equal(stale.body.state.gold, 50);
  // فوز ثانٍ داخل فاصل الـ10 ثوانٍ: يُسجَّل في السجل لكن بلا ذهب ولا خبرة
  await fixArenaTicket(id, { seed: 4242, level: 1 });
  const soon = await sendOps(id, [{ type: 'arena', matchNo: 2, moves: win.moves }], { from: 3 });
  assert.equal(soon.body.results[0].status, 'too_soon');
  assert.equal(soon.body.results[0].gold, 0);
  assert.ok(soon.body.results[0].retryAt > Date.now());
  assert.deepEqual(soon.body.results[0].record, { wins: 2, losses: 0, draws: 0 });
  assert.equal(soon.body.state.gold, 50);
  assert.equal(soon.body.state.xp, 10);
  // بعد الفاصل: المكافأة تُدفع ثانية
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRewardAt.arena = Date.now() - 60_000; });
  await fixArenaTicket(id, { seed: 4242, level: 1 });
  const later = await sendOps(id, [{ type: 'arena', matchNo: 3, moves: win.moves }], { from: 4 });
  assert.equal(later.body.results[0].status, 'ok');
  assert.equal(later.body.results[0].gold, 50);
  assert.equal(later.body.state.gold, 100);
  // خسارة: تُسجَّل بلا ذهب، وتستهلك التذكرة
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRewardAt.arena = Date.now() - 60_000; });
  await fixArenaTicket(id, { seed: 4242, level: 1 });
  const loss = losingArena(1, 4242);
  assert.equal(loss.outcome, 'loss');
  const lost = await sendOps(id, [{ type: 'arena', matchNo: 4, moves: loss.moves }], { from: 5 });
  assert.equal(lost.body.results[0].status, 'ok');
  assert.equal(lost.body.results[0].outcome, 'loss');
  assert.equal(lost.body.results[0].gold, 0);
  assert.equal(lost.body.results[0].xp, 0);
  assert.deepEqual(lost.body.arena.record, { wins: 3, losses: 1, draws: 0 });
  assert.equal(lost.body.arena.ticket.matchNo, 5);
  assert.equal(lost.body.state.gold, 100);
  assert.equal((await me(id)).state.gold, 100);
});

test('arena: forged matches are rejected — illegal moves, extra moves after the end, unfinished matches, impossible speed, malformed input and the legacy self-declared reward', async () => {
  const id = uid('arena_forge');
  await me(id);
  const win = winningArena(1, 4242);
  // حركات أكثر من الطاقة: الرفض يستهلك التذكرة ويُحتسب مخالفة، ولا ذهب
  await fixArenaTicket(id, { seed: 4242, level: 1 });
  const spam = await sendOps(id, [{ type: 'arena', matchNo: 1, moves: Array(30).fill('ATTACK') }]);
  assert.equal(spam.body.results[0].status, 'rejected');
  assert.equal(spam.body.results[0].reason, 'illegal_move');
  assert.equal(spam.body.results[0].round, 9, 'attack costs 3 and rounds regenerate 2: the ninth consecutive attack has no energy left');
  assert.equal(spam.body.results[0].ticket.matchNo, 2);
  assert.equal(spam.body.violations, 1);
  assert.deepEqual(spam.body.arena.record, { wins: 0, losses: 0, draws: 0 });
  assert.equal(spam.body.state.gold, 0);
  // حركات بعد نهاية المباراة
  await fixArenaTicket(id, { seed: 4242, level: 1 });
  const extra = await sendOps(id, [{ type: 'arena', matchNo: 2, moves: [...win.moves, 'WAIT'] }], { from: 2 });
  assert.equal(extra.body.results[0].status, 'rejected');
  assert.equal(extra.body.results[0].reason, 'extra_moves');
  // مباراة لم تنتهِ (حركة واحدة) لا تُحتسب
  await fixArenaTicket(id, { seed: 4242, level: 1 });
  const short = await sendOps(id, [{ type: 'arena', matchNo: 3, moves: ['ATTACK'] }], { from: 3 });
  assert.equal(short.body.results[0].status, 'rejected');
  assert.equal(short.body.results[0].reason, 'unfinished');
  // الحركات الصحيحة لكن أسرع من مهلات الواجهة نفسها (التذكرة صدرت الآن): لم تُلعب
  await patchUser(`guest_${id}`, (u) => { u.sync.arena.ticket = { ...u.sync.arena.ticket, seed: 4242, level: 1, issuedAt: Date.now() }; });
  const fast = await sendOps(id, [{ type: 'arena', matchNo: 4, moves: win.moves }], { from: 4 });
  assert.equal(fast.body.results[0].status, 'rejected');
  assert.equal(fast.body.results[0].reason, 'too_fast');
  assert.equal(fast.body.state.gold, 0);
  // بذرة أخرى غير بذرة التذكرة: الخادم يحاكي ببذرته هو، فحكمه على الحركات نفسها هو حكم المحرك لتلك البذرة
  await fixArenaTicket(id, { seed: 99991, level: 1 });
  const expected = ArenaRules.replay({ level: 1, seed: 99991, moves: win.moves });
  const mism = await sendOps(id, [{ type: 'arena', matchNo: 5, moves: win.moves }], { from: 5 });
  if (expected.ok) assert.equal(`${mism.body.results[0].status}:${mism.body.results[0].outcome}`, `ok:${expected.outcome}`);
  else assert.equal(`${mism.body.results[0].status}:${mism.body.results[0].reason}`, `rejected:${expected.reason}`);
  assert.equal(mism.body.arena.ticket.matchNo, 6);
  assert.equal(mism.body.state.gold, expected.ok && expected.outcome === 'win' ? 50 : 0);
  // مدخلات مشوّهة لا تستهلك التذكرة
  const before = (await me(id)).arena.ticket;
  const bad = await sendOps(id, [
    { type: 'arena', matchNo: before.matchNo, moves: ['NUKE'] },
    { type: 'arena', matchNo: before.matchNo, moves: [] },
    { type: 'arena', matchNo: before.matchNo, moves: Array(31).fill('WAIT') },
    { type: 'arena', moves: ['WAIT'] },
    { type: 'reward', game: 'arena' },
    { type: 'reward', game: 'adventure', score: 99999, mode: 'boss', boss: true },
  ], { from: 6 });
  assert.deepEqual(bad.body.results.map((r) => r.status), ['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid']);
  assert.equal(bad.body.results[4].reason, 'use_arena');
  assert.equal(bad.body.results[5].reason, 'use_run');
  assert.deepEqual(bad.body.arena.ticket, before);
  assert.equal(bad.body.state.gold, mism.body.state.gold);
  assert.deepEqual(bad.body.arena.record, mism.body.arena.record);
});

test('arena: an existing player row without arena data gets a ticket on first contact and keeps its balance', async () => {
  const id = uid('arena_legacy');
  await fund(id);
  await patchUser(`guest_${id}`, (u) => { delete u.sync.arena; });
  const profile = await me(id);
  assert.equal(profile.state.gold, 1000);
  assert.equal(profile.arena.ticket.matchNo, 1);
  assert.equal(profile.arena.ticket.level, 2, 'enemy level follows the server-side level');
  assert.deepEqual(profile.arena.record, { wins: 0, losses: 0, draws: 0 });
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

test('xp: verified activity grants experience; the level follows the server curve and a level-up is announced', async () => {
  const id = uid('xp');
  await fund(id); // 1000 ذهب موثوق عبر دعوة — والدعوة نفسها تمنح الداعي 100 خبرة (= المستوى 2 تماماً)
  const fresh = await me(id);
  assert.deepEqual(fresh.progress, { level: 2, xp: 100, current: 0, needed: 220 });
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 600_000; });
  await fixArenaTicket(id, { seed: 777, level: 2 });
  const { body } = await sendOps(id, [
    { type: 'mine', clicks: 15, boosted: 0 },                                               // 15 طاقة → 1 خبرة (5 مُرحَّلة)
    { type: 'buy', item: 'bot' },                                                          // 200 ذهب → 10 خبرة
    { type: 'boost' },                                                                     // 10 خبرة
    { type: 'run', mode: 'classic', score: 400, gems: 20, combo: 8, duration: 60, ago: 0 }, // 15 + 10 = 25 خبرة
    { type: 'arena', matchNo: 1, moves: winningArena(2, 777).moves },                      // فوز موثّق → 10 خبرة
  ]);
  assert.deepEqual(body.results.map((r) => r.xp), [1, 10, 10, 25, 10]);
  assert.equal(body.state.xp, 156);
  assert.equal(body.state.level, 2);
  assert.deepEqual(body.progress, { level: 2, xp: 156, current: 56, needed: 220 });
  assert.equal(body.levelUp, null);
  // النقرات القصيرة لا تضيع خبرتها: 5 مُرحَّلة + 5 جديدة = خبرة واحدة
  const carry = await sendOps(id, [{ type: 'mine', clicks: 5, boosted: 0 }], { from: 6 });
  assert.equal(carry.body.results[0].xp, 1);
  assert.equal(carry.body.state.xp, 157);
  // شراء مرفوض لا يمنح خبرة؛ شراءان ناجحان يمنحان بحسب السعر (280 و392 ذهب → 14 و19)
  const rig = await sendOps(id, [{ type: 'buy', item: 'rig' }], { from: 7 });
  assert.equal(rig.body.results[0].status, 'rejected');
  assert.equal(rig.body.results[0].xp, undefined);
  const buys = await sendOps(id, [{ type: 'buy', item: 'bot' }, { type: 'buy', item: 'bot' }], { from: 8 });
  assert.deepEqual(buys.body.results.map((r) => r.xp), [14, 19]);
  assert.equal(buys.body.state.xp, 190);
  assert.equal(buys.body.levelUp, null);
  // عبور عتبة المستوى 3 (320 خبرة) يُعلَن في الدفعة نفسها
  await patchUser(`guest_${id}`, (u) => { u.state.xp = 318; u.state.boostUntil = 0; u.state.boostCooldownUntil = 0; });
  const up = await sendOps(id, [{ type: 'boost' }], { from: 10 });
  assert.equal(up.body.results[0].xp, 10);
  assert.deepEqual(up.body.levelUp, { from: 2, to: 3 });
  assert.deepEqual(up.body.progress, { level: 3, xp: 328, current: 8, needed: 340 });
  assert.equal((await me(id)).progress.level, 3);
});

test('xp: the daily reward grants streak-scaled experience and the referral grants the inviter 100', async () => {
  const id = uid('xpdaily');
  await me(id);
  const res = await fetch(`${BASE}/api/claim-daily`, { method: 'POST', headers: guest(id), body: '{}' });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.xp, 30); // 25 + 5 × سلسلة 1
  assert.equal(body.progress.xp, 30);
  assert.equal(body.levelUp, null);
  await me(`${id}-friend`, `?ref=ref_guest_${id}`);
  const after = await me(id);
  assert.equal(after.progress.xp, 130);
  assert.equal(after.progress.level, 2);
  assert.equal(after.state.gold >= 1500, true);
});

test('xp: players from before experience points keep exactly their old level (and progress inside it)', async () => {
  const id = uid('xplegacy');
  await me(id);
  // محاكاة صف قديم: لا حقل xp، وإجمالي مكاسب 23,000 → المستوى القديم 5 (floor(23000/5000)+1) بنسبة 60% داخله
  await patchUser(`guest_${id}`, (u) => { u.state.totalEarned = 23_000; u.state.gold = 23_000; delete u.state.xp; delete u.state.level; });
  const profile = await me(id);
  assert.equal(profile.progress.level, 5);
  // الخبرة اللازمة للمستوى 5 = 1120، وللمستوى 6 = 1700 → 1120 + 0.6 × 580 = 1468
  assert.equal(profile.progress.xp, 1468);
  assert.equal(profile.state.level, 5);
  const board = await (await fetch(`${BASE}/api/leaderboard`)).json();
  const row = board.leaderboard.find((r) => r.id === `guest_${id}`);
  assert.equal(row.level, 5);
  // الخبرة الجديدة تُضاف فوق المحوَّل ولا تُعاد الحسبة
  const { body } = await sendOps(id, [{ type: 'boost' }]);
  assert.equal(body.state.xp, 1478);
  assert.equal(body.progress.level, 5);
});

const today = () => new Date().toISOString().slice(0, 10);
const setMissions = (id, keys, extra = {}) => patchUser(`guest_${id}`, (u) => {
  u.sync.missions = { day: today(), items: keys.map((key) => ({ key, progress: 0, claimed: false })), bonusClaimed: false, ...extra };
});

test('missions: the server deals three distinct missions per player per UTC day, deterministically', async () => {
  const id = uid('missions');
  const first = await me(id);
  const m = first.missions;
  assert.equal(m.day, today());
  assert.equal(m.items.length, 3);
  assert.equal(new Set(m.items.map((i) => i.key)).size, 3);
  for (const it of m.items) {
    assert.match(it.title, /[\u0600-\u06FF]/, 'titles come from the server in Arabic');
    assert.ok(it.target > 0 && it.gold > 0 && it.xp > 0);
    assert.deepEqual([it.progress, it.done, it.claimed], [0, false, false]);
  }
  assert.ok(m.resetsIn > 0 && m.resetsIn <= 86_400);
  assert.deepEqual(m.bonus, { gold: 300, xp: 100, ready: false, claimed: false });
  // نفس اليوم ونفس اللاعب ⇒ نفس المهام (ولاعب آخر غالباً مجموعة مختلفة لكن ليس شرطاً)
  const again = await me(id);
  assert.deepEqual(again.missions.items.map((i) => i.key), m.items.map((i) => i.key));
  // لا يمكن استلام مهمة ليست ضمن مهام اليوم أو مفتاح مجهول
  const other = ['mine_energy', 'runs', 'boost', 'buy'].find((k) => !m.items.some((i) => i.key === k));
  const { body } = await sendOps(id, [{ type: 'mission', key: other }, { type: 'mission', key: 'nope' }]);
  assert.deepEqual(body.results.map((r) => r.status), ['invalid', 'invalid']);
});

test('missions: progress comes only from verified operations and rewards are paid once, then the day bonus', async () => {
  const id = uid('missionprog');
  await fund(id); // 1000 ذهب موثوق للشراء
  await setMissions(id, ['boost', 'buy', 'mine_energy']);
  const before = (await me(id)).state;
  // تعزيز واحد + شراءان: التعزيز 1/2 (غير مكتمل)، الشراء 2/2 (مكتمل)، الطاقة تتقدم بالنقر الموثوق فقط
  let { body } = await sendOps(id, [{ type: 'boost' }, { type: 'buy', item: 'click' }, { type: 'buy', item: 'click' }, { type: 'mine', clicks: 15 }]);
  assert.deepEqual(body.results.map((r) => r.status), ['ok', 'ok', 'ok', 'ok']);
  const by = (res) => Object.fromEntries(res.missions.items.map((i) => [i.key, i]));
  let mm = by(body);
  assert.deepEqual([mm.boost.progress, mm.boost.done], [1, false]);
  assert.deepEqual([mm.buy.progress, mm.buy.done], [2, true]);
  assert.equal(mm.mine_energy.progress, 15 * body.state.clickPower);
  // الاستلام قبل الاكتمال مرفوض، وبعده يُدفع الذهب والخبرة مرة واحدة فقط
  const goldBefore = body.state.gold; const xpBefore = body.state.xp;
  ({ body } = await sendOps(id, [{ type: 'mission', key: 'boost' }, { type: 'mission', key: 'buy' }, { type: 'mission', key: 'buy' }], { from: 5 }));
  assert.deepEqual(body.results.map((r) => [r.status, r.reason]), [['rejected', 'incomplete'], ['ok', undefined], ['rejected', 'claimed']]);
  assert.equal(body.results[1].gold, 150);
  assert.equal(body.results[1].xp, 40);
  assert.ok(body.state.gold >= goldBefore + 150 && body.state.gold < goldBefore + 150 + 50, `gold ${body.state.gold} vs ${goldBefore}`);
  assert.equal(body.state.xp, xpBefore + 40);
  assert.equal(by(body).buy.claimed, true);
  assert.equal(body.missions.bonus.ready, false);
  // دفتر العمليات يحفظ الاستلام
  const ledger = await store.ledgerFor(`guest_${id}`, 20);
  assert.ok(ledger.some((e) => e.kind === 'mission' && e.goldDelta === 150));
  // إكمال الباقي (عبر الدفتر لتجاوز التهدئة) ثم مكافأة اليوم
  await patchUser(`guest_${id}`, (u) => { for (const it of u.sync.missions.items) if (it.key !== 'buy') it.progress = 999; });
  ({ body } = await sendOps(id, [{ type: 'mission', key: 'bonus' }, { type: 'mission', key: 'boost' }, { type: 'mission', key: 'mine_energy' }, { type: 'mission', key: 'bonus' }, { type: 'mission', key: 'bonus' }], { from: 8 }));
  assert.deepEqual(body.results.map((r) => [r.status, r.reason]), [['rejected', 'incomplete'], ['ok', undefined], ['ok', undefined], ['ok', undefined], ['rejected', 'claimed']]);
  assert.equal(body.results[3].gold, 300);
  assert.equal(body.results[3].xp, 100);
  assert.equal(body.missions.bonus.claimed, true);
  assert.ok(body.missions.items.every((i) => i.claimed));
  assert.equal(body.state.totalEarned >= before.totalEarned + 150 + 100 + 150 + 300, true);
});

test('missions: adventure runs feed run/gem/score/boss/survival missions; a claimed mission stops counting', async () => {
  const id = uid('missionrun');
  await me(id);
  await setMissions(id, ['boss', 'score', 'survival']);
  let { body } = await sendOps(id, [{ type: 'run', mode: 'boss', difficulty: 'normal', score: 420, gems: 10, combo: 4, duration: 30, boss: true, ago: 0 }]);
  assert.equal(body.results[0].status, 'ok');
  const by = (res) => Object.fromEntries(res.missions.items.map((i) => [i.key, i]));
  let mm = by(body);
  assert.deepEqual([mm.boss.progress, mm.boss.done], [1, true]);
  assert.deepEqual([mm.score.progress, mm.score.done], [400, true], 'max-type mission caps its display at the target');
  assert.equal(mm.survival.progress, 0, 'a boss run does not count for survival');
  ({ body } = await sendOps(id, [{ type: 'mission', key: 'boss' }], { from: 2 }));
  assert.equal(body.results[0].status, 'ok');
  assert.equal(body.results[0].gold, 300);
  // جولة بقاء بعد فجوة المكافأة (نحرّك آخر جولة في الدفتر) — تتقدم مهمة البقاء فقط
  await patchUser(`guest_${id}`, (u) => { u.sync.lastRunAt = Date.now() - 60_000; });
  ({ body } = await sendOps(id, [{ type: 'run', mode: 'survival', difficulty: 'normal', score: 260, gems: 3, combo: 2, duration: 40, boss: false, ago: 0 }], { from: 3 }));
  assert.equal(body.results[0].status, 'ok');
  mm = by(body);
  assert.deepEqual([mm.survival.progress, mm.survival.done], [250, true]);
  assert.deepEqual([mm.boss.progress, mm.boss.claimed], [1, true]);
});

test('missions: a new UTC day deals a fresh set and legacy rows without a mission record just get one', async () => {
  const id = uid('missionday');
  await me(id);
  const first = (await me(id)).missions;
  // صف قديم من قبل الميزة: لا سجل مهام إطلاقاً
  await patchUser(`guest_${id}`, (u) => { delete u.sync.missions; });
  const regenerated = (await me(id)).missions;
  assert.deepEqual(regenerated.items.map((i) => i.key), first.items.map((i) => i.key), 'same day ⇒ same deterministic set');
  // سجل من يوم سابق بتقدم ومهام مستلمة ⇒ يُستبدل بمجموعة اليوم من الصفر
  await patchUser(`guest_${id}`, (u) => { u.sync.missions = { day: '2026-01-01', items: [{ key: 'boost', progress: 2, claimed: true }], bonusClaimed: true }; });
  const rolled = (await me(id)).missions;
  assert.equal(rolled.day, today());
  assert.equal(rolled.items.length, 3);
  assert.ok(rolled.items.every((i) => i.progress === 0 && !i.claimed));
  assert.equal(rolled.bonus.claimed, false);
  // سجل تالف (مفتاح مجهول) لا يكسر الحساب
  await patchUser(`guest_${id}`, (u) => { u.sync.missions = { day: today(), items: [{ key: 'ghost', progress: 1 }], bonusClaimed: false }; });
  const healed = (await me(id)).missions;
  assert.deepEqual(healed.items.map((i) => i.key), first.items.map((i) => i.key));
});

const thisWeek = (d = new Date()) => {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400e3 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};
const setWeeklyMissions = (id, keys, extra = {}) => patchUser(`guest_${id}`, (u) => {
  u.sync.weeklyMissions = { week: thisWeek(), items: keys.map((key) => ({ key, progress: 0, claimed: false })), bonusClaimed: false, ...extra };
});

test('weekly missions: the server deals three distinct missions per player per ISO week, deterministically', async () => {
  const id = uid('weekly');
  const first = await me(id);
  const w = first.weeklyMissions;
  assert.equal(w.week, thisWeek());
  assert.equal(w.items.length, 3);
  assert.equal(new Set(w.items.map((i) => i.key)).size, 3);
  for (const it of w.items) {
    assert.match(it.title, /[\u0600-\u06FF]/, 'titles come from the server in Arabic');
    assert.ok(it.target > 0 && it.gold > 0 && it.xp > 0);
    assert.deepEqual([it.progress, it.done, it.claimed], [0, false, false]);
  }
  assert.ok(w.resetsIn > 0 && w.resetsIn <= 7 * 86_400);
  assert.deepEqual(w.bonus, { gold: 1000, xp: 300, ready: false, claimed: false });
  // نفس الأسبوع ونفس اللاعب ⇒ نفس المهام
  const again = await me(id);
  assert.deepEqual(again.weeklyMissions.items.map((i) => i.key), w.items.map((i) => i.key));
  // لا يمكن استلام مهمة أسبوعية ليست ضمن مهام هذا الأسبوع أو مفتاح مجهول
  const other = ['mine_energy', 'runs', 'boost', 'buy'].find((k) => !w.items.some((i) => i.key === k));
  const { body } = await sendOps(id, [{ type: 'weekly_mission', key: other }, { type: 'weekly_mission', key: 'nope' }]);
  assert.deepEqual(body.results.map((r) => r.status), ['invalid', 'invalid']);
});

test('weekly missions: progress comes only from verified operations and rewards are paid once, then the week bonus', async () => {
  const id = uid('weeklyprog');
  await fund(id); // 1000 ذهب موثوق للشراء
  await setWeeklyMissions(id, ['boost', 'buy', 'mine_energy']);
  const before = (await me(id)).state;
  // عمليات مرفوضة لا ترفع التقدّم؛ عمليات مقبولة ترفع تقدّم اليوم والأسبوع معاً
  let { body } = await sendOps(id, [
    { type: 'boost' }, { type: 'boost' }, // الثانية active فلا تُحتسب
    { type: 'buy', item: 'rig' }, { type: 'buy', item: 'rig' }, // الثانية insufficient فلا تُحتسب
    ...Array.from({ length: 5 }, () => ({ type: 'buy', item: 'click' })), // لا يكفي الذهب بعد نفاد الرصيد!
  ]);
  const by = (res) => Object.fromEntries(res.weeklyMissions.items.map((i) => [i.key, i]));
  assert.equal(by(body).boost.progress, 1, 'active/cooldown boosts do not advance weekly progress');
  assert.equal(by(body).buy.progress, 1, 'unfunded purchases do not advance weekly progress');
  // تمويل إضافي وإكمال 6 مشتريات
  await patchUser(`guest_${id}`, (u) => { u.state.gold += 2000; });
  ({ body } = await sendOps(id, [
    ...Array.from({ length: 5 }, () => ({ type: 'buy', item: 'click' })),
    { type: 'mine', clicks: 15 },
  ], { from: 10 }));
  let wm = by(body);
  assert.deepEqual([wm.buy.progress, wm.buy.done], [6, true]);
  assert.equal(wm.mine_energy.progress, 15 * body.state.clickPower);
  // الاستلام قبل الاكتمال مرفوض، وبعده يُدفع الذهب والخبرة مرة واحدة فقط ويُسجَّل في op_ledger
  const goldBefore = body.state.gold; const xpBefore = body.state.xp;
  ({ body } = await sendOps(id, [
    { type: 'weekly_mission', key: 'boost' },
    { type: 'weekly_mission', key: 'buy' },
    { type: 'weekly_mission', key: 'buy' },
  ], { from: 16 }));
  assert.deepEqual(body.results.map((r) => [r.status, r.reason]), [['rejected', 'incomplete'], ['ok', undefined], ['rejected', 'claimed']]);
  assert.equal(body.results[1].gold, 500);
  assert.equal(body.results[1].xp, 120);
  assert.ok(body.state.gold >= goldBefore + 500 && body.state.gold < goldBefore + 500 + 80);
  assert.equal(body.state.xp, xpBefore + 120);
  assert.equal(by(body).buy.claimed, true);
  assert.equal(body.weeklyMissions.bonus.ready, false);
  const ledger = await store.ledgerFor(`guest_${id}`, 20);
  assert.ok(ledger.some((e) => e.kind === 'weekly_mission' && e.goldDelta === 500 && e.detail.key === 'buy' && e.detail.week === thisWeek()));
  const stored = await store.getUser(`guest_${id}`);
  assert.equal(stored.sync.weeklyClaimed, 1);
  // إكمال الباقي ثم استلام مكافأة الأسبوع (1000 ذهب + 300 خبرة) مرة واحدة فقط
  await patchUser(`guest_${id}`, (u) => { for (const it of u.sync.weeklyMissions.items) if (it.key !== 'buy') it.progress = 9999; });
  ({ body } = await sendOps(id, [
    { type: 'weekly_mission', key: 'bonus' },
    { type: 'weekly_mission', key: 'boost' },
    { type: 'weekly_mission', key: 'mine_energy' },
    { type: 'weekly_mission', key: 'bonus' },
    { type: 'weekly_mission', key: 'bonus' },
  ], { from: 19 }));
  assert.deepEqual(body.results.map((r) => [r.status, r.reason]), [['rejected', 'incomplete'], ['ok', undefined], ['ok', undefined], ['ok', undefined], ['rejected', 'claimed']]);
  assert.equal(body.results[3].gold, 1000);
  assert.equal(body.results[3].xp, 300);
  assert.equal(body.weeklyMissions.bonus.claimed, true);
  assert.ok(body.weeklyMissions.items.every((i) => i.claimed));
  assert.equal(body.state.totalEarned >= before.totalEarned + 500 + 400 + 500 + 1000, true);
});

test('weekly missions: adventure runs and verified arena wins feed weekly counters; a claimed weekly mission stops counting', async () => {
  const id = uid('weeklyrun');
  await me(id);
  await setWeeklyMissions(id, ['boss', 'score', 'arena']);
  await fixArenaTicket(id, { seed: 4242, level: 1 });
  const win = winningArena(1, 4242);
  let { body } = await sendOps(id, [
    { type: 'run', mode: 'boss', difficulty: 'normal', score: 680, gems: 12, combo: 5, duration: 30, boss: true, ago: 0 },
    { type: 'arena', matchNo: 1, moves: win.moves },
  ]);
  assert.deepEqual(body.results.map((r) => r.status), ['ok', 'ok']);
  const by = (res) => Object.fromEntries(res.weeklyMissions.items.map((i) => [i.key, i]));
  let wm = by(body);
  assert.deepEqual([wm.boss.progress, wm.boss.done], [1, false]);
  assert.deepEqual([wm.score.progress, wm.score.done], [650, true], 'max-type weekly mission caps display at target');
  assert.deepEqual([wm.arena.progress, wm.arena.done], [1, false]);
  // فوز ساحة ثانٍ داخل فاصل الـ10 ثوانٍ (too_soon) لا يرفع عدّاد المهمة الأسبوعية
  await fixArenaTicket(id, { seed: 4242, level: 1 });
  ({ body } = await sendOps(id, [
    { type: 'arena', matchNo: 2, moves: win.moves },
    { type: 'weekly_mission', key: 'score' },
  ], { from: 3 }));
  assert.equal(body.results[0].status, 'too_soon');
  assert.equal(body.results[1].status, 'ok');
  assert.equal(body.results[1].gold, 700);
  wm = by(body);
  assert.equal(wm.arena.progress, 1, 'unpaid too_soon arena win does not advance mission progress');
  assert.equal(wm.score.claimed, true);
});

test('weekly missions: a new ISO week deals a fresh set and legacy rows without a weekly record just get one', async () => {
  const id = uid('weeklyroll');
  await fund(id);
  const first = (await me(id)).weeklyMissions;
  // صف قديم من قبل الميزة: لا سجل مهام أسبوعية في sync_json، والأرصدة محفوظة
  await patchUser(`guest_${id}`, (u) => { delete u.sync.weeklyMissions; delete u.sync.weeklyClaimed; });
  const profile = await me(id);
  assert.equal(profile.state.gold, 1000);
  assert.deepEqual(profile.weeklyMissions.items.map((i) => i.key), first.items.map((i) => i.key), 'same week ⇒ same deterministic set');
  // سجل من أسبوع سابق بتقدم ومهام مستلمة ⇒ يُستبدل بمجموعة الأسبوع الحالي من الصفر
  await patchUser(`guest_${id}`, (u) => { u.sync.weeklyMissions = { week: '2026-W01', items: [{ key: 'boost', progress: 8, claimed: true }], bonusClaimed: true }; });
  const rolled = (await me(id)).weeklyMissions;
  assert.equal(rolled.week, thisWeek());
  assert.equal(rolled.items.length, 3);
  assert.ok(rolled.items.every((i) => i.progress === 0 && !i.claimed));
  assert.equal(rolled.bonus.claimed, false);
  // سجل تالف (مفتاح مجهول أو مصفوفة فارغة) يُرمَّم إلى مجموعة الأسبوع الحالي
  await patchUser(`guest_${id}`, (u) => { u.sync.weeklyMissions = { week: thisWeek(), items: [{ key: 'ghost', progress: 1 }], bonusClaimed: false }; });
  const healed = (await me(id)).weeklyMissions;
  assert.deepEqual(healed.items.map((i) => i.key), first.items.map((i) => i.key));
});

test('achievements: the server lists them with progress from its own stats; claims pay once and locked/unknown ones are refused', async () => {
  const id = uid('ach');
  const first = await me(id);
  const a = first.achievements;
  assert.equal(a.total, 15);
  assert.equal(a.claimedCount, 0);
  const ids = a.items.map((i) => i.id);
  for (const legacy of ['first_run', 'score500', 'combo20', 'collector', 'survivor', 'boss', 'racer', 'earner']) assert.ok(ids.includes(legacy), `${legacy} keeps its id for the existing UI`);
  for (const i of a.items) {
    assert.match(i.name, /[\u0600-\u06FF]/, 'names come from the server in Arabic');
    assert.ok(i.target > 0 && i.gold > 0, i.id);
    assert.deepEqual([i.value, i.done, i.claimed], [i.id.startsWith('level') ? 1 : 0, false, false], i.id);
  }
  // جولة زعيم مقبولة ⇒ «أول مغامرة» و«قاتل الزعماء» مكتملان من إحصاءات الخادم، لا من العميل
  let { body } = await sendOps(id, [
    { type: 'run', mode: 'boss', difficulty: 'normal', score: 300, gems: 8, combo: 5, duration: 20, boss: true, ago: 0 },
    { type: 'achievement', id: 'first_run' }, { type: 'achievement', id: 'boss' }, { type: 'achievement', id: 'boss' },
    { type: 'achievement', id: 'score500' }, { type: 'achievement', id: 'nope' },
  ]);
  assert.deepEqual(body.results.map((r) => [r.status, r.reason]), [['ok', undefined], ['ok', undefined], ['ok', undefined], ['rejected', 'claimed'], ['rejected', 'locked'], ['invalid', undefined]]);
  assert.deepEqual([body.results[1].gold, body.results[1].xp], [25, 10]);
  assert.deepEqual([body.results[2].gold, body.results[2].xp], [100, 30]);
  assert.deepEqual([body.results[4].value, body.results[4].target], [300, 500]);
  const by = Object.fromEntries(body.achievements.items.map((i) => [i.id, i]));
  assert.deepEqual([by.first_run.claimed, by.boss.claimed, by.score500.done, by.score500.value], [true, true, false, 300]);
  assert.equal(body.achievements.claimedCount, 2);
  assert.equal(body.state.gold, body.results[0].gold + 25 + 100);
  assert.equal(body.state.xp, body.results[0].xp + 10 + 30);
  const ledger = await store.ledgerFor(`guest_${id}`, 20);
  assert.deepEqual(ledger.filter((e) => e.kind === 'achievement').map((e) => e.goldDelta).sort((x, y) => x - y), [25, 100]);
  // الاستلام محفوظ عبر الطلبات (sync_json) ولا يمكن تكراره من جلسة أخرى
  ({ body } = await sendOps(id, [{ type: 'achievement', id: 'first_run' }], { session: 'other' }));
  assert.deepEqual([body.results[0].status, body.results[0].reason], ['rejected', 'claimed']);
});

test('achievements: server-only sources — purchases, level, missions claimed, daily streak, referrals, race wins', async () => {
  const id = uid('achsrc');
  await fund(id); // دعوة ⇒ «صاحب الدعوة» مكتمل + 100 خبرة
  let { body } = await sendOps(id, [{ type: 'achievement', id: 'inviter' }, { type: 'achievement', id: 'level5' }]);
  assert.deepEqual(body.results.map((r) => [r.status, r.reason]), [['ok', undefined], ['rejected', 'locked']]);
  const by = (res) => Object.fromEntries(res.achievements.items.map((i) => [i.id, i]));
  assert.equal(by(body).level5.value, 2);
  // 10 ترقيات ⇒ «مهندس المنجم»؛ المستوى 5 يُبلَغ بالخبرة التي يمنحها الخادم (نحقنها في الدفتر لاختصار الوقت)
  await patchUser(`guest_${id}`, (u) => { u.state.gold += 100_000; u.state.xp = 1120; u.sync.missionsClaimed = 10; u.dailyStreak = 7; });
  ({ body } = await sendOps(id, [
    ...Array.from({ length: 10 }, () => ({ type: 'buy', item: 'click' })),
    { type: 'achievement', id: 'upgrades10' }, { type: 'achievement', id: 'level5' }, { type: 'achievement', id: 'missions10' }, { type: 'achievement', id: 'streak7' }, { type: 'achievement', id: 'racer' },
  ], { from: 3 }));
  const statuses = body.results.slice(10).map((r) => [r.status, r.reason]);
  assert.deepEqual(statuses, [['ok', undefined], ['ok', undefined], ['ok', undefined], ['ok', undefined], ['rejected', 'locked']]);
  assert.equal(body.results[11].xp, 0, 'level achievements pay gold only (no XP loop)');
  assert.equal(by(body).upgrades10.value, 10);
  assert.equal(by(body).level5.claimed, true);
  // فوز سباق مختوم خادميًا (جدول race_stats) ⇒ «بطل السباقات»
  await store.recordRaceResult('2026-W42', { id: `guest_${id}`, name: 'r', score: 500, won: true });
  ({ body } = await sendOps(id, [{ type: 'achievement', id: 'racer' }], { from: 20 }));
  assert.equal(body.results[0].status, 'ok');
  assert.equal(by(body).racer.claimed, true);
  const profile = await me(id);
  assert.equal(profile.achievements.claimedCount, 6);
  assert.equal(profile.race.wins, 1);
});

test('achievements: legacy rows without an achievement record simply start unclaimed', async () => {
  const id = uid('achlegacy');
  await me(id);
  await patchUser(`guest_${id}`, (u) => { delete u.sync.achievements; delete u.sync.missionsClaimed; u.state.adventure = { runs: 4, gems: 10, maxCombo: 3, bestScore: 120, bestSurvival: 0, bossWins: 0, rewardEarned: 80, playSec: 100, zones: 2 }; });
  const profile = await me(id);
  const by = Object.fromEntries(profile.achievements.items.map((i) => [i.id, i]));
  assert.deepEqual([by.first_run.done, by.first_run.claimed, by.collector.value], [true, false, 10]);
  const { body } = await sendOps(id, [{ type: 'achievement', id: 'first_run' }]);
  assert.equal(body.results[0].status, 'ok');
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
