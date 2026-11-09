#!/usr/bin/env node
// فحص تشغيلي تجريبي (خارج منطق اللعبة): يتحقق فعلياً من المصادقة، الاقتصاد الخادمي،
// الحفظ والاستعادة بعد إعادة تشغيل الخادم، وقناة WebSocket الجديدة (المصادقة في أول رسالة).
// لا يعدّل أي قاعدة إنتاج: يعمل على قاعدة SQLite مؤقتة في مجلد النظام، ويحذفها في النهاية.
//
// التشغيل:  node scripts/trial-smoke.cjs
// الخروج:  0 = كل الفحوص ناجحة، 1 = فحص فاشل (يُطبع اسمه).
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = Number(process.env.SMOKE_PORT || 3311);
const BASE = `http://127.0.0.1:${PORT}`;
// قيمة وهمية صريحة للاختبار فقط — ليست توكن تيليجرام ولا تشبه شكله، ولا تعمل مع أي خدمة.
const TEST_TOKEN = 'smoke-test-token-not-a-secret';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-smoke-'));
const DB_FILE = path.join(tmpDir, 'game.db');

let child = null;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      BOT_TOKEN: TEST_TOKEN,
      BOT_MODE: 'webhook',
      APP_URL: 'https://trial.invalid',
      ALLOW_GUEST_AUTH: 'true',
      DATABASE_URL: '',
      DATABASE_FILE: DB_FILE,
      // مهلة مصادقة قصيرة حتى يُختبر إغلاق الاتصالات غير الموثّقة بسرعة
      WS_AUTH_TIMEOUT_MS: '1500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
}

async function waitReady() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return await r.json(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('الخادم لم يبدأ');
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await exited;
  child = null;
}

// توقيع initData كما يتوقعه الخادم: HMAC(secret=HMAC('WebAppData', token), checkString)
function signInitData(user, { authDate = Math.floor(Date.now() / 1000), token = TEST_TOKEN, tamper = false } = {}) {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAHsmoke');
  params.set('user', JSON.stringify(user));
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  let hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (tamper) hash = hash.replace(/^./, hash[0] === 'a' ? 'b' : 'a');
  params.set('hash', hash);
  return params.toString();
}

async function api(pathname, { initData, guest, method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (initData) headers['X-Telegram-Init-Data'] = initData;
  else if (guest) headers['X-Guest-Id'] = guest;
  const res = await fetch(`${BASE}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}

async function main() {
  startServer();
  const health = await waitReady();
  record('health: الخادم يعمل وقاعدة البيانات متصلة', health.ok === true && health.db === 'sqlite', `db=${health.db}`);

  // ---------- المصادقة ----------
  const user = { id: 4242, first_name: 'لاعب', username: 'smoke_player' };
  const valid = signInitData(user);

  const noAuth = await api('/api/me');
  record('مصادقة: طلب بلا هوية يُرفض 401', noAuth.status === 401, `HTTP ${noAuth.status}`);

  const tampered = await api('/api/me', { initData: signInitData(user, { tamper: true }) });
  record('مصادقة: initData معدّل التوقيع يُرفض', tampered.status === 401, `HTTP ${tampered.status}`);

  const noHash = await api('/api/me', { initData: `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=${Math.floor(Date.now() / 1000)}` });
  record('مصادقة: initData بلا hash يُرفض', noHash.status === 401, `HTTP ${noHash.status}`);

  const oldDate = await api('/api/me', { initData: signInitData(user, { authDate: Math.floor(Date.now() / 1000) - 2 * 86400 }) });
  record('مصادقة: initData أقدم من 24 ساعة يُرفض', oldDate.status === 401, `HTTP ${oldDate.status}`);

  const futureDate = await api('/api/me', { initData: signInitData(user, { authDate: Math.floor(Date.now() / 1000) + 3600 }) });
  record('مصادقة: initData بتاريخ مستقبلي يُرفض', futureDate.status === 401, `HTTP ${futureDate.status}`);

  const wrongToken = await api('/api/me', { initData: signInitData(user, { token: 'another-not-real-token' }) });
  record('مصادقة: توقيع من توكن آخر يُرفض', wrongToken.status === 401, `HTTP ${wrongToken.status}`);

  const me = await api('/api/me', { initData: valid });
  record('مصادقة: initData صحيح يُقبل ويعيد معرّف تيليجرام', me.status === 200 && String(me.body?.user?.id) === String(user.id), `id=${me.body?.user?.id}`);

  const guestMe = await api('/api/me', { guest: 'smoke-guest-1' });
  record('مصادقة: وضع الضيف يعمل في التطوير فقط', guestMe.status === 200, `HTTP ${guestMe.status}`);

  // ---------- الاقتصاد الخادمي ----------
  const goldBefore = Number(me.body?.state?.gold || 0);
  const op = await api('/api/ops', {
    initData: valid, method: 'POST',
    body: { session: 'smoke1', revision: 0, ops: [{ seq: 1, type: 'mine', clicks: 25, boosted: 0, at: Date.now() }] },
  });
  const mineResult = (op.body?.results || [])[0];
  const goldAfter = Number(op.body?.state?.gold || 0);
  // 25 نقرة في دفعة واحدة تتجاوز ميزانية النقر في الثانية، فيقصّها الخادم إلى ما تسمح به
  // الميزانية (clamped) — هذا هو السلوك الصحيح ضد الغش، لا خطأ.
  record('اقتصاد: نقرات مشروعة تُحتسب على الخادم (مع قصّ ما يخالف معدل النقر)',
    op.status === 200 && ['ok', 'clamped'].includes(mineResult?.status) && goldAfter > goldBefore,
    `${goldBefore} → ${goldAfter} (${mineResult?.status}, مقبولة ${mineResult?.clicks})`);

  const replay = await api('/api/ops', {
    initData: valid, method: 'POST',
    body: { session: 'smoke1', revision: 0, ops: [{ seq: 1, type: 'mine', clicks: 25, boosted: 0, at: Date.now() }] },
  });
  const replayResult = (replay.body?.results || [])[0];
  record('اقتصاد: إعادة إرسال نفس العملية لا تُضاعف الكسب', replayResult?.status === 'duplicate' && Number(replay.body?.state?.gold) === goldAfter, `status=${replayResult?.status}`);

  const legacySave = await api('/api/save', {
    initData: valid, method: 'POST',
    body: { state: { gold: 999999999, totalEarned: 999999999, clickPower: 5000, passiveIncome: 9999 }, revision: 0 },
  });
  const savedGold = Number(legacySave.body?.state?.gold);
  record('اقتصاد: /api/save يتجاهل رصيد العميل ويعيد الحالة الموثوقة', legacySave.status === 200 && savedGold !== 999999999 && savedGold === goldAfter, `gold=${savedGold} corrected=${legacySave.body?.corrected}`);

  const daily1 = await api('/api/claim-daily', { initData: valid, method: 'POST', body: {} });
  const daily2 = await api('/api/claim-daily', { initData: valid, method: 'POST', body: {} });
  const dailyOnce = daily1.status === 200 && daily1.body?.ok === true && !(daily2.status === 200 && daily2.body?.ok === true);
  record('اقتصاد: المكافأة اليومية تُمنح مرة واحدة', dailyOnce, `first=${daily1.status}/${daily1.body?.ok} second=${daily2.status}/${daily2.body?.ok}`);

  // ---------- جولات المنصة ----------
  const start = await api('/api/platform/start', { initData: valid, method: 'POST', body: { zone: 0 } });
  const runId = start.body?.id;
  const startAgain = await api('/api/platform/start', { initData: valid, method: 'POST', body: { zone: 0 } });
  record('جولات: تذكرة واحدة مفتوحة لكل وضع', Boolean(runId) && startAgain.body?.id === runId, `run=${String(runId).slice(0, 8)}`);

  const goldBeforeFinish = Number((await api('/api/me', { initData: valid })).body?.state?.gold);
  const finish = await api('/api/platform/finish', { initData: valid, method: 'POST', body: { id: runId, inputs: [], duration: 60 } });
  const finishMe = await api('/api/me', { initData: valid });
  record('جولات: إنهاء بحركات فارغة يُرفض بلا أي مكافأة', finish.status === 400 && Number(finishMe.body?.state?.gold) === goldBeforeFinish, `HTTP ${finish.status}`);

  const otherUser = { id: 7777, first_name: 'آخر' };
  const otherValid = signInitData(otherUser);
  const foreignRun = await api('/api/platform/finish', { initData: otherValid, method: 'POST', body: { id: runId, inputs: [], duration: 60 } });
  record('جولات: لاعب آخر لا يستطيع إنهاء جولة غيره', foreignRun.status === 404, `HTTP ${foreignRun.status}`);

  const otherMe = await api('/api/me', { initData: otherValid });
  record('عزل الحسابات: كل لاعب يرى حالته وحدها', String(otherMe.body?.user?.id) === '7777' && Number(otherMe.body?.state?.gold || 0) < goldAfter, `gold=${otherMe.body?.state?.gold}`);

  // ---------- WebSocket: المصادقة في أول رسالة ----------
  const wsOk = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const done = (v) => { try { ws.close(); } catch (_) {} resolve(v); };
    const timer = setTimeout(() => done({ ok: false, why: 'timeout' }), 6000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', initData: valid })));
    ws.on('message', (raw) => { clearTimeout(timer); const msg = JSON.parse(raw.toString()); done({ ok: msg.type === 'welcome' && msg.id === String(user.id), why: msg.type }); });
    ws.on('close', (code) => { clearTimeout(timer); done({ ok: false, why: `close ${code}` }); });
    ws.on('error', () => { clearTimeout(timer); done({ ok: false, why: 'error' }); });
  });
  record('WebSocket: المصادقة في أول رسالة تفتح الجلسة', wsOk.ok === true, String(wsOk.why));

  const wsNoAuth = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} resolve({ ok: false, why: 'timeout' }); }, 6000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'quick' })));
    ws.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 4001, why: `close ${code}` }); });
    ws.on('error', () => { clearTimeout(timer); resolve({ ok: false, why: 'error' }); });
  });
  record('WebSocket: رسالة سباق قبل المصادقة تُغلق الاتصال', wsNoAuth.ok === true, String(wsNoAuth.why));

  const wsUrlAuth = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?initData=${encodeURIComponent(valid)}`);
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} resolve({ ok: false, why: 'timeout' }); }, 6000);
    ws.on('message', (raw) => {
      clearTimeout(timer);
      const msg = JSON.parse(raw.toString());
      // لو قُبلت المصادقة من الرابط لكان هذا welcome — وهو ما يجب ألا يحدث بعد الإصلاح.
      resolve({ ok: msg.type !== 'welcome', why: `message ${msg.type}` });
      try { ws.close(); } catch (_) {}
    });
    ws.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 4001, why: `close ${code}` }); });
    ws.on('error', () => { clearTimeout(timer); resolve({ ok: false, why: 'error' }); });
  });
  record('WebSocket: initData في الرابط لم يعد يُصادق', wsUrlAuth.ok === true, String(wsUrlAuth.why));

  // ---------- الحفظ والاستعادة عبر إعادة تشغيل حقيقي ----------
  const beforeRestart = await api('/api/me', { initData: valid });
  const goldFinal = Number(beforeRestart.body?.state?.gold || 0);
  const levelFinal = Number(beforeRestart.body?.progress?.level || 0);
  await stopServer();
  record('استعادة: أُوقف الخادم ثم أُعيد تشغيله على نفس القاعدة', true, 'SIGTERM → restart');
  startServer();
  await waitReady();
  const afterRestart = await api('/api/me', { initData: valid });
  const restored = afterRestart.status === 200
    && Number(afterRestart.body?.state?.gold) === goldFinal
    && Number(afterRestart.body?.progress?.level || 0) === levelFinal
    && String(afterRestart.body?.user?.id) === String(user.id);
  record('استعادة: الذهب والمستوى والهوية كما هي بعد إعادة التشغيل', restored, `${goldFinal} 🪙 / level ${levelFinal}`);

  // ---------- الخلاصة ----------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} فحصاً ناجحاً`);
  if (failed.length) {
    console.log('فاشلة:');
    for (const f of failed) console.log(` - ${f.name} (${f.detail || 'بلا تفصيل'})`);
  }
  return failed.length === 0;
}

main()
  .then(async (ok) => { await stopServer(); fs.rmSync(tmpDir, { recursive: true, force: true }); process.exit(ok ? 0 : 1); })
  .catch(async (err) => {
    console.error('فشل الفحص:', err.message);
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  });
