'use strict';
// قواعد التبجيل المشتركة (public/prestige-rules.js): الدخل السلبي ×(1 + 0.1 × مستوى) بدقة، والمتطلب الذي يرتفع مع كل مستوى، والفحص.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/prestige-rules');

test('passive income: level 0 is exactly the old formula, every level adds exactly 10% of it, level 10 doubles it', () => {
  for (const [bot, rig] of [[0, 0], [1, 0], [0, 1], [15, 3], [7, 9], [100, 40], [333, 77]]) {
    const base = bot * 5 + rig * 25;
    assert.equal(P.passiveFor({ bot, rig }, 0), base, `level 0 is bot×5 + rig×25 (${bot}/${rig})`);
    assert.equal(P.passiveFor({ bot, rig }, 10), base * 2, 'level 10 is exactly double');
    for (let L = 1; L <= 10; L++) assert.equal(P.passiveFor({ bot, rig }, L) - P.passiveFor({ bot, rig }, L - 1), base / 10, `level ${L} adds a tenth of the base (${bot}/${rig})`);
  }
  // exact in floating point: always a multiple of 0.5, never 82.50000000000001
  for (let bot = 0; bot < 60; bot++) for (let rig = 0; rig < 20; rig++) for (let L = 0; L <= 10; L++) {
    const v = P.passiveFor({ bot, rig }, L);
    assert.ok(Number.isInteger(v * 2), `${bot}/${rig}/${L} → ${v}`);
  }
  assert.equal(P.passiveFor({ bot: 15, rig: 3 }, 1), 165);
  assert.equal(P.passiveFor({ bot: 15, rig: 3 }, 3), 195);
  assert.equal(P.passiveFor({ bot: 1, rig: 0 }, 1), 5.5);
  assert.equal(P.passiveFor({ bot: 0, rig: 1 }, 7), 42.5);
});

test('passive income: junk counts and levels are clamped, not trusted', () => {
  assert.equal(P.passiveFor(undefined, 3), 0); assert.equal(P.passiveFor(null, 3), 0); assert.equal(P.passiveFor({}, 3), 0);
  assert.equal(P.passiveFor({ bot: -5, rig: 'x' }, 3), 0);
  assert.equal(P.passiveFor({ bot: 4.9, rig: 0 }, 0), 20, 'whole counts only');
  assert.equal(P.passiveFor({ bot: 10, rig: 0 }, 99), 100, 'a level beyond the maximum is the maximum');
  assert.equal(P.passiveFor({ bot: 10, rig: 0 }, -4), 50, 'a negative level is level 0');
  assert.equal(P.passiveFor({ bot: 10, rig: 0 }, 2.9), 60, 'a fractional level is floored');
  assert.equal(P.passiveFor({ bot: 10, rig: 0 }, NaN), 50);
  assert.deepEqual([P.levelOf(-1), P.levelOf(0), P.levelOf(3.7), P.levelOf(10), P.levelOf(11), P.levelOf('x')], [0, 0, 3, 10, 10, 0]);
});

test('the multiplier shown to the player: 1.0 up to 2.0 in steps of 0.1', () => {
  assert.deepEqual(Array.from({ length: 11 }, (_, L) => P.multiplier(L)), [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2]);
  assert.equal(P.multiplier(50), 2); assert.equal(P.multiplier(-1), 1);
  assert.equal(P.MAX_LEVEL, 10); assert.equal(P.BONUS_PER_LEVEL, 10);
});

test('the requirement: 15 bots and 3 rigs for the first, two more bots and one more rig for each next, none at the top', () => {
  assert.deepEqual(P.requirement(0), { bots: 15, rigs: 3 });
  assert.deepEqual(Array.from({ length: 10 }, (_, L) => [P.requirement(L).bots, P.requirement(L).rigs]), [[15, 3], [17, 4], [19, 5], [21, 6], [23, 7], [25, 8], [27, 9], [29, 10], [31, 11], [33, 12]]);
  assert.equal(P.requirement(10), null); assert.equal(P.requirement(11), null, 'beyond the maximum there is nothing to ask for');
  for (let L = 1; L < 10; L++) assert.ok(P.requirement(L).bots > P.requirement(L - 1).bots && P.requirement(L).rigs > P.requirement(L - 1).rigs, `level ${L} asks for more than level ${L - 1}`);
  assert.deepEqual(P.requirement(-3), P.requirement(0));
});

test('check: locked until BOTH counts are met, ready at exactly the requirement, never past the top', () => {
  const at = (bot, rig, level) => P.check({ bot, rig }, level);
  assert.deepEqual([at(14, 3, 0).ok, at(14, 3, 0).reason], [false, 'locked'], 'one bot short');
  assert.deepEqual([at(15, 2, 0).ok, at(15, 2, 0).reason], [false, 'locked'], 'one rig short');
  assert.deepEqual([at(0, 0, 0).ok, at(0, 0, 0).reason], [false, 'locked']);
  assert.equal(at(15, 3, 0).ok, true, 'exactly the requirement is enough');
  assert.equal(at(99, 99, 0).ok, true);
  assert.deepEqual(at(15, 3, 0), { ok: true, level: 0, have: { bots: 15, rigs: 3 }, need: { bots: 15, rigs: 3 } });
  assert.deepEqual(at(10, 1, 4), { ok: false, reason: 'locked', level: 4, have: { bots: 10, rigs: 1 }, need: { bots: 23, rigs: 7 } }, 'the answer names what is asked and what is owned');
  assert.equal(at(16, 3, 1).ok, false, 'level 1 asks for 17 bots, not the 15 of level 0');
  assert.equal(at(17, 4, 1).ok, true);
  assert.deepEqual([at(10_000, 10_000, 10).ok, at(10_000, 10_000, 10).reason, at(10_000, 10_000, 10).need], [false, 'max', null], 'the top is the top, however much is owned');
  assert.equal(at(10_000, 10_000, 99).reason, 'max');
  assert.equal(P.check(undefined, 0).ok, false);
});

test('spentBy: what was given up by N prestiges, so a purchase-counting achievement never goes backwards', () => {
  assert.deepEqual(Array.from({ length: 11 }, (_, n) => P.spentBy(n)), [0, 18, 39, 63, 90, 120, 153, 189, 228, 270, 315]);
  assert.equal(P.spentBy(99), 315); assert.equal(P.spentBy(-1), 0);
  for (let n = 1; n <= 10; n++) assert.ok(P.spentBy(n) > P.spentBy(n - 1));
});

test('view: everything the card needs in one object', () => {
  assert.deepEqual(P.view({ bot: 10, rig: 2 }, 0), { level: 0, max: 10, multiplier: 1, bonusPct: 0, nextMultiplier: 1.1, next: { bots: 15, rigs: 3 }, have: { bots: 10, rigs: 2 }, ready: false, maxed: false });
  const ready = P.view({ bot: 17, rig: 4 }, 1);
  assert.deepEqual([ready.ready, ready.multiplier, ready.nextMultiplier, ready.bonusPct, ready.next], [true, 1.1, 1.2, 10, { bots: 17, rigs: 4 }]);
  const top = P.view({ bot: 500, rig: 500 }, 10);
  assert.deepEqual([top.maxed, top.ready, top.next, top.nextMultiplier, top.multiplier, top.bonusPct], [true, false, null, null, 2, 100]);
  assert.ok(Object.isFrozen(P) && Object.isFrozen(P.FIRST) && Object.isFrozen(P.STEP), 'the rules cannot be edited at run time');
});

test('the price of the requirement, from the shop\'s own price rules: finite, growing, and the first level pays back within hours', () => {
  // bot 200 ×1.4, rig 1000 ×1.3 per purchase (UPGRADES_DEF in server.js): what it costs to OWN the required counts from scratch
  const cost = (base, growth, n) => { let c = base, t = 0; for (let i = 0; i < n; i++) { t += c; c = Math.floor(c * growth); } return t; };
  const gold = (L) => { const r = P.requirement(L); return cost(200, 1.4, r.bots) + cost(1000, 1.3, r.rigs); };
  assert.equal(gold(0), 81_007, 'the first prestige: about 81 thousand gold of purchases');
  for (let L = 1; L < 10; L++) assert.ok(gold(L) > gold(L - 1) && gold(L) < gold(L - 1) * 2.1, `level ${L}: dearer than the last but by under ×2.1 (${gold(L)})`);
  assert.ok(gold(9) < 50_000_000, 'the top level is a long goal, not an impossible one');
  // the +10% it buys, in hours of the income owned at that point (a payback figure for the docs, not a promise)
  const payback = (L) => { const r = P.requirement(L); return gold(L) / ((5 * r.bots + 25 * r.rigs) * 0.1) / 3600; };
  assert.ok(payback(0) < 2, `first level pays back in ${payback(0).toFixed(1)} h`);
  assert.ok(payback(9) > payback(0) * 20, 'and the last one takes days: a late prestige is a choice, not a chore');
});
