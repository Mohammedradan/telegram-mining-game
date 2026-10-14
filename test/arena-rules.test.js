// اختبارات وحدة لمحرك الساحة المشترك (public/arena-rules.js): حتمية كاملة من البذرة، شرعية الحركات،
// الحسم بعد 30 جولة، وإعادة التشغيل التي يعتمد عليها الخادم لختم النتيجة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../public/arena-rules');

function play(level, seed, policy) {
  const b = R.newBattle({ level, seed });
  const events = [];
  while (b.active) {
    const ev = R.playerMove(b, policy(b));
    assert.equal(ev.error, undefined);
    events.push(ev);
    if (!b.active) break;
    events.push(R.enemyMove(b));
    if (!b.active) break;
    R.nextRound(b);
  }
  return { b, events };
}
const firstLegal = (b, prefs) => prefs.find((a) => R.canAct(b.player, a)) || 'WAIT';
const smart = (b) => firstLegal(b, b.player.hp <= 40 ? ['HEAL', 'ATTACK', 'WAIT'] : ['ATTACK', 'WAIT']);
const aggressive = (b) => firstLegal(b, ['ATTACK', 'WAIT']);

test('the same seed and moves reproduce the same match event by event; another seed does not', () => {
  const a = play(3, 123456, smart);
  const b = play(3, 123456, smart);
  assert.deepEqual(JSON.parse(JSON.stringify(a.events)), JSON.parse(JSON.stringify(b.events)));
  assert.equal(a.b.outcome, b.b.outcome);
  const replayed = R.replay({ level: 3, seed: 123456, moves: a.b.moves });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.outcome, a.b.outcome);
  assert.equal(replayed.rounds, a.b.round);
  assert.equal(replayed.enemyTurns, a.b.enemyTurns);
  assert.equal(replayed.battle.player.hp, a.b.player.hp);
  assert.equal(replayed.battle.enemy.hp, a.b.enemy.hp);
  const other = R.replay({ level: 3, seed: 654321, moves: a.b.moves });
  assert.ok(!other.ok || other.battle.enemy.hp !== a.b.enemy.hp || other.battle.player.hp !== a.b.player.hp, 'a different seed changes the match');
});

test('battles start from the shared config and the enemy scales with the ticket level', () => {
  const b = R.newBattle({ level: 4, seed: 1 });
  assert.equal(b.player.hp, 100); assert.equal(b.player.energy, 10);
  assert.equal(b.enemy.hp, 120); assert.equal(b.enemy.maxHp, 120); assert.equal(b.enemy.level, 4);
  assert.equal(R.newBattle({ level: 0, seed: 1 }).enemy.level, 1, 'level is clamped to at least 1');
  assert.equal(R.newBattle({ level: 'x', seed: 1 }).enemy.level, 1);
  assert.equal(R.newBattle({ level: 1, seed: 2 ** 40 + 5 }).seed, 5, 'seed is a 32-bit value');
  assert.deepEqual(R.CONFIG.costs, { ATTACK: 3, DEFEND: 1, HEAL: 4, WAIT: 0 });
  assert.equal(R.minDurationMs(13), 13 * 750);
});

test('illegal moves are refused without consuming randomness: not enough energy, heal at full health, unknown action, inactive battle', () => {
  const b = R.newBattle({ level: 1, seed: 9 });
  assert.equal(R.playerMove(b, 'HEAL').error, 'illegal', 'full health');
  assert.equal(R.playerMove(b, 'NUKE').error, 'illegal');
  assert.deepEqual(b.moves, []);
  assert.equal(R.playerMove(b, 'ATTACK').action, 'ATTACK');
  assert.equal(R.playerMove(b, 'ATTACK').action, 'ATTACK');
  assert.equal(R.playerMove(b, 'ATTACK').action, 'ATTACK');
  assert.equal(b.player.energy, 1);
  assert.equal(R.playerMove(b, 'ATTACK').error, 'illegal', '1 energy cannot attack');
  assert.equal(R.playerMove(b, 'DEFEND').action, 'DEFEND');
  assert.equal(b.player.energy, 0);
  assert.equal(R.playerMove(b, 'DEFEND').error, 'illegal');
  assert.equal(R.playerMove(b, 'WAIT').action, 'WAIT');
  assert.equal(b.player.energy, 3);
  b.active = false;
  assert.equal(R.playerMove(b, 'WAIT').error, 'inactive');
  assert.equal(R.enemyMove(b).error, 'inactive');
  assert.equal(R.nextRound(b), null);
});

test('replay rejects forged move lists: malformed, unfinished, extra moves after the end, illegal energy use', () => {
  assert.deepEqual(R.replay({ level: 1, seed: 1, moves: [] }), { ok: false, reason: 'invalid' });
  assert.deepEqual(R.replay({ level: 1, seed: 1, moves: ['NUKE'] }), { ok: false, reason: 'invalid' });
  assert.deepEqual(R.replay({ level: 1, seed: 1, moves: Array(31).fill('WAIT') }), { ok: false, reason: 'invalid' });
  assert.deepEqual(R.replay({ level: 1, seed: 1, moves: 'ATTACK' }), { ok: false, reason: 'invalid' });
  assert.equal(R.replay({ level: 1, seed: 1, moves: ['ATTACK'] }).reason, 'unfinished');
  const spam = R.replay({ level: 1, seed: 1, moves: Array(30).fill('ATTACK') });
  assert.equal(spam.ok, false);
  assert.ok(spam.reason === 'illegal_move' || spam.reason === 'extra_moves');
  if (spam.reason === 'illegal_move') assert.ok(spam.round >= 9, 'attack costs 3, rounds regenerate 2: the energy runs out by round 9 at the latest');
  const { b } = play(1, 4242, aggressive);
  assert.equal(b.outcome, 'win');
  assert.ok(b.moves.length < 30, 'this seeded match ends early, leaving room for a forged extra move');
  const extra = R.replay({ level: 1, seed: 4242, moves: [...b.moves, 'WAIT'] });
  assert.equal(extra.reason, 'extra_moves');
});

test('thirty rounds end in a verdict by health ratio (or a draw), never in an endless match; a full WAIT match is a loss', () => {
  const { b: idle } = play(1, 77, () => 'WAIT');
  assert.equal(idle.outcome, 'loss');
  assert.ok(idle.round <= 31 && idle.moves.length <= 30);
  const waited = R.replay({ level: 1, seed: 77, moves: idle.moves });
  assert.equal(waited.ok, true);
  assert.equal(waited.outcome, 'loss');
  // تعادل مُصطنع: نسبتا صحة متساويتان عند الحسم
  const b = R.newBattle({ level: 1, seed: 5 });
  b.round = 30; b.player.hp = 45; b.enemy.hp = 40.5; // 45/100 = 40.5/90
  const judged = R.nextRound(b);
  assert.deepEqual({ judged: judged.judged, draw: judged.draw }, { judged: true, draw: true });
  assert.equal(b.outcome, 'draw');
  assert.equal(b.active, false);
  const c = R.newBattle({ level: 1, seed: 5 });
  c.round = 30; c.player.hp = 90; c.enemy.hp = 45;
  assert.equal(R.nextRound(c).draw, false);
  assert.equal(c.outcome, 'win');
  assert.equal(c.enemy.hp, 0);
});

test('fuzz: across 300 seeded matches energies never go negative, health never exceeds max, every match finishes and replays identically', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const level = 1 + (seed % 6);
    const rng = R.mulberry32(seed * 7919);
    const b = R.newBattle({ level, seed });
    let guard = 0;
    while (b.active && guard++ < 200) {
      const legal = R.ACTIONS.filter((a) => R.canAct(b.player, a));
      assert.ok(legal.length > 0, 'WAIT is always available');
      assert.equal(R.playerMove(b, legal[Math.floor(rng() * legal.length)]).error, undefined);
      if (!b.active) break;
      R.enemyMove(b);
      assert.ok(b.enemy.energy >= 0 && b.enemy.energy <= 10, `enemy energy stays in range (seed ${seed})`);
      assert.ok(b.enemy.hp <= b.enemy.maxHp && b.player.hp <= 100, `health stays below max (seed ${seed})`);
      if (!b.active) break;
      R.nextRound(b);
    }
    assert.equal(b.active, false, `match ${seed} finished`);
    assert.ok(['win', 'loss', 'draw'].includes(b.outcome));
    assert.ok(b.round <= 31 && b.moves.length <= 30);
    const again = R.replay({ level, seed, moves: b.moves });
    assert.equal(again.ok, true, `seed ${seed}`);
    assert.equal(again.outcome, b.outcome);
    assert.equal(again.enemyTurns, b.enemyTurns);
  }
});

test('the engine is identical in the browser build: the file defines a global ArenaRules with the same API and no Math.random', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'arena-rules.js'), 'utf8');
  assert.doesNotMatch(src, /Math\.random/);
  const ctx = { self: undefined }; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const browser = vm.runInContext('ArenaRules', ctx);
  assert.deepEqual(Object.keys(browser).sort(), Object.keys(R).sort());
  const a = browser.replay({ level: 2, seed: 31337, moves: ['ATTACK', 'ATTACK', 'ATTACK', 'WAIT', 'ATTACK', 'ATTACK', 'ATTACK', 'ATTACK', 'WAIT', 'ATTACK'] });
  const b = R.replay({ level: 2, seed: 31337, moves: ['ATTACK', 'ATTACK', 'ATTACK', 'WAIT', 'ATTACK', 'ATTACK', 'ATTACK', 'ATTACK', 'WAIT', 'ATTACK'] });
  assert.equal(a.ok, b.ok); assert.equal(a.reason, b.reason); assert.equal(a.outcome, b.outcome);
});
