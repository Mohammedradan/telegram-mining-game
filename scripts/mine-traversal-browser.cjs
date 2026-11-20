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
  for (let index=0; index<1; index++) {
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
      await page.waitForFunction(() => DigSite.inspect().mine.mode === 'overland', null, { timeout: 30000 }).catch(async () => {
        throw new Error(`overland timeout: ${JSON.stringify(await page.evaluate(() => ({ mine: DigSite.inspect().mine, miner: DigSite.inspect().miner, band: DigSite.inspect().band, keys: DigSite.inspect().keys })))}`);
      });
    } finally { await page.keyboard.up('ArrowRight'); }
    const direction = await page.evaluate(() => DigSite.inspect().mine.travelDirection < 0 ? 'ArrowLeft' : 'ArrowRight');
    // Find a cross-track lane that physically intersects the boulder but clears
    // every earlier obstacle with room for movement-step and collision margins.
    const boulder = await page.evaluate((travel) => {
      const state = DigSite.inspect(), aspect = Math.max(0.2, state.size.W / state.size.H);
      const obstacles = MineWorld.routeObstacles(state.mine);
      const rock = obstacles.find((item) => item.id === 'boulder');
      if (!rock) return null;
      const before = obstacles.filter((item) => item !== rock &&
        (travel === 'ArrowLeft' ? item.x > rock.x : item.x < rock.x));
      const limits = DigSite.CFG.BAND, clearance = 0.04, laneTolerance = 0.025;
      const rockAllowance = rock.radius * 0.65, candidates = [];
      for (let step = 0; step <= 1000; step++) {
        const y = limits.y0 + (limits.y1 - limits.y0) * step / 1000;
        if (Math.abs(y - rock.y) / aspect > rockAllowance) continue;
        if (before.some((item) => Math.abs(y - item.y) / aspect < item.radius + clearance)) continue;
        candidates.push(y);
      }
      if (!candidates.length) return { y: null, rockY: rock.y, radius: rock.radius, aspect, before };
      const y = candidates.reduce((best, candidate) =>
        Math.abs(candidate - state.miner.y) < Math.abs(best - state.miner.y) ? candidate : best);
      return { y, rockY: rock.y, radius: rock.radius, aspect, before, laneTolerance };
    }, direction);
    assert.ok(boulder && Number.isFinite(boulder.y),
      `${tag}: find a lane that hits the boulder and clears the previous obstacle (${JSON.stringify(boulder)})`);
    const lane = await page.evaluate(({ y, laneTolerance }) => {
      const state = DigSite.inspect(), aspect = Math.max(0.2, state.size.W / state.size.H);
      if (Math.abs(state.miner.y - y) / aspect < laneTolerance) return null;
      return state.miner.y < y ? 'ArrowDown' : 'ArrowUp';
    }, boulder);
    if (lane) {
      await page.keyboard.down(lane);
      try {
        await page.waitForFunction(({ y, laneTolerance }) => {
          const state = DigSite.inspect(), aspect = Math.max(0.2, state.size.W / state.size.H);
          return Math.abs(state.miner.y - y) / aspect < laneTolerance;
        }, boulder, { timeout: 8000 });
      } finally { await page.keyboard.up(lane); }
    }
    // The obstacle is reported only on the frames where it really stops the miner,
    // so the snapshot is taken inside the same frame that satisfies the wait
    // (reading it after the key is released would always see `null`).
    let blocked;
    await page.keyboard.down(direction);
    try {
      const handle = await page.waitForFunction(() => {
        const mine = DigSite.inspect().mine;
        return mine.mode === 'overland' && mine.lastObstacle === 'boulder' ? { index: mine.index, lastObstacle: mine.lastObstacle } : null;
      }, null, { timeout: 30000 }).catch(async () => {
        throw new Error(`boulder timeout: ${JSON.stringify(await page.evaluate(() => ({ mine: DigSite.inspect().mine, miner: DigSite.inspect().miner, route: MineWorld.routeObstacles(DigSite.inspect().mine), keys: DigSite.inspect().keys })))}`);
      });
      blocked = await handle.jsonValue();
    } finally { await page.keyboard.up(direction); }
    assert.equal(blocked.index, index, `${tag}: the boulder blocks cave progression until bypassed`);
    assert.equal(blocked.lastObstacle, 'boulder', `${tag}: the route reports the physical obstacle`);
    const vertical = await page.evaluate(({ rockY, radius }) => {
      const state = DigSite.inspect(), aspect = Math.max(0.2, state.size.W / state.size.H), band = DigSite.CFG.BAND;
      const preferred = state.miner.y <= rockY ? 'ArrowUp' : 'ArrowDown';
      const canUp = (rockY - band.y0) / aspect > radius * 1.2;
      const canDown = (band.y1 - rockY) / aspect > radius * 1.2;
      if (preferred === 'ArrowUp' && !canUp && canDown) return 'ArrowDown';
      if (preferred === 'ArrowDown' && !canDown && canUp) return 'ArrowUp';
      return preferred;
    }, { rockY: boulder.rockY, radius: boulder.radius });
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
  const exitText = await page.locator('.ck-exit-gate').textContent();
  assert.ok(['آخر منجم · العودة يساراً', 'انهيار صخري · اكسر 3 صخور'].includes(exitText), `${tag}: the cave advertises its real exit/blocked route`);

  // Release must still work if focus changes between keydown and keyup.
  await page.keyboard.down('ArrowLeft');
  await page.locator('#ck-map-panel summary').focus();
  await page.keyboard.up('ArrowLeft');
  assert.equal(await page.evaluate(() => DigSite.inspect().keys.l),false,`${tag}: focus change cannot leave movement held`);
  await page.evaluate(() => document.activeElement?.blur());
};
