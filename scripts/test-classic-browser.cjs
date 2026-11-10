// Real Chromium E2E for the classic mode (batch 3a'): the original catch-the-falling-objects game, reachable again from the mines map,
// under the shared daily gold cap. Run against a LOCAL development server, never production:
//   CHROMIUM_PATH=/path/to/chromium npm run test:classic
// It plays what a player does: opens the mines map, finds the classic card under the six mines, enters the classic panel, starts a round,
// leaves for the mine in the middle of it (the round is paused, not lost), comes back, finishes it, and the server pays it and charges the
// shared purse. Then the guest's purse is moved through the dev SQLite file (the same trick as test:bosses and test:guide) so the cap is
// real: a round that only partly fits is paid in part and says so, a round after the purse is empty pays nothing, and both are still
// counted as rounds. It also proves the way back keeps the platform scene working, that a race cannot be left through it, that the new
// controls are SVG (no emoji), and that everything fits phones (320x568, 390x844) and a landscape phone (844x390), with the font of this
// machine and again with every glyph spread by 1px. Writes docs/media/classic-map.jpg (the classic panel itself is not photographed:
// the headless browser has no emoji font and would draw its original emoji art as empty boxes).
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../db');

const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser tests require a local development server, never a public deployment');
const media = path.join(__dirname, '../docs/media');
const shot = (page, name) => page.screenshot({ path: path.join(media, name), type: 'jpeg', quality: 80, timeout: 90000 });
const EMOJI = /\p{Extended_Pictographic}/u;
const today = () => new Date().toISOString().slice(0, 10);

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium executable');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], report = { entry: null, round: null, cap: null, race: null, phones: [], errors };
  fs.mkdirSync(media, { recursive: true });
  const store = createStore();

  async function context(viewport, extras = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: true, ...extras });
    // الإرشاد يظهر مرة واحدة لكل جهاز جديد (platform-coach:v1) فيغطي أزرار اللوحة. هذا الاختبار يبدأ
    // بجهاز «شاهد الإرشاد» كي يقيس اللعب لا طبقة الشرح؛ سلوك اللعبة نفسه لم يُغيَّر، وللإرشاد اختبار مستقل
    // (scripts/test-coach-browser.cjs) يثبت ظهوره وإغلاقه.
    await ctx.addInitScript(() => { try { localStorage.setItem('platform-coach:v1', '1'); } catch (_) {} });
    // FONT_STRESS=1.4 spreads every glyph by that many px (a stand-in for a machine with a wider font, as the CI runner has)
    if (process.env.FONT_STRESS) await ctx.addInitScript((px) => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = `*{letter-spacing:${px}px !important}`; document.head.appendChild(s); }); }, Number(process.env.FONT_STRESS));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|favicon|fonts\.g|telegram\.org/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await page.route('**/*', (r) => (new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort()));
    await page.goto(base);
    await ready(page);
    return { ctx, page };
  }
  // the server state was adopted (the purse is known) and the round overlay is what the player first sees
  const ready = (page) => page.waitForFunction(() => window.PlatformGame && typeof profile !== 'undefined' && profile && profile.dailyGold && document.getElementById('platform-overlay') && !document.getElementById('platform-overlay').hidden, null, { timeout: 30000 });
  const reload = async (page) => { await page.reload(); await ready(page); };
  // edit the guest's server record through the dev SQLite file (same lock the server uses)
  const patchSync = async (page, mutate) => {
    const owner = await page.evaluate(() => window.PlatformBridge.user());
    assert.ok(owner, 'the guest has a server identity');
    await store.withUsers([owner], async () => { const u = await store.getUser(owner); mutate(u); await store.putUser(u); });
  };
  const longAgo = (u) => { u.sync.lastRunAt = Date.now() - 600_000; u.sync.lastRewardAt.adventure = Date.now() - 600_000; }; // room for a new round, past the 20 s reward gap
  const synced = (page) => page.waitForFunction(() => SYNC.pending.length === 0 && !SYNC.inflight, null, { timeout: 30000 });
  const box = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }, sel);
  const snapshot = (page) => page.evaluate(() => ({ gold: Math.floor(state.gold), runs: state.adventure.runs, used: profile.dailyGold.used, remaining: profile.dailyGold.remaining, cap: profile.dailyGold.cap }));
  const openMap = async (page) => { await page.locator('#mine-select').click(); await page.locator('#mines-overlay').waitFor({ state: 'visible' }); };
  const enterClassic = async (page) => { await openMap(page); await page.locator('#classic-open').click(); await page.locator('#legacy-adventure').waitFor({ state: 'visible' }); };
  // play one classic round "for real", then give it the numbers a good round has (the server judges them: it only pays what the time allows)
  const startRound = async (page) => {
    await page.locator('#game-overlay-btn').click();
    await page.waitForFunction(() => adv.running && !adv.paused && adv.elapsed > 0.3, null, { timeout: 20000 });
  };
  const finishRound = async (page, score = 400) => {
    await page.evaluate((s) => { adv.score = s; adv.gemsCaught = 12; adv.maxCombo = 6; adv.elapsed = 30; adv.timeLeft = 0.01; }, score);
    await page.waitForFunction(() => !adv.running, null, { timeout: 20000 });
    await synced(page);
  };
  const overlayText = (page) => page.locator('#game-overlay-text').innerText();
  const overlap = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;

  try {
    // ================================================================== 1) a brand-new player (390x844): find the mode, enter, leave, come back
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      assert.equal(await page.locator('#legacy-adventure').isHidden(), true, 'the classic panel starts hidden, as it always did');
      await openMap(page);
      assert.equal(await page.locator('.mine-card').count(), 6, 'the six mines are still the six .mine-card');
      assert.equal(await page.locator('#mine-classic').isVisible(), true, 'the classic card sits under the mines');
      assert.equal((await page.locator('#mine-classic h3').innerText()).trim(), 'الكلاسيكي: اللعبة الأصلية');
      assert.equal((await page.locator('#classic-left').innerText()).trim(), '10,000 من 10,000', 'a new player has the whole shared purse');
      assert.equal(await page.locator('#mine-classic .ui-icon').count(), 1, 'its art is an SVG icon');
      await shot(page, 'classic-map.jpg');
      await page.locator('#classic-open').click();
      assert.equal(await page.locator('#mines-overlay').isHidden(), true, 'the map closes');
      assert.equal(await page.locator('#legacy-adventure').isVisible(), true, 'and the classic panel opens');
      assert.equal(await page.locator('#platform-scene').isHidden(), true, 'instead of the side-scroller');
      assert.equal(await page.locator('#legacy-back').isVisible(), true, 'with a way back to the mine');
      assert.match(await page.locator('#adv-daily').innerText(), /سقف اليوم المشترك: متبقٍ 10,000 من 10,000/);
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'game-overlay-btn', 'keyboard focus lands on "play"');

      // a round in progress, left in the middle: paused, not lost
      await startRound(page);
      await page.locator('#legacy-back').click();
      assert.deepEqual(await page.evaluate(() => ({ running: adv.running, paused: adv.paused })), { running: true, paused: true }, 'leaving pauses the round, it does not end it');
      assert.equal(await page.locator('#legacy-adventure').isHidden(), true);
      assert.equal(await page.locator('#platform-scene').isVisible(), true, 'the mine is back');
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'mine-select', 'focus returns to the map button');
      // the side-scroller works after the detour
      await page.locator('#platform-start').click();
      await page.waitForFunction(() => window.PlatformGame.inspect().running, null, { timeout: 15000 });
      await page.evaluate(() => window.PlatformGame.pause());
      // and the paused classic round is still there to resume
      await enterClassic(page);
      assert.equal(await page.evaluate(() => adv.paused), true, 'the same round, still paused');
      await page.locator('#game-overlay-btn').click();
      await page.waitForFunction(() => adv.running && !adv.paused, null, { timeout: 15000 });
      const before = await snapshot(page);
      assert.deepEqual([before.gold, before.runs, before.used], [0, 0, 0]);
      await finishRound(page, 400);
      assert.match(await overlayText(page), /\+80 🪙/, 'the round is shown at what 400 points pay');
      const after = await snapshot(page);
      assert.deepEqual([after.gold, after.runs, after.used, after.remaining], [80, 1, 80, after.cap - 80], 'the server paid 80 and charged the shared purse');
      assert.match(await page.locator('#adv-daily').innerText(), /متبقٍ 9,920 من 10,000/, 'the bar follows the purse');
      assert.doesNotMatch(await page.locator('#sync-status').innerText(), /بلغت سقف/, 'no cap message while there is room');
      // the way back is not offered inside a race (a race is left only through its own flow)
      assert.equal(await page.evaluate(() => { const was = [adv.mode, race.inRace]; adv.mode = 'race'; race.inRace = true; updateAdventureUI(); const hidden = document.getElementById('legacy-back').hidden; adv.mode = was[0]; race.inRace = was[1]; updateAdventureUI(); return hidden; }), true, 'hidden while racing');
      assert.equal(await page.locator('#legacy-back').isVisible(), true, 'and back as soon as the race is over');
      // the page may stay open across 00:00 UTC with no reply to refill the purse: a purse of yesterday is a full purse today
      assert.deepEqual(await page.evaluate(() => { profile.dailyGold = { day: '2000-01-01', used: 10000, cap: 10000, remaining: 0 }; updateClassicDaily(); return [classicRoom(), document.getElementById('classic-left').textContent, document.getElementById('adv-daily').textContent]; }),
        [10000, '10,000 من 10,000', 'سقف اليوم المشترك: متبقٍ 10,000 من 10,000'], 'an old purse never blocks today\'s rewards');
      report.entry = { cards: 6, classicCard: true, backForthKeepsRound: true, platformStillStarts: true, yesterdaysPurseRefilled: true };
      report.race = { backHiddenWhileRacing: true };
      report.round = { paid: after.gold, purseUsed: after.used };
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 2) the cap is real: part paid, then nothing
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      // a guest who has 50 gold of the day's 10,000 left
      await patchSync(page, (u) => { u.sync.platformDay = today(); u.sync.platformGold = 9_950; longAgo(u); });
      await reload(page);
      await openMap(page);
      assert.equal((await page.locator('#classic-left').innerText()).trim(), '50 من 10,000');
      await page.locator('#classic-open').click();
      await startRound(page);
      await finishRound(page, 400);
      assert.match(await overlayText(page), /\+50 🪙/, 'the round is shown at what the purse can pay, not at what it claimed');
      assert.match(await overlayText(page), /دُفع لك الباقي فقط \(50 من 80\)/);
      assert.match(await overlayText(page), /يتجدّد/, 'it says when the purse refills');
      let snap = await snapshot(page);
      assert.deepEqual([snap.gold, snap.runs, snap.used, snap.remaining], [50, 1, 10_000, 0], 'the server agrees: 50 paid, the purse is empty');
      assert.match(await page.locator('#sync-status').innerText(), /بلغت سقف الذهب اليومي المشترك \(10,000\).*ودُفع الباقي فقط/);

      // the purse is empty: the next round pays nothing, and still counts as a round
      await patchSync(page, (u) => longAgo(u));
      await page.locator('#game-overlay-btn').click();
      await page.waitForFunction(() => adv.running && !adv.paused && adv.elapsed > 0.3, null, { timeout: 20000 });
      await finishRound(page, 400);
      assert.match(await overlayText(page), /لا ذهب إضافي اليوم \(كان 80\)/);
      assert.doesNotMatch(await overlayText(page), /حصلت على/, 'no "you earned" line for a round that paid nothing');
      snap = await snapshot(page);
      assert.deepEqual([snap.gold, snap.runs, snap.used, snap.remaining], [50, 2, 10_000, 0], 'the gold did not move, the round was counted');
      assert.match(await page.locator('#sync-status').innerText(), /بلغت سقف الذهب اليومي المشترك.*دون ذهب إضافي/);
      assert.match(await page.locator('#adv-daily').innerText(), /متبقٍ 0 من 10,000/);
      // the map card says the same, and the mines (platform rounds) share that purse: their message is the one players already know
      await page.locator('#legacy-back').click();
      await openMap(page);
      assert.equal((await page.locator('#classic-left').innerText()).trim(), '0 من 10,000');
      report.cap = { partPaid: 50, afterEmpty: 0, roundsCounted: 2 };
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 3) phones: every control fits and can be reached
    const fits = async (page, vp, tag) => {
      await openMap(page);
      const card = await box(page, '#mine-classic'), list = await box(page, '#mines-list'), btn = await box(page, '#classic-open');
      assert.ok(card.l >= 0 && card.r <= vp.width && card.t >= 0 && card.b <= vp.height + 1, `${tag}: the classic card is on screen (${JSON.stringify(card)})`);
      assert.ok(btn.h >= 30 && btn.w >= 56, `${tag}: a tappable button (${btn.w}x${btn.h})`);
      assert.ok(list.h >= 110, `${tag}: the list of mines keeps room to scroll (${list.h}px)`);
      assert.equal(overlap(card, list), false, `${tag}: the card does not cover the list`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${tag}: no sideways scroll on the map`);
      const texts = await page.evaluate(() => document.getElementById('mine-classic').innerText);
      assert.doesNotMatch(texts, EMOJI, `${tag}: the new card is emoji-free (its icon is SVG)`);
      await page.locator('#classic-open').click();
      await page.locator('#legacy-adventure').waitFor({ state: 'visible' });
      const back = await box(page, '#legacy-back'), bar = await box(page, '#adv-daily');
      assert.ok(back.l >= 0 && back.r <= vp.width && back.t >= 0 && back.h >= 24, `${tag}: the way back is on screen (${JSON.stringify(back)})`);
      assert.ok(bar.r <= vp.width + 1 && bar.l >= -1, `${tag}: the purse line fits`);
      assert.equal(overlap(back, bar), false, `${tag}: the way back and the purse line do not overlap`);
      assert.doesNotMatch(await page.evaluate(() => document.getElementById('legacy-back').innerText), EMOJI, `${tag}: the way back is emoji-free`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${tag}: no sideways scroll in the classic panel`);
      await page.locator('#legacy-back').click();
      await page.locator('#platform-scene').waitFor({ state: 'visible' });
    };
    for (const vp of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const { ctx, page } = await context(vp, { reducedMotion: vp.width === 320 ? 'reduce' : 'no-preference' });
      await fits(page, vp, `${vp.width}x${vp.height}`);
      await page.addStyleTag({ content: '*{letter-spacing:1px !important}' });
      await fits(page, vp, `${vp.width}x${vp.height} wide font`);
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
