// Real Chromium E2E; run against a LOCAL development server, never production.
// CHROMIUM_PATH=/path/to/chromium npm run test:browser (install dev dependencies first)
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
  const report = { viewports: [], networkRecovery: false, keyboardWin: false, regressionSmoke: false, errors };
  fs.mkdirSync(screenshots, { recursive: true });
  async function context(viewport, extras = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: true, ...extras });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    // The scene, style and fonts must work with all external resources unavailable.
    await page.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
    await page.goto(base);
    await page.waitForFunction(() => window.PlatformGame && !document.getElementById('platform-start').disabled);
    await page.locator('#platform-mode').click();
    return { ctx, page };
  }
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
      console.log('Viewport', viewport);
      const { ctx, page } = await context(viewport, { reducedMotion: 'reduce' });
      let starts = 0; page.on('request', req => { if (req.url().endsWith('/api/platform/start')) starts++; });
      await page.evaluate(() => { const b = document.getElementById('platform-start'); b.click(); b.click(); b.click(); });
      await page.waitForFunction(() => window.PlatformGame.inspect().running);
      assert.equal(starts, 1, 'double-click starts exactly one request/loop');
      if (viewport.width === 390) {
        await page.locator('#platform-mute').click();
        assert.equal(await page.locator('#platform-mute').getAttribute('aria-pressed'), 'true');
        await page.keyboard.down('d'); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
        const alias = await read(page); await wait(100); assert.ok((await read(page)).x > alias.x, 'releasing one alias does not cancel the other');
        await page.keyboard.up('d');
      }
      const bounds = await page.locator('.mine-controls').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, 'touch controls fit horizontally');
      assert.equal(await page.locator('#platform-mute').isVisible(), true, 'mute remains accessible on short screens');
      assert.ok(bounds.y + bounds.height <= viewport.height, `controls visible at ${viewport.width}x${viewport.height}`);
      const right = await page.locator('[data-platform-input="2"]').boundingBox();
      const jump = await page.locator('[data-platform-input="4"]').boundingBox();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: right.x + 15, y: right.y + 15, id: 1 }, { x: jump.x + 15, y: jump.y + 15, id: 2 }] });
      await wait(140);
      const jumped = await read(page); assert.ok(jumped.x > 64); assert.ok(jumped.y < 260, 'touch movement and jump work simultaneously');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.locator('#platform-pause').click();
      const paused = await read(page); await wait(250); assert.equal((await read(page)).tick, paused.tick); assert.equal(paused.scheduled, false);
      await page.locator('#platform-resume').click(); await wait(100); assert.ok((await read(page)).tick > paused.tick);
      await page.locator('#nav-mining').click(); const left = await read(page); assert.equal(left.paused, true); await wait(100); assert.equal((await read(page)).tick, left.tick);
      await page.locator('#nav-play').click();
      await page.reload();
      await page.waitForFunction(() => window.PlatformGame?.inspect().paused);
      await page.locator('#platform-mode').click();
      const restored = await read(page); assert.ok(restored.tick >= left.tick - 2); assert.equal(restored.scheduled, false);
      if (viewport.width === 390) assert.equal(await page.locator('#platform-mute').getAttribute('aria-pressed'), 'true');
      await page.locator('#platform-resume').click(); await wait(50);
      if (viewport.width === 320) await page.screenshot({ path: path.join(screenshots, 'platform-small-phone.png') });
      if (viewport.width === 844) await page.screenshot({ path: path.join(screenshots, 'platform-landscape.png') });
      report.viewports.push({ ...viewport, multiTouch: true, pause: true, reloadResume: true, controlsVisible: true });
      await ctx.close();
    }
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      let release, entered;
      const gate = new Promise(r => { release = r; });
      const requested = new Promise(r => { entered = r; });
      await page.route('**/api/platform/start', async route => { entered(); await gate; await route.continue(); });
      await page.locator('#platform-start').click(); await requested;
      await page.locator('#nav-mining').click(); release();
      await page.waitForFunction(() => window.PlatformGame.inspect().running);
      const late = await read(page); assert.equal(late.paused, true); assert.equal(late.scheduled, false);
      await page.locator('#nav-play').click(); await page.locator('#platform-resume').click();
      await wait(100); assert.ok((await read(page)).tick > late.tick);
      await ctx.close(); report.lateStartPause = true;
    }
    const { ctx, page } = await context({ width: 390, height: 844 });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
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
    let jumping = false, photographed = false;
    const deadline = Date.now() + 50000;
    while (Date.now() < deadline) {
      const state = await read(page);
      if (state.status !== 'playing') break;
      const jump = [[665, 740], [1140, 1220], [1470, 1550], [2020, 2110]].some(([a, b]) => state.x > a && state.x < b);
      if (jump !== jumping) { jumping = jump; if (jump) await page.keyboard.down('Space'); else await page.keyboard.up('Space'); }
      if (state.x > 1000 && !photographed) { photographed = true; await page.screenshot({ path: path.join(screenshots, 'platform-mobile.png') }); }
      await wait(20);
    }
    await page.keyboard.up('ArrowRight'); await page.keyboard.up('e'); await page.keyboard.up('Space');
    const final = await read(page); assert.equal(final.status, 'won'); assert.ok(final.mined >= 1); assert.ok(final.gems >= 3);
    await page.waitForFunction(() => !document.getElementById('platform-retry').hidden);
    assert.equal(committed.won, true); assert.ok(committed.gold > 0 && committed.gold <= 100);
    assert.equal((await read(page)).pending, true);
    await page.reload();
    await page.waitForFunction(() => window.PlatformGame?.inspect().pending && !document.getElementById('platform-retry').hidden);
    blocked = false;
    await page.locator('#platform-mode').click();
    await page.locator('#platform-retry').click();
    await page.waitForFunction(() => !window.PlatformGame.inspect().pending);
    const confirmed = await page.locator('#platform-status').textContent();
    assert.match(confirmed, /بلا مكافأة مكررة/);
    const savedGold = await page.evaluate(async () => (await window.PlatformBridge.request('/api/me')).state.gold);
    assert.equal(savedGold, committed.gold, 'reload/lost response never doubles gold');
    await page.screenshot({ path: path.join(screenshots, 'platform-victory.png') });
    await page.locator('#play-nav-missions').click(); assert.equal(await page.locator('#daily-btn').isVisible(), true);
    await page.locator('#play-nav-customize').click(); assert.equal(await page.locator('#adv-upgrades-list').isVisible(), true);
    await page.locator('#nav-shop').click(); assert.equal(await page.locator('#btn-upgrade-click').isVisible(), true);
    await page.locator('#btn-upgrade-click').click();
    await page.evaluate(() => window.PlatformBridge.flush());
    const bought = await page.evaluate(async () => await window.PlatformBridge.request('/api/me'));
    assert.equal(bought.state.owned.click, 1, 'existing gold shop still persists purchases');
    assert.equal(bought.state.gold, savedGold - 50);
    await page.locator('#nav-play').click(); await page.locator('#play-nav-adventure').click(); await page.locator('#legacy-mode').click();
    await page.locator('#game-overlay-btn').click(); await wait(250);
    assert.equal(await page.evaluate(() => adv.running), true);
    await page.locator('#nav-arena').click(); assert.equal(await page.locator('#arena-start-btn').isVisible(), true);
    await page.locator('#arena-start-btn').click(); assert.equal(await page.evaluate(() => document.getElementById('arena-start-btn').disabled), true);
    // Corrupt/expired local receipts must not permanently lock the start button.
    await page.locator('#nav-play').click(); await page.locator('#platform-mode').click();
    await page.evaluate(() => {
      const owner = window.PlatformBridge.user();
      localStorage.setItem(`platform-run:v1:${owner}`, JSON.stringify({ version: 1, ticket: { id: 'missing-expired-ticket' }, inputs: [{ mask: 0, frames: 9000 }], finished: true }));
    });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('platform-discard').hidden);
    await page.locator('#platform-mode').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#platform-discard').click();
    assert.equal(await page.locator('#platform-start').isDisabled(), false);
    assert.equal((await read(page)).pending, false);
    report.networkRecovery = true; report.keyboardWin = true; report.regressionSmoke = true;
    assert.deepEqual(errors, []);
    await ctx.close();
    fs.writeFileSync(path.join(screenshots, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.race([browser.close(), wait(3000)]);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
