'use strict';
const assert = require('node:assert/strict');

// Called by the existing Chromium suite, so CI exercises the regression on every
// existing phone/tablet/desktop viewport. Setup uses visual-only DigSite hooks;
// actual shaft/exit activation and focus changes use browser keyboard events.
module.exports = async function verifyTraversal(page, tag) {
  await page.waitForFunction(() => window.MiningExpedition?.active && window.DigSite?.active);
  const area = () => page.locator('#click-area').boundingBox();
  const before = await area();
  await page.locator('#ck-map-panel').evaluate(el => { el.open = true; });
  await page.waitForFunction(() => !document.querySelector('#ck-goals-panel').open);
  await page.locator('#ck-goals-panel').evaluate(el => { el.open = true; });
  await page.waitForFunction(() => !document.querySelector('#ck-map-panel').open);
  const after = await area();
  assert.deepEqual(after, before, `${tag}: sheets never resize the field`);
  await page.locator('#ck-goals-panel summary').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => DigSite.inspect().keys.r), false, `${tag}: summary owns arrow navigation`);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#ck-goals-panel').evaluate(el => el.open), false);
  assert.equal(await page.locator('#ck-goals-panel summary').evaluate(el => el === document.activeElement), true);

  await page.evaluate(() => {
    document.activeElement?.blur();
    DigSite.debug.setRock({x:.5,y:.8},12);
    DigSite.debug.place({x:.14,y:.8});
  });
  await page.keyboard.down('ArrowUp');
  try {
    await page.waitForFunction(() => DigSite.inspect().mine.floor === 'upper');
  } finally { await page.keyboard.up('ArrowUp'); }
  assert.equal(await page.evaluate(() => DigSite.inspect().keys.u), false);

  const baseline = await page.evaluate(() => ({gold:state.gold, stats:DigSite.inspect().stats, passive:state.passiveIncome}));
  for (let index=0; index<5; index++) {
    await page.evaluate(() => {
      // These report accepted visual rock breaks, not gold or ores.
      for(let n=0;n<3;n++) { DigSite.debug.setRock({x:.5,y:.8},1); DigSite.onTap({}); }
      // Finish any approach animation before testing the upper route.
      DigSite.onTab('mining');
      DigSite.debug.place({x:.14,y:.4});
      DigSite.debug.setStick(0,-1); DigSite.debug.step(.05); DigSite.debug.setStick(0,0);
      const band = DigSite.inspect().band;
      DigSite.debug.place({x:band.x1-.025,y:.4});
    });
    // Leave the upper tunnel first; forward travel then runs left across the mountain.
    await page.keyboard.down('ArrowRight');
    try {
      await page.waitForFunction(() => DigSite.inspect().mine.mode === 'overland');
    } finally { await page.keyboard.up('ArrowRight'); }
    const direction = await page.evaluate(() => DigSite.inspect().mine.travelDirection < 0 ? 'ArrowLeft' : 'ArrowRight');
    // The overland segment is a real route: first verify the boulder blocks
    // horizontal travel, then steer around it instead of teleporting through it.
    await page.keyboard.down(direction);
    try {
      await page.waitForFunction(() => DigSite.inspect().mine.mode === 'overland' && DigSite.inspect().mine.lastObstacle === 'boulder', null, { timeout: 10000 });
    } finally { await page.keyboard.up(direction); }
    const blocked = await page.evaluate(() => DigSite.inspect().mine);
    assert.equal(blocked.index, index, `${tag}: the boulder blocks cave progression until bypassed`);
    assert.equal(blocked.lastObstacle, 'boulder', `${tag}: the route reports the physical obstacle`);
    const vertical = await page.evaluate(() => DigSite.inspect().miner.y > 0.62 ? 'ArrowUp' : 'ArrowDown');
    await page.keyboard.down(direction);
    await page.keyboard.down(vertical);
    try {
      await page.waitForFunction(expected => DigSite.inspect().mine.index === expected, index+1, { timeout: 30000 });
    } finally {
      await page.keyboard.up(direction);
      await page.keyboard.up(vertical);
    }
    const reached = await page.evaluate(() => ({mine:DigSite.inspect().mine, scene:document.querySelector('.ck-mine-set').dataset.mine}));
    assert.equal(reached.mine.floor,'lower',`${tag}: next cave starts on lower landing`);
    assert.equal(reached.scene,reached.mine.definition.id,`${tag}: scene follows traversal`);
  }
  const economy = await page.evaluate(() => ({gold:state.gold, stats:DigSite.inspect().stats, passive:state.passiveIncome}));
  assert.equal(economy.gold,baseline.gold,`${tag}: traversal and visual setup mint no gold ${JSON.stringify({baseline,economy})}`);
  assert.equal(await page.locator('.ck-exit-gate').textContent(),'نهاية مسار المناجم');

  // Release must still work if focus changes between keydown and keyup.
  await page.keyboard.down('ArrowLeft');
  await page.locator('#ck-map-panel summary').focus();
  await page.keyboard.up('ArrowLeft');
  assert.equal(await page.evaluate(() => DigSite.inspect().keys.l),false,`${tag}: focus change cannot leave movement held`);
  await page.evaluate(() => document.activeElement?.blur());
};
