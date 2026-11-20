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
  await page.locator('#station-close').click();
  await page.waitForFunction(()=>!StationUI.inspect().open);
  console.log('Station public-control E2E passed: '+tag);
};
