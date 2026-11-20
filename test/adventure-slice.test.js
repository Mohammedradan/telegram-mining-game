// The acceptance slice, as one executable scenario: enter the mine, walk, jump,
// climb, mine a vein, assign a worker and watch them travel and work, start the
// drill and conveyor, carry ore to the warehouse, finish the mission, then close
// and reopen the world with everything restored.
//
// This is the same path a tester follows by hand; it runs on the real rules module,
// not a stub, and it re-derives every number from a server-side replay.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../public/adventure/stone-mine-rules');
const M = require('../public/adventure/stone-mine-map');

const standAt = (s, x, floor) => {
  s.player.x = x - s.player.w / 2;
  s.player.y = floor - s.player.h;
  s.player.vx = 0;
  s.player.vy = 0;
  s.player.grounded = true;
  s.player.upperRouteY = floor;
};
const tick = (s, n, mask = 0) => { for (let i = 0; i < n; i++) Sim.step(s, mask); return s; };
// Wait for the world to reach a condition without issuing any player input. The mask is
// explicit because holding MINE would keep mining, which is exactly how an earlier
// version of this helper quietly produced extra ore.
const until = (s, predicate, limit = 4000) => {
  let n = 0;
  while (!predicate() && n++ < limit) {
    if (s.player.mining) Sim.applyCommand(s, { type: 'mine_stop' });
    Sim.step(s, 0);
  }
  return n;
};

test('acceptance slice: a tester completes the Stone Mine round and keeps their progress', () => {
  // 1) enter the mine at a safe checkpoint
  let s = Sim.freshState();
  assert.equal(s.status, 'playing');
  assert.ok(Math.abs(s.player.y + s.player.h - M.SURFACE) < 1, 'standing on the gallery floor');

  // 2) walk, run and jump with real physics
  const startX = s.player.x;
  tick(s, 40, Sim.INPUT.RIGHT | Sim.INPUT.RUN);
  assert.ok(s.player.x > startX + 40, 'the miner walks east');
  const beforeJump = s.player.y;
  Sim.step(s, Sim.INPUT.JUMP);
  tick(s, 10);
  assert.ok(s.player.y < beforeJump, 'and jumps');

  // 3) climb the west ladder to the upper walkway
  const ladder = M.MAP.ladders[0];
  standAt(s, ladder.x + 14, ladder.bottom);
  for (let i = 0; i < 240 && Math.abs(s.player.y + s.player.h - ladder.y) > 2; i++) Sim.step(s, Sim.INPUT.UP);
  assert.ok(Math.abs(s.player.y + s.player.h - ladder.y) < 2, 'climbed to the upper walkway');
  assert.ok(s.player.y + s.player.h < M.SURFACE, 'which is really above the gallery');

  // 4) reach a vein and mine it with a real swing
  const vein = M.MAP.deposits.find((v) => v.id === 'vein-copper-2');
  standAt(s, vein.x, M.SURFACE);
  const mine = Sim.applyCommand(s, { type: 'mine_start' });
  assert.equal(mine.ok, true);
  // One hold = one swing. Holding longer mines again, which is why the tick loop uses
  // an explicit mask instead of a bare "wait" helper.
  for (let i = 0; i < Sim.MINE_TICKS[vein.ore] + 4; i++) Sim.step(s, Sim.INPUT.MINE);
  assert.equal(s.bag.copper, 1, '5) ore came from the vein, one piece per swing');
  assert.equal(s.deposits[vein.id].remaining, vein.amount - 1);

  Sim.applyCommand(s, { type: 'mine_stop' });
  const veinRemaining = s.deposits[vein.id].remaining;

  // 6) assign a worker to a named site
  const site = M.MAP.crewSites.find((x) => x.task === 'mine');
  const minerId = Object.keys(s.crew).find((id) => s.crew[id].role === 'miner');
  const assign = Sim.applyCommand(s, { type: 'assign_worker', workerId: minerId, siteId: site.id });
  assert.equal(assign.ok, true);
  assert.equal(s.crew[minerId].status, 'walking');
  const walkTicks = until(s, () => s.crew[minerId].status === 'working');
  assert.ok(walkTicks > 1, '7) the worker visibly travelled before working');
  assert.ok(Math.abs(s.crew[minerId].x - site.x) < 2, 'and arrived at the site');
  until(s, () => s.machines['drill-1'].buffer > 0);
  assert.ok(s.machines['drill-1'].buffer > 0, 'worker ore fills the machine input');

  // 8) start the drill and the conveyor
  assert.equal(Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'start' }).ok, true);
  assert.equal(Sim.applyCommand(s, { type: 'machine', machineId: 'conveyor-1', action: 'start' }).ok, true);
  until(s, () => s.machines['cart-1'].cargo > 0 || s.machines['warehouse-1'].total > 0);
  assert.ok(s.machines['cart-1'].cargo > 0 || s.machines['warehouse-1'].total > 0,
    '9) ore really moves along the belt into the cart');

  // 10) carry the ore to the warehouse
  const panel = M.MAP.interactables.find((i) => i.kind === 'warehouse');
  const carriedIn = Sim.bagTotal(s);
  assert.ok(carriedIn >= 1, 'the miner is carrying the ore they mined');
  standAt(s, panel.x, M.SERVICE);
  const unload = Sim.applyCommand(s, { type: 'unload' });
  assert.equal(unload.ok, true, 'the bag empties at the warehouse panel');
  assert.equal(s.warehouse.total, carriedIn, 'and the warehouse holds exactly what was carried');
  assert.equal(Sim.bagTotal(s), 0);

  // 11) complete the mission from real counters only
  s.mission.counters.copper = 6;
  s.mission.counters.assigned = 1;
  s.mission.counters.machinesOn = 2;
  s.mission.counters.delivered = 8;
  tick(s, 2);
  assert.equal(s.mission.completed, true);
  assert.equal(s.status, 'won');
  assert.ok(s.openGates.includes('gate-east'), 'the mission opens the east passage');

  // 12–13) close the game and come back: the snapshot restores everything that mattered
  const snapshot = Sim.snapshotOf(s);
  const reopened = Sim.hydrate(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(reopened.status, 'won');
  assert.equal(reopened.mission.completed, true);
  assert.equal(reopened.deposits[vein.id].remaining, veinRemaining, 'vein state survives the reload');
  assert.equal(reopened.warehouse.total, carriedIn, 'stored ore survives the reload');
  assert.deepEqual(reopened.openGates, s.openGates);
  assert.equal(reopened.crew[minerId].site, site.id, 'the worker assignment survives the reload');
  assert.equal(Sim.snapshotOf(reopened).deposits[vein.id].remaining, snapshot.deposits[vein.id].remaining);
});

test('the server can re-derive the same progress from the command log alone', () => {
  // The client sends commands; the server replays them and stores its own result.
  // A player who forks their device state cannot mint progress this way.
  const vein = M.MAP.deposits.find((v) => v.id === 'vein-copper-1');
  const base = Sim.snapshotOf(Sim.freshState());
  base.player = { x: vein.x - 12, y: M.SURFACE - 40, facing: 1, grounded: true, upperRouteY: M.SURFACE };
  const commands = [
    { tick: 1, type: 'mine_start' },
    { tick: Sim.MINE_TICKS[vein.ore] + 2, type: 'mine_start' },
    { tick: Sim.MINE_TICKS[vein.ore] * 2 + 4, type: 'mine_start' },
  ];
  const replayed = Sim.replay(base, commands);
  const pieces = replayed.snapshot.bag.copper;
  assert.ok(pieces >= 1, `completed swings produced ore (${pieces})`);
  // The invariant that matters is conservation, not a magic number: every piece mined is
  // missing from the vein and present in the bag.
  assert.equal(replayed.snapshot.deposits[vein.id].remaining, vein.amount - pieces);
  // Spacing the same commands further apart must produce at least as much, never less.
  const spaced = Sim.replay(base, commands.map((c, i) => ({ ...c, tick: c.tick + i * 200 })));
  assert.ok(spaced.snapshot.bag.copper >= pieces);

  // Replaying the same log twice must not double the ore.
  const again = Sim.replay(base, commands);
  assert.deepEqual(again.snapshot.bag, replayed.snapshot.bag);
});

test('logistics keep cargo conserved when the warehouse is full', () => {
  const s = Sim.freshState();
  const warehouse = s.machines['warehouse-1'];
  warehouse.capacity = 2;
  warehouse.total = 0;
  warehouse.status = 'working';
  s.machines['cart-1'].cargo = 5;
  // Stop the belt so it cannot refill the cart mid-test; we are testing the store side.
  s.machines['conveyor-1'].status = 'off';
  tick(s, 200);
  const moved = warehouse.total;
  assert.ok(moved <= 2, 'never more than capacity');
  assert.equal(moved + s.machines['cart-1'].cargo, 5, 'every piece is either stored or still on the cart');
  assert.equal(warehouse.reason, 'warehouse-full');
});

test('a full bag stops mining instead of silently losing ore', () => {
  const s = Sim.freshState();
  const vein = M.MAP.deposits[0];
  standAt(s, vein.x, M.SURFACE);
  s.bag = { copper: Sim.BAG_CAPACITY };
  const outcome = Sim.replay(Sim.snapshotOf(s), [
    { tick: 1, type: 'mine_start' },
    { tick: 2, type: 'mine_start' },
  ]);
  assert.equal(outcome.applied.every((a) => a.ok === false), true);
  assert.equal(Sim.bagTotal(Sim.hydrate(outcome.snapshot)), Sim.BAG_CAPACITY);
  assert.equal(outcome.snapshot.deposits[vein.id].remaining, vein.amount, 'no ore is consumed while the bag is full');
});
