// اختبارات حدود WebSocket على خادم حقيقي: سقف الاتصالات غير الموثّقة (4003)،
// نافذة الرسائل (4008)، تحرير العدّاد بعد المصادقة وبعد الإغلاق،
// وأن المستخدم الموثّق لا يتأثر بالسقف المخصّص لما قبل المصادقة.
// وكذلك مقاومة تزوير X-Forwarded-For عند hops=0 و1 و2 وسلسلة أقصر من القفزات.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-ws-limits-'));
const servers = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// إغلاق صريح مع الانتظار: عدّاد ما قبل المصادقة يُحرَّر في حدث close على الخادم،
// فالاختبار التالي يجب ألا يبدأ قبل وصول الحدث (وإلا صار الفشل سباق اختبار لا عيب منتج).
async function closeSocket(ws) {
  try { ws.close(); } catch {}
  await ws.closed;
  await sleep(120);
}

async function startServer({ port, trustProxyHops, maxPending = 1 }) {
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      BOT_TOKEN: '',
      DATABASE_URL: '',
      DATABASE_FILE: path.join(tmpDir, `game-${port}.db`),
      ALLOW_GUEST_AUTH: 'true',
      TRUST_PROXY_HOPS: String(trustProxyHops),
      WS_MAX_PENDING_PER_IP: String(maxPending),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  // نجمع سجل الخادم لفحص أن سطر الرفض لا يحمل أي عنوان IP
  child.log = '';
  child.stderr.on('data', (chunk) => { child.log += chunk.toString(); });
  servers.push(child);
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return child; } catch {}
    if (child.exitCode !== null) throw new Error(`الخادم خرج بالرمز ${child.exitCode}`);
    await sleep(200);
  }
  throw new Error('الخادم لم يبدأ');
}

function connect(port, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, Object.keys(headers).length ? { headers } : undefined);
  ws.messages = [];
  ws.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  ws.opened = new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
  ws.on('message', (raw) => {
    try { ws.messages.push(JSON.parse(raw.toString())); } catch {}
  });
  ws.waitFor = async (type, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = ws.messages.find((m) => m.type === type);
      if (found) return found;
      await sleep(20);
    }
    throw new Error(`لم تصل رسالة ${type}؛ وصل: ${ws.messages.map((m) => m.type).join(',') || 'لا شيء'}`);
  };
  ws.auth = async (guest) => {
    await ws.opened;
    ws.send(JSON.stringify({ type: 'auth', guest }));
    await ws.waitFor('welcome');
    return ws;
  };
  ws.expectClosed = async (code, timeout = 5000) => {
    const result = await Promise.race([ws.closed, sleep(timeout).then(() => null)]);
    assert.ok(result, `الاتصال لم يُغلق بالرمز ${code} خلال ${timeout}ms`);
    assert.equal(result.code, code, `رمز الإغلاق المتوقع ${code} والفعلي ${result.code} (${result.reason})`);
    return result;
  };
  // يؤكد أن الاتصال ما زال مفتوحًا (لم يُقطع بسقف أو حدّ)
  ws.expectOpen = async (waitMs = 300) => {
    const result = await Promise.race([ws.closed, sleep(waitMs).then(() => ({ code: 'open' }))]);
    assert.equal(result.code, 'open', `أُغلق الاتصال unexpectedly بالرمز ${result.code} (${result.reason})`);
    return ws;
  };
  return ws;
}

before(async () => {
  await Promise.all([
    startServer({ port: 3231, trustProxyHops: 0 }),
    startServer({ port: 3232, trustProxyHops: 1 }),
    startServer({ port: 3233, trustProxyHops: 2 }),
  ]);
});

after(async () => {
  for (const child of servers) {
    if (child.exitCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await exited;
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('4003: تجاوز سقف الاتصالات غير الموثّقة لنفس العنوان', async () => {
  await sleep(200);
  const first = connect(3231);
  await first.opened;
  await first.expectOpen(150); // اتصال واحد غير موثّق مسموح (السقف = 1)
  const second = connect(3231);
  await second.expectClosed(4003);
  await closeSocket(first);
});

test('تحرير العدّاد بعد المصادقة: المستخدم الموثّق لا يستهلك ميزانية ما قبل المصادقة', async () => {
  await sleep(200);
  const a = await connect(3231).auth('limits_a');
  const b = await connect(3231).auth('limits_b');
  // سقف ما قبل المصادقة = 1، لكن الاثنين موثّقان: لا 4003
  await b.expectOpen(300);
  const c = connect(3231);
  await c.opened;
  await c.expectOpen(200);
  await c.auth('limits_c');
  // الآن الثلاثة موثّقون: اتصال رابع غير موثّق مسموح بميزانية واحدة
  const d = connect(3231);
  await d.opened;
  await d.expectOpen(150);
  const e = connect(3231);
  await e.expectClosed(4003);
  for (const ws of [a, b, c, d]) await closeSocket(ws);
});

test('تحرير العدّاد بعد الإغلاق: اتصال جديد مسموح بعد إغلاق السابق', async () => {
  await sleep(200);
  const first = connect(3231);
  await first.opened;
  await first.expectOpen(100);
  await closeSocket(first);
  const second = connect(3231);
  await second.opened;
  await second.expectOpen(300);
  await closeSocket(second);
});

test('4008: تجاوز حدّ الرسائل في النافذة يُغلق الاتصال', async () => {
  await sleep(200);
  const ws = await connect(3231).auth('limits_flood');
  for (let i = 0; i < 120; i++) {
    try { ws.send(JSON.stringify({ type: 'noop', i })); } catch {}
  }
  const closed = await ws.expectClosed(4008);
  assert.match(closed.reason, /too many messages/);
});

test('hops=1: البادئة المزوَّرة في X-Forwarded-For لا تمنح دلوًا جديدًا', async () => {
  await sleep(200);
  // الوكيل الموثوق يُلحق عنوان الاتصال الحقيقي في نهاية السلسلة
  const real = '203.0.113.7';
  const a = connect(3232, { 'x-forwarded-for': `1.1.1.1, ${real}` });
  await a.opened;
  await a.expectOpen(150);
  const b = connect(3232, { 'x-forwarded-for': `2.2.2.2, ${real}` });
  await b.expectClosed(4003);
  // عنوان حقيقي آخر يخصّه دلو مستقل، ثم يُثبت أن تزوير البادئة لا يغيّره
  const c = connect(3232, { 'x-forwarded-for': `5.5.5.5, 198.51.100.9` });
  await c.opened;
  await c.expectOpen(150);
  const d = connect(3232, { 'x-forwarded-for': `9.9.9.9, 198.51.100.9` });
  await d.expectClosed(4003);
  await closeSocket(a); await closeSocket(c);
});

test('hops=0: ترويسة يرسلها العميل تُهمَل تمامًا', async () => {
  await sleep(200);
  // server 3231 يعمل بـ hops=0: كل عنوان ترويسة مختلف يجب ألا يفتح دلوًا
  const a = connect(3231, { 'x-forwarded-for': '1.1.1.1' });
  await a.opened;
  await a.expectOpen(150);
  const b = connect(3231, { 'x-forwarded-for': '2.2.2.2' });
  await b.expectClosed(4003);
  await closeSocket(a);
});

test('hops=2: سلسلة أقصر من القفزات تسقط إلى عنوان المقبس (تشدّد لا تجاوز)', async () => {
  await sleep(200);
  const a = connect(3233, { 'x-forwarded-for': '203.0.113.7' }); // عنصر واحد < قفزتين
  await a.opened;
  await a.expectOpen(150);
  const b = connect(3233, { 'x-forwarded-for': '6.6.6.6' }); // أيضًا قصيرة ⇒ نفس عنوان المقبس
  await b.expectClosed(4003);
  // سلسلة صحيحة الطول مع عنوان حقيقي مختلف تُقبل
  const c = connect(3233, { 'x-forwarded-for': '198.51.100.9, 172.16.0.4' });
  await c.opened;
  await c.expectOpen(150);
  await closeSocket(a); await closeSocket(c);
});

test('سجل الرفض تشخيصي بلا عناوين: عدد العناصر والقفزات والمصدر ومعرّف مؤقت فقط', async () => {
  const all = () => servers.map((s) => s.log || '').join('\n');
  for (let i = 0; i < 40 && !/رفض اتصال WebSocket/.test(all()); i++) await sleep(50);
  const log = all();
  assert.match(log, /رفض اتصال WebSocket/, 'يجب أن يُسجَّل الرفض');
  assert.match(log, /عناصر X-Forwarded-For: 2/, 'عدد عناصر الترويسة كما رآها الخادم');
  assert.match(log, /القفزات الموثوقة: 0/, 'القفزات المضبوطة في خادم hops=0');
  assert.match(log, /المصدر: عنوان المقبس \(hops-disabled\)/, 'بيان أن عنوان المقبس هو المصدر وسببه');
  assert.match(log, /المصدر: ترويسة الوكيل/, 'وسم الاتصالات التي قُرئ عنوانها من ترويسة الوكيل');
  assert.match(log, /معرّف مؤقت: [0-9a-f]{8}/, 'معرّف مؤقت للمقارنة');
  // لا عنوان لاعب في السجل — لا المُزوَّر ولا الحقيقي
  for (const address of ['203.0.113.7', '198.51.100.9', '1.1.1.1', '2.2.2.2', '9.9.9.9', '172.16.0.4']) {
    assert.ok(!log.includes(address), `السجل يجب ألا يحتوي العنوان ${address}`);
  }
});
