'use strict';
// عقد HTTP العام: كل ما يبدأ بـ /api يرد JSON دائماً (لا صفحة HTML من Express)، والاستجابات
// الموثّقة غير قابلة للتخزين، وفحص الصحة خفيف ومُخزَّن.
// قبل الإصلاح: مسار /api غير معروف أو جسم JSON مشوّه كان يُرجع HTML، فينفجر العميل عند
// res.json() بـ SyntaxError بدل رسالة اللعبة العربية.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3218;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-http-'));
const child = { proc: null };

function startServer() {
  child.proc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), BOT_TOKEN: '', DATABASE_FILE: path.join(tmpDir, 'game.db'),
      DATABASE_URL: process.env.TEST_DATABASE_URL || '', NODE_ENV: 'development',
    },
    stdio: 'ignore',
  });
}

before(async () => {
  startServer();
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch (_) { /* لم يفتح بعد */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('the server did not start');
});

after(async () => {
  if (child.proc?.exitCode === null) {
    const exited = new Promise((r) => child.proc.once('exit', r));
    child.proc.kill('SIGTERM');
    await exited;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const guest = { 'X-Guest-Id': 'http-contract', 'Content-Type': 'application/json' };

test('مسار API غير معروف يرد 404 بصيغة JSON لا HTML', async () => {
  const res = await fetch(`${BASE}/api/does-not-exist`, { headers: guest });
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  assert.deepEqual(await res.json(), { error: 'مسار غير موجود' });
});

test('جسم JSON مشوّه يرد 400 بصيغة JSON (لا صفحة خطأ من Express)', async () => {
  const res = await fetch(`${BASE}/api/ops`, { method: 'POST', headers: guest, body: '{ not json' });
  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  assert.equal((await res.json()).error, 'طلب غير صالح');
});

test('جسم أكبر من السقف يرد 413 بصيغة JSON', async () => {
  const huge = JSON.stringify({ session: 's', ops: [], padding: 'x'.repeat(80 * 1024) });
  const res = await fetch(`${BASE}/api/ops`, { method: 'POST', headers: guest, body: huge });
  assert.equal(res.status, 413);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
});

test('الاستجابات الموثّقة غير قابلة للتخزين، و/api/config يبقى قابلاً للتخزين', async () => {
  const me = await fetch(`${BASE}/api/me`, { headers: guest });
  assert.equal(me.status, 200);
  assert.match(me.headers.get('cache-control') || '', /no-store/, 'حالة اللاعب لا تُخزَّن في أي وسيط');
  assert.match(me.headers.get('cache-control') || '', /private/);

  const config = await fetch(`${BASE}/api/config`);
  assert.match(config.headers.get('cache-control') || '', /max-age=300/, 'إعدادات الواجهة العامة تبقى قابلة للتخزين');
});

test('فحص الصحة يبقى خفيفاً ويحمل نفس الشكل المعلن', async () => {
  const health = await (await fetch(`${BASE}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(typeof health.users, 'number', 'العدّاد يبقى في الاستجابة (مُخزَّن دقيقة، لا COUNT(*) على كل طلب)');
  assert.equal(health.bot, false);
  assert.equal((await fetch(`${BASE}/health`)).headers.get('cache-control'), 'no-store');
});
