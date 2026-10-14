// اختبارات تكامل: تشغيل خادم حقيقي على قاعدة SQLite مؤقتة والتحقق من
// الحفظ، الدعوات، المكافأة اليومية، لوحة الصدارة، ومكافحة الغش الخادمية.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3217;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-test-'));
const DB_FILE = path.join(tmpDir, 'game.db');
let child = null;

function startServer() {
  child = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOT_TOKEN: '', DATABASE_FILE: DB_FILE, DATABASE_URL: process.env.TEST_DATABASE_URL || '' },
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
async function stopServer() {
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  child = null;
}
const guest = (id) => ({ 'X-Guest-Id': id, 'Content-Type': 'application/json' });
const me = async (id, qs = '') => (await fetch(`${BASE}/api/me${qs}`, { headers: guest(id) })).json();
const save = async (id, state, extra = {}) => {
  const res = await fetch(`${BASE}/api/save`, { method: 'POST', headers: guest(id), body: JSON.stringify({ state, ...extra }) });
  return { status: res.status, body: await res.json() };
};
const ops = async (id, list, session = 'api-test') => {
  const res = await fetch(`${BASE}/api/ops`, { method: 'POST', headers: guest(id), body: JSON.stringify({ session, ops: list.map((op, i) => ({ seq: i + 1, ...op })) }) });
  return { status: res.status, body: await res.json() };
};
const baseState = (over = {}) => ({
  gold: 0, totalEarned: 0, clickPower: 1, passiveIncome: 0, energy: 1000, maxEnergy: 1000,
  owned: { click: 0, bot: 0, rig: 0 }, costs: { click: 50, bot: 200, rig: 1000 },
  adventureUpgrades: { magnet: 0, cart: 0, speed: 0, shield: 0, heart: 0, clock: 0, luck: 0 },
  boostUntil: 0, boostCooldownUntil: 0, ...over,
});

before(async () => { startServer(); await waitReady(); });
after(async () => { await stopServer(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

test('health يعلن قاعدة التخزين المختبرة', async () => {
  const h = await (await fetch(`${BASE}/health`)).json();
  assert.equal(h.ok, true);
  assert.equal(h.db, process.env.TEST_DATABASE_URL ? 'postgres' : 'sqlite');
});

test('دعوة تمنح الداعي 1000 مرة واحدة فقط', async () => {
  await me('inviter');
  await me('friend', '?ref=ref_guest_inviter');
  await me('friend', '?ref=ref_guest_inviter'); // دخول متكرر — لا ازدواج
  const inviter = await me('inviter');
  assert.equal(inviter.referralCount, 1);
  assert.equal(inviter.state.gold, 1000);
});

test('مكافأة يومية مرة واحدة فقط', async () => {
  await me('dailyuser');
  const r1 = await fetch(`${BASE}/api/claim-daily`, { method: 'POST', headers: guest('dailyuser'), body: '{}' });
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).reward, 500);
  const r2 = await fetch(`${BASE}/api/claim-daily`, { method: 'POST', headers: guest('dailyuser'), body: '{}' });
  assert.equal(r2.status, 409);
});

test('نقرات مشروعة تُحتسب عبر عملية تعدين خادمية', async () => {
  await me('honest');
  const { body } = await ops('honest', [{ type: 'mine', clicks: 5, boosted: 0 }]);
  assert.equal(body.results[0].status, 'ok');
  assert.equal(body.state.gold, 5);
  assert.equal(body.violations, 0);
});

test('🛡️ الحفظ القديم لا يقبل رصيداً من العميل — يعود ملف الخادم الموثوق فقط', async () => {
  await me('cheater');
  const { body } = await save('cheater', baseState({ gold: 1_000_000, totalEarned: 1_000_000 }));
  assert.equal(body.legacy, true);
  assert.equal(body.corrected, true);
  assert.equal(body.state.gold, 0);
  assert.equal(body.state.totalEarned, 0);
  assert.equal((await me('cheater')).state.gold, 0);
});

test('🛡️ القدرات مشتقة من المشتريات — تضخيم passiveIncome وشراء بلا رصيد يُلغيان', async () => {
  await me('cheater2');
  const { body } = await save('cheater2', baseState({
    passiveIncome: 99999, clickPower: 999,
    owned: { click: 0, bot: 1, rig: 0 }, // يدّعي عاملاً آلياً بلا أي ذهب لشرائه
  }));
  assert.equal(body.corrected, true);
  assert.equal(body.state.passiveIncome, 0);   // أُلغي الشراء غير المموّل من أساسه
  assert.equal(body.state.owned.bot, 0);
  assert.equal(body.state.clickPower, 1);      // لا قدرات من العدم
  assert.equal(body.state.costs.bot, 200);     // السعر الأساسي لأنه لم يشترِ شيئاً
  // ولا عبر بروتوكول العمليات: شراء بلا رصيد يُرفض
  const bought = await ops('cheater2', [{ type: 'buy', item: 'bot' }]);
  assert.equal(bought.body.results[0].status, 'rejected');
  assert.equal(bought.body.state.owned.bot, 0);
});

test('🛡️ تعزيز مزوّر (بدون تهدئة/بمدة أطول) يُرفض', async () => {
  await me('cheater3');
  const now = Date.now();
  const { body } = await save('cheater3', baseState({ boostUntil: now + 3600e3, boostCooldownUntil: now + 3600e3 }));
  assert.equal(body.state.boostUntil, 0);
});

test('🛠️ ترقية مغامرة مشروعة تُقبل، والمستويات غير المموّلة تُرفض ولا تُقبل من حفظ قديم', async () => {
  await me('upbuyer');
  // Fund purchases through verified referral rewards, not browser migration.
  await me('upbuyer-friend', '?ref=ref_guest_upbuyer');
  assert.equal((await me('upbuyer')).state.gold, 1000);
  const { body } = await ops('upbuyer', Array.from({ length: 5 }, () => ({ type: 'buy_adv', key: 'magnet' })));
  assert.deepEqual(body.results.map((r) => r.status), ['ok', 'ok', 'ok', 'rejected', 'rejected']); // 150 + 255 + 433 = 838 ≤ 1000
  assert.equal(body.state.adventureUpgrades.magnet, 3);
  assert.equal(body.state.gold, 1000 - 150 - 255 - 433);
  const adv = { magnet: 0, cart: 0, speed: 0, shield: 0, heart: 0, clock: 0, luck: 0 };
  const cheat = await save('upbuyer', baseState({ gold: 850, totalEarned: 1000, adventureUpgrades: { ...adv, magnet: 5 } }));
  assert.equal(cheat.body.corrected, true);
  assert.equal(cheat.body.state.adventureUpgrades.magnet, 3); // الحفظ القديم لا يرفع مستوى ولا يغيّر الرصيد
  assert.equal(cheat.body.state.gold, 1000 - 150 - 255 - 433);
});

test('البيانات تبقى بعد إعادة تشغيل الخادم (قاعدة حقيقية)', async () => {
  await stopServer();
  startServer();
  await waitReady();
  const inviter = await me('inviter');
  assert.equal(inviter.state.gold, 1000);
  const board = await (await fetch(`${BASE}/api/leaderboard`)).json();
  assert.ok(board.leaderboard.length >= 3);
  assert.ok(board.leaderboard.some((u) => u.id === 'guest_inviter' && u.totalEarned === 1000));
});


test('untrusted migrate flag never bypasses validation, including repeated first saves', async () => {
  await me('migration-attack');
  for (let i = 0; i < 3; i++) {
    const { status, body } = await save('migration-attack', baseState({
      gold: 1e12, totalEarned: 1e12, clickPower: 1e5, passiveIncome: 1e9,
      owned: { click: 1000, bot: 1000, rig: 1000 },
    }), { migrate: true });
    assert.equal(status, 200);
    assert.equal(body.corrected, true);
    assert.ok(body.state.gold < 1000);
    assert.deepEqual(body.state.owned, { click: 0, bot: 0, rig: 0 });
  }
});

test('migration flag cannot import offline progress into an existing cloud account', async () => {
  await me('migration-existing');
  await me('migration-referral', '?ref=ref_guest_migration-existing');
  const trusted = await me('migration-existing');
  const { body } = await save('migration-existing', baseState({ gold: 1e12, totalEarned: 1e12 }), { migrate: true });
  assert.ok(body.state.gold < trusted.state.gold + 100);
  assert.ok(body.state.gold >= trusted.state.gold);
});

test('save rejects missing, primitive and array states without changing balances', async () => {
  await me('invalid-state');
  for (const state of [null, 42, 'forged', []]) {
    assert.equal((await save('invalid-state', state)).status, 400);
  }
  assert.equal((await me('invalid-state')).state.gold, 0);
});


test('concurrent first-login referrals credit an inviter exactly once per new user', async () => {
  await me('concurrent-inviter');
  const results = await Promise.all(Array.from({ length: 8 }, () => me('same-friend', '?ref=ref_guest_concurrent-inviter')));
  assert.equal(results.filter((r) => r.isNew).length, 1);
  await Promise.all(Array.from({ length: 8 }, (_, i) => me(`distinct-friend-${i}`, '?ref=ref_guest_concurrent-inviter')));
  const inviter = await me('concurrent-inviter');
  assert.equal(inviter.referralCount, 9);
  assert.equal(inviter.state.gold, 9000);
  assert.equal(inviter.state.totalEarned, 9000);
});

test('concurrent daily claims issue one reward and stale saves do not remove it', async () => {
  const initial = await me('concurrent-daily');
  const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(`${BASE}/api/claim-daily`, {
    method: 'POST', headers: guest('concurrent-daily'), body: '{}',
  })));
  assert.equal(responses.filter((r) => r.status === 200).length, 1);
  assert.equal(responses.filter((r) => r.status === 409).length, 7);
  const stale = await save('concurrent-daily', initial.state);
  assert.equal(stale.body.state.gold, 500);
  assert.equal(stale.body.state.totalEarned, 500);
});

test('daily reward survives retries after the caller loses the response', async () => {
  await me('lost-daily');
  // Discard the acknowledged body to model response loss after a committed claim.
  await fetch(`${BASE}/api/claim-daily`, { method: 'POST', headers: guest('lost-daily'), body: '{}' });
  const retry = await fetch(`${BASE}/api/claim-daily`, { method: 'POST', headers: guest('lost-daily'), body: '{}' });
  assert.equal(retry.status, 409);
  assert.equal((await me('lost-daily')).state.gold, 500);
});


test('two server processes share atomic daily/referral updates and persisted claims', async (t) => {
  const secondPort = PORT + 10;
  const secondBase = `http://127.0.0.1:${secondPort}`;
  const second = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(secondPort), BOT_TOKEN: '',
      DATABASE_FILE: DB_FILE, DATABASE_URL: process.env.TEST_DATABASE_URL || '' },
    stdio: 'inherit',
  });
  t.after(async () => {
    if (second.exitCode === null) {
      const exit = new Promise((resolve) => second.once('exit', resolve));
      second.kill('SIGTERM');
      await exit;
    }
  });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${secondBase}/health`)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(ready, true, 'second server should become ready');
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => fetch(
    `${i % 2 ? BASE : secondBase}/api/claim-daily`,
    { method: 'POST', headers: guest('multi-process-daily'), body: '{}' },
  )));
  assert.equal(responses.filter((r) => r.status === 200).length, 1);
  assert.equal(responses.filter((r) => r.status === 409).length, 7);
  await me('multi-process-inviter');
  const friends = await Promise.all(Array.from({ length: 8 }, (_, i) => fetch(
    `${i % 2 ? BASE : secondBase}/api/me?ref=ref_guest_multi-process-inviter`,
    { headers: guest('multi-process-friend') },
  ).then((r) => r.json())));
  assert.equal(friends.filter((r) => r.isNew).length, 1);
  assert.equal((await me('multi-process-inviter')).referralCount, 1);
  assert.equal((await me('multi-process-inviter')).state.gold, 1000);
  await stopServer();
  startServer();
  await waitReady();
  const retry = await fetch(`${BASE}/api/claim-daily`, {
    method: 'POST', headers: guest('multi-process-daily'), body: '{}',
  });
  assert.equal(retry.status, 409);
  assert.equal((await me('multi-process-daily')).state.gold, 500);
});
