// الوضع الكلاسيكي (التقاط الأغراض الساقطة) تحت السقف اليومي المشترك: 10,000 ذهب/يوم (UTC) تتقاسمها جولات المنصّات
// والجولات الكلاسيكية وبيع الخامات، والعدّاد واحد: user.sync.platformGold. هذا المسار قائم على ما يدّعيه العميل (لا إعادة
// تشغيل)، فكان بلا سقف يومي أصلاً؛ هنا نثبت أن السقف يقصّ الدفع لا الإحصاءات، وأن الاستعادة عند تبدّل اليوم تعمل،
// وأن جولات السباق وفاصل الـ20 ثانية لم يتغيّرا، وأن التكرار لا يدفع مرتين.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { createStore } = require('../db');
const { dailyQuota, dailyGoldView, DAILY_GOLD_CAP, ORE_PRICES } = require('../platform-api');

let PORT = 0;
let BASE = '';
// منفذ حرّ يختاره النظام: ملفات الاختبار تعمل بالتوازي ولا يجوز أن يتصادم منفذ ثابت مع غيره
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-classic-cap-'));
const DB_FILE = path.join(tmpDir, 'game.db');
const PG_URL = process.env.TEST_DATABASE_URL || '';
const RUN = `${process.pid}_${Date.now().toString(36)}`; // PostgreSQL تُشارك بين ملفات الاختبار
let child = null;
let store = null;

function startServer() {
  child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '', DATABASE_FILE: DB_FILE, DATABASE_URL: PG_URL },
    stdio: 'inherit',
  });
}
async function waitReady() {
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`خادم اختبار السقف الكلاسيكي خرج (${child.exitCode}) قبل أن يجهز: المنفذ ${PORT} مشغول؟`);
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('خادم اختبار السقف الكلاسيكي لم يبدأ');
}
async function stopServer() {
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  child = null;
}
const uid = (name) => `cap_${RUN}_${name}`;
const guest = (id) => ({ 'X-Guest-Id': id, 'Content-Type': 'application/json' });
const me = async (id) => (await fetch(`${BASE}/api/me`, { headers: guest(id) })).json();
async function sendOps(id, ops, { session = 'dev', from = 1 } = {}) {
  const body = { session, ops: ops.map((op, i) => ({ seq: from + i, ...op })) };
  const res = await fetch(`${BASE}/api/ops`, { method: 'POST', headers: guest(id), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function patchUser(id, mutate) {
  await store.withUsers([id], async () => {
    const user = await store.getUser(id);
    mutate(user);
    await store.putUser(user);
  });
}
const readUser = (id) => store.withUsers([id], async () => store.getUser(id));
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
// حالة «بدأ اللاعب يومه وقد استهلك used من السقف»، ومرّت دقائق منذ آخر جولة كي يتسع الزمن لجولة جديدة
const spend = (id, used, day = today()) => patchUser(`guest_${id}`, (u) => {
  u.sync.platformDay = day; u.sync.platformGold = used;
  u.sync.lastRunAt = Date.now() - 400_000; u.sync.lastRewardAt.adventure = Date.now() - 400_000;
});
const classic = (extra = {}) => ({ type: 'run', mode: 'classic', difficulty: 'normal', score: 500, gems: 10, combo: 5, duration: 60, ago: 0, ...extra }); // تساوي 100 ذهب
const bossRun = (extra = {}) => ({ type: 'run', mode: 'boss', difficulty: 'normal', score: 600, gems: 20, combo: 10, duration: 40, boss: true, ago: 0, ...extra }); // 100 + 150

before(async () => {
  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
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

// ============================== الدالة الصافية ==============================
test('dailyGoldView: reads the shared purse without touching it, and an old day counts as empty', () => {
  const at = Date.parse('2026-11-05T10:00:00Z');
  const sync = { platformDay: '2026-11-05', platformGold: 3_200 };
  const before = JSON.stringify(sync);
  assert.deepEqual(dailyGoldView(sync, at), { day: '2026-11-05', used: 3_200, cap: DAILY_GOLD_CAP, remaining: DAILY_GOLD_CAP - 3_200 });
  assert.equal(JSON.stringify(sync), before, 'a view never writes');
  assert.equal(dailyGoldView(sync, Date.parse('2026-11-06T00:00:01Z')).used, 0, 'yesterday\'s spending is not today\'s');
  assert.equal(dailyGoldView(sync, Date.parse('2026-11-05T23:59:59Z')).used, 3_200, 'the day is UTC: still the same day one second before midnight');
  // قيم تالفة أو فائضة لا تنتج أرقاماً مستحيلة
  assert.equal(dailyGoldView({ platformDay: '2026-11-05', platformGold: 99_999 }, at).remaining, 0);
  assert.equal(dailyGoldView({ platformDay: '2026-11-05', platformGold: -50 }, at).used, 0);
  assert.equal(dailyGoldView({ platformDay: '2026-11-05', platformGold: 'x' }, at).used, 0);
  assert.equal(dailyGoldView({ platformDay: '2026-11-05', platformGold: 12.9 }, at).used, 12);
  assert.deepEqual(dailyGoldView(undefined, at), { day: '2026-11-05', used: 0, cap: DAILY_GOLD_CAP, remaining: DAILY_GOLD_CAP });
  // ويتفق دائماً مع ما تحسبه dailyQuota من المتبقي
  for (const used of [0, 1, 4_999, 9_999, 10_000]) {
    const s = { platformDay: '2026-11-05', platformGold: used };
    assert.equal(dailyGoldView(s, at).remaining, dailyQuota({ ...s }, 0, at).remaining, `used=${used}`);
  }
});

test('dailyGoldView: the day is UTC whatever the time zone of the machine is (it resets at 03:00 in Sanaa)', () => {
  const was = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Riyadh'; // UTC+3: 22:30Z is already the next calendar day on the wall clock
    const at = Date.parse('2026-11-05T22:30:00Z');
    assert.equal(new Date(at).getDate(), 6, 'sanity: the local calendar day is already the 6th');
    assert.equal(dailyGoldView({ platformDay: '2026-11-05', platformGold: 700 }, at).used, 700, 'but the purse is still the 5th\'s (UTC)');
    assert.equal(dailyGoldView({ platformDay: '2026-11-05', platformGold: 700 }, at).day, '2026-11-05');
    assert.equal(dailyGoldView({ platformDay: '2026-11-05', platformGold: 700 }, Date.parse('2026-11-06T00:00:00Z')).used, 0, 'and it is empty from UTC midnight');
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});

// ============================== الجولة الكلاسيكية ==============================
test('classic run under the cap: paid in full, the purse is charged, and the profile and the ops reply show it', async () => {
  const id = uid('full');
  const fresh = await me(id);
  assert.deepEqual(fresh.dailyGold, { day: today(), used: 0, cap: DAILY_GOLD_CAP, remaining: DAILY_GOLD_CAP }, 'a new player has the whole purse');
  const { body } = await sendOps(id, [classic()]);
  const r = body.results[0];
  assert.equal(r.status, 'ok'); assert.equal(r.gold, 100); assert.equal(r.reason, undefined);
  assert.equal(r.dailyRemaining, DAILY_GOLD_CAP - 100);
  assert.deepEqual(body.dailyGold, { day: today(), used: 100, cap: DAILY_GOLD_CAP, remaining: DAILY_GOLD_CAP - 100 });
  assert.equal(body.state.gold, 100);
  assert.deepEqual((await me(id)).dailyGold, body.dailyGold, 'the profile agrees with the ops reply');
  assert.equal((await readUser(`guest_${id}`)).sync.platformGold, 100);
  const ledger = await store.ledgerFor(`guest_${id}`, 10);
  assert.deepEqual(ledger[0].detail, { mode: 'classic', difficulty: 'normal', score: 500, gems: 10, combo: 5, duration: 60, boss: false, race: false, zones: 1 }, 'an ordinary run is logged exactly as before');
});

test('classic run at the edge of the cap: the part that fits is paid, the rest is not, and the stats still count', async () => {
  const id = uid('partial');
  await me(id);
  await spend(id, DAILY_GOLD_CAP - 50);
  const { body } = await sendOps(id, [classic()]);
  const r = body.results[0];
  assert.equal(r.status, 'ok');
  assert.equal(r.gold, 50, 'only the remaining 50 of the 100 fit');
  assert.equal(r.reason, 'daily_cap'); assert.equal(r.dailyRemaining, 0);
  assert.equal(body.state.gold, 50);
  assert.equal(body.state.adventure.rewardEarned, 50, 'the stats record what was paid, not what was claimed');
  assert.equal(body.state.adventure.runs, 1); assert.equal(body.state.adventure.gems, 10); assert.equal(body.state.adventure.playSec, 60);
  const user = await readUser(`guest_${id}`);
  assert.equal(user.sync.platformGold, DAILY_GOLD_CAP);
  assert.ok(user.sync.lastRewardAt.adventure > Date.now() - 5_000, 'a paid round restarts the 20-second reward gap');
  const ledger = await store.ledgerFor(`guest_${id}`, 10);
  assert.equal(ledger[0].goldDelta, 50); assert.equal(ledger[0].detail.capped, true, 'the audit log says it was cut');
});

test('classic run with the purse empty: no gold, but the round is a real round (stats, XP) and the reward gap does not restart', async () => {
  const id = uid('empty');
  await me(id);
  await spend(id, DAILY_GOLD_CAP);
  const stamp = Date.now() - 400_000;
  const { body } = await sendOps(id, [classic()]);
  const r = body.results[0];
  assert.equal(r.status, 'ok'); assert.equal(r.gold, 0); assert.equal(r.reason, 'daily_cap'); assert.equal(r.dailyRemaining, 0);
  assert.equal(body.state.gold, 0, 'the optimistic client number is corrected by the server state');
  assert.equal(body.state.adventure.runs, 1); assert.equal(body.state.adventure.rewardEarned, 0);
  assert.ok(r.xp > 0, 'XP is not gold: the cap does not take it away');
  const user = await readUser(`guest_${id}`);
  assert.equal(user.sync.platformGold, DAILY_GOLD_CAP, 'the purse never exceeds the cap');
  assert.ok(user.sync.lastRewardAt.adventure <= stamp + 1_000, 'nothing was paid, so the gap did not move (a later day-start round is not delayed by this one)');
  const ledger = await store.ledgerFor(`guest_${id}`, 10);
  assert.equal(ledger[0].goldDelta, 0); assert.equal(ledger[0].detail.capped, true);
});

test('the purse is shared: ore sales and classic rounds draw from the same 10,000, in both directions', async () => {
  // خامات ثم جولة: بيع الخامات يستهلك من السقف فتصل الجولة ناقصة
  const a = uid('share-a');
  await me(a);
  const sale = 60 * ORE_PRICES.copper;
  await patchUser(`guest_${a}`, (u) => { u.state.ores = { ...u.state.ores, copper: 60 }; });
  await spend(a, DAILY_GOLD_CAP - 70 - sale); // بعد البيع يبقى 70 ذهباً فقط من المحفظة
  const sold = await sendOps(a, [{ type: 'sell_ore', key: 'copper', count: 60 }]);
  assert.equal(sold.body.results[0].status, 'ok'); assert.equal(sold.body.results[0].gold, sale);
  assert.equal(sold.body.dailyGold.remaining, 70, 'the sale drew from the same purse');
  const run = await sendOps(a, [classic()], { from: 2 });
  assert.equal(run.body.results[0].gold, 70, 'the round gets what the sale left');
  assert.equal(run.body.results[0].reason, 'daily_cap');
  assert.equal(run.body.dailyGold.remaining, 0);

  // جولة ثم خامات: الجولة تستهلك السقف فيُرفض البيع
  const b = uid('share-b');
  await me(b);
  await patchUser(`guest_${b}`, (u) => { u.state.ores = { ...u.state.ores, copper: 5 }; });
  await spend(b, DAILY_GOLD_CAP - 100);
  const paid = await sendOps(b, [classic()]);
  assert.equal(paid.body.results[0].gold, 100); assert.equal(paid.body.results[0].reason, undefined, 'it fitted exactly: nothing was cut');
  assert.equal(paid.body.dailyGold.remaining, 0);
  const refused = await sendOps(b, [{ type: 'sell_ore', key: 'copper', count: 5 }], { from: 2 });
  assert.equal(refused.body.results[0].status, 'rejected'); assert.equal(refused.body.results[0].reason, 'daily_cap');
  assert.equal(refused.body.state.ores.copper, 5, 'the ores stay in the store, they are not lost');
  // وما تراه مسارات المنصّات (dailyQuota نفسها) هو العدّاد الذي كتبته الجولة الكلاسيكية
  const user = await readUser(`guest_${b}`);
  assert.deepEqual(dailyQuota(user.sync, 100), { day: today(), gold: 0, capped: true, remaining: 0 });
});

test('classic runs inside one batch drain the purse in order: full, partial, nothing', async () => {
  const id = uid('batch');
  await me(id);
  await patchUser(`guest_${id}`, (u) => { u.sync.platformDay = today(); u.sync.platformGold = DAILY_GOLD_CAP - 150; u.sync.lastRunAt = Date.now() - 600_000; u.sync.lastRewardAt.adventure = Date.now() - 600_000; });
  const { body } = await sendOps(id, [classic({ ago: 130_000 }), classic({ ago: 65_000 }), classic({ ago: 0 })]);
  assert.deepEqual(body.results.map((r) => [r.status, r.gold, r.reason || null, r.dailyRemaining]), [['ok', 100, null, 50], ['ok', 50, 'daily_cap', 0], ['ok', 0, 'daily_cap', 0]]);
  assert.equal(body.state.gold, 150);
  assert.equal(body.state.adventure.runs, 3, 'all three rounds count');
  assert.equal(body.state.adventure.rewardEarned, 150);
  assert.equal((await readUser(`guest_${id}`)).sync.platformGold, DAILY_GOLD_CAP);
});

test('a new UTC day gives the purse back: the counter restarts from the first payment of the day', async () => {
  const id = uid('rollover');
  await me(id);
  await spend(id, DAILY_GOLD_CAP, yesterday());
  assert.equal((await me(id)).dailyGold.used, 0, 'the profile already shows a full purse');
  const { body } = await sendOps(id, [classic()]);
  assert.equal(body.results[0].gold, 100); assert.equal(body.results[0].reason, undefined);
  const user = await readUser(`guest_${id}`);
  assert.equal(user.sync.platformDay, today()); assert.equal(user.sync.platformGold, 100, 'yesterday\'s 10,000 did not carry over');
});

test('race rounds and rounds that are too soon are unaffected by the cap', async () => {
  const id = uid('unaffected');
  await me(id);
  await spend(id, 1_000);
  // سباق: للمجد لا ذهب، ولا يمسّ المحفظة المشتركة
  const race = await sendOps(id, [classic({ race: true })]);
  assert.equal(race.body.results[0].gold, 0); assert.equal(race.body.results[0].race, true);
  assert.equal(race.body.results[0].reason, undefined); assert.equal(race.body.results[0].dailyRemaining, undefined, 'a race never consults the purse');
  assert.equal((await readUser(`guest_${id}`)).sync.platformGold, 1_000);
  // جولتان متتاليتان: الثانية «متسارعة» (فاصل 20 ثانية) فلا تدفع ولا تستهلك من المحفظة، وسببها يبقى too_soon
  await spend(id, 1_000);
  const quick = await sendOps(id, [
    { type: 'run', mode: 'survival', score: 200, gems: 4, combo: 4, duration: 6, ago: 6_000 },
    { type: 'run', mode: 'survival', score: 200, gems: 4, combo: 4, duration: 6, ago: 0 },
  ], { from: 2 });
  assert.deepEqual(quick.body.results.map((r) => [r.gold, r.reason || null]), [[56, null], [0, 'too_soon']]);
  assert.equal(quick.body.results[1].dailyRemaining, undefined);
  assert.equal((await readUser(`guest_${id}`)).sync.platformGold, 1_056, 'only the paid 56 were charged');
});

test('the boss bonus is cut like any other gold, while the kill itself still counts for stats and missions', async () => {
  const id = uid('boss');
  await me(id);
  await spend(id, DAILY_GOLD_CAP - 120);
  await patchUser(`guest_${id}`, (u) => {
    const day = today();
    u.sync.missions = { day, items: [{ key: 'boss', progress: 0, claimed: false }, { key: 'runs', progress: 0, claimed: false }, { key: 'buy', progress: 0, claimed: false }], bonusClaimed: false };
  });
  const { body } = await sendOps(id, [bossRun()]);
  const r = body.results[0];
  assert.equal(r.boss, true); assert.equal(r.gold, 120, '250 claimed, 120 fit'); assert.equal(r.reason, 'daily_cap');
  assert.equal(body.state.adventure.bossWins, 1, 'the kill is recorded');
  assert.equal(body.missions.items.find((m) => m.key === 'boss').progress, 1, 'and it feeds the boss mission');
});

test('a replayed batch does not charge the purse twice', async () => {
  const id = uid('dup');
  await me(id);
  await spend(id, 0);
  const first = await sendOps(id, [classic()], { session: 'dup-session' });
  assert.equal(first.body.results[0].gold, 100);
  const again = await sendOps(id, [classic()], { session: 'dup-session' });
  assert.equal(again.body.results[0].status, 'duplicate');
  assert.equal(again.body.state.gold, 100); assert.equal(again.body.dailyGold.used, 100);
  assert.equal((await readUser(`guest_${id}`)).sync.platformGold, 100);
});
