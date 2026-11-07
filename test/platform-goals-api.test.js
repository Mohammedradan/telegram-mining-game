// V6 API: الهدف يُثبَّت في تذكرة الخادم، ويُعاد تشغيل الجولة به، ونتيجته في الإيصال — بلا أي ذهب إضافي.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createStore } = require('../db');
const R = require('../public/platform-rules');
const solution = require('./fixtures/platform-solution.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-goals-'));
const file = path.join(dir, 'game.db'), url = process.env.TEST_DATABASE_URL || '';
const port = 3241;
let child, store;
const runId = `${process.pid}_${Date.now()}`;
const user = name => `goals_${runId}_${name}`;
const headers = name => ({ 'X-Guest-Id': user(name), 'Content-Type': 'application/json' });

async function launch() {
  child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BOT_TOKEN: '', BOT_MODE: 'polling', STARS_ENABLED: 'false', DATABASE_URL: url, DATABASE_FILE: file }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch (_) {}
    if (child.exitCode !== null) throw new Error(output);
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(output);
}
async function post(name, route, body = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/api/platform/${route}`, { method: 'POST', headers: headers(name), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
before(async () => {
  await launch();
  const oldFile = process.env.DATABASE_FILE, oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_FILE = file; process.env.DATABASE_URL = url; store = createStore();
  if (oldFile === undefined) delete process.env.DATABASE_FILE; else process.env.DATABASE_FILE = oldFile;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});
after(async () => {
  if (child?.exitCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await done; }
  await store?.close(); fs.rmSync(dir, { recursive: true, force: true });
});

// جولة سليمة مسجّلة في المخزن (بذرة الخادم ومسار حركات قانوني) كما يفعل عميل حقيقي
async function historical(name, goal, config = { zone: 0, goal, loadout: {} }, hero = 'miner') {
  await post(name, 'start', { zone: config.zone, goal });
  const id = crypto.randomUUID();
  const s = solution(R.seedFromId(id), hero, config);
  await store.withUsers([`guest_${user(name)}`], async () => {
    const active = await store.activePlatformRun(`guest_${user(name)}`);
    if (active) { active.status = 'expired'; await store.savePlatformRun(active); }
    await store.savePlatformRun({ id, user_id: `guest_${user(name)}`, version: R.VERSION, status: 'playing', config_json: JSON.stringify(config),
      started_at: Math.floor(Date.now() - s.state.tick / 60 * 1000 - 2000) });
  });
  return { id, inputs: s.inputs, state: s.state };
}

test('V6 API: the goal is validated, snapshotted with the run and returned to the client', async () => {
  const res = await post('snap', 'start', { goal: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.config.goal, 2);
  assert.equal(res.body.config.zone, 0);
  const row = await store.getPlatformRun(res.body.id);
  assert.equal(JSON.parse(row.config_json).goal, 2, 'the goal is persisted with the ticket');

  for (const bad of [3, -1, 1.5, '1', null]) {
    const r = await post('bad', 'start', { goal: bad });
    assert.equal(r.status, 400, `goal ${JSON.stringify(bad)} is refused`);
  }
  const noGoal = await post('bad', 'start', {});
  assert.equal(noGoal.status, 200, 'omitting the goal keeps the previous one (or defaults to 0)');
});

test('V6 API: changing the goal replaces the active run, while resume keeps the original snapshot', async () => {
  const first = await post('switch', 'start', { goal: 0 });
  const again = await post('switch', 'start', { goal: 1 });
  assert.notEqual(again.body.id, first.body.id, 'a different goal starts a different run');
  assert.equal(again.body.config.goal, 1);
  const resumed = await post('switch', 'start', { resume: true });
  assert.equal(resumed.body.id, again.body.id, 'resume does not restart or re-goal the run');
  assert.equal(resumed.body.config.goal, 1);
});

test('V6 API: the receipt reports the goal, the greedy/safe choice and the vein from the replay, not from the client', async () => {
  const run = await historical('receipt', 0);
  const res = await post('receipt', 'finish', { id: run.id, inputs: run.inputs, hero: 'miner', goal: 2, choice: 'rich' });
  assert.equal(res.status, 200);
  assert.equal(res.body.won, true);
  assert.equal(res.body.goal.id, 'ore', 'the goal comes from the ticket, a spoofed body goal is ignored');
  assert.equal(res.body.goal.name, 'جمع الخام');
  assert.equal(typeof res.body.goal.done, 'boolean');
  assert.equal(res.body.goal.target, R.oreTarget(0));
  assert.equal(res.body.choice, null, 'a bot that walks past the fork reports no choice');
  assert.equal(res.body.veinBroken, false);
  assert.equal(typeof res.body.oreWind, 'boolean');
  assert.equal(res.body.gold, R.rewardFor(run.state), 'the new content adds no gold above the same formula/cap');
  assert.ok(res.body.gold <= R.rewardCap(res.body.zone), 'V19.2: a win never exceeds its mine cap (content + completion bonus)');
  const ledger = await store.ledgerFor(`guest_${user('receipt')}`);
  const row = ledger.find(r => r.kind === 'platform_finish');
  assert.equal(row.detail.goal.id, 'ore', 'the audit ledger records the goal');
  assert.equal(typeof row.detail.goal.done, 'boolean');
});

test('V6 API: the verified goal is stored with the run result and duplicates stay reward-free', async () => {
  const run = await historical('dupe', 1);
  const first = await post('dupe', 'finish', { id: run.id, inputs: run.inputs, hero: 'miner' });
  assert.equal(first.status, 200);
  const replay = await post('dupe', 'finish', { id: run.id, inputs: run.inputs, hero: 'miner' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.gold, first.body.gold, 'the duplicate receipt carries the same gold, no second payout');
  assert.deepEqual(replay.body.goal, first.body.goal);
});
