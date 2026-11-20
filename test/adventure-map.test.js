// Geometry and world-data tests for the Stone Mine map. These run without a DOM and
// guard the promises the world makes: everything is bigger than the viewport, every
// required target is reachable, and collision is explicit data rather than CSS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const MapModule = require('../public/adventure/stone-mine-map');
const R = require('../public/platform-rules');

const { MAP } = MapModule;

test('the world is larger than every supported viewport on both axes', () => {
  const viewports = [[320, 568], [360, 640], [390, 844], [640, 360], [844, 390], [1280, 800], [1920, 1080]];
  for (const [w, h] of viewports) {
    assert.ok(MAP.width > w, `world ${MAP.width} must be wider than ${w}`);
    assert.ok(MAP.height > h, `world ${MAP.height} must be taller than ${h}`);
  }
  // A camera only has meaning if there is somewhere to scroll: at least two screens wide.
  assert.ok(MAP.width >= 320 * 6, 'the gallery should span several phone screens');
  assert.ok(MAP.height >= 568 * 1.5, 'three floors must not fit in one phone screen');
});

test('the map declares three distinct floors with their own geometry', () => {
  assert.equal(MAP.levels.surface, MapModule.SURFACE);
  assert.equal(MAP.levels.service, MapModule.SERVICE);
  assert.equal(MAP.levels.vault, MapModule.VAULT);
  assert.equal(new Set(Object.values(MAP.levels)).size, 3);
  for (const floor of Object.values(MAP.levels)) {
    const support = MAP.platforms.filter((box) => box.y === floor && (box.kind === 'floor' || box.kind === 'ledge'));
    assert.ok(support.length >= 1, `floor at y=${floor} needs walkable geometry`);
  }
});

test('collision exposes solids and one-way ledges separately', () => {
  const { solids, ledges } = MapModule.collisionFor(MAP, []);
  assert.ok(solids.length > 5 && ledges.length > 5);
  assert.ok(solids.every((box) => [box.x, box.y, box.w, box.h].every(Number.isFinite)));
  assert.ok(ledges.every((box) => [box.x, box.y, box.w, box.h].every(Number.isFinite)));
  // Pit boxes are holes in a floor, not walkable ground: they must never be ledges.
  const pits = MAP.platforms.filter((box) => box.kind === 'pit');
  assert.ok(pits.length >= 1);
  for (const pit of pits) assert.ok(!ledges.some((l) => l.y === pit.y && l.x === pit.x));
});

test('closed gates are solid; opening a gate removes its collider', () => {
  for (const gate of MAP.gates) {
    const closed = MapModule.collisionFor(MAP, []).solids.find((box) => box.gate === gate.id);
    assert.ok(closed, `${gate.id} must block movement while closed`);
    assert.equal(closed.x, gate.x);
    assert.equal(closed.h, gate.h);
  }
  const open = MapModule.collisionFor(MAP, MAP.gates.map((g) => g.id)).solids;
  assert.equal(open.filter((box) => box.gate).length, 0, 'no gate collider may survive opening');
});

test('every ladder connects a lower floor to a walkable ledge above it', () => {
  for (const ladder of MAP.ladders) {
    const top = MAP.platforms.find((box) => box.y === ladder.y && ladder.x + 14 >= box.x && ladder.x + 14 <= box.x + box.w);
    const bottom = Object.values(MAP.levels).some((floor) => floor === ladder.bottom);
    assert.ok(top, `${ladder.id} must end at a platform at y=${ladder.y}`);
    assert.ok(bottom, `${ladder.id} must start on a declared floor`);
    assert.ok(ladder.bottom > ladder.y, `${ladder.id} climbs upward`);
  }
});

test('every ore vein sits on a real floor and inside the map', () => {
  for (const vein of MAP.deposits) {
    assert.ok(vein.x > 40 && vein.x < MAP.width - 40, `${vein.id} inside world bounds`);
    const floors = Object.values(MAP.levels);
    assert.ok(floors.includes(vein.y), `${vein.id} must rest on a floor, got y=${vein.y}`);
    // The crew shelf is a large, worker-only reserve; player veins stay small and reviewable.
    assert.ok(vein.amount > 0 && vein.amount <= (vein.crewOnly ? 200 : 20), 'per-vein amount stays reviewable');
    assert.ok(vein.hardness >= 1, 'hardness must be a real requirement');
    assert.ok(['pickaxe', 'drill'].includes(vein.tool));
  }
  assert.equal(new Set(MAP.deposits.map((v) => v.id)).size, MAP.deposits.length, 'deposit ids are unique');
});

test('machines form the approved chain with positive capacities', () => {
  const kinds = MAP.machines.map((m) => m.kind);
  for (const required of ['drill', 'conveyor', 'cart', 'warehouse']) assert.ok(kinds.includes(required), `${required} exists`);
  assert.ok(MAP.machines.find((m) => m.kind === 'warehouse').capacity >= 100);
  assert.ok(MAP.machines.find((m) => m.kind === 'cart').capacity >= 4);
});

test('the lift spans all three floors without overlapping a solid wall', () => {
  assert.deepEqual(MAP.lift.stops, [MapModule.SURFACE, MapModule.SERVICE, MapModule.VAULT]);
  assert.ok(MAP.lift.stops.includes(MAP.lift.start));
  const { solids } = MapModule.collisionFor(MAP, []);
  const blocked = solids.some((box) => box.x < MAP.lift.x + MAP.lift.w && box.x + box.w > MAP.lift.x &&
    MAP.lift.stops.some((y) => y > box.y && y < box.y + box.h));
  assert.equal(blocked, false, 'the lift column must be clear between stops');
});

test('crew work sites reference existing deposits and machines', () => {
  for (const site of MAP.crewSites) {
    if (site.deposit) assert.ok(MapModule.depositById(MAP, site.deposit), `${site.id} deposit exists`);
    if (site.machine) assert.ok(MapModule.machineById(MAP, site.machine), `${site.id} machine exists`);
    assert.ok(['mine', 'haul', 'operate'].includes(site.task));
  }
});

test('reach helpers respect their radius and ignore things further away', () => {
  const vein = MAP.deposits[0];
  const near = { x: vein.x - 10, y: vein.y - 40, w: 24, h: 40 };
  const far = { x: vein.x + 400, y: vein.y - 40, w: 24, h: 40 };
  assert.equal(MapModule.depositInReach(MAP, near)?.id, vein.id);
  assert.equal(MapModule.depositInReach(MAP, far), null);
  const secret = MAP.secrets[0];
  const besideSecret = { x: secret.x - 30, y: secret.y - 30, w: 24, h: 40 };
  assert.equal(MapModule.secretInReach(MAP, besideSecret)?.id, secret.id);
  assert.equal(MapModule.secretInReach(MAP, besideSecret, [secret.id]), null, 'a found secret is not offered twice');
});

test('the world data is frozen so no view can mutate geometry', () => {
  assert.ok(Object.isFrozen(MAP));
  assert.ok(Object.isFrozen(MAP.platforms));
  assert.ok(Object.isFrozen(MAP.platforms[0]), 'nested boxes are frozen too, not just the array');
  assert.ok(Object.isFrozen(MAP.ladders[0]));
  const original = MAP.platforms[0].x;
  // Non-strict callers silently ignore a write to a frozen object; the guarantee is
  // that the geometry cannot change, whichever way it is attempted.
  try { MAP.platforms[0].x = 999; } catch (_) { /* strict callers throw */ }
  assert.equal(MAP.platforms[0].x, original);
});

// ---------------------------------------------------------------- reachability
// A real breadth-first walk over the geometry the motion kernel sees: can a body of
// the miner's size get from spawn to every required target? This is the guard that
// stops a pretty map with an unreachable vein from shipping.

const STEP = 12;
function standable(level, x, y) {
  // Feet at (x,y): inside the map, and supported by a solid or ledge top.
  if (x < 0 || x > level.width) return false;
  const onSupport = level.platforms.some((box) => box.kind !== 'gate' &&
    Math.abs(box.y - y) < 1 && x >= box.x + 4 && x <= box.x + box.w - 4);
  if (!onSupport) return false;
  const body = { x: x - 12, y: y - 40, w: 24, h: 40 };
  const blocked = level.platforms.some((box) => box.kind === 'wall' &&
    body.x < box.x + box.w && body.x + body.w > box.x && body.y < box.y + box.h && body.y + body.h > box.y);
  return !blocked;
}

test('every vein, work site and the warehouse are reachable on foot from spawn', (t) => {
  const level = MapModule.levelFor(MAP, []);
  const start = { x: MAP.spawn.x, y: MapModule.SURFACE };
  const key = (x, y) => `${Math.round(x / STEP)}:${Math.round(y / STEP)}`;
  const seen = new Set([key(start.x, start.y)]);
  const queue = [start];
  const reached = [];
  while (queue.length && reached.length < 5000) {
    const node = queue.shift();
    reached.push(node);
    // Walk sideways along the surface, drop onto anything below, climb ladders.
    const moves = [
      { x: node.x + STEP, y: node.y },
      { x: node.x - STEP, y: node.y },
    ];
    for (const floor of Object.values(MAP.levels)) {
      if (floor > node.y) moves.push({ x: node.x, y: floor });     // falling is allowed
    }
    for (const ladder of MAP.ladders) {
      if (Math.abs(node.x - (ladder.x + 14)) <= STEP && node.y === ladder.bottom) moves.push({ x: ladder.x + 14, y: ladder.y });
    }
    for (const move of moves) {
      const k = key(move.x, move.y);
      if (seen.has(k)) continue;
      if (!standable(level, move.x, move.y) && !(move.y > node.y && move.x === node.x)) continue;
      seen.add(k);
      queue.push(move);
    }
  }
  const canStandAt = (x, y) => reached.some((n) => Math.abs(n.x - x) < STEP * 2 && Math.abs(n.y - y) < 2);
  for (const vein of MAP.deposits) {
    const nearby = canStandAt(vein.x, vein.y) || reached.some((n) => Math.abs(n.x - vein.x) < 60 && n.y === vein.y);
    assert.ok(nearby, `vein ${vein.id} at (${vein.x},${vein.y}) must be walkable-to`);
  }
  for (const site of MAP.crewSites) {
    assert.ok(reached.some((n) => Math.abs(n.x - site.x) < 80 && n.y === site.y), `crew site ${site.id} must be reachable`);
  }
  const warehouse = MAP.machines.find((m) => m.kind === 'warehouse');
  assert.ok(reached.some((n) => Math.abs(n.x - (warehouse.x + warehouse.w / 2)) < 100 && n.y === warehouse.y), 'the warehouse must be reachable');
  assert.ok(canStandAt(start.x, start.y), 'spawn must be standable');
  t.diagnostic(`explored ${reached.length} standing positions`);
});

test('the shared motion kernel accepts the map as a level and keeps the miner inside', () => {
  const Sim = require('../public/adventure/stone-mine-rules');
  const s = Sim.freshState();
  let maxRight = 0;
  let minX = Infinity;
  for (let i = 0; i < 900; i++) {
    Sim.step(s, Sim.INPUT.RIGHT | Sim.INPUT.RUN);
    maxRight = Math.max(maxRight, s.player.x);
    minX = Math.min(minX, s.player.x);
  }
  assert.ok(s.player.x <= MAP.width, 'the miner never leaves the world');
  assert.ok(maxRight > MAP.spawn.x + 300, 'holding right really travels through the gallery');
  for (let i = 0; i < 900; i++) Sim.step(s, Sim.INPUT.LEFT | Sim.INPUT.RUN);
  assert.ok(s.player.x >= 0 && minX >= 0, 'the miner never leaves the west edge');
});

test('the miner cannot walk through the closed east gate', () => {
  const Sim = require('../public/adventure/stone-mine-rules');
  const s = Sim.freshState();
  s.player.x = 3010;
  s.player.y = MapModule.SURFACE - s.player.h;
  s.player.grounded = true;
  for (let i = 0; i < 600; i++) Sim.step(s, Sim.INPUT.RIGHT | Sim.INPUT.RUN);
  const gate = MAP.gates.find((g) => g.id === 'gate-east');
  assert.ok(s.player.x + s.player.w <= gate.x + 2, `the miner stopped at the gate (x=${s.player.x}, gate=${gate.x})`);
  assert.ok(!s.openGates.includes('gate-east'), 'the gate is still sealed without mission progress');
});
