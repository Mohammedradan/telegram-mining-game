// Real Chromium E2E; run against a LOCAL development server, never production.
// CHROMIUM_PATH=/path/to/chromium npm run test:browser
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser tests require a local development server, never a public deployment');
const screenshots = path.join(__dirname, '../docs/media');
const read = page => page.evaluate(() => window.PlatformGame.inspect());
const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium executable');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const report = { viewports: [], networkRecovery: false, keyboardWin: false, cosmeticZones: false, regressionSmoke: false, errors };
  fs.mkdirSync(screenshots, { recursive: true });
  async function context(viewport, extras = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: true, ...extras });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    // The scene, style and fonts must work with all external resources unavailable.
    await page.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
    await page.goto(base);
    await page.waitForFunction(() => window.PlatformGame && !document.getElementById('platform-start').disabled);
    return { ctx, page };
  }
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
      const { ctx, page } = await context(viewport, { reducedMotion: 'reduce' });
      let starts = 0; page.on('request', req => { if (req.url().endsWith('/api/platform/start')) starts++; });
      await page.evaluate(() => { const b = document.getElementById('platform-start'); b.click(); b.click(); b.click(); });
      await page.waitForFunction(() => window.PlatformGame.inspect().running);
      assert.equal(starts, 1, 'double-click starts exactly one request/loop');
      assert.equal(await page.locator('#mission-gems').textContent(), '0/3', 'mission card starts empty');
      assert.equal(await page.locator('#mission-rocks').textContent(), '0/1');
      assert.equal(await page.locator('#ore-storage').count(), 1, 'ore storage panel is shipped');
      if (viewport.width === 390) {
        await page.locator('#platform-mute').click();
        assert.equal(await page.locator('#platform-mute').getAttribute('aria-pressed'), 'true');
        await page.keyboard.down('d'); await page.keyboard.down('ArrowRight');
        const bothHeld = await read(page);
        await page.waitForFunction(x => window.PlatformGame.inspect().x > x + 1, bothHeld.x, { timeout: 5000 });
        await page.keyboard.up('ArrowRight');
        const alias = await read(page);
        await page.waitForFunction(x => window.PlatformGame.inspect().x > x + 1, alias.x, { timeout: 5000 });
        await page.keyboard.up('d');
      }
      const bounds = await page.locator('.mine-controls').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height, `controls visible at ${viewport.width}x${viewport.height}`);
      const right = await page.locator('[data-platform-input="2"]').boundingBox();
      const jump = await page.locator('[data-platform-input="4"]').boundingBox();
      const cdp = await ctx.newCDPSession(page);
      // Some desktop WebViews overlay the controls with the bottom navigation;
      // only dispatch real touches where the buttons are actually hit-testable,
      // otherwise exercise the equivalent keyboard aliases.
      const touchReady = Boolean(right && jump) && await page.evaluate(([r, j]) => {
        const onButton = b => Boolean(document.elementFromPoint(b.x + 15, b.y + 15)?.closest('[data-platform-input]'));
        return onButton(r) && onButton(j);
      }, [right, jump]);
      if (touchReady) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: right.x + 15, y: right.y + 15, id: 1 }, { x: jump.x + 15, y: jump.y + 15, id: 2 }] });
      } else {
        await page.keyboard.down('ArrowRight'); await page.keyboard.down('Space');
      }
      // Poll instead of relying on one fixed sleep: CI runners can be slower.
      let jumped = await read(page);
      for (let i = 0; i < 20 && !(jumped.x > 64 && jumped.y < 260); i++) { await wait(50); jumped = await read(page); }
      assert.ok(jumped.x > 64, JSON.stringify({ viewport, jumped }));
      assert.ok(jumped.y < 260, 'movement and jump work simultaneously');
      if (touchReady) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else { await page.keyboard.up('Space'); await page.keyboard.up('ArrowRight'); }
      const released = await read(page); await wait(180);
      assert.equal((await read(page)).x, released.x, 'input release cannot latch direction');
      await page.locator('#platform-pause').click();
      const paused = await read(page); await wait(250); assert.equal((await read(page)).tick, paused.tick); assert.equal(paused.scheduled, false);
      await page.locator('#platform-resume').click();
      await page.waitForFunction(t => window.PlatformGame.inspect().tick > t, paused.tick, { timeout: 8000 });
      await page.locator('#nav-mining').click(); const left = await read(page); assert.equal(left.paused, true); await wait(100); assert.equal((await read(page)).tick, left.tick);
      await page.locator('#nav-play').click();
      await page.reload();
      await page.waitForFunction(() => window.PlatformGame?.inspect().paused);
      const restored = await read(page); assert.ok(restored.tick >= left.tick - 2); assert.equal(restored.scheduled, false);
      if (viewport.width === 390) assert.equal(await page.locator('#platform-mute').getAttribute('aria-pressed'), 'true', 'mute survives reload');
      await page.locator('#platform-resume').click(); await wait(50);
      if (viewport.width === 390) await page.screenshot({ path: path.join(screenshots, 'platform-mobile.png') });
      if (viewport.width === 320) await page.screenshot({ path: path.join(screenshots, 'platform-small-phone.png') });
      if (viewport.width === 844) await page.screenshot({ path: path.join(screenshots, 'platform-landscape.png') });
      report.viewports.push({ ...viewport, multiTouch: touchReady, pause: true, reloadResume: true, controlsVisible: true });
      await ctx.close();
    }
    const { ctx, page } = await context({ width: 390, height: 844 });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 3 });
    let blocked = true, committed = null;
    await page.route('**/api/platform/finish', async route => {
      if (!committed) {
        const response = await route.fetch();
        committed = await response.json();
        assert.equal(response.status(), 200);
        await route.abort(); // lose the response AFTER the database commit
      } else if (blocked) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"simulated offline"}' });
      else await route.continue();
    });
    await page.locator('#platform-start').click();
    await page.waitForFunction(() => window.PlatformGame.inspect().running);
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('e');
    let jumping = false;
    const winStart = Date.now();
    const deadline = winStart + 140000;
    while (Date.now() < deadline) {
      const state = await read(page);
      if (state.status !== 'playing') break;
      const jump = [[665, 740], [1140, 1220], [1470, 1550], [2020, 2110]].some(([a, b]) => state.x > a && state.x < b);
      if (jump !== jumping) { jumping = jump; if (jump) await page.keyboard.down('Space'); else await page.keyboard.up('Space'); }
      await wait(20);
    }
    await page.keyboard.up('ArrowRight'); await page.keyboard.up('e'); await page.keyboard.up('Space');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const final = await read(page); assert.equal(await page.evaluate(() => adv.running), false, 'platform Space cannot start a hidden legacy game'); report.throttledRound = { cpuRate: 3, wallSeconds: (Date.now() - winStart) / 1000, simulationSeconds: final.tick / 60 }; assert.equal(final.status, 'won', `throttled round: ${JSON.stringify({ tick: final.tick, x: final.x, hearts: final.hearts })}`); assert.ok(final.mined >= 1); assert.ok(final.gems >= 3);
    await page.waitForFunction(() => document.getElementById('mission-gems').textContent === '3/3');
    assert.equal(await page.locator('#mission-rocks').textContent(), '1/1', 'mission card reflects the broken rock');
    assert.ok(final.floatersSpawned > 0, 'floating impact numbers spawned during the winning run');
    assert.ok(final.comboPeak >= 1, 'mining combo was exercised');
    assert.ok(final.milestones >= 2, `winning run unlocks milestones, got ${final.milestones}`);
    assert.ok(Object.values(final.ores).some(v => v > 0), 'winning run yields ores');
    assert.equal(await page.locator('#milestone-count').textContent(), `${final.milestones}/5`);
    assert.equal(await page.locator('#mission-milestones').textContent(), `${final.milestones}/5`);
    await page.waitForFunction(() => !document.getElementById('platform-retry').hidden);
    assert.deepEqual(committed.ores, final.ores, 'server receipt credits exactly the replayed ores');
    assert.equal(committed.milestoneGold + committed.finalGold, committed.gold, 'milestones and win split the same capped reward');
    assert.ok(Array.isArray(committed.milestones) && committed.milestones.length === final.milestones);
    report.feel = { floatersSpawned: final.floatersSpawned, comboPeak: final.comboPeak, missionComplete: true,
      milestones: final.milestones, ores: final.ores, goldSplit: { milestone: committed.milestoneGold, final: committed.finalGold } };
    assert.equal(committed.won, true); assert.ok(committed.gold > 0 && committed.gold <= 100);
    assert.equal((await read(page)).pending, true);
    await page.reload();
    await page.waitForFunction(() => window.PlatformGame?.inspect().pending && !document.getElementById('platform-retry').hidden);
    blocked = false;
    await page.locator('#platform-retry').click();
    await page.waitForFunction(() => !window.PlatformGame.inspect().pending);
    const confirmed = await page.locator('#platform-status').textContent();
    assert.match(confirmed, /بلا مكافأة مكررة/);
    const savedGold = await page.evaluate(async () => (await window.PlatformBridge.request('/api/me')).state.gold);
    assert.equal(savedGold, committed.gold, 'reload/lost response never doubles gold');
    await page.screenshot({ path: path.join(screenshots, 'platform-victory.png'), timeout: 60000 });
    // The focused side-scroller intentionally hides the secondary play sub-nav.
    assert.equal(await page.locator('#platform-scene').isVisible(), true);
    assert.equal(await page.locator('.play-subnav').isVisible(), false, 'the play sub-nav stays hidden in the focused view');
    assert.equal(await page.locator('#stars-shop').count(), 0, 'no real-money shop is introduced');
    assert.equal(await page.locator('#legacy-adventure').isVisible(), false, 'the side-scroller remains the default play view');
    assert.equal(await page.evaluate(() => adv.running), false, 'the hidden legacy round stays stopped');
    await page.locator('#nav-arena').click(); assert.equal(await page.locator('#arena-start-btn').isVisible(), true);
    await page.locator('#arena-start-btn').click(); assert.equal(await page.evaluate(() => document.getElementById('arena-start-btn').disabled), true);
    // Corrupt/expired local receipts must not permanently lock the start button.
    await page.locator('#nav-play').click();
    await page.evaluate(() => {
      const owner = window.PlatformBridge.user();
      localStorage.setItem(`platform-run:v1:${owner}`, JSON.stringify({ version: 1, ticket: { id: 'missing-expired-ticket' }, inputs: [{ mask: 0, frames: 9000 }], finished: true }));
    });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('platform-start').disabled);
    assert.equal((await read(page)).pending, false, 'a stale receipt cannot lock the start button or create a pending reward');
    assert.equal(await page.locator('#platform-discard').isVisible(), false, 'stale receipts are ignored, not retried');
    report.networkRecovery = true; report.keyboardWin = true; report.regressionSmoke = true;
    assert.deepEqual(errors, []);
    await ctx.close();
    // The cosmetic run zones shipped with the v2 engine must reach the browser HUD.
    const zoneContext = await context({ width: 390, height: 844 });
    const zonePage = zoneContext.page;
    assert.equal(await zonePage.evaluate(() => window.PlatformRules.ZONES.length), 4, 'four cave themes are shipped');
    await zonePage.locator('#platform-start').click();
    await zonePage.waitForFunction(() => window.PlatformGame.inspect().running);
    const zoneState = await read(zonePage);
    assert.ok(zoneState.zone >= 0 && zoneState.zone < 4, 'the run has a valid zone');
    assert.match(await zonePage.locator('#platform-progress').textContent(), /كهف|مناجم|الأعماق/, 'HUD shows the cave name');
    report.cosmeticZones = { zone: zoneState.zone, name: await zonePage.evaluate(i => window.PlatformRules.ZONES[i].name, zoneState.zone) };
    await zonePage.locator('#platform-pause').click();
    assert.deepEqual(errors, []);
    await zoneContext.ctx.close();
    // ورشة المعدّن — معاينة بصرية تفاعلية على العميل فقط.
    const wsContext = await context({ width: 390, height: 844 }, { reducedMotion: 'reduce' });
    const wsPage = wsContext.page;
    await wsPage.locator('#open-workshop-heading').click();
    await wsPage.waitForFunction(() => !document.getElementById('ws-overlay').hidden);
    assert.equal(await wsPage.locator('.ws-node').count(), 8, 'eight equipment nodes surround the miner');
    assert.equal(await wsPage.locator('#ws-hero').isVisible(), true, 'the miner is drawn in the centre');
    await wsPage.locator('[data-ws-item="pickaxe"]').click();
    await wsPage.waitForFunction(() => !document.getElementById('ws-modal').hidden);
    assert.equal(await wsPage.locator('#ws-card-title').textContent(), 'قوة المعول');
    const lvlBefore = await wsPage.locator('#ws-card-level').textContent();
    await wsPage.locator('#ws-upgrade').click();
    const lvlAfter = await wsPage.locator('#ws-card-level').textContent();
    assert.equal(Number(lvlAfter), Number(lvlBefore) + 1, 'the preview upgrade increments a local level');
    await wsPage.locator('#ws-modal-close').click();
    await wsPage.locator('#ws-close').click();
    assert.equal(await wsPage.locator('#ws-overlay').isVisible(), false);
    for (const entry of ['open-workshop-heading', 'open-workshop-overlay', 'open-workshop-shop']) {
      await wsPage.evaluate(id => { window.closeWorkshop(); document.getElementById(id).click(); }, entry);
      assert.equal(await wsPage.evaluate(() => !document.getElementById('ws-overlay').hidden), true, `${entry} opens the preview`);
    }
    await wsPage.locator('#ws-cta').click();
    await wsPage.waitForFunction(() => window.PlatformGame.inspect().running);
    assert.equal(await wsPage.locator('#ws-overlay').isVisible(), false, 'the CTA closes the preview and starts a run');
    report.workshop = { nodes: 8, minerDrawn: true, upgrade: `${lvlBefore}→${lvlAfter}`, clientOnly: true, ctaStartsRun: true };
    // The full-screen layout must not overlap on short landscape viewports.
    const wsLand = await context({ width: 844, height: 390 }, { reducedMotion: 'reduce' });
    const landPage = wsLand.page;
    await landPage.evaluate(() => window.openWorkshop());
    await landPage.waitForFunction(() => !document.getElementById('ws-overlay').hidden);
    const overlayBox = await landPage.locator('#ws-overlay').boundingBox();
    assert.equal(Math.round(overlayBox.width), 844, 'the workshop fills the landscape width');
    const ringBox = await landPage.locator('.ws-ring').boundingBox();
    const ctaBox = await landPage.locator('#ws-cta').boundingBox();
    assert.ok(ringBox.y + ringBox.height <= ctaBox.y + 1, 'the equipment ring stays above the CTA');
    assert.ok(ctaBox.y + ctaBox.height <= 390, 'the CTA stays inside the viewport');
    report.workshop.landscape = true;
    assert.deepEqual(errors, []);
    await wsLand.ctx.close();
    await wsContext.ctx.close();
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.race([browser.close(), wait(3000)]);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
