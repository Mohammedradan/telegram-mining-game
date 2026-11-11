'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../db');
const DeepDig = require('../public/deep-dig');
const { replayDeepDig } = require('../lib/deep-dig-replay');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-deep-dig-'));
const file = path.join(dir, 'game.db');
const port = 3247;
const url = process.env.TEST_DATABASE_URL || '';
const tag = `${process.pid}_${Date.now()}`;
const guest = (name) => `deep_dig_${tag}_${name}`;
const headers = (name) => ({ 'X-Guest-Id': guest(name), 'Content-Type': 'application/json' });
let child, store;

async function launch() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BOT_TOKEN: '',
      BOT_MODE: 'polling', DATABASE_URL: url, DATABASE_FILE: file },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => { output += b; });
  child.stderr.on('data', (b) => { output += b; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch (_) {}
    if (child.exitCode !== null) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(output || 'server did not start');
}

async function post(name, route, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/deep-dig/${route}`, {
    method: 'POST', headers: headers(name), body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  await launch();
  const oldFile = process.env.DATABASE_FILE, oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_FILE = file; process.env.DATABASE_URL = url;
  store = createStore();
  if (oldFile === undefined) delete process.env.DATABASE_FILE; else process.env.DATABASE_FILE = oldFile;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});

after(async () => {
  if (child && child.exitCode === null) {
    const done = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM'); await done;
  }
  await store?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Deep Dig API: requires authentication and issues a server-owned seed/equipment snapshot', async () => {
  const unauth = await fetch(`http://127.0.0.1:${port}/api/deep-dig/start`, { method: 'POST' });
  assert.equal(unauth.status, 401);
  const first = await post('ticket', 'start');
  const second = await post('ticket', 'start');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.id, second.body.id, 'active ticket is stable until explicitly settled or expired');
  assert.ok(Number.isInteger(first.body.seed) && first.body.seed > 0);
  assert.deepEqual(first.body.equipment, { pickaxe: 0, boots: 0, bag: 0, magnet: 0, drill: 0, robot: 0, luck: 0, armor: 0 });
});

test('Deep Dig API: rejects unfinished, malformed, and foreign sessions without crediting ores', async () => {
  const ticket = await post('reject', 'start');
  assert.equal(ticket.status, 200);
  assert.equal((await post('reject', 'finish', { id: ticket.body.id, frames: [] })).status, 400);
  assert.equal((await post('reject', 'finish', { id: ticket.body.id, frames: [{ dx: 9, dy: 0 }] })).status, 400);
  assert.equal((await post('intruder', 'finish', { id: ticket.body.id, frames: [{ dx: 0, dy: 0 }] })).status, 404);
  const saved = await store.getUser(`guest_${guest('reject')}`);
  assert.deepEqual(saved.state.ores, { copper: 0, iron: 0, gold: 0, crystal: 0, lava: 0 });
  assert.equal((await store.getDeepDigRun(ticket.body.id)).status, 'playing');
});

