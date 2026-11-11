// اختبارات نموذج «الحفر العميق» (public/deep-dig.js): محرك حتمي بلا DOM.
// كل اختبار يبني مشهداً صغيراً مضبوطاً (عالم صخر فارغ + بلاطات نضعها يدوياً) ليتحقق من قاعدة واحدة بدقة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const DD = require('../public/deep-dig.js');
const Platform = require('../public/platform-rules.js');

const T = DD.TILE;
const TICK = DD.DT;
const ticksFor = (seconds) => Math.round(seconds / TICK);

// عالم صخر نظيف: صخر في الصفوف 1..60 (بلا خامات ولا أخطار)، السطح هواء، الصف 61 أساس + صندوق
function blank(opts) {
  const g = DD.create(Object.assign({ seed: 7 }, opts));
  for (let r = 1; r <= DD.LAST_ROCK_ROW; r++) for (let c = 0; c < DD.COLS; c++) { g.tiles[DD.idx(c, r)] = T.ROCK; g.ore[DD.idx(c, r)] = 0; }
  return g;
}
const put = (g, c, r, kind, ore) => { g.tiles[DD.idx(c, r)] = kind; g.ore[DD.idx(c, r)] = ore || 0; };
const air = (g, c, r) => put(g, c, r, T.AIR);
const shaft = (g, c, r0, r1) => { for (let r = r0; r <= r1; r++) air(g, c, r); };
const place = (g, c, r) => { g.miner.col = c; g.miner.row = r; g.miner.maxRow = Math.max(g.miner.maxRow, r); };
function run(g, input, seconds) { for (let i = 0; i < ticksFor(seconds) && g.status === 'running'; i++) DD.tick(g, input); }
function runUntil(g, input, pred, maxSeconds = 20) {
  let n = 0;
  while (!pred(g) && g.status === 'running' && n < ticksFor(maxSeconds)) { DD.tick(g, input); n++; }
  return n;
}
const types = (events) => events.map((e) => e.type);
const DOWN = { dx: 0, dy: 1 }, UP = { dx: 0, dy: -1 }, LEFT = { dx: -1, dy: 0 }, RIGHT = { dx: 1, dy: 0 }, NONE = { dx: 0, dy: 0 };

// ───────────────────────────── العالم ─────────────────────────────
test('world: dimensions, surface, treasure chamber and tile/ore bookkeeping', () => {
  const g = DD.create({ seed: 12345 });
  assert.equal(g.tiles.length, DD.COLS * DD.ROWS);
  for (let c = 0; c < DD.COLS; c++) {
    assert.equal(DD.kindAt(g, c, 0), T.AIR, 'السطح كله هواء');
    for (let r = 1; r <= DD.LAST_ROCK_ROW; r++) assert.notEqual(DD.kindAt(g, c, r), T.AIR);
    assert.equal(DD.kindAt(g, c, DD.CHEST_ROW), c === DD.MID ? T.CHEST : T.BEDROCK);
  }
  for (let i = 0; i < g.tiles.length; i++) assert.equal(g.tiles[i] === T.ORE, g.ore[i] > 0, 'كل بلاطة خام لها نوع، وغيرها بلا نوع');
  assert.equal(DD.kindAt(g, -1, 5), T.BEDROCK);
  assert.equal(DD.kindAt(g, 7, 5), T.BEDROCK);
  assert.equal(DD.kindAt(g, 3, 99), T.BEDROCK);
  assert.equal(g.miner.col, DD.MID);
  assert.equal(g.miner.row, 0);
});

test('world: the same seed and luck always give the same world; other seeds differ', () => {
  const a = DD.create({ seed: 99, equipment: { luck: 2 } }), b = DD.create({ seed: 99, equipment: { luck: 2 } }), c = DD.create({ seed: 100, equipment: { luck: 2 } });
  assert.deepEqual([...a.tiles], [...b.tiles]);
  assert.deepEqual([...a.ore], [...b.ore]);
  assert.notDeepEqual([...a.tiles], [...c.tiles]);
});

test('world: safe start, lava never more than two per row, the road to the chest stays open (300 seeds)', () => {
  for (let s = 1; s <= 300; s++) {
    const g = DD.create({ seed: s * 7919 + 3 });
    for (let r = 1; r <= DD.LAST_ROCK_ROW; r++) {
      let lava = 0;
      for (let c = 0; c < DD.COLS; c++) {
        const k = DD.kindAt(g, c, r);
        if (k === T.LAVA) lava++;
        if (r < 5) assert.ok(k !== T.GAS && k !== T.BOULDER && k !== T.LAVA, `خطر قرب السطح seed=${s} r=${r}`);
        if (k === T.GAS) assert.ok(r >= 16, `غاز مبكر seed=${s} r=${r}`);
        if (k === T.LAVA) assert.ok(r >= 40, `حمم مبكرة seed=${s} r=${r}`);
        if (c === DD.MID && r >= DD.LAST_ROCK_ROW - 3) assert.notEqual(k, T.LAVA, `حمم على طريق الصندوق seed=${s}`);
      }
      assert.ok(lava <= 2, `أكثر من حممتين في الصف seed=${s} r=${r}`);
    }
  }
});

test('world: loose boulders start at row 5 (the first layer teaches the rule cheaply) and are not rare there', () => {
  let early = 0;
  for (let s = 1; s <= 300; s++) {
    const g = DD.create({ seed: s * 2909 + 11 });
    for (let r = 1; r <= 12; r++) for (let c = 0; c < DD.COLS; c++) if (DD.kindAt(g, c, r) === T.BOULDER) { assert.ok(r >= 5, `صخرة سائبة قرب السطح r=${r}`); early++; }
  }
  assert.ok(early >= 100 && early <= 400, `صخور سائبة في الطبقة الأولى عبر 300 عالم: ${early}`);
});

test('world: ores respect their layer (a vein may spill one row into the next); relics are rare, deep and scale with luck', () => {
  const allowed = [['copper', 'iron'], ['copper', 'iron', 'gold'], ['iron', 'gold', 'crystal'], ['gold', 'crystal', 'lava'], ['crystal', 'lava']];
  const totals = { 0: 0, 3: 0, 5: 0 };
  for (let s = 1; s <= 60; s++) {
    for (const [luck, most] of [[0, 1], [3, 2], [5, 3]]) {
      const g = DD.create({ seed: s * 31 + 1, equipment: { luck } });
      let relics = 0;
      for (let r = 1; r <= DD.LAST_ROCK_ROW; r++) for (let c = 0; c < DD.COLS; c++) {
        const n = DD.oreAt(g, c, r);
        if (!n) continue;
        const id = DD.ORE_IDS[n - 1], L = DD.layerIndex(r);
        if (id === 'relic') { relics++; assert.ok(r >= 28 && r <= 58, `أثر خارج النطاق r=${r}`); continue; }
        const spill = r === DD.LAYERS[L].from && L > 0 && allowed[L - 1].includes(id);   // عرق بدأ في آخر صف من الطبقة السابقة
        assert.ok(allowed[L].includes(id) || spill, `${id} في الطبقة ${L} (r=${r})`);
      }
      assert.ok(relics >= 1 && relics <= most, `آثار=${relics} للحظ ${luck}`);
      totals[luck] += relics;
    }
  }
  assert.ok(totals[0] >= 55 && totals[0] <= 60, `أثر واحد لكل عالم بلا حظ: ${totals[0]}/60`);
  assert.ok(totals[3] > totals[0] * 1.6 && totals[5] > totals[3] * 1.3, `الحظ يزيد الآثار: ${JSON.stringify(totals)}`);
});

test('world: ore density is 9-20% per layer (a full bag must still be a decision) and luck adds a little', () => {
  const dens = (luck) => {
    const ore = [0, 0, 0, 0, 0], tot = [0, 0, 0, 0, 0];
    for (let s = 1; s <= 120; s++) {
      const g = DD.create({ seed: s * 104729 + 13, equipment: { luck } });
      for (let r = 1; r <= DD.LAST_ROCK_ROW; r++) for (let c = 0; c < DD.COLS; c++) { const L = DD.layerIndex(r); tot[L]++; if (DD.kindAt(g, c, r) === T.ORE) ore[L]++; }
    }
    return ore.map((n, i) => n / tot[i]);
  };
  const base = dens(0), lucky = dens(5);
  base.forEach((d, i) => assert.ok(d > 0.09 && d < 0.20, `الطبقة ${i}: ${(d * 100).toFixed(1)}%`));
  assert.ok(lucky.reduce((a, b) => a + b) > base.reduce((a, b) => a + b), 'الحظ يزيد الخامات');
});

test('prices are the platform engine ladder (copper..lava), so rewards can reuse them later', () => {
  for (const k of ['copper', 'iron', 'gold', 'crystal', 'lava']) {
    assert.equal(DD.ORES[k].price, Platform.ORES[k].price, k);
    assert.equal(DD.ORES[k].name, Platform.ORES[k].name, k);
  }
  assert.ok(DD.ORES.relic.price > DD.ORES.lava.price * 3, 'الأثر القديم نادر وثمين');
  assert.deepEqual([...DD.ORE_IDS].slice(0, 5), [...Platform.ORE_LADDER]);
  assert.deepEqual([...DD.EQUIPMENT_KEYS].sort(), [...Platform.EQUIPMENT_ORDER].sort(), 'نفس معدات الورشة');
  assert.equal(DD.MAX_LEVEL, Platform.MAX_EQUIP_LEVEL);
});

// ───────────────────────────── المعدات ─────────────────────────────
test('equipment: levels are clamped and floored; every item changes something measurable', () => {
  assert.deepEqual(DD.normalizeEquipment({ pickaxe: 9, boots: -3, bag: 2.9, magnet: 'x', drill: null }), { pickaxe: 5, boots: 0, bag: 2, magnet: 0, drill: 0, robot: 0, luck: 0, armor: 0 });
  assert.deepEqual(DD.normalizeEquipment(null), { pickaxe: 0, boots: 0, bag: 0, magnet: 0, drill: 0, robot: 0, luck: 0, armor: 0 });
  const s0 = DD.loadoutStats({}), s5 = DD.loadoutStats({ pickaxe: 5, boots: 5, bag: 5, magnet: 5, drill: 5, robot: 5, luck: 5, armor: 5 });
  assert.equal(s0.digSpeed, 1); assert.ok(Math.abs(s5.digSpeed - 2.3) < 1e-9);
  assert.equal(s0.bagCap, 8); assert.equal(s5.bagCap, 18);
  assert.equal(s0.maxHp, 5); assert.equal(s5.maxHp, 7);
  assert.ok(s5.moveSpeed > s0.moveSpeed && s5.scan > s0.scan && s5.light > s0.light);
  for (const st of [s0, s5]) assert.ok(st.scan > st.light, 'العروق تلمع أبعد من ضوء الشعلة');
});

// ───────────────────────────── الحركة والحفر ─────────────────────────────
test('move: a free tile takes 1/moveSpeed seconds and a corridor keeps that average speed (no stall per tile)', () => {
  const g = blank();
  shaft(g, 3, 0, 14);
  const per = 1 / (g.stats.moveSpeed * TICK);                  // نبضات لكل بلاطة ≈ 9.68
  const n = runUntil(g, DOWN, (x) => x.miner.row === 1);
  assert.ok(Math.abs(n - per) <= 1.5, `${n} نبضة بدل ~${per.toFixed(1)}`);
  const t0 = g.tick;
  runUntil(g, DOWN, (x) => x.miner.row === 13);
  const perTile = (g.tick - t0) / 12;
  assert.ok(Math.abs(perTile - per) < 0.15, `متوسط ${perTile.toFixed(2)} نبضة للبلاطة بدل ${per.toFixed(2)} (التأخير عند كل بلاطة ≈ 10.00)`);
});

test('dig: rock takes its layer hardness, then the miner steps in; pickaxe + drill shorten it', () => {
  const timeFor = (row, equipment) => {
    const g = blank({ equipment });
    shaft(g, 3, 0, row - 1);
    place(g, 3, row - 1);
    const n = runUntil(g, DOWN, (x) => DD.kindAt(x, 3, row) === T.AIR);
    return { sec: n * TICK, g };
  };
  assert.ok(Math.abs(timeFor(5, {}).sec - 0.32) <= 0.04, 'حجر 0.32ث');
  assert.ok(Math.abs(timeFor(30, {}).sec - 0.85) <= 0.04, 'ذهب 0.85ث');
  assert.ok(Math.abs(timeFor(55, {}).sec - 1.65) <= 0.04, 'حمم 1.65ث');
  const fast = timeFor(30, { pickaxe: 5, drill: 5 });
  assert.ok(Math.abs(fast.sec - 0.85 / 2.3) <= 0.04, `مع المعدات ${fast.sec}`);
  const after = timeFor(5, {}).g;
  run(after, DOWN, 0.4);
  assert.equal(after.miner.row, 5, 'يدخل البلاطة المحفورة تلقائياً ما دامت العصا مدفوعة');
});

test('dig: progress survives a short release (0.4 s) but not a long one; another direction restarts from zero', () => {
  const setup = () => { const g = blank(); air(g, 3, 0); place(g, 3, 0); put(g, 3, 1, T.ROCK); return g; };
  let g = setup();
  run(g, DOWN, 0.2); run(g, NONE, 0.3);
  assert.ok(g.miner.dig && g.miner.dig.t > 0.19, 'ما زال التقدّم محفوظاً');
  const n = runUntil(g, DOWN, (x) => DD.kindAt(x, 3, 1) === T.AIR);
  assert.ok(n * TICK < 0.16, `يكمل الباقي فقط (${(n * TICK).toFixed(2)}ث)`);
  g = setup(); run(g, DOWN, 0.2); run(g, NONE, 0.5);
  assert.equal(g.miner.dig, null, 'الانقطاع الطويل يصفّر التقدّم');
  g = blank(); air(g, 3, 0); place(g, 3, 0); put(g, 2, 0, T.ROCK); put(g, 4, 0, T.ROCK);
  run(g, LEFT, 0.1); assert.deepEqual([g.miner.dig.col, g.miner.dig.row], [2, 0]);
  run(g, RIGHT, 0.05);
  assert.deepEqual([g.miner.dig.col, g.miner.dig.row], [4, 0], 'اتجاه جديد = بلاطة جديدة');
  assert.ok(g.miner.dig.t < 0.07, 'من الصفر');
});

test('dig: the pick hits at once and then once per hit period (sound and dust follow these events)', () => {
  const g = blank(); air(g, 3, 0); place(g, 3, 0); put(g, 3, 1, T.BOULDER);   // 0.58ث: يتسع لثلاث ضربات
  const hits = [];
  for (let i = 0; i < ticksFor(0.55); i++) { DD.tick(g, DOWN); for (const e of DD.drainEvents(g)) if (e.type === 'dig_hit') hits.push(g.time); }
  assert.ok(hits.length >= 3, `ضربات=${hits.length}`);
  assert.ok(hits[0] < 0.05, 'ضربة فورية عند البدء');
  assert.ok(Math.abs(hits[1] - hits[0] - DD.CFG.hitPeriod) < 0.03);
});

test('blocked: bedrock, lava and the world edge cannot be dug or entered, and bumps are throttled', () => {
  const g = blank(); air(g, 3, 5); place(g, 3, 5);
  put(g, 3, 6, T.LAVA); put(g, 2, 5, T.BEDROCK);
  run(g, DOWN, 1); assert.equal(g.miner.row, 5); assert.equal(DD.kindAt(g, 3, 6), T.LAVA);
  run(g, LEFT, 1); assert.equal(g.miner.col, 3);
  const h = DD.create({ seed: 3 }); place(h, 0, 0);
  const bumps = [];
  for (let i = 0; i < 90; i++) { DD.tick(h, LEFT); for (const e of DD.drainEvents(h)) if (e.type === 'bump') bumps.push(i); }
  assert.equal(h.miner.col, 0, 'حافة العالم');
  assert.ok(bumps.length >= 3 && bumps.length <= 5, `اصطدامات=${bumps.length} خلال 1.5ث`);
});

test('input: one axis at a time — the last axis wins a diagonal; facing follows horizontal input', () => {
  const g = blank(); for (let c = 0; c < DD.COLS; c++) air(g, c, 0); put(g, 3, 1, T.ROCK); place(g, 3, 0);
  assert.equal(g.miner.axis, 'v');
  run(g, { dx: 1, dy: 1 }, 0.05);
  assert.ok(g.miner.dig && g.miner.dig.row === 1 && g.miner.move === null, 'الاتجاه الرأسي أولاً (آخر محور)');
  run(g, LEFT, 0.5);
  assert.equal(g.miner.axis, 'h'); assert.equal(g.miner.face, -1);
  assert.ok(g.miner.col < 3);
  const before = g.miner.col;
  run(g, { dx: 1, dy: 1 }, 0.5);
  assert.ok(g.miner.col > before, 'بعد الأفقي يفوز الأفقي');
  assert.equal(g.miner.face, 1);
});

test('ore: digging an ore tile fills the bag and removes the ore; the bag cap is the loadout bag', () => {
  const g = blank(); air(g, 3, 0); place(g, 3, 0);
  put(g, 3, 1, T.ORE, DD.ORE_N.copper);
  run(g, DOWN, 0.6);
  assert.equal(g.bag.copper, 1); assert.equal(g.bagCount, 1);
  assert.equal(g.ore[DD.idx(3, 1)], 0);
  const ev = types(DD.drainEvents(g));
  assert.ok(ev.includes('ore') && ev.includes('dug'));
  assert.equal(g.stats.bagCap, 8);
});

test('bag: when full, a pricier ore replaces the cheapest piece; an equal or cheaper one is lost', () => {
  const full = (kind) => { const g = blank(); air(g, 3, 0); place(g, 3, 0); g.bag[kind] = 8; g.bagCount = 8; return g; };
  let g = full('copper'); put(g, 3, 1, T.ORE, DD.ORE_N.gold); run(g, DOWN, 0.6);
  assert.deepEqual([g.bag.copper, g.bag.gold, g.bagCount], [7, 1, 8]);
  assert.ok(DD.drainEvents(g).some((e) => e.type === 'ore_swap' && e.kind === 'gold' && e.dropped === 'copper'));
  g = full('gold'); put(g, 3, 1, T.ORE, DD.ORE_N.copper); run(g, DOWN, 0.6);
  assert.deepEqual([g.bag.gold, g.bag.copper, g.bagCount], [8, 0, 8]);
  assert.ok(DD.drainEvents(g).some((e) => e.type === 'bag_full'));
  g = full('crystal'); put(g, 3, 1, T.ORE, DD.ORE_N.relic); run(g, DOWN, 0.6);
  assert.equal(g.bag.relic, 1, 'الأثر القديم يحلّ دائماً');
  g = full('gold'); put(g, 3, 1, T.ORE, DD.ORE_N.gold); run(g, DOWN, 0.6);
  assert.deepEqual([g.bag.gold, g.bagCount], [8, 8], 'الخامة المساوية لا تبدّل');
  const evs = types(DD.drainEvents(g));
  assert.ok(evs.includes('bag_full') && !evs.includes('ore_swap'), 'والحدث «حقيبة ممتلئة» لا «استبدال»');
});

// ───────────────────────────── الصخور السائبة ─────────────────────────────
// نفق جانبي رأسي في العمود 2 (المعدّن في (2,5))؛ صخرة سائبة في (3,4) فوق بلاطة صخر (3,5)
function boulderScene(equipment) {
  const g = blank({ equipment });
  shaft(g, 2, 0, 5);
  put(g, 3, 4, T.BOULDER); put(g, 3, 5, T.ROCK);
  place(g, 2, 5);
  return g;
}
// يحفر البلاطة (3,5) تحت الصخرة ثم يترك العصا (فلا يدخل المعدّن تحتها)
const digUnderBoulder = (g) => runUntil(g, RIGHT, (x) => DD.kindAt(x, 3, 5) === T.AIR);

test('boulder: one resting on rock stays put; digging the tile under it wakes it with a warning', () => {
  const g = boulderScene();
  run(g, NONE, 2);
  assert.equal(DD.kindAt(g, 3, 4), T.BOULDER); assert.equal(g.loose.length, 0);
  digUnderBoulder(g);
  const ev = DD.drainEvents(g);
  assert.ok(ev.some((e) => e.type === 'rumble' && e.c === 3 && e.r === 4), 'إنذار اهتزاز');
  assert.equal(DD.kindAt(g, 3, 4), T.BOULDER, 'ما زالت في مكانها خلال الاهتزاز');
  assert.equal(g.loose.length, 1);
});

test('boulder: after ~0.7 s of warning it falls and lands on the solid ground below', () => {
  const g = boulderScene();
  digUnderBoulder(g);
  const t0 = g.time;
  runUntil(g, NONE, (x) => x.loose.some((b) => b.fall), 3);
  const warn = g.time - t0;
  assert.ok(warn >= 0.6 && warn <= 0.8, `نافذة الإنذار (${warn.toFixed(2)}ث) هي ما يجعل الصخرة عادلة: بين 0.6 و0.8ث`);
  runUntil(g, NONE, (x) => x.loose.length === 0, 3);
  assert.equal(DD.kindAt(g, 3, 5), T.BOULDER, 'استقرت في البلاطة المحفورة');
  assert.equal(DD.kindAt(g, 3, 4), T.AIR);
  const ev = types(DD.drainEvents(g));
  assert.ok(ev.includes('boulder_fall') && ev.includes('boulder_land'));
});

test('boulder: it lands exactly where support ends and becomes a solid tile again', () => {
  const g = blank();
  put(g, 3, 4, T.BOULDER); shaft(g, 3, 5, 8);              // نفق رأسي تحتها (بلا سند)
  g.loose.push({ c: 3, r: 4, wobble: 0.01, fall: null });  // كأنها استيقظت للتو
  run(g, NONE, 0.2);
  assert.equal(g.loose.length, 1, 'ما زالت تسقط');
  runUntil(g, NONE, (x) => x.loose.length === 0, 3);
  assert.equal(DD.kindAt(g, 3, 8), T.BOULDER, 'استقرت فوق الصخر في آخر بلاطة فارغة');
  assert.equal(DD.kindAt(g, 3, 4), T.AIR);
  assert.ok(types(DD.drainEvents(g)).includes('boulder_land'));
});

test('boulder: it hits a miner standing below (2 damage, 1 with armor 3), stuns, and grants brief invulnerability', () => {
  for (const [armor, dmg] of [[0, 2], [3, 1], [5, 1]]) {
    const g = blank({ equipment: { armor } });
    put(g, 3, 4, T.BOULDER); shaft(g, 3, 5, 7); place(g, 3, 6);
    const hp0 = g.miner.hp;
    g.loose.push({ c: 3, r: 4, wobble: 0.01, fall: null });
    runUntil(g, NONE, (x) => x.miner.hp < hp0, 3);
    assert.equal(hp0 - g.miner.hp, dmg, `درع ${armor}`);
    assert.ok(g.miner.stun > 0 || g.miner.state === 'hurt');
    assert.ok(g.miner.inv > 0);
    const ev = DD.drainEvents(g);
    assert.ok(ev.some((e) => e.type === 'boulder_hit') && ev.some((e) => e.type === 'hurt' && e.kind === 'boulder'));
    assert.equal(g.loose.length, 0, 'تحطّمت الصخرة');
  }
});

test('boulder: stepping out of the column during the wobble avoids all damage', () => {
  const g = blank();
  put(g, 3, 4, T.BOULDER); shaft(g, 3, 5, 6); air(g, 2, 6); place(g, 3, 6);
  g.loose.push({ c: 3, r: 4, wobble: DD.CFG.wobble, fall: null });
  const hp0 = g.miner.hp;
  run(g, LEFT, 0.3);                                   // يخرج جانباً خلال الاهتزاز
  assert.equal(g.miner.col, 2);
  run(g, NONE, 2);
  assert.equal(g.miner.hp, hp0, 'لا ضرر');
  assert.equal(DD.kindAt(g, 3, 6), T.BOULDER, 'هبطت في النفق الفارغ');
});

test('boulder: a stack falls one after another; a boulder in flight blocks the tile it occupies', () => {
  const g = blank();
  put(g, 3, 3, T.BOULDER); put(g, 3, 4, T.BOULDER); shaft(g, 3, 5, 6);
  g.loose.push({ c: 3, r: 4, wobble: 0.01, fall: null });
  runUntil(g, NONE, (x) => x.loose.some((b) => b.fall), 2);
  assert.ok(DD.fallingAt(g, 3, 4), 'الأولى تسقط');
  assert.ok(g.loose.some((b) => b.r === 3 && !b.fall), 'الثانية استيقظت لأنها فقدت سندها');
  runUntil(g, NONE, (x) => x.loose.length === 0, 4);
  assert.equal(DD.kindAt(g, 3, 6), T.BOULDER);
  assert.equal(DD.kindAt(g, 3, 5), T.BOULDER, 'تراكمتا في النفق');
  assert.equal(DD.kindAt(g, 3, 3), T.AIR);
  const h = blank(); air(h, 2, 5); air(h, 3, 5); air(h, 3, 6); place(h, 2, 5);
  h.loose.push({ c: 3, r: 5, wobble: 0, fall: { step: 0 } });
  run(h, RIGHT, 0.02);
  assert.equal(h.miner.col, 2); assert.equal(h.miner.move, null, 'لا يدخل بلاطة فيها صخرة تسقط');
});

test('boulder: a landed boulder blocks a tunnel but can be dug (slower than rock, no loot)', () => {
  const g = blank(); air(g, 3, 0); place(g, 3, 0); put(g, 3, 1, T.BOULDER);
  const n = runUntil(g, DOWN, (x) => DD.kindAt(x, 3, 1) === T.AIR);
  assert.ok(Math.abs(n * TICK - 0.32 * 1.8) < 0.05, `${(n * TICK).toFixed(2)}ث`);
  assert.equal(g.bagCount, 0);
  assert.ok(types(DD.drainEvents(g)).includes('crush'));
});

// ───────────────────────────── الغاز ─────────────────────────────
// نفق رأسي في العمود 3 وجيب غاز في (4,10) والمعدّن في (3,10)؛ نتوقف عن الدفع لحظة انفجار الجيب
const gasScene = (equipment) => { const g = blank({ equipment }); shaft(g, 3, 0, 10); put(g, 4, 10, T.GAS); place(g, 3, 10); return g; };

test('gas: digging a pocket bursts a cloud; a miner who lingers is hurt after the grace period, one who runs is not', () => {
  let g = gasScene();
  runUntil(g, RIGHT, (x) => DD.kindAt(x, 4, 10) === T.AIR);
  assert.ok(DD.drainEvents(g).some((e) => e.type === 'gas'), 'انفجار غاز');
  assert.equal(g.clouds.length, 1);
  const hp0 = g.miner.hp;
  run(g, NONE, 0.5); assert.equal(g.miner.hp, hp0, 'السحابة تتسع ثم فترة سماح 0.35ث');
  run(g, NONE, 0.5); assert.equal(g.miner.hp, hp0 - 1, 'يتأذى بعد السماح');
  g = gasScene();
  runUntil(g, RIGHT, (x) => DD.kindAt(x, 4, 10) === T.AIR);
  const hp1 = g.miner.hp;
  run(g, UP, 0.5);                                     // يبتعد فوراً
  run(g, NONE, 3.5);
  assert.equal(g.miner.hp, hp1, 'الهروب السريع بلا ضرر');
  assert.equal(g.clouds.length, 0, 'تلاشت السحابة');
});

test('gas: damage repeats slower with armor, and the cloud radius grows then fades to nothing', () => {
  const hurtsFor = (armor) => {
    const g = blank({ equipment: { armor } }); shaft(g, 3, 0, 10); place(g, 3, 10);
    g.miner.hp = 99;
    g.clouds.push({ c: 3, r: 10, t: 0.6 });
    let hurts = 0;
    for (let i = 0; i < ticksFor(2.4); i++) { DD.tick(g, NONE); hurts += DD.drainEvents(g).filter((e) => e.type === 'hurt' && e.kind === 'gas').length; g.miner.inv = 0; }
    return hurts;
  };
  assert.ok(hurtsFor(0) > hurtsFor(5), 'الدرع يبطّئ الضرر');
  const rad = (t) => DD.cloudRadius({ t });
  assert.equal(rad(0), 0);
  assert.ok(rad(0.25) > 0 && rad(0.25) < rad(1));
  assert.equal(rad(1), DD.CFG.gasRadius);
  assert.ok(rad(DD.CFG.gasLife - 0.2) < rad(DD.CFG.gasLife - 0.6));
  assert.equal(rad(DD.CFG.gasLife), 0);
});

// ───────────────────────────── الحمم ─────────────────────────────
test('lava: standing next to it burns on a timer, moving away cools down, and armor slows the burn', () => {
  const lavaScene = (equipment) => { const g = blank({ equipment }); shaft(g, 3, 40, 44); put(g, 4, 42, T.LAVA); place(g, 3, 42); g.miner.hp = 99; return g; };
  const burns = (armor, seconds) => {
    const g = lavaScene({ armor });
    let n = 0;
    for (let i = 0; i < ticksFor(seconds); i++) { DD.tick(g, NONE); n += DD.drainEvents(g).filter((e) => e.type === 'hurt' && e.kind === 'heat').length; g.miner.inv = 0; }
    return n;
  };
  assert.equal(burns(0, 0.9), 0, 'لا ضرر قبل مرور مهلة الحرارة (~1.0ث بجوار حممة واحدة)');
  assert.equal(burns(0, 1.2), 1);
  assert.ok(burns(0, 6) >= 5);
  assert.ok(burns(5, 6) >= 1 && burns(5, 6) < burns(0, 6), 'الدرع يخفف');
  const g = lavaScene({});
  run(g, NONE, 0.9); assert.ok(g.miner.heat > 0.8);
  place(g, 3, 44); run(g, NONE, 1); assert.equal(g.miner.heat, 0, 'يبرد بعيداً عن الحمم');
  const hp = g.miner.hp; run(g, NONE, 5); assert.equal(g.miner.hp, hp);
});

// ───────────────────────────── الحبل والسطح والصندوق والإغماء ─────────────────────────────
test('rope: unavailable at the surface; elsewhere it takes time by depth, is invulnerable, and banks everything', () => {
  const g = blank(); place(g, 3, 0);
  assert.equal(DD.ascend(g), false);
  shaft(g, 3, 0, 31); place(g, 3, 30); g.bag.gold = 3; g.bagCount = 3;
  put(g, 4, 30, T.LAVA); g.miner.hp = 2;
  assert.equal(DD.ascend(g), true);
  assert.equal(DD.ascend(g), false, 'لا حبل ثانٍ');
  assert.equal(g.miner.state, 'rope');
  const dur = DD.ropeTime(30);
  assert.ok(dur > 1.5 && dur <= DD.CFG.ropeMax);
  g.clouds.push({ c: 3, r: 30, t: 1 });
  run(g, NONE, dur + 0.2);
  assert.equal(g.miner.hp, 2, 'محصّن أثناء الصعود (حمم وغاز)');
  const b = blank(); shaft(b, 3, 20, 31); place(b, 3, 30); b.miner.hp = 3;
  assert.equal(DD.ascend(b), true);
  b.loose.push({ c: 3, r: 27, wobble: 0, fall: { step: 0 } });
  run(b, NONE, 0.6);
  assert.ok(types(DD.drainEvents(b)).includes('boulder_hit'), 'الصخرة بلغت موضعه');
  assert.equal(b.miner.hp, 3, 'لكنها لا تؤذي من يُسحب بالحبل');
  assert.equal(g.status, 'done');
  assert.equal(g.result.reason, 'rope');
  assert.equal(g.result.kept.gold, 3); assert.equal(g.result.lostCount, 0);
  assert.equal(g.result.value, 3 * DD.ORES.gold.price);
  assert.equal(g.result.depthM, 30 * DD.METERS_PER_ROW);
  assert.ok(DD.ropeTime(60) <= DD.CFG.ropeMax && DD.ropeTime(1) >= DD.CFG.ropeBase);
});

test('rope: pressing it mid-step finalises the step first and cancels digging', () => {
  const g = blank(); shaft(g, 3, 0, 12); place(g, 3, 10);
  run(g, DOWN, 0.07);
  assert.ok(g.miner.move, 'في منتصف خطوة');
  assert.equal(DD.ascend(g), true);
  assert.equal(g.miner.move, null);
  assert.equal(g.miner.row, 11);
  const p = DD.minerPos(g);
  assert.ok(p.y >= 0.5 && p.y <= 11.6);
  const h = blank(); air(h, 3, 0); place(h, 3, 3); shaft(h, 3, 0, 3); run(h, DOWN, 0.1);
  assert.ok(h.miner.dig, 'يحفر');
  assert.equal(DD.ascend(h), true);
  assert.equal(h.miner.dig, null);
});

test('surface: walking back up to row 0 ends the run and keeps the whole bag; starting at row 0 does not', () => {
  const g = blank(); shaft(g, 3, 0, 2); place(g, 3, 2); g.bag.iron = 2; g.bagCount = 2; g.miner.maxRow = 6;
  run(g, UP, 1);
  assert.equal(g.status, 'done'); assert.equal(g.result.reason, 'surface');
  assert.equal(g.result.kept.iron, 2); assert.equal(g.result.depthM, 6 * DD.METERS_PER_ROW);
  const h = DD.create({ seed: 5 }); run(h, NONE, 1); run(h, { dx: 1, dy: 0 }, 0.5);
  assert.equal(h.status, 'running', 'البدء على السطح لا ينهي الجولة');
});

test('chest: digging it wins — legend flag, a bonus relic outside the bag cap, finish after the cheer', () => {
  const g = blank(); shaft(g, 3, 0, 60); place(g, 3, 60);
  g.bag.copper = 8; g.bagCount = 8; g.miner.maxRow = 60;
  runUntil(g, DOWN, (x) => x.miner.state === 'win', 6);
  assert.equal(g.legend, true);
  assert.equal(g.bag.relic, 1); assert.equal(g.bagCount, 8, 'خارج سعة الحقيبة');
  assert.ok(types(DD.drainEvents(g)).includes('chest'));
  const t0 = g.time;
  runUntil(g, DOWN, (x) => x.status === 'done', 4);
  assert.ok(Math.abs(g.time - t0 - DD.CFG.winTime) < 0.05);
  assert.equal(g.result.reason, 'won'); assert.equal(g.result.legend, true);
  assert.equal(g.result.value, 8 * DD.ORES.copper.price + DD.ORES.relic.price);
});

test('faint: at 0 hp the miner collapses and loses the cheaper half of the loot (keeps ceil(n/2) of the best)', () => {
  const g = blank(); shaft(g, 3, 40, 44); put(g, 4, 42, T.LAVA); place(g, 3, 42);
  g.bag = { copper: 3, iron: 0, gold: 2, crystal: 0, lava: 0, relic: 1 }; g.bagCount = 6; g.miner.hp = 1;
  runUntil(g, NONE, (x) => x.miner.state === 'faint', 4);
  assert.equal(g.miner.hp, 0);
  assert.ok(types(DD.drainEvents(g)).includes('faint'));
  assert.equal(g.status, 'running', 'ما زال يترنّح');
  run(g, NONE, DD.CFG.faintTime + 0.1);
  assert.equal(g.status, 'done'); assert.equal(g.result.reason, 'faint');
  assert.equal(g.result.keptCount, 3);
  assert.deepEqual(g.result.kept, { copper: 0, iron: 0, gold: 2, crystal: 0, lava: 0, relic: 1 });
  assert.deepEqual(g.result.lost, { copper: 3, iron: 0, gold: 0, crystal: 0, lava: 0, relic: 0 });
  assert.equal(g.result.value, 2 * 8 + 120); assert.equal(g.result.lostValue, 6);
  assert.equal(g.result.keptCount + g.result.lostCount, 6);
});

test('keepBest keeps the most valuable pieces first and never more than asked', () => {
  const bag = { copper: 4, iron: 2, gold: 1, crystal: 0, lava: 1, relic: 0 };
  assert.deepEqual(DD.keepBest(bag, 2), { copper: 0, iron: 0, gold: 1, crystal: 0, lava: 1, relic: 0 });
  assert.equal(DD.bagTotal(DD.keepBest(bag, 3)), 3);
  assert.equal(DD.bagTotal(DD.keepBest(bag, 99)), 8);
  assert.equal(DD.bagValue(DD.keepBest(bag, 0)), 0);
});

// ───────────────────────────── الحتمية والتقدّم الزمني ─────────────────────────────
test('determinism: the same seed, loadout and inputs replay to the exact same game', () => {
  const play = () => {
    const g = DD.create({ seed: 4242, equipment: { pickaxe: 2, boots: 1, armor: 1 } });
    const script = [DOWN, DOWN, DOWN, LEFT, DOWN, DOWN, RIGHT, DOWN, NONE, DOWN];
    const log = [];
    for (let i = 0; i < 2400 && g.status === 'running'; i++) {
      DD.tick(g, script[Math.floor(i / 20) % script.length]);
      if (i === 900) DD.ascend(g);
      log.push(...DD.drainEvents(g).map((e) => `${e.type}:${e.c ?? ''}:${e.r ?? ''}`));
    }
    return JSON.stringify({ tiles: [...g.tiles], ore: [...g.ore], miner: g.miner, bag: g.bag, result: g.result, log });
  };
  assert.equal(play(), play());
});

test('advance: converts real seconds to fixed ticks, clamps long frames and never speeds the simulation up', () => {
  const g = blank(); air(g, 3, 0); place(g, 3, 0);
  assert.equal(DD.advance(g, 1 / 60, NONE), 1);
  assert.equal(DD.advance(g, 0.0005, NONE), 0, 'جزء من نبضة يُجمَّع');
  assert.equal(DD.advance(g, 0.0005, NONE), 0);
  let n = DD.advance(g, 0.1, NONE);
  assert.ok(n >= 5 && n <= 7, `إطار 100ms = ${n} نبضات`);
  n = DD.advance(g, 5, NONE);                          // إطار بطيء جداً: يُقصّ على 0.1ث
  assert.ok(n >= 5 && n <= 7, `إطار 5ث يُحسب كـ 0.1ث (${n})`);
  g.acc = 1;
  assert.equal(DD.advance(g, 0.1, NONE), 8, 'سقف النبضات في الاستدعاء الواحد');
  assert.equal(g.acc, 0, 'ولا يتراكم دين زمني بعده');
  assert.equal(DD.advance(g, NaN, NONE), 0);
  assert.equal(DD.advance(g, -3, NONE), 0);
  g.status = 'done';
  assert.equal(DD.advance(g, 0.1, NONE), 0, 'لا تقدّم بعد النهاية');
});

test('summary and events: HUD numbers are consistent and events drain exactly once', () => {
  const g = blank({ equipment: { bag: 1, armor: 2 } }); air(g, 3, 0); place(g, 3, 0); put(g, 3, 1, T.ORE, DD.ORE_N.crystal);
  run(g, DOWN, 1);
  const s = DD.summary(g);
  assert.equal(s.bag.crystal, 1); assert.equal(s.bagCount, 1); assert.equal(s.bagCap, 10);
  assert.equal(s.value, 12); assert.equal(s.maxHp, 6); assert.equal(s.hp, 6);
  assert.equal(s.depthM, g.miner.row * 2);
  assert.ok(DD.drainEvents(g).length > 0);
  assert.equal(DD.drainEvents(g).length, 0);
  assert.ok(DD.layerIndex(0) === -1 && DD.layerIndex(1) === 0 && DD.layerIndex(24) === 1 && DD.layerIndex(37) === 3 && DD.layerIndex(61) === 4);
});

test('layer events fire once per newly reached layer', () => {
  const g = blank(); shaft(g, 3, 0, 30); place(g, 3, 0);
  const layers = [];
  for (let i = 0; i < ticksFor(8); i++) { DD.tick(g, DOWN); for (const e of DD.drainEvents(g)) if (e.type === 'layer') layers.push(e.index); }
  assert.deepEqual(layers, [0, 1, 2]);
});


test('robot assistant: mines adjacent ore while the miner is idle and its loot is deterministic', () => {
  const g = blank({ equipment: { robot: 2 } });
  place(g, 3, 10); put(g, 4, 10, T.ORE, DD.ORE_N.gold);
  assert.equal(g.bag.gold, 0);
  run(g, NONE, 2);
  assert.equal(DD.kindAt(g, 4, 10), T.AIR, 'the robot removes the ore tile');
  assert.equal(g.bag.gold, 1, 'the ore enters the normal limited bag');
  assert.equal(g.bagCount, 1);
  assert.ok(types(DD.drainEvents(g)).includes('robot_mined'));

  const withoutRobot = blank();
  place(withoutRobot, 3, 10); put(withoutRobot, 4, 10, T.ORE, DD.ORE_N.gold);
  run(withoutRobot, NONE, 2);
  assert.equal(DD.kindAt(withoutRobot, 4, 10), T.ORE, 'without the upgrade the ore stays untouched');
  assert.equal(withoutRobot.bag.gold, 0);
});

test('robot assistant never mines while the player is actively steering', () => {
  const g = blank({ equipment: { robot: 5 } });
  place(g, 3, 10); air(g, 4, 10); put(g, 2, 10, T.ORE, DD.ORE_N.gold);
  run(g, RIGHT, 0.5);
  assert.equal(DD.kindAt(g, 2, 10), T.ORE);
  assert.equal(g.bag.gold, 0);
});
