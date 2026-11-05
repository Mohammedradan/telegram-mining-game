// موقع الحفر (public/dig-site.js): المعدّن يمشي بعصا التحكم ويحفر الصخرة.
// النماذج الصافية تُختبر بلا DOM؛ المتحكم يُختبر على DOM وهمي صغير بخطوات زمنية حتمية (debug.step) وبالحلقة الحقيقية (rAF).
// القاعدة التي تحرسها هذه الاختبارات: الملف عرضٌ وحركة فقط — كل ضربة تصيب الصخرة تمرّ عبر opts.swing (= handleMine في الصفحة)
// ولا شيء غيره يلمس الذهب أو الطاقة أو الخادم.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const modulePath = require.resolve('../public/dig-site');
const fresh = () => { delete require.cache[modulePath]; return require(modulePath); };
const DS = fresh();
const CFG = DS.CFG;
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${a} ≈ ${b}`);
const seeded = (seed = 7) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

// ============================== نماذج صافية ==============================
test('stickVector: dead zone, rescaled ramp, clamp to the unit circle and hostile input', () => {
  assert.deepEqual(DS.stickVector(0, 0, 50), { x: 0, y: 0, mag: 0 });
  assert.deepEqual(DS.stickVector(5, -5, 50), { x: 0, y: 0, mag: 0 }, 'inside the dead zone (0.16 of the radius) nothing moves');
  const edge = DS.stickVector(50, 0, 50);
  near(edge.x, 1); near(edge.y, 0); near(edge.mag, 1);
  const beyond = DS.stickVector(500, 0, 50);
  near(beyond.mag, 1, 1e-9, 'dragging far past the rim is still full speed, not faster');
  const diag = DS.stickVector(300, -300, 50);
  near(Math.hypot(diag.x, diag.y), 1, 1e-9);
  assert.ok(diag.x > 0 && diag.y < 0 && Math.abs(Math.abs(diag.x) - Math.abs(diag.y)) < 1e-9, 'direction is preserved');
  const justOut = DS.stickVector(0.17 * 50, 0, 50);
  assert.ok(justOut.mag > 0 && justOut.mag < 0.03, `the ramp starts from zero at the dead-zone edge (${justOut.mag})`);
  const half = DS.stickVector(0, 25, 50);
  near(half.mag, (0.5 - CFG.DEAD) / (1 - CFG.DEAD), 1e-9);
  assert.deepEqual(DS.stickVector(NaN, undefined, 0), { x: 0, y: 0, mag: 0 });
  assert.ok(Number.isFinite(DS.stickVector(10, 10, 0).x), 'a zero radius cannot divide by zero');
});

test('stepMiner: speed, normalised diagonals, depth speed, band clamp, facing and the distance it reports', () => {
  const m = { x: 0.3, y: 0.7, face: 1 };
  const d = DS.stepMiner(m, { x: 1, y: 0 }, 0.1, 1.3);
  near(m.x, 0.3 + CFG.SPEED * 0.1); near(m.y, 0.7); near(d, CFG.SPEED * 0.1);
  const diag = { x: 0.4, y: 0.7, face: 1 };
  DS.stepMiner(diag, { x: 1, y: 1 }, 0.1, 1);
  const sx = diag.x - 0.4, sy = (diag.y - 0.7);
  assert.ok(sx < CFG.SPEED * 0.1, 'a diagonal is not faster than straight (input is normalised)');
  near(sy / sx, CFG.DEPTH_SPEED, 1e-9, 'depth moves slower than sideways, in width units');
  const tall = { x: 0.5, y: 0.6, face: 1 };
  DS.stepMiner(tall, { x: 0, y: 1 }, 0.1, 2); // wider field: the same real speed is fewer fractions of the height
  const tall2 = { x: 0.5, y: 0.6, face: 1 };
  DS.stepMiner(tall2, { x: 0, y: 1 }, 0.1, 1);
  near((tall.y - 0.6) / (tall2.y - 0.6), 2, 1e-9, 'vertical steps scale with the aspect ratio so the speed looks equal on every screen');
  const wall = { x: CFG.BAND.x1 - 0.001, y: CFG.BAND.y1 - 0.001, face: 1 };
  DS.stepMiner(wall, { x: 1, y: 1 }, 1, 1);
  assert.equal(wall.x, CFG.BAND.x1); assert.equal(wall.y, CFG.BAND.y1);
  const f = { x: 0.5, y: 0.7, face: 1 };
  DS.stepMiner(f, { x: -0.5, y: 0 }, 0.05, 1);
  assert.equal(f.face, -1, 'the miner turns to where he walks');
  DS.stepMiner(f, { x: 0.1, y: 0.9 }, 0.05, 1);
  assert.equal(f.face, -1, 'a mostly-vertical push keeps the last facing');
  assert.equal(DS.stepMiner(f, { x: 0, y: 0 }, 0.1, 1), 0);
  assert.equal(DS.stepMiner(f, { x: 1, y: 0 }, 0, 1), 0);
  assert.equal(DS.stepMiner(f, { x: NaN, y: NaN }, 0.1, 1), 0);
  const slow = { x: 0.5, y: 0.7, face: 1 };
  DS.stepMiner(slow, { x: 0.5, y: 0 }, 0.1, 1);
  near(slow.x - 0.5, CFG.SPEED * 0.05, 1e-9, 'half deflection = half speed');
});

test('separate / inReach / dirTo / alignment: the miner stops at the rock, never inside it', () => {
  const rock = { x: 0.6, y: 0.7 };
  const m = { x: 0.62, y: 0.7 };
  assert.equal(DS.separate(m, rock, 1, 0.2), true);
  near(DS.dist(m, rock, 1), 0.2, 1e-9);
  assert.ok(m.x > rock.x, 'pushed out along the line it was on');
  const far = { x: 0.1, y: 0.7 };
  assert.equal(DS.separate(far, rock, 1, 0.2), false);
  assert.deepEqual(far, { x: 0.1, y: 0.7 });
  const on = { x: 0.6, y: 0.7 };
  assert.equal(DS.separate(on, rock, 1, 0.2), true);
  near(DS.dist(on, rock, 1), 0.2, 1e-9);
  assert.equal(on.x > rock.x, true, 'exactly on top: pushed to a side, not left stuck or NaN');
  // vertical offsets are measured in width units: the same pixels apart whatever the field height
  const a = { x: 0.5, y: 0.6 }, b = { x: 0.5, y: 0.8 };
  near(DS.dist(a, b, 2), 0.1, 1e-9); near(DS.dist(a, b, 1), 0.2, 1e-9);
  assert.equal(DS.inReach({ x: 0.3, y: 0.7 }, rock, 1), false);
  assert.equal(DS.inReach({ x: 0.6 - (CFG.MINER_R + CFG.ROCK_R + CFG.REACH_GAP), y: 0.7 }, rock, 1), true, 'the reach is inclusive');
  assert.equal(DS.inReach({ x: 0.4, y: 0.7 }, rock, 1, 0.25), true, 'an explicit reach overrides the default');
  const toRock = DS.dirTo({ x: 0.2, y: 0.7 }, rock, 1);
  near(Math.hypot(toRock.x, toRock.y), 1, 1e-9); assert.ok(toRock.x > 0.9 && Math.abs(toRock.y) < 1e-9);
  assert.deepEqual(DS.dirTo(rock, rock, 1), { x: 0, y: 0 });
  // walking toward the rock by the returned input really gets closer
  const w = { x: 0.2, y: 0.6, face: 1 };
  const before = DS.dist(w, rock, 1.4);
  DS.stepMiner(w, DS.dirTo(w, rock, 1.4), 0.1, 1.4);
  assert.ok(DS.dist(w, rock, 1.4) < before);
  near(DS.alignment({ x: 1, y: 0 }, { x: 0.2, y: 0.7 }, rock, 1), 1, 1e-9);
  near(DS.alignment({ x: -1, y: 0 }, { x: 0.2, y: 0.7 }, rock, 1), -1, 1e-9);
  near(DS.alignment({ x: 0, y: 1 }, { x: 0.2, y: 0.7 }, rock, 1), 0, 1e-9);
  assert.equal(DS.alignment({ x: 0, y: 0 }, { x: 0.2, y: 0.7 }, rock, 1), 0);
});

test('createSwing: windup → strike (the hit lands as the strike starts) → recover → done, about four swings a second', () => {
  const s = DS.createSwing();
  assert.equal(s.phase, 'idle');
  assert.deepEqual(s.update(0.5), [], 'an idle swing never fires');
  assert.equal(s.start(), true);
  assert.equal(s.start(), false, 'cannot restart mid-swing');
  assert.equal(s.phase, 'windup');
  assert.deepEqual(s.update(CFG.SWING.windup - 0.01), []);
  assert.deepEqual(s.update(0.02), ['hit']);
  assert.equal(s.phase, 'strike');
  assert.deepEqual(s.update(CFG.SWING.strike), []);
  assert.equal(s.phase, 'recover');
  assert.deepEqual(s.update(CFG.SWING.recover), ['done']);
  assert.equal(s.phase, 'idle');
  // a long frame skips through every phase and still reports hit then done, once each
  s.start();
  assert.deepEqual(s.update(1), ['hit', 'done']);
  assert.equal(s.phase, 'idle');
  s.start(); s.update(0.05); s.cancel();
  assert.equal(s.phase, 'idle');
  assert.deepEqual(s.update(1), [], 'a cancelled swing never lands a late hit');
  // back-to-back swings for ten seconds at 60 fps stay under the economy's comfortable rate (and well under the server cap of 20/s)
  let hits = 0, t = 0;
  while (t < 10) { if (s.phase === 'idle') s.start(); hits += s.update(1 / 60).filter((e) => e === 'hit').length; t += 1 / 60; }
  assert.ok(hits >= 36 && hits <= 41, `≈3.8 swings/s, got ${hits} in 10 s`);
  const total = CFG.SWING.windup + CFG.SWING.strike + CFG.SWING.recover;
  assert.ok(1 / total < 4.2 && 1 / total > 3.4, `cycle ${total}s`);
});

test('rock health: stages by thirds, damage clamps at zero, breaking is reported once', () => {
  assert.deepEqual([12, 9, 8, 5, 4, 1, 0].map((hp) => DS.rockStage(hp, 12)), [0, 0, 1, 1, 2, 2, 2]);
  assert.equal(DS.rockStage(5, 0), 2, 'a zero-max rock is simply broken');
  const rock = DS.createRock({ x: 0.7, y: 0.75 });
  assert.deepEqual([rock.hp, rock.max, rock.x, rock.y], [CFG.ROCK_HP, CFG.ROCK_HP, 0.7, 0.75]);
  const first = DS.hitRock(rock, 1);
  assert.deepEqual(first, { hp: 11, stage: 0, broken: false });
  let broke = 0;
  for (let i = 0; i < 20; i++) if (DS.hitRock(rock, 1).broken && rock.hp === 0) broke++;
  assert.ok(rock.hp === 0, 'never below zero');
  assert.deepEqual(DS.hitRock(DS.createRock({}, 3), 5), { hp: 0, stage: 2, broken: true });
  assert.equal(DS.createRock({ x: 'x' }, 0).max, 1, 'a rock always has at least one health point');
  assert.equal(DS.hitRock(DS.createRock({}, 2), -4).hp, 2, 'negative damage cannot heal');
  assert.ok(broke >= 1);
});

test('pickRockSpot: stays in its band, away from the miner and the controls, with a fallback when nothing fits', () => {
  const rng = seeded(11);
  const miner = { x: 0.3, y: 0.8 };
  for (let i = 0; i < 200; i++) {
    const p = DS.pickRockSpot(rng, miner, 1.3, []);
    assert.ok(p.x >= CFG.ROCK_BAND.x0 && p.x <= CFG.ROCK_BAND.x1 && p.y >= CFG.ROCK_BAND.y0 && p.y <= CFG.ROCK_BAND.y1, `in band ${JSON.stringify(p)}`);
    assert.ok(DS.dist(p, miner, 1.3) >= CFG.RESPAWN_MIN - 1e-9, 'far enough that the miner has to walk');
  }
  const zones = [{ x0: 0, y0: 0, x1: 1, y1: 0.7 }];
  for (let i = 0; i < 100; i++) assert.ok(DS.pickRockSpot(rng, miner, 1.3, zones).y > 0.7, 'controls zones are avoided');
  const everything = [{ x0: 0, y0: 0, x1: 1, y1: 1 }];
  const fallback = DS.pickRockSpot(rng, { x: 0.25, y: 0.9 }, 1, everything);
  near(fallback.x, 0.75, 1e-9); assert.ok(fallback.y <= CFG.ROCK_BAND.y1, 'mirrored across the field, clamped to the band');
  // a custom minimum distance is respected, and an impossible one still returns the farthest candidate
  const strict = DS.pickRockSpot(seeded(3), miner, 1, [], CFG.ROCK_BAND, 5);
  assert.ok(Number.isFinite(strict.x) && Number.isFinite(strict.y));
  assert.deepEqual(DS.pickRockSpot(seeded(5), miner, 1.3, []), DS.pickRockSpot(seeded(5), miner, 1.3, []), 'deterministic for a given generator');
  assert.ok(Number.isFinite(DS.pickRockSpot(null, null, NaN).x), 'garbage in still yields a spot');
});

test('depthScale grows toward the viewer and poseFor picks frames in the right priority', () => {
  const ys = [0, CFG.BAND.y0, 0.7, CFG.BAND.y1, 1];
  const scales = ys.map((y) => DS.depthScale(y));
  assert.deepEqual([...scales].sort((a, b) => a - b), scales, 'monotonic');
  near(scales[0], 0.84, 1e-9); near(scales[4], 1.1, 1e-9);
  assert.equal(DS.poseFor({}), 'idle');
  assert.equal(DS.poseFor({ phase: 'windup' }), 'raise');
  assert.equal(DS.poseFor({ phase: 'strike' }), 'strike');
  assert.equal(DS.poseFor({ phase: 'recover' }), 'idle');
  assert.equal(DS.poseFor({ phase: 'strike', cheer: true }), 'cheer', 'a cheer outranks everything');
  assert.equal(DS.poseFor({ phase: 'idle', moving: true, step: 0.2 }), 'walk1');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((step) => DS.poseFor({ moving: true, step })), ['walk1', 'idle', 'walk2', 'idle', 'walk1', 'idle'], 'a four-beat stride using the two walking frames');
  assert.equal(DS.poseFor({ moving: true, step: -1 }), 'idle', 'negative steps wrap instead of returning undefined');
  assert.equal(DS.poseFor({ moving: true, phase: 'windup' }), 'raise', 'swinging beats walking');
  assert.equal(DS.poseFor(undefined), 'idle');
});

// ============================== المتحكم على DOM وهمي ==============================
function makeEnv({ w = 400, h = 300, rng = seeded(21), fx = true } = {}) {
  const calls = { raf: [], fx: [], timers: [] };
  const doc = { handlers: {}, hidden: false };
  const classList = (initial = []) => {
    const set = new Set(initial);
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); }, contains: (c) => set.has(c), has: (c) => set.has(c) };
  };
  const mkEl = (id, props = {}) => {
    const el = {
      id, tagName: 'DIV', style: { setProperty(k, v) { this[k] = v; } }, dataset: {}, hidden: false, children: [], handlers: {}, attrs: {}, captured: [],
      offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0, classList: classList(),
      addEventListener(type, fn) { this.handlers[type] = fn; }, removeEventListener(type) { delete this.handlers[type]; },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; }, remove() { this.removed = true; },
      setPointerCapture(id2) { this.captured.push(id2); }, animate() { const a = {}; this.animations = (this.animations || 0) + 1; return a; },
      getBoundingClientRect() { return { left: 0, top: 0, width: this.offsetWidth, height: this.offsetHeight }; },
      ...props,
    };
    return el;
  };
  const el = {
    tab: mkEl('tab-mining', { classList: classList(['active']) }),
    root: mkEl('ck-stage'),
    world: mkEl('ck-world', { clientWidth: w, clientHeight: h, getBoundingClientRect: () => ({ left: 10, top: 100, width: w, height: h }) }),
    miner: mkEl('ck-miner', { offsetWidth: 140, offsetHeight: 152 }),
    rockBtn: mkEl('mine-btn', { tagName: 'BUTTON', offsetWidth: 130, offsetHeight: 117 }),
    ore: mkEl('ck-ore'),
    bob: mkEl('bob'),
    hp: mkEl('ck-rockhp'),
    hpFill: mkEl('hpfill'),
    pad: mkEl('ck-pad', { offsetWidth: 96, offsetHeight: 96, getBoundingClientRect: () => ({ left: 16, top: 400, width: 96, height: 96 }) }),
    stick: mkEl('ck-stick'),
    dig: mkEl('ck-dig', { tagName: 'BUTTON', offsetWidth: 78, offsetHeight: 78 }),
    sheet: mkEl('ck-sheet', { hidden: true }),
  };
  const byId = { 'tab-mining': el.tab, 'ck-stage': el.root, 'ck-world': el.world, 'ck-miner': el.miner, 'mine-btn': el.rockBtn, 'ck-ore': el.ore, 'ck-rockhp': el.hp, 'ck-pad': el.pad, 'ck-stick': el.stick, 'ck-dig': el.dig, 'ck-sheet': el.sheet };
  const bySel = { '#mine-btn .ck-bob': el.bob, '#ck-rockhp i': el.hpFill };
  doc.getElementById = (id) => byId[id] || null;
  doc.querySelector = (sel) => bySel[sel] || null;
  doc.createElement = () => mkEl('made');
  doc.addEventListener = (type, fn) => { (doc.handlers[type] = doc.handlers[type] || []).push(fn); };
  doc.body = mkEl('body');
  const win = { handlers: {} };
  const fxObj = fx ? { active: true, burst: (...a) => calls.fx.push(['burst', ...a]), cue: (...a) => calls.fx.push(['cue', ...a]), touched: () => calls.fx.push(['touched']) } : undefined;
  const saved = {};
  const globals = {
    document: doc, ClickerFX: fxObj,
    requestAnimationFrame: (fn) => { calls.raf.push(fn); return calls.raf.length; }, cancelAnimationFrame: () => {},
    addEventListener: (type, fn) => { (win.handlers[type] = win.handlers[type] || []).push(fn); },
    removeEventListener: (type, fn) => { win.handlers[type] = (win.handlers[type] || []).filter((f) => f !== fn); },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  const install = () => { for (const [k, v] of Object.entries(globals)) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } };
  const restore = () => { for (const k of Object.keys(globals)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; } };
  const fire = (target, type, ev) => { const e = { preventDefault() { this.prevented = true; }, ...ev }; for (const fn of target.handlers[type] || []) fn(e); return e; };
  return {
    el, calls, doc, win, install, restore, rng,
    key: (type, code, extra = {}) => fire(doc, type, { code, target: { tagName: 'BODY' }, ...extra }),
    pad: (type, ev) => (type === 'pointerdown' ? (el.pad.handlers.pointerdown || (() => {}))({ preventDefault() {}, ...ev }) : fire(win, type, ev)),
    dig: (type, ev) => (type === 'pointerdown' ? (el.dig.handlers.pointerdown || (() => {}))({ preventDefault() {}, ...ev }) : type === 'click' ? el.dig.handlers.click({ detail: 0, ...ev }) : fire(win, type, ev)),
  };
}

// يشغّل جسم الاختبار على نسخة جديدة من الوحدة وبيئة وهمية ثم يستعيد العامّ.
// swings = كل ضربة قبلها opts.swing (أي كل ما كان سيخصم طاقة ويضيف ذهباً في الصفحة الحقيقية)
function withSite(opts, body) {
  const env = makeEnv(opts);
  env.install();
  try {
    const ds = fresh();
    const swings = [];
    const haptics = [];
    const custom = opts && opts.swing;
    const ok = ds.init({ swing: (x, y) => { const accepted = custom ? custom(x, y) : true; if (accepted) swings.push([x, y]); return accepted; }, haptic: (t) => haptics.push(t), rng: env.rng });
    return body({ env, ds, swings, haptics, ok });
  } finally { env.restore(); }
}

test('init: shows the controls, places the miner and the rock from the real sizes, and refuses to start without its elements', () => {
  withSite({}, ({ env, ds, ok }) => {
    assert.equal(ok, true);
    assert.equal(env.el.root.dataset.dig, '1', 'CSS shows the pad and the dig button, ClickerFX stops its own lunge');
    assert.match(env.el.miner.style.transform, /^translate3d\(104\.0px, 240\.0px, 0\) translate\(-50%, -100%\) scale\(1\.0\d\d\)$/, 'x=0.26 of 400, feet at y=0.80 of 300, depth scale ≈1');
    assert.match(env.el.rockBtn.style.transform, /^translate3d\(240\.0px, 240\.0px, 0\)/, 'the rock starts at 0.60, matching the CSS default');
    assert.equal(env.el.miner.dataset.pose, 'idle');
    assert.equal(env.el.ore.dataset.stage, '0');
    const info = ds.inspect();
    assert.equal(info.active, true);
    assert.deepEqual(info.size, { W: 400, H: 300 });
    assert.ok(info.reach > 0.2 && info.reach < 0.4, `reach scales with the sprites (${info.reach})`);
    assert.ok(info.band.x0 > 0.1 && info.band.x1 < 0.9);
    assert.equal(ds.init({ swing() { return true; } }), true, 'a second init is a harmless no-op');
  });
  // elements missing → soft failure, API stays callable
  const env = makeEnv();
  env.doc.getElementById = (id) => (id === 'ck-pad' ? null : { id });
  env.install();
  try {
    const ds = fresh();
    assert.equal(ds.init({ swing: () => true }), false);
    assert.equal(ds.inspect().active, false);
    assert.doesNotThrow(() => { ds.onTap({}); ds.onTab('mining'); });
  } finally { env.restore(); }
  // no document at all (Node, a worker): init says no instead of throwing
  const bare = fresh();
  assert.equal(bare.init({}), false);
});

test('a hidden tab measures zero: nothing is placed until the field has a size, then it is placed once', () => {
  withSite({ w: 0, h: 0 }, ({ env, ds }) => {
    assert.equal(env.el.miner.style.transform, undefined, 'the CSS defaults stay in charge while hidden');
    assert.equal(env.el.rockBtn.style.transform, undefined);
    env.el.world.clientWidth = 400; env.el.world.clientHeight = 300;
    ds.onTab('mining');
    assert.match(env.el.miner.style.transform, /translate3d\(104\.0px, 240\.0px/);
    assert.match(env.el.rockBtn.style.transform, /translate3d\(240\.0px, 240\.0px/);
  });
});

test('the stick walks the miner to the rock and he digs: every landed swing is exactly one opts.swing call and one health point', () => {
  withSite({}, ({ env, ds, swings }) => {
    ds.debug.place({ x: 0.2, y: 0.8 }, { x: 0.7, y: 0.8 });
    ds.debug.setStick(1, 0);
    ds.debug.step(0.05, 6);
    let info = ds.inspect();
    assert.ok(info.miner.x > 0.2 && info.miner.moving, 'walking right');
    assert.equal(swings.length, 0, 'out of reach: no swing is charged');
    assert.equal(info.miner.face, 1);
    ds.debug.step(0.05, 50);
    info = ds.inspect();
    assert.equal(info.inReach, true);
    assert.ok(info.miner.x < info.rock.x, 'he stops at the rock instead of walking through it');
    assert.ok(swings.length >= 5 && swings.length < CFG.ROCK_HP, `swinging (${swings.length})`);
    assert.equal(info.stats.swings, swings.length, 'the controller counts exactly what opts.swing accepted');
    assert.equal(info.rock.hp, CFG.ROCK_HP - swings.length, 'one health point per accepted swing');
    // the hit point is on the miner's side of the rock, in screen coordinates (world is at left 10, top 100)
    const [hx, hy] = swings[0];
    assert.ok(hx < 10 + 0.7 * 400, `x ${hx} is left of the rock centre because he stands on its left`);
    assert.ok(hy < 100 + 0.8 * 300 && hy > 100 + 0.8 * 300 - 130, `y ${hy} is on the rock body, above its base`);
    assert.equal(env.el.hpFill.style.width, `${(100 * info.rock.hp / info.rock.max).toFixed(1)}%`);
    assert.equal(env.el.hp.classList.contains('is-on'), true, 'the health bar appears after the first hit');
    // pushing the stick away stops the digging (the swing in progress finishes, no new one starts)
    ds.debug.setStick(-1, 0);
    ds.debug.step(0.05, 3);
    const during = swings.length;
    ds.debug.step(0.05, 20);
    assert.ok(swings.length - during <= 1, 'walking away does not keep digging');
    assert.ok(ds.inspect().miner.x < info.miner.x, 'and he walks away');
    assert.equal(ds.inspect().miner.face, -1);
  });
});

test('breaking the rock: a burst and a crumble cue, a cheer, a ghost of the old rock, and a fresh rock the miner has to walk to', () => {
  withSite({}, ({ env, ds, swings, haptics }) => {
    ds.debug.place({ x: 0.45, y: 0.8 }, { x: 0.7, y: 0.8 });
    ds.debug.setDig(true);
    let guard = 0;
    while (ds.inspect().stats.breaks === 0 && guard++ < 400) ds.debug.step(0.05);
    const info = ds.inspect();
    assert.equal(info.stats.breaks, 1);
    assert.equal(swings.length, CFG.ROCK_HP, 'exactly twelve accepted swings broke it, not one more');
    assert.equal(info.rock.hp, CFG.ROCK_HP, 'the new rock is whole');
    assert.ok(info.rock.x !== 0.7 || info.rock.y !== 0.8);
    const kinds = env.calls.fx.map((c) => c.slice(0, 2).join(':'));
    assert.ok(kinds.includes('burst:rock') && kinds.includes('burst:milestone') && kinds.includes('cue:crumble'), kinds.join(','));
    assert.ok(haptics.includes('medium'));
    assert.equal(env.el.world.children.length, 1, 'the old rock lingers as a ghost');
    assert.equal(env.el.world.children[0].className, 'ck-ghost');
    assert.ok(env.el.bob.animations >= 1, 'the new rock pops in');
    assert.equal(info.cheering, true);
    assert.equal(env.el.miner.dataset.pose, 'cheer');
    assert.equal(env.el.ore.dataset.stage, '0', 'the new rock shows no cracks');
    assert.equal(env.el.hp.classList.contains('is-on'), false);
    assert.equal(info.inReach, false, 'it appeared out of his reach, so he has to walk to it');
    assert.ok(DS.dist(info.miner, info.rock, 400 / 300) > 0.2, 'and nowhere near overlapping him');
    // the new rock sits in the right place for the next frame already (no frame with the old position)
    const x = Math.round(info.rock.x * 400 * 10) / 10;
    assert.ok(env.el.rockBtn.style.transform.startsWith(`translate3d(${x.toFixed(1)}px`), env.el.rockBtn.style.transform);
    // he keeps going: walk to the new rock (dig is still held) and hit it
    const before = swings.length;
    ds.debug.step(0.05, 80);
    assert.ok(swings.length > before, 'holding the button carries on with the next rock');
  });
});

test('a refused swing (no energy) costs nothing and pauses the auto-dig for 700 ms', () => {
  let allow = false;
  withSite({ swing: () => allow }, ({ ds }) => {
    ds.debug.place({ x: 0.45, y: 0.8 }, { x: 0.7, y: 0.8 });
    ds.debug.setDig(true);
    ds.debug.step(0.05, 8);
    let info = ds.inspect();
    assert.equal(info.stats.refused, 1, 'one attempt');
    assert.equal(info.rock.hp, CFG.ROCK_HP, 'a refused swing does no damage');
    assert.equal(info.stats.swings, 0);
    ds.debug.step(0.05, 6);
    assert.equal(ds.inspect().stats.refused, 1, 'no hammering the energy check at 4/s while empty');
    ds.debug.step(0.05, 8);
    assert.equal(ds.inspect().stats.refused, 2, 'it tries again once the pause is over');
    allow = true;
    ds.debug.step(0.05, 40);
    info = ds.inspect();
    assert.ok(info.stats.swings >= 3 && info.rock.hp < CFG.ROCK_HP, 'energy is back: digging resumes by itself');
  });
  // a callback that throws is a refusal, not a crash
  withSite({ swing: () => { throw new Error('boom'); } }, ({ ds }) => {
    ds.debug.place({ x: 0.45, y: 0.8 }, { x: 0.7, y: 0.8 });
    ds.debug.setDig(true);
    assert.doesNotThrow(() => ds.debug.step(0.05, 12));
    assert.ok(ds.inspect().stats.refused >= 1);
  });
});

test('rate: auto-digging never exceeds four swings a second at any frame rate', () => {
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1, 0.25]) {
    withSite({}, ({ ds, swings }) => {
      ds.debug.place({ x: 0.45, y: 0.8 }, { x: 0.7, y: 0.8 });
      ds.debug.setDig(true);
      const seconds = 20;
      ds.debug.step(dt, Math.round(seconds / Math.min(dt, 0.1)));       // frames longer than 0.1 s are clamped, so the simulation never runs faster than real time
      const simulated = Math.round(seconds / Math.min(dt, 0.1)) * Math.min(dt, 0.1);
      assert.ok(swings.length / simulated <= 4.01, `dt=${dt}: ${swings.length} swings in ${simulated}s`);
      assert.ok(swings.length > 0.5 * simulated, `dt=${dt}: it does dig (${swings.length})`);
    });
  }
});

test('tapping the rock still mines at once: the rock takes the hit, the miner walks over and swings for show (no second charge)', () => {
  withSite({}, ({ env, ds, swings }) => {
    ds.debug.place({ x: 0.2, y: 0.8 }, { x: 0.7, y: 0.8 });
    ds.onTap({ x: 300, y: 300 });
    let info = ds.inspect();
    assert.equal(info.stats.taps, 1);
    assert.equal(info.rock.hp, CFG.ROCK_HP - 1, 'the touch itself damages the rock');
    assert.equal(info.approaching, true);
    assert.ok(env.calls.raf.length >= 1, 'the loop wakes up');
    const poses = new Set();
    for (let i = 0; i < 60; i++) { ds.debug.step(0.05); poses.add(ds.inspect().miner.pose); }
    info = ds.inspect();
    assert.ok(info.inReach, 'he walked over by himself');
    assert.equal(swings.length, 0, 'the show swing never calls opts.swing: the tap was already paid for');
    assert.ok(poses.has('raise') && poses.has('strike') && poses.has('walk1'), [...poses].join());
    assert.equal(info.rock.hp, CFG.ROCK_HP - 1, 'and it does not hurt the rock a second time');
    // taps while already holding dig do not queue extra show swings
    ds.debug.setDig(true);
    ds.onTap({});
    assert.equal(ds.inspect().stats.taps, 2);
  });
  // ten quick taps break nothing about the count: each tap is one hit
  withSite({}, ({ ds }) => {
    for (let i = 0; i < 11; i++) ds.onTap({});
    assert.equal(ds.inspect().rock.hp, 1);
    ds.onTap({});
    assert.equal(ds.inspect().stats.breaks, 1, 'the twelfth tap breaks the rock');
  });
});

test('keyboard: arrows and WASD walk, space digs, typing targets and chords are ignored, and nothing runs on other tabs', () => {
  withSite({}, ({ env, ds, swings }) => {
    ds.debug.place({ x: 0.3, y: 0.7 }, { x: 0.8, y: 0.8 });
    env.key('keydown', 'ArrowRight');
    assert.equal(ds.inspect().keys.r, true);
    assert.ok(env.calls.raf.length >= 1, 'a key press wakes the loop');
    ds.debug.step(0.1, 3);
    assert.ok(ds.inspect().miner.x > 0.3);
    env.key('keyup', 'ArrowRight');
    const stopped = ds.inspect().miner.x;
    ds.debug.step(0.1, 3);
    near(ds.inspect().miner.x, stopped, 1e-9, 'released: he stops');
    env.key('keydown', 'KeyA'); ds.debug.step(0.1, 3); env.key('keyup', 'KeyA');
    assert.ok(ds.inspect().miner.x < stopped, 'A walks left');
    const y0 = ds.inspect().miner.y;
    env.key('keydown', 'KeyS'); ds.debug.step(0.1, 2); env.key('keyup', 'KeyS');
    assert.ok(ds.inspect().miner.y > y0, 'S walks toward the viewer');
    env.key('keydown', 'KeyW'); ds.debug.step(0.1, 6); env.key('keyup', 'KeyW');
    assert.ok(ds.inspect().miner.y < y0);
    // ignored inputs
    const e1 = env.key('keydown', 'ArrowLeft', { target: { tagName: 'INPUT' } });
    assert.equal(ds.inspect().keys.l, false); assert.notEqual(e1.prevented, true, 'typing is never hijacked');
    env.key('keydown', 'ArrowLeft', { ctrlKey: true });
    assert.equal(ds.inspect().keys.l, false);
    const space = env.key('keydown', 'Space', { target: { tagName: 'BUTTON' } });
    assert.equal(ds.inspect().digHeld, false, 'space on a focused button belongs to the button');
    assert.notEqual(space.prevented, true);
    env.key('keydown', 'Space');
    assert.equal(ds.inspect().digHeld, true, 'space digs');
    env.key('keyup', 'Space');
    assert.equal(ds.inspect().digHeld, false);
    const arrow = env.key('keydown', 'ArrowDown');
    assert.equal(arrow.prevented, true, 'arrows do not scroll the page while they steer');
    env.key('keyup', 'ArrowDown');
    // leaving the tab drops everything
    env.key('keydown', 'ArrowRight');
    ds.onTab('shop');
    env.el.tab.classList.remove('active');
    assert.equal(ds.inspect().keys.r, false, 'leaving the tab releases held keys');
    env.key('keydown', 'ArrowRight');
    assert.equal(ds.inspect().keys.r, false, 'other tabs keep their own arrow keys');
    assert.equal(swings.length, 0);
  });
});

test('the real loop: rAF timestamps drive movement and swings, then the loop sleeps by itself', () => {
  withSite({}, ({ env, ds, swings }) => {
    ds.debug.place({ x: 0.3, y: 0.8 }, { x: 0.7, y: 0.8 });
    env.key('keydown', 'ArrowRight');
    let ts = 1000;
    let frames = 0;
    while (env.calls.raf.length && frames < 400) { const f = env.calls.raf.shift(); ts += 16.7; f(ts); frames++; if (frames === 120) env.key('keyup', 'ArrowRight'); }
    const info = ds.inspect();
    assert.ok(swings.length >= 4, `it walked to the rock and dug with real frames (${swings.length})`);
    assert.ok(frames < 400, 'the loop stopped once nothing was happening');
    assert.equal(env.calls.raf.length, 0, 'no frame is scheduled while idle (no battery use on a quiet field)');
    assert.equal(info.swing, 'idle');
    assert.ok(info.clock > 1500, 'the real-time clock advanced');
    // a huge gap between frames (tab in the background) is clamped: no teleport, no burst of swings
    env.key('keydown', 'ArrowLeft');
    env.calls.raf.shift()(ts + 60000);                         // first frame after sleeping only sets the time base
    const x = ds.inspect().miner.x;
    env.calls.raf.shift()(ts + 120000);                        // a minute later: one frame, clamped
    assert.ok(x - ds.inspect().miner.x <= CFG.SPEED * 0.1 + 1e-9, 'a minute-long frame moves at most one clamped step (0.1 s), never teleports');
    assert.ok(x - ds.inspect().miner.x > 0, 'but it still moves');
    env.key('keyup', 'ArrowLeft');
  });
});

test('pausing: an open window, a hidden page or a lost focus release the stick and stop the loop', () => {
  withSite({}, ({ env, ds }) => {
    ds.debug.place({ x: 0.3, y: 0.8 }, { x: 0.8, y: 0.8 });
    env.key('keydown', 'ArrowRight');
    env.calls.raf.shift()(100); env.calls.raf.shift()(120);
    assert.equal(ds.inspect().keys.r, true);
    env.el.sheet.hidden = false;                       // a medal window opens over the field
    assert.equal(ds.inspect().paused, true);
    env.calls.raf.shift()(140);
    assert.equal(ds.inspect().keys.r, false, 'the held key was released by the pause');
    assert.equal(env.calls.raf.length, 0, 'the loop is not re-armed while paused');
    env.key('keydown', 'ArrowRight');
    assert.equal(ds.inspect().keys.r, false, 'keys are ignored behind the window');
    env.el.sheet.hidden = true;
    env.key('keydown', 'ArrowRight');
    assert.equal(ds.inspect().keys.r, true, 'and work again once it closes');
    env.doc.hidden = true;                            // the page goes to the background
    for (const fn of env.doc.handlers.visibilitychange || []) fn({});
    assert.equal(ds.inspect().keys.r, false);
    env.doc.hidden = false;
    // losing the window focus mid-hold must not leave the miner walking
    env.key('keydown', 'ArrowRight');
    for (const fn of env.win.handlers.blur || []) fn({});
    assert.equal(ds.inspect().keys.r, false);
    assert.equal(ds.inspect().swing, 'idle');
  });
});

test('the pad: one finger steers, other fingers and right clicks are ignored, release re-centres, and listeners are removed', () => {
  withSite({}, ({ env, ds }) => {
    const centre = { x: 16 + 48, y: 400 + 48 };
    assert.equal(typeof env.el.pad.handlers.pointerdown, 'function');
    env.pad('pointerdown', { pointerId: 9, pointerType: 'mouse', button: 2, clientX: centre.x + 40, clientY: centre.y });
    assert.equal(ds.inspect().stick.x, 0, 'a right click does not steer');
    env.pad('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: centre.x + 40, clientY: centre.y });
    let st = ds.inspect().stick;
    assert.ok(st.x > 0.5 && st.y === 0, `dragged right: ${JSON.stringify(st)}`);
    assert.deepEqual(env.el.pad.captured, [7], 'the pad captures the finger so the drag survives leaving it');
    assert.equal(env.el.pad.classList.contains('is-on'), true);
    assert.match(env.el.stick.style['--sx'], /^\d+(\.\d)?px$/);
    assert.ok(parseFloat(env.el.stick.style['--sx']) <= 96 / 2 * 0.62 + 0.1, 'the knob never leaves the base');
    assert.equal(env.win.handlers.pointermove.length, 1);
    assert.ok(env.calls.fx.some((c) => c[0] === 'touched'), 'the first touch ends the first-run invitation');
    // a second finger moving elsewhere does nothing; the owner finger keeps control
    env.pad('pointermove', { pointerId: 8, clientX: centre.x - 60, clientY: centre.y });
    assert.ok(ds.inspect().stick.x > 0.5);
    env.pad('pointerdown', { pointerId: 8, pointerType: 'touch', clientX: centre.x - 60, clientY: centre.y });
    assert.ok(ds.inspect().stick.x > 0.5, 'a second finger cannot take the stick');
    env.pad('pointermove', { pointerId: 7, clientX: centre.x, clientY: centre.y - 200 });
    st = ds.inspect().stick;
    assert.ok(st.y < -0.99 && Math.abs(st.x) < 1e-9, `up, clamped to the rim: ${JSON.stringify(st)}`);
    ds.debug.step(0.1, 2);
    assert.ok(ds.inspect().miner.y < 0.8, 'up on the stick walks into the depth');
    env.pad('pointerup', { pointerId: 8 });
    assert.ok(ds.inspect().stick.y < -0.99, 'another finger lifting does not release the stick');
    env.pad('pointerup', { pointerId: 7 });
    assert.deepEqual(ds.inspect().stick, { x: 0, y: 0 });
    assert.equal(env.el.stick.style['--sx'], '0px');
    assert.equal(env.el.pad.classList.contains('is-on'), false);
    assert.equal((env.win.handlers.pointermove || []).length, 0, 'window listeners are removed on release');
    assert.equal((env.win.handlers.pointerup || []).length, 0);
    // cancel (the browser took the touch) releases too
    env.pad('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: centre.x - 40, clientY: centre.y });
    assert.ok(ds.inspect().stick.x < -0.5);
    env.pad('pointercancel', { pointerId: 3 });
    assert.deepEqual(ds.inspect().stick, { x: 0, y: 0 });
  });
});

test('the dig button: hold to dig, release to stop; a keyboard activation is one deliberate swing', () => {
  withSite({}, ({ env, ds, swings }) => {
    ds.debug.place({ x: 0.1, y: 0.8 }, { x: 0.7, y: 0.8 });
    env.dig('pointerdown', { pointerId: 4, pointerType: 'touch' });
    assert.equal(ds.inspect().digHeld, true);
    assert.equal(env.el.dig.classList.contains('is-down'), true);
    assert.deepEqual(env.el.dig.captured, [4]);
    ds.debug.step(0.05, 60);
    const info = ds.inspect();
    assert.ok(info.inReach && swings.length >= 3, 'with no stick at all he walks to the rock by himself and digs');
    env.dig('pointerup', { pointerId: 5 });
    assert.equal(ds.inspect().digHeld, true, 'another finger lifting does not release the button');
    env.dig('pointerup', { pointerId: 4 });
    assert.equal(ds.inspect().digHeld, false);
    assert.equal(env.el.dig.classList.contains('is-down'), false);
    const n = swings.length;
    ds.debug.step(0.05, 20);
    assert.ok(swings.length - n <= 1, 'released: he finishes the swing in progress and stops');
    // keyboard activation (a click with detail 0)
    env.dig('click', {});
    assert.equal(ds.inspect().digHeld, true);
    assert.equal(ds.inspect().approaching, true);
    // a mouse click (detail 1) is handled by pointerdown, not twice
    env.dig('click', { detail: 1 });
  });
});

test('layering: the miner is drawn in front of the rock once he is at it, and by depth otherwise', () => {
  withSite({}, ({ env, ds }) => {
    ds.debug.place({ x: 0.2, y: 0.8 }, { x: 0.7, y: 0.8 });
    ds.debug.step(0.016);
    assert.equal(Number(env.el.miner.style.zIndex), Number(env.el.rockBtn.style.zIndex), 'far apart: same depth, same layer (the rock comes later in the DOM)');
    ds.debug.place({ x: 0.45, y: 0.8 });
    ds.debug.step(0.016);
    assert.ok(ds.inspect().inReach);
    assert.ok(Number(env.el.miner.style.zIndex) > Number(env.el.rockBtn.style.zIndex), 'at the rock he stands in front of it');
    ds.debug.place({ x: 0.2, y: 0.6 }, { x: 0.7, y: 0.8 });
    ds.debug.step(0.016);
    assert.ok(Number(env.el.miner.style.zIndex) < Number(env.el.rockBtn.style.zIndex), 'farther back in the cave: behind');
  });
});

test('flip and walking frames: facing follows the walk and the stride alternates walk1/walk2 with idle between', () => {
  withSite({}, ({ env, ds }) => {
    ds.debug.place({ x: 0.5, y: 0.7 }, { x: 0.9, y: 0.62 });
    ds.debug.setStick(-1, 0);
    const seen = [];
    for (let i = 0; i < 12; i++) { ds.debug.step(0.04); seen.push(env.el.miner.dataset.pose); }
    assert.equal(env.el.miner.dataset.face, '-1');
    assert.equal(env.el.miner.dataset.act, 'walk');
    assert.ok(seen.includes('walk1') && seen.includes('walk2') && seen.includes('idle'));
    ds.debug.setStick(1, 0);
    ds.debug.step(0.04);
    assert.equal(env.el.miner.dataset.face, '1');
    ds.debug.setStick(0, 0);
    ds.debug.step(0.04);
    assert.equal(env.el.miner.dataset.act, 'idle');
    assert.equal(env.el.miner.dataset.pose, 'idle');
  });
});

test('pressing against the rock while a swing is refused is standing, not walking (no stride animation on the spot)', () => {
  withSite({ swing: () => false }, ({ env, ds }) => {
    ds.debug.place({ x: 0.5, y: 0.8 }, { x: 0.7, y: 0.8 });
    ds.debug.setStick(1, 0);
    ds.debug.step(0.05, 8);                                  // the energy check fails: the auto-dig now sleeps for 700 ms
    assert.equal(ds.inspect().stats.refused, 1);
    const x0 = ds.inspect().miner.x;
    const poses = new Set();
    for (let i = 0; i < 6; i++) { ds.debug.step(0.05); poses.add(env.el.miner.dataset.pose); }
    assert.equal(ds.inspect().stats.refused, 1, 'still inside the pause');
    assert.ok(![...poses].some((p) => p.startsWith('walk')), `leaning on the rock is not a walk cycle: ${[...poses]}`);
    assert.ok(Math.abs(ds.inspect().miner.x - x0) < 0.01, 'he does not slide through it either');
    assert.equal(env.el.miner.dataset.act, 'idle');
  });
});

test('economy isolation: the module has no way to touch gold, energy, storage or the server except opts.swing', () => {
  const source = read('public', 'dig-site.js');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const banned of [/\bfetch\b/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /localStorage/, /sessionStorage/, /\/api\//, /\bstate\b/, /\bSYNC\b/, /\bgold\b/i, /\benergy\b/i, /handleMine/, /\bwindow\./]) {
    assert.doesNotMatch(code, banned, `dig-site.js must not reference ${banned}`);
  }
  assert.equal((code.match(/opts\.swing\(/g) || []).length, 1, 'exactly one call site for a swing');
  assert.match(code, /function economicHit\(\)[\s\S]*?opts\.swing\(pt\.x, pt\.y\)[\s\S]*?stats\.swings\+\+;\s*damageRock\(1\);/, 'the rock is only damaged after the swing was accepted');
  assert.ok(!/setInterval/.test(code), 'no timers that keep running: only a requestAnimationFrame loop that sleeps when idle');
  // the loop cap that keeps the swing rate bounded by real time
  assert.match(code, /MAX_DT = 0\.1/);
});

// ============================== الصفحة والأنماط والفن ==============================
const html = read('public', 'index.html');
const css = read('public', 'clicker.css');

test('page wiring: the dig site is initialised with handleMine as its only effect, tapped rocks and tab changes reach it, and every control exists', () => {
  assert.match(html, /<script src="\/dig-site\.js\?v=\d+"><\/script>/);
  assert.ok(html.indexOf('/clicker-fx.js') < html.indexOf('/dig-site.js'), 'ClickerFX is ready before the dig site looks for it');
  assert.ok(html.indexOf('/dig-site.js') < html.indexOf('<!-- Game Logic Script -->'), 'loaded before the game script initialises it');
  assert.match(html, /window\.DigSite\?\.init\(\{ swing: \(x, y\) => handleMine\(\{ clientX: x, clientY: y, dig: true \}\), haptic \}\);/);
  assert.ok(html.indexOf('window.ClickerFX?.init(') < html.indexOf('window.DigSite?.init('), 'ClickerFX first: DigSite reads ClickerFX.active at init');
  assert.match(html, /window\.DigSite\?\.onTab\?\.\(tabId\);/);
  for (const id of ['ck-world', 'ck-miner', 'ck-hero', 'mine-btn', 'ck-ore', 'ck-rockhp', 'ck-pad', 'ck-stick', 'ck-dig']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<div id="ck-miner" class="ck-miner" data-pose="idle" data-face="1" data-act="idle" aria-hidden="true">/, 'the miner is decoration for assistive tech; the real controls are the button and the keys');
  assert.match(html, /<button id="ck-dig" type="button" class="ck-dig cv-btn[^"]*" aria-label="[^"]+"/);
  assert.match(html, /<div id="ck-pad" class="ck-pad" role="group" aria-label="[^"]+" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight">/);
  assert.match(html, /<p id="tap-hint" class="ck-hint"><span class="ck-hint-dig">[^<]*العصا[^<]*<\/span>[^<]*<span id="tap-cost">1<\/span>/, 'the hint tells about the stick (only while the dig site runs) and keeps the live cost');
  assert.match(css, /\.ck-hint-dig \{ display: none; \}\s*\.ck-stage\[data-dig="1"\] \.ck-hint-dig \{ display: inline; \}/, 'without the dig site the hint just says to touch the rock');
  // the rock is still a real button inside the world, and the controls are outside it so they never move with it
  const world = html.slice(html.indexOf('<div id="ck-world"'), html.indexOf('<div id="ck-streak"'));
  assert.ok(world.includes('id="mine-btn"') && !world.includes('id="ck-pad"'));
  assert.ok(html.indexOf('id="ck-pad"') > html.indexOf('id="ck-banner"'), 'controls come after the badges so they sit on top');
});

test('styles: controls are hidden until the dig site is running, only the rock takes touches in the world, the pad owns its gestures', () => {
  assert.match(css, /\.ck-pad, \.ck-dig \{\s*display: none;/);
  assert.match(css, /\.ck-stage\[data-dig="1"\] \.ck-pad \{ display: grid; \}/);
  assert.match(css, /\.ck-stage\[data-dig="1"\] \.ck-dig \{ display: inline-flex; \}/);
  const controls = css.match(/\.ck-pad, \.ck-dig \{[^}]*\}/)[0];
  assert.match(controls, /touch-action: none/, 'dragging the stick must not scroll or zoom the page');
  assert.match(controls, /user-select: none/);
  assert.match(css.match(/\.ck-world \{[^}]*\}/)[0], /pointer-events: none/, 'the empty world never eats a touch meant for something underneath');
  assert.match(css.match(/\.ck-btn \{[^}]*\}/)[0], /pointer-events: auto/, 'the rock button is the one thing that takes touches in the world');
  assert.match(css.match(/\.ck-miner \{[^}]*\}/)[0], /pointer-events: none/, 'a tap on the miner reaches the rock behind him');
  assert.match(css.match(/\.ck-world \{[^}]*\}/)[0], /isolation: isolate/, 'depth z-indexes stay inside the world, under the controls');
  assert.match(css, /\.ck-pad, \.ck-dig \{[^}]*z-index: 6;/);
  // every pose the controller can ask for has a frame, and the facing is a pure mirror
  for (const pose of ['walk1', 'walk2', 'raise', 'strike', 'cheer']) assert.match(css, new RegExp(`\\.ck-miner\\[data-pose="${pose}"\\] \\.ck-hero \\{ background-position: [^;]+; \\}`), pose);
  assert.match(css, /\.ck-miner\[data-face="-1"\] \.ck-flip \{ transform: scaleX\(-1\); \}/);
  assert.match(css, /\.ck-ore\[data-stage="1"\] \.ck-ore-img \{ background-position: 50% 0; \}/);
  assert.match(css, /\.ck-ore\[data-stage="2"\] \.ck-ore-img \{ background-position: 100% 0; \}/);
  // status badge moves to the top so the controls never cover "no energy"
  assert.match(css, /\.ck-stage\[data-dig="1"\] \.ck-status \{ top: 32px; bottom: auto;/);
  // art failed to load → simple drawn stand-ins keep the game playable
  assert.match(css, /\.ck-stage\.no-ore-art \.ck-ore-img/);
  assert.match(css, /\.ck-stage\.no-hero-art \.ck-hero/);
  // no leftovers of the one-frame layout
  assert.doesNotMatch(css, /\.ck-ground|--hero-h|--ore\b/);
});

function webpSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') { const bits = b.readUInt32LE(21); return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }; }
  throw new Error(`unknown WebP chunk ${kind}`);
}

test('sprite sheets: the CSS grid and aspect ratios are the shipped pixels (a re-export with other dimensions would stretch the characters)', () => {
  const dir = path.join(root, 'public', 'assets', 'cave');
  const hero = webpSize(path.join(dir, 'hero-sheet.webp'));
  const ore = webpSize(path.join(dir, 'ore-sheet.webp'));
  assert.equal(hero.w % 3, 0, `hero sheet is three columns (${hero.w})`);
  assert.equal(hero.h % 2, 0, `hero sheet is two rows (${hero.h})`);
  assert.equal(ore.w % 3, 0, `ore sheet is three columns (${ore.w})`);
  const heroCell = { w: hero.w / 3, h: hero.h / 2 }, oreCell = { w: ore.w / 3, h: ore.h };
  // .ck-miner is calc(var(--miner-h) * .92) wide
  near(heroCell.w / heroCell.h, 0.92, 0.005, 'hero cell aspect vs the .92 in clicker.css');
  // .ck-btn / .ck-ghost are calc(var(--rock-w) * .898) tall
  near(oreCell.h / oreCell.w, 0.898, 0.005, 'ore cell aspect vs the .898 in clicker.css');
  assert.match(css, /hero-sheet\.webp\?v=\d+"\) 0 0 \/ 300% 200% no-repeat/, 'three columns × two rows');
  assert.match(css, /ore-sheet\.webp\?v=\d+"\) 0 0 \/ 300% 100% no-repeat/, 'three columns × one row');
  assert.ok(heroCell.h >= 380 && oreCell.h >= 360, 'big enough for a 2x screen at the largest on-screen size');
  assert.ok(fs.statSync(path.join(dir, 'hero-sheet.webp')).size < 260_000 && fs.statSync(path.join(dir, 'ore-sheet.webp')).size < 160_000, 'the sheets stay light (they load on a phone)');
});

test('build and CI know the module: syntax check in the build script and the E2E exercises the controls', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.build, /node --check public\/dig-site\.js/);
  const e2e = read('scripts', 'test-clicker-browser.cjs');
  for (const needle of ['ck-pad', 'ck-dig', 'DigSite']) assert.ok(e2e.includes(needle), `the browser test drives ${needle}`);
});
