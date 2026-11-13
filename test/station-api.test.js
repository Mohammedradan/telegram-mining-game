'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mountStation,LIFETIME}=require('../station-api');
const Rules=require('../public/station-rules');
function harness(){
  const routes=new Map(),users=new Map(),ledger=[];let clock=1800000000000;
  const pass=()=>{};
  mountStation({app:{post:(p,...fn)=>routes.set(p,fn.at(-1))},store:{withUsers:async(_,fn)=>fn(),putUser:async u=>users.set(u.id,u),appendLedger:async(id,rows)=>ledger.push(...rows.map(r=>({id,...r})))},requireAuth:pass,rateLimit:()=>pass,asyncRoute:fn=>fn,
    prepare:async p=>{if(!users.has(p.id))users.set(p.id,{id:p.id,sync:{},revision:0,state:{gold:77,ores:{copper:3}}});return users.get(p.id);},now:()=>clock});
  return {users,ledger,advance:n=>clock+=n,async call(path,body={},owner='one'){
    let status=200,data;await routes.get('/api/station/'+path)({player:{id:owner},body},{status(n){status=n;return this;},json(v){data=JSON.parse(JSON.stringify(v));}});return {status,body:data};
  }};
}
test('station checkpoints replay movement and persist only reached rooms, duplicates do not repeat ledger',async()=>{
  const h=harness(),start=(await h.call('start')).body;h.advance(4000);
  const body={id:start.id,seq:1,inputs:[[2,40],[Rules.DOWN,140]],visited:['service'],gold:99999,state:{player:{x:1320,y:922}}};
  const result=await h.call('checkpoint',body);assert.equal(result.status,200);
  assert.deepEqual(result.body.progress.visited,['arrival','face']);assert.equal(result.body.progress.anchor,'face');
  assert.deepEqual(h.users.get('one').state,{gold:77,ores:{copper:3}});
  const repeated=await h.call('checkpoint',body);assert.equal(repeated.body.duplicate,true);assert.equal(h.ledger.length,1);
  const restored=(await h.call('start')).body;assert.equal(restored.state.player.y+restored.state.player.h,640);
  assert.deepEqual(restored.progress.visited,['arrival','face']);
  assert.equal((await h.call('checkpoint',{...body,seq:2})).status,409,'old writer cannot overwrite a new session');
});
test('station rejects foreign sessions, changed retries, skipped sequences and forged time or input',async()=>{
  const h=harness(),s=(await h.call('start')).body;
  const body={id:s.id,seq:1,inputs:[[2,180]]};
  assert.equal((await h.call('checkpoint',body,'two')).status,409);
  assert.equal((await h.call('checkpoint',body)).status,400,'cannot fast-forward beyond server time');
  h.advance(5000);assert.equal((await h.call('checkpoint',{...body,inputs:[[8,1]]})).status,400);
  assert.equal((await h.call('checkpoint',{...body,seq:2})).status,409);
  assert.equal((await h.call('checkpoint',body)).status,200);
  assert.equal((await h.call('checkpoint',{...body,inputs:[[1,180]]})).status,409,'same seq with different tape is not a retry');
  assert.equal((await h.call('checkpoint',{...body,seq:2,inputs:[[2,601]]})).status,400);
  h.advance(LIFETIME+1);assert.equal((await h.call('checkpoint',{...body,seq:2})).status,409);
});

test('lift state is server-replayed, duplicate receipts are stable and account economy stays unchanged',async()=>{
  const h=harness(),s=(await h.call('start')).body;h.advance(12000);
  const travel={id:s.id,seq:1,inputs:[[2,40],[Rules.DOWN,140],[2|Rules.RUN,333]],lift:{y:960,target:960}};
  const boarded=await h.call('checkpoint',travel);assert.equal(boarded.status,200);
  assert.equal(boarded.body.state.lift.y,640,'client lift field ignored');
  const ride={id:s.id,seq:2,inputs:[[0,1],[Rules.Lift.ACTION,1],[0,121]],progress:{lift:{y:960}}};
  const arrived=await h.call('checkpoint',ride);assert.equal(arrived.status,200);
  assert.equal(arrived.body.state.lift.y,320);assert.equal(arrived.body.state.player.y+arrived.body.state.player.h,320);
  const again=await h.call('checkpoint',ride);assert.equal(again.body.duplicate,true);
  assert.deepEqual(again.body.state,arrived.body.state);
  assert.deepEqual(h.users.get('one').state,{gold:77,ores:{copper:3}});
  const reopened=(await h.call('start')).body;assert.equal(reopened.state.lift.y,320);
});
test('upgrade from phase-1 preserves visited rooms and anchor while replacing old simulation tickets',async()=>{
  const h=harness();await h.call('start');
  h.users.get('one').sync.station={version:1,progress:{visited:['arrival','face'],anchor:'face'},session:{id:'old',seq:0}};
  const restored=(await h.call('start')).body;
  assert.deepEqual(restored.progress.visited,['arrival','face']);assert.equal(restored.progress.anchor,'face');
  assert.equal(restored.state.version,2);assert.equal(restored.state.lift.y,640);
  assert.equal((await h.call('checkpoint',{id:'old',seq:1,inputs:[[0,1]]})).status,409);
});
