// The scene's contract with the host page: `create(deps)` / `init(hooks)` must hand back a
// *live* scene (never the module descriptor), the frame loop must advance the simulation at
// a fixed timestep regardless of frame pacing, input must reach the rules, and the op log
// must describe exactly what the server needs to replay.
//
// This file exists because of two shipped-blocking bugs the other suites could not see:
//   1. the UMD wrappers returned `{create, …}` instead of a scene, so every call on
//      `window.AdvMine.scene` silently no-opped and the world never attached;
//   2. the accumulator compared seconds against milliseconds, so `rules.step` never ran
//      and the mine was frozen even once it did attach.
// Both are invisible to state-level tests; only driving real frames catches them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Scene = require('../public/adventure/adventure-scene');
const R = require('../public/adventure/stone-mine-rules');
const M = require('../public/adventure/stone-mine-map');
const Camera = require('../public/adventure/adventure-camera');
const Renderer = require('../public/adventure/adventure-renderer');

/* ------------------------------------------------------------------ DOM stand-ins */

/** A node that records listeners so tests can fire real events at them. */
function makeNode(id, registry, ctx) {
  const node = {
    id,
    hidden: false,
    dataset: {},
    style: {},
    textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    append() {},
    setAttribute(k, v) { node[k] = v; },
    getAttribute(k) { return node[k] === undefined ? null : node[k]; },
    focus() {},
    removeAttribute(k) { delete node[k]; },
    addEventListener(type, fn) {
      const key = id + ':' + type;
      if (!registry.has(key)) registry.set(key, []);
      registry.get(key).push(fn);
    },
    removeEventListener() {},
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 390, height: 700, left: 0, top: 0 }),
    getContext: () => ctx,
  };
  return node;
}

/**
 * A browser stand-in with a hand-cranked clock and rAF queue. Frames are only produced when
 * a test asks for them, which makes the simulation's timing assertions exact.
 */
function harness() {
  const drawCalls = { count: 0 };
  const gradient = () => ({ addColorStop() {} });
  const ctx = new Proxy({}, {
    get(_t, key) {
      if (key === 'canvas') return { width: 390, height: 700 };
      if (key === 'measureText') return () => ({ width: 80 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return gradient;
      if (typeof key === 'string') return () => { drawCalls.count++; };
      return undefined;
    },
    set() { return true; },
  });

  const registry = new Map();
  const nodes = new Map();
  const nodeFor = (id) => {
    if (!nodes.has(id)) nodes.set(id, makeNode(id, registry, ctx));
    return nodes.get(id);
  };

  const listeners = new Map();
  const doc = {
    hidden: false,
    getElementById: nodeFor,
    createElement: (tag) => makeNode(tag, registry, ctx),
    querySelectorAll: () => [],
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
  };

  let clock = 0;
  let pending = null;
  const win = {
    document: doc,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (cb) => { pending = cb; return 1; },
    cancelAnimationFrame: () => { pending = null; },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    performance: { now: () => clock },
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 2,
    innerWidth: 390,
    innerHeight: 700,
  };

  /** Advance `frames` animation frames at ~60 Hz. Returns how many actually ran. */
  function pump(frames, stepMs = 1000 / 60) {
    let ran = 0;
    for (let i = 0; i < frames; i++) {
      if (!pending) break;
      const cb = pending;
      pending = null;
      clock += stepMs;
      cb(clock);
      ran++;
    }
    return ran;
  }

  /** Fire a listener the scene registered on a node (or on the document). */
  function fire(target, type, event) {
    const bag = target === doc ? listeners.get(type) : registry.get(target.id + ':' + type);
    const fn = (bag || [])[0];
    assert.ok(fn, `no ${type} listener on ${target === doc ? 'document' : target.id}`);
    fn(Object.assign({ preventDefault() {}, target: { tagName: 'CANVAS' } }, event || {}));
  }

  return { doc, win, nodes, nodeFor, registry, listeners, pump, fire, drawCalls };
}

function makeScene(extraHooks) {
  const h = harness();
  const scene = Scene.create(Object.assign({
    doc: h.doc,
    win: h.win,
    rules: R,
    map: M,
    camera: Camera,
    renderer: Renderer,
    hooks: { money: () => '0' },
  }, extraHooks || {}));
  assert.ok(scene, 'create() must return a scene');
  return { scene, h };
}

/** Dismiss the intro overlay through the same handler the player's click would hit. */
function start(h, scene) {
  scene.show();
  h.fire(h.nodeFor('adv-start'), 'click');
}

/* ------------------------------------------------------------------ wrappers */

test('create() returns a live scene, not the module descriptor', () => {
  const { scene } = makeScene();
  for (const method of ['show', 'hide', 'resize', 'resume', 'pause', 'destroy', 'snapshot', 'takeBatch', 'flush']) {
    assert.equal(typeof scene[method], 'function', `scene.${method} must be callable`);
  }
  assert.equal(typeof scene.state, 'object');
  assert.equal(typeof scene.paused, 'boolean');
  assert.equal(scene.create, undefined, 'a scene must not expose the module descriptor');
  scene.destroy();
});

/* ------------------------------------------------------------------ the frame loop */

test('the frame loop steps the world once per tick of real time', () => {
  const { scene, h } = makeScene();
  start(h, scene);
  const ran = h.pump(60);
  assert.equal(ran, 60);
  // The first frame only primes `lastTime`, and the accumulator keeps a sub-tick remainder,
  // so 60 frames land within a tick of 60 — the point is that it tracks *frames*, not zero.
  // (The shipped bug this guards advanced the world by exactly 0 ticks, forever.)
  assert.ok(Math.abs(scene.state.tick - 59) <= 2,
    `60 frames must advance ~60 ticks, got ${scene.state.tick}`);
  scene.destroy();
});

test('the loop keeps pace when frames arrive slowly (accumulator, not frames)', () => {
  const { scene, h } = makeScene();
  start(h, scene);
  // 10 frames of 100 ms = 1 second of wall clock. The step guard caps per-frame work, so
  // the tick count must track elapsed time, not the frame count.
  h.pump(10, 100);
  assert.ok(scene.state.tick > 10, `slow frames must still advance time (got ${scene.state.tick})`);
  scene.destroy();
});

test('a long stall is clamped instead of fast-forwarding the mine', () => {
  const { scene, h } = makeScene();
  start(h, scene);
  h.pump(4);
  const before = scene.state.tick;
  h.pump(1, 5000);              // five seconds in a single frame (tab was backgrounded)
  const gained = scene.state.tick - before;
  assert.ok(gained <= 8, `one frame must never advance more than the guard allows (got ${gained})`);
  scene.destroy();
});

/* ------------------------------------------------------------------ input → rules → ops */

test('holding a direction moves the player and the op log mirrors the input', () => {
  const { scene, h } = makeScene();
  start(h, scene);
  h.pump(2);
  const x0 = scene.state.player.x;

  h.fire(h.doc, 'keydown', { code: 'ArrowRight' });
  h.pump(60);
  const x1 = scene.state.player.x;
  assert.ok(x1 > x0, `holding right must move the player east (${x0} -> ${x1})`);

  h.fire(h.doc, 'keyup', { code: 'ArrowRight' });
  const x2 = scene.state.player.x;
  h.pump(30);
  assert.ok(Math.abs(scene.state.player.x - x2) < 1,
    `releasing the key must stop the player (drifted ${(scene.state.player.x - x2).toFixed(2)} px)`);

  const batch = scene.takeBatch();
  assert.ok(batch && batch.ops.length >= 2, 'the op log must record the movement');
  const masks = new Set(batch.ops.map((o) => o.mask));
  assert.ok(masks.has(0), 'the op log must include the idle frames before the input');
  assert.ok(masks.has(R.INPUT.RIGHT), 'the op log must include the right-held frames');
  for (const op of batch.ops) {
    assert.equal(op.t, 'i');
    assert.ok(op.ticks >= 1);
    assert.ok(Number.isInteger(op.mask));
  }
  assert.equal(scene.takeBatch(), null, 'a second take must come back empty');
  scene.destroy();
});

test('the op log coalesces identical input and caps its size', () => {
  const { scene, h } = makeScene();
  start(h, scene);
  h.pump(200);
  const batch = scene.takeBatch();
  assert.equal(batch.ops.length, 1, '200 idle frames are one op, not 200');
  assert.equal(batch.ops[0].mask, 0);
  assert.ok(Math.abs(batch.ops[0].ticks - 199) <= 2,
    `the op must cover the run (got ${batch.ops[0].ticks} ticks)`);
  scene.destroy();
});

test('flush hands the batch to the host exactly once', () => {
  const seen = [];
  const h = harness();
  const scene = Scene.create({
    doc: h.doc, win: h.win, rules: R, map: M, camera: Camera, renderer: Renderer,
    hooks: { money: () => '0' },
    onBatch: (batch) => { seen.push(batch); },
  });
  start(h, scene);
  h.pump(30);
  scene.flush();
  assert.equal(seen.length, 1, 'flush must deliver one batch');
  assert.ok(seen[0].ops.length >= 1);
  scene.flush();
  assert.equal(seen.length, 1, 'flush with nothing pending must not call back');
  scene.destroy();
});

/* ------------------------------------------------------------------ rendering + lifecycle */

test('the world paints every frame and survives a resize', () => {
  const { scene, h } = makeScene();
  start(h, scene);
  h.pump(10);
  const first = h.drawCalls.count;
  assert.ok(first > 100, `the scene must paint a real frame (only ${first} canvas calls)`);
  h.pump(10);
  assert.ok(h.drawCalls.count > first, 'painting must continue while running');
  scene.resize();
  h.pump(5);
  assert.ok(scene.state.tick > 0);
  scene.destroy();
});

test('hiding pauses the loop and showing resumes it without losing state', () => {
  const { scene, h } = makeScene();
  start(h, scene);
  h.pump(30);
  const tick = scene.state.tick;

  scene.hide();
  assert.equal(scene.paused, true);
  h.pump(30);
  assert.equal(scene.state.tick, tick, 'a hidden scene must not advance the world');

  scene.show();
  assert.equal(scene.paused, false);
  h.pump(30);
  assert.ok(scene.state.tick > tick, 'showing must resume the world');
  scene.destroy();
});

test('destroy stops the loop, unbinds input and is safe to call twice', () => {
  const { scene, h } = makeScene();
  start(h, scene);
  h.pump(10);
  scene.destroy();
  assert.equal(scene.running, false);
  assert.equal(h.pump(10), 0, 'no frames may survive destroy');
  scene.destroy();                 // must not throw
});

test('a scene without a canvas degrades to null instead of throwing', () => {
  const h = harness();
  h.nodeFor = () => null;
  h.doc.getElementById = () => null;
  const scene = Scene.create({ doc: h.doc, win: h.win, rules: R, map: M, camera: Camera, renderer: Renderer });
  assert.equal(scene, null);
});

test('create() refuses to build without its collaborators', () => {
  assert.throws(() => Scene.create({ doc: {}, win: {} }), /requires doc, win and rules/);
});
