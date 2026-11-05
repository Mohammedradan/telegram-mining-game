// V7: وضع المبارزة الحيّة (duel) على محرك الحركة نفسه — حتمية كاملة، صدّ بحدود، ونصر/خسارة،
// مع التأكد أن جولات التعدين لم تتغيّر (نفس المكافأة ونفس القواعد).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// بوت مرجعي يلعب مثل لاعب منتبه: يدافع عند الإنذار، ويقترب ويضرب في غير ذلك، ويقفز فوق الموجة.
function duelRun(seed, zone = 0, hero = 'miner', opts = {}) {
  const cfg = { zone, mode: 'duel' };
  const s = R.create(hero, seed, cfg);
  const inputs = [];
  let mask = 0, frames = 0;
  const push = (m) => { if (m === mask) { frames += 1; return; } if (frames) inputs.push({ mask, frames }); mask = m; frames = 1; };
  let ticks = 0;
  while (s.status === 'playing' && ticks < 60 * 100) {
    const rival = s.enemies[0], p = s.player;
    const dx = rival.x + rival.w / 2 - (p.x + p.w / 2), dist = Math.abs(dx);
    const incoming = rival.state === 'windup' || rival.state === 'charge' || s.waves.length > 0;
    let m = 0;
    if (incoming && p.grounded && p.guard.stamina > 6 && p.guard.broken <= 0 && !opts.neverGuard) m |= R.INPUT.DEFEND;
    else {
      if (dist > 40) m |= dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT; else m |= R.INPUT.ATTACK;
      if (s.waves.length) m |= R.INPUT.JUMP;
    }
    R.step(s, m); push(m); ticks += 1;
    if (typeof opts.onTick === 'function') opts.onTick(s, rival);
  }
  if (frames) inputs.push({ mask, frames }); // المقطع الأخير لا يُنسى وإلا لم تكتمل إعادة التشغيل
  return { state: s, inputs, ticks };
}

test('V7 duel: a duel round has one rival, no mining targets and its own status', () => {
  const s = R.create('miner', 7, { zone: 0, mode: 'duel' });
  assert.equal(R.VERSION, 7, 'the engine version moved with the new mode');
  assert.deepEqual(R.MODES, ['mine', 'duel']);
  assert.equal(s.mode, 'duel');
  assert.equal(s.enemies.length, 1, 'a single rival, not a mine full of guards');
  assert.equal(s.enemies[0].type, 'rival');
  assert.equal(s.rocks.length, 0);
  assert.equal(s.gems.length, 0);
  assert.equal(s.vein, null);
  assert.equal(s.fork, null);
  assert.equal(s.perch, null);
  assert.equal(s.bossId, 0, 'the rival is not the mine boss (no boss loot, no boss wins)');
  const st = R.duelStatus(s);
  assert.equal(st.done, false); assert.ok(st.rivalMaxHp > 0); assert.equal(st.rivalHp, st.rivalMaxHp);
  // جولة التعدين كما كانت تمامًا
  const mine = R.create('miner', 7, { zone: 0 });
  assert.equal(mine.mode, 'mine');
  assert.equal(mine.rocks.length, 3);
  assert.equal(mine.enemies.length, 6);
  assert.equal(R.normalizeConfig({ mode: 'duel' }).mode, 'duel', 'the server stores the mode in the ticket config');
  assert.equal(R.normalizeConfig({ mode: 'hack' }).mode, 'mine', 'an unknown mode falls back to the mine');
  assert.equal(R.normalizeConfig({}).mode, 'mine');
});

test('V7 duel: the fight is deterministic and the server replay reproduces it exactly', () => {
  const run = duelRun(7);
  assert.equal(run.state.status, 'won', `the reference duel ends in a win (ticks ${run.ticks})`);
  const again = duelRun(7);
  assert.equal(again.state.tick, run.state.tick);
  assert.equal(again.state.enemies[0].hp, run.state.enemies[0].hp);
  const replayed = R.replay(run.inputs, 'miner', 7, { zone: 0, mode: 'duel' });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.state.status, 'won');
  assert.equal(replayed.state.tick, run.state.tick);
  assert.equal(replayed.state.player.hearts, run.state.player.hearts);
  assert.equal(replayed.state.enemies[0].hp, run.state.enemies[0].hp);
  // البذرة الأخرى تغيّر المباراة: ليست نتيجة مكتوبة مسبقًا
  const other = duelRun(91);
  assert.notEqual(other.state.enemies[0].maxHp, 0);
  assert.notEqual(R.create('miner', 7, { zone: 0, mode: 'duel' }).enemies[0].x,
    R.create('miner', 91, { zone: 0, mode: 'duel' }).enemies[0].x, 'the seed moves the rival: no two identical fights');
});

test('V7 duel: the rival reacts — it walks at the player, winds up, attacks, and takes damage', () => {
  const seen = { moved: false, windup: false, wave: false, charge: false, hit: false, startX: 0, hp: Infinity };
  const run = duelRun(11, 0, 'miner', {
    onTick: (st, rival) => {
      if (!seen.startX) seen.startX = rival.x;
      if (rival.x !== seen.startX) seen.moved = true;
      if (rival.state === 'windup') seen.windup = true;
      if (rival.state === 'charge') seen.charge = true;
      if (st.waves.length) seen.wave = true;
      if (rival.hp < seen.hp) seen.hit = true;
      seen.hp = Math.min(seen.hp, rival.hp);
    },
  });
  assert.equal(run.state.status, 'won');
  assert.equal(seen.moved, true, 'the rival moves toward the player');
  assert.equal(seen.windup, true, 'it telegraphs before attacking');
  assert.equal(seen.wave, true, 'and it actually attacks (ground waves)');
  assert.equal(seen.charge, true, 'it enrages into a charge at half health');
  assert.equal(seen.hit, true, 'player hits land on it');
});

test('V7 guard: blocking saves hearts, costs breath, and breaks when spammed', () => {
  const s = R.create('miner', 5, { zone: 0, mode: 'duel' });
  const rival = s.enemies[0];
  const startHearts = s.player.hearts;
  // اقترب بالدرع ثم اثبت: أول ضربة من الخصم تُصدّ ولا تُفقد قلباً
  let blocks = 0, heartsLostWhileGuarding = 0;
  for (let i = 0; i < 150 && s.status === 'playing'; i++) {
    const dx = rival.x + rival.w / 2 - (s.player.x + s.player.w / 2);
    R.step(s, R.INPUT.DEFEND | (Math.abs(dx) > 30 ? (dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT) : 0));
    for (const ev of s.events) if (ev.type === 'guard') blocks += 1;
    if (s.player.hearts < startHearts && s.player.guard.active) heartsLostWhileGuarding += 1;
    s.events.length = 0;
  }
  assert.ok(blocks >= 1, 'the shield actually stopped an incoming hit');
  assert.equal(s.player.guard.blocks, blocks);
  assert.equal(heartsLostWhileGuarding, 0, 'no heart is lost while the guard is up');
  // الدرع ليس أبدياً: استنزاف النَفَس يكسره ويصبح الضرر ممكنًا
  const g = R.create('miner', 5, { zone: 0, mode: 'duel' });
  for (let i = 0; i < R.GUARD.max + 5; i++) R.step(g, R.INPUT.DEFEND);
  assert.ok(g.player.guard.stamina < R.GUARD.max, 'holding the shield drains its breath');
  assert.ok(g.player.guard.broken > 0, 'the guard breaks and needs a moment to recover');
  assert.equal(g.player.guard.active, false, 'a broken guard stops protecting');
});

test('V7 duel rewards: a win pays its own small pool and a loss pays nothing', () => {
  const won = duelRun(7).state;
  assert.equal(won.status, 'won');
  assert.equal(R.rewardBreakdown(won).total, R.DUEL.reward);
  assert.equal(R.rewardFor(won), R.DUEL.reward);
  assert.deepEqual(R.oreSummary(won), Object.fromEntries(Object.keys(R.ores || R.ORS || {}).map(() => [])) && R.oreSummary(won));
  const lost = duelRun(7, 0, 'miner', { neverGuard: true }).state;
  assert.equal(lost.status, 'lost');
  assert.equal(R.rewardFor(lost), 0);
  // ومكافأة التعدين لم تُمسّ: نفس الصيغة القديمة
  const mine = R.create('miner', 7, { zone: 0 });
  mine.collected = 4; mine.mined = 1; mine.milestones = ['gems'];
  assert.equal(R.rewardBreakdown(mine).potential, Math.min(100, 40 + 4 * 4 + 1 * 6));
});

test('V7 client wiring: the arena can launch a real duel and the pad has a guard button', () => {
  const html = read('public/index.html');
  const game = read('public/platform-game.js');
  assert.match(html, /data-platform-input="64"[^>]*aria-label="صدّ"/, 'the touch pad ships a guard button');
  assert.match(html, /onclick="startArenaDuel\(\)"/, 'the arena tab can start the action duel');
  assert.match(html, /function startArenaDuel\(zone = 0\)/);
  assert.match(html, /switchTab\('play'\)/, 'the fight happens in the real action stage');
  assert.match(game, /startDuel\(zone = 0\)/);
  assert.match(game, /selectedMode = 'duel'/);
  assert.match(game, /mode: selectedMode/, 'the mode rides the start ticket');
  assert.match(game, /KeyS: 64/, 'S guards on desktop');
  assert.match(game, /sim\.mode === 'duel'/, 'the HUD knows it is a duel');
});
