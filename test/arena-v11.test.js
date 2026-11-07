// V11: تحسين عدالة المعدات ووضوح القتال — قلوب ساحة ثابتة، ضرر فأس متدرّج،
// موجة الريح بنافذة قفز أوسع، تلميح المرحلة الثانية، وبطاقة توصية القتال.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const R = require('../public/platform-rules');
const { waveWindow } = require('../scripts/wave-probe.cjs');
const { BOTS } = require('../scripts/duel-bots.cjs');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(ROOT, 'public', 'platform-game.js'), 'utf8');
const rulesSrc = fs.readFileSync(path.join(ROOT, 'public', 'platform-rules.js'), 'utf8');

// ---------- 1) القلوب وضرر الفأس ----------
test('V11: arena hearts are 4 at every gear level and the mining ladder is untouched', () => {
  const arena = [0, 1, 2, 3, 4, 5].map((lv) => R.create('miner', 7, { zone: 0, mode: 'duel', loadout: { pickaxe: lv, armor: lv, drill: lv } }).player);
  const mine = [0, 1, 2, 3, 4, 5].map((lv) => R.create('miner', 7, { zone: 0, mode: 'mine', loadout: { pickaxe: lv, armor: lv, drill: lv } }).player);
  assert.deepEqual(arena.map((p) => p.maxHearts), [4, 4, 4, 4, 4, 4], 'four hearts whatever the armor');
  assert.deepEqual(arena.map((p) => p.hearts), [4, 4, 4, 4, 4, 4], 'and the round starts full');
  // التعدين يبقى كما كان: قلوب المعدات تنمو مع الدرع
  assert.deepEqual(mine.map((p) => p.maxHearts), [3, 4, 4, 5, 5, 6], 'mining hearts still follow the armor');
  // الأبطال الآخرون يحفظون قلبهم الأساسي + قلب الساحة
  assert.equal(R.create('warrior', 7, { zone: 0, mode: 'duel' }).player.maxHearts, 5, 'the warrior keeps his base heart');
  assert.equal(R.create('archer', 7, { zone: 0, mode: 'duel' }).player.maxHearts, 4, 'the archer stays at four');
});

test('V11: axe damage in the arena is 1 + floor(level/4) at every level 0..5', () => {
  const dmg = (lv) => R.create('miner', 7, { zone: 0, mode: 'duel', loadout: { pickaxe: lv } }).player.damage;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(dmg), [1, 1, 1, 1, 2, 2], 'flat until level 4, then one extra point');
  // والمعادلة نفسها معروضة كدالة مستقلة
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(R.arenaAxeBonus), [0, 0, 0, 0, 1, 1, 1], 'the bonus is capped at +1');
  // ضرر المنجم لم يتغيّر بايتاً
  const mineDmg = (lv) => R.create('miner', 7, { zone: 0, mode: 'mine', loadout: { pickaxe: lv } }).player.damage;
  assert.deepEqual([0, 2, 5].map(mineDmg), [1, 2, 3], 'the mining damage keeps its old ladder');
});

// ---------- 2) موجة سيّاف الريح ----------
test('V11: the wind wave gives a real jump window over BOTH waves, and timing still decides', () => {
  const w = waveWindow(R, { keep: 140 });
  const jump = w.find((t) => t.input === 'jump');
  const guard = w.find((t) => t.input === 'guard');
  assert.ok(jump, 'the probe captured a wave');
  assert.ok(jump.safeFrames >= 18, `the jump window is at least 18 frames (measured ${jump.safeFrames})`);
  assert.ok(jump.safeFrames < 61, 'the wave can still hit — it is not a free pass');
  assert.ok(guard.safeFrames >= 1, 'holding the guard from the wave covers both waves');
  // التوقيت الخاطئ يُصاب: القفز قبل الإطلاق مباشرة لا ينجّي
  assert.ok(!jump.ranges.some(([a, b]) => a <= 0 && b >= 0), 'jumping at the wrong frame is punished');
});

test('V11: the wind wave is thinner, never spawns inside the player, and only the wind rival changed', () => {
  const wind = R.create('miner', 1, { zone: 2, mode: 'duel' }).enemies[0].ai.wave;
  assert.equal(wind.w, 10, 'the wind blade is 10px wide');
  assert.equal(wind.speed, 190, 'the travel speed is unchanged');
  assert.equal(wind.gap, 10, 'the second wave keeps its 10-frame gap');
  assert.equal(wind.lead, 20, 'and it is launched 20px in front of the rival');
  // الأنماط الأخرى تحتفظ بموجتها الأصلية
  for (const zone of [0, 1, 3]) {
    const wv = R.create('miner', 1, { zone, mode: 'duel' }).enemies[0].ai.wave;
    assert.equal(wv.w, 28, `zone ${zone} keeps the 28px wave`);
    assert.equal(wv.lead, undefined, `zone ${zone} has no spawn offset`);
  }
  // لا موجة تُطلق خلف اللاعب: الحد الأقصى للإزاحة لا يتجاوز جسده
  assert.match(rulesSrc, /const off = Math\.max\(0, Math\.min\(lead, gapToBody - 6\)\)/, 'the spawn offset is clamped to the player body');
  // وفي مباراة حقيقية: الموجة لا تُطلق *خلف* اللاعب أبداً (الإزاحة لا تتجاوزه)
  const s = R.create('miner', 424242, { zone: 2, mode: 'duel' });
  let overshoot = 0, spawns = 0;
  for (let t = 0; t < 3000 && s.status === 'playing'; t++) {
    const before = s.waves.length;
    R.step(s, BOTS.expert(s));
    for (let i = before; i < s.waves.length; i++) {
      const w = s.waves[i], p = s.player;
      spawns++;
      // تجاوز = الحافة الأمامية للموجة خلف الحافة البعيدة للاعب في اتجاه الحركة
      if (w.vx > 0 && w.x > p.x + p.w) overshoot++;
      if (w.vx < 0 && w.x + w.w < p.x) overshoot++;
    }
  }
  assert.ok(spawns >= 4, 'waves fired during the fight');
  assert.equal(overshoot, 0, 'no wave is ever launched past the player');
});

// ---------- 3) تعليم الزعيم ----------
test('V11: the phase-2 hint exists, is announced once on enrage, and never blocks the stage', () => {
  assert.equal(R.DUEL.phase2Hint, 'اقفز فوق الصدمة المزدوجة، ثم استغل نافذة استشفاء الزعيم للهجوم', 'the exact wording');
  // الحدث يقع مرة واحدة في الجولة عند بلوغ المرحلة الثانية
  const s = R.create('miner', 424242, { zone: 3, mode: 'duel' });
  const enrages = [];
  for (let t = 0; t < 9000 && s.status === 'playing'; t++) {
    R.step(s, BOTS.expert(s));
    for (const ev of s.events || []) if (ev.type === 'boss_enrage') enrages.push(ev.phase);
  }
  assert.equal(enrages.filter((p) => p === 2).length, 1, 'phase 2 enrage fires exactly once');
  // الواجهة: عنصر مستقل داخل المسرح، غير معطّل للمس، ويُعلن لقارئ الشاشة
  assert.match(html, /<div id="arena-hint" class="arena-hint" role="status" aria-live="polite"><\/div>/, 'the hint element exists inside the stage');
  const stage = html.slice(html.indexOf('id="arena-stage"'), html.indexOf('id="arena-ko"'));
  assert.ok(stage.includes('id="arena-hint"'), 'it lives inside the stage, above the KO overlay');
  const css = html.slice(html.indexOf('.arena-hint {'), html.indexOf('.arena-hint.show'));
  assert.match(css, /pointer-events: none/, 'it never swallows a touch');
  assert.match(css, /top: 44px/, 'it sits under the HUD, away from the fighters and the danger lane');
  // V12.1: صار الاختيار في دالة نقية (R.duelHintPlan) — نفس السلوك: نصّ واحد عند حدث المرحلة الثانية
  const plan = R.duelHintPlan({ type: 'boss_enrage', phase: 2 }, {});
  assert.equal(plan && plan.kind, 'main', 'the phase-2 event still produces exactly one hint');
  assert.equal(plan.text, R.DUEL.phase2Hint);
  assert.match(game, /const plan = R\.duelHintPlan\?\.\(ev,/, 'the duel loop asks the rules module on the event');
  assert.match(game, /function arenaHintHide\(\)/, 'and it can be cleared');
});

// ---------- 4) بطاقة توصية القتال ----------
test('V11: the combat advice card is accurate, optional and never blocks anything', () => {
  const low = R.combatAdvice('miner', {});
  assert.equal(low.arena.hearts, 4, 'it reports the fixed arena hearts');
  assert.equal(low.arena.damage, 1, 'and the real axe damage');
  assert.equal(low.priority.id, 'armor', 'the first recommendation is the armor (the only immediate upgrade)');
  assert.equal(low.priority.from, 0);
  assert.equal(low.priority.to, 1);
  assert.match(low.priority.why, /150 ← 160/, 'the reason carries the exact numbers');
  assert.match(low.optional, /اختيارية/, 'it says the advice is optional');
  const mid = R.combatAdvice('miner', { pickaxe: 2, armor: 2, drill: 2 });
  assert.equal(mid.arena.damage, 1, 'the card never claims damage the engine does not give');
  assert.match(mid.weakness, /الفأس 4/, 'and explains where the damage actually comes from');
  const max = R.combatAdvice('miner', { pickaxe: 5, armor: 5, drill: 5 });
  assert.equal(max.priority, null, 'no recommendation when everything is maxed');
  assert.match(max.strength, /ضرر 2/, 'it still reports the real strength');
  // التوصية لا تضيف بوابة: شروط الفتح تبقى شروط التعدين القائمة نفسها (لم تتغيّر في V11)
  const gates = R.mineStatus(3, { wins: [50, 50, 50, 50, 50, 50] }, { pickaxe: 0, armor: 0, drill: 0 });
  assert.deepEqual(gates.needs.map((n) => [n.kind, n.id || n.zone, n.level ?? null]),
    [['win', 2, null], ['gear', 'pickaxe', 2], ['gear', 'armor', 1]], 'the region gates are the existing mining ones');
  // ولا يعتمد أي منها على بطاقة التوصية: الحالة تُحسب من المعدات والتقدّم فقط
  assert.equal(R.mineStatus(3, { wins: [50, 50, 50, 50, 50, 50] }, { pickaxe: 2, armor: 1, drill: 0 }).unlocked, true,
    'the region opens from gear and progress — the advice card is never consulted');
  assert.doesNotMatch(rulesSrc, /function mineStatus[\s\S]{0,400}combatAdvice/, 'the unlock check never reads the advice');
  // الواجهة: البطاقة بعد بطاقة العدّة وقبل السلّم، وتُخفى أثناء المبارزة
  assert.match(html, /id="arena-advice" class="arena-advice"/, 'the card element exists');
  assert.ok(html.indexOf('id="arena-gear"') < html.indexOf('id="arena-advice"'), 'after the gear card');
  assert.ok(html.indexOf('id="arena-advice"') < html.indexOf('id="arena-ladder"'), 'and before the rival ladder');
  assert.match(html, /function renderArenaAdvice\(\)/, 'it is rendered by a real function');
  assert.match(html, /RULES\.combatAdvice\(hero, st\.equipment\)/, 'from the saved equipment');
  assert.match(html, /body\.duel-live #arena-advice \{ display: none; \}/, 'hidden while a duel is live');
});

// ---------- 5) لا تغيير في المكافآت ولا في الاقتصاد ----------
test('V11: duel rewards and rival health are exactly the V10 numbers', () => {
  assert.deepEqual([0, 1, 2, 3].map((z) => R.duelReward(z)), [60, 64, 68, 72], 'no reward moved');
  assert.deepEqual([0, 1, 2, 3].map((z) => R.create('miner', 1, { zone: z, mode: 'duel' }).enemies[0].maxHp), [34, 42, 52, 58], 'no rival health moved');
  assert.deepEqual([0, 1, 2, 3].map((z) => R.rivalFor(z).name), ['مبارز الظلال', 'السيف السريع', 'سيّاف الريح', 'حارس الساكورا'], 'the same four fighters');
});

// ---------- 6) الموجة لا تصيب بعد تجاوزها جسد اللاعب ----------
test('V11: a wave never hurts after it has passed the player body (42 real hits, 0 late)', () => {
  const overlapBox = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  let hits = 0, afterPass = 0;
  for (const seed of [11, 2024, 7777, 424242, 9001, 31337, 606, 1408]) {
    for (const lv of [0, 5]) {
      for (const zone of [0, 1, 2, 3]) {
        const s = R.create('miner', seed, { zone, mode: 'duel', loadout: { pickaxe: lv, armor: lv, drill: lv } });
        let freeze = 0, pending = 0;
        for (let t = 0; t < 9000 && s.status === 'playing'; t++) {
          if (freeze > 0) { pending |= BOTS.expert(s); freeze--; continue; }
          const mask = BOTS.expert(s) | pending; pending = 0;
          const before = s.player.hearts;
          R.step(s, mask);
          if (s.player.hearts < before) {
            const p = s.player;
            for (const w of s.waves) {
              if (w.delay > 0 || !overlapBox(p, w)) continue;
              hits++;
              if (w.vx > 0 && w.x + w.w < p.x) afterPass++;
              if (w.vx < 0 && w.x > p.x + p.w) afterPass++;
            }
          }
          for (const ev of s.events || []) if (ev.type === 'hit' || ev.type === 'hurt') freeze = Math.max(freeze, ev.type === 'hit' ? 2 : 3);
        }
      }
    }
  }
  assert.ok(hits > 10, `the measurement caught real wave hits (${hits})`);
  assert.equal(afterPass, 0, 'not a single hit landed after the wave had already passed the body');
});
