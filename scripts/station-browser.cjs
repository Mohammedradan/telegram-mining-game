'use strict';
const assert=require('node:assert/strict');
// Public controls only: no placing the miner, forging discoveries or simulated time.
module.exports=async function stationBrowser(page,tag){
  await page.locator('#station-enter').click();
  await page.waitForFunction(()=>window.StationUI?.inspect().open);
  assert.equal(await page.evaluate(()=>DigSite.inspect().paused),true,tag+': old controller pauses');
  const geometry=await page.locator('#station-canvas').boundingBox();
  assert.ok(geometry.width>=280&&geometry.height>=100,tag+': usable field');
  for(const b of await page.locator('#station-view button:visible').all()){
    const r=await b.boundingBox();assert.ok(r.width>=44&&r.height>=44,tag+': touch target');
  }
  // A real quick touch must survive until a simulation tick consumes it.
  await page.locator('[data-station="4"]').tap();
  await page.waitForFunction(()=>StationUI.inspect().state.player.y+StationUI.inspect().state.player.h<315);
  await page.waitForFunction(()=>StationUI.inspect().state.player.grounded);
  await page.locator('#station-canvas').focus();
  await page.keyboard.down('ArrowRight');
  try{await page.waitForFunction(()=>StationUI.inspect().state.player.x>=190);}finally{await page.keyboard.up('ArrowRight');}
  await page.keyboard.down('ArrowDown');
  try{await page.waitForFunction(()=>StationUI.inspect().state.player.y+StationUI.inspect().state.player.h===640);}finally{await page.keyboard.up('ArrowDown');}
  const landed=await page.evaluate(()=>StationUI.inspect().state);
  assert.ok(landed.visited.includes('face'),tag+': physically reached lower checkpoint');
  assert.equal(landed.player.grounded,true);
  if(tag==='320x568'){
    await page.route('**/api/station/checkpoint',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'اختبار انقطاع الحفظ'})}));
    await page.waitForFunction(()=>StationUI.inspect().dirty);
    await page.locator('#station-close').click();
    await page.waitForFunction(()=>StationUI.inspect().error);
    assert.equal(await page.evaluate(()=>StationUI.inspect().open),true,'failed save never reports a successful close');
    await page.unroute('**/api/station/checkpoint');
    await page.locator('#station-retry').click();
    await page.waitForFunction(()=>!StationUI.inspect().error);
  }
  await page.locator('#station-close').click();
  await page.waitForFunction(()=>!StationUI.inspect().open);
  assert.equal(await page.evaluate(()=>DigSite.inspect().paused),false,tag+': old controller resumes');
  await page.reload();
  await page.waitForFunction(()=>window.StationUI&&window.PlatformBridge?.user());
  await page.locator('#nav-mining').tap();
  await page.locator('#station-enter').click();
  await page.waitForFunction(()=>StationUI.inspect().open);
  const saved=await page.evaluate(()=>StationUI.inspect().state);
  assert.equal(saved.anchor,'face',tag+': account checkpoint survives reload');
  assert.equal(saved.player.y+saved.player.h,640);
  assert.ok(saved.visited.includes('face'));
  // Walk into the real cabin using public inputs; never inject position/time.
  await page.locator('#station-canvas').focus();
  await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowRight');
  try{await page.waitForFunction(()=>StationUI.inspect().state.player.x>=1410,null,{timeout:20000,polling:16});}
  finally{await page.keyboard.up('ArrowRight');await page.keyboard.up('Shift');}
  const boarded=await page.evaluate(()=>StationUI.inspect().state.player);
  assert.ok(boarded.x>=1400&&boarded.x+boarded.w<=1520,tag+': physically boarded');
  await page.locator('[data-station="8192"]').tap();
  await page.waitForFunction(()=>StationUI.inspect().state.lift.y<600);
  const riding=await page.evaluate(()=>StationUI.inspect().state);
  assert.ok(Math.abs(riding.player.y+riding.player.h-riding.lift.y)<.001,tag+': cabin carries body');
  await page.waitForFunction(()=>StationUI.inspect().state.lift.y===320);
  assert.equal(await page.evaluate(()=>StationUI.inspect().state.player.y+StationUI.inspect().state.player.h),320);
  await page.locator('#station-canvas').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(()=>StationUI.inspect().state.lift.y>320);
  await page.waitForFunction(()=>StationUI.inspect().state.lift.y===640);
  await page.keyboard.down('ArrowLeft');
  try{await page.waitForFunction(()=>StationUI.inspect().state.player.x<1360);}finally{await page.keyboard.up('ArrowLeft');}
  assert.equal(await page.evaluate(()=>StationUI.inspect().state.player.y+StationUI.inspect().state.player.h),640,tag+': exits onto solid landing');
  await page.locator('#station-close').click();
  await page.waitForFunction(()=>!StationUI.inspect().open);
  console.log('Station public-control E2E passed: '+tag);
};
