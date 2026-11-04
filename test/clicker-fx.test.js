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

test('arcLift raises the middle medals on a shallow arc and keeps short rows flat', () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => +FX.arcLift(i, 4).toFixed(3)), [0.383, 0.924, 0.924, 0.383]);
  assert.deepEqual([0, 1, 2].map((i) => +FX.arcLift(i, 3).toFixed(3)), [0.5, 1, 0.5]);
  assert.equal(FX.arcLift(0, 2), 0);
  assert.equal(FX.arcLift(0, 1), 0);
  assert.ok(FX.arcLift(-4, 4) > 0 && FX.arcLift(99, 4) > 0, 'out-of-range indices clamp instead of going negative');
  assert.equal(Number.isFinite(FX.arcLift(NaN, NaN)), true, 'garbage never yields NaN');
});

test('nodeView: progress is gold ÷ price, ready only when affordable, garbage prices give null', () => {
  const v = { costs: { click: 50, bot: 200 }, owned: { click: 2 }, gold: 30 };
  assert.deepEqual(FX.nodeView('click', v), { key: 'click', cost: 50, owned: 2, progress: 0.6, affordable: false, missing: 20, state: 'poor' });
  assert.equal(FX.nodeView('click', { ...v, gold: 50 }).state, 'ready');
  assert.equal(FX.nodeView('click', { ...v, gold: 5000 }).progress, 1, 'the ring never overfills');
  assert.equal(FX.nodeView('bot', { ...v, gold: -3 }).progress, 0, 'a negative balance never shows negative progress');
  assert.equal(FX.nodeView('bot', v).owned, 0, 'a missing count reads as zero');
  assert.equal(FX.nodeView('rig', v), null, 'no price, no medal state');
  assert.equal(FX.nodeView('click', { costs: { click: 'x' } }), null);
  assert.equal(FX.nodeView('click', null), null);
});

test('sheetView projects the effect as base + owned × gain, the way UPGRADES.apply applies it', () => {
  const click = FX.sheetView({ base: 1, gain: 1, unit: 'لكل نقرة' }, 'click', { costs: { click: 50 }, owned: { click: 3 }, gold: 60 });
  assert.deepEqual(click, { key: 'click', cost: 50, owned: 3, progress: 1, affordable: true, missing: 0, state: 'ready', now: 4, next: 5, unit: 'لكل نقرة' });
  const bot = FX.sheetView({ base: 0, gain: 5, unit: 'ذهب/ثانية' }, 'bot', { costs: { bot: 200 }, owned: {}, gold: 0 });
  assert.deepEqual([bot.now, bot.next, bot.missing, bot.state], [0, 5, 200, 'poor']);
  assert.equal(FX.sheetView({}, 'x', { costs: {}, gold: 1 }), null);
  assert.equal(FX.sheetView(undefined, 'click', { costs: { click: 10 }, gold: 10 }).next, 0, 'a missing definition degrades to zeros');
});

test('hintTarget points at the first ready medal, and only until an upgrade window has been opened', () => {
  const views = [{ key: 'click', state: 'poor' }, { key: 'bot', state: 'ready' }, null, { key: 'rig', state: 'ready' }];
  assert.equal(FX.hintTarget(views, false), 'bot');
  assert.equal(FX.hintTarget(views, true), '');
  assert.equal(FX.hintTarget([{ key: 'a', state: 'poor' }], false), '');
  assert.equal(FX.hintTarget(undefined, false), '');
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

test('rock chips: four angular fragments in the stone palette', () => {
  const list = FX.makeParticles('rock', 100, 100, {}, FX.makeRng(5));
  assert.equal(list.length, 4);
  assert.ok(list.every((p) => p.shape === 'rock' && ['#e9d5ff', '#c4b5fd', '#a78bfa', '#d8c4a0'].includes(p.color)));
  assert.ok(list.every((p) => Number.isFinite(p.vx) && p.vy < 0 || Math.abs(p.vx) > 0), 'they fly out of the hit');
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
  // the new window/CTA cues are as safe as the old ones
  const quiet = FX.createSound(null, {});
  for (const cue of ['open', 'close', 'go']) assert.doesNotThrow(() => quiet[cue]());
  const none = FX.createSound(undefined, {});
  none.tap(1, true); none.denied(); none.frenzy(); none.levelUp(); none.boost(); none.buy(); none.milestone(3); none.unlock(); none.setMuted(true);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const s = FX.createSound(broken, audioHarness().scope);
  s.tap(1, false); s.setMuted(true); s.setMuted(false);
  assert.equal(s.muted, false);
});

// ============================== عقد «عرض فقط» ==============================
test('ClickerFX is display-only: no network, no ops queue, no economy state, only its own four cosmetic storage keys', () => {
  const code = fxSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'enqueueOp', 'SYNC', 'applyOpLocally', 'state.gold', 'state.energy', 'totalEarned', 'sendBeacon', 'WebSocket', '/api/', '.apply(', '.apply?.(']) {
    assert.ok(!code.includes(forbidden), `clicker-fx.js must not reference ${forbidden}`);
  }
  // it never calls an upgrade's apply(): buying goes through the page's buyUpgrade passed to init()
  assert.doesNotMatch(code, /\bapply\s*\(/);
  const keys = [...code.matchAll(/(?:getItem|setItem)\(\s*([A-Za-z_'"]+)/g)].map((m) => m[1].replace(/['"]/g, ''));
  assert.ok(keys.length >= 4 && keys.every((k) => ['MUTE_KEY', 'TAPPED_KEY', 'HINT_KEY', 'DIVE_SEEN_KEY'].includes(k)), `unexpected storage keys: ${keys}`);
  assert.deepEqual([...new Set(keys)].sort(), ['DIVE_SEEN_KEY', 'HINT_KEY', 'MUTE_KEY', 'TAPPED_KEY']);   // the fourth is only a "seen" flag for the deep-dive medal's badge
  assert.match(code, /const DIVE_SEEN_KEY = 'mining-fx-dive-seen'/);
  assert.match(code, /const MUTE_KEY = 'mining-fx-muted'/);
  assert.match(code, /const HINT_KEY = 'mining-fx-hint'/);
  // the page hands it the state; it only reads what the page passes to sync()/tap()
  assert.match(code, /function sync\(v\)/);
});

test('every public entry point is wrapped so a visual bug can never stop mining', () => {
  assert.match(fxSource, /const safe = \(fn\) => \(\.\.\.args\) => \{\s*try \{ return fn\(\.\.\.args\); \}/);
  for (const name of ['init', 'tap', 'denied', 'sync', 'onTab', 'openSheet', 'closeSheet', 'buyOpen']) assert.match(fxSource, new RegExp(`${name}: safe\\(${name === 'buyOpen' ? 'onSheetBuy' : name}\\)`));
});

// ============================== بنية index.html ==============================
test('index.html loads the stylesheets and the scripts (scripts first, so the page script can init them)', () => {
  assert.match(html, /<link rel="stylesheet" href="\/cave\.css\?v=\d+">/);
  assert.match(html, /<link rel="stylesheet" href="\/clicker\.css\?v=\d+">/);
  assert.ok(html.indexOf('/cave.css') < html.indexOf('/clicker.css'), 'the shared kit loads before the hub styles that build on it');
  const artAt = html.indexOf('<script src="/cave-art.js?v=');
  const scriptAt = html.indexOf('<script src="/clicker-fx.js?v=');
  assert.ok(artAt > 0 && scriptAt > artAt, 'cave-art.js is linked before clicker-fx.js (it builds the medallions)');
  const gameScript = html.indexOf('<script>\n', scriptAt);
  assert.ok(scriptAt < gameScript, 'both load before the inline game script');
  assert.match(html, /window\.ClickerFX\?\.init\(\{ fmt, haptic, buy: buyUpgrade, goals: UPGRADES, mine: goToMine, workshop: WS_RULES \? wsOpen : null, deepDive: deepDiveReady \? \(\) => window\.DeepDigUI\.open\(\) : null \}\);/);
  // الحفر العميق: أنماطه بعد مجموعة الكهف، وملفاته الأربعة بالترتيب قبل سكربت الصفحة، وتهيئته قبل ClickerFX (الميدالية لا تظهر إلا إن نجحت)
  assert.match(html, /<link rel="stylesheet" href="\/deep-dig\.css\?v=\d+">/);
  assert.ok(html.indexOf('/deep-dig.css') > html.indexOf('/cave.css'), 'the dive styles build on the shared kit');
  const dive = ['/deep-dig.js?v=', '/cave-sound.js?v=', '/deep-dig-render.js?v=', '/deep-dig-ui.js?v='].map((f) => html.indexOf(`<script src="${f}`));
  assert.ok(dive.every((i) => i > scriptAt) && dive.every((i, k) => k === 0 || i > dive[k - 1]), 'model, sound, renderer, then the UI that wires them');
  assert.ok(dive[3] < gameScript || gameScript > scriptAt, 'loaded before the inline game script');
  assert.ok(html.indexOf('window.DeepDigUI?.init(') > 0 && html.indexOf('window.DeepDigUI?.init(') < html.indexOf('window.ClickerFX?.init('), 'the dive initialises first so its medal can be offered to the hub');
  const init = html.indexOf('window.ClickerFX?.init(');
  assert.ok(init > html.indexOf('const UPGRADES = {') && init > html.indexOf('function buyUpgrade(') && init > html.indexOf('function goToMine('), 'init runs after the helpers it receives');
  // the cave scene layer exists and is the first thing in the body (it paints behind everything)
  assert.match(html, /<body[^>]*>\s*<!--[^>]*-->\s*<div class="ck-scene" aria-hidden="true"><\/div>/);
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

test('the cave art is real: scene, hero and ore sprite sheets and medal icons exist on disk, the drone symbol is in the sprite, upgrades carry their effect metadata', () => {
  const art = require('../public/cave-art');
  const dir = path.join(root, 'public', 'assets', 'cave');
  for (const f of ['cave-portrait.jpg', 'cave-wide.jpg', 'hero.webp', 'hero-sheet.webp', 'ore-sheet.webp']) {
    const st = fs.statSync(path.join(dir, f));
    assert.ok(st.size > 20_000 && st.size < 400_000, `${f} is a real, web-sized image (${st.size} bytes)`);
  }
  for (const id of art.PAINTED) {
    const st = fs.statSync(path.join(dir, 'icons', `${id}.webp`));
    assert.ok(st.size > 1000 && st.size < 30_000, `icon ${id} is small (${st.size} bytes)`);
  }
  const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  for (const id of ['i-flame', 'i-bolt', 'i-sound', 'i-muted', 'i-pickaxe', 'i-close', 'a-robot', 'a-coin']) assert.ok(symbols.has(id), `sprite has ${id}`);
  assert.ok(!symbols.has('a-luck'), 'the painted clover replaced the vector one');
  assert.ok(art.PAINTED.includes('robot') && art.PAINTED.includes('luck'), 'robot and clover medals are painted now');
  assert.equal(art.resolve('luck').kind, 'painted');
  // every medal the screens can ask for resolves to a painted file or a vector symbol that exists
  const rules = require('../public/platform-rules');
  for (const id of [...rules.EQUIPMENT_ORDER, 'click', 'bot', 'rig', 'workshop', 'deepdive']) {
    const r = art.resolve(id);
    assert.ok(r.kind === 'painted' || (r.kind === 'vector' && symbols.has(r.symbol)), `${id} has art (${r.kind})`);
  }
  // the workshop hero is a plain image; the hub's miner and rock are sprite sheets painted by the stylesheet
  assert.ok(html.includes('/assets/cave/hero.webp'), 'the workshop shows the idle miner');
  for (const f of ['/assets/cave/hero-sheet.webp', '/assets/cave/ore-sheet.webp']) assert.ok(css.includes(f), `${f} is painted by clicker.css`);
  assert.ok(!fs.existsSync(path.join(dir, 'ore.webp')), 'the single-frame ore image was replaced by the sheet');
  const goals = [...html.matchAll(/(click|bot|rig):\s+\{ apply: \(\) => \{ state\.(clickPower|passiveIncome) \+= (\d+); \},\s+growth: [\d.]+, name: '([^']+)',\s+desc: '([^']+)',\s+icon: '([^']+)',\s+base: (\d+), gain: (\d+),\s+unit: '([^']+)'/g)];
  assert.deepEqual(goals.map((m) => m[1]), ['click', 'bot', 'rig'], 'all three upgrades carry medal metadata');
  for (const [, key, , applied, name, desc, icon, , gain, unit] of goals) {
    assert.ok(symbols.has(icon), `${key} uses a sprite icon that exists (${icon})`);
    assert.equal(gain, applied, `${key}: the effect shown in the window (+${gain}) is what apply() adds (+${applied})`);
    assert.ok(html.includes(name) && desc.includes(gain) && unit, `${key} reads the same in the shop and in the window`);
  }
  assert.ok(html.includes('+1 لكل نقرة') && html.includes('+5 ذهب/ثانية') && html.includes('+25 ذهب/ثانية'));
});

test('the tap path keeps the sync accounting lines and hooks the effects around them', () => {
  const handle = html.slice(html.indexOf('function handleMine(e) {'), html.indexOf('function createFloatingText'));
  assert.match(handle, /SYNC\.clicks \+= 1;\s+if \(boostActive\(\)\) SYNC\.boostedClicks \+= 1;/);
  assert.match(handle, /const gain = clickGain\(\);/);
  // refused tap: error haptic, effects notified, nothing credited
  assert.match(handle, /if \(state\.energy < state\.clickPower\) \{ haptic\('error'\); window\.ClickerFX\?\.denied\(\{ x: cx, y: cy \}\); return false; \}/, 'a refusal is reported to the dig site as false');
  assert.match(handle, /window\.ClickerFX\?\.active\) window\.ClickerFX\.tap\(\{ x: cx, y: cy, gain, boosted: boostActive\(\) \}\);\s+else createFloatingText/);
  // the effects are called AFTER the economy changed and BEFORE updateUI/save, never instead of them
  assert.ok(handle.indexOf('SYNC.clicks += 1') < handle.indexOf('ClickerFX.tap('));
  assert.ok(handle.indexOf('ClickerFX.tap(') < handle.indexOf('updateUI();'));
  assert.ok(handle.indexOf('updateUI();') < handle.indexOf('save();'));
  // the dig site is told about direct touches only (its own swings damage the rock after they are accepted) and the result is a boolean
  assert.match(handle, /save\(\);[^]*if \(!e\.dig\) window\.DigSite\?\.onTap\?\.\(\{ x: cx, y: cy \}\);\s+return true;\s+\}\s*$/);
  assert.ok(handle.indexOf('save();') < handle.indexOf('DigSite?.onTap'), 'the rock reacts after the economy was settled');
  // pointer + keyboard wiring
  assert.match(html, /btn\.addEventListener\('pointerdown', \(e\) => \{\s+if \(e\.pointerType === 'mouse' && e\.button !== 0\) return;/);
  assert.match(html, /btn\.addEventListener\('keydown', \(e\) => \{\s+if \(\(e\.key === ' ' \|\| e\.key === 'Enter'\) && !e\.repeat\) \{ e\.preventDefault\(\); handleMine\(e\); \}/);
});

test('the boost button keeps its markup contract and shows its state through data-state, not through disabled styling', () => {
  assert.match(html, /id="boost-btn" onclick="activateBoost\(\)" type="button" class="ck-boost cv-btn cv-btn-violet" data-state="ready"/);
  assert.match(html, /getElementById\('boost-btn'\) \|\| \{\}/);
  assert.ok(!/disabled:opacity-40/.test(html.slice(html.indexOf('id="boost-btn"'), html.indexOf('id="boost-btn"') + 400)), 'no more dimmed-when-disabled utility on the active boost');
  assert.match(html, /setBoost\('active', 'تعزيز ×2 فعّال'/);
  assert.match(html, /setBoost\('cooldown', 'جاهز بعد'/);
  assert.match(html, /setBoost\('ready', 'تعزيز ×2', '0:30'\)/);
  // the shared metallic button greys out when disabled; the active/cooldown states opt out and look "on"/"charging" instead
  const cave = read('public', 'cave.css');
  assert.match(cave, /\.cv-btn:disabled \{ filter: grayscale\(\.55\) brightness\(\.82\)/);
  assert.match(css, /\.ck-boost\[data-state="active"\]:disabled \{[^}]*filter: none;/);
  assert.match(css, /\.ck-boost\[data-state="cooldown"\]:disabled \{[^}]*filter: none;/);
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
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(reduced.length > 100, 'a reduced-motion block exists');
  for (const sel of ['.ck-bob', '.ck-hero', '.ck-stick', '.ck-glow', '.ck-ambience', '.ck-boost::after', '#energy-bar::after', 'body.ck-cave .ck-scene', '.ck-sheet-card']) assert.ok(reduced.includes(sel), `${sel} is switched off`);
  assert.match(reduced, /animation: none !important/);
  // buttons attract attention with a light sweep inside them, never by scaling (Playwright/AT need a stable target)
  assert.doesNotMatch(css + read('public', 'cave.css'), /@keyframes ck-ready/);
  assert.match(read('public', 'cave.css'), /@keyframes cv-shine/);
  for (const [file, sel] of [[css, '.ck-boost'], [css, '.ck-go'], [css, '.ck-btn'], [css, '.ck-sound'], [css, '.ck-node'], [read('public', 'cave.css'), '.cv-btn']]) {
    const rule = file.match(new RegExp(`(?:^|\\n)${sel.replace(/[.\[\]]/g, '\\$&')} \\{[^}]*\\}`));
    assert.ok(rule, `${sel} rule`);
    assert.doesNotMatch(rule[0], /animation:/, `${sel} itself must not animate`);
  }
  // sizes adapt to the field they live in (container units) with a viewport fallback
  assert.match(css, /container-type: size/);
  assert.match(css, /@supports \(width: 1cqw\) \{\s*\.ck-area \{\s*--miner-h: min\(50cqh, 46cqw\);\s*--rock-w: min\(35cqw, 52cqh\);/);
  assert.match(css, /--miner-h: min\(46vw, 190px\)/);
  assert.match(css, /--rock-w: min\(40vw, 170px\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.match(css, /@media \(max-height: 640px\) \{[^}]*\.ck-hint \{ display: none; \}/);
  assert.match(css, /@media \(max-height: 700px\) \{\s*body\.ck-cave \.app-header \{ display: none; \}/);
  // decorative halos and shadows are clipped by the field so they never add a scrollbar to the tab
  assert.match(css.match(/\.ck-area \{[^}]*\}/)[0], /overflow: clip/);
  assert.doesNotMatch(css.match(/\.ck-area \{[^}]*\}/)[0], /overflow-clip-margin/, 'a clip margin would count as scrollable overflow');
  // overlays never catch touches
  for (const sel of ['.ck-fx, .ck-layer', '.ck-streak, .ck-status', '.ck-banner', '.ck-pointer', '.ck-spark', '.ck-scene']) assert.ok(css.includes(sel), sel);
  assert.ok((css.match(/pointer-events: none/g) || []).length >= 10);
  // the scene is its own layer behind the UI and only exists while the mining tab is open
  assert.match(css, /\.ck-scene \{\s*display: none;\s*position: fixed;\s*inset: 0;\s*z-index: -1;/);
  assert.match(css, /body\.ck-cave \.ck-scene \{ display: block;/);
});

test('wiring: build script syntax-checks the module, a dedicated browser test exists and CI runs it', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.build, /node --check public\/clicker-fx\.js/);
  assert.match(pkg.scripts.build, /node --check public\/cave-art\.js/);
  // the build also verifies that every image a stylesheet paints exists (a typo there fails silently in the browser)
  assert.match(read('scripts', 'check-build.cjs'), /Missing asset referenced by public\/\$\{file\}/);
  assert.equal(pkg.scripts['test:clicker'], 'node scripts/test-clicker-browser.cjs');
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'test-clicker-browser.cjs')));
  const ci = read('.github', 'workflows', 'ci.yml');
  // the E2E steps go through scripts/ci-run-e2e.sh, which turns a failure into annotations (see test/ci-run-e2e.test.js)
  assert.match(ci, /ci-run-e2e\.sh "Clicker E2E" test:clicker/);
  assert.ok(ci.indexOf('test:browser') < ci.indexOf('test:clicker'), 'it runs after the platform E2E, on the same server');
});

// ============================== cave-art.js (الميداليات المشتركة) ==============================
test('CaveArt resolves painted art, vector fallbacks and aliases, and builds medal markup that never trusts its input', () => {
  const art = require('../public/cave-art');
  assert.deepEqual([art.resolve('pickaxe').kind, art.resolve('click').key, art.resolve('rig').key, art.resolve('workshop').key], ['painted', 'pickaxe', 'drill', 'miner']);
  assert.deepEqual([art.resolve('robot').kind, art.resolve('robot').key, art.resolve('luck').kind, art.resolve('luck').key], ['painted', 'robot', 'painted', 'luck']);
  assert.deepEqual([art.resolve('deepdive').kind, art.resolve('deepdive').key], ['painted', 'dive'], 'the deep-dive medal shows the mine-lift cage');
  assert.ok(fs.existsSync(path.join(root, 'public', 'assets', 'cave', 'icons', 'dive.webp')));
  assert.match(art.resolve('robot').src, /^\/assets\/cave\/icons\/robot\.webp\?v=\d+$/);
  assert.deepEqual(Object.keys(art.VECTOR), [], 'every medal is painted; the vector table is only a hook for future art');
  assert.equal(art.resolve('bot').key, 'robot', 'the auto worker borrows the robot art');
  assert.equal(art.resolve('nonsense').kind, 'none');
  const painted = art.medalHTML({ id: 'boots', icon: 'i-boots', level: 3, progress: 0.456, state: 'ready' });
  assert.match(painted, /class="cv-medal" data-state="ready" style="--p:0\.456"/);
  assert.match(painted, /<svg class="ui-icon cv-fallback"[^>]*><use href="#i-boots"\/><\/svg><img class="cv-art" src="\/assets\/cave\/icons\/boots\.webp\?v=\d+"/, 'the line icon sits under the picture as a fallback');
  assert.match(painted, /<span class="cv-lvl">3<\/span>/);
  assert.doesNotMatch(painted, /loading="lazy"/, 'tiny icons load eagerly so the medals never flash empty when a screen opens');
  const robot = art.medalHTML({ id: 'robot', icon: 'i-robot', level: 1, progress: 1, state: 'max' });
  assert.match(robot, /<img class="cv-art" src="\/assets\/cave\/icons\/robot\.webp\?v=\d+"/);
  assert.match(robot, /<svg class="ui-icon cv-fallback"[^>]*><use href="#i-robot"\/><\/svg>/, 'the line icon stays underneath as a fallback');
  // garbage in: state falls back to poor, progress clamps, markup is escaped
  const rough = art.medalHTML({ id: 'x"><script>', icon: '"><b>', level: '<i>', progress: 7, state: 'boom' });
  assert.match(rough, /data-state="poor" style="--p:1\.000"/);
  assert.doesNotMatch(rough, /<script|<b>|<i>/, 'no markup injection through ids, icons or levels');
  assert.match(art.medalHTML({ id: 'bag', state: 'plain' }), /data-state="plain"/, 'the workshop medal has a ring-less state');
  assert.match(art.medalHTML({ id: 'bag', progress: -3 }), /--p:0\.000/);
  assert.doesNotMatch(art.medalHTML({ id: 'bag' }), /cv-lvl/, 'no badge without a level');
  // a broken image removes itself so the line icon underneath shows
  const listeners = [];
  art.guardImages({ addEventListener: (type, fn, capture) => listeners.push([type, fn, capture]) });
  assert.equal(listeners[0][0], 'error');
  assert.equal(listeners[0][2], true, 'captured: image errors do not bubble');
  let removed = 0;
  listeners[0][1]({ target: { tagName: 'IMG', classList: { contains: (c) => c === 'cv-art' }, remove: () => { removed++; } } });
  listeners[0][1]({ target: { tagName: 'IMG', classList: { contains: () => false }, remove: () => { removed++; } } });
  listeners[0][1]({ target: { tagName: 'DIV', classList: { contains: () => true }, remove: () => { removed++; } } });
  assert.equal(removed, 1, 'only failed medal art is removed');
});

test('the workshop and the hub share one medal builder: nodes keep their test hooks and gain painted art', () => {
  const wsRender = html.slice(html.indexOf('function wsMedal('), html.indexOf('function wsRenderTop()'));
  assert.match(wsRender, /window\.CaveArt/);
  assert.match(wsRender, /medalHTML\(\{ id, icon, level: lvl, progress, state: mstate \}\)/);
  assert.match(wsRender, /class="\$\{cls\}" type="button" data-ws-item="\$\{it\.id\}"/, 'data-ws-item and the ws-node/can-buy/is-max classes stay (E2E hooks)');
  assert.doesNotMatch(wsRender, /state: state\b/, 'the local medal state never shadows the game state');
  assert.match(html, /id="ws-hero" class="ws-hero-canvas" src="\/assets\/cave\/hero\.webp/);
  assert.match(html, /id="ws-drone"/);
  assert.match(html, /drone\.hidden = !\(WS_RULES && wsLevel\('robot'\) >= 1\)/, 'the drone shows once the robot is upgraded, like the old canvas companion');
  const ws = read('public', 'platform.css');
  assert.match(ws, /\.ws-node\{--sz:58px;/);
  assert.match(ws, /\.ws-cave\{[^}]*cave-portrait\.jpg/);
  assert.match(ws, /@media\(min-aspect-ratio:1\/1\)\{\.ws-cave\{[^}]*cave-wide\.jpg/);
});

test('cave art is cached for a week, which is only safe because every reference carries a version number', () => {
  assert.match(read('server.js'), /assets\$\{path\.sep\}cave\$\{path\.sep\}[^\n]*max-age=604800, immutable/);
  const sources = { 'index.html': html, 'clicker.css': css, 'platform.css': read('public', 'platform.css'), 'cave.css': read('public', 'cave.css'), 'cave-art.js': read('public', 'cave-art.js'), 'clicker-fx.js': fxSource, 'deep-dig-ui.js': read('public', 'deep-dig-ui.js') };
  let refs = 0;
  for (const [name, text] of Object.entries(sources)) {
    for (const m of text.matchAll(/\/assets\/cave\/[A-Za-z0-9_.\/-]*/g)) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 4);
      const directoryPrefix = m[0].endsWith('/'); // e.g. BASE = '/assets/cave/icons/' — the file name and ?v= are appended in code
      assert.ok(directoryPrefix || after.startsWith('?v='), `${name}: ${m[0]} must carry ?v=<n> (immutable cache), saw "${after}"`);
      refs++;
    }
  }
  assert.ok(refs >= 10, `found the art references (${refs})`);
  // the same number everywhere, so a bump is one search-and-replace
  const versions = new Set();
  for (const text of Object.values(sources)) for (const m of text.matchAll(/\/assets\/cave\/[A-Za-z0-9_.\/-]+\?v=(\d+)/g)) versions.add(m[1]);
  assert.ok(versions.size <= 1, `art version numbers disagree: ${[...versions]}`);
});

test('the HUD wrapper around the gold counter adds no box outside the cave (other screens keep their exact layout)', () => {
  assert.match(css, /\.ck-hud \{ display: contents; \}/, 'outside the cave the wrapper generates no box, so body gap and the platform rules that hide the strip behave as before');
  assert.match(css, /body\.ck-cave \.ck-hud \{ display: flex;/);
  assert.match(css, /body\.ck-cave \.ck-hud > \.balance-strip \{ flex: 1 1 auto;/, 'the strip only flexes inside the cave: a flex-grow on a body child would stretch it on every other tab');
  assert.doesNotMatch(css.replace(/body\.ck-cave \.ck-hud > \.balance-strip[^}]*\}/, ''), /\.ck-hud > \.balance-strip/);
  assert.match(html, /<div class="ck-hud">\s*<div class="balance-strip[^"]*">[\s\S]*?<button id="ck-sound"/, 'counter and sound toggle share the wrapper');
});

// ============================== طاقم المنجم والرفيق والمشي (عرض فقط) ==============================
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF'); assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const fmt = buf.toString('ascii', 12, 16);
  if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >>> 14) & 0x3fff) }; }
  throw new Error(`unknown WebP chunk ${fmt}`);
}

test('crewView: one robot per auto worker (max 5), one rig per mining rig (max 2), the rest as a +N badge; garbage is safe', () => {
  const none = { bots: 0, rigs: 0, moreBots: 0, moreRigs: 0, total: 0 };
  assert.deepEqual(FX.crewView({ bot: 0, rig: 0 }), none);
  assert.deepEqual(FX.crewView({ bot: 3, rig: 1 }), { bots: 3, rigs: 1, moreBots: 0, moreRigs: 0, total: 4 });
  assert.deepEqual(FX.crewView({ bot: 5, rig: 2 }), { bots: 5, rigs: 2, moreBots: 0, moreRigs: 0, total: 7 }, 'exactly full: no badge');
  assert.deepEqual(FX.crewView({ bot: 12, rig: 3 }), { bots: 5, rigs: 2, moreBots: 7, moreRigs: 1, total: 15 });
  assert.deepEqual(FX.crewView({ bot: 2.9, rig: 1.9 }), { bots: 2, rigs: 1, moreBots: 0, moreRigs: 0, total: 3 }, 'whole machines only');
  for (const junk of [null, undefined, {}, { bot: -4, rig: 'x' }, { bot: NaN, rig: Infinity * 0 }]) assert.deepEqual(FX.crewView(junk), none);
  assert.deepEqual({ ...FX.CREW_MAX }, { bot: 5, rig: 2 });
});

test('the crew is display-only art: markup, pointer-events, reduced motion, a fallback and a rig picture with the aspect the CSS reserves', () => {
  assert.match(html, /<div id="click-area" class="ck-area">\s*<!--[^>]*-->\s*<div id="ck-crew" class="ck-crew" aria-hidden="true" hidden><\/div>/, 'the lane is the first thing in the field, under the world layer');
  assert.match(html, /<span class="ck-dust"><i><\/i><i><\/i><\/span><span class="ck-companion"><svg viewBox="0 0 64 64" focusable="false"><use href="#a-robot"\/><\/svg><\/span><\/div>/, 'the miner carries the dust and the companion');
  assert.match(html, /robot: Math\.max\(0, Math\.floor\(Number\(state\.equipment && state\.equipment\.robot\) \|\| 0\)\)/, 'the page tells the hub the robot level (read only)');
  assert.match(css, /\.ck-crew \{[^}]*pointer-events: none;/, 'tapping the crew never mines');
  assert.match(css, /\.ck-crew\[hidden\] \{ display: none; \}/);
  const rm = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce) {\n  .ck-crew-bot'));
  for (const sel of ['.ck-crew-bot', '.ck-crew-rig', '.ck-companion', '.ck-dust i', '.ck-hero']) assert.ok(rm.split('}')[0].includes(sel), `${sel} stands still under reduced motion`);
  const file = path.join(root, 'public', 'assets', 'cave', 'crew', 'rig.webp');
  const size = webpSize(fs.readFileSync(file));
  const declared = css.match(/\.ck-crew-rig \{[^}]*aspect-ratio: (\d+) \/ (\d+);/);
  assert.ok(declared, 'the CSS declares the rig aspect ratio');
  assert.ok(Math.abs(size.w / size.h - Number(declared[1]) / Number(declared[2])) < 0.01, `rig.webp is ${size.w}x${size.h} but the CSS reserves ${declared[1]} / ${declared[2]}`);
  assert.ok(fs.statSync(file).size < 60_000, 'light enough to preload');
  assert.match(fxSource, /load\(RIG_ART, fail\('no-crew-art'\)\)/, 'a missing rig picture falls back to a plain steel block instead of an empty hole');
  assert.match(css, /\.ck-stage\.no-crew-art \.ck-crew-rig \{/);
});

test('the walk has weight: stride, a breathing shadow and dust are tied to walking (the old two-frame hop is gone) and dust trails behind either way he faces', () => {
  assert.match(css, /\.ck-miner\[data-act="walk"\] \.ck-hero \{ animation: ck-stride \.52s ease-in-out infinite; \}/);
  assert.match(css, /\.ck-miner\[data-act="walk"\]::before \{ animation: ck-footfall \.26s ease-in-out infinite; \}/);
  assert.match(css, /\.ck-miner\[data-act="walk"\] \.ck-dust i \{ animation: ck-puff \.52s ease-out infinite; \}/);
  assert.doesNotMatch(css, /ck-step/, 'the old hop is replaced');
  const stride = css.match(/@keyframes ck-stride \{([\s\S]*?)\n\}/)[1];
  assert.ok(stride.includes('rotate(-2.4deg)') && stride.includes('rotate(2.4deg)'), 'the lean alternates foot to foot');
  assert.match(css, /\.ck-miner\[data-face="-1"\] \.ck-dust i \{ --dx: 70%; \}/);
  assert.match(css, /\.ck-miner\[data-act="walk"\] \.ck-dust i:nth-child\(2\) \{ animation-delay: -\.26s; \}/, 'the second puff is half a stride behind (a specificity-safe override of the shorthand)');
});
