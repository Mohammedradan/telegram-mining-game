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
  // قوة تعدين عادية (1): عامل المنجم يملك قوة 3 ويُختبر تفوقه في اختبار التوازن
  const s = R.create(); s.player.miningPower = 1; s.player.miningReach = 54; advance(s, 8, 45); assert.equal(s.mined, 0); // too far
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
test('platform: the exit unlocks only after mining and collecting three gems; failure gives no reward', () => {
  const s = R.create();
  assert.equal(R.canExit(s), false);
  s.collected = 3; assert.equal(R.canExit(s), false, 'gems alone do not unlock the exit');
  s.mined = 1; assert.equal(R.canExit(s), true, 'one mined rock and three gems unlock the exit');
  s.player.x = 2540; R.step(s, 0); assert.equal(s.status, 'won');
  const lost = R.create(); lost.status = 'lost'; assert.equal(R.rewardFor(lost), 0);
});
test('platform: malformed replay, excess ticks, masks and post-victory actions are rejected', () => {
  for (const input of [null, [], [{ mask: 64, frames: 1 }], [{ mask: -1, frames: 1 }], [{ mask: 1, frames: .5 }], [{ mask: 1, frames: 0 }], [{ mask: 1, frames: R.MAX_TICKS + 1 }], Array.from({length:1001}, () => ({mask:0,frames:1}))]) assert.equal(R.replay(input).ok, false);
  assert.equal(R.replay([...solution().inputs, { mask: 2, frames: 1 }]).reason, 'after_end');
  const loss = R.replay([{mask: 0, frames: R.MAX_TICKS}]); assert.equal(loss.state.status, 'lost');
});

test('platform combat: attack damages enemies with cooldown and knockback; mine action does not damage enemies', () => {
  const s = R.create();
  // Stand within melee range of goblin 1 (at x: 290, y: 198) without touching
  s.player.x = 245; s.player.y = 192; s.player.grounded = true; s.player.facing = 1;
  const goblin = s.enemies.find(e => e.id === 1);
  assert.ok(goblin);
  assert.equal(goblin.hp, 2);

  // MINE action (8) against enemy does not reduce enemy hp
  R.step(s, R.INPUT.MINE);
  assert.equal(goblin.hp, 2, 'mine action must not damage enemies');

  // Wait out cooldown while staying outside collision
  s.player.x = 245; s.player.y = 192; goblin.x = 290;
  advance(s, 0, 15);

  // ATTACK action (16) damages enemy
  s.player.x = 245; s.player.y = 192; goblin.x = 290;
  R.step(s, R.INPUT.ATTACK);
  assert.equal(goblin.hp, 1, 'attack action damages enemy');
  assert.ok(goblin.hurtCooldown > 0);
  assert.equal(s.events.some(e => e.type === 'hit'), true);

  // Second attack after cooldown defeats enemy
  s.player.x = 245; s.player.y = 192; goblin.x = 290;
  advance(s, 0, 15);
  s.player.x = 245; s.player.y = 192; goblin.x = 290;
  R.step(s, R.INPUT.ATTACK);
  assert.equal(goblin.hp, 0);
  assert.equal(goblin.dead, true);
  assert.equal(s.defeated, 1);
  assert.equal(s.events.some(e => e.type === 'enemy_death'), true);
});

test('platform characters: warrior has higher hearts and damage; archer fires projectiles', () => {
  const miner = R.create('miner');
  assert.equal(miner.player.hearts, 3);
  assert.equal(miner.player.damage, 1);

  const warrior = R.create('warrior');
  assert.equal(warrior.player.hearts, 4);
  assert.equal(warrior.player.damage, 2);

  const archer = R.create('archer');
  assert.equal(archer.player.hearts, 3);
  assert.equal(archer.projectiles.length, 0);
  // Archer attack spawns projectile arrow
  R.step(archer, R.INPUT.ATTACK);
  assert.equal(archer.projectiles.length, 1);
  assert.ok(archer.projectiles[0].vx > 0);
  // Projectile advances with DT
  const p0 = archer.projectiles[0].x;
  R.step(archer, 0);
  assert.ok(archer.projectiles[0].x > p0);
});

test('platform skills: miner ground slam damages enemies in area with cooldown', () => {
  const s = R.create('miner');
  s.player.x = 280; s.player.y = 196;
  const goblin = s.enemies.find(e => e.id === 1);
  assert.equal(s.player.skillCooldown, 0);
  R.step(s, R.INPUT.SKILL);
  assert.ok(s.player.skillCooldown > 0);
  assert.equal(goblin.hp, 0, 'miner slam deals 2 damage defeating 2 HP goblin');
  assert.equal(goblin.dead, true);
});

test('platform enemy AI: patrols bounds, detects nearby player, and damages player on contact', () => {
  const s = R.create();
  const goblin = s.enemies.find(e => e.id === 1);
  const startX = goblin.x;
  // Patrol step
  R.step(s, 0);
  assert.notEqual(goblin.x, startX, 'goblin moves during patrol');

  // Place player right at goblin position to test enemy attacking player
  s.player.x = goblin.x; s.player.y = goblin.y; s.player.invulnerable = 0;
  const hpBefore = s.player.hearts;
  R.step(s, 0);
  assert.equal(s.player.hearts, hpBefore - 1, 'enemy deals 1 heart damage to player on contact');
  assert.ok(goblin.attackCooldown > 0);
});

test('platform projectiles: archer arrows collide with solids and despawn', () => {
  const s = R.create('archer');
  // Fire arrow toward rock 0 (at x: 440) from 140px away
  s.player.x = 300; s.player.y = 262; s.player.facing = 1;
  R.step(s, R.INPUT.ATTACK);
  assert.equal(s.projectiles.length, 1);
  // Advance until arrow hits rock
  for (let i = 0; i < 25; i++) R.step(s, 0);
  assert.equal(s.projectiles.length, 0, 'arrow despawned upon hitting solid rock');
});

test('platform health and death: zero hearts sets lost status, dead pose, and halts physics', () => {
  const s = R.create();
  s.player.hearts = 1; s.player.invulnerable = 0;
  s.player.x = 1195; s.player.y = 262; // hazard position
  R.step(s, 0);
  assert.equal(s.player.hearts, 0);
  assert.equal(s.status, 'lost');
  assert.equal(s.player.pose, 'dead');
  // Subsequent steps do nothing
  const tickAtDeath = s.tick;
  R.step(s, R.INPUT.RIGHT);
  assert.equal(s.tick, tickAtDeath);
});

test('platform seeds: each run id yields its own layout; the legal controller wins every layout; foreign paths do not', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => R.seedFromId(`run-${i}`));
  const layouts = new Set(seeds.map(seed => JSON.stringify(R.layoutFor(seed).rocks.map(r => r.x))));
  assert.ok(layouts.size >= 38, 'rock layouts vary between runs');
  let foreignWins = 0;
  for (const [i, seed] of seeds.entries()) {
    const own = solution(seed);
    assert.equal(own.state.status, 'won', `seed ${seed}`);
    assert.deepEqual(R.replay(own.inputs, 'miner', seed).state, own.state);
    const other = R.replay(own.inputs, 'miner', seeds[(i + 1) % seeds.length]);
    if (other.ok && other.state.status === 'won') foreignWins++;
  }
  assert.ok(foreignWins <= 2, `recorded paths replayed on other layouts won ${foreignWins}/40 times`);
  assert.equal(R.seedFromId('abc'), R.seedFromId('abc'));
  assert.deepEqual(R.create('miner', 7), R.create('miner', 7));
});

test('platform balance: each hero has a distinct, measurable advantage', () => {
  const C = R.CHARACTERS;
  // Miner: breaks a rock in one swing with longer reach
  assert.ok(C.miner.miningPower >= 3 && C.miner.miningReach > C.warrior.miningReach);
  const m = R.create('miner'); m.player.x = 440 - 24 - 60; R.step(m, R.INPUT.MINE);
  assert.equal(m.mined, 1, 'miner reaches and breaks the rock from 60px');
  const w = R.create('warrior'); w.player.x = 440 - 24 - 60; R.step(w, R.INPUT.MINE);
  assert.equal(w.mined, 0);
  // Warrior: most hearts, double damage, longest post-hit protection, but slower
  assert.ok(C.warrior.hearts > C.miner.hearts && C.warrior.damage > C.miner.damage && C.warrior.hurtInvulnerable > 90);
  assert.ok(C.warrior.speed < C.miner.speed);
  // Archer: real range — an arrow kills a bat-sized target 200px away, melee cannot
  assert.ok(C.archer.attackRange >= 200 && C.archer.speed > C.miner.speed);
  const a = R.create('archer'); a.enemies = [{ ...a.enemies[0], x: a.player.x + 200, y: a.player.y + 4, minX: 0, maxX: 9999, patrolSpeed: 0, vx: 0, hp: 1 }];
  R.step(a, R.INPUT.ATTACK); for (let i = 0; i < 40; i++) R.step(a, 0);
  assert.equal(a.defeated, 1);
  const melee = R.create('warrior'); melee.enemies = [{ ...melee.enemies[0], x: melee.player.x + 200, y: melee.player.y + 4, patrolSpeed: 0, vx: 0 }];
  R.step(melee, R.INPUT.ATTACK); assert.equal(melee.defeated, 0);
});
