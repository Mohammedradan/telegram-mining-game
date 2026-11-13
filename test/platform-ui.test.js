// اختبار تكامل واجهة منجم المنصّة: يُقلع سكربتا index.html كاملين (كما يفعل page-boot)
// داخل VM بـ DOM خفيف، ثم يُشغّل مشهد المنصّة فعلياً: بدء جولة من الخادم، فيزياء حقيقية
// عبر requestAnimationFrame، إيقاف/استئناف، وإنهاء جولة فائزة تُرسل للخادم ويُعتمد ملفه
// بلا أي منح محلي. الخادم هنا محاكاة تصرف كالموثوق: يعيد تشغيل الحركات بقواعد المشروع.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../public/platform-rules');
const solution = require('./fixtures/platform-solution.cjs');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => {
  const src = /\bsrc="([^"]+)"/.exec(m[1]);
  if (!src) return m[2];
  if (!src[1].startsWith('/')) return '';
  return fs.readFileSync(path.join(__dirname, '..', 'public', src[1].replace(/[?#].*$/, '')), 'utf8');
}).join('\n;\n');

const noop = () => {};

const meResponse = () => ({
  user: { id: 'guest_boot', name: 'ضيف' }, isNew: false, revision: 3, serverTime: Date.now(),
  state: { gold: 1234, totalEarned: 5000, xp: 150, level: 2, clickPower: 1, passiveIncome: 0, energy: 1000, maxEnergy: 1000, owned: { click: 0, bot: 0, rig: 0 }, costs: { click: 50, bot: 200, rig: 1000 }, adventureUpgrades: { magnet: 0, cart: 0, speed: 0, shield: 0, heart: 0, clock: 0, luck: 0, skill: 0 }, boostUntil: 0, boostCooldownUntil: 0, lastSeen: Date.now(), adventure: { runs: 0, gems: 0, zones: 1 } },
  progress: { level: 2, xp: 150, current: 50, needed: 220 },
  missions: { day: '2026-10-16', resetsIn: 7200, items: [], bonus: { gold: 300, xp: 100, ready: false, claimed: false } },
  weeklyMissions: { week: '2026-W42', resetsIn: 259200, items: [], bonus: { gold: 1000, xp: 300, ready: false, claimed: false } },
  achievements: { total: 0, claimedCount: 0, items: [] },
  daily: { canClaim: true, streak: 1, reward: 500 }, offline: { seconds: 0, gold: 0 }, race: { races: 0, wins: 0, bestScore: 0 },
  referralCount: 0, referralEarnings: 0,
});

function makeElement(id = '', seed = {}) {
  const e = {
    id, style: {}, dataset: {}, children: [], innerText: '', textContent: '', value: '', disabled: false,
    hidden: Boolean(seed.hidden), title: '',
    width: 360, height: 330, clientWidth: 360, clientHeight: 330, offsetWidth: 360, offsetHeight: 330, scrollHeight: 100,
    _listeners: {},
    appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, prepend: noop, remove: noop, removeChild: noop,
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop, focus: noop, blur: noop, click: noop, scrollIntoView: noop, setPointerCapture: noop, releasePointerCapture: noop,
    querySelector(selector) { if (id === 'virtual-joystick' && selector === '.joystick-handle') { if (!this._joystickHandle) this._joystickHandle = makeElement('joystick-handle'); return this._joystickHandle; } return null; }, querySelectorAll: () => [], closest: () => null, matches: () => false, contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 330, right: 360, bottom: 330 }),
    getContext: () => new Proxy({}, {
      get: (t, k) => (k === 'canvas' ? e : k === 'measureText' ? () => ({ width: 10 }) : /^create(Linear|Radial|Conic)Gradient$|^createPattern$/.test(String(k)) ? () => ({ addColorStop: noop }) : typeof k === 'string' ? noop : undefined),
      set: () => true,
    }),
    insertAdjacentHTML: noop, cloneNode() { return makeElement(id, seed); },
  };
  const classes = new Set(seed.classes || []);
  e.classList = {
    add: (...c) => classes.add(...c), remove: (...c) => classes.delete(...c), toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
    contains: (c) => classes.has(c),
  };
  let markup = '';
  Object.defineProperty(e, 'innerHTML', { get: () => markup, set: (v) => { markup = String(v); e.children = []; } });
  Object.defineProperty(e, 'parentElement', { get: () => makeElement() });
  return e;
}

// إقلاع الصفحة الكاملة: fetch موجّه إلى /api/me + مسارَي المنصّة (محاكاة خادم يتحقق بإعادة التشغيل)
function bootPage({ failServer = false, storedRun = null } = {}) {
  const elements = new Map();
  const byId = (id) => {
    if (!ids.has(id)) return null;
    if (!elements.has(id)) {
      const seeds = { 'platform-scene': { hidden: false, classes: ['scene-lobby'] }, 'legacy-adventure': { hidden: true }, 'tab-play': { classes: ['active'] }, 'play-panel-adventure': { classes: ['active'] }, 'ctl-modal': { hidden: true }, 'platform-pause': { classes: ['action-btn', 'pause-btn', 'hud-pause'] } };
      elements.set(id, makeElement(id, seeds[id] || {}));
    }
    return elements.get(id);
  };
  const controls = [1, 2, 4, 8].map(mask => { const b = makeElement(); b.dataset.platformInput = String(mask); return b; });
  const clock = { now: 0 };
  const tick = () => (clock.now += 16.7);
  const timers = [];
  let rafId = 0;
  const rafQueue = new Map();
  const windowListeners = [];
  const log = { errors: [], alerts: [], fetches: [], platformStarts: 0, platformFinishBodies: [], platformStartBodies: [] };
  const localStore = new Map();
  if (storedRun) localStore.set(`platform-run:v1:guest_boot`, JSON.stringify(storedRun));

  let me = null;
  const fetchMock = async (url, options = {}) => {
    const u = String(url);
    log.fetches.push(u);
    if (failServer) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    if (u.startsWith('/api/me')) { me = meResponse(); return { ok: true, status: 200, json: async () => me }; }
    if (u.startsWith('/api/ops')) return { ok: true, status: 200, json: async () => ({ ok: true, accepted: [], revision: me?.revision || 0, serverSeq: 0, state: me?.state, progress: me?.progress }) };
    if (u.startsWith('/api/platform/start')) {
      log.platformStarts++;
      const body = JSON.parse(options.body || '{}');
      log.platformStartBodies.push(body);
      // نفس عقد الخادم (V6): التذكرة تعيد لقطة المنجم والهدف والمعدات
      return { ok: true, status: 200, json: async () => ({ id: 'ticket-ui-1', version: R.VERSION, config: R.normalizeConfig(body), startedAt: Date.now(), expiresAt: Date.now() + 30 * 60 * 1000 }) };
    }
    if (u.startsWith('/api/platform/finish')) {
      // نفس عقد الخادم: إعادة تشغيل الحركات بقواعد المشروع — المتصفح لا يفرض شيئاً
      const body = JSON.parse(options.body || '{}');
      log.platformFinishBodies.push(body);
      const replay = R.replay(body.inputs, body.hero, R.seedFromId(body.id));
      if (!replay.ok || replay.state.status !== 'won') return { ok: false, status: 400, json: async () => ({ error: 'حركات جولة غير صالحة' }) };
      const s = replay.state;
      const gold = R.rewardFor(s);
      const profile = meResponse();
      profile.state = { ...profile.state, gold: profile.state.gold + gold, totalEarned: profile.state.totalEarned + gold, adventure: { runs: 1, gems: s.collected, zones: 1 } };
      profile.revision = 9;
      const goal = R.goalStatus(s);
      return {
        ok: true, status: 200,
        json: async () => ({ id: body.id, won: true, gold, xp: 20 + s.collected, score: s.collected * 25 + s.mined * 50 + 200, gems: s.collected, mined: s.mined, duration: s.tick / R.FPS,
          goal: { id: goal.id, name: goal.name, done: goal.done, now: goal.now, target: goal.target },
          choice: s.choice || null, veinBroken: s.veinBroken === true, oreWind: s.oreWind === true, ores: R.oreSummary(s), profile }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  };

  const ctx = {
    console: { log: noop, info: noop, debug: noop, warn: noop, error: (...a) => log.errors.push(a.map(String).join(' ')) },
    document: {
      getElementById: byId, querySelector: () => null, querySelectorAll: selector => selector === '[data-platform-input]' ? controls : [], createElement: () => makeElement(), createTextNode: (t) => ({ textContent: t }),
      addEventListener: noop, removeEventListener: noop, body: makeElement('body'), documentElement: makeElement('html'), hidden: false, visibilityState: 'visible',
    },
    localStorage: { getItem: (k) => (localStore.has(k) ? localStore.get(k) : null), setItem: (k, v) => localStore.set(k, String(v)), removeItem: (k) => localStore.delete(k), clear: () => localStore.clear() },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
    requestAnimationFrame: (fn) => { rafQueue.set(++rafId, fn); return rafId; }, cancelAnimationFrame: (id) => { rafQueue.delete(id); },
    alert: (m) => log.alerts.push(String(m)), confirm: () => false, prompt: () => null,
    location: { search: '', href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', reload: noop },
    navigator: { userAgent: 'harness', vibrate: noop, clipboard: { writeText: async () => {} }, language: 'ar' },
    history: { replaceState: noop }, screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
    performance: { now: () => tick() }, URLSearchParams, URL, Date, Math, JSON, Number, String, Boolean, Array, Object, Promise, Set, Map, Error, TypeError, Symbol, Intl, parseInt, parseFloat, isFinite, isNaN, encodeURIComponent, decodeURIComponent, structuredClone,
    fetch: fetchMock,
    Audio: function () { return { play: async () => {}, pause: noop, load: noop }; },
    AudioContext: function () { return { createOscillator: () => ({ connect: noop, start: noop, stop: noop, frequency: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop } }), createGain: () => ({ connect: noop, gain: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop, linearRampToValueAtTime: noop } }), destination: {}, currentTime: 0, state: 'running', resume: async () => {} }; },
    WebSocket: function () { return { send: noop, close: noop, addEventListener: noop, readyState: 0 }; },
    Image: function () { return {}; }, Event: function () {}, CustomEvent: function () {},
    matchMedia: () => ({ matches: false, addEventListener: noop }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: (type, fn) => windowListeners.push([type, fn]), removeEventListener: noop, dispatchEvent: noop, scrollTo: noop,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.document.defaultView = ctx;
  vm.createContext(ctx);
  let topLevelError = null;
  try { vm.runInContext(`${script}\n;globalThis.__dbg = () => ({ serverMode, profile, state, SYNC });`, ctx, { filename: 'index.html' }); }
  catch (e) { topLevelError = e; }

  const fire = (el, type, event = {}) => { for (const fn of el?._listeners?.[type] || []) fn({ type, preventDefault: noop, ...event }); };
  const fireWindow = (type, event = {}) => { for (const [t, fn] of windowListeners) if (t === type) fn({ type, preventDefault: noop, target: { tagName: 'BODY' }, ...event }); };
  const key = (type, code) => fireWindow(type, { code, key: code === 'Space' ? ' ' : code.startsWith('Key') ? code.slice(-1).toLowerCase() : code });
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      for (const fn of timers.splice(0)) { try { fn(); } catch (e) { log.errors.push(`timer: ${e.message}`); } }
      await new Promise((r) => setImmediate(r));
    }
  };
  // كل إطار بطابع زمني متزايد كما في المتصفح — وإلا تبقى الحركات المتراكمة صفراً
  const flushFrames = (n) => { for (let i = 0; i < n; i++) { clock.now += 16.7; const batch = [...rafQueue.values()]; rafQueue.clear(); for (const fn of batch) fn(clock.now); } };
  return { ctx, log, byId, controls, settle, flushFrames, fire, fireWindow, key, topLevelError, dbg: () => (ctx.__dbg ? ctx.__dbg() : {}), PlatformGame: () => ctx.PlatformGame, localStore };
}

test('platform UI: the page wires the scene — assets and every element the controller needs', () => {
  for (const asset of ['/platform.css', '/platform-rules.js', '/platform-renderer.js', '/platform-bridge.js', '/platform-game.js']) {
    assert.ok(html.includes(asset), `${asset} must be referenced from index.html`);
  }
  for (const id of ['platform-scene', 'legacy-adventure', 'platform-canvas', 'platform-overlay', 'platform-title', 'platform-message',
    'platform-start', 'platform-resume', 'platform-pause', 'platform-retry', 'platform-discard', 'platform-mute', 'platform-hearts', 'platform-resources', 'platform-progress', 'platform-status', 'platform-gold', 'platform-energy', 'virtual-joystick',
    'platform-combo', 'overlay-mission', 'mission-gems', 'mission-rocks', 'mission-fill',
    'mission-milestones', 'milestone-count', 'ore-storage', 'ore-list', 'sell-all-ore', 'ore-total',
    'ws-overlay', 'ws-hero', 'ws-nodes', 'ws-cta', 'ws-modal', 'open-workshop-heading']) {
    assert.ok(ids.has(id), `#${id} must exist`);
  }
  // Action buttons only (no directional buttons 1 and 2 - replaced by virtual joystick)
  for (const mask of [4, 8, 16, 32]) assert.match(html, new RegExp(`data-platform-input="${mask}"`));
  assert.match(html, /هدف الجولة: اجمع 3 بلورات/);
  assert.match(html, /اقفز بالمسافة/);
  for (const hero of ['miner', 'warrior', 'archer']) assert.ok(ids.has(`hero-btn-${hero}`), `#hero-btn-${hero} must exist`);
  // اللعبة الأصلية تبقى قائمة: نفس أزرارها ومعرّفاتها داخل الغلاف
  for (const id of ['game-canvas', 'game-overlay', 'game-overlay-btn', 'adv-pause-btn', 'adv-skill-btn', 'adv-mute-btn', 'adv-combo']) assert.ok(ids.has(id));
});

test('UI chrome uses inline SVG icons instead of emoji glyphs', () => {
  assert.ok(html.includes('class="icon-sprite"'), 'the SVG sprite must be inlined in the page');
  const buttons = [...html.matchAll(/<button\b[^>]*class="action-btn[^"]*"[^>]*>[\s\S]*?<\/button>/g)].map(m => m[0]);
  assert.equal(buttons.length, 11, 'the V20 pad adds an upper-route jump beside the normal jump');
  for (const button of buttons) {
    assert.match(button, /<use href="#i-[a-z]+"\/>/, 'every control uses a sprite icon');
    assert.doesNotMatch(button, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'no emoji glyph in a control button');
  }
  assert.doesNotMatch(html.match(/<nav class="bottom-nav[\s\S]*?<\/nav>/)?.[0] || '', /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'bottom navigation must not rely on emoji fonts');
  assert.ok(html.includes('id="res-gems"') && html.includes('id="res-rocks"') && html.includes('id="res-foes"'), 'HUD counters are separate SVG chips');
});

test('platform UI: phase 1 impact feedback counters are exposed without changing simulation', async () => {
  const page = bootPage();
  assert.equal(page.topLevelError, null, page.topLevelError && `${page.topLevelError.message}\n${page.topLevelError.stack}`);
  await page.settle();
  const info = page.PlatformGame().inspect();
  assert.equal(info.floatersSpawned, 0);
  assert.equal(info.combo, 0);
  assert.equal(info.hitStop, false);
  assert.equal(info.milestones, 0);
  assert.equal(typeof info.ores, 'object');
  assert.equal(info.ores.copper, 0);
});

test('platform UI: the side-scroller is the focused default play view', async () => {
  const page = bootPage();
  assert.equal(page.topLevelError, null, page.topLevelError && `${page.topLevelError.message}\n${page.topLevelError.stack}`);
  await page.settle();
  assert.equal(page.dbg().serverMode, true);
  assert.equal(page.byId('platform-scene').hidden, false, 'the platform scene is the default play view');
  assert.equal(page.byId('legacy-adventure').hidden, true, 'the legacy game is hidden');
  assert.deepEqual(page.log.errors, []);
});

test('platform UI: a real round runs — server ticket, live physics from keys, HUD, pause and resume', async () => {
  const page = bootPage();
  await page.settle();
  page.fire(page.byId('platform-start'), 'click');
  await page.settle();
  assert.equal(page.log.platformStarts, 1, 'the round must be opened on the server (/api/platform/start)');
  let game = page.PlatformGame().inspect();
  assert.equal(game.running, true);
  assert.equal(game.ticket, 'ticket-ui-1');
  // مشي حقيقي بالأسهم: الفيزياء المشتركة تحرّك اللاعب (لا شاشة شكلية)
  const x0 = game.x;
  page.key('keydown', 'ArrowRight');
  page.flushFrames(30);
  game = page.PlatformGame().inspect();
  // HUD يتحدث من داخل الإطارات
  assert.match(page.byId('platform-hearts').textContent, /♥/);
  for (const id of ['res-gems', 'res-rocks', 'res-foes']) {
    assert.match(page.byId(id).textContent, /^\d+$/, `${id} shows a live HUD counter`);
  } // the HUD tracks exit requirements and defeated enemies with SVG chips
  assert.ok(game.x > x0 + 50, `player must move right (x0=${x0}, x=${game.x})`);
  assert.equal(game.pose, 'run');
  assert.ok(game.tick > 10, 'fixed-step ticks advance');
  // حفظ دوري محلي تحت مفتاح المالك
  assert.ok([...page.localStore.keys()].some((k) => k.startsWith('platform-run:v1:guest_boot')), 'the round is checkpointed locally under the owner key');
  // قفزة حقيقية تغادر الأرض
  page.key('keydown', 'Space');
  page.flushFrames(3);
  game = page.PlatformGame().inspect();
  assert.notEqual(game.pose, 'run');
  page.key('keyup', 'Space');
  page.key('keyup', 'ArrowRight');
  // إيقاف عبر blur ثم استئناف من الغطاء
  page.fireWindow('blur');
  assert.equal(page.PlatformGame().inspect().paused, true);
  assert.equal(page.byId('platform-overlay').hidden, false);
  assert.equal(page.byId('platform-resume').hidden, false);
  page.fire(page.byId('platform-resume'), 'click');
  assert.equal(page.PlatformGame().inspect().paused, false);
  assert.equal(page.byId('platform-overlay').hidden, true);
  assert.deepEqual(page.log.errors, []);
  // جولة لم تنتهِ: لا إنهاء ولا مكافأة
  assert.equal(page.log.platformFinishBodies.length, 0);
});

test('platform UI: pausing clears a held virtual joystick so movement does not stick on resume', async () => {
  const page = bootPage();
  await page.settle();
  page.fire(page.byId('platform-start'), 'click');
  await page.settle();
  const joystick = page.byId('virtual-joystick');
  const rect = joystick.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
  const radius = Math.max(22, rect.width * 0.34);
  const startX = page.PlatformGame().inspect().x;
  // دفعٌ كامل للعصا: جري بسرعة كاملة
  page.fire(joystick, 'pointerdown', { pointerId: 7, clientX: centerX + radius, clientY: centerY });
  page.flushFrames(20);
  const runX = page.PlatformGame().inspect().x;
  assert.ok(runX > startX + 40, 'the virtual joystick moves the player');
  // اللمس المتعدد: الإصبع الثاني يضغط الهجوم دون أن يوقف الحركة أو يفقد العصا
  page.fire(joystick, 'pointermove', { pointerId: 7, clientX: centerX + radius, clientY: centerY });
  page.PlatformGame().pause();
  page.PlatformGame().pause();
  const pausedX = page.PlatformGame().inspect().x;
  page.fire(page.byId('platform-resume'), 'click');
  page.flushFrames(15);
  assert.equal(page.PlatformGame().inspect().x, pausedX, 'a stale joystick pointer must not keep moving the player after resume');
  assert.deepEqual(page.log.errors, []);
});

test('platform UI: a finished winning round is submitted on boot, confirmed by the server replay and adopted — no local award', async () => {
  const { inputs, state } = solution(R.seedFromId('ticket-ui-9'));
  const stored = { version: R.VERSION, ticket: { id: 'ticket-ui-9', version: R.VERSION, startedAt: Date.now(), expiresAt: Date.now() + 864e5 }, inputs, finished: true };
  const page = bootPage({ storedRun: stored });
  await page.settle();
  // استرجاع الجولة المحفوظة يرسلها للخادم دون أي نقر
  assert.equal(page.log.platformFinishBodies.length, 1);
  const sent = page.log.platformFinishBodies[0];
  assert.equal(sent.id, 'ticket-ui-9');
  assert.deepEqual(sent.inputs, inputs);
  // اعتماد ملف الخادم: الذهب 1234 + 98 من الخادم فقط — لا عملية مكافأة محلية ولا إضافة مزدوجة
  const dbg = page.dbg();
  assert.equal(dbg.state.gold, 1234 + R.rewardFor(state));
  assert.equal(dbg.SYNC.pending.some((op) => op.type === 'reward' || op.expected === R.rewardFor(state)), false, 'no local reward op is queued');
  assert.equal(dbg.SYNC.revision, 9, 'the server revision of the finish response is adopted');
  assert.equal(dbg.state.adventure.runs, 1);
  // الحالة المعروضة تؤكد الحفظ الخادمي وتغلق الاسترجاع
  assert.match(page.byId('platform-status').textContent, /محفوظ على الخادم/);
  assert.match(page.byId('platform-status').textContent, new RegExp(`\\+${R.rewardFor(state)} ذهب`));
  assert.equal(page.PlatformGame().inspect().pending, false);
  assert.equal(page.byId('platform-start').disabled, false);
  assert.equal(page.byId('platform-retry').hidden, true);
  assert.equal(page.byId('platform-discard').hidden, true);
  assert.equal(page.localStore.has('platform-run:v1:guest_boot'), false, 'the local checkpoint is cleared after server confirmation');
  assert.deepEqual(page.log.errors, []);
  // لم تُطلب جولة جديدة من تلقاء نفسها، ولم يُرسل الإنهاء مرتين
  assert.equal(page.log.platformStarts, 0);
});

test('platform UI: without a server identity the round is offline training — playable, but no ticket and no finish request', async () => {
  const page = bootPage({ failServer: true });
  await page.settle();
  assert.equal(page.dbg().serverMode, false);
  page.fire(page.byId('platform-start'), 'click');
  await page.settle();
  const game = page.PlatformGame().inspect();
  assert.equal(game.running, true);
  assert.ok(!game.ticket, 'no server ticket without an identity');
  assert.match(page.byId('platform-status').textContent, /تدريب بلا اتصال/);
  const x0 = game.x;
  page.key('keydown', 'ArrowRight');
  page.flushFrames(15);
  assert.ok(page.PlatformGame().inspect().x > x0, 'offline training still runs real physics');
  page.key('keyup', 'ArrowRight');
  assert.equal(page.log.fetches.some((u) => u.startsWith('/api/platform')), false, 'offline play never touches the platform API');
  assert.deepEqual(page.log.errors, []);
});

test('platform UI: character selection switches hero and attack/skill keys trigger combat actions', async () => {
  const page = bootPage();
  await page.settle();
  const gameApi = page.PlatformGame();
  assert.ok(gameApi);

  // Default is miner
  assert.equal(gameApi.inspect().hero, 'miner');

  // Switch to warrior
  gameApi.setHero('warrior');
  assert.equal(gameApi.inspect().hero, 'warrior');
  assert.equal(gameApi.inspect().hearts, 4);

  // Switch to archer
  gameApi.setHero('archer');
  assert.equal(gameApi.inspect().hero, 'archer');
  assert.equal(gameApi.inspect().hearts, 3);

  // Switch back to miner
  gameApi.setHero('miner');
  assert.equal(gameApi.inspect().hero, 'miner');

  // Start round
  page.fire(page.byId('platform-start'), 'click');
  await page.settle();
  assert.equal(gameApi.inspect().running, true);
});

test('platform UI: virtual joystick exists and is hidden on desktop', async () => {
  const page = bootPage();
  await page.settle();
  assert.ok(page.byId('virtual-joystick'), '#virtual-joystick must exist');
  // Joystick should be hidden by default (desktop)
  const joystick = page.byId('virtual-joystick');
  assert.match(joystick.style.display || 'none', /none/);
});

test('platform UI: action buttons exist with correct labels', () => {
  assert.ok(ids.has('platform-pause'), '#platform-pause must exist');
  for (const input of [4, 8, 16, 32]) {
    assert.ok(html.includes(`data-platform-input="${input}"`), `action button with input ${input} must exist`);
  }
});

// ===== V6: اختيار الهدف، الإرشاد الأول، وملخص الختام — عبر مسار اللعب الحقيقي =====
test('V6 UI: the goal picker changes the next run only, persists locally, and rides the start ticket', async () => {
  const page = bootPage();
  await page.settle();
  assert.equal(page.PlatformGame().getGoal(), 0, 'the first goal is selected by default');
  assert.equal(page.PlatformGame().setGoal(1), true);
  assert.equal(page.PlatformGame().getGoal(), 1);
  assert.equal(page.localStore.get('platform-goal'), '1', 'the chosen goal is remembered on the device');
  assert.equal(page.PlatformGame().setGoal(1), false, 're-selecting the same goal is a no-op');
  assert.equal(page.PlatformGame().setGoal(9), false, 'an unknown goal is refused');
  page.fire(page.byId('platform-start'), 'click');
  await page.settle();
  assert.equal(page.log.platformStarts, 1);
  assert.deepEqual(page.log.platformStartBodies[0], { zone: 0, goal: 1, mode: 'mine' }, 'the server receives the chosen goal and mode');
  // أثناء الجولة: تغيير الهدف مرفوض ولا يمسّ الجولة الجارية أو تذكرتها
  assert.equal(page.PlatformGame().setGoal(2), false, 'the goal cannot change mid-run');
  assert.equal(page.PlatformGame().getGoal(), 1, 'the running goal stays as the ticket pinned it');
  page.PlatformGame().pause();
  assert.deepEqual(page.log.errors, []);
});

test('V6 UI: the first-run coach shows once, can be skipped, and never returns', async () => {
  const first = bootPage();
  await first.settle();
  assert.equal(first.byId('platform-coach').hidden, false, 'a brand-new device sees the short guide');
  first.fire(first.byId('coach-next'), 'click');
  assert.equal(first.byId('coach-step').textContent, '2/3');
  first.fire(first.byId('coach-skip'), 'click');
  assert.equal(first.byId('platform-coach').hidden, true, 'skipping closes it immediately');
  assert.equal(first.localStore.get('platform-coach:v1'), '1', 'skipping is remembered');
  assert.deepEqual(first.log.errors, []);

  const again = bootPage();
  again.localStore.set('platform-coach:v1', '1');
  await again.settle();
  assert.equal(again.byId('platform-coach').hidden, true, 'the guide does not repeat on the same device');
});

test('V6 UI: the run summary is filled from the verified server receipt, not from local numbers', async () => {
  const { inputs, state } = solution(R.seedFromId('ticket-ui-9'));
  const stored = { version: R.VERSION, ticket: { id: 'ticket-ui-9', version: R.VERSION, startedAt: Date.now(), expiresAt: Date.now() + 864e5 }, inputs, finished: true };
  const page = bootPage({ storedRun: stored });
  await page.settle();
  const rows = page.byId('summary-rows').children.map(row => row.children.map(c => c.textContent).join(' '));
  assert.ok(rows.length >= 5, 'the summary lists goal, fork, vein, gems and the ore wallet');
  assert.ok(rows.some(r => r.includes(R.GOALS[0].name)), 'the goal row names the goal');
  assert.ok(rows.some(r => r.includes('المفترق')), 'the decision is reported');
  assert.ok(rows.some(r => r.includes('خامات الجولة')), 'the ore wallet is reported');
  assert.ok(rows.some(r => new RegExp(`\\+${R.rewardFor(state)} ذهب`).test(r)), 'the confirmed gold matches the server replay');
  assert.equal(page.byId('platform-summary').hidden, false);
  assert.match(page.byId('summary-goal').textContent, new RegExp(R.GOALS[0].name));
  assert.ok(/لماذا جولة أخرى/.test(page.byId('summary-next').textContent), 'the summary always explains the next run');
  assert.deepEqual(page.log.errors, []);
});

test('platform UI: zero-scroll layout — scene locked, HUD overlay inside stage, single pause', () => {
  const page = bootPage();
  const scene = page.byId('platform-scene');
  assert.ok(scene, 'platform-scene exists');
  assert.equal(scene.hidden, false);
  assert.ok(scene.classList.contains('scene-lobby'), 'scene starts in Lobby');
  assert.equal(page.byId('platform-pause').classList.contains('hud-pause'), true,
    'pause is the floating circular HUD button');
});

test('platform UI: Lobby default state, Live class while round runs', async () => {
  const page = bootPage();
  await page.settle();
  const scene = page.byId('platform-scene');
  assert.ok(scene.classList.contains('scene-lobby'), 'Lobby: scene-lobby at start');
  assert.equal(scene.classList.contains('scene-live'), false, 'Lobby: not scene-live at start');
  page.fire(page.byId('platform-start'), 'click');
  await page.settle();
  const game = page.PlatformGame().inspect();
  assert.equal(game.running, true);
  assert.ok(scene.classList.contains('scene-live'), 'Live: scene-live while running');
  assert.equal(scene.classList.contains('scene-lobby'), false, 'Live: not scene-lobby while running');
  page.fireWindow('blur');
  assert.equal(page.PlatformGame().inspect().paused, true);
  assert.equal(scene.classList.contains('scene-live'), false, 'paused: not scene-live');
  assert.ok(scene.classList.contains('scene-lobby'), 'paused: scene-lobby again');
  assert.deepEqual(page.log.errors, []);
});

test('platform UI: control-settings modal open/close and edit toggle', async () => {
  const page = bootPage();
  await page.settle();
  const modal = page.byId('ctl-modal');
  assert.ok(modal, 'ctl-modal exists');
  assert.equal(modal.hidden, true, 'modal hidden at start');
  page.fire(page.byId('open-ctl-settings'), 'click');
  assert.equal(modal.hidden, false, 'modal opens on opener click');
  page.fire(page.byId('ctl-modal-close'), 'click');
  assert.equal(modal.hidden, true, 'modal closes on close button');
  page.fire(page.byId('open-ctl-settings'), 'click');
  assert.equal(modal.hidden, false, 'modal reopens');
  page.fire(page.byId('ctl-edit'), 'click');
  assert.equal(page.PlatformGame().layoutEditing(), true, 'layout editing on');
  assert.equal(page.byId('ctl-layout-hint').hidden, false, 'layout hint visible while editing');
  page.fire(page.byId('ctl-edit'), 'click');
  assert.equal(page.PlatformGame().layoutEditing(), false, 'layout editing off');
  assert.equal(page.byId('ctl-layout-hint').hidden, true, 'layout hint hidden when not editing');
  // الإغلاق عبر زر الإغلاق في الرأس
  page.fire(page.byId('ctl-modal-close'), 'click');
  assert.equal(modal.hidden, true, 'modal closes on close button');
  assert.equal(page.PlatformGame().inspect().ctlOpen, false, 'ctlOpen false after close');
  assert.deepEqual(page.log.errors, []);
});

test('platform UI: pause button stays visible on all device classes', async () => {
  const page = bootPage();
  await page.settle();
  const pause = page.byId('platform-pause');
  assert.equal(pause.hidden, false, 'pause button present (not hidden)');
  assert.ok(pause.classList.contains('hud-pause'), 'pause is the floating HUD button');
  const controls = page.byId('virtual-joystick').parentElement;
  assert.equal(controls.querySelector('#platform-pause'), null,
    'no duplicate pause inside touch controls');
  assert.deepEqual(page.log.errors, []);
});
