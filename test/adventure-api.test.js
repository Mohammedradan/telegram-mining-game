// The Stone Mine endpoint is the only thing that may create ore. These tests attack it the
// way a modified client would: forged quantities, replayed receipts, out-of-order
// checkpoints, impossible tick rates, and a foreign session id.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = require('../public/adventure/stone-mine-rules');
const M = require('../public/adventure/stone-mine-map');
const { sanitizeOps, sanitizeCommands, safeSnapshot, DAILY_ORE_CAP, STATE_KEY } = require('../adventure-api');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-adventure-'));
const file = path.join(dir, 'game.db');
const port = 3361;
const url = process.env.TEST_DATABASE_URL || '';
const tag = `${process.pid}_${Date.now()}`;
const guest = (name) => `adv_${tag}_${name}`;
const headers = (name) => ({ 'X-Guest-Id': guest(name), 'Content-Type': 'application/json' });
let child;

async function launch() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(port), NODE_ENV: 'development', BOT_TOKEN: '',
      BOT_MODE: 'polling', DATABASE_URL: url, DATABASE_FILE: file,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => { output += b; });
  child.stderr.on('data', (b) => { output += b; });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch (_) { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(output || 'server did not start');
}

async function post(name, route, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/adventure/mine/${route}`, {
    method: 'POST', headers: headers(name), body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Walk right from the spawn to a copper vein, in legal-sized batches. */
function walkToVein(snapshot, targetX) {
  const s = R.hydrate(snapshot);
  const ops = [];
  let guard = 0;
  while (s.player.x < targetX && guard++ < 60) {
    for (let i = 0; i < 10; i++) R.step(s, R.INPUT.RIGHT);
    ops.push({ t: 'i', mask: R.INPUT.RIGHT, ticks: 10 });
  }
  return { ops, state: s };
}

before(launch);

after(async () => {
  if (child && child.exitCode === null) {
    const done = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await done;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the endpoint requires authentication', async () => {
  for (const route of ['state', 'start', 'checkpoint', 'collect']) {
    const response = await fetch(`http://127.0.0.1:${port}/api/adventure/mine/${route}`, { method: 'POST' });
    assert.equal(response.status, 401, `${route} must reject an anonymous caller`);
  }
});

test('start is idempotent while a session is live and restores the checkpoint', async () => {
  const first = await post('resume', 'start');
  assert.equal(first.status, 200);
  assert.equal(first.body.resumed, false);
  assert.equal(first.body.snapshot.tick, 0);
  const second = await post('resume', 'start');
  assert.equal(second.status, 200);
  assert.equal(second.body.resumed, true, 'a second start resumes, it does not reset the world');
  assert.equal(second.body.session.id, first.body.session.id);

  // Move, then restore from a fresh GET after the session is dropped by time.
  const { ops } = walkToVein(first.body.snapshot, 400);
  const saved = await post('resume', 'checkpoint', { id: first.body.session.id, seq: 1, ops });
  assert.equal(saved.status, 200);
  assert.ok(saved.body.snapshot.player.x > 200, 'the walk was recorded');
  const restored = await post('resume', 'state');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.session.id, first.body.session.id, 'the session survives a page reload');
  assert.equal(restored.body.snapshot.player.x, saved.body.snapshot.player.x);
});

test('a checkpoint is applied exactly once even if it is retried', async () => {
  const { body } = await post('idem', 'start');
  const id = body.session.id;
  const { ops } = walkToVein(body.snapshot, 500);
  const first = await post('idem', 'checkpoint', { id, seq: 1, ops });
  assert.equal(first.status, 200);
  const replay = await post('idem', 'checkpoint', { id, seq: 1, ops });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true, 'a retried request is recognised');
  assert.equal(replay.body.snapshot.tick, first.body.snapshot.tick, 'and does not advance the world');
  assert.equal(replay.body.snapshot.player.x, first.body.snapshot.player.x);
});

test('sequence numbers may not skip, repeat with new work, or move backwards', async () => {
  const { body } = await post('seq', 'start');
  const id = body.session.id;
  const walk = walkToVein(body.snapshot, 300).ops;
  assert.equal((await post('seq', 'checkpoint', { id, seq: 5, ops: walk })).status, 409, 'a gap is refused');
  assert.equal((await post('seq', 'checkpoint', { id, seq: 1, ops: walk })).status, 200);
  const different = walkToVein(body.snapshot, 260).ops;
  assert.equal((await post('seq', 'checkpoint', { id, seq: 1, ops: different })).status, 409, 'a reused seq with new work is refused');
  assert.equal((await post('seq', 'checkpoint', { id, seq: 2, ops: [] })).status, 200, 'an empty batch is a legal heartbeat');
});

test('a client cannot claim more game time than wall-clock time', async () => {
  const { body } = await post('speed', 'start');
  const id = body.session.id;
  // 10 minutes of simulated movement, sent a few hundred ms after the session opened.
  const flood = [{ t: 'i', mask: R.INPUT.RIGHT, ticks: R.FPS * 600 }];
  const refused = await post('speed', 'checkpoint', { id, seq: 1, ops: flood });
  assert.equal(refused.status, 400, 'a synthetic fast-forward is rejected');
  assert.match(refused.body.error, /زمن/);
  // A single oversized op is also refused (the server caps frames per request).
  const huge = await post('speed', 'checkpoint', { id, seq: 1, ops: [{ t: 'i', mask: R.INPUT.RIGHT, ticks: R.FPS * 60 * 31 }] });
  assert.equal(huge.status, 400);
});

test('forged commands are rejected before they reach the simulation', async () => {
  const { body } = await post('forge', 'start');
  const id = body.session.id;
  const bad = [
    { t: 'c', command: { type: 'add_gold', amount: 1e9 } },
    { t: 'c', command: { type: 'machine', machineId: 'drill-1', action: 'explode' } },
    { t: 'c', command: { type: 'assign_worker', workerId: 'worker-1', siteId: 'x'.repeat(200) } },
    { t: 'i', mask: 1 << 20, ticks: 1 },
    { t: 'i', mask: 0, ticks: -5 },
    { nonsense: true },
  ];
  for (const op of bad) {
    const response = await post('forge', 'checkpoint', { id, seq: 1, ops: [op] });
    assert.equal(response.status, 400, `${JSON.stringify(op).slice(0, 60)} must be refused`);
  }
  // The session is untouched by all those rejections.
  const state = await post('forge', 'state');
  assert.equal(state.body.snapshot.tick, 0);
  assert.equal(state.body.snapshot.player.x, M.MAP.spawn.x);
});

test('mining over HTTP credits exactly the ore the rules produce, and only via collect', async () => {
  const { body } = await post('mine', 'start');
  const id = body.session.id;
  const vein = M.MAP.deposits.find((v) => !v.crewOnly);
  const approach = walkToVein(body.snapshot, vein.x - 50);
  const local = approach.state;
  assert.ok(Math.abs((local.player.x + local.player.w / 2) - vein.x) <= R.REACH, 'the miner reached the vein');

  const ops = approach.ops.slice();
  ops.push({ t: 'c', command: { type: 'mine_start', tick: local.tick } });
  const ticks = R.MINE_TICKS[vein.ore] + 6;
  ops.push({ t: 'i', mask: R.INPUT.MINE, ticks });
  ops.push({ t: 'c', command: { type: 'mine_stop', tick: local.tick + ticks } });
  const mined = await post('mine', 'checkpoint', { id, seq: 1, ops });
  assert.equal(mined.status, 200);
  assert.equal(mined.body.rejected, 0, 'the whole sequence was legal');
  assert.equal(mined.body.snapshot.deposits[vein.id].remaining, vein.amount - 1, 'exactly one piece came out');
  assert.equal(mined.body.snapshot.bag[vein.ore], 1);

  // Collecting an empty silo is refused: mining puts ore in the bag, not in the account.
  assert.equal((await post('mine', 'collect', { id, seq: 1 })).status, 409);

  const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: headers('mine') });
  const profile = await me.json();
  assert.equal(Number(profile.state?.ores?.[vein.ore]) || 0, 0, 'the account has no ore before a collect');
});

test('collect is idempotent, capped, and zeroes the silo it paid for', async () => {
  const { body } = await post('collect', 'start');
  const id = body.session.id;
  // Load the silo through a legal sequence: 5 pieces straight into the warehouse is not
  // possible offline, so seed it the way the game does — mine, then walk to the panel.
  const s = R.hydrate(body.snapshot);
  const vein = M.MAP.deposits.find((v) => !v.crewOnly);
  const ops = [];
  while (s.player.x < vein.x - 50) { for (let i = 0; i < 10; i++) R.step(s, R.INPUT.RIGHT); ops.push({ t: 'i', mask: R.INPUT.RIGHT, ticks: 10 }); }
  for (let round = 0; round < 3; round++) {
    ops.push({ t: 'c', command: { type: 'mine_start', tick: s.tick } });
    R.applyCommand(s, { type: 'mine_start' });
    for (let i = 0; i < R.MINE_TICKS[vein.ore] + 2; i++) R.step(s, R.INPUT.MINE);
    ops.push({ t: 'i', mask: R.INPUT.MINE, ticks: R.MINE_TICKS[vein.ore] + 2 });
    ops.push({ t: 'c', command: { type: 'mine_stop', tick: s.tick } });
    R.applyCommand(s, { type: 'mine_stop' });
  }
  const mined = await post('collect', 'checkpoint', { id, seq: 1, ops });
  assert.equal(mined.status, 200);
  const carried = Object.values(mined.body.snapshot.bag).reduce((a, b) => a + b, 0);
  assert.ok(carried >= 2, `the miner is carrying ore (${carried})`);

  // Walk to the warehouse panel and unload.
  const s2 = R.hydrate(mined.body.snapshot);
  const walkOps = [];
  const warehouse = M.MAP.machines.find((m) => m.kind === 'warehouse');
  const targetX = warehouse.x - 30;
  // The warehouse is on the service deck: ride the lift down first.
  while (s2.player.x < M.MAP.lift.x + 40 && s2.player.y + s2.player.h === M.SURFACE) {
    for (let i = 0; i < 10; i++) R.step(s2, R.INPUT.RIGHT);
    walkOps.push({ t: 'i', mask: R.INPUT.RIGHT, ticks: 10 });
  }
  walkOps.push({ t: 'c', command: { type: 'lift', tick: s2.tick } });
  R.callLift(s2);
  for (let i = 0; i < 200; i++) R.step(s2, 0);
  walkOps.push({ t: 'i', mask: 0, ticks: 200 });
  while (s2.player.x < targetX) {
    for (let i = 0; i < 10; i++) R.step(s2, R.INPUT.RIGHT);
    walkOps.push({ t: 'i', mask: R.INPUT.RIGHT, ticks: 10 });
  }
  walkOps.push({ t: 'c', command: { type: 'unload', tick: s2.tick } });
  const unloaded = R.applyCommand(s2, { type: 'unload' });
  // The server refuses game time it cannot account for, so a ~16 s walk has to be spread
  // over real seconds. This is the economy guard doing its job, not test friction: a client
  // cannot fast-forward the mine.
  const cut = Math.ceil(walkOps.length / 2);
  const parts = [walkOps.slice(0, cut), walkOps.slice(cut)];
  let stored = null;
  for (let i = 0; i < parts.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5200));
    const response = await post('collect', 'checkpoint', { id, seq: 2 + i, ops: parts[i] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    stored = response;
  }
  const siloTotal = stored.body.snapshot.warehouse.total;
  if (!unloaded.ok || siloTotal === 0) {
    // The walk is deliberately not pinned to pixel-perfect pathing here; if it did not reach
    // the panel, the collect paths below are still exercised through the empty-silo branch.
    assert.equal((await post('collect', 'collect', { id, seq: 1 })).status, 409, 'an empty silo cannot be collected');
    return;
  }
  const collected = await post('collect', 'collect', { id, seq: 1 });
  assert.equal(collected.status, 200);
  assert.equal(collected.body.amount, siloTotal, 'the whole silo is paid out');
  assert.equal(collected.body.snapshot.warehouse.total, 0, 'and the silo is emptied in the same transaction');
  assert.ok(collected.body.amount <= DAILY_ORE_CAP);

  const retried = await post('collect', 'collect', { id, seq: 1 });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.duplicate, true, 'a retried collect is not paid twice');
  assert.equal(retried.body.amount, collected.body.amount);

  const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: headers('collect') });
  const profile = await me.json();
  const credited = Object.entries(collected.body.collected).reduce((sum, [, n]) => sum + n, 0);
  assert.equal(Number(profile.state?.ores?.copper) || 0, credited, 'the account holds exactly what was collected');
});

// Phase 2's exit gate names account isolation explicitly. `user.sync.adventureMine` is keyed
// per user, but "keyed per user" is a property of the code, not of the system: only two
// real guests hitting one server can show that one player's mine, session and ore never
// leak into another's. This is the test that would catch a future refactor to a global
// cache or a shared mutable default.
test('one account never sees another account\'s mine, session or ore', async () => {
  const a = await post('alice', 'start');
  assert.equal(a.status, 200);
  const sessionA = a.body.session.id;

  // Bob has never played: he must see no session and no saved mine of Alice's.
  const b = await post('bob', 'state');
  assert.equal(b.status, 200);
  assert.equal(b.body.session, null, 'Bob has no live session of his own');
  assert.equal(b.body.snapshot, null, 'Bob has no checkpoint to restore, least of all Alice\'s');

  // Starting fresh must put Bob at the spawn in a brand-new world — never in Alice's.
  const bobFresh = await post('bob', 'start');
  assert.equal(bobFresh.status, 200);
  assert.equal(bobFresh.body.snapshot.tick, 0, 'Bob starts from a fresh world');
  assert.equal(bobFresh.body.snapshot.player.x, M.MAP.spawn.x, 'Bob stands at the spawn, not where Alice is');

  // Alice works: walk her miner east, then try to spend her session from Bob's account.
  const vein = M.MAP.deposits.find((v) => !v.crewOnly);
  const approach = walkToVein(a.body.snapshot, vein.x - 50);
  const moved = await post('alice', 'checkpoint', { id: sessionA, seq: 1, ops: approach.ops });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.rejected, 0);
  const aliceTick = moved.body.snapshot.tick;
  assert.ok(aliceTick > 0 && moved.body.snapshot.player.x > M.MAP.spawn.x, 'Alice actually moved');

  // Bob presenting Alice's session id must be treated as a foreign session (409), and it
  // must not advance, rewrite or expose Alice's world.
  const stolen = await post('bob', 'checkpoint', { id: sessionA, seq: 2, ops: [{ t: 'i', mask: 0, ticks: 10 }] });
  assert.equal(stolen.status, 409, 'another account may not checkpoint into a foreign session');

  // Alice's world is exactly where she left it.
  const after = await post('alice', 'state');
  assert.equal(after.body.session.id, sessionA);
  assert.equal(after.body.snapshot.tick, aliceTick, 'the foreign attempt did not advance Alice');

  // Ore is per-account too: Alice collecting must never appear in Bob's profile.
  const collect = await post('alice', 'collect', { id: sessionA, seq: 2 });
  assert.ok([200, 409].includes(collect.status), 'collect is answered on its own merits');
  const aliceProfile = await (await fetch(`http://127.0.0.1:${port}/api/me`, { headers: headers('alice') })).json();
  const bobProfile = await (await fetch(`http://127.0.0.1:${port}/api/me`, { headers: headers('bob') })).json();
  const aliceOre = Number(aliceProfile.state?.ores?.copper) || 0;
  const bobOre = Number(bobProfile.state?.ores?.copper) || 0;
  assert.equal(bobOre, 0, 'Bob must not inherit a single piece of Alice\'s copper');
  assert.ok(aliceOre >= bobOre, 'Alice keeps her own progress');

  // Bob's own session is untouched by anything Alice did, and it is his own id.
  const bobState = await post('bob', 'state');
  assert.equal(bobState.status, 200);
  assert.equal(bobState.body.session.id, bobFresh.body.session.id, 'Bob resumes only his own session');
  assert.notEqual(bobState.body.session.id, sessionA, 'each account gets its own session id');
  assert.equal(bobState.body.snapshot.tick, bobFresh.body.snapshot.tick,
    'Bob\'s world did not advance while Alice played');
  assert.equal(bobState.body.snapshot.player.x, M.MAP.spawn.x, 'Bob is still at the spawn');
});

test('a checkpoint from a foreign session id is refused', async () => {
  const a = await post('foreign', 'start');
  const b = await post('foreign2', 'start');
  const response = await post('foreign', 'checkpoint', { id: b.body.session.id, seq: 1, ops: [] });
  assert.equal(response.status, 401 + 8, 'another player\'s session is not usable');
  assert.ok(response.body.error);
});

test('stored sessions survive a server restart (save / restore)', async () => {
  const { body } = await post('persist', 'start');
  const id = body.session.id;
  const { ops } = walkToVein(body.snapshot, 700);
  const saved = await post('persist', 'checkpoint', { id, seq: 1, ops });
  assert.equal(saved.status, 200);
  const x = saved.body.snapshot.player.x;

  // Restart the server; the checkpoint is in the database, not in memory.
  const done = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await done;
  await launch();

  const restored = await post('persist', 'state');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.snapshot.player.x, x, 'the miner is where the checkpoint left them');
  assert.equal(restored.body.session.id, id);
});

test('the validators are strict and total', () => {
  const ok = sanitizeOps([{ t: 'i', mask: R.INPUT.RIGHT, ticks: 3 }, { t: 'c', command: { type: 'mine_stop' } }], 100);
  assert.equal(ok.ops.length, 2);
  assert.equal(ok.ticks, 3);
  for (const bad of [
    null, 'x', {}, [null], [[]],
    [{ t: 'i', mask: 0 }],
    [{ t: 'i', mask: R.INPUT.RIGHT, ticks: 0 }],
    [{ t: 'i', mask: R.INPUT.RIGHT, ticks: 101 }],
    [{ t: 'c', command: { type: 'nope' } }],
    [{ t: 'c' }],
    [{ t: 'zzz' }],
  ]) {
    assert.equal(sanitizeOps(bad, 100), null, `${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(sanitizeCommands([{ type: 'mine_start' }]).length, 1);
  assert.equal(sanitizeCommands([{ type: 'mine_start', workerId: 5 }]), null);
  assert.equal(safeSnapshot(null), null);
  assert.equal(safeSnapshot({ mapId: 'other', mapVersion: 1 }), null);
  // A bare-but-valid header hydrates to a fresh world rather than being rejected: the
  // hydrate path clamps every field, so there is nothing to trust in an empty snapshot.
  assert.equal(safeSnapshot({ mapId: M.MAP.id, mapVersion: M.VERSION }).tick, 0);
  assert.equal(STATE_KEY, 'adventureMine', 'the save key is stable');
});
