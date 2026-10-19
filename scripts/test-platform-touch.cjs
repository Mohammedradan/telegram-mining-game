// Full mobile acceptance path: real CDP touch events, never keyboard movement,
// injected simulation state, or fabricated scores. Run only on a local dev server.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Touch tests require a local development server');
const read = page => page.evaluate(() => window.PlatformGame.inspect());
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const media = path.join(__dirname, '../docs/media');

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('Install Chromium or set CHROMIUM_PATH');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage(), errors = [], submitted = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/platform/finish') submitted.push(request.postDataJSON()); });
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await page.goto(base);
    await page.waitForFunction(() => window.PlatformGame && !document.getElementById('platform-start').disabled);
    await page.locator('#platform-start').tap();
    await page.waitForFunction(() => window.PlatformGame.inspect().running);
    // Range keyboard navigation must affect only audio, not left/right movement.
    await page.locator('#platform-volume').focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    assert.equal((await read(page)).volume, .15);
    assert.equal((await read(page)).x, 64);
    await page.locator('#platform-mute').tap(); assert.equal((await read(page)).muted, true);
    await page.locator('#platform-mute').tap(); assert.equal((await read(page)).muted, false);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
    const point = async (mask, id) => {
      const box = await page.locator(`[data-platform-input="${mask}"]`).boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, id };
    };
    const right = await point(2, 1), mine = await point(8, 2), jump = await point(4, 3);
    let touching = false, jumping = false, checkpointRestored = false, sawJump = false;
    async function holdJump(wanted) {
      if (touching && wanted === jumping) return;
      // CDP touchEnd lists the fingers to END, not the remaining held fingers.
      const touchPoints = !touching ? (wanted ? [right, mine, jump] : [right, mine]) : [jump];
      await cdp.send('Input.dispatchTouchEvent', { type: !touching || wanted ? 'touchStart' : 'touchEnd', touchPoints });
      touching = true; jumping = wanted;
    }
    async function release() {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      touching = false; jumping = false;
    }
    const started = Date.now(), deadline = started + 90000;
    await holdJump(false);
    while (Date.now() < deadline) {
      const state = await read(page);
      if (state.status !== 'playing') break;
      sawJump ||= state.y < 245;
      if (!checkpointRestored && state.checkpoint === 920) {
        await release();
        assert.match(await page.locator('#platform-feedback').textContent(), /راية مفعّلة/);
        fs.mkdirSync(media, { recursive: true });
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, optimizeForSpeed: true });
        fs.writeFileSync(path.join(media, 'platform-touch-checkpoint.png'), Buffer.from(shot.data, 'base64'));
        const saved = await read(page);
        await page.reload();
        await page.waitForFunction(() => window.PlatformGame?.inspect().paused);
        const restored = await read(page);
        assert.equal(restored.checkpoint, 920); assert.ok(Math.abs(restored.x - saved.x) < 8);
        assert.equal(restored.gems, saved.gems); assert.equal(restored.mined, saved.mined);
        assert.equal(restored.scheduled, false); assert.equal(restored.volume, .15);
        await page.locator('#platform-resume').tap();
        checkpointRestored = true;
        continue;
      }
      await holdJump([[665, 740], [1140, 1220], [1470, 1550], [2020, 2110]].some(([a,b]) => state.x > a && state.x < b));
      await wait(20);
    }
    await release();
    const final = await read(page);
    assert.equal(final.status, 'won', JSON.stringify(final));
    assert.ok(sawJump && checkpointRestored); assert.ok(final.mined >= 1 && final.gems >= 3);
    await page.waitForFunction(() => !window.PlatformGame.inspect().pending && document.getElementById('platform-status').textContent.includes('محفوظ على الخادم'));
    assert.equal(submitted.length, 1);
    const profile = await page.evaluate(async () => await window.PlatformBridge.request('/api/me'));
    const gold = profile.state.gold;
    assert.ok(gold > 0 && gold <= 100); assert.equal(profile.state.adventure.runs, 1);
    // Same legal input and operation ID: replaying HTTP can only confirm the receipt.
    const duplicate = await page.evaluate(async payload => window.PlatformBridge.request('/api/platform/finish', {method:'POST',body:JSON.stringify(payload)}), submitted[0]);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.profile.state.gold, gold);
    await page.reload();
    await page.waitForFunction(() => window.PlatformGame && !document.getElementById('platform-start').disabled);
    const persisted = await page.evaluate(async () => await window.PlatformBridge.request('/api/me'));
    assert.equal(persisted.state.gold, gold); assert.equal(persisted.state.adventure.runs, 1);
    assert.equal((await read(page)).running, false);
    assert.equal((await read(page)).volume, .15);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ touchWin: true, simultaneousFingers: 3, viewport: '390x844', deviceScaleFactor: 2, cpuRate: 2, checkpointReload: checkpointRestored, duplicateRewardPrevented: true, savedGold: gold, mined: final.mined, gems: final.gems, wallSeconds: (Date.now()-started)/1000, simulationSeconds: final.tick/60, errors }, null, 2));
    await ctx.close();
  } finally { await Promise.race([browser.close(), wait(3000)]); }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
