'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/platform-rules.js');

test('V21: upper mine ladders are climbable and landings remain solid after release', () => {
  assert.equal(R.VERSION, 14);
  for (let zone = 1; zone < R.MINES.length; zone++) {
    const level = R.levelFor(zone);
    const ladder = level.platforms.find(box => box.route === 'upper');
    assert.ok(ladder, `mine ${zone} has an upper branch ladder`);
    const state = R.create('miner', R.seedFromId(`ladder-${zone}`), { zone });
    const p = state.player;
    p.x = ladder.x + 14 - p.w / 2;
    p.y = 300 - p.h;
    p.vx = 0; p.vy = 0; p.grounded = true;
    for (let tick = 0; tick < 60; tick++) R.step(state, R.INPUT.UP);
    assert.ok(Math.abs(p.y - (ladder.y - p.h)) < 0.001,
      `mine ${zone}: miner reaches the top of the ladder`);
    assert.ok(Math.abs((p.x + p.w / 2) - (ladder.x + 14)) < 0.001,
      `mine ${zone}: miner stays aligned with the ladder`);
    for (let tick = 0; tick < 30; tick++) R.step(state, 0);
    assert.ok(Math.abs(p.y - (ladder.y - p.h)) < 0.001,
      `mine ${zone}: upper ledge supports the miner after releasing UP`);
  }
});

test('V21: ladder climbing is deterministic for identical input tapes', () => {
  const zone = 2, level = R.levelFor(zone), ladder = level.platforms.find(box => box.route === 'upper');
  const seed = R.seedFromId('ladder-determinism');
  const make = () => {
    const state = R.create('miner', seed, { zone });
    state.player.x = ladder.x + 14 - state.player.w / 2;
    state.player.y = 300 - state.player.h;
    state.player.vx = 0; state.player.vy = 0; state.player.grounded = true;
    return state;
  };
  const a = make(), b = make();
  for (let tick = 0; tick < 45; tick++) { R.step(a, R.INPUT.UP); R.step(b, R.INPUT.UP); }
  assert.deepEqual(
    { x: a.player.x, y: a.player.y, vy: a.player.vy, grounded: a.player.grounded, tick: a.tick },
    { x: b.player.x, y: b.player.y, vy: b.player.vy, grounded: b.player.grounded, tick: b.tick }
  );
});
