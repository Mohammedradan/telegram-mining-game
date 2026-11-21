// Gameplay rules for the Stone Mine slice. Everything here is deterministic and free
// of DOM/network code, so the same assertions prove the browser and the server agree.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../public/adventure/stone-mine-rules');
const M = require('../public/adventure/stone-mine-map');

const run = (s, ticks, mask = 0) => { for (let i = 0; i < ticks; i++) Sim.step(s, mask); return s; };
const standAt = (s, x, floor) => {
  s.player.x = x - s.player.w / 2;
  s.player.y = floor - s.player.h;
  s.player.vx = 0;
  s.player.vy = 0;
  s.player.grounded = true;
  s.player.upperRouteY = floor;
};

test('a fresh mine starts at the checkpoint with an intact mission', () => {
  const s = Sim.freshState();
  assert.equal(s.status, 'playing');
  assert.equal(s.player.x, M.MAP.spawn.x);
  assert.ok(Math.abs(s.player.y + s.player.h - M.SURFACE) < 1, 'feet rest on the gallery floor');
  assert.equal(s.mission.completed, false);
  assert.equal(Sim.bagTotal(s), 0);
  assert.equal(s.warehouse.total, 0);
  assert.deepEqual(s.openGates, []);
  assert.equal(Object.keys(s.deposits).length, M.MAP.deposits.length);
  assert.ok(Object.values(s.deposits).every((d) => d.remaining > 0 && d.state === 'intact'));
});

test('gravity lands the miner instead of leaving them floating', () => {
  const s = Sim.freshState();
  s.player.y = 120;
  s.player.grounded = false;
  run(s, 180);
  assert.equal(s.player.grounded, true);
  assert.ok(Math.abs(s.player.y + s.player.h - M.SURFACE) < 1.5);
});

test('jumping leaves the ground and comes back to it', () => {
  const s = Sim.freshState();
  standAt(s, 600, M.SURFACE);
  let peak = s.player.y;
  Sim.step(s, Sim.INPUT.JUMP);
  for (let i = 0; i < 70; i++) {
    Sim.step(s, 0);
    peak = Math.min(peak, s.player.y);
  }
  assert.ok(peak < M.SURFACE - s.player.h - 40, `the jump really rises (${(M.SURFACE - s.player.h - peak).toFixed(0)}px)`);
  assert.equal(s.player.grounded, true, 'and lands again');
});

test('a ladder climbs to the upper walkway and stops exactly on it', () => {
  const s = Sim.freshState();
  const ladder = M.MAP.ladders[0];
  standAt(s, ladder.x + 14, ladder.bottom);
  for (let i = 0; i < 240; i++) Sim.step(s, Sim.INPUT.UP);
  assert.ok(Math.abs(s.player.y + s.player.h - ladder.y) < 1.5, `arrived at the ledge (${s.player.y})`);
  assert.equal(s.player.grounded, true);
});

test('mining requires proximity and yields exactly one piece per completed swing', () => {
  const s = Sim.freshState();
  const vein = M.MAP.deposits.find((v) => v.id === 'vein-copper-1');
  standAt(s, vein.x + 120, M.SURFACE);
  assert.deepEqual(Sim.applyCommand(s, { type: 'mine_start' }), { ok: false, reason: 'no-vein' },
    'a miner far from the vein cannot start');

  standAt(s, vein.x, M.SURFACE);
  assert.equal(Sim.applyCommand(s, { type: 'mine_start' }).ok, true);
  const needed = Sim.MINE_TICKS[vein.ore];
  run(s, needed - 1);
  assert.equal(s.bag.copper || 0, 0, 'no ore before the swing completes');
  run(s, 1);
  assert.equal(s.bag.copper, 1, 'exactly one piece after one full swing');
  assert.equal(s.deposits[vein.id].remaining, vein.amount - 1);
});

test('walking away cancels an unfinished swing', () => {
  const s = Sim.freshState();
  const vein = M.MAP.deposits[0];
  standAt(s, vein.x, M.SURFACE);
  Sim.applyCommand(s, { type: 'mine_start' });
  run(s, 5);
  run(s, 40, Sim.INPUT.LEFT | Sim.INPUT.RUN);
  assert.equal(s.player.mining, null, 'the swing was cancelled by movement');
  assert.equal(Sim.bagTotal(s), 0);
});

test('a vein runs out and stops producing, and the gallery stays walkable', () => {
  const s = Sim.freshState();
  const vein = M.MAP.deposits.find((v) => !v.crewOnly);
  standAt(s, vein.x, M.SURFACE);
  let guard = 0;
  while (s.deposits[vein.id].remaining > 0 && guard++ < 400) {
    Sim.applyCommand(s, { type: 'mine_start' });
    run(s, Sim.MINE_TICKS[vein.ore]);
  }
  assert.equal(s.deposits[vein.id].remaining, 0);
  assert.equal(s.deposits[vein.id].state, 'depleted');
  assert.equal(s.bag[vein.ore], vein.amount);
  // Veins are targets, never collision bodies: a solid vein could seal the only gallery
  // route past it, and the miner had to jump over the rock they were about to mine.
  assert.equal(s.rocks.length, 0, 'no vein is a solid body at any point in its life');
  assert.equal(Sim.applyCommand(s, { type: 'mine_start' }).ok, false, 'a depleted vein rejects mining');
});

test('the bag has a hard capacity', () => {
  const s = Sim.freshState();
  const vein = M.MAP.deposits[0];
  standAt(s, vein.x, M.SURFACE);
  s.bag = { copper: Sim.BAG_CAPACITY };
  s.player.carrying = Sim.BAG_CAPACITY;
  assert.deepEqual(Sim.applyCommand(s, { type: 'mine_start' }), { ok: false, reason: 'bag-full' });
});

test('a locked vein refuses mining until its gate opens', () => {
  const s = Sim.freshState();
  const locked = M.MAP.deposits.find((v) => v.requires === 'gate-east');
  standAt(s, locked.x, M.SURFACE);
  assert.deepEqual(Sim.applyCommand(s, { type: 'mine_start' }), { ok: false, reason: 'locked' });
});

test('the lift carries a rider between floors instead of teleporting the world', () => {
  const s = Sim.freshState();
  standAt(s, M.MAP.lift.x + M.MAP.lift.w / 2, M.SURFACE);
  assert.equal(Sim.onLift(s), true, 'standing in the cabin');
  const call = Sim.applyCommand(s, { type: 'lift' });
  assert.equal(call.ok, true);
  assert.equal(call.action, 'ride');
  assert.equal(s.lift.target, M.SERVICE);
  run(s, 300);
  assert.equal(s.lift.y, M.SERVICE, 'the cabin reached the service deck');
  assert.ok(Math.abs(s.player.y + s.player.h - M.SERVICE) < 1.5, 'and the player rode with it');
});

test('calling the lift from a landing only works on a real stop', () => {
  const s = Sim.freshState();
  s.lift.y = M.VAULT;
  s.lift.target = M.VAULT;
  standAt(s, 600, M.SURFACE);
  const call = Sim.applyCommand(s, { type: 'lift' });
  assert.equal(call.ok, true);
  assert.equal(call.action, 'call');
  assert.equal(s.lift.target, M.SURFACE);
  standAt(s, 600, 500); // mid-air position that is not a stop
  assert.equal(Sim.applyCommand(s, { type: 'lift' }).ok, false);
});

test('assigning a worker walks them to the site and only then starts work', () => {
  const s = Sim.freshState();
  const site = M.MAP.crewSites.find((x) => x.task === 'mine');
  const workerId = Object.keys(s.crew).find((id) => s.crew[id].role === 'miner');
  const result = Sim.applyCommand(s, { type: 'assign_worker', workerId, siteId: site.id });
  assert.equal(result.ok, true);
  assert.equal(s.crew[workerId].status, 'walking', 'walking first — not working');
  let ticks = 0;
  while (s.crew[workerId].status === 'walking' && ticks++ < 1200) Sim.step(s, 0);
  assert.equal(s.crew[workerId].status, 'working', 'arrived and started');
  assert.ok(Math.abs(s.crew[workerId].x - site.x) < 2);
  assert.ok(s.crew[workerId].progress < 5, 'work has only just begun on the arrival tick');
});

test('a worker with no path becomes blocked and never produces', () => {
  const s = Sim.freshState();
  const workerId = Object.keys(s.crew)[0];
  // Send a gallery worker to a service-deck site with no ladder in between.
  s.crew[workerId].x = 1500;
  s.crew[workerId].y = M.SURFACE;
  s.crew[workerId].status = 'walking';
  s.crew[workerId].target = { x: 1880, y: M.SERVICE };
  run(s, 2400);
  assert.equal(s.crew[workerId].status, 'blocked');
  assert.equal(s.crew[workerId].reason, 'no-path');
  assert.equal(s.crew[workerId].progress, 0, 'a blocked worker produces nothing');
});

test('worker mining feeds the drill buffer instead of the player bag', () => {
  const s = Sim.freshState();
  const site = M.MAP.crewSites.find((x) => x.task === 'mine');
  const workerId = Object.keys(s.crew).find((id) => s.crew[id].role === 'miner');
  Sim.applyCommand(s, { type: 'assign_worker', workerId, siteId: site.id });
  run(s, 2400);
  assert.equal(s.crew[workerId].status, 'working');
  assert.ok(s.machines['drill-1'].buffer > 0, 'worker ore lands in the machine input');
  assert.equal(Sim.bagTotal(s), 0, 'and not in the miner bag');
});

test('the drill produces only with energy, and blocks visibly when empty', () => {
  const s = Sim.freshState();
  assert.equal(Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'start' }).ok, true);
  const spec = M.MAP.machines.find((m) => m.id === 'drill-1');
  run(s, 1);
  assert.equal(s.machines['drill-1'].status, 'working');
  s.machines['drill-1'].energy = 0;
  run(s, 2);
  assert.equal(s.machines['drill-1'].status, 'blocked');
  assert.equal(s.machines['drill-1'].reason, 'no-energy');
  run(s, 90);
  assert.ok(s.machines['drill-1'].energy > 3, `energy regenerates while idle (${s.machines['drill-1'].energy.toFixed(2)})`);
  assert.equal(s.machines['drill-1'].status, 'working', 'and work resumes');
  assert.ok(spec.rateTicks > 0);
});

test('the conveyor moves real cargo and stops when the cart is full', () => {
  const s = Sim.freshState();
  Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'start' });
  Sim.applyCommand(s, { type: 'machine', machineId: 'conveyor-1', action: 'start' });
  s.machines['drill-1'].buffer = 4;
  run(s, 400);
  // The hand-off is continuous, so assert on the chain rather than on the exact tick a
  // piece sits on the belt: what entered the belt must now be in the cart.
  assert.equal(s.machines['conveyor-1'].cargo, 0, 'the belt handed its cargo on');
  assert.ok(s.machines['cart-1'].cargo > 0, 'and the cart really received it');
  // Backpressure: a cart that cannot drain stops the belt with a visible reason.
  const warehouse = s.machines['warehouse-1'];
  warehouse.status = 'blocked';
  warehouse.reason = 'warehouse-full';
  s.machines['cart-1'].cargo = Sim.CARRY_CAPACITY;
  s.machines['conveyor-1'].cargo = 2;
  run(s, 3);
  assert.equal(s.machines['conveyor-1'].status, 'blocked');
  assert.equal(s.machines['conveyor-1'].reason, 'cart-full', 'backpressure is visible, not silent');
  assert.ok(s.machines['conveyor-1'].cargo <= 8, 'and the belt never exceeds its capacity');
});

test('the warehouse rejects an over-capacity delivery instead of losing cargo', () => {
  const s = Sim.freshState();
  const warehouse = s.machines['warehouse-1'];
  warehouse.capacity = 10;
  warehouse.total = 10;
  warehouse.status = 'working';
  s.machines['cart-1'].cargo = 4;
  run(s, 120);
  assert.equal(warehouse.total, 10, 'the total never exceeds capacity');
  assert.equal(s.machines['cart-1'].cargo, 4, 'the cargo is still on the cart — nothing vanished');
  assert.equal(warehouse.status, 'blocked');
  assert.equal(warehouse.reason, 'warehouse-full');
});

test('unloading the player bag needs the warehouse panel and updates the mission', () => {
  const s = Sim.freshState();
  const panel = M.MAP.interactables.find((i) => i.kind === 'warehouse');
  standAt(s, panel.x, M.SERVICE);
  assert.deepEqual(Sim.applyCommand(s, { type: 'unload' }), { ok: false, reason: 'empty' });
  s.bag = { copper: 5 };
  assert.equal(Sim.applyCommand(s, { type: 'unload' }).ok, true);
  assert.equal(s.warehouse.total, 5);
  assert.equal(s.mission.counters.delivered, 5);
  assert.equal(Sim.bagTotal(s), 0);
  standAt(s, 400, M.SURFACE);
  s.bag = { copper: 2 };
  assert.deepEqual(Sim.applyCommand(s, { type: 'unload' }), { ok: false, reason: 'not-here' });
});

test('gates open from real progress only', () => {
  const s = Sim.freshState();
  run(s, 6);
  assert.deepEqual(s.openGates, [], 'no gate opens on its own');
  s.mission.counters.copper = 6;
  run(s, 2);
  assert.ok(s.openGates.includes('gate-east'));
  s.mission.counters.delivered = 8;
  run(s, 2);
  assert.ok(s.openGates.includes('gate-deep'));
});

test('the mission completes only when every step is met', () => {
  const s = Sim.freshState();
  s.mission.counters = { copper: 6, assigned: 1, machinesOn: 2, delivered: 8 };
  run(s, 2);
  assert.equal(s.mission.completed, true);
  assert.equal(s.status, 'won');
  run(s, 10); // stepping stops after the win
  assert.equal(s.status, 'won');
});

test('the discoverable cache records a discovery and refuses a duplicate claim', () => {
  const s = Sim.freshState();
  const secret = M.MAP.secrets[0];
  standAt(s, secret.x, secret.y + 40);
  assert.equal(Sim.applyCommand(s, { type: 'inspect' }).ok, true);
  assert.deepEqual(s.secrets, [secret.id]);
  assert.equal(Sim.applyCommand(s, { type: 'inspect' }).ok, false);
});

test('unknown or malformed commands are rejected, not applied', () => {
  const s = Sim.freshState();
  assert.equal(Sim.applyCommand(s, { type: 'give_gold', amount: 9e9 }).ok, false);
  assert.equal(Sim.applyCommand(s, null).ok, false);
  assert.equal(Sim.applyCommand(s, { type: 'machine', machineId: 'nope', action: 'start' }).ok, false);
  assert.equal(Sim.applyCommand(s, { type: 'assign_worker', workerId: 'nope', siteId: 'site-mine-a' }).ok, false);
  assert.equal(s.stats.rejected, 4);
  assert.equal(s.warehouse.total, 0);
});

test('a snapshot round-trips through hydrate without inventing progress', () => {
  const s = Sim.freshState();
  standAt(s, M.MAP.deposits[0].x, M.SURFACE);
  s.deposits[M.MAP.deposits[0].id].remaining = 3;
  s.deposits[M.MAP.deposits[0].id].mined = 9;
  s.bag = { copper: 4, iron: 2 };
  s.warehouse.stored = { copper: 7 };
  s.warehouse.total = 7;
  s.openGates = ['gate-east'];
  s.secrets = [M.MAP.secrets[0].id];
  const snap = Sim.snapshotOf(s);
  const back = Sim.hydrate(snap);
  assert.equal(back.deposits[M.MAP.deposits[0].id].remaining, 3);
  assert.equal(back.bag.copper, 4);
  assert.equal(back.warehouse.total, 7);
  assert.deepEqual(back.openGates, ['gate-east']);
  assert.deepEqual(back.secrets, [M.MAP.secrets[0].id]);
  assert.equal(back.rocks.length, 0, 'hydrate never invents vein solids');
});

test('a forged snapshot cannot exceed the map ceilings', () => {
  const bad = {
    mapVersion: M.VERSION,
    bag: { copper: 99999, iron: -5 },
    warehouse: { stored: { copper: 999999 } },
    deposits: { [M.MAP.deposits[0].id]: { remaining: 99999, mined: 99999 } },
    mission: { counters: { copper: 1e12, delivered: -3 }, completed: true },
    tick: 1e12,
  };
  const s = Sim.hydrate(bad);
  assert.ok(Sim.bagTotal(s) <= Sim.BAG_CAPACITY, 'bag capacity is enforced on hydrate');
  assert.ok(s.warehouse.total <= s.warehouse.capacity, 'warehouse capacity is enforced on hydrate');
  const ceiling = M.MAP.deposits[0].amount;
  assert.ok(s.deposits[M.MAP.deposits[0].id].remaining <= ceiling);
  assert.ok(s.tick <= Sim.MAX_TICKS);
  assert.equal(s.bag.iron, 0, 'negative input floors at zero');
});

test('replay is deterministic and reproduces the same snapshot', () => {
  const vein = M.MAP.deposits[0];
  const start = Sim.snapshotOf(Sim.hydrate({
    ...Sim.snapshotOf(Sim.freshState()),
    player: { x: vein.x - 12, y: M.SURFACE - 40, facing: 1, grounded: true },
  }));
  const commands = [
    { tick: 2, type: 'mine_start' },
    { tick: 40, type: 'machine', machineId: 'drill-1', action: 'start' },
    { tick: 60, type: 'mine_stop' },
  ];
  const first = Sim.replay(start, commands);
  const second = Sim.replay(start, commands);
  assert.deepEqual(first.snapshot, second.snapshot, 'same inputs, same world');
  assert.ok(first.applied.some((a) => a.ok), 'at least one command applied');
  // Counters are diagnostics, not economy: they are stored but never granted.
  assert.equal(typeof first.snapshot.stats.mined, 'number');
});

test('replay applies commands in order and reports rejections', () => {
  const start = Sim.snapshotOf(Sim.freshState());
  const outcome = Sim.replay(start, [
    { tick: 1, type: 'machine', machineId: 'drill-1', action: 'repair' },   // not broken
    { tick: 2, type: 'machine', machineId: 'drill-1', action: 'start' },
    { tick: 3, type: 'bogus' },
  ]);
  assert.deepEqual(outcome.applied.map((a) => a.ok), [false, true, false]);
  assert.equal(outcome.state.machines['drill-1'].status, 'working');
});

test('time cannot go backwards between commands', () => {
  const start = Sim.snapshotOf(Sim.freshState());
  const outcome = Sim.replay(start, [
    { tick: 500, type: 'mine_start' },
    { tick: 10, type: 'mine_start' },   // out of order
  ]);
  assert.ok(outcome.snapshot.tick >= 500, 'the tick never regresses');
});

/* ------------------------------------------------------------------ wear, breakage, repair */

test('a machine wears out while working and seizes at its limit', () => {
  const s = Sim.freshState();
  s.script.seize.fired = true;        // suppress the scripted beat; this is raw wear
  assert.equal(s.machines['drill-1'].wear, 0, 'a new drill is unworn');
  Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'start' });

  for (let i = 0; i < 100; i++) Sim.step(s, 0);
  assert.equal(s.machines['drill-1'].wear, 100, 'one wear point per working tick');
  assert.equal(s.machines['drill-1'].broken, false, 'not broken yet');

  let ticks = 100;
  while (!s.machines['drill-1'].broken && ticks < 3000) { Sim.step(s, 0); ticks++; }
  assert.equal(s.machines['drill-1'].broken, true, 'the drill seized');
  assert.equal(s.machines['drill-1'].status, 'broken');
  assert.equal(s.machines['drill-1'].progress, 0, 'a broken machine holds no work in progress');
  assert.equal(s.machines['drill-1'].reason, 'seized', 'the reason is legible, not generic');
  // Reachable in one sitting: the point of wear is a loop the player actually meets.
  assert.ok(ticks <= 1200, `a drill reaches its limit in a few seconds of play (took ${ticks} ticks)`);
});

test('wear does not accrue while a machine is blocked or off', () => {
  // The duty cycle matters: the drill goes `blocked` on energy, and a limit that ignored
  // that would be reachable only in theory. Wear must track real work, not uptime.
  const s = Sim.freshState();
  s.script.seize.fired = true;
  Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'start' });
  let blockedWearSeen = null;
  for (let i = 0; i < 600; i++) {
    const before = s.machines['drill-1'].wear;
    const wasBlocked = s.machines['drill-1'].status === 'blocked';
    Sim.step(s, 0);
    if (wasBlocked && blockedWearSeen === null) blockedWearSeen = s.machines['drill-1'].wear - before;
  }
  assert.equal(s.machines['drill-1'].wear, 600, 'the drill worked every tick of this run');
  if (blockedWearSeen !== null) assert.equal(blockedWearSeen, 0, 'a blocked tick adds no wear');

  // A stopped machine never wears, however long it sits.
  Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'stop' });
  const idle = s.machines['drill-1'].wear;
  for (let i = 0; i < 500; i++) Sim.step(s, 0);
  assert.equal(s.machines['drill-1'].wear, idle, 'an idle machine does not wear out');
});

test('a broken machine refuses to start until it is repaired', () => {
  const s = Sim.freshState();
  s.machines['drill-1'].broken = true;
  s.machines['drill-1'].status = 'broken';

  assert.deepEqual(
    Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'start' }),
    { ok: false, reason: 'broken' },
    'starting a broken machine is refused with a reason the UI can show',
  );

  const repaired = Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'repair' });
  assert.equal(repaired.ok, true);
  assert.equal(s.machines['drill-1'].broken, false);
  assert.equal(s.machines['drill-1'].wear, 0, 'a repair rebuilds the machine, it does not patch it');

  const started = Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'start' });
  assert.equal(started.ok, true, 'it works again after repair');
});

test('repairing a machine that is not broken is refused', () => {
  const s = Sim.freshState();
  assert.deepEqual(
    Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'repair' }),
    { ok: false, reason: 'not-broken' },
  );
});

/* ------------------------------------------------------------------ the scripted incident */

test('the scripted drill failure fires exactly once, when the player has copper', () => {
  const s = Sim.freshState();
  assert.equal(s.script.seize.fired, false, 'a new world has had no incident');

  Sim.step(s, 0);
  assert.equal(s.script.seize.fired, false, 'no copper yet, so nothing breaks');

  s.bag.copper = 3;
  Sim.step(s, 0);
  assert.equal(s.script.seize.fired, true, 'the seize fired');
  assert.equal(s.machines['drill-1'].broken, true);
  const kinds = s.lastEvents.map((e) => e.type);
  assert.ok(kinds.includes('incident'), 'the player is told there is an incident');
  assert.ok(kinds.includes('machine_broke'), 'and that a machine broke');

  const repaired = Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'repair' });
  assert.equal(repaired.ok, true);
  assert.equal(s.script.seize.resolved, true, 'the beat is marked resolved');

  // It must never fire again, however much copper the player mines afterwards.
  s.bag.copper = 12;
  for (let i = 0; i < 20; i++) Sim.step(s, 0);
  assert.equal(s.script.seize.resolved, true);
  assert.equal(s.machines['drill-1'].broken, false, 'nothing re-broke the drill');
});

test('a reload mid-incident neither re-arms the beat nor launders the damage', () => {
  const s = Sim.freshState();
  s.bag.copper = 3;
  Sim.step(s, 0);
  assert.equal(s.script.seize.fired, true);

  const reloaded = Sim.hydrate(Sim.snapshotOf(s));
  assert.equal(reloaded.script.seize.fired, true, 'the beat stays fired across a reload');
  assert.equal(reloaded.script.seize.at, s.script.seize.at, 'it remembers when it happened');
  assert.equal(reloaded.machines['drill-1'].broken, true, 'the broken drill stays broken');
  assert.equal(reloaded.machines['drill-1'].wear, s.machines['drill-1'].wear, 'wear survives too');

  let refired = false;
  for (let i = 0; i < 5; i++) {
    Sim.step(reloaded, 0);
    if (reloaded.lastEvents.some((e) => e.type === 'incident')) refired = true;
  }
  assert.equal(refired, false, 'a reloaded world never replays the incident');
});

test('wear and its break tick are identical after a save/restore', () => {
  // The server replays an op log from a checkpoint; if wear drifted across a restore the
  // replay would break at a different tick and the two worlds would diverge.
  const s = Sim.freshState();
  s.script.seize.fired = true;
  Sim.applyCommand(s, { type: 'machine', machineId: 'drill-1', action: 'start' });
  for (let i = 0; i < 300; i++) Sim.step(s, 0);

  const reloaded = Sim.hydrate(Sim.snapshotOf(s));
  assert.equal(reloaded.machines['drill-1'].wear, s.machines['drill-1'].wear);

  let a = 0;
  while (!s.machines['drill-1'].broken && a < 4000) { Sim.step(s, 0); a++; }
  let b = 0;
  while (!reloaded.machines['drill-1'].broken && b < 4000) { Sim.step(reloaded, 0); b++; }
  assert.equal(a, b, 'the drill seizes on exactly the same tick in both worlds');
});
