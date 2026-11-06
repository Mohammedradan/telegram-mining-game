// اختبار رسم حقيقي (بلا متصفح): نُشغّل مسجّل الرسم على قماش وهمي يسجّل كل لون يُملأ،
// ونتأكد أن المبارزة ترسم حلبة المبارزة (حجر/جمهور/رمل) لا أنفاق المنجم، والعكس في جولة التعدين.
// هذا لا يُغني عن اللقطة البصرية، لكنه يُثبت أن المشهد المطلوب هو الذي يُرسم فعلًا.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../public/platform-rules');

const ROOT = path.join(__dirname, '..');

function paint(sim, opts = {}) {
  const paints = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === 'canvas') return canvas;
      if (key === 'measureText') return () => ({ width: 10 });
      if (/^create(Linear|Radial|Conic)Gradient$|^createPattern$/.test(String(key))) return () => gradient;
      if (typeof key === 'string' && target[key] !== undefined) return target[key];
      return () => {};
    },
    set(target, key, value) {
      if (key === 'fillStyle' || key === 'strokeStyle') paints.push(String(value));
      target[key] = value;
      return true;
    },
  });
  const canvas = { clientWidth: 480, clientHeight: 270, width: 480, height: 270, getContext: () => ctx };
  const sandbox = {
    PlatformRules: R,
    devicePixelRatio: 1,
    Math, Date, console,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'platform-scenery.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'platform-bosses.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'platform-renderer.js'), 'utf8'), sandbox);
  assert.ok(sandbox.PlatformRenderer, 'the renderer registers itself');
  sandbox.PlatformRenderer.draw(canvas, sim, { reduced: true, ...opts });
  return paints;
}

const duel = () => {
  const s = R.create(0, 4242, { zone: 0, mode: 'duel' });
  for (let i = 0; i < 30; i++) R.step(s, 0);
  return s;
};
const mine = () => {
  const s = R.create(0, 4242, { zone: 0 });
  for (let i = 0; i < 30; i++) R.step(s, 0);
  return s;
};

test('a duel is painted in the arena (crowd wall, lit torches, sand floor) — not in the mine tunnels', () => {
  const duelPaints = paint(duel());
  assert.ok(duelPaints.includes('#2a1f3a'), 'the arched crowd wall of the arena is drawn');
  assert.ok(duelPaints.includes('#241b34'), 'the stone barrier around the ring is drawn');
  assert.ok(!duelPaints.includes('#5b6e6c'), 'no mining rocks in the arena');
  assert.ok(!duelPaints.includes('#af8d55'), 'no mine signposts in the arena');

  const minePaints = paint(mine());
  assert.ok(!minePaints.includes('#2a1f3a'), 'a mining run never draws the arena wall');
  assert.ok(minePaints.length > duelPaints.length / 3, 'the mine still paints its own scene');
});

test('the arena tab asks the renderer for the arena scene explicitly', () => {
  const game = fs.readFileSync(path.join(ROOT, 'public', 'platform-game.js'), 'utf8');
  assert.match(game, /renderer\.draw\(arenaCanvas, arenaSim, \{ arena: true/, 'the preview stage passes arena: true');
});

test('the arena floor sits exactly on the physics ground so nobody floats', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'public', 'platform-renderer.js'), 'utf8');
  assert.match(renderer, /const ARENA_FLOOR = 300\b/, 'ARENA_FLOOR matches the level ground y = 300');
  const s = duel();
  assert.equal(s.player.y + s.player.h, 300, 'the fighter stands on y = 300');
});
