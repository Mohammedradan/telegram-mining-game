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
const script = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n;\n');

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

function bootPage({ me }) {
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
    vm.runInContext(`${script}\n;globalThis.__dbg = () => ({ serverMode, profile, state, SYNC });`, ctx, { filename: 'index.html' });
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
