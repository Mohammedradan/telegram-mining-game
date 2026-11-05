// V6: أهداف الجولة الثلاثة، ساحة المفترق (العرق النادر + صندوق المخاطرة)، ونسمة الخام.
// كل شيء حتمي ومحسوب من القواعد المشتركة نفسها؛ لا ذهب جديد ولا سقف جديد — المكافأة خامات داخل الجولة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
// اللاعب يقف على أرض المفترق أمام العنصر المطلوب ومتّجه لليمين (مدى الضربة 66 بكسل).
const atPerch = (zone = 0, goal = 0, hero = 'miner') => {
  const s = R.create(hero, 7, { zone, goal });
  s.player.x = s.vein.x - s.player.w + 6; s.player.y = s.perch.y - s.player.h; s.player.grounded = true; s.player.facing = 1;
  return s;
};
const atFork = (zone = 0, goal = 0, hero = 'miner') => {
  const s = atPerch(zone, goal, hero);
  s.vein.broken = true; s.veinBroken = true; // العرق مكسور مسبقاً كي تُوجَّه الضربة إلى الصندوق
  s.player.x = s.fork.x - s.player.w + 4;
  return s;
};
// ضربة واحدة + إطاران للتهدئة: تُرجع أحداث تلك الضربة قبل أن تُفرَّغ في الإطار التالي.
const pressMine = (s, frames = 20) => { R.step(s, R.INPUT.MINE); const events = s.events.slice(); for (let i = 0; i < frames; i++) R.step(s, 0); return events; };
const tick = (s, n) => { for (let i = 0; i < n; i++) R.step(s, 0); };

test('V6 goals: three run goals, safe normalisation, and a config that keeps the goal', () => {
  assert.equal(R.VERSION, 6);
  assert.equal(R.GOALS.length, 3);
  assert.deepEqual(R.GOALS.map(g => g.id), ['ore', 'vein', 'speed']);
  for (const g of R.GOALS) { assert.ok(g.name.length > 2); assert.ok(g.blurb.length > 5); assert.ok(g.hint.length > 5); }
  assert.equal(R.normalizeConfig({ goal: 2 }).goal, 2);
  assert.equal(R.normalizeConfig({ goal: 7 }).goal, 0, 'an unknown goal falls back to the first one');
  assert.equal(R.normalizeConfig({ goal: '1' }).goal, 0, 'a string goal is not accepted');
  assert.equal(R.normalizeConfig({ zone: 3, goal: 1 }).zone, 3, 'goal and mine are independent');
  assert.equal(R.create('miner', 5, { goal: 1 }).goal, 1, 'the goal is part of the run state');
  assert.equal(R.create('miner', 5, { goal: 1 }).version, R.VERSION);
});

test('V6 goals: ore goal counts real ore units and scales with mine depth', () => {
  assert.equal(R.oreTarget(0), 14);
  assert.equal(R.oreTarget(5), 24);
  const s = R.create('miner', 7, { zone: 0, goal: 0 });
  let goal = R.goalStatus(s);
  assert.deepEqual([goal.id, goal.now, goal.target, goal.done], ['ore', 0, 14, false]);
  s.ores.copper = 9; s.ores.iron = 4;
  goal = R.goalStatus(s);
  assert.deepEqual([goal.now, goal.done], [13, false]);
  s.ores.crystal = 1;
  assert.deepEqual([R.goalStatus(s).now, R.goalStatus(s).done], [14, true]);
  assert.equal(R.oreTotal(s), 14);
});

test('V6 goals: vein goal tracks the three strikes and completes only when the vein breaks', () => {
  const s = atPerch(0, 1);
  assert.deepEqual([R.goalStatus(s).now, R.goalStatus(s).target, R.goalStatus(s).done], [0, 3, false]);
  pressMine(s, 16); assert.deepEqual([R.goalStatus(s).now, R.goalStatus(s).done], [1, false]);
  pressMine(s, 16); assert.deepEqual([R.goalStatus(s).now, R.goalStatus(s).done], [2, false]);
  pressMine(s, 16);
  assert.equal(s.veinBroken, true);
  assert.deepEqual([R.goalStatus(s).now, R.goalStatus(s).done], [3, true]);
});

test('V6 goals: the speed goal needs a real win inside 75 seconds', () => {
  const s = R.create('miner', 7, { zone: 0, goal: 2 });
  assert.equal(R.goalStatus(s).target, 75);
  assert.equal(R.goalStatus(s).done, false, 'a playing run never satisfies the gate race');
  s.tick = 60 * 60; s.status = 'won';
  assert.equal(R.goalStatus(s).done, true, 'a win at 60s counts');
  s.tick = 60 * 80;
  assert.equal(R.goalStatus(s).done, false, 'a win after 75s does not count');
  s.status = 'lost'; s.tick = 60 * 40;
  assert.equal(R.goalStatus(s).done, false, 'a loss never counts even when fast');
});

test('V6 vein: three quick strikes break it and pay the rare ore of the mine', () => {
  const s = atPerch(0, 0);
  const before = { ...s.ores };
  const events = pressMine(s, 16);
  assert.equal(s.vein.hp, 2);
  const hit = events.find(e => e.type === 'vein_hit');
  assert.ok(hit && hit.maxHp === 3 && hit.hp === 2 && hit.ticks > 0, 'the HUD gets the remaining strikes and the timer');
  pressMine(s, 16); const broke = pressMine(s, 16);
  assert.equal(s.vein.broken, true);
  assert.equal(s.veinBroken, true);
  // المنجم الحجري: الخام النادر = ذهب خام
  assert.equal(s.ores.gold - (before.gold || 0), 2, 'the vein pays two rare ore');
  const brokeEvent = broke.find(e => e.type === 'vein_break');
  assert.deepEqual(brokeEvent.ores, { gold: 2 });
});

test('V6 vein: it re-hardens when the player waits, so it is a skill test not a grind', () => {
  const s = atPerch(0, 0);
  pressMine(s, 20); pressMine(s, 20);
  assert.equal(s.vein.hp, 1);
  let hardened = false;
  for (let i = 0; i < 100; i++) { R.step(s, 0); if (s.events.some(e => e.type === 'vein_harden')) hardened = true; }
  assert.equal(hardened, true, 'a hardening event is emitted so the UI can explain it');
  assert.equal(s.vein.hp, 3, 'the vein returns to full strength');
  assert.equal(s.veinBroken, false);
});

test('V6 fork: one strike is the safe choice, three quick strikes upgrade to the rich pocket with two guards', () => {
  const safe = atFork(0, 0);
  safe.player.hearts = Math.max(1, safe.player.maxHearts - 1);
  const heartsBefore = safe.player.hearts;
  const safeEvents = pressMine(safe);
  assert.equal(safe.choice, 'safe');
  assert.equal(safe.fork.choice, 'safe');
  assert.equal(safe.player.hearts, heartsBefore + 1, 'the safe path restores one heart');
  assert.deepEqual(safeEvents.find(e => e.type === 'fork_safe').ores, { iron: 2 }, 'the safe path pays mid ore (iron in the stone mine)');

  const greedy = atFork(0, 0);
  const enemies0 = greedy.enemies.length;
  pressMine(greedy, 14); pressMine(greedy, 14); const rich = pressMine(greedy, 14);
  assert.equal(greedy.choice, 'rich');
  assert.equal(greedy.fork.locked, true);
  assert.equal(greedy.enemies.length, enemies0 + 2, 'two pocket guards wake up');
  assert.ok(greedy.enemies.filter(e => e.greed).every(e => e.hp > 0 && !e.dead));
  assert.equal(greedy.ores.gold, 2, 'the rich pocket pays rare ore');
  assert.ok(rich.some(e => e.type === 'fork_rich' && e.guards === 2));
});

test('V6 fork: walking away after the safe open closes the choice — no free second reward later', () => {
  const s = atFork(0, 0);
  pressMine(s);
  let locked = false;
  for (let i = 0; i < 130; i++) { R.step(s, 0); if (s.events.some(e => e.type === 'fork_lock')) locked = true; }
  assert.equal(locked, true);
  assert.equal(s.fork.locked, true);
  const ores = { ...s.ores };
  pressMine(s, 14); pressMine(s, 14);
  assert.deepEqual(s.ores, ores, 'a locked fork pays nothing more');
  assert.equal(s.choice, 'safe');
});

test('V6 ore wind: one timed burst of three bonus gems appears at the fork ground and never repeats', () => {
  const s = R.create('miner', 7, { zone: 0, goal: 0 });
  assert.equal(s.gems.length, 10);
  let windTick = 0, seen = 0;
  for (let i = 0; i < R.ORE_WIND_TICK + 400 && s.status === 'playing'; i++) {
    R.step(s, 0);
    if (s.events.some(e => e.type === 'ore_wind')) { seen++; if (!windTick) windTick = s.tick; }
  }
  assert.equal(seen, 1, 'exactly one ore wind per run');
  assert.equal(windTick, R.ORE_WIND_TICK);
  assert.equal(s.gems.length, 13);
  const bonus = s.gems.filter(g => g.bonus);
  assert.equal(bonus.length, 3);
  assert.ok(bonus.every(g => g.ore === R.MINES[0].tier.mid), 'bonus gems carry the mine mid ore');
  assert.ok(bonus.every(g => g.x >= s.perch.x && g.x <= s.perch.x + s.perch.w), 'they land on the fork ground');
  assert.ok(bonus.every(g => g.y < s.perch.y - 40), 'and float high enough to need a jump');
});

test('V6 perch: every mine places the fork ground over solid floor, away from hazards and before the exit', () => {
  for (let zone = 0; zone < R.MINES.length; zone++) {
    const s = R.create('miner', 12345, { zone, goal: 0 });
    const level = R.levelFor(zone);
    assert.ok(s.perch && Number.isInteger(s.perch.x), `mine ${zone} has a fork ground`);
    const floor = level.platforms.filter(p => p.h >= 80).find(p => s.perch.x - 6 >= p.x && s.perch.x + 92 <= p.x + p.w);
    assert.ok(floor, `mine ${zone}: the fork ground is on the floor, not over a gap`);
    for (const h of level.hazards) {
      assert.ok(s.perch.x + 92 < h.x - 70 || s.perch.x > h.x + h.w + 70, `mine ${zone}: no hazard inside the fork ground`);
    }
    assert.ok(s.perch.x + 92 < level.exit.x - 100, `mine ${zone}: the fork ground is before the exit`);
    assert.equal(s.vein.y + s.vein.h, level.platforms.find(p => p.h >= 80 && p.x <= s.vein.x)?.y ?? 300, `mine ${zone}: the vein sits on the floor`);
    assert.ok(s.fork.x > s.vein.x && s.fork.x + s.fork.w <= s.perch.x + s.perch.w, `mine ${zone}: chest and vein share the ground without overlap`);
  }
});

test('V6 rewards: the new content pays ores (and hearts), never extra gold above the same 100 cap', () => {
  const plain = R.create('miner', 7, { zone: 0, goal: 0 });
  const withVein = atPerch(0, 0);
  pressMine(withVein); pressMine(withVein); pressMine(withVein);
  plain.milestones = [...withVein.milestones];
  const a = R.rewardBreakdown(plain), b = R.rewardBreakdown(withVein);
  assert.ok(b.total <= 100, 'the cap is untouched');
  assert.equal(b.potential, a.potential, 'breaking the vein does not inflate the gold formula');
  assert.ok(R.oreTotal(withVein) > R.oreTotal(plain), 'the run still pays more ore, which is the workshop currency');
});

test('V6 determinism: the same inputs and goal replay to the same state, and the goal rides in the ticket snapshot', () => {
  const inputs = [];
  for (let i = 0; i < 240; i++) inputs.push({ mask: i % 20 === 0 ? R.INPUT.MINE : R.INPUT.RIGHT, frames: 1 });
  const direct = R.create('miner', 7, { zone: 2, goal: 1 });
  for (const item of inputs) for (let k = 0; k < item.frames; k++) R.step(direct, item.mask);
  const replayed = R.replay(inputs, 'miner', 7, { zone: 2, goal: 1 });
  assert.equal(replayed.ok, true);
  assert.deepEqual(R.oreSummary(replayed.state), R.oreSummary(direct), 'the ore wallet replays exactly');
  assert.deepEqual(R.goalStatus(replayed.state), R.goalStatus(direct), 'the goal result replays exactly');
  assert.equal(replayed.state.goal, 1);
  // الهدف يغيّر حالة الجولة (لا الفيزياء): نفس الحركات تحت هدف آخر تحفظ نفس المواضع
  const other = R.replay(inputs, 'miner', 7, { zone: 2, goal: 2 });
  assert.equal(other.state.player.x, direct.player.x);
  assert.equal(other.state.tick, direct.tick);
  assert.notEqual(R.goalStatus(other.state).id, 'vein');
});

test('V6 UI: the page ships the goal picker, the summary and the first-run coach, and the client sends the goal', () => {
  const html = read('public/index.html');
  const game = read('public/platform-game.js');
  const css = read('public/platform.css');
  for (const id of ['platform-goals', 'goal-chip', 'goal-chip-text', 'goal-hint', 'platform-summary', 'summary-rows', 'summary-next',
    'summary-goal', 'platform-event', 'platform-coach', 'coach-next', 'coach-skip']) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html ships #${id}`);
  }
  assert.equal((html.match(/data-goal="/g) || []).length, 3, 'three goal options are on the start card');
  assert.match(game, /goal: selectedGoal/, 'the chosen goal is sent with the start request');
  assert.match(game, /R\.goalStatus\(sim\)/, 'the HUD reads the goal progress from the shared engine');
  assert.match(game, /renderSummary\(/, 'the run summary is rendered on the real finish path');
  assert.match(game, /platform-coach:v1/, 'the first-run coach is remembered per device');
  assert.match(css, /\.goal-option\[aria-checked="true"\]/);
  assert.match(css, /\.run-summary\{/);
  assert.match(css, /\.mine-event\{/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  const block = css.slice(css.indexOf('/* ===== V6:'));
  assert.ok(block.length > 500, 'the V6 styles are present');
  assert.equal(/backdrop-filter/.test(block), false, 'the new styles never use backdrop-filter');
  assert.equal(/[🎮💎⛏️🪙]/.test(html.slice(html.indexOf('id="platform-goals"'), html.indexOf('id="platform-coach"'))), false, 'the new UI text uses no emoji');
});
