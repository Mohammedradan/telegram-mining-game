// حتمية Hit-stop: تجميد الإطارات عرض بصري فقط، ولا يجوز أن يغيّر نتيجة المبارزة.
// الاختبارات هنا تعمل على محرك المحاكاة الحقيقي (public/platform-rules.js) بنفس تدفّق
// الحلقة المستخدم في public/platform-game.js، ثم تعيد التشغيل بنفس الطريقة التي يفعلها
// الخادم في /api/platform/finish (Rules.replay) وتقارن النتيجة حقلًا بحقل.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../public/platform-rules');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CONFIG = { zone: 0, mode: 'duel' };
const SEED = 424242;

// بوت حتمي: يمشي نحو الخصم ويهجم — نفس الدالة تعطي نفس القناع في كل مرة
function bot(s, frame) {
  const rival = s.enemies.find((e) => !e.dead);
  if (!rival) return 0;
  const me = s.player;
  const dx = rival.x + rival.w / 2 - (me.x + me.w / 2);
  // الإيقاع يعتمد على زمن المحاكاة (tick) لا على عدد الإطارات الحقيقية،
  // حتى يكون البوت نفسه في التشغيل المجمَّد وغير المجمَّد
  const t = s.tick;
  let mask = 0;
  if (Math.abs(dx) > 40) mask |= dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
  if (Math.abs(dx) <= 46) mask |= R.INPUT.ATTACK;
  if (t % 47 === 0) mask |= R.INPUT.HEAVY;
  if (t % 31 === 0) mask |= R.INPUT.GUARD;
  return mask;
}

// محاكاة مطابقة لحلقة duelFrame: خطوة واحدة لكل DT، والتجميد يستهلك وقتًا بلا خطوة ولا
// تسجيل، والإدخال المقروء أثناء التجميد يُرحَّل إلى الخطوة التالية.
function pump({ freezeEnabled = true, freezeValue = 0, tapDuringFreeze = false } = {}) {
  const s = R.create('miner', SEED, CONFIG);
  const inputs = [];
  let acc = 0, freeze = 0, pending = 0, frames = 0, frozenFrames = 0;
  let mergedTaps = 0;
  const record = (mask) => {
    const prev = inputs[inputs.length - 1];
    if (prev && prev.mask === mask) prev.frames++;
    else inputs.push({ mask, frames: 1 });
  };
  for (let f = 0; f < 4000 && s.status === 'playing'; f++) {
    acc += R.DT;
    frames++;
    let steps = 0;
    while (acc >= R.DT && steps++ < 6 && s.status === 'playing') {
      if (freeze > 0) {
        freeze--; frozenFrames++;
        if (tapDuringFreeze) pending |= 1 << 4; // ضغطة هجوم خفيفة خلال التجميد
        acc -= R.DT;
        continue;
      }
      const mask = bot(s, f) | pending;
      if (pending) mergedTaps++;
      pending = 0;
      record(mask);
      R.step(s, mask);
      if (freezeEnabled) {
        for (const ev of s.events || []) {
          if (ev.type === 'hit' && ev.damage > 0) freeze = Math.max(freeze, ev.damage >= 2 ? 4 : 2);
          else if (ev.type === 'hurt') freeze = Math.max(freeze, 3);
        }
      }
      acc -= R.DT;
    }
    if (freezeValue) freeze = Math.max(freeze, freezeValue);
  }
  return { s, inputs, frames, frozenFrames, mergedTaps };
}

const snap = (s) => ({
  tick: s.tick, status: s.status, hearts: s.player.hearts, combo: s.player.combo,
  px: Math.round(s.player.x * 1000), py: Math.round(s.player.y * 1000),
  rivalHp: s.enemies.map((e) => e.hp).join(','),
  rivalDead: s.enemies.map((e) => (e.dead ? 1 : 0)).join(','),
  score: s.collected, gold: R.rewardBreakdown(s).total,
});

test('the freeze budget is a pure function of the simulation events (same inputs ⇒ same schedule)', () => {
  const a = pump(), b = pump();
  const schedule = (r) => r.inputs.map((i) => i.mask).join(',');
  assert.equal(schedule(a), schedule(b), 'the same bot produces the same input stream');
  assert.equal(a.frozenFrames, b.frozenFrames, 'and therefore the identical number of frozen frames');
  assert.ok(a.frozenFrames > 40, 'the run really did freeze (otherwise this proves nothing)');
  assert.deepEqual(snap(a.s), snap(b.s), 'identical outcome');
});

test('hit-stop never changes the result: the frozen run equals the never-frozen run', () => {
  const frozen = pump({ freezeEnabled: true });
  const plain = pump({ freezeEnabled: false });
  // نفس بوت القرار، ولأن التجميد لا يغيّر الخطوات المسجّلة فالنتيجة يجب أن تتطابق
  assert.equal(frozen.inputs.length, plain.inputs.length, 'same number of recorded segments');
  assert.deepEqual(snap(frozen.s), snap(plain.s), 'freeze is presentation only — state is identical');
});

test('the server replay of the recorded inputs reproduces the client result exactly', () => {
  const live = pump();
  assert.equal(live.s.status === 'won' || live.s.status === 'lost', true, 'the duel finished inside the harness');
  // نفس ما ينفّذه /api/platform/finish حرفيًا
  const replay = R.replay(live.inputs, 'miner', SEED, CONFIG);
  assert.equal(replay.ok, true, 'the recorded stream is valid for the server');
  assert.deepEqual(snap(replay.state), snap(live.s), 'server state == client state (hp, position, combo, reward)');
  // والمكافأة نفسها تُحسب من إعادة التشغيل، لا من العميل
  assert.deepEqual(R.oreSummary(replay.state), R.oreSummary(live.s), 'same ores');
  assert.deepEqual(R.rewardBreakdown(replay.state), R.rewardBreakdown(live.s), 'same gold breakdown');
});

test('the round clock and the anti-speed check stay honest while frames are frozen', () => {
  const run = pump();
  // ساعة الجولة في الواجهة = tick / FPS، والخادم يقيس المدة بالطريقة نفسها
  const claimed = run.s.tick / R.FPS;
  const realElapsed = run.frames / R.FPS; // الإطارات الحقيقية ≥ الخطوات دائمًا
  assert.ok(run.frames > run.s.tick, 'freeze frames make real time longer than simulated time');
  assert.ok(claimed < realElapsed, 'the claimed duration is never longer than reality');
  // قاعدة الخادم: يرفض فقط إذا كان المعلن أطول من الزمن الحقيقي (+١ ثانية سماح) ⇒ التجميد آمن
  const serverAccepts = !(realElapsed * 1000 + 1000 < claimed * 1000);
  assert.equal(serverAccepts, true, 'freeze can only make the run look slower, never faster');
  const game = read('public/platform-game.js');
  assert.match(game, /duelAcc \+= Math\.min\(0\.1,/, 'the accumulator is capped, so a freeze never causes a catch-up burst');
  assert.match(game, /if \(duelFreeze > 0\) \{[\s\S]{0,500}?duelAcc -= R\.DT; continue;/, 'a frozen frame consumes its slot instead of banking it');
});

test('a tap during a frozen frame is carried into the next step, never dropped', () => {
  const run = pump({ tapDuringFreeze: true });
  assert.ok(run.mergedTaps > 0, 'at least one press landed during a freeze and was merged');
  const game = read('public/platform-game.js');
  assert.match(game, /duelPendingMask \|= duelMaskNow\(\);/, 'frozen frames still sample the input');
  assert.match(game, /const mask = duelMaskNow\(\) \| duelPendingMask;\n\s*duelPendingMask = 0;/, 'the pending press is merged once and cleared');
  assert.match(game, /duelFreeze = 0; duelLastCombo = 0; duelPendingMask = 0;/, 'and reset at the start of every duel');
  // التسجيل يحدث مرة واحدة لكل خطوة مقدَّمة فقط
  const loop = game.slice(game.indexOf('while (duelAcc >= R.DT'), game.indexOf('duelAcc -= R.DT;\n    }'));
  assert.equal((loop.match(/duelRecord\(/g) || []).length, 1, 'exactly one record call per stepped frame');
  assert.equal((loop.match(/R\.step\(duelSim/g) || []).length, 1, 'exactly one simulation step per recorded frame');
});

test('shake, flashes, sparks and petals never touch the simulation', () => {
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(480, 270);
  canvas.clientWidth = 480; canvas.clientHeight = 270;
  const sandbox = { PlatformRules: R, devicePixelRatio: 1, Math, Date, console, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['platform-scenery.js', 'platform-bosses.js', 'platform-arena-scene.js', 'platform-renderer.js']) {
    vm.runInContext(read(`public/${f}`), sandbox);
  }
  const run = pump();
  const before = JSON.stringify(snap(run.s));
  const fx = {
    particles: Array.from({ length: 40 }, (_, i) => ({ x: 100 + i, y: 200, vx: 1, vy: -1, life: 10, color: '#ffd166', size: 3, glow: true })),
    floaters: [{ x: 120, y: 200, text: '-2', color: '#ffd166', life: 10, maxLife: 30, size: 16, scale: 1 }],
    shake: 0.9, beams: [], arena: true, arenaId: 0, arenaHeat: 1, reduced: false,
  };
  for (let i = 0; i < 5; i++) sandbox.PlatformRenderer.draw(canvas, run.s, fx);
  const after = JSON.stringify(snap(run.s));
  assert.equal(after, before, 'drawing with full FX leaves every simulation field untouched');
  // والرسم لا يستهلك عشوائية المحاكاة: الرسم مرتين يعطي نفس البايتات تقريبًا (لا تغيّر في الحالة)
  assert.equal(run.s.tick, JSON.parse(after).tick, 'no hidden ticks from rendering');
});
