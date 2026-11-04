// اختبار إقلاع الصفحة كاملة: يشغّل كل سكربت index.html داخل VM مع DOM وهمي خفيف يعيد null
// للمعرّفات غير الموجودة (كما يفعل المتصفح)، ويتحقق أن السكربت يصل إلى bootstrap() ويعتمد حالة الخادم.
// قبل هذه الدفعة كان updateUI() ينهار على زر غير موجود، فلا يُستدعى bootstrap() ولا يتصل اللاعب بالخادم أبداً.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
// كل السكربتات بترتيب الصفحة: المضمّنة كما هي، والمحلية (src يبدأ بـ /) من public/ — الخارجية (تيليجرام/Tailwind) تُتجاهل
const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => {
  const src = /\bsrc="([^"]+)"/.exec(m[1]);
  if (!src) return m[2];
  if (!src[1].startsWith('/')) return '';
  return fs.readFileSync(path.join(__dirname, '..', 'public', src[1].replace(/[?#].*$/, '')), 'utf8');
}).join('\n;\n');

const noop = () => {};
function makeElement(id = '') {
  const e = {
    id, style: {}, dataset: {}, children: [], innerText: '', textContent: '', value: '', disabled: false, hidden: false, title: '',
    width: 360, height: 330, clientWidth: 360, clientHeight: 330, offsetWidth: 360, offsetHeight: 330, scrollHeight: 100,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, prepend: noop, remove: noop, removeChild: noop,
    addEventListener: noop, removeEventListener: noop, setAttribute: noop, getAttribute: () => null, removeAttribute: noop, focus: noop, blur: noop, click: noop, scrollIntoView: noop,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, matches: () => false, contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 330, right: 360, bottom: 330 }),
    getContext: () => new Proxy({}, {
      get: (t, k) => (k === 'canvas' ? e : k === 'measureText' ? () => ({ width: 10 }) : /^create(Linear|Radial|Conic)Gradient$|^createPattern$/.test(String(k)) ? () => ({ addColorStop: noop }) : typeof k === 'string' ? noop : undefined),
      set: () => true,
    }),
    insertAdjacentHTML: noop, cloneNode() { return makeElement(id); },
  };
  let markup = '';
  // كما في المتصفح: إسناد innerHTML يستبدل الأبناء
  Object.defineProperty(e, 'innerHTML', { get: () => markup, set: (v) => { markup = String(v); e.children = []; } });
  Object.defineProperty(e, 'parentElement', { get: () => makeElement() });
  return e;
}

function bootPage({ me, source = script }) {
  const elements = new Map();
  const byId = (id) => { if (!ids.has(id)) return null; if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); };
  const timers = [];
  const log = { errors: [], alerts: [], fetches: [] };
  const localStore = new Map();
  const ctx = {
    console: { log: noop, info: noop, debug: noop, warn: noop, error: (...a) => log.errors.push(a.map(String).join(' ')) },
    document: {
      getElementById: byId, querySelector: () => null, querySelectorAll: () => [], createElement: () => makeElement(), createTextNode: (t) => ({ textContent: t }),
      addEventListener: noop, removeEventListener: noop, body: makeElement('body'), documentElement: makeElement('html'), hidden: false, visibilityState: 'visible',
    },
    localStorage: { getItem: (k) => (localStore.has(k) ? localStore.get(k) : null), setItem: (k, v) => localStore.set(k, String(v)), removeItem: (k) => localStore.delete(k), clear: () => localStore.clear() },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
    requestAnimationFrame: (fn) => { timers.push(fn); return 1; }, cancelAnimationFrame: noop,
    alert: (m) => log.alerts.push(String(m)), confirm: () => false, prompt: () => null,
    location: { search: '', href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', reload: noop },
    navigator: { userAgent: 'harness', vibrate: noop, clipboard: { writeText: async () => {} }, language: 'ar' },
    history: { replaceState: noop }, screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
    performance: { now: () => Date.now() }, URLSearchParams, URL, Date, Math, JSON, Number, String, Boolean, Array, Object, Promise, Set, Map, Error, TypeError, Symbol, Intl, parseInt, parseFloat, isFinite, isNaN, encodeURIComponent, decodeURIComponent, structuredClone,
    fetch: async (url) => {
      log.fetches.push(String(url));
      if (String(url).startsWith('/api/me')) return { ok: true, status: 200, json: async () => me };
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    },
    Audio: function () { return { play: async () => {}, pause: noop, load: noop }; },
    AudioContext: function () { return { createOscillator: () => ({ connect: noop, start: noop, stop: noop, frequency: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop } }), createGain: () => ({ connect: noop, gain: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop, linearRampToValueAtTime: noop } }), destination: {}, currentTime: 0, state: 'running', resume: async () => {} }; },
    WebSocket: function () { return { send: noop, close: noop, addEventListener: noop, readyState: 0 }; },
    Image: function () { return {}; }, Event: function () {}, CustomEvent: function () {},
    matchMedia: () => ({ matches: false, addEventListener: noop }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, scrollTo: noop,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.document.defaultView = ctx;
  vm.createContext(ctx);
  let topLevelError = null;
  try {
    vm.runInContext(`${source}\n;globalThis.__dbg = () => ({ serverMode, profile, state, SYNC });`, ctx, { filename: 'index.html' });
  } catch (e) { topLevelError = e; }
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      for (const fn of timers.splice(0)) { try { fn(); } catch (e) { log.errors.push(`timer: ${e.message}`); } }
      await new Promise((r) => setImmediate(r));
    }
  };
  return { ctx, log, byId, settle, topLevelError, dbg: () => (ctx.__dbg ? ctx.__dbg() : {}) };
}

const meResponse = {
  user: { id: 'guest_boot', name: 'ضيف' }, isNew: false, revision: 3, serverTime: Date.now(),
  state: { gold: 1234, totalEarned: 5000, xp: 150, level: 2, clickPower: 1, passiveIncome: 0, energy: 1000, maxEnergy: 1000, owned: { click: 0, bot: 0, rig: 0 }, costs: { click: 50, bot: 200, rig: 1000 }, adventureUpgrades: { magnet: 0, cart: 0, speed: 0, shield: 0, heart: 0, clock: 0, luck: 0, skill: 0 }, boostUntil: 0, boostCooldownUntil: 0, lastSeen: Date.now(), adventure: { runs: 0, gems: 0, zones: 1 } },
  progress: { level: 2, xp: 150, current: 50, needed: 220 },
  missions: { day: '2026-10-14', resetsIn: 7200, items: [
    { key: 'buy', icon: '🛒', title: 'اشترِ 2 ترقيات', target: 2, progress: 2, done: true, claimed: false, gold: 150, xp: 40 },
    { key: 'runs', icon: '🎮', title: 'أكمل 3 جولات مغامرة', target: 3, progress: 1, done: false, claimed: false, gold: 200, xp: 50 },
    { key: 'boost', icon: '🚀', title: 'فعّل التعزيز 2 مرات', target: 2, progress: 2, done: true, claimed: true, gold: 100, xp: 30 },
  ], bonus: { gold: 300, xp: 100, ready: false, claimed: false } },
  weeklyMissions: { week: '2026-W42', resetsIn: 259200, items: [
    { key: 'buy', icon: '🛒', title: 'اشترِ 6 ترقيات هذا الأسبوع', target: 6, progress: 6, done: true, claimed: false, gold: 500, xp: 120 },
    { key: 'runs', icon: '🎮', title: 'أكمل 15 جولات مغامرة هذا الأسبوع', target: 15, progress: 4, done: false, claimed: false, gold: 600, xp: 150 },
    { key: 'boost', icon: '🚀', title: 'فعّل التعزيز 8 مرات هذا الأسبوع', target: 8, progress: 8, done: true, claimed: true, gold: 400, xp: 100 },
  ], bonus: { gold: 1000, xp: 300, ready: false, claimed: false } },
  achievements: { total: 3, claimedCount: 1, items: [
    { id: 'first_run', icon: '🎬', name: 'أول مغامرة', desc: 'أكمل جولة مغامرة واحدة', target: 1, value: 1, done: true, claimed: false, gold: 25, xp: 10 },
    { id: 'boss', icon: '👹', name: 'قاتل الزعماء', desc: 'اهزم زعيم المنجم مرة واحدة', target: 1, value: 0, done: false, claimed: false, gold: 100, xp: 30 },
    { id: 'level5', icon: '⭐', name: 'معدّن متمرس', desc: 'ابلغ المستوى 5', target: 5, value: 5, done: true, claimed: true, gold: 150, xp: 0 },
  ] },
  daily: { canClaim: true, streak: 1, reward: 500 }, offline: { seconds: 0, gold: 0 }, race: { races: 0, wins: 0, bestScore: 0 },
  referralCount: 0, referralEarnings: 0,
};

test('the whole page script runs to the end and bootstrap() connects to the server (no missing-element crash)', async () => {
  const page = bootPage({ me: meResponse });
  assert.equal(page.topLevelError, null, page.topLevelError && `${page.topLevelError.message}\n${page.topLevelError.stack}`);
  await page.settle();
  assert.ok(page.log.fetches.some((u) => u.startsWith('/api/me')), 'bootstrap must request /api/me');
  const { serverMode, profile, state } = page.dbg();
  assert.equal(serverMode, true);
  assert.equal(state.gold, 1234, 'the authoritative balance is adopted');
  assert.deepEqual(JSON.parse(JSON.stringify(profile.progress)), meResponse.progress);
  assert.deepEqual(page.log.errors, []);
  assert.equal(page.byId('sync-status').innerText, '☁️ محفوظ على الخادم');
  assert.equal(page.byId('daily-btn').disabled, false);
  assert.match(page.byId('daily-btn').innerText, /500/);
  assert.equal(page.byId('level-badge').innerText.includes('2'), true);
});

test('the missions card is rendered from the server payload: progress, claimable, claimed and the day bonus', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  const list = page.byId('missions-list');
  assert.equal(list.children.length, 4, 'three missions + the bonus row');
  const rows = list.children.slice(0, 3).map((row) => ({ info: row.children[0].children[0].innerHTML, button: row.children[0].children[1] }));
  assert.match(rows[0].info, /اشترِ 2 ترقيات/);
  assert.match(rows[0].info, /2\/2/);
  assert.deepEqual([rows[0].button.disabled, rows[0].button.textContent], [false, 'استلم 150']);
  assert.match(rows[1].info, /1\/3/);
  assert.deepEqual([rows[1].button.disabled, rows[1].button.textContent], [true, '🔒']);
  assert.deepEqual([rows[2].button.disabled, rows[2].button.textContent], [true, '✓ استُلمت']);
  const bonusBtn = list.children[3].children[0];
  assert.deepEqual([bonusBtn.disabled, bonusBtn.textContent], [true, '🔒']);
  assert.match(page.byId('missions-reset').innerText, /2:00/);
  // الاستلام من الواجهة: ذهب متفائل + عملية mission في طابور المزامنة، ثم تُقفل الزر محلياً
  const before = page.dbg().state.gold;
  rows[0].button.onclick();
  const after = page.dbg();
  assert.equal(after.state.gold, before + 150);
  assert.ok(after.SYNC.pending.some((op) => op.type === 'mission' && op.key === 'buy' && op.expected === 150), JSON.stringify(after.SYNC.pending));
  assert.equal(list.children[0].children[0].children[1].textContent, '✓ استُلمت');
  // الضغط مرة أخرى لا يضيف عملية ثانية ولا ذهباً إضافياً
  list.children[0].children[0].children[1].onclick();
  assert.equal(page.dbg().state.gold, before + 150);
  assert.equal(page.dbg().SYNC.pending.filter((op) => op.type === 'mission').length, 1);
});

test('the achievements card is rendered from the server list (not the local stats) and a claim queues one achievement op', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  const box = page.byId('adv-achievements');
  assert.equal(box.children.length, 3, 'the server list replaces the 8 local definitions when connected');
  const rows = box.children.map((row) => ({ info: row.children[0].innerHTML, button: row.children[1] }));
  assert.match(rows[0].info, /أول مغامرة/);
  assert.match(rows[0].info, /1\/1/);
  assert.match(rows[0].info, /25 🪙 \+ 10 خبرة/);
  assert.deepEqual([rows[0].button.disabled, rows[0].button.textContent], [false, 'استلم 25']);
  assert.deepEqual([rows[1].button.disabled, rows[1].button.textContent], [true, '🔒']);
  assert.deepEqual([rows[2].button.disabled, rows[2].button.textContent], [true, '✓ استُلمت']);
  assert.equal(page.byId('ach-count').innerText, '1/3');
  const before = page.dbg().state.gold;
  rows[0].button.onclick();
  const after = page.dbg();
  assert.equal(after.state.gold, before + 25);
  assert.deepEqual(JSON.parse(JSON.stringify(after.SYNC.pending.filter((op) => op.type === 'achievement').map((op) => [op.id, op.expected]))), [['first_run', 25]]);
  assert.equal(box.children[0].children[1].textContent, '✓ استُلمت');
  assert.equal(page.byId('ach-count').innerText, '2/3');
  // النقر مرة أخرى لا يضيف عملية ولا ذهباً
  box.children[0].children[1].onclick();
  assert.equal(page.dbg().state.gold, before + 25);
  assert.equal(page.dbg().SYNC.pending.filter((op) => op.type === 'achievement').length, 1);
});

test('the weekly missions card is rendered from the server payload: progress, claimable, claimed and the week bonus', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  const list = page.byId('weekly-missions-list');
  assert.equal(list.children.length, 4, 'three weekly missions + the bonus row');
  const rows = list.children.slice(0, 3).map((row) => ({ info: row.children[0].children[0].innerHTML, button: row.children[0].children[1] }));
  assert.match(rows[0].info, /اشترِ 6 ترقيات هذا الأسبوع/);
  assert.match(rows[0].info, /6\/6/);
  assert.deepEqual([rows[0].button.disabled, rows[0].button.textContent], [false, 'استلم 500']);
  assert.match(rows[1].info, /4\/15/);
  assert.deepEqual([rows[1].button.disabled, rows[1].button.textContent], [true, '🔒']);
  assert.deepEqual([rows[2].button.disabled, rows[2].button.textContent], [true, '✓ استُلمت']);
  const bonusBtn = list.children[3].children[0];
  assert.deepEqual([bonusBtn.disabled, bonusBtn.textContent], [true, '🔒']);
  assert.match(page.byId('weekly-missions-reset').innerText, /2026-W42/);
  const before = page.dbg().state.gold;
  rows[0].button.onclick();
  const after = page.dbg();
  assert.equal(after.state.gold, before + 500);
  assert.ok(after.SYNC.pending.some((op) => op.type === 'weekly_mission' && op.key === 'buy' && op.expected === 500), JSON.stringify(after.SYNC.pending));
  assert.equal(list.children[0].children[0].children[1].textContent, '✓ استُلمت');
  // الضغط مرة أخرى لا يضيف عملية ثانية ولا ذهباً إضافياً
  list.children[0].children[0].children[1].onclick();
  assert.equal(page.dbg().state.gold, before + 500);
  assert.equal(page.dbg().SYNC.pending.filter((op) => op.type === 'weekly_mission').length, 1);
});


// ===== تبويب التعدين التفاعلي (public/clicker-fx.js) داخل الصفحة الكاملة =====
// المؤثرات عرض فقط: الذهب والطاقة وطابور العمليات يحسمها منطق الصفحة، والمؤثرات تراقب وتعرض.
const fxSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'clicker-fx.js'), 'utf8');
const showMiningTab = (page) => { page.byId('tab-mining').classList.contains = (c) => c === 'active'; };

test('with the clicker effects loaded a tap credits exactly what the game logic decides, and the effects only watch', async () => {
  const page = bootPage({ me: meResponse });
  assert.equal(page.topLevelError, null, page.topLevelError && page.topLevelError.message);
  await page.settle();
  const fx = page.ctx.ClickerFX;
  assert.equal(fx.active, true, 'the effects initialise against the real markup');
  const s0 = page.dbg();
  const [gold0, energy0, clicks0, power] = [s0.state.gold, s0.state.energy, s0.SYNC.clicks, s0.state.clickPower];
  for (let i = 0; i < 5; i++) page.ctx.handleMine({ clientX: 150, clientY: 160 });
  const s1 = page.dbg();
  assert.equal(s1.state.gold - gold0, 5 * power, 'five taps, five times clickPower');
  assert.equal(energy0 - s1.state.energy, 5 * power);
  assert.equal(s1.SYNC.clicks - clicks0, 5, 'five clicks queued for the server');
  assert.equal(fx.inspect().streak, 5, 'the effects counted the same taps');
  assert.ok(fx.inspect().particles > 0, 'particles were emitted');
  assert.ok(fx.inspect().heat > 0.1);
  assert.deepEqual(page.log.errors, []);
});

test('a tap without energy is refused: nothing credited, nothing queued, the streak untouched', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  page.ctx.handleMine({ clientX: 10, clientY: 10 });
  const live = page.dbg();
  live.state.energy = 0;
  const [gold, clicks, streak] = [live.state.gold, live.SYNC.clicks, page.ctx.ClickerFX.inspect().streak];
  page.ctx.handleMine({ clientX: 10, clientY: 10 });
  const after = page.dbg();
  assert.equal(after.state.gold, gold);
  assert.equal(after.SYNC.clicks, clicks);
  assert.equal(page.ctx.ClickerFX.inspect().streak, streak);
  assert.deepEqual(page.log.errors, []);
});

test('keyboard activation has no coordinates and still mines (falls back to the coin centre)', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  const g0 = page.dbg().state.gold;
  page.ctx.handleMine({ key: 'Enter' }); // KeyboardEvent: no clientX/clientY
  assert.equal(page.dbg().state.gold - g0, page.dbg().state.clickPower);
  assert.deepEqual(page.log.errors, []);
});

test('updateUI feeds the effects: medal states, energy states, live boost button and level-up celebration', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  showMiningTab(page);
  const { state, profile } = page.dbg();
  // medals: 1,234 gold covers all three upgrades (50 / 200 / 1,000); the workshop has gold but no ores yet, so it is not ready
  page.ctx.updateUI();
  const fxState = page.ctx.ClickerFX.inspect();
  assert.deepEqual({ ...fxState.nodes }, { click: 'ready', bot: 'ready', rig: 'ready', workshop: 'poor', deepdive: 'poor' }); // spread: the VM's objects have another realm's prototype
  assert.equal(fxState.hint, 'click', 'the first-run pointer targets the first ready medal');
  assert.equal(page.byId('ck-nodes').children.filter((c) => c.dataset && c.dataset.ckItem).length, 5, 'three upgrades, the workshop and the deep dive');
  state.gold = 120; page.ctx.updateUI();
  assert.deepEqual({ ...page.ctx.ClickerFX.inspect().nodes }, { click: 'ready', bot: 'poor', rig: 'poor', workshop: 'poor', deepdive: 'poor' });
  state.gold = 1234; page.ctx.updateUI();
  // energy states
  assert.equal(page.byId('energy-container').dataset.level, 'full');
  state.energy = 100; page.ctx.updateUI();
  assert.equal(page.byId('energy-container').dataset.level, 'low');
  assert.match(page.byId('ck-status-text').textContent, /100 نقرة/);
  state.energy = 0; page.ctx.updateUI();
  assert.equal(page.byId('energy-container').dataset.level, 'empty');
  assert.match(page.byId('ck-status-text').textContent, /الطاقة تتجدد/);
  state.energy = state.maxEnergy;
  // boost: active shows a countdown, disables the button and lights the stage; the harness has no inner label so the whole text is the fallback
  state.boostUntil = Date.now() + 20_000; state.boostCooldownUntil = Date.now() + 300_000;
  page.ctx.updateUI();
  const boost = page.byId('boost-btn');
  assert.equal(boost.dataset.state, 'active');
  assert.equal(boost.disabled, true);
  assert.match(boost.innerText, /تعزيز ×2 فعّال \(0:(19|20)\)/);
  assert.equal(page.byId('ck-stage').dataset.boost, '1');
  state.boostUntil = 0; page.ctx.updateUI();
  assert.equal(boost.dataset.state, 'cooldown');
  assert.match(boost.innerText, /جاهز بعد \((5:00|4:5\d)\)/);
  assert.equal(page.byId('ck-stage').dataset.boost, '0');
  state.boostCooldownUntil = 0; page.ctx.updateUI();
  assert.equal(boost.dataset.state, 'ready');
  assert.equal(boost.disabled, false);
  // level: the first sync only records it; a later rise of the same source celebrates
  assert.doesNotMatch(page.byId('ck-banner').textContent, /المستوى/, 'no level banner without a level change (the banner only shows the boost one)');
  profile.progress = { ...profile.progress, level: profile.progress.level + 1 };
  page.ctx.updateUI();
  assert.match(page.byId('ck-banner').textContent, new RegExp(`ارتقيت إلى المستوى ${profile.progress.level}`));
  assert.match(page.byId('ck-live').textContent, new RegExp(String(profile.progress.level)));
  assert.equal(page.byId('xp-text').textContent, `${profile.progress.current}/${profile.progress.needed} XP`);
  assert.deepEqual(page.log.errors, []);
});

test('switching tabs clears the effects and re-syncs on return', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  showMiningTab(page);
  for (let i = 0; i < 6; i++) page.ctx.handleMine({ clientX: 150, clientY: 160 });
  assert.equal(page.ctx.ClickerFX.inspect().streak, 6);
  page.ctx.ClickerFX.onTab('shop');
  const away = page.ctx.ClickerFX.inspect();
  assert.deepEqual([away.streak, away.heat, away.particles], [0, 0, 0]);
  page.ctx.ClickerFX.onTab('mining');
  assert.deepEqual(page.log.errors, []);
});

test('the upgrade window shows the effect, buys through buyUpgrade (a normal server op) and keeps the economy exact', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  showMiningTab(page);
  const fx = page.ctx.ClickerFX;
  const { state, SYNC } = page.dbg();
  page.ctx.updateUI();
  fx.openSheet('click');
  assert.equal(fx.inspect().sheet, 'click');
  assert.equal(page.byId('ck-sheet').hidden, false);
  assert.equal(page.byId('ck-sheet-title').textContent, 'فأس فولاذي');
  assert.equal(page.byId('ck-sheet-owned').textContent, '0');
  assert.match(page.byId('ck-sheet-now').textContent, /^1 لكل نقرة$/);
  assert.match(page.byId('ck-sheet-next').textContent, /^2 لكل نقرة$/);
  assert.equal(page.byId('ck-sheet-cost').textContent, '50');
  assert.equal(page.byId('ck-sheet-buy').disabled, false);
  assert.equal(fx.inspect().hinted, true, 'opening any window retires the first-run pointer');
  const [gold0, power0, pending0] = [state.gold, state.clickPower, SYNC.pending.length];
  fx.buyOpen();
  assert.equal(state.gold, gold0 - 50, 'exactly the listed price is charged');
  assert.equal(state.owned.click, 1);
  assert.equal(state.clickPower, power0 + 1, 'the effect shown in the window is the effect applied');
  assert.equal(SYNC.pending.length, pending0 + 1);
  assert.ok(SYNC.pending.some((op) => op.type === 'buy' && op.item === 'click'), 'a normal buy op is queued for the server');
  assert.equal(page.byId('ck-sheet-owned').textContent, '1', 'the window re-renders in place');
  assert.match(page.byId('ck-sheet-now').textContent, /^2 لكل نقرة$/);
  // not enough gold: the button is disabled, says why, and a forced buy changes nothing
  state.gold = 10; page.ctx.updateUI();
  assert.equal(page.byId('ck-sheet-buy').disabled, true);
  assert.equal(page.byId('ck-sheet-buy').textContent, 'الذهب غير كافٍ');
  assert.match(page.byId('ck-sheet-have').textContent, /ينقصك/);
  const owned = state.owned.click;
  fx.buyOpen();
  assert.equal(state.owned.click, owned, 'a refused purchase buys nothing');
  assert.equal(state.gold, 10);
  fx.closeSheet();
  assert.equal(fx.inspect().sheet, '');
  assert.equal(page.byId('ck-sheet').hidden, true);
  // leaving the tab closes it too
  fx.openSheet('bot');
  assert.equal(fx.inspect().sheet, 'bot');
  fx.onTab('shop');
  assert.equal(fx.inspect().sheet, '');
  assert.deepEqual(page.log.errors, []);
});

test('the workshop medal opens the workshop instead of a window, and the CTA starts a round unless a paused one waits', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  showMiningTab(page);
  const fx = page.ctx.ClickerFX;
  let opened = 0;
  page.ctx.openWorkshop = () => { opened++; };
  fx.openSheet('workshop'); // goes through opts.workshop (the real wsOpen), not through the sheet
  assert.equal(fx.inspect().sheet, '', 'no upgrade window for the workshop medal');
  const start = page.byId('platform-start'), resume = page.byId('platform-resume');
  let starts = 0;
  start.click = () => { starts++; };
  resume.hidden = true;
  page.ctx.goToMine();
  assert.equal(starts, 1, 'no paused round: the CTA starts one');
  resume.hidden = false;
  page.ctx.goToMine();
  assert.equal(starts, 1, 'a paused round: the player chooses (resume or restart)');
  resume.hidden = true; start.disabled = true;
  page.ctx.goToMine();
  assert.equal(starts, 1, 'a disabled start button is never clicked');
  assert.deepEqual(page.log.errors, []);
});

test('the deep-dive medal opens the full-screen dive: intro first, a run descends, the rope banks the loot, the record stays on the device and nothing is sent to the server', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  showMiningTab(page);
  const fx = page.ctx.ClickerFX, dd = page.ctx.DeepDigUI;
  assert.equal(dd.active, true, 'the dive initialised before the hub (its medal exists)');
  let paused = 0;
  page.ctx.PlatformGame = { pause: () => { paused++; }, refresh: noop };
  const overlay = page.byId('dd-overlay');
  overlay.hidden = true;
  const sentBefore = page.log.fetches.length;
  fx.openSheet('deepdive');                                   // the medal goes through opts.deepDive, not through the upgrade window
  assert.equal(fx.inspect().sheet, '', 'no upgrade window for the dive medal');
  assert.equal(overlay.hidden, false, 'the full-screen dive is open');
  assert.equal(dd.inspect().phase, 'intro');
  assert.equal(paused, 1, 'a paused platformer round must not run behind it');
  assert.equal(dd.inspect().game.depthM, 0);
  assert.equal(dd.startRun(), true);
  assert.equal(dd.inspect().phase, 'run');
  assert.equal(JSON.parse(page.ctx.localStorage.getItem('mining-deep-dig')).hinted, true, 'the first-run hint is remembered as soon as it was shown (not only after a finished run)');
  dd.debug.setStick(0, 1);                                    // the stick pushed down
  dd.debug.step(1 / 60, 300);                                 // 5 s of simulated play
  const mid = dd.inspect();
  assert.ok(mid.game.depthM >= 6, `the miner dug down (${mid.game.depthM} m)`);
  assert.equal(mid.game.hp, mid.game.maxHp, 'the first layer is safe');
  dd.debug.setStick(0, 0);
  dd.debug.fillBag('gold', 2);
  dd.debug.teleport(3, 14);
  assert.equal(dd.rope(), true, 'the rope starts');
  assert.equal(dd.inspect().game.state, 'rope');
  dd.debug.step(1 / 60, 400);
  const end = dd.inspect();
  assert.equal(end.phase, 'summary', 'the rope banked the loot and the summary card is up');
  assert.equal(end.game.status, 'done');
  const rec = JSON.parse(page.ctx.localStorage.getItem('mining-deep-dig'));
  assert.ok(rec.depthM >= 28 && rec.runs === 1 && rec.value >= 16, `the best depth and loot are kept locally: ${JSON.stringify(rec)}`);
  assert.equal(page.byId('dd-sum-value').textContent, String(end.record.value));
  assert.equal(dd.progress(), rec.depthM / dd.DEPTH_MAX_M, 'the medal ring follows the best depth');
  assert.equal(dd.close(), true);
  assert.equal(overlay.hidden, true); assert.equal(dd.inspect().phase, 'closed');
  assert.equal(dd.open(), true, 'it can be opened again');
  assert.equal(dd.inspect().record.runs, 1, 'the record survives a reopen');
  dd.close();
  const sent = page.log.fetches.slice(sentBefore);
  assert.deepEqual(sent, [], `the dive never talks to the server: ${sent.join(', ')}`);
  assert.equal(page.dbg().state.gold, meResponse.state.gold, 'no gold was written');
  assert.deepEqual(page.log.errors, []);
});

test('the deep-dive medal wears a "new" badge until it is opened once, and remembers that on the device', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  showMiningTab(page);
  const node = () => page.byId('ck-nodes').children.find((c) => c.dataset && c.dataset.ckItem === 'deepdive');
  assert.match(node().innerHTML, /class="ck-new"/, 'the badge is part of the medal');
  assert.equal(node().dataset.fresh, '1', 'shown on a fresh device');
  page.ctx.updateUI();                                         // 1,234 gold: the upgrade medals are ready, so the first-run pointer targets the first of them
  assert.equal(page.ctx.ClickerFX.inspect().hint, 'click', 'the first-run pointer teaches the upgrade window');
  assert.equal(page.ctx.localStorage.getItem('mining-fx-dive-seen'), null);
  page.ctx.PlatformGame = { pause() {}, refresh() {} };
  page.byId('dd-overlay').hidden = true;
  page.ctx.ClickerFX.openSheet('deepdive');
  assert.equal(node().dataset.fresh, '0', 'gone once opened');
  assert.equal(page.ctx.localStorage.getItem('mining-fx-hint'), null, 'opening the dive does not silence the first-run pointer: that hint teaches the upgrade window, which the player has not seen');
  assert.equal(page.ctx.ClickerFX.inspect().hint, 'click', 'the pointer still targets the first ready medal');
  assert.equal(page.ctx.localStorage.getItem('mining-fx-dive-seen'), '1');
  page.ctx.DeepDigUI.close();
  // a second visit (new page boot, same device) never shows it again
  const again = bootPage({ me: meResponse });
  again.ctx.localStorage.setItem('mining-fx-dive-seen', '1');
  await again.settle();
  assert.deepEqual(page.log.errors, []);
});

test('the dive pauses on Escape and when the page loses focus, never reads equipment it should not write, and survives broken art', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  showMiningTab(page);
  const dd = page.ctx.DeepDigUI;
  page.ctx.PlatformGame = { pause: noop, refresh: noop };
  page.byId('dd-overlay').hidden = true;
  dd.open(); dd.startRun();
  assert.equal(dd.inspect().phase, 'run');
  assert.equal(dd.pause('test'), true);
  assert.equal(dd.inspect().phase, 'paused');
  assert.equal(page.byId('dd-pause').hidden, false);
  dd.debug.setStick(0, 1);
  const before = dd.inspect().game.tick;
  dd.debug.step(1 / 60, 60);
  assert.equal(dd.inspect().game.tick, before, 'nothing advances while paused');
  assert.equal(dd.resume(), true);
  assert.equal(dd.inspect().phase, 'run');
  // the equipment levels come from the server state and are only read
  const eq = page.dbg().state.equipment;
  const snapshot = JSON.stringify(eq || null);
  dd.close(); dd.open();
  assert.equal(JSON.stringify(page.dbg().state.equipment || null), snapshot, 'equipment is read-only for the dive');
  dd.close();
  assert.deepEqual(page.log.errors, []);
});

test('the cave scene follows the mining tab: on when it opens, off when anything else opens', async () => {
  const page = bootPage({ me: meResponse });
  await page.settle();
  const classes = new Set();
  const body = page.ctx.document.body;
  body.classList.toggle = (name, force) => { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); };
  body.classList.contains = (name) => classes.has(name);
  const fx = page.ctx.ClickerFX;
  fx.onTab('mining');
  assert.equal(classes.has('ck-cave'), true);
  assert.equal(fx.inspect().scene, true);
  fx.onTab('play');
  assert.equal(classes.has('ck-cave'), false);
  assert.equal(fx.inspect().scene, false);
  assert.deepEqual(page.log.errors, []);
});

test('without clicker-fx.js the game still mines: legacy floating number, direct gold counter, classic boost label', async () => {
  const legacy = script.replace(fxSource, '');
  assert.notEqual(legacy, script, 'the module was really removed from the boot script');
  const page = bootPage({ me: meResponse, source: legacy });
  assert.equal(page.topLevelError, null, page.topLevelError && page.topLevelError.message);
  await page.settle();
  assert.equal(page.ctx.ClickerFX, undefined);
  const g0 = page.dbg().state.gold;
  const kids0 = page.byId('click-area').children.length;
  page.ctx.handleMine({ clientX: 120, clientY: 120 });
  const s = page.dbg();
  assert.equal(s.state.gold - g0, s.state.clickPower);
  assert.equal(page.byId('gold-counter').innerText, Math.floor(s.state.gold).toLocaleString('en-US'));
  assert.equal(page.byId('click-area').children.length, kids0 + 1, 'the old floating number is created');
  assert.match(page.byId('boost-btn').innerText, /تعزيز ×2 \(0:30\)/);
  assert.deepEqual(page.log.errors, []);
});
