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
  // The active mining tab is a pointer-events gate. The station overlay must opt back
  // in explicitly, and the old joystick must never win the hit test while the station is open.
  const controlHit = await page.locator('[data-station="4"]').evaluate((button) => {
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const station = document.getElementById('station-view');
    return {
      insideStation: !!hit && station.contains(hit),
      hit: hit?.id || hit?.className || hit?.tagName || null,
      stationPointerEvents: getComputedStyle(station).pointerEvents,
      buttonPointerEvents: getComputedStyle(button).pointerEvents,
      stagePointerEvents: getComputedStyle(document.getElementById('ck-stage')).pointerEvents,
      stationZ: getComputedStyle(station).zIndex
    };
  });
  assert.ok(controlHit.insideStation, tag + ': station overlay owns the jump touch target (' + JSON.stringify(controlHit) + ')');
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
  // Playwright's locator.tap stability gate can stall after reload at this viewport;
  // verify the public nav button is the real hit target, then send a real touch.
  const nav = await page.locator('#nav-mining').evaluate((button) => {
    const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const style = getComputedStyle(button);
    return { x: r.x, y: r.y, width: r.width, height: r.height,
      ready: r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility === 'visible' &&
        style.pointerEvents !== 'none' && hit?.closest('#nav-mining') === button };
  });
  assert.ok(nav.ready, tag+': mining nav is a visible touch target after reload ('+JSON.stringify(nav)+')');
  await page.touchscreen.tap(nav.x + nav.width / 2, nav.y + nav.height / 2);
  await page.waitForFunction(()=>document.getElementById('tab-mining').classList.contains('active'));
  await page.locator('#station-enter').click();
  await page.waitForFunction(()=>StationUI.inspect().open);
  const saved=await page.evaluate(()=>StationUI.inspect().state);
  assert.equal(saved.anchor,'face',tag+': account checkpoint survives reload');
  assert.equal(saved.player.y+saved.player.h,640);
  assert.ok(saved.visited.includes('face'));
  // Walk to the landing beside the shaft first. The saved cabin can be on any
  // stop after a prior viewport run, so call it to this floor before boarding.
  await page.locator('#station-canvas').focus();
  // Use the public run toggle + held right control for the long approach. At wide
  // desktop sizes the canvas draw can be slow in CI, so avoid modifier-key timing.
  const runButton=page.locator('#station-run');
  const rightButton=page.locator('[data-station="2"]');
  const rightBox=await rightButton.boundingBox();
  assert.ok(rightBox&&rightBox.width>=44&&rightBox.height>=44,tag+': right touch control is visible ('+JSON.stringify(rightBox)+')');
  await runButton.click();
  assert.equal(await runButton.getAttribute('aria-pressed'),'true',tag+': run is enabled');
  await page.mouse.move(rightBox.x+rightBox.width/2,rightBox.y+rightBox.height/2);
  await page.mouse.down();
  try{
    await page.waitForFunction(()=>StationUI.inspect().state.player.x>=1300,null,{timeout:30000,polling:50});
  }catch(e){
    const probe=await page.evaluate(()=>{const s=StationUI.inspect().state;return {player:s.player,tick:s.tick,lastMask:s.lastMask,lift:s.lift,anchor:s.anchor};});
    throw new Error(tag+': did not reach the public lift-call range with held right control; '+JSON.stringify(probe)+'; '+e.message);
  }finally{
    await page.mouse.up();
    await runButton.click();
  }
  assert.equal(await runButton.getAttribute('aria-pressed'),'false',tag+': run is released');
  const approach=await page.evaluate(()=>StationUI.inspect().state.player);
  assert.ok(approach.x+approach.w>=1310,tag+': reached the public lift-call range ('+JSON.stringify(approach)+')');
  await page.waitForFunction(()=>{const s=StationUI.inspect().state;return s.lift.y===s.lift.target;},null,{timeout:15000,polling:16});
  const liftBeforeCall=await page.evaluate(()=>StationUI.inspect().state.lift);
  if(liftBeforeCall.y!==640){
    const liftHit=await page.locator('[data-station="8192"]').evaluate(button=>{
      const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return {inside:hit===button||button.contains(hit),hit:hit?.id||hit?.className||hit?.tagName||null};
    });
    assert.ok(liftHit.inside,tag+': the public lift-call button owns its touch target ('+JSON.stringify(liftHit)+')');
    await page.locator('[data-station="8192"]').tap();
    await page.waitForFunction(()=>{const s=StationUI.inspect().state;return s.lift.y===640&&s.lift.target===640;},null,{timeout:15000,polling:16});
  }
  // Only board after the lift has docked at the player's landing.
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
