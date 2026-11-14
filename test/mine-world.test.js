const { test } = require('node:test');
const assert = require('node:assert/strict');
const MineWorld = require('../public/mine-world.js');
const band={x0:.08,x1:.92,y0:.34,y1:.88};
const clearRoute=(world,miner,direction)=>{
  // Move off the boulder/steam line, then physically walk the entire outdoor span.
  MineWorld.step(world,miner,{x:0,y:-1},.5,1,band);
  let result=null;
  for(let i=0;i<30;i++){
    result=MineWorld.step(world,miner,{x:direction,y:0},.2,1,band);
    if(result.transition) return result;
    if(result.obstacle) MineWorld.step(world,miner,{x:0,y:-1},.35,1,band);
  }
  return result;
};

test('world contains the six planned mine biomes in progression order', () => {
  assert.deepEqual(MineWorld.MINES.map(m=>m.id), ['stone','iron','gold','crystal','lava','legendary']);
});
test('the cave exit opens onto a walkable overland segment; breaking rocks does not teleport caves', () => {
  const world=MineWorld.create(), miner={x:.89,y:.4,face:1}; world.floor='upper';
  for(let i=0;i<3;i++) MineWorld.recordBreak(world);
  MineWorld.step(world,miner,{x:1,y:0},.2,1,band);
  assert.equal(world.index,0,'the cave index stays put when the player leaves');
  assert.equal(world.mode,'overland');
  assert.equal(miner.x,band.x1,'the miner remains at the same connected-world edge');
  for(let i=0;i<3;i++) MineWorld.recordBreak(world);
  assert.equal(world.index,0,'route progress never grants a destination or economy reward');
  const result=clearRoute(world,miner,-1);
  assert.equal(result.transition,'arrive');
  assert.equal(world.index,1);
  assert.equal(world.mode,'mine');
});
test('an uncleared rockslide physically blocks the upper cave exit until three rocks are mined', () => {
  const world=MineWorld.create(), miner={x:.72,y:.4,face:1}; world.floor='upper';
  MineWorld.step(world,miner,{x:1,y:0},1,1,band);
  assert.equal(world.mode,'mine');
  assert.equal(world.index,0);
  assert.ok(miner.x<=.86+1e-9);
  for(let i=0;i<3;i++) MineWorld.recordBreak(world);
  MineWorld.step(world,miner,{x:1,y:0},.4,1,band);
  assert.equal(world.mode,'overland','the route is opened for walking, not a cave swap');
  assert.equal(world.index,0);
});
test('vertical movement requires reaching a ladder or elevator shaft', () => {
  const world=MineWorld.create(), miner={x:.5,y:.8,face:1};
  MineWorld.step(world,miner,{x:0,y:-1},.2,1,band);
  assert.ok(miner.y<.8);
  assert.equal(world.floor,'lower');
  miner.y=.8; miner.x=.14;
  const r=MineWorld.step(world,miner,{x:0,y:-1},1,1,band);
  assert.ok(miner.y<.8 && r.climbing); assert.equal(world.floor,'upper');
});
test('the elevator shaft also connects the lower and upper work lanes', () => {
  const world=MineWorld.create(), miner={x:.84,y:.8,face:1};
  MineWorld.step(world,miner,{x:0,y:-1},1,1,band);
  assert.ok(miner.y<.8); assert.equal(world.floor,'upper');
});
test('three breaks unlock an upper exit; destination changes only after walking across the terrain', () => {
  const world=MineWorld.create(), miner={x:.89,y:.4,face:1}; world.floor='upper';
  for(let i=0;i<3;i++) MineWorld.recordBreak(world);
  const departed=MineWorld.step(world,miner,{x:1,y:0},.2,1,band);
  assert.equal(departed.transition,'depart'); assert.equal(world.index,0);
  const arrived=clearRoute(world,miner,-1);
  assert.equal(arrived.transition,'arrive'); assert.equal(world.index,1); assert.equal(world.breaks,0);
});
test('return travel across the same ground reaches the previous cave and endpoints never overflow', () => {
  const world=MineWorld.create(2), miner={x:.09,y:.4,face:-1}; world.floor='upper'; world.unlocked=2;
  const depart=MineWorld.step(world,miner,{x:-1,y:0},.2,1,band);
  assert.equal(depart.transition,'depart'); assert.equal(world.index,2); assert.equal(world.travelDirection,1);
  const arrival=clearRoute(world,miner,1);
  assert.equal(arrival.transition,'arrive'); assert.equal(world.index,1);
  world.index=5; world.floor='upper'; world.breaks=99; miner.x=.89; miner.y=.4;
  assert.equal(MineWorld.step(world,miner,{x:1,y:0},.2,1,band).transition,null);
  assert.equal(world.index,5);
});
test('all caves are connected by traversal and previously cleared caves stay accessible', () => {
  const world=MineWorld.create(), miner={x:.5,y:.8,face:1};
  for(let cave=0;cave<5;cave++){
    world.floor='upper'; miner.x=band.x1-.02; miner.y=.4;
    if(!MineWorld.canAdvance(world)) for(let n=0;n<3;n++) MineWorld.recordBreak(world);
    assert.equal(MineWorld.step(world,miner,{x:1,y:0},.1,1,band).transition,'depart');
    assert.equal(world.index,cave);
    assert.equal(clearRoute(world,miner,-1).transition,'arrive');
    assert.equal(world.index,cave+1);
    assert.equal(world.floor,'lower');
  }
  assert.equal(MineWorld.canAdvance(world),false);
  for(let cave=5;cave>0;cave--){
    world.floor='upper'; miner.x=band.x0; miner.y=.4;
    assert.equal(MineWorld.step(world,miner,{x:-1,y:0},.1,1,band).transition,'depart');
    assert.equal(world.index,cave);
    assert.equal(clearRoute(world,miner,1).transition,'arrive');
    assert.equal(world.index,cave-1); assert.equal(MineWorld.canAdvance(world),true);
  }
  world.index=5; world.unlocked=5; world.floor='upper'; miner.x=band.x1; miner.y=.4;
  assert.equal(MineWorld.step(world,miner,{x:1,y:0},.1,1,band).transition,null,'no cave beyond Legendary');
});
test('the player can turn back at the original cave without changing destination', () => {
  const world=MineWorld.create(), miner={x:.89,y:.4,face:1}; world.floor='upper';
  for(let i=0;i<3;i++) MineWorld.recordBreak(world);
  MineWorld.step(world,miner,{x:1,y:0},.2,1,band);
  assert.equal(MineWorld.step(world,miner,{x:1,y:0},.1,1,band).transition,'return');
  assert.equal(world.index,0); assert.equal(world.mode,'mine');
});
test('a roadside boulder blocks movement until the player walks around it', () => {
  const world=MineWorld.create(), miner={x:.88,y:.8,face:-1};
  world.mode='overland'; world.travelDirection=-1;
  let hit;
  for(let i=0;i<12;i++){hit=MineWorld.step(world,miner,{x:-1,y:0},.2,1,band); if(hit.obstacle) break;}
  assert.equal(hit.obstacle,'boulder');
  const stuck=miner.x;
  MineWorld.step(world,miner,{x:0,y:-1},.5,1,band);
  assert.ok(miner.y<.8);
  const clear=MineWorld.step(world,miner,{x:-1,y:0},.2,1,band);
  assert.equal(clear.obstacle,null); assert.ok(miner.x<stuck);
});
test('non-finite time cannot corrupt world positions or trigger transitions', () => {
  const world=MineWorld.create(), miner={x:.5,y:.8};
  for(const dt of [Infinity,NaN,-1,0]){
    const before={...miner}; assert.equal(MineWorld.step(world,miner,{x:1,y:1},dt,1,band).transition,null); assert.deepEqual(miner,before);
  }
});
