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
  child = spawn('node', ['--require', './test/fixtures/race-storage-delay.cjs', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    // سباقات قصيرة (ثانيتان + ثانية سماح) حتى تُختبر مهلة الخادم والانسحاب دون انتظار دقيقة كاملة
    env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '', DATABASE_FILE: path.join(tmpDir, 'game.db'), DATABASE_URL: process.env.TEST_RACE_DATABASE_URL || '', RACE_DURATION_SEC: '2', RACE_GRACE_SEC: '1' },
    stdio: 'inherit',
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
      const messageIndex = ws.messages.push(msg) - 1;
      ws.waiters = ws.waiters.filter((w) => !w(msg, messageIndex));
    });
    ws.waitFor = (type, timeout = 5000) => new Promise((res, rej) => {
      const found = ws.messages.find((m) => m.type === type);
      if (found) return res(found);
      const timer = setTimeout(() => rej(new Error(`timeout waiting ${type}; got ${ws.messages.map((m) => m.type)}`)), timeout);
      ws.waiters.push((msg) => { if (msg.type === type) { clearTimeout(timer); res(msg); return true; } return false; });
    });
    // Wait for a message received after the caller's snapshot; old messages must not satisfy a new action.
    ws.waitForAfter = (type, afterCount, timeout = 5000) => new Promise((res, rej) => {
      const foundIndex = ws.messages.findIndex((m, i) => i >= afterCount && m.type === type);
      if (foundIndex !== -1) return res(ws.messages[foundIndex]);
      const timer = setTimeout(() => rej(new Error(`timeout waiting for new ${type}; got ${ws.messages.map((m) => m.type)}`)), timeout);
      ws.waiters.push((msg, index) => {
        if (index >= afterCount && msg.type === type) { clearTimeout(timer); res(msg); return true; }
        return false;
      });
    });
    ws.on('open', () => {
      sockets.push(ws);
      // open is only the transport handshake; welcome confirms server readiness.
      ws.waitFor('welcome').then(() => resolve(ws), reject);
    });
    ws.on('error', reject);
  });
}
const send = (ws, obj) => ws.send(JSON.stringify(obj));

before(async () => { startServer(); await waitReady(); });
after(async () => {
  for (const ws of sockets) try { ws.close(); } catch {}
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM'); await exited;
  }
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
  // ينتظر الاختبار لحظة البداية المجدولة؛ الخادم يرفض finish المبكر عمداً.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, sa.startAt - Date.now() + 25)));

  send(a, { type: 'progress', score: 77, lives: 2, xRatio: 0.3 });
  const prog = await b.waitFor('opponent_progress');
  assert.equal(prog.score, 77);
  assert.equal(prog.lives, 2);

  send(a, { type: 'finish', score: 90 });
  await b.waitFor('opponent_finished');
  // إعادة إرسال finish لا يجب أن تستبدل النتيجة المختومة بنتيجة أعلى مزوّرة.
  send(a, { type: 'finish', score: 99999 });
  send(b, { type: 'finish', score: 80 });
  const [ra, rb] = await Promise.all([a.waitFor('result'), b.waitFor('result')]);
  assert.equal(ra.winnerId, 'guest_racer_a');
  assert.equal(rb.winnerId, 'guest_racer_a');
  assert.deepEqual(ra.results.map((r) => r.score), [90, 80]);

  // 🔁 إعادة سباق بموافقة الطرفين: بداية ثانية بنفس الإقراّن
  const secondStart = (ws) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting rematch start')), 5000);
    const iv = setInterval(() => {
      const starts = ws.messages.filter((m) => m.type === 'start');
      if (starts.length >= 2) { clearTimeout(timer); clearInterval(iv); resolve(starts[1]); }
    }, 25);
  });
  send(a, { type: 'rematch' });
  send(b, { type: 'rematch' });
  const [sa2, sb2] = await Promise.all([secondStart(a), secondStart(b)]);
  assert.equal(sa2.seed, sb2.seed);

  // 🏆 النتيجة وصلت لبطولة الأسبوع على الخادم
  const board = await (await fetch(`${BASE}/api/race-leaderboard`)).json();
  const champ = board.leaderboard.find((r) => r.id === 'guest_racer_a');
  const runner = board.leaderboard.find((r) => r.id === 'guest_racer_b');
  assert.equal(champ.wins, 1);
  assert.equal(champ.races, 1);
  assert.equal(champ.bestScore, 90);
  assert.equal(runner.wins, 0);
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

test('🧹 مغادرة لاعب تنظف غرفة السباق وتسمح للخصم بالبحث عن مباراة جديدة', async () => {
  const a = await connect('leave_a');
  const b = await connect('leave_b');
  send(a, { type: 'create' });
  const created = await a.waitFor('room_created');
  send(b, { type: 'join', code: created.code });
  await Promise.all([a.waitFor('matched'), b.waitFor('matched')]);
  send(a, { type: 'ready' });
  send(b, { type: 'ready' });
  await Promise.all([a.waitFor('start'), b.waitFor('start')]);
  a.close();
  await b.waitFor('opponent_left');
  const c = await connect('leave_c');
  const bMessagesBeforeQuick = b.messages.length;
  const cMessagesBeforeQuick = c.messages.length;
  send(b, { type: 'quick' });
  await b.waitFor('waiting');
  send(c, { type: 'quick' });
  const [mb, mc] = await Promise.all([
    b.waitForAfter('matched', bMessagesBeforeQuick),
    c.waitForAfter('matched', cMessagesBeforeQuick),
  ]);
  assert.equal(mb.opponent.id, 'guest_leave_c');
  assert.equal(mc.opponent.id, 'guest_leave_b');
});


const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function privatePair(prefix) {
  const a = await connect(`${prefix}_a`);
  const b = await connect(`${prefix}_b`);
  await Promise.all([a.waitFor('welcome'), b.waitFor('welcome')]);
  send(a, { type: 'create' });
  const created = await a.waitFor('room_created');
  send(b, { type: 'join', code: created.code });
  await Promise.all([a.waitFor('matched'), b.waitFor('matched')]);
  return [a, b];
}

test('invalid JSON shapes cannot crash the server or prevent the next valid action', async () => {
  const a = await connect('invalid_shape');
  await a.waitFor('welcome');
  for (const raw of ['null', '[]', '42', '"text"', '{', '{}', '{"type":42}']) a.send(raw);
  send(a, { type: 'create' });
  assert.match((await a.waitFor('room_created', 1500)).code, /^[A-Z2-9]{4}$/);
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
});

test('repeated ready cannot restart a racing or finished room or replace sealed results', async () => {
  const [a, b] = await privatePair('repeated_ready');
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  const start = await a.waitFor('start'); await b.waitFor('start');
  send(a, { type: 'finish', score: 90 }); // Before scheduled start: must not seal a result.
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  await delay(80);
  assert.equal(a.messages.filter((m) => m.type === 'start').length, 1);
  await delay(Math.max(0, start.startAt - Date.now() + 25));
  send(a, { type: 'finish', score: 50 });
  await b.waitFor('opponent_finished');
  send(a, { type: 'ready' }); send(a, { type: 'finish', score: 90 });
  send(b, { type: 'finish', score: 40 });
  const result = await b.waitFor('result');
  assert.deepEqual(result.results.map((r) => r.score), [50, 40]);
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  await delay(80);
  assert.equal(a.messages.filter((m) => m.type === 'start').length, 1);
  // One-sided requests cannot start a rematch; both players must consent.
  send(a, { type: 'rematch' }); send(a, { type: 'rematch' });
  await b.waitFor('rematch_requested');
  assert.equal(a.messages.filter((m) => m.type === 'start').length, 1);
  const mark = a.messages.length;
  send(b, { type: 'rematch' });
  await a.waitForAfter('start', mark);
  const rows = (await (await fetch(`${BASE}/api/race-leaderboard`)).json()).leaderboard;
  assert.equal(rows.find((r) => r.id === 'guest_repeated_ready_a').races, 1);
});

test('one account cannot race itself through either private rooms or quick matching', async () => {
  const a = await connect('same_identity');
  const duplicate = await connect('same_identity');
  await Promise.all([a.waitFor('welcome'), duplicate.waitFor('welcome')]);
  send(a, { type: 'create' });
  const { code } = await a.waitFor('room_created');
  send(duplicate, { type: 'join', code });
  await duplicate.waitFor('error');
  const markA = a.messages.length;
  const markD = duplicate.messages.length;
  send(a, { type: 'quick' }); await a.waitForAfter('waiting', markA);
  send(duplicate, { type: 'quick' }); await duplicate.waitForAfter('waiting', markD);
  const other = await connect('different_identity');
  await other.waitFor('welcome');
  send(other, { type: 'quick' });
  const match = await other.waitFor('matched');
  assert.equal(match.opponent.id, 'guest_same_identity');
  assert.equal(duplicate.messages.some((m) => m.type === 'matched'), false);
});

test('joining another room cleans up the old room and notifies its opponent', async () => {
  const [a, b] = await privatePair('switch_room');
  const c = await connect('new_room_host');
  await c.waitFor('welcome');
  send(c, { type: 'create' });
  const { code } = await c.waitFor('room_created');
  const mark = a.messages.length;
  send(a, { type: 'join', code });
  await Promise.all([b.waitFor('room_closed'), a.waitForAfter('matched', mark), c.waitFor('matched')]);
  send(b, { type: 'ready' });
  send(a, { type: 'ready' }); send(c, { type: 'ready' });
  const start = await c.waitFor('start');
  assert.equal(start.opponent.id, 'guest_switch_room_a');
  assert.equal(b.messages.some((m) => m.type === 'start'), false);
});

test('invalid scores do not seal a finish and finite progress remains usable', async () => {
  const [a, b] = await privatePair('finite_score');
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  const start = await a.waitFor('start'); await b.waitFor('start');
  await delay(Math.max(0, start.startAt - Date.now() + 25));
  for (const score of [null, 'Infinity', '50', -1, {}, []]) send(a, { type: 'finish', score });
  send(a, { type: 'progress', score: 'Infinity', lives: 3, xRatio: 0.5 });
  send(a, { type: 'progress', score: 10, lives: 3, xRatio: 0.5 });
  assert.equal((await b.waitFor('opponent_progress')).score, 10);
  send(a, { type: 'finish', score: 60 }); send(b, { type: 'finish', score: 40 });
  assert.deepEqual((await b.waitFor('result')).results.map((r) => r.score), [60, 40]);
});

test('oversized WebSocket payload closes only its sender, not the game server', async () => {
  const a = await connect('oversized_payload');
  await a.waitFor('welcome');
  const closed = new Promise((resolve) => a.once('close', (code) => resolve(code)));
  a.send('x'.repeat(5000));
  assert.equal(await Promise.race([closed, delay(1500).then(() => -1)]), 1009);
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
});


test('rematch cannot start while the previous result is still being persisted', async () => {
  const [a, b] = await privatePair('settling');
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  const start = await a.waitFor('start'); await b.waitFor('start');
  await delay(Math.max(0, start.startAt - Date.now() + 25));
  send(a, { type: 'finish', score: 30 }); await b.waitFor('opponent_finished');
  send(b, { type: 'finish', score: 20 }); await a.waitFor('opponent_finished');
  send(a, { type: 'rematch' }); send(b, { type: 'rematch' });
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  await delay(50);
  assert.equal(a.messages.some((m) => m.type === 'result'), false, 'test store must still be delayed');
  assert.equal(a.messages.filter((m) => m.type === 'start').length, 1);
  await a.waitFor('result'); await b.waitFor('result');
  const mark = a.messages.length;
  send(a, { type: 'rematch' }); send(b, { type: 'rematch' });
  await a.waitForAfter('start', mark);
});

test('leaving during persistence cannot deliver an old result into a new room', async () => {
  const [a, b] = await privatePair('settling_leave');
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  const start = await a.waitFor('start'); await b.waitFor('start');
  await delay(Math.max(0, start.startAt - Date.now() + 25));
  send(a, { type: 'finish', score: 30 }); await b.waitFor('opponent_finished');
  send(b, { type: 'finish', score: 20 }); await a.waitFor('opponent_finished');
  send(a, { type: 'create' });
  await Promise.all([a.waitFor('room_created'), b.waitFor('opponent_left')]);
  await delay(400);
  assert.equal(a.messages.some((m) => m.type === 'result'), false);
  assert.equal(b.messages.some((m) => m.type === 'result'), false);
  send(b, { type: 'create' });
  assert.match((await b.waitFor('room_created')).code, /^[A-Z2-9]{4}$/);
});

test('the server announces the race duration and settles the race itself when a player never finishes (last progress counts)', async () => {
  const [a, b] = await privatePair('timeout');
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  const start = await a.waitFor('start'); await b.waitFor('start');
  assert.equal(start.duration, 2, 'duration comes from the server, not the client');
  await delay(Math.max(0, start.startAt - Date.now() + 25));
  send(a, { type: 'finish', score: 50 });
  await b.waitFor('opponent_finished');
  send(b, { type: 'progress', score: 30, lives: 3, xRatio: 0.5 }); // b يتوقف هنا ولا يرسل finish أبداً
  await a.waitFor('opponent_progress');
  const t0 = Date.now();
  const [ra, rb] = await Promise.all([a.waitFor('result', 6000), b.waitFor('result', 6000)]);
  assert.ok(Date.now() - t0 >= 1500, 'the server waits for the duration + grace before settling');
  assert.equal(ra.reason, 'timeout');
  assert.equal(ra.winnerId, 'guest_timeout_a');
  assert.deepEqual(rb.results.map((r) => [r.id, r.score, r.timedOut]), [['guest_timeout_a', 50, false], ['guest_timeout_b', 30, true]]);
  const rows = (await (await fetch(`${BASE}/api/race-leaderboard`)).json()).leaderboard;
  assert.deepEqual([rows.find((r) => r.id === 'guest_timeout_a').wins, rows.find((r) => r.id === 'guest_timeout_b').races], [1, 1]);
});

test('leaving after the race really started is a recorded forfeit: the opponent wins whatever the scores', async () => {
  const [a, b] = await privatePair('forfeit');
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  const start = await a.waitFor('start'); await b.waitFor('start');
  await delay(Math.max(0, start.startAt - Date.now() + 1100)); // بعد نافذة الانسحاب (نصف مدة السباق = ثانية)
  send(a, { type: 'progress', score: 120, lives: 3, xRatio: 0.5 });
  await b.waitFor('opponent_progress');
  send(b, { type: 'progress', score: 10, lives: 3, xRatio: 0.5 });
  await a.waitFor('opponent_progress');
  a.close(); // المتصدر ينسحب
  const left = await b.waitFor('opponent_left');
  assert.equal(left.forfeit, true);
  assert.equal(left.winnerId, 'guest_forfeit_b');
  assert.deepEqual(left.results.map((r) => [r.id, r.score, r.forfeited]).sort(), [['guest_forfeit_a', 120, true], ['guest_forfeit_b', 10, false]]);
  await delay(400); // التخزين يجري خلفياً
  const rows = (await (await fetch(`${BASE}/api/race-leaderboard`)).json()).leaderboard;
  const winner = rows.find((r) => r.id === 'guest_forfeit_b'); const leaver = rows.find((r) => r.id === 'guest_forfeit_a');
  assert.deepEqual([winner.wins, winner.races, leaver.wins, leaver.races], [1, 1, 0, 1]);
  // الخصم الباقي حرّ للبحث عن مباراة جديدة
  send(b, { type: 'create' });
  assert.match((await b.waitFor('room_created')).code, /^[A-Z2-9]{4}$/);
});

test('leaving before the race clock allows a forfeit is just a closed room (no result recorded)', async () => {
  const [a, b] = await privatePair('early_leave');
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  await Promise.all([a.waitFor('start'), b.waitFor('start')]); // قبل startAt بثانيتين ونصف
  a.close();
  const left = await b.waitFor('opponent_left');
  assert.equal(left.forfeit, undefined);
  await delay(300);
  const rows = (await (await fetch(`${BASE}/api/race-leaderboard`)).json()).leaderboard;
  assert.equal(rows.some((r) => r.id === 'guest_early_leave_b'), false);
});

test('scores are clamped by the race clock on the wire too: the opponent never sees an impossible number and the result is flagged', async () => {
  const [a, b] = await privatePair('clamp');
  send(a, { type: 'ready' }); send(b, { type: 'ready' });
  const start = await a.waitFor('start'); await b.waitFor('start');
  await delay(Math.max(0, start.startAt - Date.now() + 25));
  send(a, { type: 'progress', score: 5000, lives: 3, xRatio: 0.5 });
  const seen = await b.waitFor('opponent_progress');
  assert.ok(seen.score <= 100 + 45, `relayed progress ${seen.score} must respect the time cap`);
  send(a, { type: 'finish', score: 9999 });
  await b.waitFor('opponent_finished');
  send(b, { type: 'finish', score: 20 });
  const result = await b.waitFor('result');
  const cheater = result.results.find((r) => r.id === 'guest_clamp_a');
  assert.ok(cheater.score <= 100 + 45 && cheater.flagged === true, JSON.stringify(cheater));
  assert.equal(result.results.find((r) => r.id === 'guest_clamp_b').flagged, false);
});
