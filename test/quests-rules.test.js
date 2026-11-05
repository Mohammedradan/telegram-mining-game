'use strict';
// مهام المغامرة (quests.js): التعريفات والعدّادات والاستلام كدوال صافية. الاختبارات الفعلية على الخادم (مسار جولة أُعيد تشغيلها،
// العملية quest، السجل) في quests-api.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const Quests = require('../quests');
const R = require('../public/platform-rules');

const fresh = () => Quests.normalize();
const wins = (...w) => Array.from({ length: 6 }, (_, i) => w[i] || 0);

test('the quests: twelve, one-time, 2,500 gold and 800 XP in all, each tied to a counter the server really feeds', () => {
  assert.equal(Quests.QUESTS.length, 12);
  assert.equal(new Set(Quests.QUESTS.map((q) => q.id)).size, 12, 'unique ids');
  assert.deepEqual({ gold: Quests.TOTALS.gold, xp: Quests.TOTALS.xp, count: Quests.TOTALS.count }, { gold: 2_500, xp: 800, count: 12 });
  for (const q of Quests.QUESTS) {
    assert.ok(Number.isInteger(q.target) && q.target >= 1, `${q.id}: a positive whole target`);
    assert.ok(Number.isInteger(q.gold) && q.gold > 0 && Number.isInteger(q.xp) && q.xp > 0, `${q.id}: a real reward`);
    assert.ok(q.title && q.desc, `${q.id}: has words`);
    const [kind, arg] = q.counter.split(':');
    if (kind === 'ore') assert.ok(R.ORES[arg], `${q.id}: ${arg} is an ore of the rules`);
    else if (kind === 'boss') assert.ok(R.LEVELS.some((l) => l.boss && l.boss.kind === arg), `${q.id}: ${arg} is a boss of the rules`);
    else if (kind === 'wins') assert.ok(Number.isInteger(Number(arg)) && Number(arg) >= 0 && Number(arg) < R.MINES.length, `${q.id}: mine ${arg} exists`);
    else assert.ok(['rocks', 'enemies'].includes(kind), `${q.id}: known counter ${kind}`);
    assert.match(q.icon, /^(i-[a-z]+|ore:[a-z]+)$/, `${q.id}: an SVG symbol or an ore dot, never an emoji`);
    if (q.icon.startsWith('ore:')) assert.equal(q.icon.slice(4), q.counter.split(':')[1], `${q.id}: the dot is the ore it asks for`);
  }
  // the counters cover what the engine can give: every ore and both bosses have a quest, and the two win quests are real mines
  for (const ore of Quests.ORES) assert.ok(Quests.QUESTS.some((q) => q.counter === `ore:${ore}`), `a quest for ${ore}`);
  for (const boss of Quests.BOSSES) assert.ok(Quests.QUESTS.some((q) => q.counter === `boss:${boss}`), `a quest for ${boss}`);
  assert.deepEqual(Quests.ORES.slice().sort(), Object.keys(R.ORES).sort(), 'the module knows exactly the ores of the rules');
  assert.deepEqual(Quests.BOSSES.slice().sort(), R.LEVELS.filter((l) => l.boss).map((l) => l.boss.kind).sort(), 'and exactly their bosses');
  assert.ok(Object.isFrozen(Quests.QUESTS), 'definitions cannot be edited at run time');
});

test('the book as approved: every quest, its counter, its target and its reward (a change here is an economy change)', () => {
  assert.deepEqual(Quests.QUESTS.map((q) => [q.id, q.counter, q.target, q.gold, q.xp]), [
    ['first_rock', 'rocks', 1, 50, 20], ['win_stone', 'wins:0', 1, 100, 40], ['copper_40', 'ore:copper', 40, 100, 40],
    ['guards_50', 'enemies', 50, 150, 60], ['iron_30', 'ore:iron', 30, 150, 50], ['win_crystal', 'wins:3', 1, 150, 50],
    ['gold_25', 'ore:gold', 25, 200, 60], ['colossus', 'boss:colossus', 1, 300, 100], ['crystal_20', 'ore:crystal', 20, 250, 80],
    ['rocks_200', 'rocks', 200, 250, 70], ['lava_15', 'ore:lava', 15, 300, 90], ['warden', 'boss:warden', 1, 500, 140],
  ]);
});

test('claim boundary: one short of the target is refused, the target itself is paid (for every quest)', () => {
  const set = (c, q, n) => {
    const [kind, arg] = q.counter.split(':');
    if (kind === 'rocks') c.rocks = n; else if (kind === 'enemies') c.enemies = n; else if (kind === 'ore') c.ores[arg] = n; else if (kind === 'boss') c.bosses[arg] = n;
    return kind === 'wins' ? wins(...Array.from({ length: Number(arg) + 1 }, (_, i) => (i === Number(arg) ? n : 0))) : wins();
  };
  for (const q of Quests.QUESTS) {
    const short = fresh(); const w1 = set(short, q, q.target - 1);
    const r1 = Quests.claim(short, w1, q.id, 1);
    assert.deepEqual([r1.status, r1.reason], ['rejected', 'locked'], `${q.id} at ${q.target - 1}`);
    assert.deepEqual(short.claimed, {}, `${q.id}: a refused claim leaves no mark`);
    const enough = fresh(); const w2 = set(enough, q, q.target);
    assert.equal(Quests.claim(enough, w2, q.id, 1).status, 'ok', `${q.id} at ${q.target}`);
    assert.equal(Quests.view(enough, w2).items.find((i) => i.id === q.id).done, true);
    assert.equal(Quests.view(short, w1).items.find((i) => i.id === q.id).done, false, `${q.id} one short is not done`);
  }
});

test('normalize: a stored value can only be known keys and whole non-negative numbers', () => {
  assert.deepEqual(fresh(), { rocks: 0, enemies: 0, ores: { copper: 0, iron: 0, gold: 0, crystal: 0, lava: 0 }, bosses: { colossus: 0, warden: 0 }, claimed: {} });
  const dirty = Quests.normalize({ rocks: -5, enemies: '12.9', ores: { copper: 'x', iron: 7.8, gold: Infinity, hacked: 99 }, bosses: { colossus: 2, ghost: 5 }, claimed: { first_rock: 1700000000000, nope: 123, win_stone: 'soon', guards_50: -1 }, extra: 'drop me' });
  assert.deepEqual(dirty, { rocks: 0, enemies: 12, ores: { copper: 0, iron: 7, gold: 0, crystal: 0, lava: 0 }, bosses: { colossus: 2, warden: 0 }, claimed: { first_rock: 1700000000000 } });
  for (const junk of [null, undefined, 5, 'x', [], [1, 2]]) assert.deepEqual(Quests.normalize(junk), fresh(), `${JSON.stringify(junk)}`);
  assert.equal(Quests.normalize({ rocks: 9e99 }).rocks, 1_000_000_000, 'a counter cannot grow without a limit');
  const once = Quests.normalize({ rocks: 3, ores: { gold: 2 }, claimed: { first_rock: 5 } });
  assert.deepEqual(Quests.normalize(once), once, 'normalizing twice changes nothing');
});

test('addRun: counters grow by what a replayed round gave, and by nothing else', () => {
  const c = fresh();
  Quests.addRun(c, { mined: 3, defeated: 4, ores: { copper: 5, gold: 2 }, boss: null });
  Quests.addRun(c, { mined: 2, defeated: 1, ores: { copper: 1, lava: 3 }, boss: 'colossus' });
  assert.deepEqual(c, { rocks: 5, enemies: 5, ores: { copper: 6, iron: 0, gold: 2, crystal: 0, lava: 3 }, bosses: { colossus: 1, warden: 0 }, claimed: {} });
  const before = JSON.stringify(c);
  Quests.addRun(c, {});                                                   // nothing happened
  Quests.addRun(c, { mined: -9, defeated: NaN, ores: { copper: -4, iron: 'many', fake: 100 }, boss: 'dragon' }); // junk adds nothing, an unknown boss is ignored
  Quests.addRun(c, { mined: 1.9, defeated: 2.9, ores: null, boss: 'warden' });
  assert.deepEqual(c, { ...JSON.parse(before), rocks: 6, enemies: 7, bosses: { colossus: 1, warden: 1 } }, 'only the whole, non-negative parts counted');
  assert.equal(Quests.addRun(c, { mined: 1 }), c, 'it returns the object it changed');
});

test('valueOf and view: counters from the store, wins from the mines record, and nothing shows more than its target', () => {
  const c = Quests.addRun(fresh(), { mined: 300, defeated: 2, ores: { crystal: 25 }, boss: 'warden' });
  const v = Object.fromEntries(Quests.view(c, wins(2, 0, 0, 1)).items.map((i) => [i.id, i]));
  assert.deepEqual([v.rocks_200.value, v.rocks_200.done, v.first_rock.value], [200, true, 1], 'clamped to the target');
  assert.deepEqual([v.crystal_20.value, v.crystal_20.done], [20, true]);
  assert.deepEqual([v.guards_50.value, v.guards_50.done], [2, false]);
  assert.deepEqual([v.warden.done, v.colossus.done], [true, false]);
  assert.deepEqual([v.win_stone.value, v.win_stone.done, v.win_crystal.value, v.win_crystal.done], [1, true, 1, true], 'a win in mine 1 and mine 4 comes from the mines record');
  assert.deepEqual([Quests.view(c, wins(0, 9, 9, 0)).items.find((i) => i.id === 'win_crystal').done, Quests.view(c, undefined).items.find((i) => i.id === 'win_stone').done], [false, false], 'wins elsewhere do not count; a missing record is zero');
  assert.deepEqual(Quests.view(fresh(), wins()), { items: Quests.view(fresh(), wins()).items, claimedCount: 0, total: 12, totalGold: 2_500, totalXp: 800 });
  assert.ok(Quests.view(fresh(), wins()).items.every((i) => i.value === 0 && !i.done && !i.claimed));
  const claimed = Quests.normalize({ claimed: { first_rock: 9 } });
  const withClaim = Quests.view(claimed, wins());
  assert.equal(withClaim.claimedCount, 1); assert.equal(withClaim.items.find((i) => i.id === 'first_rock').claimed, true);
});

test('claim: only a finished quest, only once, only a known one; the reward is what the table says', () => {
  const c = Quests.addRun(fresh(), { mined: 1 });
  assert.deepEqual(Quests.claim(c, wins(), 'nope', 5), { status: 'invalid' });
  assert.deepEqual(Quests.claim(c, wins(), 'rocks_200', 5), { status: 'rejected', reason: 'locked', value: 1, target: 200 });
  assert.deepEqual(c.claimed, {}, 'a refused claim leaves no mark');
  assert.deepEqual(Quests.claim(c, wins(), 'first_rock', 1234), { status: 'ok', id: 'first_rock', gold: 50, xp: 20 });
  assert.equal(c.claimed.first_rock, 1234);
  assert.deepEqual(Quests.claim(c, wins(), 'first_rock', 9999), { status: 'rejected', reason: 'claimed' });
  assert.equal(c.claimed.first_rock, 1234, 'the first claim time stays');
  // a win quest is claimable from the mines record alone
  assert.equal(Quests.claim(c, wins(1), 'win_stone', 7).status, 'ok');
  // claiming everything pays exactly the totals
  const all = Quests.normalize({ rocks: 1e6, enemies: 1e6, ores: { copper: 1e6, iron: 1e6, gold: 1e6, crystal: 1e6, lava: 1e6 }, bosses: { colossus: 1, warden: 1 } });
  let gold = 0, xp = 0;
  for (const q of Quests.QUESTS) { const r = Quests.claim(all, wins(1, 1, 1, 1, 1, 1), q.id, 1); assert.equal(r.status, 'ok', q.id); gold += r.gold; xp += r.xp; }
  assert.deepEqual([gold, xp], [2_500, 800], 'the whole book is worth 2,500 gold and 800 XP');
  assert.equal(Quests.view(all, wins(1, 1, 1, 1, 1, 1)).claimedCount, 12);
  for (const q of Quests.QUESTS) assert.equal(Quests.claim(all, wins(1, 1, 1, 1, 1, 1), q.id, 2).reason, 'claimed', `${q.id} cannot be claimed twice`);
});
