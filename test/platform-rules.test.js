const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/platform-rules');
const solution = require('./fixtures/platform-solution.cjs');
const advance = (s, mask, n) => { for (let i = 0; i < n; i++) R.step(s, mask); return s; };

test('platform: deterministic complete level requires movement, mining, jumps and collecting; no damage solution', () => {
  const { state, inputs } = solution();
  assert.equal(state.status, 'won'); assert.equal(state.damage, 0); assert.ok(state.mined >= 1); assert.ok(state.collected >= 3);
  assert.ok(state.player.x > 2500); assert.ok(state.tick > 600 && state.tick < 1200);
  assert.deepEqual(R.replay(inputs).state, state);
  assert.equal(R.rewardFor(state), 98);
});
test('platform: gravity lands exactly on ground and a held jump never becomes infinite jumping', () => {
  const s = R.create(); s.player.y = 120; s.player.grounded = false;
  advance(s, 0, 120); assert.equal(s.player.y, 262); assert.equal(s.player.grounded, true);
  R.step(s, 4); assert.ok(s.player.vy < 0); assert.equal(s.player.pose, 'jump');
  advance(s, 4, 120); assert.equal(s.player.y, 262); assert.equal(s.player.vy, 0);
  R.step(s, 0); R.step(s, 4); assert.ok(s.player.vy < 0);
});
test('platform: solid rock blocks movement until three timed close-range hits destroy it', () => {
  const s = R.create(); advance(s, 8, 45); assert.equal(s.mined, 0); // too far
  advance(s, 2, 120); assert.equal(s.player.x, 416); assert.equal(s.rocks[0].hp, 3);
  R.step(s, 8); assert.equal(s.rocks[0].hp, 2);
  advance(s, 8, 13); assert.equal(s.rocks[0].hp, 2);
  advance(s, 8, 15); assert.equal(s.mined, 1); assert.equal(s.rocks[0].hp, 0);
  advance(s, 10, 10); assert.ok(s.player.x > 416);
  assert.equal(s.mined, 1); // destroyed ore cannot be harvested twice
});
test('platform: underside collision stops ascent and floor/platform landing does not tunnel', () => {
  const s = R.create(); s.player.x = 300; s.player.y = 262;
  advance(s, 4, 3); assert.ok(s.player.y >= 250); // underside of platform at y=230..250
  advance(s, 0, 100); assert.equal(s.player.y, 262);
  s.player.y = 120; s.player.vy = 650; s.player.grounded = false;
  advance(s, 0, 20); assert.equal(s.player.y, 192); assert.equal(s.player.grounded, true);
});
test('platform: collecting each crystal once, damage grace and fall/checkpoint respawn', () => {
  const s = R.create(); s.player.x = 190; R.step(s, 0); assert.equal(s.collected, 1);
  advance(s, 0, 30); assert.equal(s.collected, 1);
  s.player.x = 1195; s.player.y = 262; R.step(s, 0);
  assert.equal(s.player.hearts, 2); assert.equal(s.player.pose, 'hurt');
  s.player.x = 1195; s.player.y = 262; R.step(s, 0); assert.equal(s.player.hearts, 2);
  s.checkpoint = 920; s.player.y = 450; R.step(s, 0); assert.equal(s.player.x, 920); assert.ok(s.player.y < 300);
  const vent = R.LEVEL.hazards[0]; assert.equal(R.activeHazard(vent, 10), true); assert.equal(R.activeHazard(vent, 100), false);
});
test('platform: camera bounded at both ends and independent of display size/physics', () => {
  const s = R.create(); assert.equal(R.cameraFor(s, 400), 0);
  s.player.x = 2000; assert.ok(R.cameraFor(s, 400) > 0);
  s.player.x = 2670; assert.equal(R.cameraFor(s, 800), R.LEVEL.width - 800);
  const old = JSON.stringify(s); R.cameraFor(s, 320); assert.equal(JSON.stringify(s), old);
});
test('platform: locked exit cannot win without mining and zero financial reward on failure', () => {
  const s = R.create(); s.player.x = 2540; R.step(s, 0); assert.equal(s.status, 'playing');
  s.collected = 10; R.step(s, 0); assert.equal(s.status, 'playing');
  s.status = 'lost'; assert.equal(R.rewardFor(s), 0);
});
test('platform: malformed replay, excess ticks, masks and post-victory actions are rejected', () => {
  for (const input of [null, [], [{ mask: 16, frames: 1 }], [{ mask: -1, frames: 1 }], [{ mask: 1, frames: .5 }], [{ mask: 1, frames: 0 }], [{ mask: 1, frames: R.MAX_TICKS + 1 }], Array.from({length:1001}, () => ({mask:0,frames:1}))]) assert.equal(R.replay(input).ok, false);
  assert.equal(R.replay([...solution().inputs, { mask: 2, frames: 1 }]).reason, 'after_end');
  const loss = R.replay([{mask: 0, frames: R.MAX_TICKS}]); assert.equal(loss.state.status, 'lost');
});

test('platform: camera eases without overshoot, resets on teleport and honors reduced motion', () => {
  const camera = R.followCamera(0, 600, 1 / 60);
  assert.ok(camera > 0 && camera < 600);
  let next = camera;
  for (let i = 0; i < 120; i++) next = R.followCamera(next, 600, 1 / 60);
  assert.ok(Math.abs(next - 600) < .01);
  assert.equal(R.followCamera(600, 0, 1 / 60, true), 0);
  assert.equal(R.followCamera(undefined, 120, 0), 120);
  assert.equal(R.followCamera(100, 200, 0), 100);
  assert.equal(R.followCamera(100, 200, -1), 100);
});
