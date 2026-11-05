// تشغيل حقيقي لساحة القتال داخل DOM خفيف: بدء المباراة، الاقتراب، الضرب، دور الخصم،
// اختصارات الكيبورد، وحكم النهاية فوق المسرح. الهدف: التأكد أن الشاشة «تفاعلية» فعلًا لا مجرد HTML.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../public/arena-rules');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => {
  const src = /\bsrc="([^"]+)"/.exec(m[1]);
  if (!src) return m[2];
  if (!src[1].startsWith('/')) return '';
  return fs.readFileSync(path.join(__dirname, '..', 'public', src[1].replace(/[?#].*$/, '')), 'utf8');
}).join('\n;\n');
const noop = () => {};

function makeElement(id = '', seed = {}) {
  const e = {
    id, style: {}, dataset: {}, children: [], innerText: '', textContent: '', value: '', disabled: false, hidden: Boolean(seed.hidden), title: '',
    width: 360, height: 330, clientWidth: 360, clientHeight: 330, offsetWidth: 360, offsetHeight: 330, scrollHeight: 100,
    _listeners: {},
    appendChild(c) { c._parent = this; this.children.push(c); return c; },
    append(...c) { c.forEach((x) => { x._parent = this; }); this.children.push(...c); },
    prepend(c) { c._parent = this; this.children.unshift(c); return c; },
    // إزالة حقيقية: كود السجل يقصّ الأقدم عبر lastChild.remove()
    remove() { const p = this._parent; if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); } this._parent = null; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    get firstChild() { return this.children[0] || null; },
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop, focus: noop, blur: noop, click: noop, scrollIntoView: noop,
    setPointerCapture: noop, releasePointerCapture: noop,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, matches: () => false, contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 330, right: 360, bottom: 330 }),
    getContext: () => new Proxy({}, {
      get: (t, k) => (k === 'canvas' ? e : k === 'measureText' ? () => ({ width: 10 }) : /^create(Linear|Radial|Conic)Gradient$|^createPattern$/.test(String(k)) ? () => ({ addColorStop: noop }) : typeof k === 'string' ? noop : undefined),
      set: () => true,
    }),
    insertAdjacentHTML: noop, cloneNode() { return makeElement(id, seed); },
  };
  // classList يطابق المتصفح في معامل الإجبار (force) — الكود يعتمد عليه في التحويل بين الحالات
  const classes = new Set(seed.classes || []);
  const sync = () => { e.className = [...classes].join(' '); };
  sync();
  e.classList = {
    add: (...c) => { c.forEach((x) => classes.add(x)); sync(); },
    remove: (...c) => { c.forEach((x) => classes.delete(x)); sync(); },
    toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : Boolean(force); if (on) classes.add(c); else classes.delete(c); sync(); return on; },
    contains: (c) => classes.has(c),
  };
  let markup = '';
  Object.defineProperty(e, 'innerHTML', { get: () => markup, set: (v) => { markup = String(v); e.children = []; } });
  Object.defineProperty(e, 'parentElement', { get: () => makeElement() });
  return e;
}

function boot() {
  const elements = new Map();
  const byId = (id) => {
    if (!ids.has(id)) return null;
    if (!elements.has(id)) {
      const seeds = { 'tab-play': { classes: ['active'] }, 'platform-scene': { hidden: false }, 'legacy-adventure': { hidden: true } };
      elements.set(id, makeElement(id, seeds[id] || {}));
    }
    return elements.get(id);
  };
  const timers = [];
  const windowListeners = [];
  const errors = [];
  const me = {
    user: { id: 'guest_arena', name: 'ضيف' }, isNew: false, revision: 3, serverTime: Date.now(),
    state: { gold: 100, totalEarned: 5000, xp: 150, level: 2, clickPower: 1, passiveIncome: 0, energy: 1000, maxEnergy: 1000, owned: { click: 0, bot: 0, rig: 0 }, costs: { click: 50, bot: 200, rig: 1000 }, adventureUpgrades: { magnet: 0, cart: 0, speed: 0, shield: 0, heart: 0, clock: 0, luck: 0, skill: 0 }, boostUntil: 0, boostCooldownUntil: 0, lastSeen: Date.now(), adventure: { runs: 0, gems: 0, zones: 1 } },
    progress: { level: 2, xp: 150, current: 50, needed: 220 },
    missions: { day: '2026-10-16', resetsIn: 7200, items: [], bonus: { gold: 300, xp: 100, ready: false, claimed: false } },
    weeklyMissions: { week: '2026-W42', resetsIn: 259200, items: [], bonus: { gold: 1000, xp: 300, ready: false, claimed: false } },
    achievements: { total: 0, claimedCount: 0, items: [] },
    daily: { canClaim: true, streak: 1, reward: 500 }, offline: { seconds: 0, gold: 0 }, race: { races: 0, wins: 0, bestScore: 0 },
    referralCount: 0, referralEarnings: 0,
    // بلا تذكرة ساحة: المباراة تدريبية (لا مكافأة ولا عمليات) — وهي نفس مسار الواجهة بالضبط
    arena: { record: { wins: 0, losses: 0, draws: 0 } },
  };
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.startsWith('/api/me')) return { ok: true, status: 200, json: async () => me };
    if (u.startsWith('/api/ops')) return { ok: true, status: 200, json: async () => ({ ok: true, accepted: [], revision: 3, serverSeq: 0, state: me.state }) };
    // تذكرة جولة صالحة: تسمح باختبار حالة «جولة جارية» ومنطق التخلّي عنها
    if (u.startsWith('/api/platform/start')) return { ok: true, status: 200, json: async () => ({
      id: 'run-probe', version: require('../public/platform-rules').VERSION, seed: 4242,
      config: { zone: 0, goal: 0, mode: 'duel', loadout: { pickaxe: 0, boots: 0, bag: 0, magnet: 0, drill: 0, robot: 0, luck: 0, armor: 0 } },
      startedAt: Date.now(), expiresAt: Date.now() + 1800000,
    }) };
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  };
  const ctx = {
    console: { log: noop, info: noop, debug: noop, warn: noop, error: (...a) => errors.push(a.map(String).join(' ')) },
    document: {
      getElementById: byId, querySelector: () => null, querySelectorAll: () => [], createElement: () => makeElement(), createTextNode: (t) => ({ textContent: t }),
      addEventListener: noop, removeEventListener: noop, body: makeElement('body'), documentElement: makeElement('html'), hidden: false, visibilityState: 'visible',
    },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
    requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
    alert: noop, confirm: () => false, prompt: () => null,
    location: { search: '', href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', reload: noop },
    navigator: { userAgent: 'harness', vibrate: noop, clipboard: { writeText: async () => {} }, language: 'ar' },
    history: { replaceState: noop }, screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
    performance: { now: () => 0 }, URLSearchParams, URL, Date, Math, JSON, Number, String, Boolean, Array, Object, Promise, Set, Map, Error, TypeError, Symbol, Intl, parseInt, parseFloat, isFinite, isNaN, encodeURIComponent, decodeURIComponent, structuredClone,
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
  try {
    vm.runInContext(`${script}\n;globalThis.__arena = {
      start: () => startBattle(),
      act: (a) => arenaAction(a),
      move: (d) => moveArenaPlayer(d),
      tab: () => switchTab('arena'),
      state: () => ({ battle, inRange: arenaInSwordRange() }),
    };`, ctx, { filename: 'index.html' });
  } catch (e) { topLevelError = e; }
  const fireWindow = (type, event = {}) => { for (const [t, fn] of windowListeners) if (t === type) fn({ type, preventDefault: noop, target: { tagName: 'BODY' }, ...event }); };
  const runTimers = (guard = 40) => {
    let n = 0;
    while (timers.length && n++ < guard) {
      const batch = timers.splice(0);
      for (const fn of batch) { try { fn(); } catch (e) { errors.push(`timer: ${e.message}`); } }
    }
  };
  return { ctx, byId, errors, fireWindow, runTimers, topLevelError, arena: () => ctx.__arena };
}

test('arena UI: the screen starts idle with one clear call to action, not four dead buttons', async () => {
  const page = boot();
  assert.equal(page.topLevelError, null, page.topLevelError && page.topLevelError.message);
  await new Promise((r) => setTimeout(r, 0));
  page.runTimers();
  page.arena().tab();
  const tab = page.byId('tab-arena');
  assert.equal(tab.classList.contains('arena-idle'), true, 'idle mode hides the control pad');
  assert.equal(tab.classList.contains('arena-fighting'), false);
  assert.equal(page.byId('arena-start-btn').disabled, false, 'the start button is usable');
  assert.match(page.byId('arena-turn').innerText, /ابدأ المبارزة/);
  assert.equal(page.byId('arena-intent').hidden, true, 'no intent before a match');
});

test('arena UI: a real match — announce, approach, strike, enemy turn, then a verdict card', async () => {
  const page = boot();
  assert.equal(page.topLevelError, null, page.topLevelError && page.topLevelError.message);
  await new Promise((r) => setTimeout(r, 0));
  page.runTimers();
  page.arena().tab();

  page.arena().start();
  const battle = page.arena().state().battle;
  assert.equal(battle.active, true);
  assert.equal(page.byId('tab-arena').classList.contains('arena-fighting'), true);
  assert.equal(page.byId('tab-arena').classList.contains('arena-idle'), false);
  assert.equal(page.byId('arena-intent').hidden, false, 'the enemy plan is announced from round one');
  assert.match(page.byId('arena-intent').className, /arena-intent tone-/);
  assert.equal(page.byId('arena-start-btn').hidden, false); // مخفي بـ CSS في وضع القتال، لا بالخاصية
  assert.match(page.byId('arena-turn').innerText, /جولة 1/);

  // خارج المدى: زر الضرب معطّل، وبعد الاقتراب يصبح جاهزًا
  assert.equal(page.arena().state().inRange, false);
  assert.equal(page.byId('arena-btn-attack').disabled, true);
  for (let i = 0; i < 12; i += 1) page.arena().move(-1);
  assert.equal(page.arena().state().inRange, true, 'moving closes the distance to sword range');
  assert.equal(page.byId('arena-btn-attack').disabled, false);

  const enemyHpBefore = battle.enemy.hp;
  page.arena().act('ATTACK');
  assert.deepEqual(JSON.parse(JSON.stringify(battle.moves)), ['ATTACK']);
  assert.ok(battle.enemy.hp < enemyHpBefore, 'the strike lands on the enemy');
  assert.equal(battle.busy, true, 'the turn locks while the enemy answers');
  assert.equal(page.byId('arena-intent').hidden, true, 'the intent chip steps aside during the enemy turn');
  page.runTimers();
  assert.equal(battle.busy, false);
  assert.equal(battle.round, 2, 'the round advanced after the enemy answered');
  assert.equal(page.byId('arena-intent').hidden, false, 'the next plan is announced again');

  // الكيبورد: ٢ = دفاع
  page.fireWindow('keydown', { key: '2' });
  assert.equal(battle.moves[battle.moves.length - 1], 'DEFEND', 'the numeric shortcut fires a real move');
  page.runTimers();

  // إكمال المباراة بأي نتيجة: يجب أن تظهر بطاقة الحكم لا أن تبقى الشاشة صامتة
  for (let guard = 0; guard < 80 && battle.active; guard += 1) {
    if (page.arena().state().inRange && R.canAct(battle.player, 'ATTACK')) page.arena().act('ATTACK');
    else if (R.canAct(battle.player, 'HEAL') && battle.player.hp <= 40) page.arena().act('HEAL');
    else page.arena().act('WAIT');
    page.runTimers();
  }
  assert.equal(battle.active, false, 'the match reaches an end');
  assert.ok(['win', 'loss', 'draw'].includes(battle.outcome));
  assert.equal(page.byId('arena-verdict').hidden, false, 'the verdict card is shown over the stage');
  assert.match(page.byId('arena-verdict-title').textContent, /انتصار|هُزمت|تعادل/);
  assert.equal(page.byId('tab-arena').classList.contains('arena-idle'), true, 'the screen returns to idle controls');
  assert.equal(page.byId('arena-start-btn').disabled, false, 'a new match can start immediately');

  // إعادة البدء من بطاقة الحكم تُخفي الحكم وتُعيد النيّة
  page.byId('arena-verdict-again') && page.arena().start();
  assert.equal(page.byId('arena-verdict').hidden, true);
  assert.equal(page.arena().state().battle.active, true);
  assert.deepEqual(page.errors, [], 'no runtime errors during the whole flow');
});

test('arena UI: the action-duel launcher hands control to the movement engine', async () => {
  const page = boot();
  assert.equal(page.topLevelError, null, page.topLevelError && page.topLevelError.message);
  await new Promise((r) => setTimeout(r, 0));
  page.runTimers();
  page.arena().tab();
  const game = page.ctx.PlatformGame;
  assert.ok(game && typeof game.startDuel === 'function', 'the movement engine exposes startDuel');
  assert.equal(typeof game.mode, 'function');
  game.startDuel(0);
  assert.equal(game.mode(), 'duel', 'the engine switches to the duel mode');
  page.runTimers();
  const tab = page.byId('tab-play');
  assert.equal(tab.classList.contains('active'), true, 'the player lands on the real action stage');
  assert.equal(page.errors.length, 0, `no runtime errors: ${page.errors.join(' | ')}`);
});

test('arena UI: the live duel is the primary entry, the classic duel sits in a closed secondary section', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform.css'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  // المدخل الأساسي هو المبارزة الحيّة: زرها قبل قسم النظام الكلاسيكي في نفس الشاشة
  const duelBtn = html.indexOf('id="arena-duel-btn"');
  const classic = html.indexOf('id="classic-system"');
  assert.ok(duelBtn > 0 && classic > duelBtn, 'the action duel comes first, the classic section after it');
  assert.match(html, /<details id="classic-system"/, 'the classic turn battle is a collapsible section');
  assert.doesNotMatch(html.slice(classic, classic + 120), /\sopen\b/, 'and it starts closed — no scrolling by default');
  const body = html.slice(classic, html.indexOf('</details>', classic));
  for (const id of ['arena-battle-stage', 'arena-turn', 'arena-start-btn', 'arena-controls', 'arena-log']) {
    assert.ok(body.includes(`id="${id}"`), `${id} still lives inside «النظام الكلاسيكي» (data and mechanics preserved)`);
  }
  // زر المبارزة لا يفشل صامتًا: الرسالة تظهر على الساحة نفسها
  assert.match(html, /id="arena-live-banner"[^>]*aria-live="polite"/);
  // زر المبارزة لا يفشل صامتًا: تنبيه بحالة الجولة + إجراءان فعليان (متابعة أو تخلٍّ)
  assert.match(html, /function refreshArenaDuelState[\s\S]{0,1400}لديك جولة جارية في المنجم/, 'a blocked duel explains itself on the arena');
  assert.match(html, /id="arena-resume-btn"[^>]*onclick="resumeActiveRun\(\)"/);
  assert.match(html, /id="arena-abandon-btn"[^>]*onclick="abandonAndDuel\(\)"/);
  assert.match(html, /function abandonAndDuel\(\)[\s\S]{0,220}game\.abandon\(\)/, 'and it clears the stale run instead of trapping the player');
  assert.match(html, /id="arena-next-rival"/, 'the arena fills its space with the next rival and reward');
});

test('arena UI: abandoning a stale run is safe and never drops a result waiting for the server', async () => {
  const page = boot();
  assert.equal(page.topLevelError, null, page.topLevelError && page.topLevelError.message);
  await new Promise((r) => setTimeout(r, 0));
  page.runTimers();
  const game = page.ctx.PlatformGame;
  assert.equal(typeof game.abandon, 'function');
  assert.deepEqual(Object.keys(game.busy()).sort(), ['paused', 'pending', 'running', 'submitting']);
  // لا شيء جارٍ: التخلّي لا يفعل شيئًا (لا يمسّ جولة غير موجودة)
  assert.equal(game.abandon(), false);
  // جولة بدأت فعلاً: التخلّي يحرّر الحالة كي لا يبقى اللاعب محبوسًا
  assert.equal(game.startDuel(0), true, 'the duel starts');
  await new Promise((r) => setTimeout(r, 5));
  const busy = game.busy();
  assert.equal(busy.running, true, 'a run is genuinely in progress');
  assert.equal(busy.pending, false);
  // الشاشة الأولى (الغلاف) تختفي فور بدء المبارزة، ولو كان التبويب قد ظهر بعد لحظة من الأمر
  assert.equal(page.byId('platform-overlay').hidden, true, 'the start overlay is gone once the duel begins');
  assert.equal(game.abandon(), true, 'a live run can be dropped from the arena');
  assert.equal(game.busy().running, false, 'and the engine is free again');
  // وبعد التخلّي تبدأ مبارزة جديدة فورًا بدل البقاء محبوسًا
  assert.equal(game.startDuel(0), true);
  assert.equal(page.errors.length, 0, `no runtime errors: ${page.errors.join(' | ')}`);
});

test('controls: the on-screen stick is available on every screen size and can be hidden explicitly', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform.css'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  // كان مخفيًا فوق 768px فلا وسيلة حركة باللمس على شاشة عريضة (أو في معاينة سطح المكتب)
  const stickBase = /\.virtual-joystick\{([^}]*)\}/.exec(css)?.[1] || '';
  assert.match(stickBase, /display:block/, 'the stick renders on wide screens too');
  assert.doesNotMatch(css, /max-width:768px\)\{\.virtual-joystick\{display:none/, 'the old wide-screen hide rule is gone');
  assert.match(css, /\.mine-controls\.no-stick \.virtual-joystick\{display:none\}/, 'hiding is an explicit choice');
  assert.match(html, /id="ctl-stick"[^>]*aria-pressed="true"/, 'the settings panel offers the toggle, shown by default');
  assert.match(game, /stick: 'show'/, 'the default is stored with the other control settings');
  assert.match(game, /classList\.toggle\('no-stick'/, 'and it is applied to the pad');
  assert.match(html, /العصا على الشاشة للحركة/, 'the stage hint points at the stick, not the keyboard alone');
});
