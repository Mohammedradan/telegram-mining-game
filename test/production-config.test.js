// إعداد الإنتاج، حدود المعدل، ترويسات الأمان، /api/config، وحماية مسار webhook.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { loadConfig, productionConfigErrors } = require('../config');
const { createRateLimiter } = require('../rate-limit');

const ROOT = path.join(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-prod-config-'));
const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PG = 'postgres://u:p@127.0.0.1:1/db';
const children = [];
after(async () => {
  await Promise.all(children.map((c) => (c.exitCode === null ? new Promise((r) => { c.once('exit', r); c.kill('SIGTERM'); }) : null)));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const prodEnv = (extra = {}) => ({ NODE_ENV: 'production', BOT_TOKEN: TOKEN, DATABASE_URL: PG, APP_URL: 'https://game.example', ...extra });

test('config: development keeps guest mode and SQLite usable', () => {
  const c = loadConfig({});
  assert.equal(c.production, false);
  assert.equal(c.allowGuest, true);
  assert.equal(c.botMode, 'off');
  assert.equal(c.trustProxyHops, 0);
  assert.deepEqual(productionConfigErrors(c), []);
});

test('config: complete production config has no errors, webhook mode and one trusted proxy hop', () => {
  const c = loadConfig(prodEnv());
  assert.deepEqual(productionConfigErrors(c), []);
  assert.equal(c.allowGuest, false);
  assert.equal(c.botMode, 'webhook');
  assert.equal(c.trustProxyHops, 1);
  assert.equal(loadConfig(prodEnv({ BOT_MODE: 'polling' })).botMode, 'polling');
  assert.equal(loadConfig({ APP_URL: 'https://x.example', BOT_TOKEN: TOKEN }).botMode, 'polling');
});

test('config: production rejects each unsafe setting with a named error and never leaks the token', () => {
  const cases = [
    [{ BOT_TOKEN: '' }, /BOT_TOKEN/],
    [{ BOT_TOKEN: 'ضع_هنا_التوكن_الخاص_بك_من_BotFather' }, /BOT_TOKEN/],
    [{ BOT_TOKEN: 'not-a-token' }, /BOT_TOKEN/],
    [{ ALLOW_GUEST_AUTH: 'true' }, /ALLOW_GUEST_AUTH/],
    [{ DATABASE_URL: '' }, /DATABASE_URL/],
    [{ DATABASE_URL: 'mysql://x' }, /DATABASE_URL/],
    [{ APP_URL: '' }, /APP_URL/],
    [{ APP_URL: 'http://insecure.example' }, /APP_URL/],
    [{ WEBHOOK_SECRET: 'short' }, /WEBHOOK_SECRET/],
  ];
  for (const [extra, pattern] of cases) {
    const errors = productionConfigErrors(loadConfig(prodEnv(extra)));
    assert.equal(errors.length, 1, JSON.stringify(extra));
    assert.match(errors[0], pattern);
    assert.ok(!errors[0].includes(TOKEN));
  }
  assert.equal(loadConfig(prodEnv({ ALLOW_GUEST_AUTH: 'true' })).allowGuest, false);
  assert.deepEqual(productionConfigErrors(loadConfig(prodEnv({ DATABASE_URL: '', ALLOW_SQLITE_IN_PRODUCTION: 'true' }))), []);
  assert.deepEqual(productionConfigErrors(loadConfig(prodEnv({ APP_URL: '', RENDER_EXTERNAL_URL: 'https://svc.onrender.com' }))), []);
});

test('rate limiter: per-key limits, window reset, expired-key sweep and bounded memory without global reset', () => {
  let t = 0;
  const rl = createRateLimiter({ windowMs: 1000, maxKeys: 3, now: () => t });
  assert.ok(rl.hit('a', 2).allowed); assert.ok(rl.hit('a', 2).allowed);
  assert.equal(rl.hit('a', 2).allowed, false);
  assert.ok(rl.hit('b', 2).allowed, 'other clients unaffected');
  rl.hit('c', 2); rl.hit('d', 2); // overflow evicts the least recently active key only
  assert.equal(rl.size(), 3);
  assert.equal(rl.hit('d', 1).allowed, false, 'recent keys keep their counters');
  t = 1001;
  assert.ok(rl.hit('a', 2).allowed, 'window resets');
  assert.equal(rl.size(), 1, 'expired keys swept');
});

function spawnServer(env, port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATABASE_FILE: path.join(tmpDir, `game-${port}.db`), DATABASE_URL: '', BOT_TOKEN: '',
      NODE_ENV: 'development', ALLOW_GUEST_AUTH: '', APP_URL: '', BOT_MODE: '', BOT_USERNAME: '', TRUST_PROXY_HOPS: '', RENDER: '', RENDER_EXTERNAL_URL: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  child.stdout.on('data', (b) => { output += b; }); child.stderr.on('data', (b) => { output += b; });
  return { child, output: () => output };
}
async function ready(port, proc) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch (_) {}
    if (proc.child.exitCode !== null) throw new Error(proc.output());
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(proc.output());
}

test('server: production refuses to start (exit 1, clear message) when token or database is missing', async () => {
  for (const [extra, name] of [[{ BOT_TOKEN: '' }, 'BOT_TOKEN'], [{ DATABASE_URL: '' }, 'DATABASE_URL'], [{ ALLOW_GUEST_AUTH: 'true' }, 'ALLOW_GUEST_AUTH']]) {
    const proc = spawnServer(prodEnv(extra), 3290);
    const code = await new Promise((r) => proc.child.once('exit', r));
    assert.equal(code, 1, name);
    assert.match(proc.output(), new RegExp(name));
    assert.ok(!proc.output().includes(TOKEN));
  }
});

test('server: security headers, no X-Powered-By, and public /api/config without secrets', async () => {
  const port = 3291;
  const proc = spawnServer({ BOT_USERNAME: '@My_Test_Bot' }, port);
  await ready(port, proc);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const csp = res.headers.get('content-security-policy');
  for (const part of ["default-src 'self'", 'https://telegram.org', "object-src 'none'", 'frame-ancestors', 'https://web.telegram.org']) assert.ok(csp.includes(part), part);
  assert.equal(res.headers.get('x-frame-options'), null, 'Telegram Web must be able to embed the Mini App');
  const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
  assert.deepEqual(cfg, { botUsername: 'My_Test_Bot' });
});

async function burst(port, n, xff) {
  const statuses = [];
  for (let i = 0; i < n; i++) statuses.push((await fetch(`http://127.0.0.1:${port}/api/config`, { headers: { 'X-Forwarded-For': xff(i) } })).status);
  return statuses;
}

test('server: spoofed X-Forwarded-For cannot bypass the IP rate limit without a trusted proxy', async () => {
  const port = 3292;
  const proc = spawnServer({ TRUST_PROXY_HOPS: '0' }, port);
  await ready(port, proc);
  const statuses = await burst(port, 61, (i) => `10.0.0.${i}`);
  assert.equal(statuses.slice(0, 60).every((s) => s === 200), true);
  assert.equal(statuses[60], 429);
});

test('server: behind one trusted proxy each real client IP gets its own bucket; client-forged prefixes are ignored', async () => {
  const port = 3293;
  const proc = spawnServer({ TRUST_PROXY_HOPS: '1' }, port);
  await ready(port, proc);
  // الوكيل الموثوق يضيف عنوان العميل الحقيقي في آخر القائمة؛ ما قبله يرسله العميل ولا يُعتمد
  const sameClient = await burst(port, 61, (i) => `6.6.6.${i}, 203.0.113.7`);
  assert.equal(sameClient[60], 429, 'forged leftmost entries do not create new buckets');
  const otherClient = await burst(port, 1, () => '203.0.113.8');
  assert.equal(otherClient[0], 200, 'a different real client is not throttled');
});

test('server: production webhook path rejects requests without the Telegram secret token', async () => {
  const port = 3294;
  const proc = spawnServer(prodEnv({ DATABASE_URL: '', ALLOW_SQLITE_IN_PRODUCTION: 'true', BOT_MODE: 'webhook' }), port);
  await ready(port, proc);
  const hookPath = `/telegram/webhook/${crypto.createHash('sha256').update(TOKEN).digest('hex').slice(0, 32)}`;
  const secret = crypto.createHmac('sha256', TOKEN).update('telegram-webhook-secret').digest('hex').slice(0, 64);
  const post = (headers, body) => fetch(`http://127.0.0.1:${port}${hookPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({}, { update_id: 1 })).status, 401);
  assert.equal((await post({ 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }, { update_id: 1 })).status, 401);
  assert.equal((await post({ 'X-Telegram-Bot-Api-Secret-Token': secret }, { nope: true })).status, 400);
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.botMode, 'webhook');
  const guest = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { 'X-Guest-Id': 'spoof' } });
  assert.equal(guest.status, 401);
});

test('config warnings: a Render service without NODE_ENV=production is flagged loudly', () => {
  const { loadConfig, configWarnings } = require('../config');
  const env = { RENDER: 'true', BOT_TOKEN: '' };
  assert.equal(configWarnings(loadConfig(env), env).length, 1);
  const prod = { ...env, NODE_ENV: 'production' };
  assert.deepEqual(configWarnings(loadConfig(prod), prod), []);
  assert.deepEqual(configWarnings(loadConfig({}), {}), [], 'plain local dev stays quiet');
});
