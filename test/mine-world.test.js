const { test } = require('node:test');
const assert = require('node:assert/strict');
const MineWorld = require('../public/mine-world.js');

test('world contains the six planned mine biomes in progression order', () => {
  assert.deepEqual(MineWorld.MINES.map(m=>m.id), ['stone','iron','gold','crystal','lava','legendary']);
});
test('an uncleared rockslide physically blocks the upper exit until three rocks are mined', () => {
  const world=MineWorld.create(), miner={x:.72,y:.4,face:1}, band={x0:.08,x1:.92,y0:.34,y1:.88};
  world.floor='upper';
  MineWorld.step(world,miner,{x:1,y:0},1,1,band);
  assert.ok(Math.abs(miner.x-.86)<1e-9,'the body stops at the rockfall instead of slipping through the exit');
  assert.equal(world.index,0);
  for(let i=0;i<3;i++) MineWorld.recordBreak(world);
  MineWorld.step(world,miner,{x:1,y:0},.4,1,band);
  assert.equal(world.index,1,'the cleared route becomes traversable');
});

test('vertical movement requires reaching a ladder or elevator shaft', () => {
  const world=MineWorld.create(), miner={x:.5,y:.8,face:1}, band={x0:.08,x1:.92,y0:.34,y1:.88};
  MineWorld.step(world,miner,{x:0,y:-1},.2,1,band);
  assert.ok(miner.y<.8,'the miner can walk in depth to approach a rock');
  assert.equal(world.floor,'lower','depth movement alone does not change floors');
  miner.y=.8;
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

test('all six caves are reachable and revisitable with phone body-safe bounds', () => {
  for (const margin of [.08, .14, .2]) {
    const band = {x0:margin,x1:1-margin,y0:.34,y1:.88};
    const world = MineWorld.create(), miner = {x:.5,y:.8,face:1};
    for (let cave = 0; cave < 5; cave++) {
      world.floor='upper'; miner.x=band.x1-.02; miner.y=.4;
      assert.equal(MineWorld.step(world,miner,{x:1,y:0},.1,1,band).transition,null,'locked cave stays locked');
      for(let n=0;n<3;n++) MineWorld.recordBreak(world);
      assert.equal(MineWorld.step(world,miner,{x:1,y:0},.1,1,band).transition,'next');
      assert.equal(world.index,cave+1);
      assert.equal(world.floor,'lower');
      assert.ok(miner.x>=band.x0 && miner.x<=band.x1);
    }
    assert.equal(MineWorld.canAdvance(world),false,'no cave past Legendary');
    for(let cave=5;cave>0;cave--) {
      world.floor='upper'; miner.x=band.x0; miner.y=.4;
      assert.equal(MineWorld.step(world,miner,{x:-1,y:0},.1,1,band).transition,'previous');
      assert.equal(world.index,cave-1);
      assert.equal(MineWorld.canAdvance(world),true,'visited route remains open');
    }
    world.floor='upper'; miner.x=band.x1; miner.y=.4;
    assert.equal(MineWorld.step(world,miner,{x:1,y:0},.1,1,band).transition,'next','no repeated rock grind on return');
  }
});

test('exit requires upper tunnel position and deliberate movement toward it', () => {
  const band={x0:.2,x1:.8,y0:.34,y1:.88}, world=MineWorld.create(1);
  world.breaks=3; world.floor='upper';
  const miner={x:.8,y:.8,face:1};
  assert.equal(MineWorld.step(world,miner,{x:1,y:0},.1,1,band).transition,null,'stale floor flag cannot teleport from lower lane');
  miner.y=.4;
  assert.equal(MineWorld.step(world,miner,{x:0,y:0},.1,1,band).transition,null,'idle at exit cannot teleport');
  assert.equal(MineWorld.step(world,miner,{x:-1,y:0},.01,1,band).transition,null,'walking away does not enter');
  assert.equal(world.index,1);
});

test('non-finite time cannot corrupt world positions or trigger transitions', () => {
  const band={x0:.08,x1:.92,y0:.34,y1:.88}, world=MineWorld.create(), miner={x:.5,y:.8};
  for(const dt of [Infinity,NaN,-1,0]) {
    const before={...miner};
    assert.equal(MineWorld.step(world,miner,{x:1,y:1},dt,1,band).transition,null);
    assert.deepEqual(miner,before);
  }
});
