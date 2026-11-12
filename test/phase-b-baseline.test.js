// المرحلة B — الخطوة B0: قياس قبل التحسين، وحارس لا يسمح بأن يُخفى تغيير سلوكي داخل «إحساس».
//
// هذا الملف لا يضيف مؤثراً ولا يغيّر سلوكاً. وظيفته تثبيت خط الأساس الذي تُقاس عليه كل مجموعات المرحلة B:
//   1) أي حدث يُصدره المحرك فعلاً يجب أن يكون له مسار تغذية راجعة موثّق، أو أن يكون مسجّلاً في قائمة الفجوات.
//   2) ما يعالجه العميل اليوم لا يُحذف بالخطأ أثناء إعادة التنظيم.
//   3) سقوف العرض (جزيئات، أصوات، DPR، تجميد الضربة) تبقى كما هي أو أفضل.
//   4) **بصمة المحاكاة**: أي تغيير في الفيزياء/الذكاء يكسر التجزئة ⇒ يجب أن يكون مقصوداً ومعلناً (VERSION)،
//      لا أثراً جانبياً لتعديل «شكلي».
//   5) كلفة إعادة تشغيل الجولة على الخادم تبقى في الميزانية.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const R = require('../public/platform-rules');
const bot = require('./fixtures/platform-bot.cjs');
const doc = require('./fixtures/phase-b-baseline.json');

const repo = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
const game = read('public/platform-game.js');
const renderer = read('public/platform-renderer.js');
const caveSound = read('public/cave-sound.js');

// نفس بناء الأشرطة المستخدم في توليد الخط الأساسي — البصمات لا تُقارن بغيرها
function winTape(zone, seed = 1300 + zone) {
  const cfg = { zone, goal: 'ore', mode: 'mine', loadout: {} };
  const sol = bot(seed, 'warrior', cfg);
  return { inputs: sol.inputs, seed, hero: 'warrior', cfg };
}
function clockTape() {
  const masks = [];
  for (let t = 0; t < 246; t++) masks.push(R.INPUT.RIGHT | R.INPUT.MINE | (t % 18 < 6 ? R.INPUT.JUMP : 0));
  while (masks.length < R.MAX_TICKS) masks.push(0);
  const packed = [];
  let m = 0, f = 0;
  for (const mm of masks) { if (mm === m) { f += 1; continue; } if (f) packed.push({ mask: m, frames: f }); m = mm; f = 1; }
  if (f) packed.push({ mask: m, frames: f });
  return packed;
}
const project = (s) => JSON.stringify({
  tick: s.tick, status: s.status, collected: s.collected, mined: s.mined, defeated: s.defeated || 0,
  hearts: s.player.hearts, x: +s.player.x.toFixed(3), y: +s.player.y.toFixed(3),
  ores: R.oreSummary(s), milestones: [...(s.milestones || [])].sort(), boss: s.bossDefeated === true,
});
const hashOf = (s) => crypto.createHash('sha256').update(project(s)).digest('hex').slice(0, 16);
const beepVoices = () => {
  const at = game.indexOf('function beep');
  const block = game.slice(at, at + 3000);
  return new Set([...block.matchAll(/^\s{8}([a-z_]+):\s*\{/gm)].map((m) => m[1]));
};
const clientHandled = () => new Set([...game.matchAll(/event\.type\s*===\s*'([a-z_]+)'/g)].map((m) => m[1]));

test('B0: every event the engine emits is either handled, sounded, or a documented gap', () => {
  const emitted = new Set();
  const record = (s) => { for (const e of s.events || []) emitted.add(e.type); s.events = []; };
  for (let zone = 0; zone < 6; zone++) {
    const cfg = { zone, goal: 'ore', mode: 'mine', loadout: {} };
    const seed = 500 + zone * 7 + 5;
    const sol = bot(seed, 'miner', cfg);
    const s = R.create('miner', seed, cfg);
    for (const seg of sol.inputs) for (let i = 0; i < seg.frames; i++) { R.step(s, seg.mask); record(s); }
    const idle = R.create('miner', 11, { zone, goal: 'ore', mode: 'mine', loadout: {} });
    for (let i = 0; i < R.MAX_TICKS && idle.status === 'playing'; i++) { R.step(idle, 0); record(idle); }
    const duel = R.create('miner', 12, { zone, goal: 'ore', mode: 'duel', loadout: {} });
    for (let i = 0; i < 60 * 40 && duel.status === 'playing'; i++) { R.step(duel, i % 120 < 60 ? R.INPUT.RIGHT : R.INPUT.ATTACK); record(duel); }
  }
  const known = new Set(doc.eventTypes);
  const fresh = [...emitted].filter((t) => !known.has(t));
  assert.deepEqual(fresh, [], `an event type the baseline never saw appeared: ${fresh.join(', ')} — document its feedback first`);

  const handled = clientHandled(), voiced = beepVoices();
  const gaps = [...emitted].filter((t) => !handled.has(t) && !voiced.has(t)).sort();
  const undocumented = gaps.filter((t) => !doc.uncovered.includes(t));
  assert.deepEqual(undocumented, [], `these events have neither a handler nor a sound and are not in the baseline's gap list: ${undocumented.join(', ')}`);
});

test('B0: no feedback path recorded in the baseline has been deleted', () => {
  const handled = clientHandled(), voiced = beepVoices();
  assert.deepEqual(doc.silentButHandled.filter((t) => !handled.has(t)), [], 'a handled-but-silent event lost its handler');
  for (const type of doc.handled) assert.ok(handled.has(type) || voiced.has(type), `feedback for "${type}" disappeared`);
  for (const type of doc.voiced) assert.ok(voiced.has(type), `the sound for "${type}" disappeared`);
});

test('B0: presentation budgets stay capped (particles, voices, DPR, hit-stop)', () => {
  const n = (re) => { const m = game.match(re) || renderer.match(re) || caveSound.match(re); return m ? Number(m[1]) : null; };
  assert.equal(n(/particles\.length > (\d+)/), doc.budgets.particles, 'the particle budget is the recorded one');
  assert.equal(n(/MAX_VOICES = (\d+)/), doc.budgets.voices, 'the simultaneous-voice budget');
  assert.equal(n(/devicePixelRatio \|\| 1, (\d+(?:\.\d+)?)\)/), doc.budgets.dprCap, 'the device-pixel-ratio cap');
  assert.equal(n(/Math\.min\((\d+), ms\)/), doc.budgets.hitstopMs, 'the longest single hit-stop');
  const p = R.create('miner', 1, { zone: 0 });
  assert.equal(p.player.coyote, doc.budgets.coyote, 'coyote frames');
  assert.match(read('public/platform-rules.js'), /jumpBuffer = \(mask & INPUT\.JUMP\)[\s\S]{0,80}?6 :/, 'jump buffer of 6 frames');
});

test('B0: the stone-mine simulation is still bit-identical to the recorded baseline (VERSION 13)', () => {
  assert.equal(R.VERSION, 13, 'V20 versions the geometry change; the stone-mine baseline remains unchanged');
  // الأشرطة نفسها محفوظة في الخط الأساسي (لا تُعاد بالبوت): لو تغيّرت الفيزياء لَتغيّرت الحالة الناتجة،
  // فيسقط هذا الاختبار حتى يُعلَن التغيير عمداً ويُرفع VERSION. هذا هو صمّام أمان «الإحساس بلا تغيير سلوكي».
  for (const tape of doc.simTapes) {
    const inputs = tape.inputs.map(([mask, frames]) => ({ mask, frames }));
    const res = R.replay(inputs, tape.hero, tape.seed, tape.cfg);
    assert.equal(res.ok, true, `${tape.id}: the recorded tape no longer replays`);
    assert.equal(hashOf(res.state), tape.hash, `${tape.id}: the simulation changed shape (physics/AI), not just presentation`);
  }
});

test('B0: server-side replay of a full run stays inside its measured budget', () => {
  for (const zone of [0, 2, 5]) {
    const t = winTape(zone, 900 + zone);
    const res = R.replay(t.inputs, t.hero, t.seed, t.cfg);
    assert.equal(res.ok, true);
    assert.equal(res.state.status, 'won');
    const t0 = process.hrtime.bigint();
    R.replay(t.inputs, t.hero, t.seed, t.cfg);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // الخط الأساسي: 2.9 / 6.8 / 7.9 مللي ثانية. السقف 250ms هامش CI سخي، لكنه يمنع انحداراً هائلاً.
    assert.ok(ms < 250, `mine ${zone}: a full server replay took ${ms.toFixed(1)}ms`);
  }
});
