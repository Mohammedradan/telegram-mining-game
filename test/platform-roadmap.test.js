// خطّة التطوير بعد V8: مكافأة المبارزة المتدرّجة والمحدودة، المعدات في القتال (مقيّدة)،
// تخزين ضغطة الهجوم في المبارزة فقط، ومراحل الزعيم الثلاث مع هجومَي «pound» و«sweep».
// كل ما هنا حتمي ويُعاد على الخادم من نفس المدخلات.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/platform-rules');

const I = R.INPUT;
const MAX_GEAR = Object.fromEntries(R.EQUIPMENT_ORDER.map(id => [id, R.MAX_EQUIP_LEVEL]));
const run = (s, mask, ticks) => { for (let i = 0; i < ticks && s.status === 'playing'; i++) R.step(s, mask); return s; };
const bossOf = s => s.enemies.find(e => e.boss);

// ---------------------------------------------------------------------------------------------
// 1) مكافأة المبارزة: قاعدة شبه ثابتة + تدرّج صغير للعمق، ولا تتضخّم بالتكرار
// ---------------------------------------------------------------------------------------------
test('duel reward: fixed base plus a tiny depth step, never above 80, and the daily cap is its own (400)', () => {
  assert.equal(R.DUEL.reward, 60);
  assert.equal(R.DUEL.rewardStep, 4);
  assert.equal(R.duelReward(0), 60, 'the first rival pays the flat base');
  assert.equal(R.duelReward(5), 80, 'the deepest rival pays only 20 more');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(R.duelReward), [60, 64, 68, 72, 76, 80]);
  // خارج النطاق لا يفتح باباً لمكافأة مفتوحة
  assert.equal(R.duelReward(-3), 60);
  assert.equal(R.duelReward(99), 80);
  assert.equal(R.duelReward('2'), 68);
  assert.equal(R.duelReward(undefined), 60);

  const won = R.create('miner', 5, { zone: 2, mode: 'duel' });
  won.status = 'won';
  assert.equal(R.rewardBreakdown(won).total, 68, 'a depth-2 duel pays exactly duelReward(2)');
  const lost = R.create('miner', 5, { zone: 2, mode: 'duel' });
  lost.status = 'lost';
  assert.equal(R.rewardBreakdown(lost).total, 0, 'losing pays nothing — no participation farming');
  // والعائد لا يتضخّم بالعمق أكثر من 20 ذهباً مهما بلغ المستوى
  assert.ok(R.duelReward(5) - R.duelReward(0) <= 20);
});

test('duel reward: the independent daily cap is enforced server-side and kept apart from mining gold', () => {
  const api = require('../platform-api');
  const cap = api.DAILY_DUEL_CAP;
  assert.equal(cap, 400);
  const sync = {};
  const day = Date.UTC(2026, 0, 2, 12);
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const q = api.duelQuota(sync, 80, day);
    total += q.gold;
    sync.duelGold = (sync.duelGold || 0) + q.gold;
  }
  assert.equal(total, cap, 'ten depth-5 wins cannot exceed the duel cap');
  assert.equal(api.duelQuota(sync, 80, day).gold, 0, 'and once exhausted it pays nothing');
  // سقف التعدين المشترك لم يُستهلك بأي مبارزة
  assert.equal(api.dailyQuota(sync, 5000, day).gold, 5000);
  // يوم جديد = سقف جديد
  assert.equal(api.duelQuota(sync, 80, day + 86400000).gold, 80);
});

// ---------------------------------------------------------------------------------------------
// 2) المعدات في القتال — مقيّدة بسقوف صريحة كي لا يذوب التحدّي
// ---------------------------------------------------------------------------------------------
test('equipment in combat: damage, guard stamina, dodge and skill cooldowns improve but stay capped', () => {
  const base = R.loadoutStats('warrior', {});
  const full = R.loadoutStats('warrior', MAX_GEAR);
  assert.deepEqual(base.combat, { damage: 0, guardStamina: 0, dodgeCooldown: 46, skillCooldown: 150 });
  assert.equal(full.combat.damage, 2, 'a maxed pickaxe adds +2 damage — and never more');
  assert.equal(R.loadoutStats('warrior', { pickaxe: 1 }).combat.damage, 0, 'one level is not yet a damage step');
  assert.equal(R.loadoutStats('warrior', { pickaxe: 3 }).combat.damage, 1);
  assert.equal(full.combat.guardStamina, 10 * R.MAX_EQUIP_LEVEL);
  assert.equal(full.combat.dodgeCooldown, Math.max(30, 46 - 3 * R.MAX_EQUIP_LEVEL));
  assert.ok(full.combat.dodgeCooldown >= 30, 'dodge cooldown never drops below the safety floor');
  assert.ok(full.combat.skillCooldown >= 90, 'and the skill cooldown keeps its own floor');
  assert.ok(full.combat.skillCooldown >= 90 && full.combat.skillCooldown < base.combat.skillCooldown);

  // يتسلل إلى المحاكاة فعلاً: ضرر أعلى ونَفَس درع أطول — لكن القلوب لا تتضخّم بالقتال
  const a = R.create('warrior', 3, { zone: 0 }), b = R.create('warrior', 3, { zone: 0, loadout: MAX_GEAR });
  assert.equal(b.player.damage, a.player.damage + 2);
  assert.equal(b.player.guard.maxStamina, a.player.guard.maxStamina + 10 * R.MAX_EQUIP_LEVEL);
  assert.equal(b.player.dodgeCooldown, Math.max(30, 46 - 3 * R.MAX_EQUIP_LEVEL));
  assert.equal(a.player.dodgeCooldown, 46);
});

test('equipment in combat: the loadout is frozen into the run config so a server replay cannot be re-geared', () => {
  const cfg = R.normalizeConfig({ zone: 1, loadout: { pickaxe: 2, armor: 1, boots: 1, drill: 1 } });
  const s = R.create('warrior', R.seedFromId('w'), cfg);
  assert.deepEqual(s.loadout, { ...R.normalizeLoadout(cfg.loadout) });
  const replay = R.replay([{ mask: 0, frames: 30 }], 'warrior', R.seedFromId('w'), cfg);
  assert.equal(replay.ok, true);
  assert.equal(replay.state.player.damage, s.player.damage, 'same damage on the server, from the snapshot alone');
  assert.equal(replay.state.player.guard.maxStamina, s.player.guard.maxStamina);
});

// ---------------------------------------------------------------------------------------------
// 3) تخزين ضغطة الهجوم: في المبارزة فقط، وبنفس المدخلات المسجّلة (لا يتغيّر ملف الإدخال)
// ---------------------------------------------------------------------------------------------
test('input buffer: a press queued at the tail of a swing lands without a second press — duels only', () => {
  function script(mode) {
    const s = R.create('miner', 11, { zone: 0, mode });
    s.player.x = 300; s.player.y = 262; s.player.grounded = true; s.player.facing = 1;
    const enemy = s.enemies[0];
    enemy.x = 330; enemy.y = 236; enemy.hp = 60; enemy.state = 'stagger'; enemy.timer = 99999;
    R.step(s, I.ATTACK);                       // first swing starts
    assert.equal(s.player.combo, 1);
    let guard = 0;
    while (s.player.attack > 4 && guard++ < 120) R.step(s, 0);   // let the cooldown run down
    assert.ok(s.player.attack > 0, 'still cooling down');
    const buffered = mode === 'duel';
    R.step(s, I.ATTACK);                       // queued press — cannot fire yet
    assert.equal(s.player.attackBuffer > 0, buffered, buffered ? 'the press is stored' : 'mining does not store presses');
    assert.equal(s.player.attackBuffered, 'light');
    // الضربة الأولى تدفع الخصم؛ نعيده للمدى ليُقاس الهجوم المخزَّن وحده
    enemy.x = s.player.x + 22; enemy.vx = 0; enemy.hp = 60; enemy.state = 'stagger'; enemy.timer = 99999;
    const hp = enemy.hp;
    s.events = [];
    run(s, 0, 10);                             // no further presses
    return { s, dealt: hp - enemy.hp, combo: s.player.combo };
  }
  const duel = script('duel');
  assert.ok(duel.dealt > 0, 'the queued press fires on its own');
  assert.equal(duel.combo, 2, 'and it continues the chain');
  const mine = script('mine');
  assert.equal(mine.dealt, 0, 'mining runs replay V3 physics literally: no buffering');
  assert.equal(mine.combo, 1, 'the chain does not advance without a fresh press');
});

// ---------------------------------------------------------------------------------------------
// 4) مراحل الزعيم: هجمات لكل مرحلة، و«pound» لا يوقفها الدرع، و«sweep» تُصدّ
// ---------------------------------------------------------------------------------------------
function arena(zone, hero = 'miner') {
  const s = R.create(hero, R.seedFromId(`roadmap-${zone}`), { zone });
  const boss = bossOf(s);
  boss.x = 1200; boss.wake = 1300; boss.minX = 1100; boss.maxX = 1320;
  s.player.x = boss.x + boss.w + 30; s.player.y = 262; s.player.grounded = true;
  return { s, boss, p: s.player };
}
// يُجبر الزعيم على إطلاق هجوم محدّد الآن (إنذار انتهى) ويعيد الأحداث والقلوب.
function fire(s, boss, attack, placeAt, mask = 0) {
  boss.state = 'windup'; boss.timer = 0; boss.attack = attack; boss.enraged = true;
  boss.aim = 1; boss.facing = 1; boss.vx = 0;
  if (placeAt !== undefined) { s.player.x = placeAt; s.player.y = 262; s.player.invulnerable = 0; }
  s.player.hearts = s.player.maxHearts;
  s.events = [];
  const before = s.player.hearts;
  R.step(s, mask);
  return { lost: before - s.player.hearts, events: s.events };
}

test('boss phases: each stage switches to its own attack list, and the final phase opens at one third of the health', () => {
  for (const zone of [2, 5]) {
    const { boss } = arena(zone);
    const ai = boss.ai;
    assert.ok(Array.isArray(ai.attacks) && ai.attacks.length > 0);
    assert.ok(ai.enragedAttacks && ai.finalAttacks, `zone ${zone}: three phases declared`);
    assert.notDeepEqual(ai.finalAttacks, ai.enragedAttacks, `zone ${zone}: the last phase is not the middle one`);
  }
  const colossus = arena(2).boss.ai, warden = arena(5).boss.ai;
  assert.deepEqual(colossus.attacks, ['slam'], 'the colossus keeps its original calm slam');
  assert.deepEqual(warden.attacks, ['charge', 'slam'], 'the warden keeps its original calm moveset');
  assert.ok(colossus.enragedAttacks.includes('pound') && colossus.finalAttacks.includes('sweep'));
  assert.deepEqual(warden.finalAttacks, ['sweep', 'pound', 'charge', 'slam'], 'the warden keeps its dash and slam in the last phase');
  assert.notDeepEqual(colossus.finalAttacks, warden.finalAttacks, 'no two bosses share a moveset');

  // العتبة: 33% لا 25%، وتُعلَن للعميل بنفس حدث الاهتياج
  const { s, boss } = arena(2);
  boss.state = 'walk'; boss.timer = 9999; boss.enraged = true; boss.final = false;
  boss.hp = Math.ceil(boss.maxHp * 0.4); s.events = []; R.step(s, 0);
  assert.equal(boss.final, false, 'above a third: still the enraged phase');
  boss.hp = Math.floor(boss.maxHp / 3); s.events = []; R.step(s, 0);
  assert.equal(boss.final, true);
  assert.ok(s.events.some(e => e.type === 'boss_enrage' && e.final === true));
  // والترتيب القادم يأتي من قائمة المرحلة الأخيرة
  boss.state = 'walk'; boss.timer = 0; boss.cycle = 0;
  R.step(s, 0);
  assert.ok(boss.ai.finalAttacks.includes(boss.attack), 'the wind-up picks from the final list');
});

test('boss attacks: pound is a radial ground slam the guard cannot stop, sweep is a short reachable strike', () => {
  // «pound»: الوقوف قريباً بلا قفز يكلّف قلباً حتى لو كان الدرع مرفوعاً
  const close = arena(2);
  close.p.guard.active = true; close.p.guard.stamina = 200;
  close.p.invulnerable = 0; close.p.hearts = close.p.maxHearts;
  const pound = fire(close.s, close.boss, 'pound', close.boss.x + close.boss.w / 2, I.DEFEND);
  assert.equal(pound.lost, 1, 'unblockable: the guard does not save you');
  assert.ok(pound.events.some(e => e.type === 'boss_slam' && e.attack === 'pound' && e.unblockable === true), 'and it is announced as unblockable');
  assert.ok(close.s.waves.length >= 1, 'a wave follows so standing far away is not a free camp');

  // «sweep»: تصيب على مدى قصير فقط، وتُصدّ بالدرع
  const near = arena(5);
  const reach = near.boss.ai.sweep.reach;
  const swept = fire(near.s, near.boss, 'sweep', near.boss.x + near.boss.w + Math.floor(reach * 0.5));
  assert.equal(swept.lost, 1, 'close range is hit');
  assert.ok(swept.events.some(e => e.type === 'boss_slam' && e.attack === 'sweep'));
  const far = arena(5);
  const missed = fire(far.s, far.boss, 'sweep', far.boss.x + far.boss.w + reach + 60);
  assert.equal(missed.lost, 0, 'and it whiffs past its reach');
  const blocked = arena(5);
  blocked.p.guard.active = true; blocked.p.guard.stamina = 200;
  const guarded = fire(blocked.s, blocked.boss, 'sweep', blocked.boss.x + blocked.boss.w + Math.floor(reach * 0.5), I.DEFEND);
  assert.equal(guarded.lost, 0, 'the guard absorbs it (unlike pound)');
  assert.ok(guarded.events.some(e => e.type === 'guard'));
});

test('boss attacks: the new moves never touch the armour rule or the old event contract', () => {
  const { s, boss } = arena(2);
  // الزعيم مدرَّع خارج الاستراحة: الضربات الجديدة تنتهي بالاستراحة نفسها التي تفتح نافذة الضرر
  fire(s, boss, 'pound');
  assert.equal(boss.state, 'recover');
  assert.ok(boss.timer >= 22, 'pound opens the usual recovery window');
  fire(s, boss, 'sweep');
  assert.equal(boss.state, 'recover');
  assert.ok(boss.timer >= 22, 'sweep opens a slightly shorter one, never zero');
  assert.equal(boss.armored === false, false, 'still armoured outside recovery');
});

// ---------------------------------------------------------------------------------------------
// 5) تخصيص مواضع الأزرار: سحب + استعادة افتراضية + حفظ محلي، بلا أي أثر على اللعب أو الحساب
// ---------------------------------------------------------------------------------------------
test('client wiring: drag-to-move controls, default restore, and per-device storage only', () => {
  const fs = require('node:fs'), path = require('node:path');
  const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const html = read('public/index.html'), game = read('public/platform-game.js'), css = read('public/platform.css');
  assert.match(html, /id="ctl-edit"[^>]*aria-pressed="false"/, 'a toggle starts the move mode');
  assert.match(html, /id="ctl-reset"[^>]*>استعادة الوضع الافتراضي</, 'and a button restores the default layout');
  assert.match(html, /id="ctl-layout-hint"[^>]*hidden/, 'the hint is hidden until move mode is on');
  assert.match(game, /platform-control-layout/, 'the layout lives in localStorage, per device');
  assert.match(game, /localStorage\.removeItem\(LAYOUT_KEY\)/, 'restore really clears the saved layout');
  assert.match(game, /style\.translate = off/, 'moving is purely visual (CSS translate), never an input change');
  // السحب لا يسجّل إدخال لعب: الحارسان يمنعان تسريب الإصبع إلى المحاكاة
  assert.match(game, /if \(layoutEditing \|\| !running \|\| paused\) return;/, 'a drag never presses a button');
  assert.match(game, /setLayoutEditing\(false\); start\(\)/, 'starting a run always leaves move mode');
  assert.match(css, /\.mine-controls\.ctl-editing \.action-btn/, 'move mode is visible on the pad');
  // ولا يعرف الخادم شيئاً عنها: لا تُرسل في التذكرة ولا في المدخلات
  assert.doesNotMatch(game, /layout[^;]*ticket/, 'the layout is never sent with the run ticket');
});
