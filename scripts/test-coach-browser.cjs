// Real Chromium E2E for the first-run coach (إرشاد أول مرة) — مستقل عن بقية المجموعات لأنه يختبر
// الطبقة التي كانت تحجب أزرار اللوحة في الاختبارات الأخرى:
//   1) جهاز جديد: الإرشاد يظهر، ثلاث خطوات، ثم يُغلق ويُحفظ ولا يعود بعد إعادة التحميل.
//   2) مسار «تخطّي الشرح» يُغلقه ويحفظ القرار فورًا.
//   3) جولة محفوظة متوقفة تنتظر «متابعة الجولة»: الإرشاد لا يغطيها (يحرس شرط maybeCoach).
// لا يغيّر سلوك اللعبة: كل ما يفعله هو نقر الأزرار التي ينقرها اللاعب.
// CHROMIUM_PATH=/path/to/chromium npm run test:coach
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser tests require a local development server, never a public deployment');

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium executable');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const report = { freshDevice: null, skipPath: null, restoredRound: null, errors };

  // لا يُزرع أي شيء هنا: كل سياق يبدأ كجهاز جديد لم يرَ الإرشاد
  async function context(viewport = { width: 390, height: 844 }) {
    const ctx = await browser.newContext({ viewport, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|favicon|fonts\.g|telegram\.org/.test(m.text())) errors.push(m.text()); });
    await page.route('**/*', (r) => (new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort()));
    await page.goto(base);
    await page.waitForFunction(() => window.PlatformGame && !document.getElementById('platform-start').disabled);
    return { ctx, page };
  }
  const coach = (page) => page.evaluate(() => ({
    hidden: document.getElementById('platform-coach').hidden,
    step: document.getElementById('coach-step').textContent,
    next: document.getElementById('coach-next').textContent,
    seen: localStorage.getItem('platform-coach:v1'),
  }));

  try {
    // ---------------------------------------------------------------- 1) جهاز جديد: يظهر، ثلاث خطوات، يُغلق، لا يعود
    {
      const { ctx, page } = await context();
      const first = await coach(page);
      assert.equal(first.hidden, false, 'جهاز جديد يرى الإرشاد');
      assert.equal(first.step, '1/3', 'يبدأ من الخطوة الأولى');
      assert.equal(first.next, 'التالي', 'زر التقدّم في الخطوة الأولى');
      assert.equal(first.seen, null, 'لا يُحفظ شيء قبل قرار اللاعب');

      await page.locator('#coach-next').click();
      assert.equal((await coach(page)).step, '2/3', 'الخطوة الثانية');
      await page.locator('#coach-next').click();
      const third = await coach(page);
      assert.equal(third.step, '3/3', 'الخطوة الثالثة');
      assert.equal(third.next, 'ابدأ', 'الخطوة الأخيرة تحوّل الزر إلى «ابدأ»');

      await page.locator('#coach-next').click();
      const done = await coach(page);
      assert.equal(done.hidden, true, 'الخطوة الثالثة تُغلق الإرشاد');
      assert.equal(done.seen, '1', 'الإغلاق محفوظ على الجهاز');

      // بعد الإغلاق تصبح أزرار اللوحة قابلة للنقر فعلًا (هذا بالضبط ما كان يفشل في بقية المجموعات)
      await page.locator('#platform-start').click();
      await page.waitForFunction(() => window.PlatformGame.inspect().running);

      await page.reload();
      await page.waitForFunction(() => window.PlatformGame && !document.getElementById('platform-start').disabled);
      assert.equal((await coach(page)).hidden, true, 'الإرشاد لا يعود على الجهاز نفسه');

      report.freshDevice = { steps: 3, closedWith: 'next', remembered: true, startClickable: true, hiddenAfterReload: true };
      await ctx.close();
    }

    // ---------------------------------------------------------------- 2) مسار «تخطّي الشرح»
    {
      const { ctx, page } = await context({ width: 320, height: 568 });
      assert.equal((await coach(page)).hidden, false, 'جهاز جديد آخر يرى الإرشاد');
      await page.locator('#coach-skip').click();
      const skipped = await coach(page);
      assert.equal(skipped.hidden, true, '«تخطّي» يُغلق الإرشاد فورًا');
      assert.equal(skipped.seen, '1', '«تخطّي» يُحفظ كذلك');
      // زر البدء صار حرًّا: النقر الحقيقي يجب أن يصل لا أن يُحجب
      await page.locator('#platform-start').click();
      await page.waitForFunction(() => window.PlatformGame.inspect().running);
      report.skipPath = { viewport: '320x568', hidden: true, remembered: true, startClickable: true };
      await ctx.close();
    }

    // ---------------------------------------------------------------- 3) جولة محفوظة متوقفة: لا يغطي «متابعة الجولة»
    {
      const { ctx, page } = await context();
      await page.locator('#coach-skip').click(); // لازم للعب: الإرشاد يغطي زر البدء على الجهاز الجديد
      await page.locator('#platform-start').click();
      await page.waitForFunction(() => window.PlatformGame.inspect().running);
      await page.waitForFunction((t) => window.PlatformGame.inspect().tick > t, await page.evaluate(() => window.PlatformGame.inspect().tick));
      await page.locator('#platform-pause').click();
      await page.waitForFunction(() => window.PlatformGame.inspect().paused);

      // نُمثّل جهازًا له جولة محفوظة ولم يُسجّل الإرشاد (علم مفقود أو نسخة أقدم من الميزة)
      await page.evaluate(() => localStorage.removeItem('platform-coach:v1'));
      await page.reload();
      await page.waitForFunction(() => window.PlatformGame?.inspect().paused);

      const restored = await coach(page);
      const state = await page.evaluate(() => window.PlatformGame.inspect());
      assert.equal(restored.seen, null, 'الشروط مطابقة: لا علم للإرشاد على هذا الجهاز');
      assert.equal(await page.locator('#platform-resume').isVisible(), true, '«متابعة الجولة» معروضة');
      assert.equal(state.paused, true, 'الجولة المستعادة متوقفة فعلًا (وهذا ما يجب ألا يغطيه الإرشاد)');
      assert.equal(restored.hidden, true, 'الإرشاد لا يغطي جولة محفوظة تنتظر الاستئناف');

      // النقر الحقيقي على «متابعة الجولة» يصل ويُكمل الجولة
      await page.locator('#platform-resume').click({ timeout: 5000 });
      await page.waitForFunction(() => window.PlatformGame.inspect().running);
      report.restoredRound = { coachHiddenOverResume: true, resumeClickable: true, resumed: true };
      await ctx.close();
    }

    assert.deepEqual(errors, [], `no page errors: ${JSON.stringify(errors)}`);
    console.log(JSON.stringify({ ok: true, report }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
