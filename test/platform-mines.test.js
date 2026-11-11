// المرحلة 3 (محرك V4): ستة مناجم + ثماني معدات مؤثرة. كل شيء هنا حتمي ومحسوب من القواعد المشتركة نفسها.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');
const V3 = require('./fixtures/platform-rules-v3.cjs');
const solution = require('./fixtures/platform-solution.cjs');

const MAX_GEAR = Object.fromEntries(R.EQUIPMENT_ORDER.map(id => [id, R.MAX_EQUIP_LEVEL]));
const advance = (s, mask, n) => { for (let i = 0; i < n; i++) R.step(s, mask); return s; };
// بطل واقف بجوار أول صخرة (بلا بذرة = المخطط الافتراضي الثابت).
const nextToRock = (config, hero = 'miner') => {
  const s = R.create(hero, undefined, config);
  s.player.x = s.rocks[0].x - s.player.w - 6;
  return s;
};
const countEvents = (s, type) => s.events.filter(e => e.type === type).length;
function hitsUntilBroken(s, limit = 1200) {
  let hits = 0;
  for (let i = 0; i < limit && s.rocks[0].hp > 0; i++) { R.step(s, R.INPUT.MINE); hits += countEvents(s, 'mine'); }
  return hits;
}

test('phase 3+V6+V7+V8: the engine version is 8 and the config is normalised to safe values', () => {
  assert.equal(R.VERSION, 13);
  assert.deepEqual(R.normalizeConfig(undefined), { zone: 0, goal: 0, mode: 'mine', loadout: Object.fromEntries(R.EQUIPMENT_ORDER.map(id => [id, 0])) });
  assert.equal(R.normalizeConfig({ goal: 9 }).goal, 0, 'an unknown goal falls back to the first one');
  assert.equal(R.normalizeConfig({ goal: 2 }).goal, 2);
  assert.equal(R.normalizeConfig({ goal: 1.5 }).goal, 0);
  assert.deepEqual(R.normalizeConfig(null), R.normalizeConfig({}));
  const wild = R.normalizeConfig({ zone: 9, loadout: { pickaxe: 99, boots: -3, bag: '2', magnet: 1.9, drill: NaN, robot: Infinity, hacker: 7 } });
  assert.equal(wild.zone, 0, 'an unknown mine falls back to the first one');
  assert.deepEqual(wild.loadout, { pickaxe: 5, boots: 0, bag: 2, magnet: 1, drill: 0, robot: 5, luck: 0, armor: 0 });
  assert.equal('hacker' in wild.loadout, false, 'only whitelisted equipment survives');
  assert.equal(R.normalizeConfig({ zone: 3.5 }).zone, 0);
  assert.equal(R.normalizeConfig({ zone: '2' }).zone, 0, 'zone must be a real integer');
  assert.equal(R.normalizeConfig({ zone: 5 }).zone, 5);
  assert.deepEqual(R.normalizeProgress({ wins: [2, -1, 'x'] }).wins, [2, 0, 0, 0, 0, 0]);
  assert.deepEqual(R.normalizeProgress(null).wins, [0, 0, 0, 0, 0, 0]);
});

test('phase 3: mine 0 with an empty loadout has physics identical to the frozen V3 engine', () => {
  const driver = (seed, hero) => { // legal controller driven by the V3 engine itself
    const state = V3.create(hero, seed), masks = [];
    for (let i = 0; i < V3.MAX_TICKS && state.status === 'playing'; i++) {
      const p = state.player; let mask = V3.INPUT.RIGHT;
      if (state.rocks.some(r => r.hp > 0 && r.x >= p.x && r.x - p.x < 80)) mask |= V3.INPUT.MINE;
      if ([[665, 740], [1140, 1220], [1470, 1550], [2020, 2110]].some(([a, b]) => p.x > a && p.x < b)) mask |= V3.INPUT.JUMP;
      masks.push(mask); V3.step(state, mask);
    }
    return masks;
  };
  const snap = s => JSON.stringify({
    t: s.tick, status: s.status, pose: s.player.pose, x: s.player.x, y: s.player.y, vx: s.player.vx, vy: s.player.vy, hearts: s.player.hearts,
    inv: s.player.invulnerable, atk: s.player.attack, rocks: s.rocks.map(r => [r.x, r.hp]), gems: s.gems.map(g => [g.x, g.taken]),
    enemies: s.enemies.map(e => [e.x, e.y, e.hp, e.dead, e.vx]), proj: s.projectiles.length, collected: s.collected, mined: s.mined,
    defeated: s.defeated, damage: s.damage, milestones: s.milestones, chest: s.chestFound, cp: s.checkpoint,
  });
  let ticks = 0;
  for (const hero of ['miner', 'warrior', 'archer']) for (let i = 0; i < 6; i++) {
    const seed = V3.seedFromId(`parity-${i}`);
    let x = seed; const noise = [];
    for (let k = 0; k < 700; k++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; noise.push(x % 64); }
    for (const stream of [driver(seed, hero), noise]) {
      const old = V3.create(hero, seed), next = R.create(hero, seed, { zone: 0, loadout: {} });
      // V19.2: الخفاش هو الكائن الوحيد الذي تغيّر سلوكه عمداً (انقضاض حقيقي بدل الاهتزاز). يُستثنى من
      // مقارنة التكافؤ كي يبقى القياس صارماً على كل ما يجب ألا يتغيّر: اللاعب، الصخور، البلّورات،
      // الحرّاس الأرضيون، الزعيم، المقذوفات، المعالم، نقطة الحفظ. سلوك الخفاش له اختباراته المستقلة.
      old.enemies = old.enemies.filter(e => !e.flying);
      next.enemies = next.enemies.filter(e => !e.flying);
      for (const mask of stream) {
        if (old.status !== 'playing') break;
        V3.step(old, mask); R.step(next, mask); ticks++;
        assert.equal(snap(next), snap(old), `${hero}/${i} diverged at tick ${old.tick}`);
      }
    }
  }
  assert.ok(ticks > 15000, 'a meaningful number of ticks was compared');
});

test('phase 3: six mines — rising rock hardness, own palette, own layout, ore tiers from each table', () => {
  assert.equal(R.MINES.length, 6);
  assert.equal(R.ZONES.length, 6);
  assert.equal(R.LEVELS.length, 6, 'every mine owns a level (V5)');
  assert.deepEqual(R.MINES.map(m => m.rockHp), [3, 6, 9, 13, 18, 24]);
  const seed = R.seedFromId('mine-layout');
  for (const [i, mine] of R.MINES.entries()) {
    assert.equal(R.ZONES[i].id, mine.id);
    assert.equal(mine.weights.reduce((a, b) => a + b, 0), 100, `${mine.id} weights are percentages`);
    for (const ore of Object.values(mine.tier)) assert.ok(R.ORES[ore], `${mine.id} references a priced ore`);
    const level = R.levelFor(i), s = R.create('miner', seed, { zone: i });
    assert.deepEqual(s.rocks.map(r => r.x), R.layoutFor(seed, i).rocks.map(r => r.x), 'a run uses the layout of its own mine');
    s.rocks.forEach((r, k) => assert.ok(level.rockSpans[k].some(([a, b]) => r.x >= a && r.x <= b), `${mine.id}: rock ${k} stays inside its span`));
    assert.ok(s.rocks.every(r => r.hp === mine.rockHp && r.maxHp === mine.rockHp));
    assert.ok(s.rocks.every(r => Object.values(mine.tier).includes(r.ore)), 'rock ores come from the mine tier table');
    assert.ok(s.enemies.every(e => { const base = level.enemies.find(x => x.id === e.id); return e.maxHp === base.maxHp + mine.enemyHp && e.hp === e.maxHp; }));
    assert.equal(s.hazards.find(h => h.vent).active, mine.vent, 'the mine sets how long the timed hazard stays on');
    if (i > 0) {
      assert.equal(mine.requires.win, i - 1, 'each mine unlocks from the previous one');
      assert.ok(mine.rockHp > R.MINES[i - 1].rockHp && mine.vent > R.MINES[i - 1].vent);
    }
  }
  assert.equal(new Set(R.ZONES.map(z => z.sky[0] + z.glow)).size, 6, 'each mine looks different');
});

test('V20: each deep mine has a physically traversable upper branch over its main-route pit', () => {
  assert.equal(R.VERSION, 13);
  for (const [zone, level] of R.LEVELS.entries()) {
    if (zone === 0) continue; // keep the original stone-mine simulation byte-for-byte stable
    const route = level.platforms.filter(p => p.route === 'upper').sort((a, b) => a.x - b.x);
    assert.equal(route.length, 2, `${level.id}: exactly two upper-branch platforms`);
    assert.equal(route[0].y, 230);
    assert.equal(route[1].y, route[0].y, 'the two ledges form one walkable branch');
    assert.ok(route[1].x - (route[0].x + route[0].w) <= 16, 'the jump between ledges is short');
    assert.ok(300 - route[0].y <= 85, 'the first ledge is within the miner jump height');
    const pit = level.hazards.find(h => h.kind === 'pit');
    assert.ok(pit, `${level.id}: the branch has a real pit to bypass`);
    assert.ok(route[0].x <= pit.x && route[1].x + route[1].w >= pit.x + pit.w,
      `${level.id}: upper route spans the full pit`);
    const floor = level.platforms.find(p => p.y === 300 && p.x <= route[0].x && p.x + p.w >= route[0].x + route[0].w);
    assert.ok(floor, `${level.id}: the route can be reached from the main floor`);
  }
});

test('phase 3: ore weights per mine are honoured over a large deterministic sample', () => {
  const share = (zone, luck) => {
    const counts = { common: 0, mid: 0, rare: 0 }, mine = R.MINES[zone];
    for (let i = 0; i < 800; i++) {
      for (const rock of R.layoutFor(R.seedFromId(`ore-${i}`), zone, luck).rocks) {
        for (const slot of Object.keys(counts)) if (mine.tier[slot] === rock.ore) { counts[slot]++; break; }
      }
    }
    const total = counts.common + counts.mid + counts.rare;
    return { common: counts.common / total, mid: counts.mid / total, rare: counts.rare / total };
  };
  const stone = share(0, 0);
  assert.ok(Math.abs(stone.common - 0.72) < 0.05 && Math.abs(stone.mid - 0.24) < 0.05 && stone.rare < 0.09, JSON.stringify(stone));
  const legend = share(5, 0); // iron/lava tiers collapse into 'mid' for lava: only check the rare-heavy bias
  assert.ok(legend.rare + legend.mid > 0.8, JSON.stringify(legend));
  const lucky = share(0, 5);
  assert.ok(lucky.rare > stone.rare + 0.12, `luck 5 lifts rare ore (${stone.rare.toFixed(3)} → ${lucky.rare.toFixed(3)})`);
  assert.ok(lucky.common < stone.common - 0.12);
  assert.deepEqual(R.layoutFor(R.seedFromId('x'), 2, 3), R.layoutFor(R.seedFromId('x'), 2, 3), 'deterministic');
});

test('phase 3 / V19.2: every mine is winnable by every hero with the minimum legal gear, a mid kit and max gear', () => {
  const kit = { pickaxe: 2, boots: 3, bag: 2, magnet: 2, drill: 1, robot: 2, luck: 2, armor: 1 };
  // V19.2: «بلا معدات» ليس إعداداً شرعياً إلا في المناجم الثلاثة الأولى — الخادم نفسه يرفض فتح منجم
  // تشترط بوابته معدات (pickaxe/armor) ويعلن نقص المتطلبات. كان الاختبار يطالب بالفوز بمنجم 6 بثلاثة
  // قلوب، وهو ما لا يستطيع اللاعب الوصول إليه أصلاً. البديل: أقل عدّة يسمح بها المنجم نفسه.
  const minLegalGear = zone => ({ ...(R.MINES[zone].requires?.gear || {}) });
  for (const hero of ['miner', 'warrior', 'archer']) for (let zone = 0; zone < 6; zone++) {
    const needsGear = Boolean(R.MINES[zone].requires?.gear);
    assert.equal(R.mineStatus(zone, { wins: [9, 9, 9, 9, 9, 9] }, {}).unlocked, !needsGear,
      `mine ${zone} reports itself locked without the required gear`);
    for (const loadout of [minLegalGear(zone), kit, MAX_GEAR]) {
      const seed = R.seedFromId(`matrix-${hero}-${zone}`), config = { zone, loadout };
      const { state, inputs } = solution(seed, hero, config);
      assert.equal(state.status, 'won', `${hero} wins mine ${zone}`);
      const replayed = R.replay(inputs, hero, seed, config);
      assert.equal(replayed.ok, true);
      assert.deepEqual(replayed.state, state, 'replay with the same config is bit-identical');
      assert.ok(R.rewardFor(state) <= R.rewardCap(zone), 'a win never exceeds the declared cap for its mine');
    }
  }
});

test('phase 3: the config is part of the verification — inputs recorded with other gear do not replay as a win', () => {
  const seed = R.seedFromId('config-bound'), config = { zone: 5, loadout: MAX_GEAR };
  const { state, inputs } = solution(seed, 'miner', config);
  assert.equal(state.status, 'won');
  for (const claimed of [{ zone: 5 }, { zone: 5, loadout: { pickaxe: 1 } }, { zone: 0, loadout: MAX_GEAR }, undefined]) {
    const replay = R.replay(inputs, 'miner', seed, claimed);
    assert.notEqual(replay.ok && replay.state.status, 'won', `weaker config ${JSON.stringify(claimed)} cannot reuse a stronger run`);
  }
});

test('phase 3: pickaxe — hits to break scale with the mine hardness and the pickaxe level', () => {
  assert.equal(R.hitsToBreak('miner', 0, {}), 1);
  assert.equal(R.hitsToBreak('miner', 5, {}), 8);
  assert.equal(R.hitsToBreak('miner', 5, { pickaxe: 5 }), 3);
  assert.equal(R.hitsToBreak('warrior', 5, {}), 24);
  assert.equal(hitsUntilBroken(nextToRock({ zone: 2 })), 3, 'hp 9 / power 3');
  assert.equal(hitsUntilBroken(nextToRock({ zone: 2, loadout: { pickaxe: 3 } })), 2, 'hp 9 / power 6');
  assert.equal(hitsUntilBroken(nextToRock({ zone: 5, loadout: { pickaxe: 5 } })), 3, 'hp 24 / power 8');
  assert.equal(R.create('miner', 1, { loadout: { pickaxe: 4 } }).player.miningPower, 7);
  const s = nextToRock({ zone: 1 });
  R.step(s, R.INPUT.MINE);
  assert.equal(s.rocks[0].hp, 3, 'a 6-hp rock survives the first 3-power hit');
  assert.equal(s.mined, 0);
});

test('phase 3: boots — speed rises by 4% per level and covers more ground', () => {
  assert.equal(R.loadoutStats('miner', {}).speed, 210);
  assert.equal(R.loadoutStats('miner', { boots: 5 }).speed, 252);
  assert.equal(R.loadoutStats('archer', { boots: 5 }).speed, 274);
  const base = advance(R.create('miner', 1), R.INPUT.RIGHT, 40), fast = advance(R.create('miner', 1, { loadout: { boots: 5 } }), R.INPUT.RIGHT, 40);
  assert.ok(fast.player.x > base.player.x + 20, `${fast.player.x} vs ${base.player.x}`);
  for (const hero of Object.keys(R.CHARACTERS)) assert.ok(R.loadoutStats(hero, MAX_GEAR).speed / R.FPS < 8, 'never fast enough to tunnel through a 20px platform');
});

test('phase 3: bag — rock yield is multiplied by 15% per level and rounded up', () => {
  const haul = (level, yieldPerRock) => {
    const s = nextToRock({ zone: 0, loadout: { bag: level } });
    Object.assign(s.rocks[0], { ore: 'lava', yield: yieldPerRock }); // an ore no zone-0 milestone pays, so the count is exact
    hitsUntilBroken(s);
    return s.ores.lava;
  };
  assert.equal(haul(0, 4), 4, 'no bag = V3 yield');
  assert.equal(haul(1, 4), 5);
  assert.equal(haul(5, 4), 7);
  assert.equal(haul(1, 2), 3);
  assert.equal(haul(5, 2), 4);
  assert.equal(R.loadoutStats('miner', { bag: 3 }).yieldPercent, 145);
});

test('phase 3: magnet — gems are collected from further away without moving', () => {
  const probe = level => {
    const s = R.create('miner', undefined, { loadout: { magnet: level } });
    s.gems = [{ x: s.player.x + s.player.w + 32, y: s.player.y + 12, taken: false }];
    R.step(s, 0);
    return s.gems[0].taken;
  };
  assert.equal(probe(0), false);
  assert.equal(probe(1), false, '12px is not enough for a gem 32px away');
  assert.equal(probe(3), true, '36px pull reaches it');
  assert.equal(probe(5), true);
});

test('phase 3: drill — shorter swing cooldown and longer reach', () => {
  const stats = R.loadoutStats('miner', { drill: 5 });
  assert.equal(stats.attackCooldown, 9); assert.equal(stats.miningReach, 91);
  const swings = level => {
    const s = nextToRock({ zone: 0, loadout: { drill: level } });
    s.rocks[0].hp = s.rocks[0].maxHp = 9999;
    let n = 0; for (let i = 0; i < 300; i++) { R.step(s, R.INPUT.MINE); n += countEvents(s, 'mine'); }
    return n;
  };
  assert.equal(swings(0), 22);
  assert.equal(swings(5), 34);
  const far = level => { // rock 80px beyond the miner's front edge: base reach 66 misses, drill 5 (91) hits
    const s = R.create('miner', undefined, { loadout: { drill: level } });
    s.player.x = s.rocks[0].x - s.player.w - 80;
    R.step(s, R.INPUT.MINE);
    return { hit: countEvents(s, 'mine'), miss: countEvents(s, 'mine_miss') };
  };
  assert.deepEqual(far(0), { hit: 0, miss: 1 });
  assert.deepEqual(far(5), { hit: 1, miss: 0 });
});

test('phase 3: robot — auto-mines the nearest rock in range, never out of range, and is deterministic', () => {
  assert.equal(R.loadoutStats('miner', {}).robot, null);
  assert.deepEqual(R.loadoutStats('miner', { robot: 3 }).robot, { period: 106, damage: 4, range: 170 });
  const idle = (level, x) => {
    const s = R.create('miner', undefined, { loadout: { robot: level } });
    s.player.x = x;
    const events = [];
    for (let i = 0; i < 400; i++) { R.step(s, 0); for (const e of s.events) if (e.type === 'robot_mine') events.push({ tick: s.tick, ...e }); }
    return { s, events };
  };
  const near = idle(3, 380);
  assert.equal(near.events[0].tick, 106, 'first pulse after exactly one period');
  assert.equal(near.s.rocks[0].hp, 0, '4 damage breaks the 3-hp rock in one pulse');
  assert.equal(near.s.mined, 1);
  assert.ok(near.s.ores.copper + near.s.ores.iron + near.s.ores.gold >= 2, 'robot breaks pay real ores');
  const slow = idle(1, 380); // 2 damage per 162 ticks: needs two pulses
  assert.deepEqual(slow.events.map(e => e.tick), [162, 324]);
  assert.equal(slow.s.rocks[0].hp, 0);
  const far = idle(5, 64); // the rock is 387px away: out of the 170px range
  assert.equal(far.events.length, 0); assert.equal(far.s.mined, 0);
  assert.deepEqual(idle(2, 380).s, idle(2, 380).s, 'same inputs, same gear, same state');
  const nearest = R.create('miner', undefined, { loadout: { robot: 5 } });
  nearest.player.x = 500; // between rock 0 (440..486, 14px behind) and nothing else in range
  advance(nearest, 0, 50);
  assert.equal(nearest.rocks[0].hp, 0, 'the nearest rock is chosen even when it is behind the hero');
});

test('phase 3: luck — shifts weight from common to rare ore, never below 5% common', () => {
  assert.equal(R.loadoutStats('miner', { luck: 5 }).luck, 5);
  const gold0 = R.MINES[0].tier.rare;
  const rareShare = level => {
    let rare = 0, total = 0;
    for (let i = 0; i < 600; i++) for (const rock of R.layoutFor(R.seedFromId(`luck-${i}`), 0, level).rocks) { total++; if (rock.ore === gold0) rare++; }
    return rare / total;
  };
  const l0 = rareShare(0), l5 = rareShare(5);
  assert.ok(l5 > l0 * 3, `rare share ${l0.toFixed(3)} → ${l5.toFixed(3)}`);
});

test('phase 3: armor — extra hearts every second level and a longer hurt window', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(L => R.loadoutStats('miner', { armor: L }).hearts), [3, 4, 4, 5, 5, 6]);
  assert.deepEqual([0, 5].map(L => R.loadoutStats('miner', { armor: L }).hurtInvulnerable), [90, 130]);
  const hurt = L => {
    const s = R.create('miner', undefined, { loadout: { armor: L } });
    s.player.x = 2085; s.player.y = 262; // standing in the spike strip
    R.step(s, 0);
    return { hearts: s.player.hearts, inv: s.player.invulnerable, damage: s.damage };
  };
  assert.deepEqual(hurt(0), { hearts: 2, inv: 90, damage: 1 });
  assert.deepEqual(hurt(5), { hearts: 5, inv: 130, damage: 1 });
  const longer = R.create('miner', undefined, { loadout: { armor: 5 } });
  longer.player.x = 2085; longer.player.y = 262; R.step(longer, 0);
  advance(longer, 0, 40);
  assert.ok(longer.player.invulnerable > 60 && longer.player.pose !== 'hurt', 'the hurt pose keeps its original ~30 ticks');
});

test('phase 3: equipment costs are integer gold plus one ladder ore, strictly rising and capped at level 5', () => {
  assert.deepEqual(R.equipCost('pickaxe', 0), { gold: 50, ores: { copper: 6 } });
  assert.deepEqual(R.equipCost('pickaxe', 1), { gold: 80, ores: { iron: 6 } });
  assert.deepEqual(R.equipCost('pickaxe', 2), { gold: 128, ores: { gold: 6 } });
  assert.deepEqual(R.equipCost('pickaxe', 3), { gold: 205, ores: { crystal: 5 } });
  assert.deepEqual(R.equipCost('pickaxe', 4), { gold: 328, ores: { lava: 4 } });
  assert.deepEqual(R.equipCost('drill', 0), { gold: 90, ores: { copper: 9 } });
  assert.equal(R.equipCost('pickaxe', 5), null, 'max level has no next upgrade');
  assert.equal(R.equipCost('nonsense', 0), null);
  assert.deepEqual(R.equipCost('pickaxe', -4), R.equipCost('pickaxe', 0), 'levels are clamped');
  for (const id of R.EQUIPMENT_ORDER) {
    let last = 0;
    for (let L = 0; L < R.MAX_EQUIP_LEVEL; L++) {
      const cost = R.equipCost(id, L);
      assert.ok(Number.isInteger(cost.gold) && cost.gold > last, `${id} L${L} gold rises`);
      const [ore, qty] = Object.entries(cost.ores)[0];
      assert.equal(Object.keys(cost.ores).length, 1);
      assert.equal(ore, R.ORE_LADDER[L]); assert.ok(Number.isInteger(qty) && qty >= 4);
      last = cost.gold;
    }
  }
  let total = 0; for (const id of R.EQUIPMENT_ORDER) for (let L = 0; L < 5; L++) total += R.equipCost(id, L).gold;
  assert.ok(total > 8000 && total < 14000, `a full set is a long-term goal (${total} gold)`);
});

test('phase 3: effect texts describe real numbers and level 0 gives nothing', () => {
  for (const id of R.EQUIPMENT_ORDER) {
    assert.ok(R.EQUIPMENT[id].name && R.EQUIPMENT[id].icon && R.EQUIPMENT[id].blurb);
    assert.ok(/[٠-٩\u0600-\u06FF]/.test(R.effectText(id, 0)), 'Arabic label even at level 0');
    assert.notEqual(R.effectText(id, 1), R.effectText(id, 2));
    assert.ok(/\d/.test(R.effectText(id, 3)));
  }
  assert.equal(R.effectText('pickaxe', 3), '+3 قوة تعدين لكل ضربة');
  assert.equal(R.effectText('boots', 5), '+20% سرعة حركة');
  assert.equal(R.effectText('missing', 1), '');
});

test('phase 3: unlock rules — win the previous mine and own the required gear', () => {
  const wins = (...v) => ({ wins: v });
  assert.equal(R.mineUnlocked(0, wins(), {}), true, 'the first mine is always open');
  assert.equal(R.mineUnlocked(1, wins(), {}), false);
  assert.equal(R.mineUnlocked(1, wins(1), {}), true);
  assert.equal(R.mineUnlocked(2, wins(1, 1), {}), false, 'gold caves need a pickaxe too');
  assert.deepEqual(R.mineStatus(2, wins(1, 1), {}).needs.filter(n => !n.ok).map(n => n.id), ['pickaxe']);
  assert.equal(R.mineUnlocked(2, wins(1, 1), { pickaxe: 1 }), true);
  assert.equal(R.mineUnlocked(3, wins(1, 1, 1), { pickaxe: 2 }), false);
  assert.equal(R.mineUnlocked(3, wins(1, 1, 1), { pickaxe: 2, armor: 1 }), true);
  assert.equal(R.mineUnlocked(5, wins(1, 1, 1, 1, 1), { pickaxe: 4, armor: 2 }), false);
  assert.equal(R.mineUnlocked(5, wins(1, 1, 1, 1, 1), { pickaxe: 4, armor: 3 }), true);
  assert.equal(R.mineUnlocked(5, wins(1, 1, 0, 0, 0), MAX_GEAR), false, 'gear never lets you skip a mine');
  assert.equal(R.mineUnlocked(4, wins(1, 1, 1, 0), MAX_GEAR), false, 'the previous mine must really be won');
  assert.equal(R.mineStatus(7, wins(), {}), null);
  assert.equal(R.mineUnlocked(-1, wins(), {}), false);
  assert.equal(R.mineStatus(0, wins(4), {}).wins, 4);
  for (const n of R.mineStatus(3, wins(), {}).needs) assert.equal(typeof n.label, 'string');
});

test('phase 3: progression has no deadlock — every gear gate needs ores from earlier mines only', () => {
  for (const [k, mine] of R.MINES.entries()) {
    if (!mine.requires?.gear) continue;
    const earlier = new Set();
    for (const m of R.MINES.slice(0, k)) for (const ore of Object.values(m.tier)) earlier.add(ore);
    for (const [id, level] of Object.entries(mine.requires.gear)) {
      assert.ok(R.EQUIPMENT[id], `${id} is real equipment`);
      for (let step = 0; step < level; step++) {
        const ore = Object.keys(R.equipCost(id, step).ores)[0];
        assert.ok(earlier.has(ore), `${mine.id}: ${id} L${step + 1} needs ${ore}, which must drop in an earlier mine`);
      }
    }
  }
});

test('phase 3: race and arena engines stay independent of the platform rules', () => {
  const root = path.join(__dirname, '..');
  for (const file of ['race-rules.js', 'public/arena-rules.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(/platform-rules|PlatformRules/.test(text), false, `${file} must not import the platform rules`);
  }
});
