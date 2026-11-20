'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MineRouteStore = require('../public/mine-route-store.js');
const memory = () => { const values=new Map(); return {values,getItem(k){return values.has(k)?values.get(k):null},setItem(k,v){values.set(k,String(v))}}; };
const fresh={index:0,unlocked:0,breaks:0,mode:'mine',travelDirection:1,routeProgress:0};
test('route-only progress saves the active traversal location and resumes walking outdoors',()=>{
  const storage=memory(),route=MineRouteStore.create(storage);
  assert.deepEqual(route.load(5),fresh);
  assert.equal(route.save({index:2,unlocked:3,breaks:2,mode:'overland',travelDirection:-1,routeProgress:.43},5),true);
  assert.deepEqual(route.load(5),{index:2,unlocked:3,breaks:2,mode:'overland',travelDirection:-1,routeProgress:.43});
  const saved=JSON.parse(storage.values.get(MineRouteStore.KEY));
  assert.deepEqual(Object.keys(saved).sort(),['breaks','index','mode','routeProgress','travelDirection','unlocked']);
  assert.equal('gold' in saved,false); assert.equal('ore' in saved,false); assert.equal('reward' in saved,false);
});
test('tampered route values are bounded and invalid travel directions fail closed',()=>{
  const storage=memory(),route=MineRouteStore.create(storage);
  storage.setItem(MineRouteStore.KEY,JSON.stringify({index:99,unlocked:-4,breaks:999,gold:1e30,mode:'overland',travelDirection:-1,routeProgress:5}));
  assert.deepEqual(route.load(5),{index:5,unlocked:5,breaks:3,mode:'mine',travelDirection:-1,routeProgress:0});
  route.save({index:-5,unlocked:99,breaks:-1,mode:'overland',travelDirection:1,routeProgress:NaN},5);
  assert.deepEqual(route.load(5),{index:0,unlocked:5,breaks:0,mode:'mine',travelDirection:1,routeProgress:0});
});
test('travel can resume in either direction only when a destination cave exists',()=>{
  const storage=memory(),route=MineRouteStore.create(storage);
  route.save({index:0,unlocked:0,mode:'overland',travelDirection:-1,routeProgress:.1},5);
  assert.equal(route.load(5).mode,'overland','forward trip from first mine is resumable');
  route.save({index:5,unlocked:5,mode:'overland',travelDirection:-1,routeProgress:.9},5);
  assert.equal(route.load(5).mode,'mine','no next cave beyond the final mine');
  route.save({index:0,unlocked:0,mode:'overland',travelDirection:1,routeProgress:.9},5);
  assert.equal(route.load(5).mode,'mine','no previous cave before the first mine');
  route.save({index:3,unlocked:3,mode:'overland',travelDirection:1,routeProgress:.25},5);
  assert.equal(route.load(5).mode,'overland','backtracking trip resumes');
});
test('malformed JSON, denied storage, and unavailable storage fail closed',()=>{
  const storage=memory(),route=MineRouteStore.create(storage); storage.setItem(MineRouteStore.KEY,'{not json');
  assert.deepEqual(route.load(5),fresh);
  const denied=MineRouteStore.create({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}});
  assert.deepEqual(denied.load(5),fresh); assert.equal(denied.save({index:4,unlocked:4,breaks:3},5),false);
  assert.equal(MineRouteStore.create(null).save({index:1,unlocked:1,breaks:0},5),false);
});
