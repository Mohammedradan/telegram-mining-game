const { test } = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../public/platform-rules');
const { mountMineMachinery, DAILY_ORE_CAP, PRODUCTION_INTERVAL_MS } = require('../mine-machinery-api');

function harness() {
  let clock = 1_800_000_000_000;
  const routes = new Map();
  const ledger = [];
  const user = {
    id: 'mine-worker', name: 'Miner',
    state: { ores: {}, equipment: {}, mines: { wins: [0, 0, 0, 0, 0, 0] } },
    sync: {}, revision: 0, updatedAt: clock,
  };
  const store = {
    async withUsers(_ids, work) { return work(); },
    async putUser() {},
    async appendLedger(_id, entries) { ledger.push(...entries); },
  };
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
  };
  const pass = (_req, _res, next) => next && next();
  const asyncRoute = fn => fn;
  mountMineMachinery({
    app, store, requireAuth: pass, rateLimit: () => pass, asyncRoute,
    prepare: async () => user, now: () => clock,
  });
  async function call(method, path, body = {}) {
    let status = 200, payload;
    const req = { player: { id: user.id }, body };
    const res = { status(code) { status = code; return this; }, json(value) { payload = value; return this; } };
    await routes.get(`${method} ${path}`)(req, res);
    return { status, body: payload };
  }
  return { call, user, ledger, advance(ms) { clock += ms; } };
}

test('mine machinery production is server-timed, persisted and ledgered once', async () => {
  const h = harness();
  const started = await h.call('POST', '/api/mine-machinery/start', { zone: 0, amount: 999999, elapsed: 999999 });
  assert.equal(started.status, 200);
  assert.equal(started.body.job.ore, Rules.MINES[0].tier.common);
  assert.equal((await h.call('POST', '/api/mine-machinery/claim', { amount: 999999 })).status, 409);
  h.advance(PRODUCTION_INTERVAL_MS * 3);
  const claim = await h.call('POST', '/api/mine-machinery/claim', { amount: 999999, ore: 'lava' });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.produced, 3);
  assert.equal(claim.body.ore, Rules.MINES[0].tier.common);
  assert.equal(h.user.state.ores[Rules.MINES[0].tier.common], 3);
  assert.equal(h.ledger.length, 1);
  assert.equal(h.ledger[0].detail.amount, 3);
  assert.equal((await h.call('POST', '/api/mine-machinery/claim')).status, 409);
});

test('mine machinery enforces a daily production cap and stops the shift', async () => {
  const h = harness();
  await h.call('POST', '/api/mine-machinery/start', { zone: 0 });
  h.user.sync.mineMachineryDay = new Date(1_800_000_000_000).toISOString().slice(0, 10);
  h.user.sync.mineMachineryProduced = DAILY_ORE_CAP - 1;
  h.advance(PRODUCTION_INTERVAL_MS * 4);
  const claim = await h.call('POST', '/api/mine-machinery/claim');
  assert.equal(claim.body.produced, 1);
  assert.equal(claim.body.daily.produced, DAILY_ORE_CAP);
  assert.equal((await h.call('POST', '/api/mine-machinery/stop')).status, 200);
  assert.equal((await h.call('POST', '/api/mine-machinery/claim')).status, 409);
});

test('mine machinery rejects locked mines and invalid zones', async () => {
  const h = harness();
  assert.equal((await h.call('POST', '/api/mine-machinery/start', { zone: 99 })).status, 400);
  const locked = await h.call('POST', '/api/mine-machinery/start', { zone: 5 });
  assert.equal(locked.status, 403);
});
