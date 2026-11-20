// The renderer's contract: it must paint a full frame from state alone, never mutate the
// simulation, cull off-screen work, and degrade to a drawable cave when art cannot load.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Renderer = require('../public/adventure/adventure-renderer');
const R = require('../public/adventure/stone-mine-rules');
const M = require('../public/adventure/stone-mine-map');

/** A canvas 2D context stand-in that records what was asked of it. */
function fakeContext() {
  const ops = {};
  const target = {};
  const ctx = new Proxy(target, {
    get(state, key) {
      if (key === 'canvas') return { width: 800, height: 450 };
      if (key === 'measureText') return () => ({ width: 120 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (typeof key === 'string' && !(key in state)) return (...args) => { ops[key] = (ops[key] || 0) + 1; return args; };
      return state[key];
    },
    set(state, key, value) { state[key] = value; return true; },
  });
  return { ctx, ops };
}

function frame(overrides) {
  return Object.assign({
    state: R.freshState(),
    map: M,
    camera: { x: 600, y: 200 },
    view: { w: 800, h: 450 },
    assets: { get: () => null, load() {}, progress: 0, ready: false },
    backdrop: null,
    quality: 'high',
    reduced: false,
    time: 1234,
    prompt: null,
  }, overrides);
}

test('a frame is painted and balanced (every save is restored)', () => {
  const { ctx, ops } = fakeContext();
  Renderer.draw(ctx, frame());
  assert.ok(ops.clearRect >= 1, 'the frame starts clean');
  assert.ok(ops.fillRect > 20, 'floors, ore and machines are painted');
  assert.equal(ops.save, ops.restore, 'the transform stack is balanced');
  assert.ok(ops.translate >= 1, 'the world is drawn through the camera');
});

test('drawing never mutates the simulation', () => {
  const state = R.freshState();
  const before = JSON.stringify(R.snapshotOf(state));
  const { ctx } = fakeContext();
  Renderer.draw(ctx, frame({ state }));
  Renderer.draw(ctx, frame({ state, reduced: true, quality: 'low' }));
  Renderer.draw(ctx, frame({ state, prompt: { x: 900, y: 280, glyph: '⛏' } }));
  assert.equal(JSON.stringify(R.snapshotOf(state)), before, 'rendering is read-only');
});

test('off-screen work is culled', () => {
  const near = fakeContext();
  Renderer.draw(near.ctx, frame({ camera: { x: 700, y: 200 } }));
  const far = fakeContext();
  Renderer.draw(far.ctx, frame({ camera: { x: 3000, y: 900 } }));
  // Both paint the same floor and cave, but the far camera has fewer world objects in view.
  assert.ok(far.ops.fillRect > 0);
  assert.notEqual(near.ops.fillRect, far.ops.fillRect, 'culling changes how much is drawn');
});

test('missing art degrades to vectors instead of throwing', () => {
  const { ctx, ops } = fakeContext();
  assert.doesNotThrow(() => Renderer.draw(ctx, frame({ assets: { get: () => null, load() {}, progress: 0, ready: false } })));
  assert.ok(ops.fill > 0, 'the vector fallback still draws the miner and the veins');

  const withArt = fakeContext();
  const sprite = { width: 1104, height: 800 };
  assert.doesNotThrow(() => Renderer.draw(withArt.ctx, frame({
    assets: { get: () => sprite, load() {}, progress: 1, ready: true },
  })));
});

test('reduced motion and low quality remove ambient motion, not gameplay cues', () => {
  const full = fakeContext();
  Renderer.draw(full.ctx, frame());
  const calm = fakeContext();
  Renderer.draw(calm.ctx, frame({ reduced: true, quality: 'low' }));
  assert.ok(calm.ops.arc > 0, 'the vein pips and machine status lights are still drawn');
  assert.ok(calm.ops.fillRect > 0);
  // The vignette/lamp pass is the expensive ambient work; it must not run on low quality.
  assert.ok(full.ops.fillRect >= calm.ops.fillRect);
});

test('the world renders at every supported viewport without throwing', () => {
  const viewports = [[320, 568], [360, 640], [390, 844], [640, 360], [844, 390], [1280, 800], [1920, 1080]];
  for (const [w, h] of viewports) {
    const { ctx, ops } = fakeContext();
    assert.doesNotThrow(() => Renderer.draw(ctx, frame({ view: { w, h }, camera: { x: 0, y: 0 } })), `${w}x${h} must render`);
    assert.equal(ops.save, ops.restore, `${w}x${h} leaves a balanced stack`);
  }
});

test('the renderer knows the sprite sheets the game actually ships', () => {
  // Guards against a rename that would silently blank the miner.
  for (const [, src] of Object.entries(Renderer.ASSET)) {
    assert.match(src, /^\/assets\/cave\//, `${src} must live in the cave asset folder`);
  }
  assert.equal(Object.keys(Renderer.HERO_POSE).length, 6, 'the hero sheet has six poses');
  // 3 columns x 2 rows: every pose must address a real cell.
  for (const [col, row] of Object.values(Renderer.HERO_POSE)) {
    assert.ok(col >= 0 && col < 3, 'hero column in range');
    assert.ok(row >= 0 && row < 2, 'hero row in range');
  }
});
