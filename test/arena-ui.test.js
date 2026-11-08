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

test('arena UI: «ابدأ المبارزة» starts the fight inside the arena tab — it never jumps to the play tab', async () => {
  const page = boot();
  assert.equal(page.topLevelError, null, page.topLevelError && page.topLevelError.message);
  await new Promise((r) => setTimeout(r, 0));
  page.runTimers();
  page.arena().tab();
  // المحاكي لا يملك querySelectorAll، فنُطفئ تبويب اللعب يدويًا: التبديل الحقيقي وحده يعيده
  page.byId('tab-play').classList.remove('active');
  const game = page.ctx.PlatformGame;
  assert.ok(game && typeof game.startDuel === 'function', 'the movement engine exposes startDuel');
  assert.ok(typeof game.startArenaRun === 'function', 'and the arena duel runs on its own controller');
  assert.equal(page.byId('tab-arena').classList.contains('active'), true, 'we are on the arena tab');

  page.ctx.startArenaDuel(0);
  await new Promise((r) => setTimeout(r, 5));
  page.runTimers();

  // 1) بقينا في تبويب الساحة ولم نُنتقل إلى اللعب
  assert.equal(page.byId('tab-arena').classList.contains('active'), true, 'still on the arena tab');
  assert.equal(page.byId('tab-play').classList.contains('active'), false, 'the play tab was never activated');
  // 2) المبارزة بدأت فعلًا بنفس المحرك
  const duel = game.duelBusy();
  assert.equal(duel.running, true, 'the duel is running');
  assert.equal(duel.status, 'playing', 'with a live simulation');
  assert.equal(duel.zone, 0);
  // 3) حالة تبويب اللعب لم تُمسّ
  assert.equal(game.busy().running, false, 'the mining run state is untouched');
  // 4) التحكم داخل الساحة ظاهر
  assert.equal(page.byId('arena-pad').hidden, false, 'the arena combat pad is shown');
  assert.equal(page.ctx.document.body.classList.contains('duel-live'), true, 'the stage switches to fight layout');

  // 5) الحركة والهجوم يعملان على المحاكاة نفسها
  const start = game.duelAdvance(0, 1);
  const moved = game.duelAdvance(2, 24); // RIGHT
  assert.ok(moved.x > start.x, `the fighter moves right (${start.x} → ${moved.x})`);
  assert.ok(moved.inputs > 0, 'inputs are recorded for the server replay');
  assert.equal(page.errors.length, 0, `no runtime errors: ${page.errors.join(' | ')}`);
});

test('arena UI: a finished arena duel leaves the play tab exactly as it was', async () => {
  const page = boot();
  await new Promise((r) => setTimeout(r, 0));
  page.runTimers();
  page.arena().tab();
  page.byId('tab-play').classList.remove('active');
  const game = page.ctx.PlatformGame;
  page.ctx.startArenaDuel(0);
  await new Promise((r) => setTimeout(r, 5));
  page.runTimers();
  assert.equal(game.duelBusy().running, true);
  // التخلّي عن مبارزة الساحة لا يمسّ أي جولة منجم ولا يترك حالة معلّقة
  assert.equal(game.duelAbandon(), true, 'a live arena duel can be dropped');
  assert.equal(game.duelBusy().running, false, 'and it stops');
  assert.equal(game.busy().running, false, 'the mining state stays idle');
  assert.equal(page.byId('tab-play').classList.contains('active'), false, 'still on the arena tab');
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
  assert.match(html, /function refreshArenaDuelState[\s\S]{0,1600}جولة منجمك محفوظة كما هي/, 'a running mine run is explained without demanding a tab change');
  assert.doesNotMatch(html, /تابع جولتك/, 'the arena no longer pushes the player to the play tab');
  assert.match(html, /id="arena-resume-btn"[^>]*onclick="resumeActiveRun\(\)"/);
  assert.match(html, /id="arena-abandon-btn"[^>]*onclick="abandonAndDuel\(\)"/);
  assert.match(html, /function abandonAndDuel\(\)[\s\S]{0,220}game\.abandon\(\)/, 'and it clears the stale run instead of trapping the player');
  // المسرح الحيّ + سلّم المبارزين: مشهد لعب فعلي بدل مستطيل فارغ
  assert.match(html, /<canvas id="arena-preview"/, 'the arena renders the real engine scene');
  assert.match(html, /id="arena-ladder"[^>]*role="list"/, 'and a rival ladder fills the rest of the screen');
  // الصف المفتوح يختار خصمه، والمقفل يشرح شرطه فقط (ولا يحوّل زر البدء إلى زر صامت)
  assert.match(html, /row\.onclick = status\.unlocked \? \(\) => pickRival\(zone\) : \(\) => explainLockedRival\(status\)/);
  assert.match(html, /function refreshArenaCta[\s\S]{0,600}btn\.disabled = locked/, 'the start button reflects a locked pick instead of doing nothing');
  assert.match(html, /id="arena-duel-btn"[\s\S]{0,300}<\/button>\s*<span id="arena-record"/, 'the start button and record sit below the stage, not over the scene');
  assert.match(html, /function pickRival[\s\S]{0,200}renderArenaLadder\(\)/, 'picking a rival re-renders the stage');
  assert.match(html, /showArenaPreview\?\.\(arenaSelectedZone\)/, 'and the live stage follows the selection');
  assert.match(html, /duelReward\?\./, 'the reward shown comes from the rules, not a hardcoded number');
});

test('arena UI: abandoning a stale mining run is safe and never drops a result waiting for the server', async () => {
  const page = boot();
  assert.equal(page.topLevelError, null, page.topLevelError && page.topLevelError.message);
  await new Promise((r) => setTimeout(r, 0));
  page.runTimers();
  const game = page.ctx.PlatformGame;
  assert.equal(typeof game.abandon, 'function');
  assert.deepEqual(Object.keys(game.busy()).sort(), ['paused', 'pending', 'running', 'submitting']);
  // لا شيء جارٍ: التخلّي لا يفعل شيئًا (لا يمسّ جولة غير موجودة)
  assert.equal(game.abandon(), false);
  // مبارزة الساحة لا تُنشئ جولة منجم: حالة اللعب تبقى حرة بعدها
  page.arena().tab();
  page.ctx.startArenaDuel(0);
  await new Promise((r) => setTimeout(r, 5));
  page.runTimers();
  assert.equal(game.duelBusy().running, true, 'the arena duel is the one running');
  assert.equal(game.busy().running, false, 'no mining run was created by the duel');
  assert.equal(game.abandon(), false, 'and abandoning a mining run is still a no-op');
  assert.equal(game.duelAbandon(), true, 'the arena duel is the one that can be dropped');
  assert.equal(page.errors.length, 0, `no runtime errors: ${page.errors.join(' | ')}`);
});

test('controls: touch buttons follow the device — shown on phones/tablets, hidden on desktop, with a manual override', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform.css'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  // الجهاز الخشن (لمس) يُظهر اللوحة، والمؤشر الدقيق (كمبيوتر) يُخفيها تلقائيًا
  assert.match(game, /touchPad: 'auto'/, 'the default follows the device');
  assert.match(game, /matchMedia\('\(pointer: coarse\)'\)/, 'coarse pointers (phones/tablets) are detected');
  assert.match(game, /maxTouchPoints/, 'and touch-only devices are detected even without media queries');
  assert.match(game, /const TOUCH_ORDER = \['auto', 'show', 'hide'\]/, 'the manual override is three-state');
  assert.match(css, /\.mine-controls\.touch-hidden \.virtual-joystick\{display:none\}/);
  assert.match(css, /\.mine-controls\.touch-hidden \.action-btn:not\(\.pause-btn\)\{display:none\}/, 'the pause button stays reachable on desktop');
  // ولا قاعدة قديمة تُخفي العصا على الشاشات العريضة
  assert.doesNotMatch(css, /max-width:768px\)\{\.virtual-joystick\{display:none/);
  assert.match(html, /id="ctl-stick"[^>]*aria-pressed="true"/, 'the settings panel exposes the override');
  assert.match(html, /id="platform-keyhint"[^>]*hidden/, 'desktop gets a keyboard hint instead of the pad');
  assert.match(html, /العصا على الشاشة للحركة/, 'the stage hint still mentions the stick for touch devices');
});

test('boot: opening the app never starts a run or spends anything (no auto-play)', async () => {
  const page = boot();
  assert.equal(page.topLevelError, null, page.topLevelError && page.topLevelError.message);
  await new Promise((r) => setTimeout(r, 5));
  page.runTimers();
  const game = page.ctx.PlatformGame;
  assert.equal(game.busy().running, false, 'no run starts on boot');
  assert.equal(game.busy().pending, false, 'and nothing is submitted on boot');
  // المسرح الاستعراضي في الساحة هو الوحيد الذي يتحرك تلقائيًا
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  assert.match(src, /function arenaFrame/, 'the arena preview has its own loop');
  assert.doesNotMatch(src, /function startArenaPreviewTab|autoStart/, 'there is no auto-start path');
});

test('arena preview: the demo shows the real moveset — jump, guard and dodge — not just walking', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  assert.match(game, /rival\.attack === 'pound'\) mask \|= R\.INPUT\.JUMP/, 'jumps the unblockable ground slam');
  assert.match(game, /rival\.attack === 'sweep'\) mask \|= R\.INPUT\.DEFEND/, 'guards the blockable sweep');
  assert.match(game, /rival\.attack === 'charge'[\s\S]{0,80}R\.INPUT\.DODGE/, 'dodges the charge');
});

test('a duel ends with a duel summary: rival HP, hearts and blocks — not rocks, gems or the fork', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  assert.match(game, /const duelRun = mode === 'duel'/, 'the summary branches on the run mode');
  assert.match(game, /titleEl\.textContent = duelRun \? 'ملخص المبارزة'/, 'the card is titled as a duel summary');
  assert.match(game, /summaryRow\('صحة الخصم'/, 'rival HP is the first real row');
  assert.match(game, /summaryRow\('قلوبك'/, 'hearts left are shown');
  assert.match(game, /summaryRow\('صدّات ناجحة'/, 'successful guards are shown');
  assert.match(game, /badge\.textContent = won \? 'انتصار' : 'خسارة'/, 'the badge reads win/loss');
  // لا تظهر صفوف التعدين عند المبارزة: فرع المبارزة يُعيد البطاقة قبل الوصول إليها
  const duelBlockStart = game.indexOf('if (duelRun) {');
  const firstMiningRow = game.indexOf("summaryRow('المفترق'");
  assert.ok(duelBlockStart > 0 && firstMiningRow > duelBlockStart, 'the duel branch comes before every mining row');
  const duelBlock = game.slice(duelBlockStart, game.indexOf('if (badge && gs)', duelBlockStart));
  assert.match(duelBlock, /return;\n\s*}/, 'and returns before the mining rows are built');
});

test('finishing a duel speaks about the duel — its own title, lead and button label', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  assert.match(game, /'انتصرت في المبارزة!'/, 'a win is announced as a duel win');
  assert.match(game, /'سقطت في المبارزة'/, 'a loss is announced as a duel loss');
  assert.match(game, /el\('platform-start'\)\.textContent = 'مبارزة أخرى'/, 'the button offers another duel');
  assert.match(game, /const duelReceipt = result\.mode === 'duel'/, 'the server receipt is read in duel terms too');
  assert.match(game, /قلوب متبقية · \$\{result\.duel\?\.blocks/, 'the confirmed line reports hearts and guards');
});

test('arena fight HUD: hearts, a trailing damage bar and a live combo popup', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  assert.match(html, /<i class="as-hp"><s id="arena-ghost-hero"><\/s><b id="arena-hp-hero">/, 'the hero bar has a trailing ghost layer');
  assert.match(html, /<i class="as-hp rival"><s id="arena-ghost-rival"><\/s><b id="arena-hp-rival">/, 'and so does the rival bar');
  assert.match(html, /\.as-hp s \{[^}]*transition: width \.6s/, 'the ghost lags behind so the hit reads');
  assert.match(html, /id="arena-hearts-hero"/, 'the fighter hearts are shown on the stage');
  assert.match(game, /ghostHero\.style\.width = `\$\{heroPct\}%`/, 'the ghost bar follows the same value');
  // القلوب عناصر حقيقية تُبنى من المحاكاة (نقاط مصغّرة في الطابق C، لا نص ♥)
  assert.match(game, /function duelHeartsPips\(box, hearts, max\)[\s\S]{0,220}?createElement\('span'\)[\s\S]{0,120}?classList\.add\('on'\)/, 'hearts are real elements driven by player.hearts');
  assert.match(game, /duelHeartsPips\(heartsBox, p\.hearts, max\)/, 'the pips read the simulation hearts');
  assert.match(game, /text: `×\$\{combo\}/, 'the combo is announced on the fighter');
});

test('a landing hit freezes the frame briefly and the verdict banner marks the finish', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  assert.match(game, /if \(duelFreeze > 0\) \{[\s\S]{0,400}?duelFreeze--; duelAcc -= R\.DT; continue;/, 'hit-stop skips simulation frames without shifting the clock');
  assert.match(game, /duelFreeze = Math\.max\(duelFreeze, ev\.damage >= 2 \? 4 : 2\)/, 'heavier hits freeze longer');
  assert.match(game, /function duelVerdict\(won, rival\)/, 'a verdict banner is drawn on the stage');
  assert.match(game, /title\.textContent = won \? 'انتصار' : 'سقوط'/, 'it says win or loss');
  assert.match(game, /duelVerdictHide\(\);[\s\S]{0,120}duelStatusLine/, 'and it is cleared when the fight ends');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="arena-ko"[^>]*aria-live="assertive"/, 'the banner is announced to screen readers');
  assert.match(html, /\.arena-ko\.loss b/, 'and turns red on a loss');
});

test('the arena stage shows real combat feedback: hit sparks, damage numbers and impact shake', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  assert.match(game, /function arenaFx\(\)/, 'there is an effects pass over the simulation events');
  assert.match(game, /arenaFloaters\.push\(\{[^}]*text: strong \? `-\$\{ev\.damage\}`/, 'landed hits print their damage');
  assert.match(game, /color: strong \? \(i % 2 \? '#ffd166' : '#fff3c9'\)/, 'hits throw warm sparks');
  assert.match(game, /'صدّ'/, 'a blocked hit reports a block instead of damage');
  assert.match(game, /arenaShake = Math\.max\(arenaShake, 0\.7\)/, 'taking a hit shakes the stage');
  assert.match(game, /particles: arenaParticles, floaters: arenaFloaters, shake: arenaShake/, 'effects reach the renderer');
  assert.match(game, /arenaTick2\(\);\n\s*arenaDraw\(\);/, 'they are advanced before every drawn frame');
});

test('arena stage HUD: both fighters get equal-width health bars and untruncated names', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const css = html.match(/\.as-fighter \{[^}]*\}/);
  assert.ok(css, 'the fighter wrapper has a CSS rule');
  assert.match(css[0], /flex: 1 1 0/, 'both fighters share one flex basis so the two bars match in width');
  assert.doesNotMatch(css[0], /max-width: 44%/, 'the old nested max-width that squeezed the names is gone');
  const chip = html.match(/\.as-chip \{[^}]*\}/);
  assert.match(chip[0], /max-width: 100%/, 'names are no longer clipped to 42% of a 44% box');
});

test('duel HUD: the rival gets an in-scene health bar during a duel, and it is absent from mining runs', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform.css'), 'utf8');
  assert.match(html, /id="stage-foe"[^>]*hidden/, 'the bar exists and starts hidden');
  assert.match(html, /id="stage-foe-name"/);
  assert.match(html, /id="stage-foe-fill"/);
  // يُقرأ من المحاكاة نفسها، ويظهر في وضع المبارزة فقط
  assert.match(game, /const foe = sim\.mode === 'duel' \? \(sim\.enemies\.find\(\(e\) => e\.type === 'rival'\)/, 'the bar reads the real rival');
  assert.match(game, /fill\.style\.width = `\$\{Math\.max\(0, Math\.min\(100, \(foe\.hp \/ Math\.max\(1, foe\.maxHp\)\) \* 100\)\)\}%`/, 'width follows rival hp');
  assert.match(css, /\.stage-foe\{position:absolute;top:8px/, 'it floats over the scene, not in the HUD row');
  assert.match(css, /\.stage-foe\[hidden\]\{display:none\}/);
  // في المبارزة لا تُعرض عدّادات التعدين المضلّلة (جوهرة = صحة الخصم كانت خطأ UX)
  assert.match(game, /classList\?\.toggle\('duel-hud', sim\.mode === 'duel'\)/);
  assert.match(css, /\.mine-hud\.duel-hud #platform-resources\{display:none\}/);
  assert.doesNotMatch(game, /rivalName \?\? 'مبارزة'/, 'the rival name/hp is not duplicated in the text line');
});
