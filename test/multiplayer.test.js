// اختبار سباق مباشر: عميلا WebSocket حقيقيان — إقراّن، بذرة موحدة، بث تقدم، نتيجة.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3218;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-race-'));
let child = null;
const sockets = [];

function startServer() {
  child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '', DATABASE_FILE: path.join(tmpDir, 'game.db'), DATABASE_URL: '' },
    stdio: 'ignore',
  });
}
async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('الخادم لم يبدأ');
}
function connect(guest) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?guest=${guest}`);
    ws.messages = [];
    ws.waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      ws.messages.push(msg);
      ws.waiters = ws.waiters.filter((w) => !w(msg));
    });
    ws.waitFor = (type, timeout = 5000) => new Promise((res, rej) => {
      const found = ws.messages.find((m) => m.type === type);
      if (found) return res(found);
      const timer = setTimeout(() => rej(new Error(`timeout waiting ${type}; got ${ws.messages.map((m) => m.type)}`)), timeout);
      ws.waiters.push((msg) => { if (msg.type === type) { clearTimeout(timer); res(msg); return true; } return false; });
    });
    ws.on('open', () => { sockets.push(ws); resolve(ws); });
    ws.on('error', reject);
  });
}
const send = (ws, obj) => ws.send(JSON.stringify(obj));

before(async () => { startServer(); await waitReady(); });
after(async () => {
  for (const ws of sockets) try { ws.close(); } catch {}
  if (child) { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('⚔️ سباق سريع: إقراّن وبذرة موحدة وبث تقدم ونتيجة صحيحة', async () => {
  const a = await connect('racer_a');
  const b = await connect('racer_b');
  send(a, { type: 'quick' });
  await a.waitFor('waiting');
  send(b, { type: 'quick' });
  const [ma, mb] = await Promise.all([a.waitFor('matched'), b.waitFor('matched')]);
  assert.equal(ma.opponent.id, 'guest_racer_b');
  assert.equal(mb.opponent.id, 'guest_racer_a');

  send(a, { type: 'ready' });
  send(b, { type: 'ready' });
  const [sa, sb] = await Promise.all([a.waitFor('start'), b.waitFor('start')]);
  assert.equal(sa.seed, sb.seed); // نفس تساقط الجواهر للطرفين

  send(a, { type: 'progress', score: 77, lives: 2, xRatio: 0.3 });
  const prog = await b.waitFor('opponent_progress');
  assert.equal(prog.score, 77);
  assert.equal(prog.lives, 2);

  send(a, { type: 'finish', score: 90 });
  await b.waitFor('opponent_finished');
  send(b, { type: 'finish', score: 80 });
  const [ra, rb] = await Promise.all([a.waitFor('result'), b.waitFor('result')]);
  assert.equal(ra.winnerId, 'guest_racer_a');
  assert.equal(rb.winnerId, 'guest_racer_a');
  assert.deepEqual(ra.results.map((r) => r.score), [90, 80]);
});

test('🔑 غرفة خاصة برمز: إنشاء وانضمام', async () => {
  const c = await connect('host_c');
  const d = await connect('guest_d');
  send(c, { type: 'create' });
  const created = await c.waitFor('room_created');
  assert.match(created.code, /^[A-Z2-9]{4}$/);
  send(d, { type: 'join', code: created.code });
  const [mc, md] = await Promise.all([c.waitFor('matched'), d.waitFor('matched')]);
  assert.equal(mc.opponent.id, 'guest_guest_d');
  assert.equal(md.opponent.id, 'guest_host_c');
  send(d, { type: 'join', code: 'ZZZZ' }); // غرفة وهمية لا تكسر الاتصال
});
