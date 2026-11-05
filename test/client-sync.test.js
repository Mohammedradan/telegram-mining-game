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
    PrestigeRules: require('../public/prestige-rules'),
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
  h.e.SYNC.pending = [{ seq: 1, type: 'buy', item: 'click' }, { seq: 2, type: 'buy_adv', key: 'magnet' }, { seq: 3, type: 'arena', matchNo: 1, moves: ['ATTACK'], expected: 50 }];
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
  assert.doesNotMatch(html, /type: 'reward'/, 'no self-declared rewards remain in the game code');
  assert.match(html, /enqueueOp\(\{ type: 'arena', matchNo: battle\.ticket\.matchNo, moves: battle\.moves\.slice\(\), expected: won \? ARENA\.winReward : 0 \}\)/, 'arena matches are reported as move lists, the server replays them');
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
  for (const id of ['daily-btn', 'boost-btn', 'sync-status', 'missions-list', 'missions-reset', 'weekly-missions-box', 'weekly-missions-list', 'weekly-missions-reset']) assert.ok(ids.has(id), `${id} must exist`);
  assert.match(html, /id="daily-btn" onclick="claimDaily\(\)"/);
  assert.match(html, /id="boost-btn" onclick="activateBoost\(\)"/);
  assert.match(html, /enqueueOp\(\{ type: 'mission', key, expected: target\.gold \}\)/);
  assert.match(html, /enqueueOp\(\{ type: 'weekly_mission', key, expected: target\.gold \}\)/);
  // updateUI لا يجب أن ينهار (ويمنع bootstrap) إن غاب عنصر — كان هذا يحدث قبل إصلاح هذه الدفعة
  assert.match(html, /getElementById\('daily-btn'\) \|\| \{\}/);
  assert.match(html, /getElementById\('boost-btn'\) \|\| \{\}/);
});

test('weekly missions from the server are adopted into the profile, claims are optimistic and announced once confirmed, and refused claims revert', async () => {
  const weeklyMissions = { week: '2026-W42', resetsIn: 259200, items: [{ key: 'buy', icon: '🛒', title: 'اشترِ 6 ترقيات هذا الأسبوع', target: 6, progress: 6, done: true, claimed: false, gold: 500, xp: 120 }], bonus: { gold: 1000, xp: 300, ready: false, claimed: false } };
  const statuses = [];
  const h = harness({ responder: (body) => ({ ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: [{ seq: 1, type: 'weekly_mission', key: 'buy', status: 'ok', gold: 500, xp: 120 }], state: serverState({ gold: 500, totalEarned: 500 }), weeklyMissions: { ...weeklyMissions, items: [{ ...weeklyMissions.items[0], claimed: true }] } }) });
  h.ctx.document = { getElementById: () => ({ set innerText(v) { statuses.push(v); } }) };
  h.e.loadSyncQueue();
  h.e.adoptServerState({ revision: 0, state: serverState(), weeklyMissions });
  assert.deepEqual(plain(h.ctx.profile.weeklyMissions), weeklyMissions);
  h.ctx.state.gold += 500; h.ctx.state.totalEarned += 500;
  h.e.enqueueOp({ type: 'weekly_mission', key: 'buy', expected: 500 });
  h.e.adoptServerState({ revision: 0, state: serverState({ gold: 0 }), weeklyMissions });
  assert.equal(h.ctx.state.gold, 500, 'pending weekly claim is re-applied over a server state that predates it');
  await h.e.flushOps();
  assert.equal(h.ctx.state.gold, 500);
  assert.equal(h.ctx.profile.weeklyMissions.items[0].claimed, true);
  assert.ok(statuses.some((t) => t.includes('مهمة أسبوعية مكتملة') && t.includes('500')), statuses.join(' | '));
  const h2 = harness({ responder: (body) => ({ ok: true, revision: 1, sessionSeq: body.ops[body.ops.length - 1].seq, results: [{ seq: 1, type: 'weekly_mission', key: 'buy', status: 'rejected', reason: 'claimed' }], state: serverState({ gold: 0 }), weeklyMissions }) });
  h2.e.loadSyncQueue();
  h2.ctx.state.gold += 500; h2.ctx.state.totalEarned += 500;
  h2.e.enqueueOp({ type: 'weekly_mission', key: 'buy', expected: 500 });
  assert.equal(h2.ctx.state.gold, 500);
  await h2.e.flushOps();
  assert.equal(h2.ctx.state.gold, 0);
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

test('the arena client only plays the shared engine with the server ticket and never decides the reward itself', () => {
  const arena = html.slice(html.indexOf('// ================= ⚔️ ساحة القتال'), html.indexOf('// --- التعزيز والمكافأة اليومية ---'));
  assert.match(html, /<script src="\/arena-rules\.js\?v=\d+"><\/script>/, 'the engine file is the same one the server requires');
  assert.match(arena, /const ARENA = ArenaRules\.CONFIG;/);
  assert.doesNotMatch(arena, /function (applyMove|enemyDecide|judgeBattle)\(/, 'no private copy of the rules');
  assert.match(arena, /battle = ArenaRules\.newBattle\(\{ level: lvl, seed \}\);/);
  assert.match(arena, /const lvl = ticket \? ticket\.level : playerLevel\(\);/, 'the enemy level comes from the ticket');
  assert.match(arena, /const seed = ticket \? ticket\.seed : \(Math\.random\(\) \* 4294967296\) >>> 0;/, 'local randomness only without a ticket (offline / practice)');
  assert.match(arena, /if \(SYNC\.pending\.some\(\(op\) => op\.type === 'arena' && op\.matchNo === t\.matchNo\)\) return null;/, 'a ticket already used by an unacknowledged match cannot start another rewarded match');
  assert.match(arena, /const practice = serverMode && !ticket;/);
  assert.match(arena, /if \(sealed \|\| !serverMode\) \{ state\.gold \+= ARENA\.winReward;/, 'optimistic gold only for ticketed (server-verified) or offline matches');
  assert.match(arena, /if \(battle !== current \|\| !current\.active\) return;/, 'restarting during the enemy turn must not inject a move into the new match');
  assert.match(arena, /const canControl = Boolean\(battle\?\.active && !battle\.busy\);/);
  assert.match(arena, /btn\.disabled = !canControl \|\| \(action === 'ATTACK' && !arenaInSwordRange\(\)\) \|\| !ArenaRules\.canAct\(battle\.player, action\);/);
  assert.match(html, /if \(data\.arena && typeof data\.arena === 'object'\) profile\.arena = data\.arena;/);
});

test('an arena match in the pending queue is replayed optimistically and the server verdict replaces the local record', () => {
  const h = harness({ responder: (body) => ({ ok: true, revision: 2, sessionSeq: body.ops[body.ops.length - 1].seq, results: body.ops.map((op) => ({ seq: op.seq, type: op.type, status: 'ok', outcome: 'win', gold: 50, xp: 10, matchNo: op.matchNo, record: { wins: 1, losses: 0, draws: 0 }, ticket: { matchNo: 2, seed: 7, level: 1 } })), state: serverState({ gold: 50 }), arena: { ticket: { matchNo: 2, seed: 7, level: 1 }, record: { wins: 1, losses: 0, draws: 0 } } }) });
  h.e.loadSyncQueue();
  h.ctx.profile = { arena: { ticket: { matchNo: 1, seed: 1, level: 1 }, record: { wins: 0, losses: 0, draws: 0 } } };
  h.e.enqueueOp({ type: 'arena', matchNo: 1, moves: ['ATTACK', 'ATTACK'], expected: 50 });
  h.e.adoptServerState({ revision: 1, state: serverState({ gold: 0 }) });
  assert.equal(h.ctx.state.gold, 50, 'the expected win is shown until the server replays the match');
  return h.e.flushOps().then(() => {
    const sent = h.calls[0].body.ops[0];
    assert.equal(sent.type, 'arena');
    assert.equal(sent.matchNo, 1);
    assert.deepEqual(plain(sent.moves), ['ATTACK', 'ATTACK']);
    assert.equal(h.ctx.state.gold, 50);
    assert.deepEqual(plain(h.ctx.profile.arena), { ticket: { matchNo: 2, seed: 7, level: 1 }, record: { wins: 1, losses: 0, draws: 0 } });
    assert.equal(h.e.SYNC.pending.length, 0);
  });
});

// المرحلة 3: ترقية المعدات تُعرض فوراً بنفس جدول الأسعار المشترك، والخادم هو الذي يصحّح عند الاختلاف.
test('phase 3: buy_equip is applied optimistically with the shared price table, ignored when unaffordable and re-applied over server state', () => {
  const h = harness();
  h.ctx.window = { PlatformRules: require('../public/platform-rules') };
  h.e.loadSyncQueue();
  const fresh = () => ({ ...h.ctx.state, gold: 1000, ores: { copper: 10, iron: 0, gold: 0, crystal: 0, lava: 0 }, equipment: { pickaxe: 0, boots: 0 } });
  const s = fresh();
  h.e.applyOpLocally(s, { type: 'buy_equip', key: 'pickaxe' });
  assert.equal(s.gold, 950); assert.equal(s.ores.copper, 4); assert.equal(s.equipment.pickaxe, 1);
  h.e.applyOpLocally(s, { type: 'buy_equip', key: 'pickaxe' }); // level 2 needs 80 gold + 6 IRON: none owned
  assert.equal(s.equipment.pickaxe, 1, 'missing ore blocks the local preview too'); assert.equal(s.gold, 950);
  const poor = { ...fresh(), gold: 49 };
  h.e.applyOpLocally(poor, { type: 'buy_equip', key: 'pickaxe' });
  assert.equal(poor.equipment.pickaxe, 0); assert.equal(poor.gold, 49);
  h.e.applyOpLocally(fresh(), { type: 'buy_equip', key: 'laser' }); // unknown item: harmless
  // the server snapshot still shows level 0 + 1000 gold: the pending op is layered on top until acknowledged
  h.e.SYNC.pending = [{ seq: 1, type: 'buy_equip', key: 'boots' }];
  h.e.adoptServerState({ revision: 3, state: serverState({ gold: 1000, ores: { copper: 10, iron: 0, gold: 0, crystal: 0, lava: 0 }, equipment: { pickaxe: 2 }, mines: { wins: [1, 0, 0, 0, 0, 0] } }) });
  const adopted = h.ctx.state;
  assert.equal(adopted.equipment.pickaxe, 2, 'server equipment is authoritative');
  assert.equal(adopted.equipment.boots, 1, 'the unacknowledged purchase is shown');
  assert.equal(adopted.gold, 940); assert.equal(adopted.ores.copper, 4);
  assert.deepEqual(plain(adopted.mines.wins), [1, 0, 0, 0, 0, 0]);
  // once the server answers without the op, the authoritative state wins (a refused purchase is reverted)
  h.e.SYNC.pending = [];
  h.e.adoptServerState({ revision: 4, state: serverState({ gold: 1000, ores: { copper: 10 }, equipment: { pickaxe: 2 } }) });
  assert.ok(!h.ctx.state.equipment.boots, 'the refused purchase disappears'); assert.equal(h.ctx.state.gold, 1000);
});

// الدفعة 3ج: التبجيل يُعرض فوراً بقاعدة الخادم نفسها (prestige-rules.js)، ويُعاد تطبيقه فوق حالة الخادم حتى يؤكَّد، ويُلغى إن رفضه الخادم.
test('phase 3c: a prestige is previewed with the shared rules, does nothing when the stock is short, and a purchase earns at the level\'s rate', () => {
  const h = harness();
  h.e.loadSyncQueue();
  const stock = (bot, rig, prestige = 0) => ({ ...h.ctx.state, gold: 777, owned: { click: 4, bot, rig }, costs: { click: 300, bot: 22_211, rig: 1_690 }, passiveIncome: bot * 5 + rig * 25, prestige, ores: { copper: 9, iron: 0, gold: 0, crystal: 0, lava: 0 }, equipment: { pickaxe: 2 }, clickPower: 5 });
  const ok = stock(15, 3);
  h.e.applyOpLocally(ok, { type: 'prestige' });
  assert.deepEqual([ok.owned.bot, ok.owned.rig, ok.prestige, ok.costs.bot, ok.costs.rig, ok.passiveIncome], [0, 0, 1, 200, 1000, 0], 'bots, rigs and their prices reset, the level rises');
  assert.deepEqual([ok.owned.click, ok.costs.click, ok.clickPower, ok.gold, ok.ores.copper, ok.equipment.pickaxe], [4, 300, 5, 777, 9, 2], 'clicks, gold, ores and equipment are not touched');
  const short = stock(14, 3); h.e.applyOpLocally(short, { type: 'prestige' });
  assert.deepEqual([short.owned.bot, short.owned.rig, short.prestige, short.passiveIncome], [14, 3, 0, 14 * 5 + 75], 'one bot short: nothing changes (the server would refuse as well)');
  const rigShort = stock(40, 2); h.e.applyOpLocally(rigShort, { type: 'prestige' });
  assert.equal(rigShort.prestige, 0);
  const second = stock(16, 4, 1); h.e.applyOpLocally(second, { type: 'prestige' });
  assert.equal(second.prestige, 1, 'level 1 asks for 17 bots, not 15: 16 are not enough'); h.e.applyOpLocally(Object.assign(second, { owned: { click: 0, bot: 17, rig: 4 } }), { type: 'prestige' });
  assert.equal(second.prestige, 2);
  const top = stock(900, 900, 10); h.e.applyOpLocally(top, { type: 'prestige' });
  assert.deepEqual([top.prestige, top.owned.bot], [10, 900], 'the top level never resets anything');
  // a purchase after a prestige earns at the level's rate: one bot at level 3 earns 1 × 13 / 2 = 6.5 a second, exactly
  const rebuilt = { ...stock(0, 0, 3), gold: 1000, costs: { click: 50, bot: 200, rig: 1000 } };
  h.e.applyOpLocally(rebuilt, { type: 'buy', item: 'bot' });
  assert.equal(rebuilt.passiveIncome, 6.5); assert.equal(rebuilt.costs.bot, 280);
  h.e.applyOpLocally(rebuilt, { type: 'buy', item: 'bot' });
  assert.equal(rebuilt.passiveIncome, 13, 'two bots: still exact, no float noise from 5 × 1.3');
});

test('phase 3c: a pending prestige is layered over the server state until it is acknowledged, then the authoritative state wins', () => {
  const h = harness();
  h.e.loadSyncQueue();
  const before = serverState({ gold: 5000, owned: { click: 2, bot: 15, rig: 3 }, passiveIncome: 150, prestige: 0, costs: { click: 125, bot: 22_211, rig: 1_690 } });
  h.e.SYNC.pending = [{ seq: 1, type: 'prestige' }];
  h.e.adoptServerState({ revision: 5, state: before });
  assert.deepEqual([h.ctx.state.owned.bot, h.ctx.state.owned.rig, h.ctx.state.prestige, h.ctx.state.passiveIncome], [0, 0, 1, 0], 'the reset shows at once');
  assert.equal(h.ctx.state.gold, 5000);
  // the server answered without it (refused, e.g. another tab had spent the stock): the page returns to the truth
  h.e.SYNC.pending = [];
  h.e.adoptServerState({ revision: 6, state: before });
  assert.deepEqual([h.ctx.state.owned.bot, h.ctx.state.prestige, h.ctx.state.passiveIncome], [15, 0, 150], 'a refused prestige disappears');
  // acknowledged: the server state already carries the level
  h.e.adoptServerState({ revision: 7, state: serverState({ gold: 5000, owned: { click: 2, bot: 0, rig: 0 }, passiveIncome: 0, prestige: 1 }) });
  assert.deepEqual([h.ctx.state.owned.bot, h.ctx.state.prestige], [0, 1]);
});
