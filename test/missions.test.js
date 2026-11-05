// اختبارات سحب المهام اليومية والأسبوعية.
// مهمتا «اهزم زعيم المنجم» و«نقاط في وضع البقاء» كانتا لا تغذّيهما إلا الوضع الكلاسيكي المخفي، فلم يمكن إنجازهما من اللعب
// الظاهر وكانتا تُستبعدان من السحب كي لا تظهر مهمة مستحيلة في ~49% من الأيام. بعد أن صار الوضع الكلاسيكي ظاهراً في خريطة المناجم
// (الدفعة 3أ′) عادتا إلى السحب؛ هنا نتحقق من ذلك ومن أن كلتيهما تتقدّمان فعلاً من جولاتهما وتُستلمان، وأن المهام المخزّنة
// سابقاً (قبل أي تغيير) تبقى صالحة وقابلة للاستلام.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { createStore } = require('../db');

// منفذ حرّ يختاره النظام: ملفات الاختبار الأخرى تعمل بالتوازي وبعضها يشتق منفذه من منفذ آخر (economy: PORT + 10 = 3233)،
// فأي رقم ثابت أختاره قد يتصادم معها في CI (حدث فعلاً: الخادم الآخر قطع الاتصال وسط اختباري فظهر «fetch failed»)
let PORT = 0;
let BASE = '';
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-missions-'));
const DB_FILE = path.join(tmpDir, 'game.db');
const PG_URL = process.env.TEST_DATABASE_URL || '';
const RUN = `${process.pid}_${Date.now().toString(36)}`; // PostgreSQL تُشارك بين ملفات الاختبار
const REACHABLE_AGAIN = ['boss', 'survival'];
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
    if (child.exitCode !== null) throw new Error(`خادم اختبار المهام خرج (${child.exitCode}) قبل أن يجهز: المنفذ ${PORT} مشغول؟`);   // لا نخلط خادمنا بخادم غريب على المنفذ نفسه
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('خادم اختبار المهام لم يبدأ');
}
async function stopServer() {
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  child = null;
}
const uid = (name) => `mis_${RUN}_${name}`;
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

test('the pools are whole again: boss and survival missions are drawn, and a draw is always three different missions', async () => {
  // 54 لاعباً (أقل من حدّ 60 طلباً/دقيقة لـ /api/me). احتمال ألا تظهر مهمة بعينها في 162 سحباً من 11 ≈ (8/11)^54 ≈ 3.7e-8
  const seenDaily = new Set();
  const seenWeekly = new Set();
  for (let i = 0; i < 54; i++) {
    const j = await me(uid(`pick${i}`));
    const daily = j.missions.items.map((m) => m.key);
    const weekly = j.weeklyMissions.items.map((m) => m.key);
    assert.equal(daily.length, 3, 'ثلاث مهام يومية');
    assert.equal(weekly.length, 3, 'ثلاث مهام أسبوعية');
    assert.equal(new Set(daily).size, 3, `مهام يومية مكررة: ${daily}`);
    assert.equal(new Set(weekly).size, 3, `مهام أسبوعية مكررة: ${weekly}`);
    daily.forEach((k) => seenDaily.add(k));
    weekly.forEach((k) => seenWeekly.add(k));
  }
  for (const key of REACHABLE_AGAIN) {
    assert.ok(seenDaily.has(key), `لم تُسحب المهمة اليومية ${key}`);
    assert.ok(seenWeekly.has(key), `لم تُسحب المهمة الأسبوعية ${key}`);
  }
  assert.equal(seenDaily.size, 11, `المجموعة اليومية كاملة: ${[...seenDaily]}`);
  assert.equal(seenWeekly.size, 11, `المجموعة الأسبوعية كاملة: ${[...seenWeekly]}`);
});

test('the revived missions really progress from the classic rounds that feed them, and can be claimed', async () => {
  const id = uid('revived');
  await me(id);
  const day = new Date().toISOString().slice(0, 10);
  await patchUser(`guest_${id}`, (u) => {
    u.sync.missions = { day, items: [{ key: 'boss', progress: 0, claimed: false }, { key: 'survival', progress: 0, claimed: false }, { key: 'buy', progress: 0, claimed: false }], bonusClaimed: false };
    u.sync.lastRunAt = Date.now() - 900_000; u.sync.lastRewardAt.adventure = Date.now() - 900_000;
  });
  const { body } = await sendOps(id, [
    { type: 'run', mode: 'boss', difficulty: 'normal', score: 600, gems: 20, combo: 10, duration: 40, boss: true, ago: 200_000 },
    { type: 'run', mode: 'survival', difficulty: 'normal', score: 260, gems: 3, combo: 2, duration: 40, boss: false, ago: 100_000 },
  ]);
  assert.deepEqual(body.results.map((r) => r.status), ['ok', 'ok']);
  const byKey = Object.fromEntries(body.missions.items.map((m) => [m.key, m]));
  assert.equal(byKey.boss.done, true, 'a classic boss kill finishes the boss mission');
  assert.equal(byKey.survival.done, true, '260 points in survival finish a 250-point mission');
  const claimed = await sendOps(id, [{ type: 'mission', key: 'boss' }, { type: 'mission', key: 'survival' }], { from: 3 });
  assert.deepEqual(claimed.body.results.map((r) => [r.status, r.gold]), [['ok', 300], ['ok', 250]]);
  // ومهمة الأسبوع كذلك تتغذّى من الجولات نفسها
  const weekly = await me(id);
  const week = weekly.weeklyMissions.week;
  await patchUser(`guest_${id}`, (u) => {
    u.sync.weeklyMissions = { week, items: [{ key: 'boss', progress: 2, claimed: false }, { key: 'survival', progress: 0, claimed: false }, { key: 'buy', progress: 0, claimed: false }], bonusClaimed: false };
    u.sync.lastRunAt = Date.now() - 900_000; u.sync.lastRewardAt.adventure = Date.now() - 900_000;
  });
  const more = await sendOps(id, [
    { type: 'run', mode: 'boss', difficulty: 'normal', score: 600, gems: 20, combo: 10, duration: 40, boss: true, ago: 200_000 },
    { type: 'run', mode: 'survival', difficulty: 'normal', score: 420, gems: 3, combo: 2, duration: 40, boss: false, ago: 100_000 },
  ], { from: 5 });
  const w = Object.fromEntries(more.body.weeklyMissions.items.map((m) => [m.key, m]));
  assert.equal(w.boss.done, true, 'the third kill of the week');
  assert.equal(w.survival.done, true, '420 of the 400 points');
});

test('missions already stored with boss/survival (picked before the fix) stay valid, are not regenerated, and can still be claimed', async () => {
  const id = uid('legacy');
  const first = await me(id);
  const day = first.missions.day;
  const week = first.weeklyMissions.week;
  await patchUser(`guest_${id}`, (u) => {
    u.sync.missions = { day, items: [{ key: 'boss', progress: 1, claimed: false }, { key: 'survival', progress: 0, claimed: false }, { key: 'buy', progress: 0, claimed: false }], bonusClaimed: false };
    u.sync.weeklyMissions = { week, items: [{ key: 'boss', progress: 3, claimed: false }, { key: 'survival', progress: 0, claimed: false }, { key: 'buy', progress: 0, claimed: false }], bonusClaimed: false };
  });
  const again = await me(id);
  assert.deepEqual(again.missions.items.map((m) => m.key), ['boss', 'survival', 'buy'], 'مهام اليوم المخزّنة لا تُعاد صياغتها');
  assert.deepEqual(again.weeklyMissions.items.map((m) => m.key), ['boss', 'survival', 'buy'], 'مهام الأسبوع المخزّنة لا تُعاد صياغتها');
  const boss = again.missions.items.find((m) => m.key === 'boss');
  assert.equal(boss.done, true);
  assert.equal(boss.title.includes('زعيم'), true);
  const daily = await sendOps(id, [{ type: 'mission', key: 'boss' }]);
  assert.equal(daily.body.results[0].status, 'ok');
  assert.equal(daily.body.results[0].gold, 300);
  const weekly = await sendOps(id, [{ type: 'weekly_mission', key: 'boss' }], { from: 2 });
  assert.equal(weekly.body.results[0].status, 'ok');
  assert.equal(weekly.body.results[0].gold, 900);
  assert.equal(weekly.body.state.gold, 1200);
});
