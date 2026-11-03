// الشاشة التفاعلية لتبويب التعدين (public/clicker-fx.js + clicker.css): نماذج عرض صافية تُختبر بلا DOM،
// وعقد «عرض فقط» (لا اقتصاد ولا عمليات خادمية)، وبنية index.html (المعرّفات والأيقونات والترتيب).
// الاختبار الحقيقي في Chromium: scripts/test-clicker-browser.cjs (npm run test:clicker).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const FX = require('../public/clicker-fx');
const html = read('public', 'index.html');
const css = read('public', 'clicker.css');
const fxSource = read('public', 'clicker-fx.js');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ============================== سلسلة النقرات والحرارة ==============================
test('streak counts taps inside the gap and restarts after a longer pause', () => {
  const h = FX.createHeat();
  assert.equal(h.tap(1000).streak, 1);
  assert.equal(h.tap(1300).streak, 2);
  assert.equal(h.tap(1999).streak, 3);
  assert.equal(h.tap(2699).streak, 4, 'a gap of exactly 700ms keeps the streak');
  assert.equal(h.tap(3400).streak, 1, '701ms restarts it');
  assert.equal(h.snapshot(3400 + 700).streak, 1);
  assert.equal(h.snapshot(3400 + 701).streak, 0, 'an idle streak reads as 0');
});

test('heat grows per tap, holds briefly, then decays linearly and never goes negative', () => {
  const h = FX.createHeat();
  let t = 1000;
  for (let i = 0; i < 10; i++, t += 100) h.tap(t);
  const last = t - 100;
  near(h.snapshot(last).heat, 0.45);
  near(h.snapshot(last + 450).heat, 0.45, 1e-9); // holdMs: no decay yet
  near(h.snapshot(last + 1450).heat, 0.45 - 0.45, 1e-9); // 1s after the hold: -0.45/s
  assert.equal(h.snapshot(last + 60_000).heat, 0, 'floors at zero');
  const h2 = FX.createHeat();
  for (let i = 0; i < 100; i++) h2.tap(1000 + i * 50);
  assert.equal(h2.snapshot(1000 + 99 * 50).heat, 1, 'caps at one');
});

test('frenzy starts exactly once at full heat and ends with hysteresis (not at 0.5)', () => {
  const h = FX.createHeat();
  const events = [];
  let r;
  for (let i = 0; i < 40; i++) { r = h.tap(1000 + i * 100); events.push(...r.events.filter((e) => e.startsWith('frenzy'))); }
  assert.deepEqual(events, ['frenzy:start'], 'one start event only');
  assert.equal(r.frenzy, true);
  const t = 1000 + 39 * 100;
  const mid = h.snapshot(t + 450 + 1000); // heat ≈ 0.55: still hot
  assert.equal(mid.frenzy, true);
  assert.deepEqual(mid.events, []);
  const end = h.snapshot(t + 450 + 1400); // heat ≈ 0.37 < 0.4: cooled off
  assert.equal(end.frenzy, false);
  assert.deepEqual(end.events, ['frenzy:end']);
  assert.deepEqual(h.snapshot(t + 450 + 1500).events, [], 'the end event fires once');
});

test('a tap after a long pause reports the missed frenzy end instead of resuming it silently', () => {
  const h = FX.createHeat();
  for (let i = 0; i < 30; i++) h.tap(1000 + i * 100);
  const r = h.tap(1000 + 30 * 100 + 10_000);
  assert.equal(r.frenzy, false);
  assert.ok(r.events.includes('frenzy:end'));
  assert.equal(r.streak, 1);
});

test('milestone events fire on every 10th tap of a streak', () => {
  const h = FX.createHeat();
  const hits = [];
  for (let i = 1; i <= 30; i++) if (h.tap(1000 + i * 100).events.includes('milestone')) hits.push(i);
  assert.deepEqual(hits, [10, 20, 30]);
  h.reset();
  assert.deepEqual(h.snapshot(5000), { streak: 0, heat: 0, frenzy: false, events: [] });
});

test('streak tiers escalate at 3, 10 and 25', () => {
  assert.deepEqual([0, 2, 3, 9, 10, 24, 25, 999].map(FX.streakTier), [0, 0, 1, 1, 2, 2, 3, 3]);
});

// ============================== الطاقة ==============================
test('energyView classifies full / ok / low / empty and reports taps left and wait time', () => {
  assert.deepEqual(FX.energyView(1000, 1000, 1), { pct: 1, level: 'full', taps: 1000, wait: 0 });
  assert.equal(FX.energyView(500, 1000, 1).level, 'ok');
  assert.equal(FX.energyView(199, 1000, 1).level, 'low');
  assert.equal(FX.energyView(200, 1000, 1).level, 'ok', '20% is the boundary');
  assert.deepEqual(FX.energyView(0.5, 1000, 1), { pct: 0.0005, level: 'empty', taps: 0, wait: 1 });
  assert.deepEqual(FX.energyView(0, 1000, 5), { pct: 0, level: 'empty', taps: 0, wait: 2 }, '5 energy at +3/s takes 2s');
  assert.equal(FX.energyView(4, 1000, 5).level, 'empty', 'less than one tap is empty even if above zero');
  assert.equal(FX.energyView(0, 100, 6, 2).wait, 3, 'the regen rate is a parameter');
  assert.equal(FX.energyView(45, 1000, 10).taps, 4);
});

test('energyView never throws or returns NaN on garbage', () => {
  for (const args of [[NaN, 0, 0], [-5, 100, 1], [undefined, undefined, undefined], ['x', 'y', 'z'], [Infinity, 100, 1], [10, 100, -3]]) {
    const v = FX.energyView(...args);
    assert.ok(Number.isFinite(v.pct) && v.pct >= 0 && v.pct <= 1 && Number.isFinite(v.taps) && Number.isFinite(v.wait), JSON.stringify([args, v]));
    assert.ok(['full', 'ok', 'low', 'empty'].includes(v.level));
  }
});

// ============================== التعزيز ==============================
test('boostView: ready, active (drains), cooldown (fills) with exact boundaries', () => {
  const now = 1_000_000;
  assert.deepEqual(FX.boostView(now, 0, 0), { state: 'ready', progress: 1, secs: 0 });
  assert.deepEqual(FX.boostView(now, now + 30_000, now + 300_000), { state: 'active', progress: 1, secs: 30 });
  assert.deepEqual(FX.boostView(now, now + 15_000, now + 285_000), { state: 'active', progress: 0.5, secs: 15 });
  assert.deepEqual(FX.boostView(now, now + 100, now + 270_100), { state: 'active', progress: 100 / 30_000, secs: 1 }, 'a partial second rounds up');
  assert.deepEqual(FX.boostView(now, now - 1, now + 150_000), { state: 'cooldown', progress: 0.5, secs: 150 });
  assert.deepEqual(FX.boostView(now, now, now), { state: 'ready', progress: 1, secs: 0 }, 'both timers expiring right now means ready');
  assert.equal(FX.boostView(now, now + 5, now + 5).state, 'active', 'active outranks the cooldown that contains it');
  const cd = FX.boostView(now, 0, now + 299_999);
  assert.ok(cd.state === 'cooldown' && cd.progress > 0 && cd.progress < 0.001);
});

// ============================== الهدف التالي ==============================
test('nextGoal picks the cheapest upgrade and reports progress, affordability and what is missing', () => {
  assert.deepEqual(FX.nextGoal({ click: 50, bot: 200, rig: 1000 }, 0), { key: 'click', cost: 50, progress: 0, affordable: false, missing: 50 });
  assert.deepEqual(FX.nextGoal({ click: 75, bot: 60, rig: 1000 }, 30), { key: 'bot', cost: 60, progress: 0.5, affordable: false, missing: 30 });
  assert.deepEqual(FX.nextGoal({ click: 75, bot: 60, rig: 1000 }, 61.5), { key: 'bot', cost: 60, progress: 1, affordable: true, missing: 0 });
  assert.equal(FX.nextGoal({ click: 100, bot: 100, rig: 100 }, 100).key, 'click', 'ties keep the list order');
  assert.equal(FX.nextGoal({ click: 100, bot: 100, rig: 90 }, 0, ['bot', 'click', 'rig']).key, 'rig');
  assert.equal(FX.nextGoal({ click: 10, bot: 20 }, 15, ['bot']).key, 'bot', 'a custom order limits the candidates');
  assert.equal(FX.nextGoal({ click: 50 }, -20).progress, 0, 'a negative balance never shows negative progress');
});

test('nextGoal ignores invalid prices and returns null when nothing is buyable', () => {
  assert.equal(FX.nextGoal({ click: NaN, bot: 'x', rig: 0 }, 10), null);
  assert.equal(FX.nextGoal(undefined, 5), null);
  assert.equal(FX.nextGoal({}, 5), null);
  assert.equal(FX.nextGoal({ click: -5, bot: 40 }, 1).key, 'bot');
});

// ============================== عدّاد الذهب ==============================
test('gold counter: small deltas show instantly, big jumps are followed smoothly and always land exactly', () => {
  assert.equal(FX.needsTween(0, 1234), true);
  assert.equal(FX.needsTween(1000, 1001), false, 'a tap');
  assert.equal(FX.needsTween(0, 29), false);
  assert.equal(FX.needsTween(0, 31), true);
  assert.equal(FX.needsTween(1e6, 1e6 + 10_000), false, 'passive income on a large balance is 1.5% or less');
  assert.equal(FX.needsTween(1e6, 1e6 + 20_000), true);
  for (const [from, to] of [[0, 1000], [1000, 0], [5000, 5150]]) {
    let v = from, prev = from;
    for (let i = 0; i < 600 && v !== to; i++) {
      v = FX.followValue(v, to, 0.016);
      assert.ok(from < to ? v >= prev && v <= to : v <= prev && v >= to, 'monotonic and never overshoots');
      prev = v;
    }
    assert.equal(v, to, `${from} → ${to} lands exactly`);
  }
  assert.equal(FX.followValue(10, 500, 0), 10, 'no time, no movement');
});

// ============================== إمالة القرص ==============================
test('tilt presses the touched side in and clamps outside the coin', () => {
  const rect = { left: 100, top: 200, width: 200, height: 200 };
  const t = (x, y, max = 15) => FX.tiltFor(x, y, rect, max);
  near(t(300, 300).ry, 15); near(t(300, 300).rx, 0);
  near(t(100, 300).ry, -15);
  near(t(200, 200).rx, 15);
  near(t(200, 400).rx, -15);
  near(t(250, 250).ry, 7.5); near(t(250, 250).rx, 7.5);
  near(t(5000, 300).ry, 15, 1e-9);
  near(t(200, 300).ry, 0); near(t(200, 300).rx, 0);
  assert.deepEqual([t(300, 300, 0).rx, t(300, 300, 0).ry].map(Math.abs), [0, 0], 'reduced motion passes max=0');
  const z = FX.tiltFor(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 15);
  assert.ok(Number.isFinite(z.rx) && Number.isFinite(z.ry));
  assert.ok(Number.isFinite(FX.tiltFor(NaN, undefined, null, 15).rx));
});

// ============================== الجسيمات ==============================
test('makeRng is deterministic and uniform enough for effects', () => {
  const a = FX.makeRng(7), b = FX.makeRng(7), c = FX.makeRng(8);
  const sa = Array.from({ length: 20 }, a), sb = Array.from({ length: 20 }, b), sc = Array.from({ length: 20 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
  const r = FX.makeRng(99);
  const mean = Array.from({ length: 5000 }, r).reduce((s, v) => s + v, 0) / 5000;
  assert.ok(mean > 0.47 && mean < 0.53, `mean ${mean}`);
});

test('burst sizes follow the kind and the boost/frenzy multipliers', () => {
  const n = (kind, o) => FX.makeParticles(kind, 0, 0, o, FX.makeRng(5)).filter((p) => p.shape !== 'shard').length;
  assert.equal(n('tap'), 6);
  assert.equal(n('tap', { boosted: true }), 9);
  assert.equal(n('tap', { hot: true }), 8);
  assert.equal(n('tap', { hot: true, boosted: true }), 13);
  assert.equal(n('milestone'), 16);
  assert.equal(n('frenzy'), 34);
  assert.equal(n('level'), 70);
  assert.equal(n('buy'), 18);
  assert.equal(n('nonsense'), 6, 'unknown kinds fall back to a tap burst');
  assert.equal(n('tap', { scale: 0 }), 1, 'never empty');
});

test('particles start at the touch point, fly upward, use the right palette and stay finite', () => {
  const list = [].concat(...Array.from({ length: 60 }, (_, i) => FX.makeParticles('tap', 100, 200, i % 2 ? { boosted: true } : {}, FX.makeRng(i + 1))));
  assert.ok(list.length >= 60 * 6);
  for (const p of list) {
    for (const k of ['x', 'y', 'vx', 'vy', 'g', 'ttl', 'size', 'rot', 'vr']) assert.ok(Number.isFinite(p[k]), `${k} finite`);
    assert.ok(Math.abs(p.x - 100) <= 4 && Math.abs(p.y - 200) <= 4, 'spawns on the tap');
    assert.ok(p.vy < 0, 'taps spray upward');
    const speed = Math.hypot(p.vx, p.vy);
    assert.ok(speed >= 129 && speed <= 361, `speed ${speed}`);
    assert.ok(p.ttl >= 0.42 && p.ttl <= 0.78 && p.age === 0);
    assert.ok(['spark', 'chip', 'dot', 'shard'].includes(p.shape));
    assert.match(p.color, /^#[0-9a-f]{6}$/);
  }
  assert.ok(list.some((p) => p.shape === 'shard'), 'a crystal shard appears now and then');
  const party = FX.makeParticles('level', 0, 0, { palette: 'party' }, FX.makeRng(3));
  assert.ok(new Set(party.map((p) => p.color)).size >= 4, 'confetti is multicoloured');
  const spread = FX.makeParticles('frenzy', 0, 0, {}, FX.makeRng(4));
  assert.ok(spread.some((p) => p.vy > 0) && spread.some((p) => p.vy < 0), 'a frenzy burst goes in every direction');
});

test('stepParticle applies gravity and drag, then expires', () => {
  const [p] = FX.makeParticles('tap', 0, 0, {}, FX.makeRng(11));
  const vy0 = p.vy, x0 = p.x, y0 = p.y;
  assert.equal(FX.stepParticle(p, 0.1), true);
  assert.ok(p.vy > vy0 - 1 && p.vy !== vy0, 'gravity pulls it back down');
  assert.ok(p.y !== y0 && p.x !== x0);
  assert.equal(p.age, 0.1);
  let alive = true, steps = 0;
  while (alive && steps < 100) { alive = FX.stepParticle(p, 0.05); steps++; }
  assert.equal(alive, false);
  assert.ok(steps <= Math.ceil(p.ttl / 0.05) + 1, 'it lives for its ttl and no longer');
});

// ============================== الصوت ==============================
function audioHarness({ withAudio = true } = {}) {
  const calls = { ctx: 0, osc: 0, resume: 0, suspend: 0 };
  class AC {
    constructor() { calls.ctx++; this.currentTime = 0; this.state = 'suspended'; this.destination = {}; }
    createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { calls.osc++; return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    resume() { this.state = 'running'; calls.resume++; }
    suspend() { this.state = 'suspended'; calls.suspend++; }
  }
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  return { calls, store, storage, scope: withAudio ? { AudioContext: AC } : {} };
}

test('sound: lazily creates the audio graph, rate-limits taps, and the mute choice persists', () => {
  const h = audioHarness();
  const s = FX.createSound(h.storage, h.scope);
  assert.equal(s.muted, false, 'on by default');
  assert.equal(h.calls.ctx, 0, 'nothing is created before the first use (autoplay policy)');
  s.tap(1, false);
  assert.equal(h.calls.ctx, 1);
  assert.ok(h.calls.osc >= 2);
  const osc = h.calls.osc;
  s.tap(2, false);
  assert.equal(h.calls.osc, osc, 'two taps within 40ms make one tick');
  s.setMuted(true);
  assert.equal(h.store.get('mining-fx-muted'), 'true');
  assert.equal(h.calls.suspend, 1);
  s.denied(); s.frenzy(); s.levelUp(); s.boost(); s.buy(); s.milestone(10);
  assert.equal(h.calls.osc, osc, 'a muted sound makes no oscillators at all');
  assert.equal(FX.createSound(h.storage, h.scope).muted, true, 'a new session reads the saved choice');
  s.setMuted(false);
  assert.equal(h.store.get('mining-fx-muted'), 'false');
  s.denied();
  assert.ok(h.calls.osc > osc, 'unmuting plays again');
});

test('sound never throws without WebAudio, without storage, or with a broken storage', () => {
  const none = FX.createSound(undefined, {});
  none.tap(1, true); none.denied(); none.frenzy(); none.levelUp(); none.boost(); none.buy(); none.milestone(3); none.unlock(); none.setMuted(true);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const s = FX.createSound(broken, audioHarness().scope);
  s.tap(1, false); s.setMuted(true); s.setMuted(false);
  assert.equal(s.muted, false);
});

// ============================== عقد «عرض فقط» ==============================
test('ClickerFX is display-only: no network, no ops queue, no economy state, only its own two storage keys', () => {
  const code = fxSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'enqueueOp', 'SYNC', 'applyOpLocally', 'state.gold', 'state.energy', 'totalEarned', 'sendBeacon', 'WebSocket', '/api/']) {
    assert.ok(!code.includes(forbidden), `clicker-fx.js must not reference ${forbidden}`);
  }
  const keys = [...code.matchAll(/(?:getItem|setItem)\(\s*([A-Za-z_'"]+)/g)].map((m) => m[1].replace(/['"]/g, ''));
  assert.ok(keys.length >= 4 && keys.every((k) => ['MUTE_KEY', 'TAPPED_KEY'].includes(k)), `unexpected storage keys: ${keys}`);
  assert.match(code, /const MUTE_KEY = 'mining-fx-muted'/);
  // the page hands it the state; it only reads what the page passes to sync()/tap()
  assert.match(code, /function sync\(v\)/);
});

test('every public entry point is wrapped so a visual bug can never stop mining', () => {
  assert.match(fxSource, /const safe = \(fn\) => \(\.\.\.args\) => \{\s*try \{ return fn\(\.\.\.args\); \}/);
  for (const name of ['init', 'tap', 'denied', 'sync', 'onTab']) assert.match(fxSource, new RegExp(`${name}: safe\\(${name}\\)`));
});

// ============================== بنية index.html ==============================
test('index.html loads the stylesheet and the script (script first, so the page script can init it)', () => {
  assert.match(html, /<link rel="stylesheet" href="\/clicker\.css\?v=\d+">/);
  const scriptAt = html.indexOf('<script src="/clicker-fx.js?v=');
  assert.ok(scriptAt > 0, 'clicker-fx.js is linked');
  const gameScript = html.indexOf('<script>\n', scriptAt);
  assert.ok(scriptAt < gameScript, 'it loads before the inline game script');
  assert.match(html, /window\.ClickerFX\?\.init\(\{ fmt, haptic, buy: buyUpgrade, goals: UPGRADES \}\);/);
  const init = html.indexOf('window.ClickerFX?.init(');
  assert.ok(init > html.indexOf('const UPGRADES = {') && init > html.indexOf('function buyUpgrade('), 'init runs after the helpers it receives');
});

test('every element clicker-fx.js looks up by id exists in the markup, and the classes it targets too', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = [...new Set([...fxSource.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(wanted.length >= 25, `expected the module to address many elements, saw ${wanted.length}`);
  const missing = wanted.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `ids missing from index.html: ${missing.join(', ')}`);
  assert.match(html, /<span class="ck-bob">/, 'the idle-bob wrapper is the coin parent');
  // the page script's own references to the new elements
  for (const id of ['xp-text', 'energy-track', 'energy-ghost', 'ck-regen', 'ck-live']) assert.ok(ids.has(id), `${id} exists`);
});

test('the mining screen, header, balance strip and energy bar contain no emoji (SVG icons only; the emoji font is missing on many devices)', () => {
  const grab = (startMarker, endMarker) => { const a = html.indexOf(startMarker); assert.ok(a >= 0, startMarker); const b = html.indexOf(endMarker, a); assert.ok(b > a, endMarker); return html.slice(a, b); };
  const blocks = {
    mining: grab('<main id="tab-mining"', '</main>'),
    header: grab('<header class="app-header', '</header>'),
    balance: grab('<div class="balance-strip', '<!-- TAB 0'),
    energy: grab('<div id="energy-container"', '<!-- Bottom Navigation Bar -->'),
  };
  blocks.balance = blocks.balance.replace(/<div id="sync-status"[^>]*>[^<]*<\/div>/, ''); // screen-reader-only line, never painted
  for (const [name, block] of Object.entries(blocks)) assert.equal(/\p{Extended_Pictographic}/u.test(block), false, `${name} block must not contain emoji`);
  // and the labels the script paints into them
  const updateUI = html.slice(html.indexOf('function updateUI() {'), html.indexOf('function haptic(type)'));
  const emoji = /\p{Extended_Pictographic}/u;
  assert.equal(emoji.test(updateUI.match(/const titles = \[[^\]]*\]/)[0]), false, 'level titles have no emoji');
  assert.equal(emoji.test(updateUI.match(/profitCounter\.innerText = [^\n]*/)[0]), false, 'the income chip has no rocket emoji');
  const boostBlock = updateUI.slice(updateUI.indexOf('const setBoost'), updateUI.indexOf('// إحصائيات الدعوات'));
  assert.ok(boostBlock.includes("setBoost('ready'"), 'sliced the boost block');
  assert.equal(emoji.test(boostBlock), false, 'the boost button labels have no emoji');
});

test('the gem and the icons it needs are real SVG: facets in the markup, symbols in the sprite', () => {
  assert.ok((html.match(/<polygon points="[^"]+" fill="url\(#ck-g-[a-f]\)"\/>/g) || []).length >= 7, 'a faceted gem');
  const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  for (const id of ['i-flame', 'i-bolt', 'i-coin', 'i-sound', 'i-muted', 'i-pickaxe']) assert.ok(symbols.has(id), `sprite has ${id}`);
  const goals = [...html.matchAll(/(click|bot|rig):\s+\{ apply:[^}]*\},\s+growth: [\d.]+, name: '([^']+)',\s+desc: '([^']+)',\s+icon: '([^']+)'/g)];
  assert.deepEqual(goals.map((m) => m[1]), ['click', 'bot', 'rig'], 'all three upgrades carry goal-card metadata');
  for (const [, key, , , icon] of goals) assert.ok(symbols.has(icon), `${key} uses a sprite icon that exists (${icon})`);
  // the shop tab says the same thing the goal card says
  for (const [, , name, desc] of goals) assert.ok(html.includes(name), `the shop shows "${name}"`);
  assert.ok(html.includes('+1 لكل نقرة') && html.includes('+5 ذهب/ثانية') && html.includes('+25 ذهب/ثانية'));
});

test('the tap path keeps the sync accounting lines and hooks the effects around them', () => {
  const handle = html.slice(html.indexOf('function handleMine(e) {'), html.indexOf('function createFloatingText'));
  assert.match(handle, /SYNC\.clicks \+= 1;\s+if \(boostActive\(\)\) SYNC\.boostedClicks \+= 1;/);
  assert.match(handle, /const gain = clickGain\(\);/);
  // refused tap: error haptic, effects notified, nothing credited
  assert.match(handle, /if \(state\.energy < state\.clickPower\) \{ haptic\('error'\); window\.ClickerFX\?\.denied\(\{ x: cx, y: cy \}\); return; \}/);
  assert.match(handle, /window\.ClickerFX\?\.active\) window\.ClickerFX\.tap\(\{ x: cx, y: cy, gain, boosted: boostActive\(\) \}\);\s+else createFloatingText/);
  // the effects are called AFTER the economy changed and BEFORE updateUI/save, never instead of them
  assert.ok(handle.indexOf('SYNC.clicks += 1') < handle.indexOf('ClickerFX.tap('));
  assert.ok(handle.indexOf('ClickerFX.tap(') < handle.indexOf('updateUI();'));
  assert.ok(handle.indexOf('updateUI();') < handle.indexOf('save();'));
  // pointer + keyboard wiring
  assert.match(html, /btn\.addEventListener\('pointerdown', \(e\) => \{\s+if \(e\.pointerType === 'mouse' && e\.button !== 0\) return;/);
  assert.match(html, /btn\.addEventListener\('keydown', \(e\) => \{\s+if \(\(e\.key === ' ' \|\| e\.key === 'Enter'\) && !e\.repeat\) \{ e\.preventDefault\(\); handleMine\(e\); \}/);
});

test('the boost button keeps its markup contract and shows its state through data-state, not through disabled styling', () => {
  assert.match(html, /id="boost-btn" onclick="activateBoost\(\)" type="button" class="ck-boost" data-state="ready"/);
  assert.match(html, /getElementById\('boost-btn'\) \|\| \{\}/);
  assert.ok(!/disabled:opacity-40/.test(html.slice(html.indexOf('id="boost-btn"'), html.indexOf('id="boost-btn"') + 400)), 'no more dimmed-when-disabled utility on the active boost');
  assert.match(html, /setBoost\('active', 'تعزيز ×2 فعّال'/);
  assert.match(html, /setBoost\('cooldown', 'جاهز بعد'/);
  assert.match(html, /setBoost\('ready', 'تعزيز ×2', '0:30'\)/);
  assert.match(css, /\.ck-boost\[data-state="active"\]:disabled \{[^}]*opacity: 1;[^}]*filter: none;/);
  assert.match(css, /\.ck-boost\[data-state="cooldown"\]:disabled \{[^}]*opacity: 1;[^}]*filter: none;/);
});

test('local passive income uses the boosted rate, matching the header chip and the server settlement', () => {
  assert.match(html, /const tick = passiveGain\(\) \/ 10;[^\n]*\n\s+state\.gold \+= tick;\s+state\.totalEarned \+= tick;/);
  assert.doesNotMatch(html, /state\.gold \+= state\.passiveIncome \/ 10/);
  const server = read('server.js');
  assert.match(server, /const gain = s\.passiveIncome \* \(effectiveSec \+ boostedSec\)/, 'the server pays the boosted window double');
});

test('haptics: the page passes richer feedback types through to Telegram and falls back to vibration', () => {
  const fn = html.slice(html.indexOf('const HAPTIC_VIBRATE'), html.indexOf('// --- Mining Click Action'));
  assert.match(fn, /notificationOccurred\(type\)/);
  assert.match(fn, /\['light', 'medium', 'heavy', 'rigid', 'soft'\]\.includes\(type\)/);
  assert.match(fn, /navigator\.vibrate\(HAPTIC_VIBRATE\[type\] \?\? 10\)/);
  for (const key of ['light', 'medium', 'heavy', 'success', 'error', 'warning']) assert.match(fn, new RegExp(`${key}:`));
});

test('the page keeps the legacy fallbacks: no ClickerFX means the old floating text and a direct gold counter', () => {
  assert.match(html, /if \(!window\.ClickerFX\?\.active\) goldCounter\.innerText = fmt\(state\.gold\);/);
  assert.match(html, /else createFloatingText\(`\+\$\{gain\}`, cx - rect\.left, cy - rect\.top\);/);
  assert.match(html, /window\.ClickerFX\?\.sync\(\{/);
  assert.match(html, /window\.ClickerFX\?\.onTab\?\.\(tabId\);/);
});

// ============================== clicker.css ==============================
test('clicker.css honours reduced motion, never animates the size of a tap target, and fits short screens', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduced.length > 100, 'a reduced-motion block exists');
  for (const sel of ['.ck-bob', '.ck-rim', '.ck-aura', '.ck-twinkle', '.ck-boost::after', '#energy-bar::after']) assert.ok(reduced.includes(sel), `${sel} is switched off`);
  assert.match(reduced, /animation: none !important/);
  // buttons attract attention with a light sweep inside them, never by scaling (Playwright/AT need a stable target)
  assert.doesNotMatch(css, /@keyframes ck-ready/);
  assert.match(css, /@keyframes ck-shine/);
  for (const sel of ['.ck-boost', '.ck-goal-buy', '.ck-btn', '.ck-sound']) {
    const rule = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.\[\]]/g, '\\$&')} \\{[^}]*\\}`));
    assert.ok(rule, `${sel} rule`);
    assert.doesNotMatch(rule[0], /animation:/, `${sel} itself must not animate`);
  }
  // sizes adapt to the viewport
  assert.match(css, /--ck-size: clamp\(150px, min\(62vw, calc\(var\(--app-height, 100vh\) - 500px\)\), 264px\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.match(css, /@media \(max-height: 610px\) \{[^}]*\.ck-hint \{ display: none; \}/);
  // glow via box-shadow: it must not enlarge the scrollable area
  assert.match(css, /\.ck-aura \{[^}]*box-shadow:/);
  assert.doesNotMatch(css.match(/\.ck-aura \{[^}]*\}/)[0], /width: 1[1-9]\d%/);
  // overlays never catch touches
  for (const sel of ['.ck-fx, .ck-layer', '.ck-streak, .ck-status', '.ck-banner', '.ck-heat']) assert.ok(css.includes(sel), sel);
  assert.ok((css.match(/pointer-events: none/g) || []).length >= 8);
});

test('wiring: build script syntax-checks the module, a dedicated browser test exists and CI runs it', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.build, /node --check public\/clicker-fx\.js/);
  assert.equal(pkg.scripts['test:clicker'], 'node scripts/test-clicker-browser.cjs');
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'test-clicker-browser.cjs')));
  const ci = read('.github', 'workflows', 'ci.yml');
  assert.match(ci, /npm run test:clicker/);
  assert.ok(ci.indexOf('npm run test:browser') < ci.indexOf('npm run test:clicker'), 'it runs after the platform E2E, on the same server');
});
