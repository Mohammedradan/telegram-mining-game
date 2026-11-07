// اختبار بصري حقيقي للساحة — يحتاج متصفح Chromium مُثبَّتًا (لا يعمل داخل بيئة بلا متصفح).
//   CHROMIUM_PATH=/path/to/chrome npm run test:visual
// يفتح اللعبة محليًا، يلتقط لقطات للكمبيوتر والجوال، ويفشل إذا كان المسرح فارغًا أو مقصوصًا
// أو إذا ظهرت أزرار لمس على الكمبيوتر (أو اختفت على الجوال)، أو بدأت جولة تلقائيًا.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Visual tests require a local development server');
const outDir = path.join(__dirname, '../docs/media');
const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900, touch: false },
  { name: 'desktop-1280', width: 1280, height: 800, touch: false },
  { name: 'phone-390', width: 390, height: 844, touch: true },
  { name: 'phone-360', width: 360, height: 740, touch: true },
];

async function canvasStats(page, selector) {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel);
    if (!canvas) return { missing: true };
    const box = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    if (!width || !height || !ctx) return { box: { w: box.width, h: box.height }, width, height, colors: 0, lit: 0 };
    const data = ctx.getImageData(0, 0, width, height).data;
    const colors = new Set();
    let lit = 0, samples = 0;
    for (let i = 0; i + 3 < data.length; i += 4 * 53) {
      colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      if (data[i] + data[i + 1] + data[i + 2] > 120) lit++;
      samples++;
    }
    return { box: { w: box.width, h: box.height }, width, height, colors: colors.size, lit, samples };
  }, selector);
}

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', chromium.executablePath()].find((p) => p && fs.existsSync(p));
  if (!executablePath) throw new Error('No Chromium found. Set CHROMIUM_PATH=/path/to/chrome');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];
  const errors = [];
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${vp.name}: ${e.message}`));
      await page.route('**/*', (r) => (new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort()));
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.PlatformGame && typeof window.PlatformGame.arenaInspect === 'function');

      // 1) لا شيء يبدأ تلقائيًا عند الفتح
      assert.equal(await page.evaluate(() => window.PlatformGame.busy().running), false, `${vp.name}: no run on boot`);

      // 2) الساحة: مسرح حيّ بمشهد حقيقي
      await page.locator('#nav-arena').click();
      await page.waitForTimeout(700);
      const before = await page.evaluate(() => window.PlatformGame.arenaInspect());
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => window.PlatformGame.arenaInspect());
      assert.ok(after.tick > before.tick, `${vp.name}: the arena preview loop advances (${before.tick} -> ${after.tick})`);

      const stats = await canvasStats(page, '#arena-preview');
      assert.ok(!stats.missing, `${vp.name}: #arena-preview exists`);
      const minW = vp.touch ? 260 : 420, minH = vp.touch ? 150 : 220;
      assert.ok(stats.box.w >= minW && stats.box.h >= minH, `${vp.name}: stage is big enough (${Math.round(stats.box.w)}x${Math.round(stats.box.h)})`);
      assert.ok(stats.width >= minW && stats.height >= minH, `${vp.name}: canvas bitmap matches its box (${stats.width}x${stats.height})`);
      assert.ok(stats.colors >= 24, `${vp.name}: the scene is painted, not blank (${stats.colors} distinct colours)`);
      assert.ok(stats.lit > 20, `${vp.name}: visible content above the dark background (${stats.lit}/${stats.samples})`);

      // 3) سلّم المبارزين: ثلاثة صفوف قابلة للاختيار، وتسمية الخصم تتغيّر بالاختيار
      const rows = page.locator('#arena-ladder .al-row');
      assert.equal(await rows.count(), 3, `${vp.name}: three real rivals in the ladder`);
      const rivalBefore = await page.locator('#arena-preview-rival').textContent();
      await rows.nth(1).click();
      await page.waitForTimeout(300);
      const rivalAfter = await page.locator('#arena-preview-rival').textContent();
      assert.notEqual(rivalAfter, rivalBefore, `${vp.name}: picking a rival changes the live stage`);

      // 4) أزرار اللمس: مخفية على الكمبيوتر وظاهرة على الجوال
      const pad = await page.evaluate(() => ({
        stick: getComputedStyle(document.getElementById('virtual-joystick')).display,
        attack: getComputedStyle(document.querySelector('[data-platform-input="16"]')).display,
        pause: getComputedStyle(document.getElementById('platform-pause')).display,
      }));
      assert.notEqual(pad.pause, 'none', `${vp.name}: pause stays reachable`);
      if (vp.touch) {
        assert.notEqual(pad.stick, 'none', `${vp.name}: the joystick is visible on touch devices`);
        assert.notEqual(pad.attack, 'none', `${vp.name}: combat buttons are visible on touch devices`);
      } else {
        assert.equal(pad.stick, 'none', `${vp.name}: no joystick on desktop`);
        assert.equal(pad.attack, 'none', `${vp.name}: no touch combat buttons on desktop`);
      }

      // 5) لا قصّ ولا تمرير أفقي، والمسرح كله داخل الشاشة
      const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(overflow.sw <= overflow.cw + 1, `${vp.name}: no horizontal overflow (${overflow.sw} > ${overflow.cw})`);
      const stage = await page.locator('#arena-stage').boundingBox();
      assert.ok(stage.x >= -1 && stage.x + stage.width <= vp.width + 1, `${vp.name}: the stage is not clipped horizontally`);
      assert.ok(stage.y + stage.height <= vp.height + 1, `${vp.name}: the stage fits above the fold`);

      await page.screenshot({ path: path.join(outDir, `arena-${vp.name}.png`), fullPage: false });

      // 6) الزر يبدأ مبارزة فعلية (فقط عند الضغط) — ثم نتخلّى عنها بلا مكافأة
      await page.locator('#arena-duel-btn').click();
      await page.waitForFunction(() => window.PlatformGame.busy().running === true, { timeout: 15000 });
      await page.waitForTimeout(400);
      const playCanvas = await canvasStats(page, '#platform-canvas');
      assert.ok(playCanvas.colors >= 24, `${vp.name}: the duel scene in the play tab is painted`);
      // شريط صحة الخصم داخل المشهد أثناء المبارزة
      assert.equal(await page.locator('#stage-foe').isVisible(), true, `${vp.name}: the rival health bar is visible during the duel`);
      const foeBar = await page.evaluate(() => document.getElementById('stage-foe-fill').style.width);
      assert.match(foeBar, /^[0-9.]+%$/, `${vp.name}: the rival bar is driven by real hp (${foeBar})`);
      await page.screenshot({ path: path.join(outDir, `duel-${vp.name}.png`) });
      await page.locator('#nav-arena').click();
      await page.evaluate(() => window.PlatformGame.abandon());

      report.push({ viewport: `${vp.width}x${vp.height}`, touch: vp.touch, stage: `${Math.round(stats.box.w)}x${Math.round(stats.box.h)}`, colors: stats.colors, rivalSwitch: true, pad });
      await ctx.close();
    }
    assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
    fs.writeFileSync(path.join(outDir, 'visual-report.json'), JSON.stringify({ at: new Date().toISOString(), report, errors }, null, 2));
    console.log('visual checks passed');
    console.table(report);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
