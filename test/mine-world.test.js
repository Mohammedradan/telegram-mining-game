const { test } = require('node:test');
const assert = require('node:assert/strict');
const MineWorld = require('../public/mine-world.js');

test('world contains the six planned mine biomes in progression order', () => {
  assert.deepEqual(MineWorld.MINES.map(m=>m.id), ['stone','iron','gold','crystal','lava','legendary']);
});
test('vertical movement requires reaching a ladder or elevator shaft', () => {
  const world=MineWorld.create(), miner={x:.5,y:.8,face:1}, band={x0:.08,x1:.92,y0:.34,y1:.88};
  MineWorld.step(world,miner,{x:0,y:-1},1,1,band);
  assert.equal(miner.y,.8,'cannot magically rise through solid rock');
  miner.x=.14;
  const r=MineWorld.step(world,miner,{x:0,y:-1},1,1,band);
  assert.ok(miner.y<.8 && r.climbing);
  assert.equal(world.floor,'upper');
});
test('the elevator shaft also connects the lower and upper work lanes', () => {
  const world=MineWorld.create(), miner={x:.84,y:.8,face:1}, band={x0:.08,x1:.92,y0:.34,y1:.88};
  MineWorld.step(world,miner,{x:0,y:-1},1,1,band);
  assert.ok(miner.y<.8);
  assert.equal(world.floor,'upper');
});
test('a new cave opens only after three completed rock breaks and is traversed at the upper tunnel', () => {
  const world=MineWorld.create(), miner={x:.89,y:.4,face:1}, band={x0:.08,x1:.92,y0:.34,y1:.88};
  world.floor='upper';
  assert.equal(MineWorld.recordBreak(world),false);
  assert.equal(MineWorld.recordBreak(world),false);
  assert.equal(MineWorld.recordBreak(world),true);
  const r=MineWorld.step(world,miner,{x:1,y:0},.2,1,band);
  assert.equal(r.transition,'next');
  assert.equal(world.index,1);
  assert.equal(world.breaks,0);
  assert.equal(miner.y,.8);
});
test('upper tunnel returns to the previous cave and the final cave has no forward overflow', () => {
  const world=MineWorld.create(2), miner={x:.09,y:.4,face:-1}, band={x0:.08,x1:.92,y0:.34,y1:.88};
  world.floor='upper';
  const r=MineWorld.step(world,miner,{x:-1,y:0},.2,1,band);
  assert.equal(r.transition,'previous');
  assert.equal(world.index,1);
  world.index=5; world.floor='upper'; world.breaks=99; miner.x=.89; miner.y=.4;
  const end=MineWorld.step(world,miner,{x:1,y:0},.2,1,band);
  assert.equal(end.transition,null);
  assert.equal(world.index,5);
});
