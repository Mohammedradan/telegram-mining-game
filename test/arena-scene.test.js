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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'platform-arena-scene.js'), 'utf8'), sandbox);
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

test('a duel paints the ninja arena (moonlit temple, sakura petals, two fighters) — never the mine tunnels', () => {
  const duelPaints = paint(duel(), { arena: true });
  assert.ok(duelPaints.includes('#ffc2dd'), 'falling sakura petals are drawn');
  assert.ok(duelPaints.includes('#f9a8d4'), 'sakura blossoms are drawn');
  assert.ok(duelPaints.includes('#ef2d56'), 'the shadow warrior (red scarf) is on the stage');
  assert.ok(duelPaints.includes('#7c3aed'), 'the shadow ninja (violet scarf) is on the stage');
  assert.ok(duelPaints.includes('#7c1d22'), 'the torii gate is drawn');
  assert.ok(!duelPaints.includes('#5b6e6c'), 'no mining rocks in the arena');
  assert.ok(!duelPaints.includes('#af8d55'), 'no mine signposts in the arena');

  const minePaints = paint(mine());
  assert.ok(!minePaints.includes('#ffc2dd'), 'a mining run never draws the arena petals');
  assert.ok(!minePaints.includes('#7c1d22'), 'a mining run never draws the torii gate');
  assert.ok(minePaints.includes('#5b6e6c'), 'the mine still paints its own rocks');
});

test('the arena scene is a real module: four themed arenas and procedural ninjas', () => {
  const sandbox = { Math, Date, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'platform-arena-scene.js'), 'utf8'), sandbox);
  const A = sandbox.PlatformArenaScene;
  assert.equal(A.ARENAS.length, 4, 'four arenas are defined');
  assert.equal(A.ARENAS.map(a => a.id).join(','), 'sakura,bamboo,mountain,fortress');
  for (const id of [0, 1, 2, 3]) assert.equal(A.arenaFor(id).id, A.ARENAS[id].id, `arena ${id} resolves`);
  assert.equal(typeof A.backdrop, 'function');
  assert.equal(typeof A.fighter, 'function');
  // كل ساحة لها سماء ولون بتلات ولوحة مختلفة
  const skies = new Set(A.ARENAS.map(a => a.sky[1]));
  assert.equal(skies.size, 4, 'each arena has its own palette');
});

test('the katana arc is driven by the recorded swing frames and reads light vs heavy', () => {
  const scene = fs.readFileSync(path.join(ROOT, 'public/platform-arena-scene.js'), 'utf8');
  assert.match(scene, /function bladePose\(ent, p, isPlayer\)/, 'one place derives the blade pose');
  assert.match(scene, /const k = 1 - Math\.min\(1, Math\.max\(0, sw\.ticks\) \/ Math\.max\(1, frames\)\)/, 'the sweep is a function of the recorded swing frames only');
  assert.match(scene, /const heavy = sw\.kind === 'heavy';/, 'the heavy hit is distinguished');
  assert.match(scene, /const finisher = !heavy && Boolean\(sw\.finisher\)/, 'and so is the chain finisher');
  assert.match(scene, /blade\.heavy \? '255,224,150' : blade\.finisher \? '255,190,235' : '170,230,255'/, 'each kind has its own trail colour');
  assert.match(scene, /c\.arc\(0, 0, r - i \* 3, tipA - span, tipA\)/, 'the trail follows the blade tip angle');
  assert.match(scene, /if \(isPlayer && ent\.skill\)/, 'the shadow dash draws afterimages from the real skill state');
  // ولا شيء من هذا يكتب في المحاكاة
  assert.doesNotMatch(scene, /ent\.swing\.ticks\s*(-=|=)/, 'the scene never mutates the swing');
});

test('the attack telegraph is built from the same fields the engine acts on', () => {
  const scene = fs.readFileSync(path.join(ROOT, 'public/platform-arena-scene.js'), 'utf8');
  const rules = fs.readFileSync(path.join(ROOT, 'public/platform-rules.js'), 'utf8');
  // الحالة والمؤقّت من المحاكاة نفسها، لا من عدّاد عرض مستقل
  assert.match(scene, /ent\.state === 'windup' && !ent\.dead/, 'the cue follows the real windup state');
  assert.match(scene, /const t = 1 - ent\.timer \/ Math\.max\(1, ent\.ai \? ent\.ai\.windup : 38\)/, 'and counts down with the engine timer');
  // نفس الحقل الذي يحدّد «كاسرة لا تُصدّ» في المحرك
  assert.match(rules, /unblockable: b\.attack === 'overhead'/, 'the engine marks the overhead as unblockable');
  assert.match(scene, /const unblockable = ent\.attack === 'overhead';/, 'so the cue uses exactly that field');
  // لا يوجد إنذار زائف لنافذة استشفاء لا يفرضها المحرك
  assert.doesNotMatch(scene, /ent\.state === 'recover' && !ent\.dead/, 'no cue for a punish window the engine does not enforce');
});

test('the arena heats up as the rival weakens and fighters flash when hit', () => {
  const scene = fs.readFileSync(path.join(ROOT, 'public', 'platform-arena-scene.js'), 'utf8');
  assert.match(scene, /function backdrop\(c, w, tick, reduced, camera, arenaId, heat = 0\)/, 'the backdrop takes the fight heat');
  assert.match(scene, /if \(heat > 0\.02\)/, 'and only reacts once the rival is hurt');
  assert.match(scene, /const hurtFlash = isPlayer \? \(ent\.invulnerable > 0/, 'a hit flashes the fighter');
  const renderer = fs.readFileSync(path.join(ROOT, 'public', 'platform-renderer.js'), 'utf8');
  assert.match(renderer, /ArenaScene\.backdrop\(c, w, s\.tick, reduced, camera, arenaId, \$?\{?[^)]*arenaHeat/, 'the heat reaches the scene from the renderer');
  const game = fs.readFileSync(path.join(ROOT, 'public', 'platform-game.js'), 'utf8');
  assert.match(game, /function duelHeat\(\)/, 'the duel computes heat from the rival health');
  assert.match(game, /arenaHeat: duelHeat\(\)/, 'and passes it while drawing');
});

test('the play canvas never paints the ninja arena — even if a duel simulation is drawn there', () => {
  const plain = paint(duel());
  assert.ok(!plain.includes('#ffc2dd'), 'no sakura petals without opts.arena');
  assert.ok(!plain.includes('#7c1d22'), 'no torii gate without opts.arena');
  const renderer = fs.readFileSync(path.join(ROOT, 'public', 'platform-renderer.js'), 'utf8');
  assert.match(renderer, /const arenaMode = !!opts\.arena;/, 'arena art is opt-in only, never implied by the run mode');
});

test('the arena tab asks the renderer for the arena scene explicitly', () => {
  const game = fs.readFileSync(path.join(ROOT, 'public', 'platform-game.js'), 'utf8');
  assert.match(game, /renderer\.draw\(arenaCanvas, arenaSim, \{\s*arena: true/, 'the preview stage passes arena: true');
});

test('the arena floor sits exactly on the physics ground so nobody floats', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'public', 'platform-renderer.js'), 'utf8');
  assert.match(renderer, /const ARENA_FLOOR = 300\b/, 'ARENA_FLOOR matches the level ground y = 300');
  const s = duel();
  assert.equal(s.player.y + s.player.h, 300, 'the fighter stands on y = 300');
});
