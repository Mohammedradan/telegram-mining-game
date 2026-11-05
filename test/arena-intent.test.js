// الساحة التفاعلية: نيّة الخصم خطة معلنة حقيقية (لا تخمين)، وقراءتها لا تغيّر المباراة،
// مع حارس توازن يمنع أن ينزلق اقتصاد المكافأة (50 ذهب/فوز) دون قصد.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/arena-rules');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
// خطة لعب مرجعية بسيطة: عالج عند 40%، أنهِ الخصم إن كان قريبًا، وإلا اضرب ما دامت الطاقة تكفي.
const referencePolicy = (battle) => {
  const can = (a) => R.canAct(battle.player, a);
  if (battle.player.hp <= 40 && can('HEAL')) return 'HEAL';
  if (battle.enemy.hp <= 18 && can('ATTACK')) return 'ATTACK';
  if (battle.player.energy < 3 && can('WAIT')) return 'WAIT';
  return can('ATTACK') ? 'ATTACK' : can('WAIT') ? 'WAIT' : can('DEFEND') ? 'DEFEND' : 'HEAL';
};
function playOut(level, seed, onIntent) {
  const b = R.newBattle({ level, seed });
  const seen = [];
  while (b.active) {
    const intent = R.enemyIntent(b);
    if (onIntent) onIntent(intent, b);
    seen.push(R.playerMove(b, referencePolicy(b)));
    if (!b.active) break;
    seen.push(R.enemyMove(b));
    if (!b.active) break;
    R.nextRound(b);
  }
  return { battle: b, events: seen };
}

test('the announced enemy intent is exactly the move it executes, on every round', () => {
  let checked = 0;
  for (const level of [1, 3, 9, 21]) {
    for (let seed = 1; seed <= 60; seed += 1) {
      const b = R.newBattle({ level, seed });
      while (b.active) {
        const intent = R.enemyIntent(b);
        assert.ok(R.ACTIONS.includes(intent), `intent is a real action (level ${level}, seed ${seed})`);
        R.playerMove(b, referencePolicy(b));
        if (!b.active) break;
        const executed = R.enemyMove(b);
        assert.equal(executed.action, intent, `round ${b.round} of seed ${seed} did what it announced`);
        assert.equal(executed.planned, true);
        checked += 1;
        if (!b.active) break;
        R.nextRound(b);
      }
      assert.equal(R.enemyIntent(b), null, 'a finished match announces nothing');
    }
  }
  assert.ok(checked > 1000, `enough rounds were checked (${checked})`);
});

test('reading the intent never consumes randomness: the match is identical with and without the peek', () => {
  for (const seed of [11, 777, 4242, 31337]) {
    const silent = playOut(4, seed, null);
    const watched = playOut(4, seed, (intent, b) => { R.enemyIntent(b); R.enemyIntent(b); });
    assert.deepEqual(JSON.parse(JSON.stringify(watched.events)), JSON.parse(JSON.stringify(silent.events)));
    assert.deepEqual([watched.battle.outcome, watched.battle.round, watched.battle.enemyTurns],
      [silent.battle.outcome, silent.battle.round, silent.battle.enemyTurns]);
    // والخادم يعيد المباراة بنفس النتيجة من الحركات وحدها
    const replayed = R.replay({ level: 4, seed, moves: silent.battle.moves });
    assert.equal(replayed.ok, true);
    assert.equal(replayed.outcome, silent.battle.outcome);
    assert.equal(replayed.enemyTurns, silent.battle.enemyTurns);
  }
});

test('the plan is committed at the start of the round and consumed by the enemy turn', () => {
  const b = R.newBattle({ level: 2, seed: 99 });
  assert.ok(R.ACTIONS.includes(b.enemyPlan), 'round one has a plan before the player moves');
  const plan = b.enemyPlan;
  R.playerMove(b, 'WAIT');
  assert.equal(b.enemyPlan, plan, 'the player acting does not rewrite the announced plan');
  R.enemyMove(b);
  assert.equal(b.enemyPlan, null, 'the plan is spent after it executes');
  R.nextRound(b);
  assert.ok(R.ACTIONS.includes(b.enemyPlan), 'the next round announces its own plan');
});

test('difficulty guard: a reference strategy still wins about half of its matches', () => {
  let wins = 0, losses = 0, draws = 0;
  for (let seed = 1; seed <= 400; seed += 1) {
    const b = R.newBattle({ level: 3, seed });
    while (b.active) {
      R.playerMove(b, referencePolicy(b));
      if (!b.active) break;
      R.enemyMove(b);
      if (!b.active) break;
      R.nextRound(b);
    }
    if (b.outcome === 'win') wins += 1; else if (b.outcome === 'loss') losses += 1; else draws += 1;
  }
  const rate = wins / 400;
  // الأساس التاريخي ~50%: النطاق واسع بما يكفي لأي تعديل مقصود، وضيّق بما يكفي لالتقاط انزلاق كبير.
  assert.ok(rate > 0.40 && rate < 0.62, `reference win rate ${(rate * 100).toFixed(1)}% stays near the old 51%`);
  assert.equal(wins + losses + draws, 400);
});

test('the arena screen is interactive: announced intent, verdict card, keyboard shortcuts and a clean idle state', () => {
  const html = read('public/index.html');
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  const arena = html.slice(html.indexOf('// ================= ⚔️ ساحة القتال'), html.indexOf('// --- التعزيز والمكافأة اليومية ---'));
  // ١) النيّة تُعرض من المحرك المشترك، وتُخفى أثناء دور الخصم
  assert.match(arena, /const intent = battle\?\.active && !battle\.busy \? ArenaRules\.enemyIntent\(battle\) : null;/);
  assert.match(arena, /chip\.innerHTML = `<b>\$\{meta\.icon\} \$\{meta\.label\}<\/b><i>\$\{meta\.hint\}<\/i>`/);
  assert.match(html, /id="arena-intent" class="arena-intent" hidden/);
  // ٢) حكم النهاية يظهر فوق المسرح بلا حاجة إلى تمرير
  for (const id of ['arena-verdict', 'arena-verdict-badge', 'arena-verdict-title', 'arena-verdict-sub', 'arena-verdict-again']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} exists`);
  }
  assert.match(arena, /function showArenaVerdict\(outcome, sub\)/);
  assert.match(arena, /showArenaVerdict\('win',/);
  assert.match(arena, /hideArenaVerdict\(\);/);
  // ٣) الحالة المرئية: لا أزرار معطّلة قبل البدء
  assert.match(arena, /function syncArenaMode\(\)/);
  assert.match(css, /\.arena-idle #arena-controls \{ display: none; \}/);
  assert.match(css, /\.arena-fighting #arena-start-btn \{ display: none; \}/);
  assert.match(css, /\.arena-intent\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.arena-verdict\[hidden\] \{ display: none; \}/);
  // ٤) الكيبورد: ١-٤ للحركات، الأسهم للحركة، Enter للبدء
  assert.match(arena, /const arenaKeys = \{ '1': 'ATTACK', '2': 'DEFEND', '3': 'HEAL', '4': 'WAIT', '١': 'ATTACK'/);
  assert.match(arena, /'٤': 'WAIT'/, 'Arabic-Indic digits work on an Arabic keyboard');
  assert.match(arena, /arenaAction\(arenaKeys\[event\.key\]\)/);
  assert.match(arena, /event\.key === 'Enter' && !battle\?\.active/);
  // ٥) لا مكتبات جديدة ولا صورة نقطية جديدة ولا مرشّح تكبير/ضباب مضافة هنا
  assert.equal(/cdn|unpkg|jsdelivr/.test(arena), false, 'no external script in the arena block');
  assert.equal((arena.match(/<img/g) || []).length, 0, 'no new images');
  assert.equal(/filter: blur\((2[5-9]|[3-9]\d)\)/.test(css), false, 'no blur above 24px');
  // ٦) احترام تقليل الحركة
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,220}\.arena-intent/);
});
