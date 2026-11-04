// اختبارات سحب المهام اليومية والأسبوعية.
// مهمتا «اهزم زعيم المنجم» و«نقاط في وضع البقاء» لا يغذّيهما إلا الوضع الكلاسيكي المخفي، فلا يمكن إنجازهما من اللعب
// الظاهر: كانتا تُسحبان كغيرهما (3 من 11) فتظهر مهمة مستحيلة في ~49% من الأيام وتضيع مكافأة «أنجز الثلاث».
// هنا نتحقق من أن السحب الجديد لا يختارهما أبداً، وأن المهام المخزّنة سابقاً (قبل الإصلاح) تبقى صالحة وقابلة للاستلام.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../db');

const PORT = 3233;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-missions-'));
const DB_FILE = path.join(tmpDir, 'game.db');
const PG_URL = process.env.TEST_DATABASE_URL || '';
const RUN = `${process.pid}_${Date.now().toString(36)}`; // PostgreSQL تُشارك بين ملفات الاختبار
const UNREACHABLE = ['boss', 'survival'];
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

test('new daily and weekly picks never include a mission that only the hidden classic mode can finish', async () => {
  // 36 لاعباً (أقل من حدّ 60 طلباً/دقيقة لـ /api/me). مع الكود القديم احتمال أن لا يحصل أحدهم على مهمة مستحيلة ≈ 0.509^36 ≈ 0.
  const seenDaily = new Set();
  const seenWeekly = new Set();
  for (let i = 0; i < 36; i++) {
    const j = await me(uid(`pick${i}`));
    const daily = j.missions.items.map((m) => m.key);
    const weekly = j.weeklyMissions.items.map((m) => m.key);
    assert.equal(daily.length, 3, 'ثلاث مهام يومية');
    assert.equal(weekly.length, 3, 'ثلاث مهام أسبوعية');
    assert.equal(new Set(daily).size, 3, `مهام يومية مكررة: ${daily}`);
    assert.equal(new Set(weekly).size, 3, `مهام أسبوعية مكررة: ${weekly}`);
    for (const key of [...daily, ...weekly]) assert.ok(!UNREACHABLE.includes(key), `سُحبت مهمة مستحيلة: ${key}`);
    daily.forEach((k) => seenDaily.add(k));
    weekly.forEach((k) => seenWeekly.add(k));
  }
  // السحب ما زال متنوعاً: لم يتقلص إلى مجموعة صغيرة ثابتة (المتاح 9 من 11)
  assert.ok(seenDaily.size >= 6, `تنوع يومي ضعيف: ${[...seenDaily]}`);
  assert.ok(seenWeekly.size >= 6, `تنوع أسبوعي ضعيف: ${[...seenWeekly]}`);
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
