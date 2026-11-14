'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/station-rules');
function step(s,mask,n=1){for(let i=0;i<n;i++)R.step(s,mask);}
function board(){const s=R.create();step(s,2,40);step(s,R.DOWN,140);step(s,2|R.RUN,333);step(s,0);assert.ok(R.Lift.aboard(s.player,s.lift));return s;}

test('lift carries the actual body every tick through three floors, not just a floor flag',()=>{
  const s=board(),x=s.player.x;step(s,R.Lift.ACTION);
  let previous=s.lift.y;
  for(let i=0;i<130;i++){
    step(s,2|4); // moving cage prevents walking out or jumping into the shaft
    assert.equal(s.player.x,x);assert.ok(Math.abs(s.player.y+s.player.h-s.lift.y)<.001);
    assert.ok(s.lift.y<=previous);previous=s.lift.y;
    if(!R.Lift.moving(s.lift))break;
  }
  assert.equal(s.lift.y,320);assert.equal(s.player.y+s.player.h,320);
  step(s,0);step(s,R.DOWN);step(s,0,121);
  assert.equal(s.player.y+s.player.h,640);
  step(s,R.DOWN);step(s,0,121);
  assert.equal(s.player.y+s.player.h,960);
  step(s,R.INPUT.UP);step(s,0,121);
  assert.equal(s.player.y+s.player.h,640);
  step(s,1,25);assert.ok(s.player.x<1400,'player exits only after docking');
  assert.equal(s.player.y+s.player.h,640);
});
test('landing gates block entry into an empty shaft, calling moves cabin without teleporting player',()=>{
  const s=R.create({visited:['balcony'],anchor:'balcony'}),x=s.player.x;
  step(s,2|R.RUN,50);assert.equal(s.player.x+s.player.w,1392,'closed gate blocks walking');
  step(s,0);step(s,R.Lift.ACTION);const waitingX=s.player.x;
  step(s,0,121);assert.equal(s.lift.y,320);assert.equal(s.player.x,waitingX);assert.equal(s.player.y+s.player.h,320);
  step(s,2,35);assert.ok(s.player.x>x);assert.ok(R.Lift.aboard(s.player,s.lift));
});
test('remote calls, held action and top/bottom requests cannot cause overflow or repeated trips',()=>{
  const remote=R.create();step(remote,R.Lift.ACTION,180);assert.equal(remote.lift.y,640);
  const s=board();step(s,R.Lift.ACTION,300);
  assert.equal(s.lift.y,320);assert.equal(s.lift.target,320,'hold does not trigger another journey');
  step(s,R.INPUT.UP,180);assert.equal(s.lift.y,320,'no stop above top');
  step(s,0);step(s,R.DOWN);step(s,0,121);step(s,R.DOWN);step(s,0,121);
  step(s,R.DOWN,180);assert.equal(s.lift.y,960,'no stop below bottom');
});
test('lift replay and progress preserve mid-journey state and safely restore the player at an anchor',()=>{
  const s=board();const result=R.replay(s,[[R.Lift.ACTION,1],[0,40]]);
  assert.equal(result.ok,true);assert.deepEqual(result,R.replay(s,[[R.Lift.ACTION,1],[0,40]]));
  const restored=R.create(R.progress(result.state));
  assert.deepEqual(restored.lift,result.state.lift);
  assert.equal(restored.player.y+restored.player.h,640,'reopen returns to verified transfer landing, not mid-shaft');
  assert.ok(!R.Lift.aboard(restored.player,restored.lift));
  const initialY=restored.player.y;step(restored,0,121);
  assert.equal(restored.player.y,initialY);assert.equal(restored.lift.y,320);
});
test('untrusted/corrupt lift fields normalize to a safe position and stop',()=>{
  assert.deepEqual(R.Lift.create({y:Infinity,target:123,direction:99}),{y:640,target:640,direction:-1});
  assert.deepEqual(R.Lift.create({y:-1,target:960,direction:1}),{y:640,target:960,direction:1});
  assert.ok(R.level.platforms.filter(p=>p.route).every(p=>p.x+p.w<=1400||p.x>=1520),'floors have a real shaft gap');
});
