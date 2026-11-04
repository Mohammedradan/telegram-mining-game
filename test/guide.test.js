'use strict';
// المرشد «العم سراج» (public/guide.js): الحكاية والهدف التالي والموسوعة. عرض فقط، فالاختبارات تثبت أيضاً أنه لا يكتب إلا مفتاح القراءة.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const G = require('../public/guide.js');
const R = require('../public/platform-rules.js');
const html = read('public', 'index.html');
const EMOJI = /\p{Extended_Pictographic}/u;

const ALL = R.EQUIPMENT_ORDER;
const st = (o = {}) => ({ gold: 0, ores: {}, equipment: {}, mines: { wins: [0, 0, 0, 0, 0, 0] }, ...o });
const wins = (...w) => ({ wins: [...w, ...Array(6 - w.length).fill(0)] });
const maxed = () => Object.fromEntries(ALL.map((id) => [id, R.MAX_EQUIP_LEVEL]));

// ============================== الحكاية ==============================
test('story: one chapter per mine in order, then an epilogue; every chapter has a title, a body and a tip', () => {
  const ch = G.CHAPTERS;
  assert.deepEqual(ch.map((c) => c.id), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ch.slice(0, 6).map((c) => c.zone), R.MINES.map((_, i) => i), 'the six chapters walk the six mines in order');
  assert.equal(ch[6].epilogue, true);
  assert.equal(ch.filter((c) => c.epilogue).length, 1);
  assert.equal(new Set(ch.map((c) => c.title)).size, ch.length, 'titles are unique');
  for (const c of ch) {
    assert.ok(c.title.length >= 4 && c.title.length <= 24, `${c.id}: short title`);
    assert.ok(c.body.length >= 1 && c.body.length <= 3 && c.body.every((p) => p.length > 30 && p.length < 400), `${c.id}: one to three short paragraphs`);
    assert.ok(c.tip.length > 40 && c.tip.length < 260, `${c.id}: a real tip`);
    assert.doesNotMatch(JSON.stringify(c), EMOJI, `${c.id}: no emoji (the icons are SVG)`);
  }
});

test('story: the advice matches what the engine really does in that mine (so the story teaches instead of drifting)', () => {
  const kinds = (z) => R.levelFor(z).hazards.map((h) => h.kind);
  assert.ok(kinds(0).includes('vent') && /بخار/.test(G.CHAPTERS[0].tip), 'mine 1: steam vents on a cycle');
  assert.ok(kinds(1).includes('crusher') && /المكبس/.test(G.CHAPTERS[1].tip), 'mine 2: a crusher');
  const crystals = R.levelFor(3).hazards.filter((h) => h.kind === 'crystal');
  assert.ok(crystals.length >= 2 && new Set(crystals.map((h) => (h.phase || 0))).size >= 2 && /إيقاعين/.test(G.CHAPTERS[3].tip), 'mine 4: two crystal rhythms');
  const geysers = R.levelFor(4).hazards.filter((h) => h.kind === 'geyser');
  assert.ok(geysers.length >= 1 && /نوافير/.test(G.CHAPTERS[4].tip), 'mine 5: lava geysers');
  assert.equal(R.levelFor(2).boss.kind, 'colossus'); assert.equal(G.CHAPTERS[2].title, R.levelFor(2).boss.name, 'chapter 3 is the Colossus');
  assert.equal(R.levelFor(5).boss.kind, 'warden'); assert.equal(G.CHAPTERS[5].title, R.levelFor(5).boss.name, 'chapter 6 is the Warden');
  assert.ok(R.levelFor(1).hazards.find((h) => h.kind === 'crusher').h >= 100, 'the crusher really is tall (standing under it is the mistake the tip warns about)');
  for (const z of [2, 5]) assert.ok(R.levelFor(z).boss, `the boss chapters sit on boss mines (${z})`);
});

test('story: a chapter opens with its mine; the epilogue only after the last guardian has fallen', () => {
  const snap = (s) => G.snapOf(s);
  assert.deepEqual(G.unlockedChapters(snap(st())), [0], 'a new player has only the first chapter');
  assert.deepEqual(G.unlockedChapters(snap(st({ mines: wins(1) }))), [0, 1], 'winning the first mine opens the second');
  assert.deepEqual(G.unlockedChapters(snap(st({ mines: wins(1, 1) }))), [0, 1], 'mine 3 also needs the pickaxe');
  assert.deepEqual(G.unlockedChapters(snap(st({ mines: wins(1, 1), equipment: { pickaxe: 1 } }))), [0, 1, 2]);
  const deep = st({ mines: wins(1, 1, 1, 1, 1), equipment: { pickaxe: 4, armor: 3 } });
  assert.deepEqual(G.unlockedChapters(snap(deep)), [0, 1, 2, 3, 4, 5], 'everything is open but the guardian still stands: no epilogue');
  assert.equal(G.chapterUnlocked(snap({ ...deep, mines: wins(1, 1, 1, 1, 1, 1) }), 6), true);
  assert.equal(G.chapterUnlocked(snap(st()), 99), false); assert.equal(G.chapterUnlocked(snap(st()), -1), false);
  assert.equal(G.chapterGate(snap(st()), 1), 'الفوز في المنجم الحجري');
  assert.equal(G.chapterGate(snap(st({ mines: wins(1, 1) })), 2), 'قوة المعول مستوى 1');
  assert.equal(G.chapterGate(snap(deep), 6), 'اهزم حارس القلب في قلب الأسطورة');
  assert.equal(G.chapterGate(snap(st()), 0), '', 'an open chapter has no gate');
});

test('story: read-tracking — a new player starts with everything unread, an existing player is not buried in "new" chapters', () => {
  const fresh = G.snapOf(st());
  assert.deepEqual(G.initialStore(fresh), { v: 1, seen: [], opened: false });
  const veteran = G.snapOf(st({ mines: wins(1, 1, 1), equipment: { pickaxe: 2, armor: 1 }, gold: 5 }));
  assert.deepEqual(G.initialStore(veteran), { v: 1, seen: [0, 1, 2, 3], opened: false }, 'the chapters they already earned count as read; the dot still announces the feature once');
  assert.deepEqual(G.initialStore(G.snapOf(st({ ores: { copper: 1 } }))).seen, [0], 'any progress at all (even one ore) means "existing"');
  assert.deepEqual(G.initialStore(G.snapOf(st({ equipment: { boots: 1 } }))).seen, [0], 'so does owning gear after spending every ore and never winning');
  const s0 = { v: 1, seen: [0], opened: true };
  const s1 = G.withSeen(s0, 2);
  assert.deepEqual(s1.seen, [0, 2]); assert.deepEqual(s0.seen, [0], 'the old object is not mutated');
  assert.equal(G.withSeen(s1, 2), s1, 'reading the same chapter twice changes nothing');
  for (const bad of [-1, 7, 1.5, NaN, null, undefined, '2']) assert.equal(G.withSeen(s0, bad), s0, `junk chapter id ${bad} is ignored`);
  assert.deepEqual(G.unreadChapters(G.snapOf(st({ mines: wins(1) })), { seen: [1] }), [0]);
  assert.equal(G.needsAttention(fresh, { v: 1, seen: [], opened: false }), true);
  assert.equal(G.needsAttention(fresh, { v: 1, seen: [0], opened: false }), true, 'never opened: the dot stays');
  assert.equal(G.needsAttention(fresh, { v: 1, seen: [0], opened: true }), false);
  assert.equal(G.needsAttention(fresh, null), false, 'not started yet: no dot');
  assert.equal(G.needsAttention(G.snapOf(st({ mines: wins(1) })), { v: 1, seen: [0], opened: true }), true, 'a newly opened mine brings the dot back');
});

test('story: the saved record survives garbage and a throwing storage', () => {
  const mk = (raw) => ({ getItem: () => raw });
  assert.equal(G.loadStore(mk(null)), null);
  assert.equal(G.loadStore(mk('{not json')), null);
  assert.equal(G.loadStore(mk(JSON.stringify({ v: 2, seen: [0] }))), null, 'another version is not trusted');
  assert.deepEqual(G.loadStore(mk(JSON.stringify({ v: 1, seen: [3, 1, 1, 'x', 99, -2, 2.5, 0], opened: 'yes' }))), { v: 1, seen: [0, 1, 3], opened: false }, 'ids are validated, sorted and deduplicated; "opened" must be exactly true');
  assert.deepEqual(G.loadStore(mk(JSON.stringify({ v: 1, seen: 'oops', opened: true }))), { v: 1, seen: [], opened: true });
  assert.equal(G.loadStore({ getItem() { throw new Error('denied'); } }), null);
  assert.equal(G.saveStore({ setItem() { throw new Error('quota'); } }, { v: 1, seen: [], opened: false }), false);
  const kept = {}; G.saveStore({ setItem: (k, v) => { kept[k] = v; } }, { v: 1, seen: [0, 1], opened: true, junk: 1 });
  assert.deepEqual(Object.keys(kept), ['mining-guide']); assert.deepEqual(JSON.parse(kept['mining-guide']), { v: 1, seen: [0, 1], opened: true });
});

// ============================== الهدف التالي ==============================
test('goal: a new player is told to cross the first mine', () => {
  const g = G.nextGoal(st());
  assert.equal(g.id, 'win:0'); assert.equal(g.kind, 'win'); assert.equal(g.zone, 0);
  assert.deepEqual(g.action, { kind: 'play', zone: 0, label: 'ابدأ من المنجم الحجري' });
  assert.match(g.text, /3 بلّورات/); assert.match(g.text, /صخرة/); assert.match(g.text, /بوابة/);
  assert.deepEqual(g.steps, [{ ok: false, label: 'الفوز في المنجم الحجري' }]);
});

test('goal: the first locked mine decides — a missing win comes before missing gear', () => {
  const g = G.nextGoal(st({ mines: wins(1) }));
  assert.equal(g.id, 'win:1'); assert.equal(g.zone, 1); assert.equal(g.target, 2);
  assert.deepEqual(g.steps.map((s) => [s.ok, s.label]), [[false, 'الفوز في مناجم الحديد'], [false, 'قوة المعول مستوى 1']], 'both needs are listed, in the order the map lists them');
  assert.equal(g.action.kind, 'play'); assert.equal(g.action.zone, 1);
  const both = G.nextGoal(st({ mines: wins(1, 1), equipment: { pickaxe: 1 } }));
  assert.equal(both.id, 'win:2', 'mine 4 needs a win in mine 3 AND pickaxe 2 AND armor 1: the win is asked for first');
  assert.deepEqual(both.steps.map((s) => [s.ok, s.label]), [[false, 'الفوز في الكهوف الذهبية'], [false, 'قوة المعول مستوى 2'], [false, 'معدات الحماية مستوى 1']]);
  assert.match(both.text, /عملاق الذهب/, 'it warns that a guardian keeps that gate shut');
  assert.match(both.text, /لن تُفتح البوابة قبل أن يسقط/);
  const gearOnly = G.nextGoal(st({ mines: wins(1, 1, 1), equipment: { pickaxe: 2 } }));
  assert.equal(gearOnly.id, 'gear:armor:1', 'once the win is in, the missing gear is the goal');
  assert.deepEqual(gearOnly.steps.map((s) => s.ok), [true, true, false]);
  assert.equal(gearOnly.steps[2].detail, 'معدات الحماية: 0/1', 'the step shows the progress of the item');
});

test('goal: a gear goal says what the next upgrade costs, what is missing and where to dig it', () => {
  const poor = G.nextGoal(st({ mines: wins(1, 1), gold: 10, ores: { copper: 2 } }));
  assert.equal(poor.id, 'gear:pickaxe:1'); assert.equal(poor.item, 'pickaxe'); assert.equal(poor.kind, 'gear');
  assert.match(poor.text, /50 ذهب و6 نحاس/, 'the real price from the shared rules');
  assert.match(poor.text, /تنقصك 4 نحاس/); assert.match(poor.text, /المنجم الحجري/); assert.match(poor.text, /72%/, 'the stone mine is where copper is most common');
  assert.match(poor.text, /تنقصك 40 ذهب/);
  assert.deepEqual(poor.action, { kind: 'play', zone: 0, label: 'العب في المنجم الحجري' });
  assert.deepEqual(poor.shortage.oresMissing, [{ ore: 'copper', need: 6, have: 2 }]); assert.equal(poor.shortage.goldMissing, 40); assert.equal(poor.shortage.affordable, false);
  const goldOnly = G.nextGoal(st({ mines: wins(1, 1), gold: 10, ores: { copper: 9 } }));
  assert.equal(goldOnly.action.kind, 'play'); assert.equal(goldOnly.action.zone, 1, 'only gold is missing: play the deepest open mine');
  assert.doesNotMatch(goldOnly.text, /تنقصك \d+ نحاس/);
  const orePoorGoldRich = G.nextGoal(st({ mines: wins(1, 1), gold: 500, ores: {} }));
  assert.match(orePoorGoldRich.text, /تنقصك 6 نحاس/); assert.doesNotMatch(orePoorGoldRich.text, /ذهب \(/);
  assert.equal(orePoorGoldRich.action.kind, 'play', 'gold alone does not make an upgrade affordable'); assert.equal(orePoorGoldRich.shortage.affordable, false);
  assert.equal(orePoorGoldRich.action.zone, 0);
  const ready = G.nextGoal(st({ mines: wins(1, 1), gold: 50, ores: { copper: 6 } }));
  assert.deepEqual(ready.action, { kind: 'workshop', label: 'افتح الورشة وابدأ الترقية' });
  assert.equal(ready.shortage.affordable, true);
  assert.equal(R.equipCost('pickaxe', 0).gold, 50, 'sanity: the numbers above are the rules, not copies in the guide');
  const several = G.nextGoal(st({ mines: wins(1, 1, 1), equipment: { pickaxe: 1, armor: 0 } }));
  assert.equal(several.id, 'gear:pickaxe:2', 'two things are missing for mine 4: the first one the map lists comes first');
  assert.deepEqual(several.steps.map((s) => s.ok), [true, false, false]);
});

test('goal: the best mine for an ore is the open mine where it is most common', () => {
  const none = G.snapOf(st());
  assert.deepEqual(G.bestMineFor('copper', none), { zone: 0, name: 'المنجم الحجري', share: 72 });
  assert.deepEqual(G.bestMineFor('iron', G.snapOf(st({ mines: wins(1) }))), { zone: 1, name: 'مناجم الحديد', share: 50 }, 'iron: 50% in mine 2 beats 24% in mine 1 once mine 2 is open');
  assert.equal(G.bestMineFor('crystal', G.snapOf(st({ mines: wins(1) }))), null, 'no open mine yields crystal yet');
  assert.equal(G.bestMineFor('lava', G.snapOf(st({ mines: wins(1, 1, 1, 1, 1), equipment: { pickaxe: 4, armor: 3 } }))).zone, 5, 'lava is 85% of mine 6 (two slots)');
  for (let z = 0; z < R.MINES.length; z++) assert.equal(Object.values(G.oreShares(R.MINES[z])).reduce((a, b) => a + b, 0), 100, `mine ${z}: the shares are percentages that add up to 100`);
  assert.deepEqual(G.oreShares(R.MINES[4]), { crystal: 35, lava: 65 }, 'two slots of the same ore are added together');
});

test('goal: with every mine open the guardian comes next, then the weakest gear, then the legend', () => {
  const open = { mines: wins(1, 1, 1, 1, 1), equipment: { pickaxe: 4, armor: 3 } };
  const boss = G.nextGoal(st(open));
  assert.equal(boss.id, 'boss'); assert.equal(boss.zone, 5); assert.match(boss.title, /حارس القلب/); assert.equal(boss.action.zone, 5);
  const after = G.nextGoal(st({ mines: wins(1, 1, 1, 1, 1, 1), equipment: { pickaxe: 4, armor: 3 }, gold: 9999, ores: { copper: 99, iron: 99, gold: 99, crystal: 99, lava: 99 } }));
  assert.equal(after.kind, 'gear'); assert.match(after.id, /^upgrade:/); assert.equal(after.action.kind, 'workshop', 'rich enough: go and buy');
  assert.equal(after.item, 'boots', 'the lowest level wins, the shared order breaks the tie (pickaxe and armor are higher)');
  assert.equal(after.steps.length, 8);
  const done = G.nextGoal(st({ mines: wins(1, 1, 1, 1, 1, 1), equipment: maxed() }));
  assert.equal(done.id, 'legend'); assert.equal(done.kind, 'done'); assert.deepEqual(done.steps, []);
});

test('goal: following the guide always reaches the end — it never loops or points somewhere the player cannot go', () => {
  // an ideal player does exactly what the guide says; when a purchase is not affordable they dig the missing ore / earn the gold first
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const consistent = () => {
    const s = st({ equipment: Object.fromEntries(ALL.map((id) => [id, Math.floor(rnd() * 3.4)])), gold: Math.floor(rnd() * 600), ores: Object.fromEntries(R.ORE_LADDER.map((k) => [k, Math.floor(rnd() * 14)])) });
    for (let i = 0; i < 6; i++) { if (!R.mineUnlocked(i, { wins: s.mines.wins }, s.equipment) || rnd() < 0.3) break; s.mines.wins[i] = 1; }
    return s;
  };
  const longest = { n: 0 };
  for (let run = 0; run < 250; run++) {
    const s = run === 0 ? st() : consistent();
    const seen = new Set();
    let finished = false;
    for (let step = 0; step < 150 && !finished; step++) {
      const snap = G.snapOf(s), g = G.nextGoal(snap);
      assert.ok(typeof g.id === 'string' && g.title && g.text && Array.isArray(g.steps), `run ${run}: a complete goal`);
      if (g.id === 'legend') { finished = true; longest.n = Math.max(longest.n, step); break; }
      const key = JSON.stringify([s.mines.wins, s.equipment, s.ores, s.gold, g.id]);
      assert.ok(!seen.has(key), `run ${run} step ${step}: the guide repeated itself without progress (${g.id})`);
      seen.add(key);
      if (g.action && g.action.kind === 'play') assert.equal(R.mineUnlocked(g.action.zone, { wins: s.mines.wins }, s.equipment), true, `${g.id}: the mine it sends you to is open`);
      if (g.kind === 'win') {
        assert.equal(R.mineUnlocked(g.zone, { wins: s.mines.wins }, s.equipment), true, `${g.id}: the mine to win in is open`);
        s.mines.wins[g.zone] += 1;
      } else if (g.kind === 'gear') {
        assert.ok(snap.equipment[g.item] < R.MAX_EQUIP_LEVEL, `${g.id}: not already maxed`);
        if (g.action.kind === 'workshop') {
          assert.equal(g.shortage.affordable, true, `${g.id}: the workshop is only suggested when the upgrade can be paid`);
          assert.ok(s.gold >= g.cost.gold && Object.entries(g.cost.ores).every(([k, n]) => (s.ores[k] || 0) >= n), `${g.id}: the purse really covers the price (independent of the guide's own flag)`);
          s.gold -= g.cost.gold; for (const [k, n] of Object.entries(g.cost.ores)) s.ores[k] = (s.ores[k] || 0) - n;
          s.equipment[g.item] = (s.equipment[g.item] || 0) + 1;
        } else {
          assert.equal(g.action.kind, 'play'); assert.ok(g.shortage.affordable === false, `${g.id}: a play goal means something is missing`);
          for (const m of g.shortage.oresMissing) s.ores[m.ore] = (s.ores[m.ore] || 0) + (m.need - m.have);
          s.gold += g.shortage.goldMissing;
        }
      } else assert.fail(`unexpected goal kind ${g.kind}`);
    }
    assert.ok(finished, `run ${run}: reached "legend" within 150 steps`);
  }
  assert.ok(longest.n > 20, `the longest path is a real journey (${longest.n} steps), not a trivial one`);
});

test('goal: garbage in never throws and is normalised (negative, huge, NaN, wrong types)', () => {
  const junk = [null, undefined, 0, 'x', [], {}, { mines: 'x', equipment: [], ores: 5, gold: 'many' }, { mines: { wins: [-5, 1e12, NaN, 'a', null, undefined, 9, 9] }, equipment: { pickaxe: 99, armor: -3, luck: 'x' }, ores: { copper: -9, iron: NaN, lava: 1e9 }, gold: -50 }];
  for (const j of junk) {
    const snap = G.snapOf(j);
    assert.equal(snap.wins.length, 6); assert.ok(snap.wins.every((w) => Number.isInteger(w) && w >= 0));
    assert.deepEqual(Object.keys(snap.equipment), ALL); assert.ok(Object.values(snap.equipment).every((l) => l >= 0 && l <= R.MAX_EQUIP_LEVEL));
    assert.ok(Object.values(snap.ores).every((n) => Number.isInteger(n) && n >= 0)); assert.ok(snap.gold >= 0);
    assert.doesNotThrow(() => { G.nextGoal(j); G.codex(j); G.renderGoal(snap, 0); G.renderCodex(snap, 'mines'); G.renderStory(snap, null); });
  }
  assert.equal(G.nextGoal(null).id, 'win:0');
});

// ============================== الموسوعة ==============================
test('codex: ores are revealed by the mines you opened (or by owning them); the rest stay a mystery with a hint', () => {
  const c = G.codex(st());
  assert.deepEqual(c.ores.map((o) => o.id), R.ORE_LADDER);
  assert.deepEqual(c.ores.map((o) => o.known), [true, true, true, false, false], 'the first mine drops copper, iron and (rarely) gold');
  assert.equal(c.ores[3].firstZone, 2); assert.equal(c.ores[4].firstZone, 3, 'the hint names the first mine that drops it');
  assert.deepEqual(c.ores.map((o) => o.price), R.ORE_LADDER.map((k) => R.ORES[k].price), 'sell prices are the rules');
  assert.equal(G.codex(st({ ores: { lava: 1 } })).ores[4].known, true, 'owning one is enough');
  assert.equal(G.codex(st({ mines: wins(1, 1), equipment: { pickaxe: 1 } })).ores[3].known, true, 'opening the golden caves reveals crystal');
  assert.deepEqual(c.ores[0].foundIn.map((f) => [f.zone, f.share, f.unlocked]), [[0, 72, true], [1, 35, false]], 'sorted by how common it is; unopened mines are marked');
});

test('codex: mines — locked ones show what they need and hide their danger and boss; open ones show both', () => {
  const c = G.codex(st({ mines: wins(1) }));
  assert.equal(c.mines.length, 6); assert.deepEqual(c.mines.map((m) => m.hasBoss), [false, false, true, false, false, true]);
  assert.equal(c.mines[0].unlocked, true); assert.equal(c.mines[0].danger, G.DANGER.stone); assert.equal(c.mines[0].boss, null);
  assert.equal(c.mines[1].unlocked, true); assert.equal(c.mines[1].danger, G.DANGER.iron);
  assert.equal(c.mines[2].unlocked, false); assert.equal(c.mines[2].danger, '', 'a locked world keeps its danger secret'); assert.equal(c.mines[2].boss, null);
  assert.deepEqual(c.mines[2].needs.map((n) => [n.ok, n.label]), [[false, 'الفوز في مناجم الحديد'], [false, 'قوة المعول مستوى 1']]);
  const open = G.codex(st({ mines: wins(1, 1, 1, 1, 1), equipment: { pickaxe: 4, armor: 3 } }));
  assert.equal(open.mines[2].boss, 'عملاق الذهب'); assert.equal(open.mines[5].boss, 'حارس القلب');
  assert.deepEqual(open.mines.map((m) => m.unlocked), [true, true, true, true, true, true]);
  for (const m of open.mines) assert.equal(m.ores.reduce((a, o) => a + o.share, 0), 100);
  assert.equal(open.mines[0].wins, 1);
});

test('codex: gear — all eight items in workshop order, with the real effect now and the real next price', () => {
  const c = G.codex(st({ equipment: { pickaxe: 2, robot: 5 } }));
  assert.deepEqual(c.gear.map((g) => g.id), ALL);
  const pick = c.gear[0];
  assert.deepEqual([pick.level, pick.max], [2, 5]); assert.equal(pick.now, R.effectText('pickaxe', 2)); assert.equal(pick.nextEffect, R.effectText('pickaxe', 3));
  assert.deepEqual(pick.next, R.equipCost('pickaxe', 2)); assert.equal(pick.nextText, G.costText(R.equipCost('pickaxe', 2)));
  const robot = c.gear.find((g) => g.id === 'robot');
  assert.equal(robot.next, null); assert.equal(robot.nextText, ''); assert.equal(robot.level, 5);
  assert.equal(G.costText({ gold: 1234, ores: { iron: 8, gold: 2 } }), '1,234 ذهب و8 حديد و2 ذهب خام');
});

test('codex: the danger lines are the same words the mines map uses', () => {
  const m = /const WORLD_DANGER = (\{[^}]*\});/.exec(html);
  assert.ok(m, 'the map still defines WORLD_DANGER');
  assert.deepEqual({ ...vm.runInNewContext(`(${m[1]})`) }, { ...G.DANGER }, 'one wording in both places');
  assert.deepEqual(Object.keys(G.DANGER), R.MINES.map((x) => x.id), 'every mine has a danger line');
});

// ============================== الرسم ==============================
test('render: the goal, codex and story screens are plain escaped markup with the hooks the UI needs', () => {
  const snap = G.snapOf(st({ mines: wins(1), gold: 10 }));
  const goal = G.renderGoal(snap, 0);
  assert.match(goal, /class="gd-figure" src="\/assets\/cave\/guide\/siraj\.webp\?v=1" alt="" width="428" height="520"/, 'the portrait keeps its size (no layout jump) and is decorative');
  assert.match(goal, /data-guide-action="play" data-zone="1"/);
  assert.match(goal, /<li class="no"><svg class="ui-icon" aria-hidden="true"><use href="#i-close"\/><\/svg><span>الفوز في مناجم الحديد<\/span>/);
  assert.match(goal, /نصيحة لـ «المنجم الحجري»/, 'the tip belongs to the mine currently selected');
  assert.doesNotMatch(G.renderGoal(snap, 3), /gd-tipbox/, 'a locked mine gives no tip (that would spoil it)');
  const codex = (sec) => G.renderCodex(snap, sec);
  assert.equal((codex('ores').match(/class="gd-entry/g) || []).length, 5); assert.equal((codex('mines').match(/class="gd-entry/g) || []).length, 6); assert.equal((codex('gear').match(/class="gd-entry/g) || []).length, 8);
  assert.equal((codex('ores').match(/gd-unknown/g) || []).length, 2, 'crystal and lava are still a mystery');
  assert.match(codex('ores'), /خام لم تكتشفه بعد — تجده في «الكهوف الذهبية»/);
  assert.match(codex('nonsense'), /data-ore="copper"/, 'an unknown section falls back to the ores');
  for (const sec of ['ores', 'mines', 'gear']) assert.match(codex(sec), new RegExp(`class="gd-seg active" aria-selected="true" data-guide-section="${sec}"`));
  const story = G.renderStory(snap, { v: 1, seen: [], opened: false });
  assert.equal((story.match(/data-guide-read="/g) || []).length, 2, 'two chapters can be opened');
  assert.equal((story.match(/class="gd-chapter-row locked"/g) || []).length, 5, 'the rest are closed rows, not buttons (nothing to press)');
  assert.equal((story.match(/<i class="gd-new">جديد<\/i>/g) || []).length, 2);
  assert.match(G.renderStory(snap, { v: 1, seen: [0, 1], opened: true }), /^(?:(?!gd-new)[\s\S])*$/, 'read chapters lose the badge');
  for (const out of [goal, codex('ores'), codex('mines'), codex('gear'), story]) assert.doesNotMatch(out, EMOJI);
});

test('render: every name that reaches the markup is escaped (a hostile mine name stays text)', () => {
  const evil = '<img src=x onerror=alert(1)>"&\'';
  const hostile = { ...R, MINES: R.MINES.map((m, i) => (i === 0 ? { ...m, name: evil } : m)) };
  const sandbox = { PlatformRules: hostile, console: { error() {} } };
  vm.runInNewContext(read('public', 'guide.js'), sandbox);
  const H = sandbox.Guide, snap = H.snapOf(st());
  const escaped = '&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;';
  for (const [what, out] of [['goal', H.renderGoal(snap, 0)], ['mines', H.renderCodex(snap, 'mines')], ['story', H.renderStory(snap, null)], ['chapter', H.renderChapter(snap, 0)]]) {
    assert.ok(out.includes(escaped), `${what}: the name is shown as text`);
    assert.ok(!out.includes('<img src=x'), `${what}: no live tag from the data`);
    assert.doesNotMatch(out.replace(/<img class="gd-(?:figure|mini)"[^>]*>/g, ''), /<img/, `${what}: the only images are the portraits`);
  }
});

test('render: a chapter can only be read once its mine is open, and it links to the next open one', () => {
  const snap = G.snapOf(st({ mines: wins(1) }));
  assert.equal(G.renderChapter(snap, 2), '', 'a locked chapter renders nothing even if someone asks for it');
  assert.equal(G.renderChapter(snap, 6), ''); assert.equal(G.renderChapter(snap, 42), '');
  const one = G.renderChapter(snap, 0);
  assert.match(one, /data-chapter="0"/); assert.match(one, /المصباح الأول/); assert.match(one, /المنجم الحجري · الفصل 1 من 7/);
  assert.match(one, /data-guide-read="1"[^>]*>الفصل التالي: المكبس القديم/, 'the next open chapter is one tap away');
  assert.match(one, /data-guide-back/);
  assert.doesNotMatch(G.renderChapter(snap, 1), /الفصل التالي/, 'the last open chapter has no "next"');
  assert.match(G.renderChapter(G.snapOf(st({ mines: wins(1, 1, 1, 1, 1, 1), equipment: maxed() })), 6), /الخاتمة · الفصل 7 من 7/);
});

// ============================== الواجهة (DOM وهمي) ==============================
function boot({ state, withDom = true, throwingState = false } = {}) {
  const writes = [], calls = { pause: 0, workshop: 0, zones: [] };
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { writes.push(k); store.set(k, String(v)); } };
  const ctx = { state, activeElement: null };
  const mkEl = (id, extra = {}) => {
    const e = {
      id, hidden: false, dataset: {}, innerHTML: '', textContent: '', scrollTop: 0, attrs: {}, listeners: {}, classes: new Set(),
      classList: { toggle(c, on) { if (on) e.classes.add(c); else e.classes.delete(c); } },
      setAttribute(k, v) { e.attrs[k] = v; }, addEventListener(t, f) { (e.listeners[t] = e.listeners[t] || []).push(f); },
      focus() { ctx.activeElement = e; }, scrollTo() { e.scrollTop = 0; }, querySelector: () => null,
      fire(t, ev = {}) { for (const f of e.listeners[t] || []) f({ target: e, ...ev }); },
      ...extra,
    };
    return e;
  };
  const dot = mkEl('dot'), label = mkEl('label', { textContent: 'المرشد' });
  const opener = mkEl('open-guide', { hidden: true, querySelector: (s) => (s === '.guide-dot' ? dot : s === '[data-guide-label]' ? label : null) });
  opener.dataset.guideOpen = ''; opener.dataset.news = '0';
  const tabs = ['goal', 'codex', 'story'].map((t) => { const b = mkEl(`tab-${t}`); b.dataset.guideTab = t; return b; });
  const overlay = mkEl('guide-overlay', { hidden: true }), body = mkEl('guide-body'), close = mkEl('guide-close');
  const els = { 'guide-overlay': overlay, 'guide-body': body, 'guide-close': close, 'open-guide': opener };
  const docListeners = {};
  const document = {
    getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => (sel === '[data-guide-tab]' ? tabs : sel === '[data-guide-open]' ? [opener] : []),
    addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); },
    get activeElement() { return ctx.activeElement; }, contains: () => true,
  };
  const sandbox = { PlatformRules: R, localStorage, console: { error() {} }, document: withDom ? document : { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} } };
  vm.runInNewContext(read('public', 'guide.js'), sandbox);
  const g = sandbox.Guide;
  const ok = g.init({
    getState: () => { if (throwingState) throw new Error('boom'); return ctx.state; }, getZone: () => ctx.zone ?? 0,
    pause: () => { calls.pause++; }, openWorkshop: () => { calls.workshop++; }, setZone: (z) => { calls.zones.push(z); },
  });
  // a tap inside the window: a stand-in target that answers closest('[data-x]') like the browser does
  const tap = (attr, value = '', extra = {}) => {
    const key = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const hit = { dataset: { [key]: value, ...extra }, closest: (sel) => (sel === `[${attr}]` ? hit : null) };
    for (const f of body.listeners.click || []) f({ target: hit });
  };
  const key = (k) => { for (const f of docListeners.keydown || []) f({ key: k }); };
  // objects made inside the vm have another realm's prototypes, which deepStrictEqual (rightly) refuses: compare plain JSON copies
  const inspect = () => JSON.parse(JSON.stringify(g.inspect()));
  return { g, ok, ctx, els: { opener, dot, label, tabs, overlay, body, close }, calls, writes, store, tap, key, sandbox, inspect };
}

test('ui: without its markup the guide switches itself off and every call stays safe', () => {
  const b = boot({ state: st(), withDom: false });
  assert.equal(b.ok, false);
  assert.equal(b.g.start(), false); assert.equal(b.g.open('goal'), false); assert.equal(b.g.refresh(), undefined); assert.equal(b.g.close(), undefined);
  assert.equal(b.inspect().ready, false); assert.deepEqual(b.writes, [], 'nothing is stored');
});

test('ui: the entry button stays hidden until the guide has started; a new player gets the dot but the label stays "المرشد"', () => {
  const b = boot({ state: st() });
  assert.equal(b.ok, true); assert.equal(b.g.active, true);
  assert.equal(b.els.opener.hidden, true, 'hidden before start()');
  assert.equal(b.g.open('goal'), false, 'cannot open before it has started');
  assert.equal(b.g.start(), true);
  assert.equal(b.els.opener.hidden, false);
  assert.equal(b.els.dot.hidden, false, 'a red dot: there is something unread, and the guide was never opened');
  assert.deepEqual([b.els.opener.dataset.news, b.els.opener.dataset.chapter, b.els.label.textContent], ['0', '', 'المرشد'], 'the intro chapter is announced by the dot alone');
  assert.equal(b.els.opener.attrs['aria-label'], 'المرشد العم سراج: الهدف والموسوعة والحكاية');
  assert.deepEqual(b.inspect().unread, [0]);
  assert.deepEqual(JSON.parse(b.store.get('mining-guide')), { v: 1, seen: [], opened: false });
});

test('ui: an existing player is not flooded with "new" chapters; opening the guide once clears the dot for good', () => {
  const b = boot({ state: st({ mines: wins(1, 1), equipment: { pickaxe: 1 }, gold: 30 }) });
  b.g.start();
  assert.deepEqual(b.inspect().store, { seen: [0, 1, 2], opened: false });
  assert.equal(b.els.dot.hidden, false, 'still announced once, because it is a new feature');
  assert.equal(b.els.opener.dataset.news, '0', 'but no chapter is flagged as new');
  b.els.opener.fire('click');
  assert.equal(b.inspect().open, true); assert.equal(b.els.overlay.hidden, false);
  assert.equal(b.els.dot.hidden, true, 'opened: nothing left to announce');
  assert.deepEqual(JSON.parse(b.store.get('mining-guide')), { v: 1, seen: [0, 1, 2], opened: true });
  // a second page load reads the record and keeps it
  const again = boot({ state: b.ctx.state }); again.sandbox.localStorage.setItem('mining-guide', b.store.get('mining-guide')); again.g.start();
  assert.deepEqual(again.inspect().store, { seen: [0, 1, 2], opened: true }); assert.equal(again.els.dot.hidden, true);
});

test('ui: opening pauses the round, focuses the close button; Escape and the close button return focus to where it came from', () => {
  const b = boot({ state: st() });
  b.g.start();
  b.ctx.activeElement = b.els.opener;
  b.els.opener.fire('click');
  assert.equal(b.calls.pause, 1, 'the running round is paused'); assert.equal(b.ctx.activeElement, b.els.close, 'focus moves into the window');
  assert.equal(b.els.body.innerHTML.includes('data-goal="win:0"'), true);
  b.key('Escape');
  assert.equal(b.els.overlay.hidden, true); assert.equal(b.inspect().open, false); assert.equal(b.ctx.activeElement, b.els.opener, 'focus is returned');
  b.key('Escape'); // already closed: harmless
  b.els.opener.fire('click'); b.els.close.fire('click');
  assert.equal(b.els.overlay.hidden, true); assert.equal(b.calls.pause, 2);
  b.key('Enter'); assert.equal(b.inspect().open, false);
});

test('ui: the three tabs and the codex sections re-render the window', () => {
  const b = boot({ state: st({ mines: wins(1) }) });
  b.g.start(); b.els.opener.fire('click');
  assert.equal(b.inspect().tab, 'goal');
  b.els.tabs[1].fire('click');
  assert.equal(b.inspect().tab, 'codex'); assert.match(b.els.body.innerHTML, /data-ore="copper"/);
  b.tap('data-guide-section', 'mines');
  assert.match(b.els.body.innerHTML, /data-mine="5"/); assert.equal(b.inspect().section, 'mines');
  b.tap('data-guide-section', 'gear');
  assert.match(b.els.body.innerHTML, /data-gear="armor"/);
  b.els.tabs[2].fire('click');
  assert.equal(b.inspect().tab, 'story'); assert.match(b.els.body.innerHTML, /gd-chapter-row/);
  assert.equal(b.els.tabs.map((t) => t.attrs['aria-selected']).join(), 'false,false,true', 'exactly one tab is selected for assistive tech');
  assert.equal(b.els.tabs[2].classes.has('active'), true); assert.equal(b.els.tabs[0].classes.has('active'), false);
});

test('ui: progress that arrives while the window is open (the server state was adopted) is shown at once', () => {
  const b = boot({ state: st() });
  b.g.start(); b.els.opener.fire('click');
  assert.match(b.els.body.innerHTML, /data-goal="win:0"/);
  b.ctx.state = st({ mines: wins(1) });
  b.g.refresh();
  assert.match(b.els.body.innerHTML, /data-goal="win:1"/, 'the open window repainted with the new goal');
  assert.deepEqual([b.els.opener.dataset.news, b.els.label.textContent], ['1', 'فصل جديد'], 'and the button behind it now says there is a new chapter');
  b.g.refresh();   // nothing changed: no needless repaint (it would reset the scroll position)
  b.els.body.innerHTML = 'untouched'; b.g.refresh();
  assert.equal(b.els.body.innerHTML, 'untouched');
});

test('ui: a newly opened mine turns the button into "فصل جديد"; one tap opens that chapter, marks it read and the label goes back', () => {
  const b = boot({ state: st() });
  b.g.start();
  assert.equal(b.els.opener.dataset.news, '0');
  b.ctx.state = st({ mines: wins(1) });            // the player just won the first mine
  b.g.refresh();
  assert.deepEqual([b.els.opener.dataset.news, b.els.opener.dataset.chapter, b.els.label.textContent], ['1', '1', 'فصل جديد']);
  assert.equal(b.els.opener.attrs['aria-label'], 'فصل جديد: «المكبس القديم» — المرشد العم سراج: الهدف والموسوعة والحكاية', 'screen readers hear which chapter');
  b.ctx.activeElement = b.els.opener;
  b.els.opener.fire('click');
  assert.deepEqual([b.inspect().open, b.inspect().tab, b.inspect().reading], [true, 'story', 1], 'the same button opens the chapter itself, not the goal screen');
  assert.match(b.els.body.innerHTML, /data-chapter="1"/);
  assert.deepEqual([b.els.opener.dataset.news, b.els.label.textContent], ['0', 'المرشد'], 'read: the label is back');
  assert.deepEqual(b.inspect().unread, [0], 'the intro chapter is still unread and still shows as the dot');
  assert.equal(b.els.dot.hidden, false);
  assert.deepEqual(JSON.parse(b.store.get('mining-guide')).seen, [1]);
  b.tap('data-guide-back'); assert.equal(b.inspect().reading, null); assert.match(b.els.body.innerHTML, /gd-chapter-row/);
  b.tap('data-guide-read', '0');
  assert.equal(b.inspect().reading, 0); assert.deepEqual(JSON.parse(b.store.get('mining-guide')).seen, [0, 1]);
  assert.equal(b.els.dot.hidden, true, 'everything read');
  b.key('Escape');
  assert.equal(b.ctx.activeElement, b.els.opener, 'focus goes back to the button');
  b.els.opener.fire('click');
  assert.deepEqual([b.inspect().tab, b.inspect().reading], ['goal', null], 'with nothing new the button opens the goal screen again');
  b.key('Escape');
  // the next mine opens: the button points at THAT chapter (not at the first one, not at chapter 1)
  b.ctx.state = st({ mines: wins(1, 1), equipment: { pickaxe: 1 } });
  b.g.refresh();
  assert.deepEqual([b.els.opener.dataset.news, b.els.opener.dataset.chapter], ['1', '2']);
  assert.match(b.els.opener.attrs['aria-label'], /عملاق الذهب/);
  b.els.opener.fire('click');
  assert.deepEqual([b.inspect().tab, b.inspect().reading], ['story', 2]);
  assert.match(b.els.body.innerHTML, /data-chapter="2"[\s\S]*عملاق الذهب/);
});

test('ui: a chapter that is still locked cannot be opened by asking for it', () => {
  const b = boot({ state: st() });
  b.g.start();
  b.g.open('story', 6);
  assert.equal(b.inspect().reading, 6, 'the request is remembered…');
  assert.doesNotMatch(b.els.body.innerHTML, /data-chapter=/, '…but the list is shown, not the chapter');
  assert.match(b.els.body.innerHTML, /gd-chapter-row locked/);
  assert.equal(b.inspect().store.seen.includes(6), true, 'known limitation: asking marks the id read, which only matters once it is unlocked');
});

test('ui: the goal button either opens the workshop or picks the mine, and closes the window first', () => {
  const rich = boot({ state: st({ mines: wins(1, 1), gold: 80, ores: { copper: 9 } }) });
  rich.g.start(); rich.els.opener.fire('click');
  assert.match(rich.els.body.innerHTML, /data-guide-action="workshop"/);
  rich.tap('data-guide-action', 'workshop');
  assert.equal(rich.els.overlay.hidden, true); assert.equal(rich.calls.workshop, 1); assert.deepEqual(rich.calls.zones, []);

  const poor = boot({ state: st({ mines: wins(1, 1) }) });
  poor.g.start(); poor.els.opener.fire('click');
  assert.match(poor.els.body.innerHTML, /data-guide-action="play" data-zone="0"/);
  poor.tap('data-guide-action', 'play', { zone: '0' });
  assert.deepEqual(poor.calls.zones, [0]); assert.equal(poor.calls.workshop, 0); assert.equal(poor.els.overlay.hidden, true);
  poor.els.opener.fire('click'); poor.tap('data-guide-action', 'play', { zone: '' });
  assert.deepEqual(poor.calls.zones, [0], 'a button without a mine selects nothing');
});

test('ui: it is read-only — the only thing it ever writes is its own reading record, and it never touches the network', () => {
  const b = boot({ state: st({ mines: wins(1, 1), gold: 10 }) });
  b.g.start(); b.els.opener.fire('click');
  b.els.tabs[1].fire('click'); b.tap('data-guide-section', 'mines'); b.els.tabs[2].fire('click'); b.tap('data-guide-read', '1'); b.tap('data-guide-back');
  b.tap('data-guide-action', 'play', { zone: '1' });
  assert.ok(b.writes.length > 0 && b.writes.every((k) => k === 'mining-guide'), `writes: ${[...new Set(b.writes)]}`);
  assert.deepEqual(b.ctx.state, st({ mines: wins(1, 1), gold: 10 }), 'the game state it was handed is untouched');
  const src = read('public', 'guide.js');
  for (const bad of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /enqueueOp/, /\/api\//, /\.gold\s*[-+]?=[^=]/, /eval\s*\(/, /new Function/]) assert.doesNotMatch(src, bad, `guide.js must not contain ${bad}`);
});

test('ui: a broken state source or a broken storage cannot break the game around it', () => {
  const b = boot({ state: st(), throwingState: true });
  assert.doesNotThrow(() => { b.g.start(); b.g.refresh(); b.g.open('goal'); b.els.opener.fire('click'); b.g.close(); });
  const c = boot({ state: st() });
  c.sandbox.localStorage.setItem = () => { throw new Error('quota'); };
  c.sandbox.localStorage.getItem = () => { throw new Error('denied'); };
  assert.doesNotThrow(() => { c.g.start(); c.els.opener.fire('click'); c.tap('data-guide-read', '0'); });
  assert.equal(c.inspect().open, true, 'it still works without being able to remember anything');
});

// ============================== الربط بالصفحة ==============================
test('wiring: markup, styles, script order and the hooks in the page', () => {
  assert.match(html, /<link rel="stylesheet" href="\/guide\.css\?v=1">/);
  const rules = html.indexOf('/platform-rules.js'), guide = html.indexOf('/guide.js?v=1'), main = html.indexOf('<script>\n    //') >= 0 ? html.indexOf('<script>\n    //') : html.search(/<script>\s*\n/);
  assert.ok(rules > 0 && guide > rules, 'guide.js loads after the shared rules it reads');
  assert.ok(main > guide || html.indexOf('window.Guide?.init') > guide, 'and before the page script that initialises it');
  for (const id of ['guide-overlay', 'guide-body', 'guide-close', 'open-guide']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /id="guide-overlay"[^>]*hidden[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="guide-title"/);
  assert.match(html, /id="guide-title"/);
  assert.match(html, /role="tablist" aria-label="أقسام المرشد"/);
  assert.equal((html.match(/data-guide-tab="/g) || []).length, 3);
  assert.match(html, /id="open-guide"[^>]*class="guide-entry"[^>]*data-guide-open[^>]*data-news="0"[^>]*hidden[^>]*aria-haspopup="dialog"/, 'hidden until the guide starts');
  assert.match(html, /<span data-guide-label>المرشد<\/span><i class="guide-dot" hidden aria-hidden="true"><\/i>/);
  assert.doesNotMatch(html, /guide-chip/, 'no extra strip: the round overlay of a 390x844 phone has no spare line');
  assert.match(html, /<symbol id="i-book" viewBox="0 0 24 24">/);
  assert.match(html, /window\.Guide\?\.init\(\{[\s\S]*?getState: \(\) => state[\s\S]*?\}\);/);
  assert.match(html, /window\.platformReady\.then\(\(\) => window\.Guide\?\.start\?\.\(\)\);/, 'starts only after the server state was adopted, so a veteran never looks new');
  assert.match(html, /window\.Guide\?\.refresh\?\.\(\);\s*\n\s*\}/, 'updateUI keeps it current');
  const row = /<div class="overlay-row">[\s\S]*?<\/div>/.exec(html)[0];
  assert.ok(row.indexOf('open-workshop-overlay') < row.indexOf('open-guide'), 'the guide button joins the row next to the workshop button');
  assert.ok(JSON.parse(read('package.json')).scripts.build.includes('node --check public/guide.js'), 'the build syntax-checks it');
  const css = read('public', 'guide.css');
  for (const sel of ['.guide-overlay', '.gd-tab.active', '.gd-bubble', '.gd-chapter-row.fresh', '.guide-dot', '.guide-entry[data-news="1"]']) assert.ok(css.includes(sel), sel);
  assert.match(css, /\.mine-overlay \.overlay-row \.guide-entry \{[^}]*flex: 0 0 60px/, 'a compact button: the two big ones keep their room on a 320px phone');
  assert.match(css, /@media \(max-height: 480px\)/, 'landscape phones are handled');
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(Number(/z-index: (\d+)/.exec(/\.guide-overlay \{[^}]*\}/.exec(css)[0])[1]) > 90, 'above the mines map (90)');
});

test('wiring: the page stays emoji-free around the guide (icons are SVG) and no new network surface appears', () => {
  const css = read('public', 'guide.css'), js = read('public', 'guide.js');
  assert.doesNotMatch(css, EMOJI); assert.doesNotMatch(js, EMOJI);
  const win = /<div id="guide-overlay"[\s\S]*?<div id="guide-body"[^>]*><\/div>\s*<\/div>/.exec(html)[0];
  assert.doesNotMatch(win, EMOJI); assert.doesNotMatch(win, /\sonclick=|\sonerror=|javascript:/);
  const button = /<button id="open-guide"[\s\S]*?<\/button>/.exec(html)[0];
  assert.doesNotMatch(button, EMOJI);
  assert.doesNotMatch(read('server.js'), /guide/i, 'no server code was added for the guide');
});

function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF'); assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const fmt = buf.toString('ascii', 12, 16);
  if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), alpha: (buf[20] & 0x10) !== 0 };
  if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >>> 14) & 0x3fff), alpha: true }; }
  throw new Error(`unexpected WebP chunk ${fmt}`);
}

test('art: the guide portrait is a transparent cut-out of the size the markup reserves, and small', () => {
  const file = path.join(root, 'public', 'assets', 'cave', 'guide', 'siraj.webp');
  const buf = fs.readFileSync(file), size = webpSize(buf);
  assert.deepEqual([size.w, size.h, size.alpha], [428, 520, true]);
  assert.ok(buf.length < 90 * 1024, `portrait is ${buf.length} bytes`);
  assert.match(read('public', 'guide.js'), /PORTRAIT: '\/assets\/cave\/guide\/siraj\.webp\?v=1'/);
  assert.equal(G.renderGoal(G.snapOf(st()), 0).includes(`width="${size.w}" height="${size.h}"`), true, 'the <img> reserves exactly the picture size');
});
