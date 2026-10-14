// اختبارات محرك المزامنة في الواجهة (يُنفَّذ داخل VM بواجهات وهمية):
// تجميع النقرات في عملية واحدة، إرسال متسلسل غير متداخل، إعادة إرسال آمنة بنفس الأرقام،
// واعتماد حالة الخادم مع إعادة تطبيق ما لم يؤكده بعد.
const { test } = require('node:test');
const assert = require('node:assert/strict');
// مصفوفات VM لها نموذج Array مختلف عن المضيف — طبّعها قبل المقارنة العميقة الصارمة
const plain = (v) => JSON.parse(JSON.stringify(v));
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function engineSource() {
  const start = html.indexOf('    // ==== SYNC ENGINE START');
  const end = html.indexOf('    // ==== SYNC ENGINE END ====');
  assert.ok(start >= 0 && end > start, 'sync engine markers must exist');
  return html.slice(start, end);
}

function harness({ responder } = {}) {
  const storage = new Map();
  const calls = [];
  let pendingResolvers = [];
  const context = {
    serverMode: true, profile: { referralCount: 0, referralEarnings: 0 }, myId: 'u1', tg: null, guestId: 'g',
    DEFAULT_STATE: {
      gold: 0, totalEarned: 0, clickPower: 1, passiveIncome: 0, energy: 1000, maxEnergy: 1000,
      owned: { click: 0, bot: 0, rig: 0 }, costs: { click: 50, bot: 200, rig: 1000 },
      adventureUpgrades: { magnet: 0, cart: 0, speed: 0, shield: 0, heart: 0, clock: 0, luck: 0, skill: 0 },
      boostUntil: 0, boostCooldownUntil: 0, dailyLastClaim: null, dailyStreak: 0, lastSeen: 0,
    },
    state: null,
    ADV_UPGRADE_DEFS: { magnet: { base: 150, growth: 1.7, max: 5 }, cart: { base: 200, growth: 1.7, max: 5 } },
    ADV: { playerW: 78 },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    document: { getElementById: () => ({ innerText: '' }) },
    setTimeout: (fn) => { pendingResolvers.push(fn); return pendingResolvers.length; },
    clearTimeout: () => {},
    Date,
    Math,
    Number,
    JSON,
    Boolean,
    Array,
    Object,
    updateUI: () => {},
    updateAdvUpgradesUI: () => {},
    save: () => {},
    haptic: () => {},
    api: async (pathname, options) => {
      const body = JSON.parse(options.body);
      calls.push({ pathname, body, keepalive: options.keepalive });
      if (!responder) throw Object.assign(new Error('offline'), { status: 0 });
      return responder(body, calls.length);
    },
  };
  context.state = { ...context.DEFAULT_STATE, owned: { ...context.DEFAULT_STATE.owned }, costs: { ...context.DEFAULT_STATE.costs }, adventureUpgrades: { ...context.DEFAULT_STATE.adventureUpgrades } };
  vm.createContext(context);
  vm.runInContext(engineSource() + '\n;globalThis.__e = { SYNC, loadSyncQueue, enqueueOp, flushOps, adoptServerState, applyOpLocally, takeMineOp, persistSyncQueue };', context);
  const e = context.__e;
  const runTimers = () => { const fns = pendingResolvers; pendingResolvers = []; for (const fn of fns) fn(); };
  return { ctx: context, e, calls, storage, runTimers };
}

const serverState = (over = {}) => ({
  gold: 0, totalEarned: 0, clickPower: 1, passiveIncome: 0, energy: 1000, maxEnergy: 1000,
  owned: { click: 0, bot: 0, rig: 0 }, costs: { click: 50, bot: 200, rig: 1000 },
  adventureUpgrades: { magnet: 0, cart: 0, speed: 0, shield: 0, heart: 0, clock: 0, luck: 0, skill: 0 },
  boostUntil: 0, boostCooldownUntil: 0, lastSeen: 0, ...over,
});

test('clicks are coalesced into one mine op per flush with increasing per-session sequence numbers', async () => {
  const h = harness({ responder: (body) => ({ ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: [], state: serverState({ gold: 7 }) }) });
  h.e.loadSyncQueue();
  h.e.SYNC.clicks = 7; h.e.SYNC.boostedClicks = 2;
  await h.e.flushOps();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(plain(h.calls[0].body.ops), [{ type: 'mine', clicks: 7, boosted: 2, seq: 1 }]);
  assert.equal(typeof h.calls[0].body.session, 'string');
  assert.equal(h.e.SYNC.pending.length, 0);
  assert.equal(h.ctx.state.gold, 7);
  h.e.enqueueOp({ type: 'buy', item: 'click' });
  assert.equal(h.e.SYNC.pending[0].seq, 2);
});

test('discrete ops keep event order: accumulated clicks are sealed before the purchase', () => {
  const h = harness();
  h.e.loadSyncQueue();
  h.e.SYNC.clicks = 3;
  h.e.enqueueOp({ type: 'buy', item: 'click' });
  assert.deepEqual(plain(h.e.SYNC.pending.map((op) => [op.seq, op.type])), [[1, 'mine'], [2, 'buy']]);
  const saved = JSON.parse(h.storage.get('mining_sync_queue:u1'));
  assert.equal(saved.pending.length, 2);
  assert.equal(saved.seq, 2);
});

test('failed flushes keep ops queued and resend them unchanged with the same sequence numbers', async () => {
  let fail = true;
  const h = harness({ responder: (body) => {
    if (fail) throw Object.assign(new Error('network'), { status: 0 });
    return { ok: true, revision: 2, sessionSeq: body.ops[body.ops.length - 1].seq, results: [], state: serverState({ gold: 950, owned: { click: 1, bot: 0, rig: 0 }, clickPower: 2, costs: { click: 75, bot: 200, rig: 1000 } }) };
  } });
  h.e.loadSyncQueue();
  h.e.enqueueOp({ type: 'buy', item: 'click' });
  await h.e.flushOps();
  assert.equal(h.e.SYNC.pending.length, 1);
  assert.equal(h.e.SYNC.failures, 1);
  assert.ok(h.e.SYNC.retryAt > Date.now());
  const firstOps = JSON.stringify(h.calls[0].body.ops);
  fail = false;
  await h.e.flushOps(); // قبل موعد الإعادة: لا طلب جديد
  assert.equal(h.calls.length, 1);
  h.e.SYNC.retryAt = 0;
  await h.e.flushOps();
  assert.equal(h.calls.length, 2);
  assert.equal(JSON.stringify(h.calls[1].body.ops), firstOps);
  assert.equal(h.e.SYNC.pending.length, 0);
  assert.equal(h.ctx.state.gold, 950);
  assert.equal(h.ctx.state.clickPower, 2);
});

test('only one batch is in flight; ops queued meanwhile are sent afterwards, not interleaved', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ responder: async (body) => { if (body.ops[0].seq === 1) await gate; return { ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: [], state: serverState() }; } });
  h.e.loadSyncQueue();
  h.e.SYNC.clicks = 1;
  const first = h.e.flushOps();
  h.e.enqueueOp({ type: 'boost' });
  await h.e.flushOps();
  assert.equal(h.calls.length, 1);
  release();
  await first;
  h.runTimers();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(plain(h.calls[1].body.ops.map((op) => op.type)), ['boost']);
});

test('adopting a server state re-applies unacknowledged ops and unsent clicks optimistically', () => {
  const h = harness();
  h.e.loadSyncQueue();
  h.e.SYNC.pending = [{ seq: 1, type: 'buy', item: 'click' }, { seq: 2, type: 'buy_adv', key: 'magnet' }, { seq: 3, type: 'reward', game: 'arena', expected: 50 }];
  h.e.SYNC.clicks = 4; h.e.SYNC.boostedClicks = 1;
  h.e.adoptServerState({ revision: 9, state: serverState({ gold: 1000, totalEarned: 1000 }), referralCount: 3, referralEarnings: 3000 });
  const s = h.ctx.state;
  assert.equal(s.owned.click, 1);
  assert.equal(s.clickPower, 2);
  assert.equal(s.adventureUpgrades.magnet, 1);
  // 1000 − 50 − 150 + 50 + (4 نقرات × 2 + 1 معزّزة × 2)
  assert.equal(s.gold, 1000 - 50 - 150 + 50 + 10);
  assert.equal(s.energy, 1000 - 8);
  assert.equal(h.e.SYNC.revision, 9);
  assert.equal(h.ctx.profile.referralCount, 3);
  assert.equal(h.ctx.ADV.playerW, 78);
});

test('a server that is ahead of the local sequence forces a new session instead of silently dropping ops', async () => {
  const h = harness({ responder: (body, n) => ({ ok: true, revision: n, sessionSeq: n === 1 ? 40 : body.ops[body.ops.length - 1].seq, results: body.ops.map((op) => ({ seq: op.seq, status: n === 1 ? 'duplicate' : 'ok' })), state: serverState() }) });
  h.e.loadSyncQueue();
  const oldSession = h.e.SYNC.session;
  h.e.enqueueOp({ type: 'buy', item: 'click' });
  await h.e.flushOps();
  assert.notEqual(h.e.SYNC.session, oldSession);
  assert.deepEqual(plain(h.e.SYNC.pending.map((op) => op.seq)), [1]);
  h.e.SYNC.retryAt = 0;
  await h.e.flushOps();
  assert.equal(h.calls[1].body.session, h.e.SYNC.session);
  assert.equal(h.e.SYNC.pending.length, 0);
});

test('a persisted queue is resumed with its session, sequence and unsent clicks after a reload', () => {
  const h = harness();
  h.storage.set('mining_sync_queue:u1', JSON.stringify({ session: 'abc', seq: 5, pending: [{ seq: 5, type: 'boost' }, { bad: true }], clicks: 9, boostedClicks: 2 }));
  h.e.SYNC.clicks = 1;
  h.e.loadSyncQueue();
  assert.equal(h.e.SYNC.session, 'abc');
  assert.equal(h.e.SYNC.seq, 5);
  assert.deepEqual(plain(h.e.SYNC.pending), [{ seq: 5, type: 'boost' }]);
  assert.equal(h.e.SYNC.clicks, 10);
  assert.equal(h.e.SYNC.boostedClicks, 2);
});

test('batches the server rejects as malformed are dropped instead of blocking the queue forever', async () => {
  const h = harness({ responder: () => { throw Object.assign(new Error('bad'), { status: 400 }); } });
  h.e.loadSyncQueue();
  h.e.enqueueOp({ type: 'buy', item: 'click' });
  await h.e.flushOps();
  assert.equal(h.e.SYNC.pending.length, 0);
});

test('mining clicks and purchases are routed through the ops queue in the game code', () => {
  assert.match(html, /SYNC\.clicks \+= 1;\s+if \(boostActive\(\)\) SYNC\.boostedClicks \+= 1;/);
  assert.match(html, /enqueueOp\(\{ type: 'buy', item: type \}\)/);
  assert.match(html, /enqueueOp\(\{ type: 'buy_adv', key \}\)/);
  assert.match(html, /enqueueOp\(\{ type: 'boost' \}\)/);
  assert.match(html, /enqueueOp\(\{ type: 'reward', game: 'adventure'/);
  assert.match(html, /enqueueOp\(\{ type: 'reward', game: 'arena'/);
  assert.doesNotMatch(html, /api\('\/api\/save'/, 'the browser must not push full state to the legacy endpoint');
  assert.match(html, /const gain = clickGain\(\);/, 'boost must actually double clicks as the button advertises');
});
