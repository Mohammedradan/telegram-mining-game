// The world must be *walkable*, not merely well-formed. These tests came out of a real
// session-killer: the mine data looked right (three floors, five ladders, a lift, veins) but
// the lift shaft carried a solid header flush with the floor, so the miner could board
// nothing and the entire east gallery was sealed behind a 130px wall. Every assertion here
// is a route a player actually takes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/adventure/stone-mine-rules');
const M = require('../public/adventure/stone-mine-map');

const SURFACE = M.SURFACE;
const SERVICE = M.SERVICE;
const VAULT = M.VAULT;

/** Put the miner on a deck and hold a key mask for n ticks. */
function walk(x, deck, mask, ticks) {
  const s = R.freshState();
  s.player.x = x;
  s.player.y = deck - s.player.h;
  s.player.grounded = true;
  s.player.vy = 0;
  for (let i = 0; i < ticks; i++) R.step(s, mask);
  return s;
}

const feet = (s) => s.player.y + s.player.h;
const where = (s) => `x=${s.player.x.toFixed(0)} feet=${feet(s).toFixed(0)}`;

test('the miner can walk the whole gallery from one end to the other', () => {
  const east = walk(60, SURFACE, R.INPUT.RIGHT, 1800);
  assert.equal(feet(east), SURFACE, `stayed on the deck (${where(east)})`);
  assert.ok(east.player.x > 3260, `reached the east end (${where(east)})`);

  const west = walk(3270, SURFACE, R.INPUT.LEFT, 1800);
  assert.equal(feet(west), SURFACE, `stayed on the deck (${where(west)})`);
  assert.ok(west.player.x < 40, `reached the west end (${where(west)})`);
});

test('the shaft at the lift no longer walls the miner out of the east gallery', () => {
  // Regression: the old map had a solid box from y=200 to the floor across x 1240..1370.
  for (const start of [1100, 1200, 1240, 1300, 1370]) {
    const s = walk(start, SURFACE, R.INPUT.RIGHT, 240);
    assert.ok(s.player.x > start, `walking east from ${start} must make progress (${where(s)})`);
    assert.equal(feet(s), SURFACE, `walking east from ${start} stays on the deck (${where(s)})`);
  }
});

// The cabin floor is the deck line: the miner walks into the doorway at deck height.
const inDoorway = () => {
  const s = R.freshState();
  s.player.x = 1290;
  s.player.y = M.MAP.lift.start - s.player.h;
  s.player.grounded = true;
  return s;
};

test('the lift can be boarded, ridden to the next deck, and left there', () => {
  const s = inDoorway();
  const call = R.callLift(s);
  assert.equal(call.ok, true, `callLift must accept a miner standing in the cab (${JSON.stringify(call)})`);
  assert.equal(call.action, 'ride');
  for (let i = 0; i < 220; i++) R.step(s, 0);
  assert.equal(s.lift.y, SERVICE, 'the cabin arrives at the service deck');
  assert.equal(feet(s), SERVICE, 'the rider travels with the cabin');

  // Stepping out must not be locked by the generous boarding test.
  for (let i = 0; i < 400; i++) R.step(s, R.INPUT.RIGHT);
  assert.equal(feet(s), SERVICE, `the rider stays on the service deck (${where(s)})`);
  assert.ok(s.player.x > 1900, `the rider can walk to the machinery (${where(s)})`);
});

test('a rider cannot steer a moving cabin but can always leave a docked one', () => {
  const s = inDoorway();
  R.callLift(s);
  for (let i = 0; i < 30; i++) R.step(s, R.INPUT.RIGHT);
  assert.equal(s.player.x, 1290, 'steering is ignored while the cabin moves');
  assert.ok(feet(s) > SURFACE, 'the cabin is carrying the rider downward');
  for (let i = 0; i < 260; i++) R.step(s, 0);
  for (let i = 0; i < 60; i++) R.step(s, R.INPUT.RIGHT);
  assert.ok(s.player.x > 1290, 'a docked cabin releases the rider');
  assert.equal(feet(s), SERVICE, 'the rider walks out onto the service deck');
});

test('walking into the lift doorway boards the cabin', () => {
  // The deck runs through the shaft, so boarding is walking in — no jump, no step.
  const s = walk(1180, SURFACE, R.INPUT.RIGHT, 30);
  assert.ok(s.player.x > M.MAP.lift.x, `reached the doorway (${where(s)})`);
  assert.equal(R.onLift(s), true, `standing in the cabin (${where(s)})`);
  assert.equal(R.callLift(s).action, 'ride', 'and the lift accepts the ride');
});

test('ladders work in both directions', () => {
  const up = walk(470, SURFACE, R.INPUT.UP, 220);
  assert.equal(feet(up), 150, `the gallery ladder reaches the timber walkway (${where(up)})`);
  const down = walk(470, 150, R.INPUT.DOWN, 220);
  assert.equal(feet(down), SURFACE, `and climbs back down (${where(down)})`);

  const vaultDown = walk(240, SERVICE, R.INPUT.DOWN, 220);
  assert.equal(feet(vaultDown), VAULT, `the vault ladder descends (${where(vaultDown)})`);
  const vaultUp = walk(240, VAULT, R.INPUT.UP, 260);
  assert.equal(feet(vaultUp), SERVICE, `and climbs back up (${where(vaultUp)})`);
});

test('the service deck is continuous up to the machinery', () => {
  const s = walk(1290, SERVICE, R.INPUT.RIGHT, 700);
  assert.equal(feet(s), SERVICE, `stayed on the service deck (${where(s)})`);
  assert.ok(s.player.x > 2150, `reached the warehouse approach (${where(s)})`);
  // And the one hole that exists really drops the miner.
  const gap = R.freshState();
  gap.player.x = 2544;
  gap.player.y = SERVICE - 40;
  gap.player.grounded = false;
  for (let i = 0; i < 220; i++) R.step(gap, 0);
  assert.equal(feet(gap), VAULT, 'the service-deck gap is a real fall, not a decoration');
});

test('no vein is a collision body, so no vein can seal a route', () => {
  // Regression: un-mined veins were 36x40 solids, so the miner had to jump over the rock
  // they were about to mine — and a vein in a narrow corridor could seal the corridor.
  const s = R.freshState();
  assert.deepEqual(s.rocks, []);
  const MINE = R.REACH;
  for (const vein of M.MAP.deposits) {
    if (vein.crewOnly) continue;
    // Stand on the deck beside the vein and walk through the place it occupies.
    const start = vein.x - 120;
    if (start < 0) continue;
    const walked = walk(start, vein.y, R.INPUT.RIGHT, 120);
    assert.ok(walked.player.x > vein.x, `${vein.id} must not block walking (${where(walked)})`);
    void MINE;
  }
});

test('the crew shelf, work sites and warehouse are reachable on foot', () => {
  // Surface crew site.
  const site = M.MAP.crewSites.find((s) => s.id === 'site-mine-a');
  const surface = walk(1900, SURFACE, R.INPUT.RIGHT, 240);
  assert.ok(Math.abs(surface.player.x - site.x) < 300, `surface walk passes ${site.id} (${where(surface)})`);

  // Service-deck machines: every one of them is within one walk of the lift landing.
  const deck = walk(1290, SERVICE, R.INPUT.RIGHT, 900);
  for (const machine of M.MAP.machines) {
    const near = Math.abs((deck.player.x + 12) - (machine.x + machine.w / 2)) < 260;
    assert.ok(near || machine.x + machine.w < deck.player.x, `${machine.id} is reachable on the service deck`);
  }
  const warehouse = M.MAP.machines.find((m) => m.kind === 'warehouse');
  assert.ok(deck.player.x + 12 > warehouse.x, 'the walk east reaches the warehouse');
});
