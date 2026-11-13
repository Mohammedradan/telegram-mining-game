'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/station-rules');
const P=require('../public/platform-rules');
const walk=(s,mask,n)=>{for(let i=0;i<n;i++)R.step(s,mask);};

test('station uses the shared platform jump/gravity/collision kernel, walk and run differ',()=>{
  const slow=R.create(),fast=R.create();walk(slow,2,30);walk(fast,2|R.RUN,30);
  assert.ok(fast.player.x>slow.player.x+40);
  const s=R.create();R.step(s,4);assert.ok(s.player.vy<0);walk(s,4,100);
  assert.equal(s.player.y+s.player.h,320,'held jump never repeats');
  assert.equal(s.player.grounded,true);
  assert.ok(P.motion.moveActor);
});
test('station ladder carries the body down and up, then supports release',()=>{
  const s=R.create();walk(s,2,40);walk(s,R.DOWN,140);
  assert.equal(s.player.y+s.player.h,640);assert.ok(s.visited.includes('face'));
  walk(s,1024,140);assert.equal(s.player.y+s.player.h,320);
  walk(s,0,120);assert.equal(s.player.y+s.player.h,320);
});
test('station solids block walking but can be jumped, gaps fall onto the next floor',()=>{
  const s=R.create();walk(s,2|R.RUN,160);
  assert.equal(s.player.x+s.player.w,520);
  walk(s,2|4|R.RUN,40);assert.ok(s.player.x>568,'jump clears the obstruction');
  walk(s,2|R.RUN,70);walk(s,0,100);
  assert.equal(s.player.y+s.player.h,640,'walking into gap falls to physical lower floor');
});
test('all three floors and lower markers are reachable with input only',()=>{
  const s=R.create();walk(s,2,40);walk(s,R.DOWN,140);
  walk(s,2|R.RUN,298);walk(s,R.DOWN,140);
  assert.equal(s.player.y+s.player.h,960);
  assert.ok(s.visited.includes('transfer'));assert.ok(s.visited.includes('service'));
  walk(s,1|R.RUN,310);assert.ok(s.visited.includes('survey'));
  const restored=R.create(R.progress(s));assert.equal(restored.anchor,'survey');
  assert.deepEqual([...restored.visited].sort(),[...s.visited].sort());assert.equal(restored.player.y+restored.player.h,960);
});
test('replay is deterministic, bounded and rejects hostile masks without mutating state',()=>{
  const s=R.create(),before=JSON.stringify(s),tape=[[2,40],[R.DOWN,140]];
  assert.deepEqual(R.replay(s,tape),R.replay(s,tape));assert.equal(JSON.stringify(s),before);
  for(const bad of [[],[[8,1]],[[2,601]],[[2,300],[1,301]],[[NaN,1]],[[4294967296,1]],[[2,-1]],[[2,1,4]],null])assert.equal(R.replay(s,bad).ok,false);
});
test('camera stays bounded, follows both axes and never affects physics',()=>{
  const s=R.create();walk(s,2,40);walk(s,R.DOWN,140);const before=JSON.stringify(s);
  for(const [w,h]of [[320,400],[1280,720],[3000,2000]]){const c=R.camera(s,w,h);assert.ok(c.x>=0&&c.y>=0);assert.ok(c.x<=Math.max(0,R.level.width-w));assert.ok(c.y<=Math.max(0,R.level.height-h));}
  assert.equal(JSON.stringify(s),before);
});
test('restore normalizes unknown rooms and refuses an undiscovered anchor',()=>{
  const s=R.create({visited:['survey','survey','forged'],anchor:'service'});
  assert.deepEqual(s.visited,['survey']);assert.equal(s.anchor,'arrival');
});

test('extracted motion preserves the baseline complete legacy simulation fingerprint (21600 frames)',()=>{
  // Captured from 2ea7c3f before extraction, including every state/event/pose field.
  const hash=require('node:crypto').createHash('sha256');
  for(let zone=0;zone<6;zone++)for(const mode of ['mine','duel']){
    const s=P.create('miner',P.seedFromId('motion-'+zone),{zone,mode});let seed=717+zone;
    for(let i=0;i<1800;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;P.step(s,seed&P.MAX_MASK);hash.update(JSON.stringify(s));}
  }
  assert.equal(hash.digest('hex'),'eed3e8033b05cc373c036fd38469eede76f71a0e34e080037c3e5c9d6c4cc92b');
});

test('upper balcony is reachable by timed jumps over the wall and gap without teleporting',()=>{
  const s=R.create();
  for(let i=0;i<450&&s.player.x<1320;i++){
    const p=s.player;
    const jump=p.grounded&&((p.x>=450&&p.x<570)||(p.x>=630&&p.x<780));
    R.step(s,2|R.RUN|(jump?4:0));
  }
  assert.ok(s.player.x>=1320,'body clears both obstacles');
  assert.equal(s.player.y+s.player.h,320);
  assert.ok(s.visited.includes('balcony'));
});
