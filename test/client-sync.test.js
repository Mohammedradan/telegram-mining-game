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
  // «منذ كم مللي ثانية» يُحسب عند كل إرسال؛ ما عداه يُعاد كما هو
  const stripAgo = (ops) => JSON.stringify(plain(ops).map(({ ago, ...op }) => op));
  const firstOps = stripAgo(h.calls[0].body.ops);
  fail = false;
  await h.e.flushOps(); // قبل موعد الإعادة: لا طلب جديد
  assert.equal(h.calls.length, 1);
  h.e.SYNC.retryAt = 0;
  await h.e.flushOps();
  assert.equal(h.calls.length, 2);
  assert.equal(stripAgo(h.calls[1].body.ops), firstOps);
  assert.ok(h.calls[1].body.ops[0].ago >= h.calls[0].body.ops[0].ago);
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

test('run reports carry how long ago the round ended, measured at send time, and are applied optimistically', async () => {
  const h = harness({ responder: (body) => ({ ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: body.ops.map((op) => ({ seq: op.seq, type: op.type, status: 'ok', gold: 100, zones: 2, unlocked: true })), state: serverState({ gold: 100, adventure: { runs: 1, gems: 30, zones: 2 } }) }) });
  h.e.loadSyncQueue();
  h.e.enqueueOp({ type: 'run', mode: 'classic', difficulty: 'normal', score: 700, gems: 30, combo: 12, duration: 60, boss: false, race: false, expected: 100 });
  assert.ok(Number.isFinite(h.e.SYNC.pending[0].at), 'every discrete op is stamped with its local time');
  h.e.SYNC.pending[0].at = Date.now() - 5_000; // الجولة انتهت قبل 5 ثوانٍ من الإرسال (طابور/انقطاع)
  h.e.adoptServerState({ revision: 0, state: serverState({ gold: 0 }) });
  assert.equal(h.ctx.state.gold, 100, 'the expected reward is shown until the server confirms');
  await h.e.flushOps();
  const sent = h.calls[0].body.ops[0];
  assert.equal(sent.type, 'run');
  assert.equal(sent.duration, 60);
  assert.ok(sent.ago >= 5_000 && sent.ago < 7_000, `ago=${sent.ago}`);
  assert.equal(h.e.SYNC.pending.length, 0);
  assert.equal(h.ctx.state.gold, 100);
  assert.deepEqual(plain(h.ctx.state.adventure), { runs: 1, gems: 30, zones: 2 });
});

test('adopting a server state hands the authoritative adventure stats and race totals to the game', () => {
  const h = harness();
  const seen = [];
  h.ctx.adoptServerAdventure = (a, race) => seen.push([plain(a), plain(race ?? null)]);
  h.e.loadSyncQueue();
  h.e.adoptServerState({ revision: 3, state: serverState({ adventure: { runs: 4, gems: 80, zones: 3 } }), race: { races: 2, wins: 1, bestScore: 300 } });
  assert.deepEqual(seen, [[{ runs: 4, gems: 80, zones: 3 }, { races: 2, wins: 1, bestScore: 300 }]]);
});

test('server progress (xp/level) is adopted into the profile and a level-up is announced on the sync line', async () => {
  let statuses = [];
  const h = harness({ responder: (body) => ({ ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: [{ seq: 1, type: 'boost', status: 'ok', xp: 10 }], state: serverState({ xp: 105, level: 2 }), progress: { level: 2, xp: 105, current: 5, needed: 220 }, levelUp: { from: 1, to: 2 } }) });
  h.ctx.document = { getElementById: () => ({ set innerText(v) { statuses.push(v); } }) };
  h.e.loadSyncQueue();
  h.e.enqueueOp({ type: 'boost' });
  await h.e.flushOps();
  assert.deepEqual(plain(h.ctx.profile.progress), { level: 2, xp: 105, current: 5, needed: 220 });
  assert.ok(statuses.some((t) => t.includes('مستوى جديد: 2')), statuses.join(' | '));
  // دون تغيير مستوى لا إعلان
  statuses = [];
  h.e.adoptServerState({ revision: 2, state: serverState({ xp: 110 }), progress: { level: 2, xp: 110, current: 10, needed: 220 } });
  assert.equal(h.ctx.profile.progress.xp, 110);
  assert.ok(!statuses.some((t) => t.includes('مستوى جديد')));
});

test('the level badge follows the server progress when connected and the old local formula offline', () => {
  assert.match(html, /const prog = serverMode && profile\?\.progress \? profile\.progress : null;\s+const level = prog \? prog\.level : Math\.floor\(state\.totalEarned \/ 5000\) \+ 1;/);
  assert.match(html, /function playerLevel\(\) \{ return \(serverMode && profile\?\.progress\?\.level\) \|\| Math\.floor\(state\.totalEarned \/ 5000\) \+ 1; \}/);
  assert.match(html, /id="xp-bar"/);
  assert.match(html, /id="xp-fill"/);
});

test('mining clicks and purchases are routed through the ops queue in the game code', () => {
  assert.match(html, /SYNC\.clicks \+= 1;\s+if \(boostActive\(\)\) SYNC\.boostedClicks \+= 1;/);
  assert.match(html, /enqueueOp\(\{ type: 'buy', item: type \}\)/);
  assert.match(html, /enqueueOp\(\{ type: 'buy_adv', key \}\)/);
  assert.match(html, /enqueueOp\(\{ type: 'boost' \}\)/);
  assert.match(html, /enqueueOp\(\{\s*type: 'run', mode: adv\.gameMode, difficulty: adv\.gameDifficulty, score: finalScore, gems: adv\.gemsCaught/);
  assert.doesNotMatch(html, /type: 'reward', game: 'adventure'/, 'adventure rounds are reported as runs, not self-declared rewards');
  assert.match(html, /enqueueOp\(\{ type: 'reward', game: 'arena'/);
  assert.doesNotMatch(html, /api\('\/api\/save'/, 'the browser must not push full state to the legacy endpoint');
  assert.match(html, /const gain = clickGain\(\);/, 'boost must actually double clicks as the button advertises');
});

test('daily missions from the server are adopted into the profile, claims are optimistic and announced once confirmed', async () => {
  const missions = { day: '2026-10-14', resetsIn: 3600, items: [{ key: 'buy', icon: '🛒', title: 'اشترِ 2 ترقيات', target: 2, progress: 2, done: true, claimed: false, gold: 150, xp: 40 }], bonus: { gold: 300, xp: 100, ready: false, claimed: false } };
  let statuses = [];
  const h = harness({ responder: (body) => ({ ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: [{ seq: 1, type: 'mission', key: 'buy', status: 'ok', gold: 150, xp: 40 }], state: serverState({ gold: 150, totalEarned: 150 }), missions: { ...missions, items: [{ ...missions.items[0], claimed: true }] } }) });
  h.ctx.document = { getElementById: () => ({ set innerText(v) { statuses.push(v); } }) };
  h.e.loadSyncQueue();
  h.e.adoptServerState({ revision: 0, state: serverState(), missions });
  assert.deepEqual(plain(h.ctx.profile.missions), missions);
  // الاستلام المتفائل (كما يفعل claimMission في اللعبة): الذهب المتوقع يظهر فوراً ويُعاد تطبيقه فوق أي حالة خادم قبل التأكيد
  h.ctx.state.gold += 150; h.ctx.state.totalEarned += 150;
  h.e.enqueueOp({ type: 'mission', key: 'buy', expected: 150 });
  h.e.adoptServerState({ revision: 0, state: serverState({ gold: 0 }), missions });
  assert.equal(h.ctx.state.gold, 150, 'pending claim is re-applied over a server state that predates it');
  await h.e.flushOps();
  assert.equal(h.ctx.state.gold, 150);
  assert.equal(h.ctx.profile.missions.items[0].claimed, true);
  assert.ok(statuses.some((t) => t.includes('مهمة مكتملة') && t.includes('150')), statuses.join(' | '));
  // رفض الخادم (مستلمة مسبقاً) ⇒ لا ذهب متفائل يبقى: حالة الخادم تحسم
  const h2 = harness({ responder: (body) => ({ ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: [{ seq: 1, type: 'mission', key: 'buy', status: 'rejected', reason: 'claimed' }], state: serverState({ gold: 0 }), missions }) });
  h2.e.loadSyncQueue();
  h2.ctx.state.gold += 150; h2.ctx.state.totalEarned += 150;
  h2.e.enqueueOp({ type: 'mission', key: 'buy', expected: 150 });
  assert.equal(h2.ctx.state.gold, 150);
  await h2.e.flushOps();
  assert.equal(h2.ctx.state.gold, 0);
});

test('every element the script addresses by id exists in the markup (daily/boost buttons, sync line, missions card)', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const refs = [...html.matchAll(/getElementById\((['"`])([^'"`$]+)\1\)/g)].map((m) => m[2]);
  const missing = [...new Set(refs.filter((id) => !ids.has(id)))];
  assert.deepEqual(missing, [], `script references elements that do not exist: ${missing.join(', ')}`);
  for (const id of ['daily-btn', 'boost-btn', 'sync-status', 'missions-list', 'missions-reset']) assert.ok(ids.has(id), `${id} must exist`);
  assert.match(html, /id="daily-btn" onclick="claimDaily\(\)"/);
  assert.match(html, /id="boost-btn" onclick="activateBoost\(\)"/);
  assert.match(html, /enqueueOp\(\{ type: 'mission', key, expected: target\.gold \}\)/);
  // updateUI لا يجب أن ينهار (ويمنع bootstrap) إن غاب عنصر — كان هذا يحدث قبل إصلاح هذه الدفعة
  assert.match(html, /getElementById\('daily-btn'\) \|\| \{\}/);
  assert.match(html, /getElementById\('boost-btn'\) \|\| \{\}/);
});

test('server achievements are adopted into the profile; a claim is optimistic, announced once confirmed and reverted when refused', async () => {
  const achievements = { total: 2, claimedCount: 0, items: [
    { id: 'first_run', icon: '🎬', name: 'أول مغامرة', desc: 'أكمل جولة', target: 1, value: 1, done: true, claimed: false, gold: 25, xp: 10 },
    { id: 'boss', icon: '👹', name: 'قاتل الزعماء', desc: 'اهزم الزعيم', target: 1, value: 0, done: false, claimed: false, gold: 100, xp: 30 },
  ] };
  const statuses = [];
  const h = harness({ responder: (body) => ({ ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: [{ seq: 1, type: 'achievement', id: 'first_run', status: 'ok', gold: 25, xp: 10 }], state: serverState({ gold: 25, totalEarned: 25 }), achievements: { ...achievements, claimedCount: 1, items: [{ ...achievements.items[0], claimed: true }, achievements.items[1]] } }) });
  h.ctx.document = { getElementById: () => ({ set innerText(v) { statuses.push(v); } }) };
  h.e.loadSyncQueue();
  h.e.adoptServerState({ revision: 0, state: serverState(), achievements });
  assert.deepEqual(plain(h.ctx.profile.achievements), achievements);
  h.ctx.state.gold += 25; h.ctx.state.totalEarned += 25; // كما يفعل claimAchievement في اللعبة
  h.e.enqueueOp({ type: 'achievement', id: 'first_run', expected: 25 });
  h.e.adoptServerState({ revision: 0, state: serverState({ gold: 0 }), achievements });
  assert.equal(h.ctx.state.gold, 25, 'pending claim is re-applied over an older server state');
  await h.e.flushOps();
  assert.equal(h.ctx.state.gold, 25);
  assert.equal(h.ctx.profile.achievements.items[0].claimed, true);
  assert.ok(statuses.some((t) => t.includes('إنجاز مُعتمد') && t.includes('25') && t.includes('10 خبرة')), statuses.join(' | '));
  const h2 = harness({ responder: (body) => ({ ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: [{ seq: 1, type: 'achievement', id: 'boss', status: 'rejected', reason: 'locked', value: 0, target: 1 }], state: serverState({ gold: 0 }), achievements }) });
  h2.e.loadSyncQueue();
  h2.ctx.state.gold += 100; h2.ctx.state.totalEarned += 100;
  h2.e.enqueueOp({ type: 'achievement', id: 'boss', expected: 100 });
  await h2.e.flushOps();
  assert.equal(h2.ctx.state.gold, 0, 'the server refusal wins; no optimistic gold survives');
});

test('achievement rewards are no longer blocked in cloud mode: the claim goes through the ops queue, never from local stats', () => {
  assert.match(html, /enqueueOp\(\{ type: 'achievement', id, expected: a\.gold \}\)/);
  assert.doesNotMatch(html, /يتطلب تحققًا/, 'the old "requires verification" lock is gone');
  assert.doesNotMatch(html, /مكافآت الإنجازات السحابية قيد التطوير/);
  assert.match(html, /const serverAchievements = \(\) => \(serverMode && profile\?\.achievements && Array\.isArray\(profile\.achievements\.items\)\) \? profile\.achievements : null;/);
  // لا ذهب سحابي من advStats/advClaimed المحليين: المسار المحلي يبقى خلف فحص الخادم فقط
  const claimFn = html.slice(html.indexOf('function claimAchievement(id)'), html.indexOf('// 🛠️ ترقيات المغامرة الدائمة'));
  assert.ok(claimFn.indexOf('const cloud = serverAchievements();') < claimFn.indexOf('advClaimed[id] = true;'));
});

test('the race client follows the server clock and sealed forfeits instead of deciding outcomes itself', () => {
  assert.match(html, /startAdventure\('race', msg\.seed, msg\.duration\)/, 'race duration comes from the start message');
  assert.match(html, /timeLeft: raceDuration \|\| advModeCfg\(\)\.duration/);
  assert.match(html, /if \(adv\.running && adv\.mode === 'race'\) endAdventure\(\); \/\/ ختم الخادم السباق/, 'a server-settled result closes a still-running round as a race round first');
  assert.match(html, /if \(adv\.running && adv\.mode === 'race'\) endAdventureByForfeit\(msg\);\s+else if \(msg\.forfeit\) showForfeitWin\(msg\);/);
  const fn = html.slice(html.indexOf('function showForfeitWin('), html.indexOf('// تبديل تبويب بلا إيقاف المغامرة'));
  assert.match(fn, /const sealed = Boolean\(msg\?\.forfeit && msg\.results\);/);
  assert.match(fn, /if \(sealed && String\(msg\.winnerId\) === String\(race\.myId\)\) \{ advStats\.raceWins \+= 1;/, 'the local win counter only moves on a server-sealed forfeit');
});
