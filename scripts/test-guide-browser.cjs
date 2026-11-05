// Real Chromium E2E for the guide ("العم سراج": goal, codex, story). Run against a LOCAL development server, never production:
//   CHROMIUM_PATH=/path/to/chromium npm run test:guide
// It plays the guide the way a player meets it: a brand-new guest sees the button and the dot, opens the window, reads the three
// tabs, reads a chapter, and the dot is gone after a reload. Then the guest's progress is moved through the dev SQLite file (the same
// trick as test:bosses) so the guide's other states are real: a newly opened mine turns the button into "new chapter", the goal asks for a
// win / for gear, its buttons really open the workshop or pick the mine, a veteran is not flooded with "new" chapters, and the
// epilogue and the codex open up. It also proves the guide is read-only (no network write, no change to gold/energy), keeps a paused
// round paused, and fits phones (320x568, 390x844) and a landscape phone (844x390). Writes docs/media/guide-*.jpg.
// FONT_STRESS=1.4 npm run test:guide repeats it with every glyph spread by 1.4px (a wider font, as on the CI runner).
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');
const { createStore } = require('../db');

const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser tests require a local development server, never a public deployment');
const media = path.join(__dirname, '../docs/media');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(media, name), type: 'jpeg', quality: 80, timeout: 90000 });
const MAXED = Object.fromEntries(R.EQUIPMENT_ORDER.map((id) => [id, R.MAX_EQUIP_LEVEL]));

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium executable');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], report = { newPlayer: null, progress: null, veteran: null, phones: [], errors };
  fs.mkdirSync(media, { recursive: true });
  const store = createStore();

  async function context(viewport, extras = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: true, ...extras });
    // FONT_STRESS=1.4 spreads every glyph by that many px: a stand-in for a machine whose font is wider than ours (the CI runner's was:
    // a line wrapped there that does not wrap here). The layout checks compare the page with itself, so they must pass at any value.
    if (process.env.FONT_STRESS) await ctx.addInitScript((px) => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = `*{letter-spacing:${px}px !important}`; document.head.appendChild(s); }); }, Number(process.env.FONT_STRESS));
    const page = await ctx.newPage();
    const requests = [];
    page.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|favicon|fonts\.g|telegram\.org/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await page.route('**/*', (r) => (new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort()));
    await page.goto(base);
    await ready(page);
    return { ctx, page, requests };
  }
  // the guide starts once the server state was adopted, and the round overlay is what the player first sees
  const ready = async (page) => {
    await page.waitForFunction(() => window.Guide && window.Guide.inspect().ready && window.PlatformGame && document.getElementById('platform-overlay') && !document.getElementById('platform-overlay').hidden, null, { timeout: 30000 });
  };
  const reload = async (page) => { await page.reload(); await ready(page); };
  const progress = async (page, patch) => {
    const owner = await page.evaluate(() => window.PlatformBridge.user());
    assert.ok(owner, 'the guest has a server identity');
    await store.withUsers([owner], async () => {
      const u = await store.getUser(owner);
      if (patch.wins) u.state.mines.wins = patch.wins.slice();
      if (patch.equipment) Object.assign(u.state.equipment, patch.equipment);
      if (patch.ores) Object.assign(u.state.ores, patch.ores);
      if (patch.gold !== undefined) u.state.gold = patch.gold;
      await store.putUser(u);
    });
    return owner;
  };
  const box = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }, sel);
  const inspect = (page) => page.evaluate(() => window.Guide.inspect());
  const openGuide = async (page) => { await page.locator('#open-guide').click(); await page.locator('#guide-overlay').waitFor({ state: 'visible' }); };
  const tab = async (page, name) => { await page.locator(`[data-guide-tab="${name}"]`).click(); };
  const goalId = (page) => page.locator('.gd-goal').getAttribute('data-goal');
  // the round overlay scrolls when its content is taller than the stage: the guide button is a corner icon outside the layout flow, so
  // with and without it the overlay keeps its height and every button keeps its width (compared with itself, never with a constant:
  // the first version sat in the button row and the CI runner's wider font wrapped a line of the neighbours, 420px against 407px)
  const overlayMetrics = (page, hideGuide) => page.evaluate((hide) => {
    const b = document.getElementById('open-guide'), was = b.hidden, ov = document.getElementById('platform-overlay');
    b.hidden = hide;
    const w = (id) => Math.round(document.getElementById(id).getBoundingClientRect().width * 100) / 100;
    const m = { scrollHeight: ov.scrollHeight, mineW: w('mine-select'), workshopW: w('open-workshop-overlay'), startW: w('platform-start') };
    b.hidden = was; return m;
  }, hideGuide);
  const overlap = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
  // every title the round overlay shows (platform-game.js: start, pause, finish, restore); the longest wraps over two lines on a phone
  const OVERLAY_TITLES = ['منجم المنصّة', 'استراحة عند المصباح', 'وصلت إلى قلب المنجم!', 'المصباح ينتظر عودتك', 'استرجاع نتيجة جولتك', 'جولة سابقة انتهت', 'انتهت الجولة — جرّب من جديد'];
  // the corner icon (and its "new" badge) must not cover anything else in the overlay
  const coversNothing = async (page, what) => {
    const rects = await page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { id: e.id || e.className || e.tagName, l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      const own = [document.getElementById('open-guide'), ...document.querySelectorAll('#open-guide .guide-new')].filter((e) => e.getClientRects().length).map(r);
      const others = [...document.querySelectorAll('#platform-overlay > *')].filter((e) => e.id !== 'open-guide' && e.getClientRects().length).map(r);
      return { own, others };
    });
    assert.ok(rects.own.length >= 1 && rects.others.length >= 3, `${what}: the overlay has its content`);
    for (const a of rects.own) for (const o of rects.others) assert.equal(overlap(a, o), false, `${what}: ${a.id} does not cover ${o.id}`);
  };
  const noSideScroll = (page) => page.evaluate(() => {
    const body = document.getElementById('guide-body'), ov = document.getElementById('guide-overlay');
    return { doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth, body: body.scrollWidth <= body.clientWidth + 1, overlay: ov.scrollWidth <= ov.clientWidth + 1 };
  });

  try {
    // ================================================================== 1) a brand-new player (390x844)
    {
      const { ctx, page, requests } = await context({ width: 390, height: 844 });
      assert.equal(await page.locator('#open-guide').isVisible(), true, 'the guide button appears once the guide is ready');
      assert.equal(await page.locator('#open-guide .guide-dot').isVisible(), true, 'a red dot invites the new player');
      assert.equal((await page.locator('#open-guide [data-guide-label]').innerText()).trim(), 'المرشد', 'the intro chapter is announced by the dot alone');
      const geo = { guide: await box(page, '#open-guide'), ov: await box(page, '#platform-overlay'), mine: await box(page, '#mine-select'), ws: await box(page, '#open-workshop-overlay') };
      assert.ok(geo.guide.l >= geo.ov.l && geo.guide.r <= geo.ov.r && geo.guide.t >= geo.ov.t, 'the icon sits in a corner inside the round overlay');
      assert.ok(geo.guide.w >= 36 && geo.guide.h >= 36 && geo.guide.w <= 44, `a tappable round icon (${geo.guide.w}x${geo.guide.h})`);
      assert.ok(geo.guide.r - geo.ov.l <= 44 && geo.guide.b - geo.ov.t <= 44, 'inside the 44px corner square that only the capped caption pill may share a row with');
      assert.ok(geo.mine.w >= 90 && geo.ws.w >= 90, 'the two big buttons keep their room');
      assert.deepEqual(await overlayMetrics(page, false), await overlayMetrics(page, true), 'the guide icon changes neither the overlay height nor the width of its buttons');
      assert.equal(await page.locator('#open-guide .guide-new').isHidden(), true, 'no "new" badge for the intro chapter');
      await coversNothing(page, '390x844');

      const before = await page.evaluate(() => ({ gold: state.gold, energy: state.energy, pending: SYNC.pending.length, clicks: SYNC.clicks }));
      const mark = requests.length;
      await openGuide(page);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'guide-close', 'keyboard focus moves into the window');
      assert.equal(await page.evaluate(() => document.getElementById('guide-overlay').getAttribute('role') + '/' + document.getElementById('guide-overlay').getAttribute('aria-modal')), 'dialog/true');
      assert.equal(await goalId(page), 'win:0');
      const goalText = await page.locator('.gd-bubble').innerText();
      assert.match(goalText, /اعبر المنجم الحجري/); assert.match(goalText, /العم سراج/);
      assert.equal(await page.locator('.gd-steps li.no').count(), 1);
      assert.equal((await page.locator('[data-guide-action]').innerText()).trim(), 'ابدأ من المنجم الحجري');
      assert.equal(await page.locator('.gd-tipbox').count(), 1, 'the first mine has its tip');
      await page.waitForFunction(() => { const i = document.querySelector('.gd-figure'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 20000 });
      assert.deepEqual(await page.evaluate(() => { const i = document.querySelector('.gd-figure'); return [i.complete, i.naturalWidth, i.naturalHeight]; }), [true, 428, 520], 'the guide portrait loaded at its real size');
      assert.deepEqual(await noSideScroll(page), { doc: true, body: true, overlay: true });
      await shot(page, 'guide-goal-new.jpg');

      // codex: ores (two are still a mystery), mines (five locked), gear (eight)
      await tab(page, 'codex');
      assert.equal(await page.locator('.gd-entry').count(), 5);
      assert.equal(await page.locator('.gd-unknown').count(), 2, 'crystal and lava are not discovered yet');
      assert.match(await page.locator('.gd-unknown').first().innerText(), /الكهوف الذهبية/, 'the hint names the mine that drops it');
      await page.locator('[data-guide-section="mines"]').click();
      assert.equal(await page.locator('.gd-entry').count(), 6); assert.equal(await page.locator('.gd-entry.gd-locked').count(), 5);
      assert.equal(await page.locator('.gd-entry .gd-boss').count(), 0, 'locked mines keep their guardians secret');
      await page.locator('[data-guide-section="gear"]').click();
      assert.equal(await page.locator('.gd-entry').count(), 8);
      assert.deepEqual(await page.locator('.gd-entry .gd-lvl').allInnerTexts(), Array(8).fill('0/5'));
      assert.deepEqual(await noSideScroll(page), { doc: true, body: true, overlay: true });

      // story: seven rows, one open and new
      await tab(page, 'story');
      assert.equal(await page.locator('.gd-chapter-row').count(), 7); assert.equal(await page.locator('.gd-chapter-row.fresh').count(), 1); assert.equal(await page.locator('.gd-chapter-row.locked').count(), 6);
      assert.equal(await page.locator('.gd-new').innerText(), 'جديد');
      assert.equal(await page.locator('button.gd-chapter-row.locked, [data-guide-read].locked').count(), 0, 'closed chapters are not buttons');
      await page.locator('[data-guide-read="0"]').click();
      assert.match(await page.locator('.gd-chapter h3').innerText(), /المصباح الأول/);
      assert.equal(await page.locator('.gd-chapter .gd-tipbox').count(), 1);
      assert.deepEqual((await inspect(page)).store, { seen: [0], opened: true });
      await page.locator('[data-guide-back]').click();
      assert.equal(await page.locator('.gd-chapter-row.fresh').count(), 0, 'the badge is gone once it was read');

      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#guide-overlay').isHidden(), true);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'open-guide', 'focus returns to the button that opened it');
      assert.equal(await page.locator('#open-guide .guide-dot').isHidden(), true, 'read and opened: no dot');
      // read-only: nothing was written to the server and the economy did not move
      const writes = requests.slice(mark).filter((r) => r.method !== 'GET' && /\/api\//.test(r.url));
      assert.deepEqual(writes, [], 'the guide never writes to the server');
      assert.deepEqual(await page.evaluate(() => ({ gold: state.gold, energy: state.energy, pending: SYNC.pending.length, clicks: SYNC.clicks })), before, 'gold, energy and the sync queue are untouched');
      assert.equal(await page.evaluate(() => localStorage.getItem('mining-guide')), JSON.stringify({ v: 1, seen: [0], opened: true }));
      // it remembers across a reload
      await reload(page);
      assert.equal(await page.locator('#open-guide').isVisible(), true);
      assert.equal(await page.locator('#open-guide .guide-dot').isHidden(), true, 'still no dot after a reload');
      report.newPlayer = { dot: true, tabs: 3, chapter: 0, remembered: true, writes: 0 };

      // ============================================================== 2) progress arrives from the server
      await progress(page, { wins: [1, 0, 0, 0, 0, 0] });
      await reload(page);
      assert.equal((await page.locator('#open-guide [data-guide-label]').innerText()).trim(), 'فصل جديد', 'a newly opened mine turns the button into "new chapter"');
      assert.match(await page.locator('#open-guide').getAttribute('aria-label'), /المكبس القديم/, 'screen readers hear which chapter');
      assert.equal(await page.locator('#open-guide .guide-dot').isVisible(), true);
      assert.equal(await page.locator('#open-guide').getAttribute('data-news'), '1');
      assert.equal(await page.locator('#open-guide .guide-new').isVisible(), true, 'the gold icon carries a "new" badge');
      assert.equal((await page.locator('#open-guide .guide-new').innerText()).trim(), 'جديد');
      assert.deepEqual(await overlayMetrics(page, false), await overlayMetrics(page, true), 'and the badge still takes no room');
      await coversNothing(page, 'news state');
      await shot(page, 'guide-overlay-news.jpg');
      // the same button opens exactly that chapter, and says "المرشد" again once it was read
      await openGuide(page);
      assert.equal(await page.locator('.gd-chapter').getAttribute('data-chapter'), '1', 'it opened the new chapter itself, not the goal screen');
      assert.match(await page.locator('.gd-chapter h3').innerText(), /المكبس القديم/);
      assert.equal((await page.locator('#open-guide [data-guide-label]').innerText()).trim(), 'المرشد');
      assert.equal(await page.locator('#open-guide .guide-new').isHidden(), true, 'the badge goes away once the chapter was read');
      assert.deepEqual((await inspect(page)).store.seen, [0, 1]);
      // the goal screen asks for a win in the mine that was just opened, and its button picks that mine
      await tab(page, 'goal');
      assert.equal(await goalId(page), 'win:1');
      assert.match(await page.locator('.gd-bubble').innerText(), /افز في مناجم الحديد/);
      assert.deepEqual(await page.locator('.gd-steps li').evaluateAll((l) => l.map((x) => x.className)), ['no', 'no'], 'both of mine 3\'s needs are listed');
      await page.evaluate(() => window.PlatformGame.setZone(0));
      await page.locator('[data-guide-action]').click();
      assert.equal(await page.locator('#guide-overlay').isHidden(), true, 'the goal button closes the window');
      assert.equal(await page.evaluate(() => window.PlatformGame.getZone()), 1, 'and selects the mine to win in');
      assert.match(await page.locator('#mine-select [data-mine-name]').innerText(), /مناجم الحديد/);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id) !== 'guide-close', true);

      // gear goal, affordable: the button opens the workshop
      await progress(page, { wins: [1, 1, 0, 0, 0, 0], gold: 80, ores: { copper: 9 } });
      await reload(page);
      await openGuide(page);
      await tab(page, 'goal');
      assert.equal(await goalId(page), 'gear:pickaxe:1');
      assert.match(await page.locator('.gd-bubble').innerText(), /50 ذهب و6 نحاس/);
      assert.equal((await page.locator('[data-guide-action]').innerText()).trim(), 'افتح الورشة وابدأ الترقية');
      await page.locator('[data-guide-action]').click();
      await page.locator('#ws-overlay').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#guide-overlay').isHidden(), true);
      await page.locator('#ws-close').click();
      // gear goal, not affordable: it says what is missing and sends you to dig it
      await progress(page, { gold: 10, ores: { copper: 2 } });
      await reload(page);
      await page.evaluate(() => window.PlatformGame.setZone(1));
      await openGuide(page);
      await tab(page, 'goal');
      const poor = await page.locator('.gd-bubble').innerText();
      assert.match(poor, /تنقصك 4 نحاس/); assert.match(poor, /المنجم الحجري/); assert.match(poor, /تنقصك 40 ذهب/);
      await shot(page, 'guide-goal-gear.jpg');
      await page.locator('[data-guide-action]').click();
      assert.equal(await page.evaluate(() => window.PlatformGame.getZone()), 0, 'it picked the mine where copper is most common');
      report.progress = { news: true, goals: ['win:1', 'gear:pickaxe:1'], workshop: true };
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 3) a paused round stays paused under the guide
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      await page.locator('#platform-start').click();
      await page.waitForFunction(() => window.PlatformGame.inspect().running);
      await page.locator('#platform-pause').click();
      await page.waitForFunction(() => window.PlatformGame.inspect().paused);
      const ticket = (await page.evaluate(() => window.PlatformGame.inspect())).ticket;
      await openGuide(page);
      assert.equal(await page.evaluate(() => window.PlatformGame.inspect().paused), true, 'still paused behind the window');
      await page.keyboard.press('Escape');
      const after = await page.evaluate(() => window.PlatformGame.inspect());
      assert.deepEqual([after.running, after.paused, after.ticket], [true, true, ticket], 'the same round, still paused: nothing was lost');
      assert.equal(await page.locator('#platform-resume').isVisible(), true, 'and the resume button is still there');
      await page.locator('#platform-resume').click();
      await page.waitForFunction(() => !window.PlatformGame.inspect().paused);
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 4) a veteran: no flood of "new" chapters; the whole book is open
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      await progress(page, { wins: [1, 1, 1, 1, 1, 1], equipment: MAXED, ores: { copper: 20, iron: 20, gold: 20, crystal: 20, lava: 20 }, gold: 5000 });
      await page.evaluate(() => localStorage.removeItem('mining-guide')); // as if this device had never met the guide
      await reload(page);
      assert.equal((await page.locator('#open-guide [data-guide-label]').innerText()).trim(), 'المرشد', 'a veteran is not told about seven "new" chapters');
      assert.equal(await page.locator('#open-guide .guide-dot').isVisible(), true, 'the feature itself is announced once');
      assert.deepEqual((await inspect(page)).store, { seen: [0, 1, 2, 3, 4, 5, 6], opened: false });
      await openGuide(page);
      assert.equal(await goalId(page), 'legend'); assert.match(await page.locator('.gd-bubble').innerText(), /أنت أسطورة المنجم/);
      await tab(page, 'codex');
      assert.equal(await page.locator('.gd-unknown').count(), 0, 'every ore is known');
      await page.locator('[data-guide-section="mines"]').click();
      assert.equal(await page.locator('.gd-entry.gd-locked').count(), 0);
      assert.deepEqual(await page.locator('.gd-entry .gd-boss').allInnerTexts(), ['زعيم: عملاق الذهب', 'زعيم: حارس القلب']);
      assert.equal(await page.locator('.gd-entry .gd-world').count(), 6, 'every open world names its danger');
      await shot(page, 'guide-codex-mines.jpg');
      await page.locator('[data-guide-section="gear"]').click();
      assert.equal(await page.locator('.gd-entry:has-text("بلغت المستوى الأقصى")').count(), 8);
      await tab(page, 'story');
      assert.equal(await page.locator('.gd-chapter-row[data-guide-read]').count(), 7, 'all seven chapters, the epilogue included, can be read');
      assert.equal(await page.locator('.gd-chapter-row.fresh').count(), 0);
      await page.locator('[data-guide-read="2"]').click();
      assert.match(await page.locator('.gd-chapter h3').innerText(), /عملاق الذهب/);
      assert.equal(await page.locator('.gd-chapter [data-guide-read="3"]').count(), 1, 'the next chapter is one tap away');
      await shot(page, 'guide-chapter-boss.jpg');
      await page.locator('.gd-chapter [data-guide-read="3"]').click();
      await page.locator('[data-guide-back]').click();
      await page.locator('[data-guide-read="6"]').click();
      assert.match(await page.locator('.gd-chapter h3').innerText(), /المصباح لا ينطفئ/);
      assert.equal(await page.locator('.gd-chapter [data-guide-read]').count(), 0, 'the epilogue is the last page');
      report.veteran = { seen: 7, boss: true, epilogue: true };
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 5) phones: nothing overflows, every control can be reached
    // every check runs twice: with the font of this machine and with every glyph spread by 1px (about a fifth wider text), because the CI runner's font is wider than
    // ours and a layout that fits only one font is a bug (the first version of the button row did exactly that)
    const phoneChecks = async (page, vp, tag) => {
      await page.locator('#open-guide').scrollIntoViewIfNeeded();
      const btn = await box(page, '#open-guide');
      assert.ok(btn.l >= 0 && btn.r <= vp.width && btn.t >= 0 && btn.h >= 34, `${tag}: the button is on screen and tappable (${btn.w}x${btn.h})`);
      const kicker = await box(page, '.overlay-kicker');
      assert.ok(kicker.h >= 22, `${tag}: the caption pill keeps its height (${kicker.h}px): overflow hidden on a flex item let it shrink to 12px on a short screen`);
      const title = await page.evaluate(() => document.getElementById('platform-title').textContent);
      for (const text of OVERLAY_TITLES) {
        await page.evaluate((t) => { document.getElementById('platform-title').textContent = t; }, text);
        await coversNothing(page, `${tag} / "${text}"`);
      }
      await page.evaluate((t) => { document.getElementById('platform-title').textContent = t; }, title);
      // a caption far longer than any font could make it: the pill is capped and clips its text, so it never reaches the icon and keeps one line
      await page.evaluate(() => { document.querySelector('.overlay-kicker').append(` · ${'جولة موثّقة · 150 ثانية · '.repeat(4)}`); });
      await coversNothing(page, `${tag} / a very long caption`);
      const long = await box(page, '.overlay-kicker');
      assert.ok(long.h <= kicker.h + 2, `${tag}: the long caption stays on one line (${long.h}px against ${kicker.h}px)`);
      await page.evaluate(() => { const k = document.querySelector('.overlay-kicker'); k.removeChild(k.lastChild); });
      assert.deepEqual(await box(page, '.overlay-kicker'), kicker, `${tag}: and the pill is back to its size afterwards`);
      assert.deepEqual(await overlayMetrics(page, false), await overlayMetrics(page, true), `${tag}: no height, no width taken from the overlay`);
      await openGuide(page);
      for (const name of ['goal', 'codex', 'story']) {
        await tab(page, name);
        assert.deepEqual(await noSideScroll(page), { doc: true, body: true, overlay: true }, `${tag}/${name}: no sideways scroll`);
        const close = await box(page, '#guide-close'), tabs = await box(page, '.gd-tabs');
        assert.ok(close.t >= 0 && close.l >= 0 && close.r <= vp.width, `${tag}: the close button is on screen`);
        assert.ok(tabs.l >= 0 && tabs.r <= vp.width, `${tag}: the tab bar fits`);
        if (name === 'goal') {
          await page.locator('[data-guide-action]').scrollIntoViewIfNeeded();
          const a = await box(page, '[data-guide-action]');
          assert.ok(a.t >= 0 && a.b <= vp.height + 1 && a.l >= 0 && a.r <= vp.width, `${tag}: the goal button can be scrolled into view`);
        }
        const entries = await page.locator('.gd-entry, .gd-chapter-row').evaluateAll((l) => l.map((e) => Math.round(e.getBoundingClientRect().right)));
        assert.ok(entries.every((r) => r <= vp.width), `${tag}/${name}: no card sticks out`);
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#guide-overlay').isHidden(), true, `${tag}: Escape closes the window`);
    };
    for (const vp of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const { ctx, page } = await context(vp, { reducedMotion: vp.width === 320 ? 'reduce' : 'no-preference' });
      await progress(page, { wins: [1, 1, 1, 0, 0, 0], equipment: { pickaxe: 2 }, gold: 10, ores: { copper: 1 } });
      await reload(page);
      await phoneChecks(page, vp, `${vp.width}x${vp.height}`);
      await page.addStyleTag({ content: '*{letter-spacing:1px !important}' });
      await phoneChecks(page, vp, `${vp.width}x${vp.height} wide font`);
      report.phones.push(`${vp.width}x${vp.height}`);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
