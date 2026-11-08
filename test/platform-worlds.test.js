// المحرك V5: لكل منجم عالمه (مستوى كامل) وخطره المميّز، وزعيمان في المنجمين الثالث والسادس.
// كل شيء حتمي ومحسوب من القواعد المشتركة نفسها التي يعيد الخادم تشغيلها؛ "قابل للفوز" هنا يعني أن لاعباً آلياً قانونياً
// (test/fixtures/platform-bot.cjs) يفوز به وأن الخادم يعيد المسار بالتطابق، لا أن أحداً حقن نتيجة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/platform-rules');
const bot = require('./fixtures/platform-bot.cjs');
const { lintLevel } = require('./fixtures/platform-level-lint.cjs');

const I = R.INPUT, HEROES = ['miner', 'warrior', 'archer'];
const MAX_GEAR = Object.fromEntries(R.EQUIPMENT_ORDER.map(id => [id, R.MAX_EQUIP_LEVEL]));
const BOSS_ZONES = [2, 5];

// --- helpers: build a state by hand (model-level tests), then let the real engine step it
const arena = (zone, hero = 'miner') => {
  const s = R.create(hero, R.seedFromId(`arena-${zone}-${hero}`), { zone });
  return { s, p: s.player, boss: s.enemies.find(e => e.boss) };
};
const place = (s, x) => { const p = s.player; p.x = x; p.y = 262; p.vx = p.vy = 0; p.grounded = true; p.facing = 1; };
const run = (s, mask, ticks) => { for (let i = 0; i < ticks; i++) R.step(s, mask); return s; };
const hold = (boss, state, extra = {}) => Object.assign(boss, { state, timer: 9999, ...extra }); // freeze the boss in one state
const hit = s => s.events.find(e => e.type === 'hit');
const ORE_PRICE = Object.fromEntries(Object.entries(R.ORES).map(([k, v]) => [k, v.price]));
const worth = ores => Object.entries(ores).reduce((sum, [k, n]) => sum + ORE_PRICE[k] * n, 0);

// ---------------------------------------------------------------------------------------------------------------------
// المستويات
// ---------------------------------------------------------------------------------------------------------------------
test('worlds: six levels — mine 0 is the original, the rest obey the clearance rules, counts never move the reward', () => {
  assert.equal(R.LEVELS.length, 6);
  assert.equal(R.LEVEL, R.LEVELS[0], 'the old name still means the first mine');
  assert.deepEqual(R.LEVELS.map(l => l.id), R.MINES.map(m => m.id), 'a level per mine, in the same order');
  R.LEVELS.forEach((level, i) => assert.deepEqual(lintLevel(level, { strict: i > 0 }), [], `level ${i} (${level.id})`));
  assert.equal(new Set(R.LEVELS.map(l => JSON.stringify([l.platforms, l.hazards, l.rockSpans]))).size, 6, 'no two mines share a layout');
  for (const level of R.LEVELS) {
    assert.ok(Object.isFrozen(level) && Object.isFrozen(level.platforms) && Object.isFrozen(level.platforms[0]) && Object.isFrozen(level.hazards[0]), `${level.id} is frozen`);
    assert.equal(level.hazards[0].vent, true, `${level.id}: the first hazard is the one whose uptime follows the mine`);
    assert.equal(level.hazards.filter(h => h.vent).length, 1);
    const i = R.LEVELS.indexOf(level);
    if (i > 0) assert.equal('active' in level.hazards[0], false, `${level.id}: the timed hazard's uptime is not repeated in the level, the mine is its only source`);
    assert.equal(R.create('miner', 1, { zone: i }).hazards[0].active, R.MINES[i].vent, `${level.id}: and the run gets exactly the mine's uptime`);
    assert.equal(new Set(level.enemies.map(e => e.id)).size, level.enemies.length, 'unique enemy ids');
    assert.equal(level.width, 2680);
    assert.ok(level.signs.length >= 2 && level.checkpoints.length >= 2);
  }
  for (const bad of [-1, 6, 2.5, NaN, undefined, null, '3']) assert.equal(R.levelFor(bad), R.LEVELS[0], `levelFor(${String(bad)}) falls back to the first mine`);
  assert.deepEqual(R.LEVELS.map(l => l.boss && l.boss.kind), [null, null, 'colossus', null, null, 'warden']);
});

test('worlds: each mine has its own signature hazard, and every kind is one the renderer knows how to draw', () => {
  assert.deepEqual(R.LEVELS.map(l => l.hazards.map(h => h.kind)), [
    ['vent', 'pit'], ['crusher', 'pit'], ['vent', 'pit'], ['crystal', 'crystal', 'pit'], ['geyser', 'geyser', 'pit', 'flare'], ['crusher', 'pit'],
  ]);
  assert.deepEqual([...new Set(R.LEVELS.flatMap(l => l.hazards.map(h => h.kind)))].sort(), ['crusher', 'crystal', 'flare', 'geyser', 'pit', 'vent']);
});

test('worlds: a hazard honours its phase, and without one it behaves exactly as before', () => {
  const phased = { period: 100, active: 30, phase: 80 };
  assert.deepEqual([19, 20, 49, 50, 119, 120].map(t => R.activeHazard(phased, t)), [false, true, true, false, false, true]);
  const plain = { period: 100, active: 30 };
  assert.deepEqual([0, 29, 30, 99, 100, 129].map(t => R.activeHazard(plain, t)), [true, true, false, false, true, true]);
});

test('worlds: the crusher and the geysers are real — crossing at the wrong moment costs a heart, the right one is free', () => {
  // find the first tick from which the hazard stays quiet for `quiet` ticks / is on for `loud` ticks
  const window = (h, wantActive, len) => { for (let t = 0; t < 2000; t++) if ([...Array(len).keys()].every(k => R.activeHazard(h, t + k) === wantActive)) return t; throw new Error('no window'); };
  // crusher (mine 1): walk through it
  const walk = (zone, tickStart, from) => {
    const s = R.create('miner', R.seedFromId('crush'), { zone }), h = s.hazards[0];
    place(s, h.x - 40 + from); s.tick = tickStart - 1;
    run(s, I.RIGHT, 70);
    return { s, h };
  };
  const crusher = R.levelFor(1).hazards[0], quiet = window({ ...crusher, active: R.MINES[1].vent }, false, 70), loud = window({ ...crusher, active: R.MINES[1].vent }, true, 30);
  const calm = walk(1, quiet, 0);
  assert.equal(calm.s.player.hearts, 3, 'passing while it is up is free');
  assert.ok(calm.s.player.x > calm.h.x + calm.h.w, 'and the miner really got through');
  const crushed = walk(1, loud, 0);
  assert.equal(crushed.s.player.hearts, 2, 'walking into it while it is down costs a heart');
  // geyser over the first gap of mine 4: a jump across while it erupts is punished, across a quiet one is not
  const geyser = { ...R.levelFor(4).hazards[0], active: R.MINES[4].vent };
  const cross = tick => {
    const s = R.create('miner', R.seedFromId('geyser'), { zone: 4 });
    place(s, 500); s.tick = tick - 1;
    const hearts = s.player.hearts;
    for (let i = 0; i < 80; i++) R.step(s, I.RIGHT | (s.player.x > 530 && s.player.grounded && i < 40 ? I.JUMP : 0));
    return hearts - s.player.hearts;
  };
  const quietAt = window(geyser, false, 90);
  assert.equal(cross(quietAt), 0, 'a quiet geyser can be crossed');
  let punished = false;
  for (let t = 0; t < 240 && !punished; t++) punished = cross(t) > 0;
  assert.ok(punished, 'at some moment of its cycle the geyser really hurts a jumper');
});

// ---------------------------------------------------------------------------------------------------------------------
// قابلية الفوز: لاعب آلي قانوني، مع الإعادة المتطابقة على الخادم
// ---------------------------------------------------------------------------------------------------------------------
test('worlds: every mine is won by the generic bot at its own unlock gear — every hero, several seeds — and the server replay is bit-identical', () => {
  let runs = 0;
  for (let zone = 0; zone < 6; zone++) for (const hero of HEROES) for (let k = 0; k < 4; k++) {
    const gear = (R.MINES[zone].requires && R.MINES[zone].requires.gear) || {};
    const seed = R.seedFromId(`worlds-${zone}-${hero}-${k}`), config = { zone, loadout: gear };
    const { state, inputs } = bot(seed, hero, config);
    assert.equal(state.status, 'won', `${hero} wins ${R.MINES[zone].id} from seed ${k} (tick ${state.tick}, x ${Math.round(state.player.x)})`);
    const replay = R.replay(inputs, hero, seed, config);
    assert.equal(replay.ok, true);
    assert.deepEqual(replay.state, state, 'the verified replay reproduces the exact same run');
    assert.ok(R.rewardFor(state) <= R.rewardCap(zone), 'a win never exceeds its mine cap (content + completion bonus)');
    assert.equal(state.bossDefeated, BOSS_ZONES.includes(zone), 'the exit of a boss mine opened because the boss fell');
    assert.ok(state.tick < R.MAX_TICKS * 0.6, 'a winning run leaves the clock plenty of room');
    assert.ok(inputs.length < R.MAX_SEGMENTS / 2, 'and the recording stays far below the segment cap');
    runs++;
  }
  assert.equal(runs, 72);
});

test('worlds: every hero beats both bosses with the weakest gear the game actually lets them in with', () => {
  // V19.2: «بلا أي معدات» ليس حالة يمكن أن يصل إليها لاعب حقيقي في منجم مشروط: الخادم يرفض فتح
  // منجم 6 بغير pickaxe 4 وarmor 3 (5 قلوب). الاختبار كان يطالب بالفوز بثلاثة قلوب في معركة زعيم
  // ظهر فيها عدوّ جوّي حقيقي. الحالة الأسوأ الشرعية = متطلبات فتح المنجم نفسها.
  for (const zone of BOSS_ZONES) for (const hero of HEROES) {
    const seed = R.seedFromId(`bare-${zone}-${hero}`), config = { zone, loadout: { ...(R.MINES[zone].requires?.gear || {}) } };
    const { state, inputs, stats } = bot(seed, hero, config);
    assert.equal(state.status, 'won', `${hero} beats the boss of ${R.MINES[zone].id} with the weakest legal gear`);
    assert.deepEqual(R.replay(inputs, hero, seed, config).state, state);
    const fight = stats.bossDeadAt - stats.fightFrom;
    assert.ok(fight >= 300, `the fight is a real fight, not a tap (${fight} ticks)`);
    assert.ok(fight < 2400, `and it stays inside the round clock (${fight} ticks)`);
  }
});

test('worlds: a recorded win cannot be replayed under another mine or weaker gear (the config is part of the proof)', () => {
  const seed = R.seedFromId('bound-boss'), config = { zone: 5, loadout: MAX_GEAR };
  const { state, inputs } = bot(seed, 'warrior', config);
  assert.equal(state.status, 'won');
  for (const claimed of [{ zone: 5 }, { zone: 5, loadout: { armor: 1 } }, { zone: 2, loadout: MAX_GEAR }, { zone: 4, loadout: MAX_GEAR }, undefined]) {
    const replay = R.replay(inputs, 'warrior', seed, claimed);
    assert.notEqual(replay.ok && replay.state.status, 'won', `${JSON.stringify(claimed)} cannot reuse the proof`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// الزعيم
// ---------------------------------------------------------------------------------------------------------------------
test('boss: stats come from the level and scale with the mine like every other enemy', () => {
  const colossus = arena(2).boss, warden = arena(5).boss;
  assert.equal(R.create('miner', 1, { zone: 0 }).bossId, 0, 'no boss elsewhere');
  assert.equal(arena(2).s.bossId, 90); assert.equal(arena(5).s.bossId, 90);
  assert.deepEqual([colossus.maxHp, warden.maxHp], [17 + R.MINES[2].enemyHp, 29 + R.MINES[5].enemyHp]);
  assert.equal(colossus.patrolSpeed, Math.round(42 * R.MINES[2].enemySpeed / 100));
  assert.equal(warden.patrolSpeed, Math.round(50 * R.MINES[5].enemySpeed / 100));
  assert.equal(warden.chargeSpeed, Math.round(215 * R.MINES[5].enemySpeed / 100));
  for (const b of [colossus, warden]) {
    assert.equal(b.state, 'sleep'); assert.equal(b.hp, b.maxHp); assert.equal(b.enraged, false); assert.equal(b.dead, false);
  }
  assert.equal(R.create('miner', 1, { zone: 5 }).enemies.filter(e => e.boss).length, 1);
  assert.deepEqual(arena(5).boss.x, arena(5).boss.maxX, 'the boss always starts at the far end of the arena');
  assert.deepEqual(R.layoutFor(R.seedFromId('a'), 5).enemies.find(e => e.boss), R.layoutFor(R.seedFromId('b'), 5).enemies.find(e => e.boss), 'its start never depends on the seed');
});

test('boss: it sleeps until the wake line, and a sleeping boss shrugs everything off', () => {
  const { s, p, boss } = arena(2, 'archer');
  place(s, boss.wake - 120); run(s, 0, 30);
  assert.equal(boss.state, 'sleep'); assert.deepEqual(s.events, []);
  // an arrow loosed from far away that reaches it does nothing, and cannot wake it
  boss.x = p.x + 100;
  run(s, I.ATTACK, 20);
  assert.equal(boss.hp, boss.maxHp, 'armoured while asleep');
  assert.equal(boss.state, 'sleep');
  place(s, boss.wake); R.step(s, 0);
  assert.equal(boss.state, 'walk');
  assert.ok(s.events.some(e => e.type === 'boss_wake' && e.id === boss.id));
  assert.equal(boss.timer, boss.ai.walk - 1, 'the first walk starts counting at once');
  place(s, boss.wake - 300); run(s, 0, 5);
  assert.notEqual(boss.state, 'sleep', 'once awake it stays awake even if the player backs away');
});

test('boss: armoured except while it recovers — melee, arrows and both skills ring off in every other state', () => {
  for (const [hero, mask] of [['miner', I.ATTACK], ['warrior', I.ATTACK], ['miner', I.SKILL], ['warrior', I.SKILL]]) {
    const power = mask === I.SKILL ? 2 : R.CHARACTERS[hero].damage;
    for (const state of ['sleep', 'walk', 'windup', 'recover']) {
      const { s, p, boss } = arena(2, hero);
      boss.x = 2000; place(s, boss.x - p.w - 20); p.facing = 1;
      hold(boss, state, { attack: 'slam' }); if (state === 'sleep') s.player.x = boss.wake - 40, boss.x = s.player.x + p.w + 20;
      const before = boss.hp;
      R.step(s, mask);
      const dealt = before - boss.hp;
      assert.equal(dealt, state === 'recover' ? power : 0, `${hero} ${mask === I.SKILL ? 'skill' : 'swing'} vs ${state}`);
      if (state !== 'sleep' || mask === I.ATTACK) assert.equal(hit(s) && hit(s).damage, dealt, 'the hit event reports what was really dealt (0 = the clang)');
    }
  }
  for (const state of ['walk', 'windup', 'recover']) {
    const { s, p, boss } = arena(5, 'archer');
    boss.x = 2000; place(s, boss.x - p.w - 90); hold(boss, state, { attack: 'charge' });
    run(s, I.ATTACK, 14);
    assert.equal(boss.maxHp - boss.hp, state === 'recover' ? 1 : 0, `an arrow against ${state}`);
  }
});

test('boss: the cycle is walk → wind-up → attack → recover, with a fixed telegraph the client can read', () => {
  const { s, p, boss } = arena(2);
  place(s, boss.wake + 10);
  const log = [];
  for (let t = 1; t <= 700; t++) {
    place(s, boss.wake + 10); // stand still far from it
    R.step(s, 0);
    for (const e of s.events) if (e.type.startsWith('boss_')) log.push({ t, type: e.type, ticks: e.ticks, attack: e.attack });
  }
  const types = log.map(e => e.type);
  assert.deepEqual(types.slice(0, 7), ['boss_wake', 'boss_windup', 'boss_slam', 'boss_stun', 'boss_windup', 'boss_slam', 'boss_stun']);
  const [, w1, sl1, st1, w2] = log;
  assert.equal(st1.t, sl1.t, 'the stun starts on the very tick of the strike');
  assert.equal(st1.ticks, boss.ai.recover, 'and the event says how long it lasts');
  assert.equal(w1.attack, 'slam'); assert.equal(w1.ticks, boss.ai.windup);
  assert.equal(sl1.t - w1.t, boss.ai.windup, 'the strike lands exactly `ticks` after the warning');
  assert.ok(Math.abs(w2.t - sl1.t - (boss.ai.recover + boss.ai.walk)) <= 2, 'then it rests, walks and winds up again');
  assert.equal(s.waves.length === 0 || s.waves.length === 2, true);
});

test('boss: the Warden alternates a charge and a slam, and once enraged opens with two charges in three attacks', () => {
  const { s, boss } = arena(5);
  place(s, boss.wake); R.step(s, 0);
  const winds = [];
  // الخفاش عدوّ جوّي حقيقي (V19.2): هنا نقيس إيقاع الزعيم وحده، واللاعب مثبَّت في مكانه بلا دفاع،
  // فيُعزل الحرّاس الطائرون كي لا يقتلوه فيتوقف الإيقاع قبل اكتمال القياس.
  s.enemies = s.enemies.filter(e => !e.flying);
  for (let t = 0; t < 3600; t++) {
    place(s, 1450); // far out of every reach: only the boss's own rhythm is measured
    if (t === 700) boss.hp = Math.floor(boss.maxHp / 2);
    R.step(s, 0);
    for (const e of s.events) if (e.type === 'boss_windup') winds.push({ attack: e.attack, enraged: boss.enraged, ticks: e.ticks });
  }
  const calm = winds.filter(w => !w.enraged).map(w => w.attack), angry = winds.filter(w => w.enraged).map(w => w.attack);
  assert.deepEqual(calm.slice(0, 4), ['charge', 'slam', 'charge', 'slam'], 'calm: one charge, one slam, repeat');
  assert.ok(angry.length >= 6, `enough enraged attacks to measure (${angry.length})`);
  const sixAngry = angry.slice(0, 6);
  assert.equal(sixAngry.filter(a => a === 'charge').length, 4, 'enraged: charge, slam, charge, repeat — four charges in any six');
  assert.equal(sixAngry.filter(a => a === 'slam').length, 2);
  assert.ok(winds.filter(w => w.enraged).every(w => w.ticks === boss.ai.enragedWindup), 'and every enraged warning is the shorter one');
  assert.equal(arena(2).boss.ai.attacks.join(), 'slam', 'the Colossus only ever slams');
});

test('boss: the shockwaves outreach an archer — a hero who stands still and shoots can never win, and neither can anyone who never jumps', () => {
  for (const zone of BOSS_ZONES) {
    const wave = R.levelFor(zone).boss && arena(zone).boss.ai.wave;
    assert.ok(wave.ttl * wave.speed / 60 >= R.CHARACTERS.archer.attackRange, `zone ${zone}: the waves travel at least as far as an arrow (${wave.ttl * wave.speed / 60} vs ${R.CHARACTERS.archer.attackRange}), so no spot is both in range and out of reach`);
    for (const standAt of zone === 2 ? [1575, 1590, 1600, 1610, 1640, 1700] : [1300, 1400, 1500, 1615, 1650, 1700]) {
      const { s, p, boss } = arena(zone, 'archer');
      s.mined = 1; s.collected = 3; s.rocks.forEach(r => { r.hp = 0; }); // rocks already mined (an intact one would stop the arrows)
      place(s, boss.wake + 5); R.step(s, 0);
      place(s, standAt);
      for (let t = 0; t < 5000 && !s.bossDefeated && s.status === 'playing'; t++) {
        R.step(s, I.ATTACK);
        if (p.x !== standAt && s.player.invulnerable > 0) place(s, standAt); // respawn: go back to the same spot and keep shooting
      }
      assert.equal(s.bossDefeated, false, `zone ${zone}: standing at ${standAt} and shooting never wins`);
    }
    for (const hero of ['miner', 'archer']) {
      const { state } = bot(R.seedFromId(`nojump-${zone}-${hero}`), hero, { zone, loadout: {} }, { waveJump: -1, slamLead: -1, chargeLead: -99 });
      assert.notEqual(state.status, 'won', `${hero} cannot beat the boss of mine ${zone} without ever jumping`);
    }
  }
});

test('boss: the slam sends two ground waves outward — they hurt a grounded player and miss one who jumps in time', () => {
  const slam = jumpAt => {
    const { s, p, boss } = arena(2);
    boss.x = 2100; place(s, boss.x - p.w - 30); s.checkpoint = 1770;
    Object.assign(boss, { state: 'windup', attack: 'slam', timer: 12, aim: -1, facing: -1 });
    const before = p.hearts, seen = [];
    for (let i = 0; i < 100; i++) {
      R.step(s, i === jumpAt ? I.JUMP : 0);
      if (s.waves.length && !seen.length) seen.push(s.waves.map(w => Math.sign(w.vx)));
    }
    return { hurt: before - p.hearts, seen: seen[0], waves: s.waves.length };
  };
  const grounded = slam(-1), jumper = slam(3);
  assert.deepEqual(grounded.seen.sort(), [-1, 1], 'one wave each way');
  assert.equal(grounded.hurt, 1, 'standing next to it at the slam is a hit');
  assert.equal(jumper.hurt, 0, 'jumping during the wind-up clears both waves');
  assert.equal(jumper.waves, 0, 'and the waves are gone after their lifetime');
  const { s, boss } = arena(2); boss.x = 2100; place(s, 1800);
  Object.assign(boss, { state: 'windup', attack: 'slam', timer: 1 }); run(s, 0, 2);
  const [left, right] = s.waves.slice().sort((a, b) => a.vx - b.vx);
  assert.ok(left.x + left.w <= boss.x + 1 && right.x >= boss.x + boss.w - 1, 'the waves start at the boss, one on each side');
  assert.equal(left.y + left.h, 300, 'low enough to jump over'); assert.equal(left.h, boss.ai.wave.h);
});

test('boss: the Warden charges along the floor in the direction fixed at wind-up, crashes into the wall and is stunned longer', () => {
  const { s, p, boss } = arena(5);
  place(s, 2150); s.checkpoint = 1770;
  boss.x = 2300; Object.assign(boss, { state: 'windup', attack: 'charge', timer: 1, aim: -1, facing: -1 });
  R.step(s, 0);
  assert.equal(boss.state, 'charge');
  assert.ok(boss.vx < 0 && Math.abs(boss.vx) === Math.round(boss.chargeSpeed * 1), 'toward the player at the wind-up speed');
  const before = p.hearts;
  run(s, 0, 40);
  assert.equal(before - p.hearts, 1, 'a charge that finds a grounded player hurts');
  assert.equal(p.x, 1770, 'and sends them back to the arena flag');
  // a player behind the boss is never touched, and the charge ends at the wall
  const b = arena(5); place(b.s, 2500); b.boss.x = 2100;
  Object.assign(b.boss, { state: 'windup', attack: 'charge', timer: 1, aim: -1, facing: -1 }); R.step(b.s, 0);
  const crash = []; let t = 0;
  for (; t < 120 && b.boss.state === 'charge'; t++) { place(b.s, 2500); R.step(b.s, 0); crash.push(...b.s.events.filter(e => e.type === 'boss_crash')); }
  assert.equal(b.boss.x, b.boss.minX, 'it runs to the arena wall');
  assert.equal(crash.length, 1);
  assert.equal(b.boss.state, 'recover'); assert.equal(b.boss.timer, b.boss.ai.recover + 20, 'a crash costs it extra recovery');
  assert.equal(b.p.hearts, b.p.maxHearts);
});

test('boss: at half health it enrages — faster walk, shorter warning, faster waves — and its health never comes back', () => {
  const { s, p, boss } = arena(5);
  place(s, boss.wake); R.step(s, 0);
  const back = 1450; // beyond the reach of its waves (the farthest one dies at x≈1543) and of its charge, still on the arena's ground
  place(s, back); R.step(s, 0);
  const calm = Math.abs(boss.vx);
  boss.hp = Math.floor(boss.maxHp / 2) + 1; place(s, back); R.step(s, 0);
  assert.equal(boss.enraged, false, 'one hit above half is not enough');
  boss.hp = Math.floor(boss.maxHp / 2); place(s, back); R.step(s, 0);
  assert.equal(boss.enraged, true);
  assert.ok(s.events.some(e => e.type === 'boss_enrage'));
  assert.ok(Math.abs(boss.vx) > calm, 'it walks faster');
  const hpNow = boss.hp;
  boss.timer = 1; boss.state = 'walk'; place(s, back); R.step(s, 0);
  assert.equal(boss.state, 'windup');
  assert.equal(boss.timer, boss.ai.enragedWindup, 'the enraged warning is shorter');
  assert.ok(boss.ai.enragedWindup < boss.ai.windup);
  for (let i = 0; i < 300; i++) { place(s, back); R.step(s, 0); }
  assert.ok(boss.hp <= hpNow, 'health only ever goes down');
  assert.equal(p.hearts, p.maxHearts, 'it never reached the player standing back at the arena entrance');
});

test('boss: being hurt in the arena sends you to the arena flag; the boss keeps every point of damage it took', () => {
  const { s, p, boss } = arena(2);
  place(s, 1620); R.step(s, 0);
  assert.equal(s.checkpoint, 1610, 'the arena flag is the last checkpoint on the way in');
  boss.x = 2100; place(s, boss.x - p.w - 20); hold(boss, 'recover');
  boss.hp = 9;
  p.facing = 1; run(s, I.ATTACK, 14);
  const hpAfterHits = boss.hp;
  assert.ok(hpAfterHits < 9, 'the player is really hitting it while it is stunned');
  place(s, boss.x - p.w + 2); // inside the boss
  R.step(s, 0);
  assert.equal(p.hearts, p.maxHearts - 1);
  assert.equal(p.x, 1610);
  assert.equal(boss.hp, hpAfterHits, 'its health stays where the fight left it');
  assert.equal(boss.state, 'recover');
});

test('boss: defeating it pays ores only (never gold) and is the only way to open the exit of its mine', () => {
  for (const [zone, expectedOres, expectedWorth] of [[2, { gold: 1, crystal: 2 }, 32], [5, { lava: 3 }, 60]]) {
    const { s, p, boss } = arena(zone);
    assert.deepEqual(R.BOSS_SLOTS, { mid: 1, rare: 2 });
    s.mined = 1; s.collected = 3; // everything else the exit asks for
    s.milestones = R.MILESTONES.map(m => m.id); // already paid, so the only ores that change are the boss's
    boss.x = 1950; hold(boss, 'walk'); // alive and armoured; the arena spot has no gem under it, so no pickup muddies the ore count
    const exit = R.levelFor(zone).exit;
    place(s, exit.x + 10); run(s, 0, 5);
    assert.equal(s.status, 'playing', 'standing in the portal with the boss alive does nothing');
    assert.equal(R.canExit(s), false);
    // now it falls: stunned, one hit from death, the player next to it
    const oresBefore = { ...s.ores }, goldBefore = R.rewardFor(s);
    hold(boss, 'recover'); boss.hp = 1; place(s, boss.x - p.w - 20); p.facing = 1;
    R.step(s, I.ATTACK);
    assert.equal(boss.dead, true); assert.equal(s.bossDefeated, true); assert.equal(boss.state, 'dead');
    assert.equal(s.defeated, 1);
    const loot = s.events.find(e => e.type === 'boss_death');
    assert.deepEqual(loot.ores, expectedOres);
    assert.equal(worth(loot.ores), expectedWorth, 'about the value of one ordinary rock — the number the player is told about');
    const gained = {}; for (const [k, v] of Object.entries(s.ores)) gained[k] = v - (oresBefore[k] || 0);
    for (const k of Object.keys(R.ORES)) assert.equal(gained[k], expectedOres[k] || 0, `${k}: exactly the boss's loot was credited`);
    assert.ok(R.rewardFor(s) <= 100 && R.rewardFor(s) >= goldBefore, 'gold stays under the same cap');
    assert.equal(R.canExit(s), true);
    place(s, exit.x + 10); R.step(s, 0);
    assert.equal(s.status, 'won');
  }
});

test('boss: a second death event never happens, the dead boss stops acting, and its waves already in flight still obey their lifetime', () => {
  const { s, p, boss } = arena(2);
  boss.x = 2100; place(s, boss.x - p.w - 20); p.facing = 1;
  hold(boss, 'recover'); boss.hp = 1; R.step(s, I.ATTACK);
  assert.equal(s.events.filter(e => e.type === 'boss_death').length, 1);
  const deaths = [];
  for (let i = 0; i < 200; i++) { place(s, 1800); R.step(s, 0); deaths.push(...s.events.filter(e => e.type.startsWith('boss_'))); }
  assert.deepEqual(deaths, [], 'a dead boss neither wakes, winds up nor drops loot again');
  assert.equal(s.waves.length, 0);
});

test('boss: the runs a player records are short enough for the segment cap, and long enough to be a fight', () => {
  const longest = Math.max(...BOSS_ZONES.flatMap(zone => HEROES.map(hero => bot(R.seedFromId(`seg-${zone}`), hero, { zone }).inputs.length)));
  assert.ok(longest < 1200, `the most button-hungry perfect run needs ${longest} segments of ${R.MAX_SEGMENTS}`);
  assert.equal(R.MAX_SEGMENTS, 2400);
});

test('worlds: the camera is view-only — unchanged without a boss, and during a boss fight it keeps the boss and the player on a narrow screen', () => {
  const follow = (s, width) => Math.max(0, Math.min(R.levelFor(s.zone).width - width, s.player.x + s.player.w / 2 - width * 0.35));
  // no boss (any mine, any width, any position): exactly the old follow-camera
  for (let zone = 0; zone < 6; zone++) for (const width of [280, 344, 468, 800, 1100]) for (const x of [0, 64, 700, 1500, 2300, 2660]) {
    const s = R.create('miner', 1, { zone }); s.player.x = x;
    assert.equal(R.cameraFor(s, width), follow(s, width), `zone ${zone} width ${width} x ${x}`);
  }
  const { s, p, boss } = arena(2);
  const onScreen = (width, left, x0, x1) => x0 >= left && x1 <= left + width;
  // asleep or dead: still the follow-camera
  p.x = 2000; boss.x = 2150;
  assert.equal(R.cameraFor(s, 344), follow(s, 344), 'a sleeping boss does not pull the camera');
  boss.state = 'walk';
  const pulled = R.cameraFor(s, 344);
  assert.ok(pulled >= follow(s, 344), 'awake and to the right: the view slides right, never left');
  assert.ok(onScreen(344, pulled, boss.x - 14, boss.x + boss.w + 14), 'the boss fits on a phone-width view');
  assert.ok(p.x + p.w / 2 >= pulled + 0.12 * 344 - 1 && p.x + p.w / 2 <= pulled + 0.88 * 344 + 1, 'and the player keeps a 12% margin');
  // too far apart to fit both: back to following the player (an edge arrow tells where the boss is)
  boss.x = 2440; assert.equal(R.cameraFor(s, 344), follow(s, 344));
  // boss behind the player (to the left): the view slides left
  boss.x = 1860; p.x = 2000;
  assert.ok(R.cameraFor(s, 344) <= follow(s, 344));
  assert.ok(onScreen(344, R.cameraFor(s, 344), boss.x - 14, boss.x + boss.w + 14));
  // wide screens already show both: no change
  boss.x = 2150; p.x = 2000; assert.equal(R.cameraFor(s, 800), follow(s, 800));
  // once it falls the camera returns to normal, and it never leaves the level
  boss.dead = true; s.bossDefeated = true; boss.x = 2150; assert.equal(R.cameraFor(s, 344), follow(s, 344));
  const edge = arena(5); edge.boss.state = 'walk'; edge.boss.x = 2450; edge.p.x = 2300;
  const cam = R.cameraFor(edge.s, 344);
  assert.ok(cam >= 0 && cam <= R.levelFor(5).width - 344);
});

test('worlds: the generic bot is a controller, not a back door — it only ever uses the six real buttons', () => {
  const allowed = I.LEFT | I.RIGHT | I.JUMP | I.MINE | I.ATTACK | I.SKILL;
  for (const zone of [0, 2, 4]) {
    const { inputs, state } = bot(R.seedFromId(`buttons-${zone}`), 'miner', { zone });
    assert.ok(inputs.every(seg => (seg.mask & ~allowed) === 0 && Number.isInteger(seg.frames) && seg.frames > 0));
    assert.equal(inputs.reduce((n, seg) => n + seg.frames, 0), state.tick, 'every tick is accounted for by a recorded input');
  }
});
