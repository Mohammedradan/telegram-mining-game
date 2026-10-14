// اختبارات أمان المصادقة في وضع الإنتاج: لا تُقبل هويات الضيوف أو initData غير الموثّق افتراضياً.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3219;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-auth-test-'));
let child;

function startServer() {
  child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      BOT_TOKEN: '',
      ALLOW_GUEST_AUTH: 'false',
      DATABASE_FILE: path.join(tmpDir, 'game.db'),
      DATABASE_URL: '',
    },
    stdio: 'ignore',
  });
}

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('خادم اختبار المصادقة لم يبدأ');
}

before(async () => { startServer(); await waitReady(); });
after(async () => {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('الإنتاج يرفض هوية الضيف عند تعطيل وضع الضيف', async () => {
  const res = await fetch(`${BASE}/api/me`, { headers: { 'X-Guest-Id': 'spoofed-user' } });
  assert.equal(res.status, 401);
});

test('الإنتاج لا يقبل Telegram initData غير موثّق عند غياب BOT_TOKEN', async () => {
  const fakeInitData = 'user=%7B%22id%22%3A123456%2C%22first_name%22%3A%22Fake%22%7D';
  const res = await fetch(`${BASE}/api/me`, { headers: { 'X-Telegram-Init-Data': fakeInitData } });
  assert.equal(res.status, 401);
});
