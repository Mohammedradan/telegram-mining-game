'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MineMachineryClient = require('../public/mine-machinery-client');

function harness(responses = [], authenticated = true) {
  const calls = [], timers = new Map(), statuses = [], states = [], productions = [];
  let nextTimer = 1;
  const bridge = {
    async ready() {},
    user() { return authenticated ? 'player-1' : null; },
    async flush() {},
    async request(path, options = {}) {
      calls.push({ path, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response || {};
    },
  };
  const client = MineMachineryClient.create({
    bridge,
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    onStatus(message) { statuses.push(message); },
    onState(active, job) { states.push({ active, job }); },
    async onProduction(result) { productions.push(result); },
  });
  return { client, calls, timers, statuses, states, productions };
}

test('mine machinery starts a server shift for the selected unlocked mine and schedules a claim', async () => {
  const h = harness([{ job: { active: true, id: 'shift-1', zone: 3 } }]);
  const result = await h.client.start(3);
  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, '/api/mine-machinery/start');
  assert.equal(h.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { zone: 3 });
  assert.equal(h.client.inspect().active, true);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 60000);
});

test('mine machinery sync restores an existing server shift without starting another', async () => {
  const h = harness([{ job: { active: true, id: 'shift-2', zone: 1, nextOreInSeconds: 24 } }]);
  const result = await h.client.sync();
  assert.equal(result.job.active, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, '/api/mine-machinery/status');
  assert.equal(h.client.inspect().active, true);
  assert.equal([...h.timers.values()][0].ms, 24000);
  assert.equal(h.states.at(-1).active, true);
});

test('mine machinery claim accepts only the server production receipt and refreshes the wallet', async () => {
  const h = harness([
    { job: { active: true, id: 'shift-3', zone: 0 } },
    { produced: 2, ore: 'iron', daily: { produced: 2, cap: 120 }, job: { active: true, nextOreInSeconds: 60 } },
  ]);
  await h.client.start(0);
  await h.client.claim();
  assert.equal(h.calls[1].path, '/api/mine-machinery/claim');
  assert.equal(h.calls[1].options.method, 'POST');
  assert.equal(h.productions.length, 1);
  assert.equal(h.productions[0].produced, 2);
  assert.match(h.statuses.at(-1), /2/);
});

test('mine machinery stop cancels the timer and closes the server shift', async () => {
  const h = harness([
    { job: { active: true, id: 'shift-4', zone: 0 } },
    { produced: 0, ore: 'stone', job: { active: true, id: 'shift-4', zone: 0 } },
    { job: { active: false, id: 'shift-4', zone: 0 } },
  ]);
  await h.client.start(0);
  const result = await h.client.stop();
  assert.equal(result.ok, true);
  assert.equal(h.calls[1].path, '/api/mine-machinery/claim');
  assert.equal(h.calls[2].path, '/api/mine-machinery/stop');
  assert.equal(h.client.inspect().active, false);
  assert.equal(h.timers.size, 0);
});

test('mine machinery refuses server actions without an authenticated player', async () => {
  const h = harness([], false);
  const result = await h.client.start(0);
  assert.equal(result.ok, false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.client.inspect().active, false);
});
