// Real Chromium E2E for the adventure quests (batch 3b): twelve one-time quests in the missions panel, fed by verified mine rounds.
// Run against a LOCAL development server, never production:
//   CHROMIUM_PATH=/path/to/chromium npm run test:quests
// It plays what a player does: opens the missions panel, finds "مغامرات المناجم" (a folded box whose summary lights up when something is
// ready), unfolds it, claims a finished quest with a tap and sees the gold at once, and finds it still claimed after a reload. The guest's
// progress is moved through the dev SQLite file (the same trick as test:bosses and test:guide) so every state is real: nothing done,
// partial counters, a win read from the mines record, a claimed quest, a ready one. (That verified rounds really feed the counters is
// proved by test:bosses, which plays two real boss fights and checks the quests afterwards, and by test/quests-api.test.js.)
// It also checks that the rows fit phones (320x568, 390x844) and a landscape phone (844x390) with the font of this machine and again
// with every glyph spread by 1px, that the claim button is tappable, that nothing the server sends becomes markup, and that the box is
// emoji-free. Writes docs/media/quests-list.jpg.
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

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium executable');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], report = { fresh: null, progress: null, claim: null, phones: [], errors };
  fs.mkdirSync(media, { recursive: true });
  const store = createStore();

  async function context(viewport, extras = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: true, ...extras });
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
  const ready = (page) => page.waitForFunction(() => window.PlatformGame && typeof profile !== 'undefined' && profile && profile.quests && document.getElementById('quests-list'), null, { timeout: 30000 });
  const reload = async (page) => { await page.reload(); await ready(page); };
  const patch = async (page, mutate) => {
    const owner = await page.evaluate(() => window.PlatformBridge.user());
    assert.ok(owner, 'the guest has a server identity');
    await store.withUsers([owner], async () => { const u = await store.getUser(owner); mutate(u); await store.putUser(u); });
  };
  const synced = (page) => page.waitForFunction(() => SYNC.pending.length === 0 && !SYNC.inflight, null, { timeout: 30000 });
  const box = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }, sel);
  const overlap = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
  // the missions panel with the quests box unfolded (the daily and weekly boxes folded so the list is what the screen shows)
  const open = async (page) => {
    await page.evaluate(() => { switchPlayPanel('missions'); document.getElementById('missions-box').open = false; document.getElementById('quests-box').open = true; });
    await page.locator('#quests-list .quest-row').first().waitFor({ state: 'visible' });
  };
  const snapshot = (page) => page.evaluate(() => ({ gold: Math.floor(state.gold), xp: state.xp, claimed: profile.quests.claimedCount, ready: profile.quests.items.filter((i) => i.done && !i.claimed).length }));
  const stateOf = (page, id) => page.locator(`[data-quest="${id}"]`).getAttribute('class');
  const PROGRESS = { rocks: 37, enemies: 12, ores: { copper: 40, iron: 11, gold: 0, crystal: 0, lava: 0 }, bosses: { colossus: 0, warden: 0 }, claimed: {} };

  try {
    // ================================================================== 1) a brand-new player (390x844)
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      await page.evaluate(() => switchPlayPanel('missions'));
      assert.equal(await page.locator('#quests-box').isVisible(), true, 'the box is in the missions panel');
      assert.equal(await page.evaluate(() => document.getElementById('quests-box').open), false, 'folded to begin with');
      assert.equal((await page.locator('#quests-count').innerText()).trim(), '0/12', 'the summary shows how many are done');
      assert.equal(await page.locator('#quests-count').evaluate((e) => e.classList.contains('quests-ready')), false, 'and does not shout');
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('#quests-box > summary')].length), 1);
      await open(page);
      assert.equal(await page.locator('#quests-list .quest-row').count(), 12);
      assert.equal(await page.locator('#quests-list .quest-row.ready, #quests-list .quest-row.claimed').count(), 0);
      assert.equal(await page.locator('#quests-list .quest-claim').count(), 0, 'nothing to claim yet');
      assert.deepEqual(await page.locator('#quests-list .quest-count').allInnerTexts(), ['0/1', '0/1', '0/40', '0/50', '0/30', '0/1', '0/25', '0/1', '0/20', '0/200', '0/15', '0/1'], 'every quest shows its own target');
      assert.equal(await page.locator('#quests-list svg.ui-icon, #quests-list .ore-dot').count(), 12, 'one icon per row, all SVG or an ore dot');
      assert.doesNotMatch(await page.locator('#quests-box').innerText(), EMOJI, 'the box is emoji-free');
      report.fresh = { rows: 12, ready: 0, folded: true };
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 2) progress arrives from the server; a claim is paid at once and stays
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      await patch(page, (u) => { u.sync.quests = { ...PROGRESS, claimed: { first_rock: Date.now() } }; u.state.mines.wins = [2, 1, 0, 0, 0, 0]; });
      await reload(page);
      assert.equal((await page.locator('#quests-count').innerText()).trim(), '1/12 · 2 جاهزة', 'one claimed, two ready (the stone win and the copper)');
      assert.equal(await page.locator('#quests-count').evaluate((e) => e.classList.contains('quests-ready')), true, 'the folded summary lights up');
      await open(page);
      assert.match(await stateOf(page, 'first_rock'), /claimed/); assert.match(await stateOf(page, 'win_stone'), /ready/); assert.match(await stateOf(page, 'copper_40'), /ready/);
      for (const id of ['guards_50', 'iron_30', 'win_crystal', 'colossus', 'warden']) assert.doesNotMatch(await stateOf(page, id), /ready|claimed/, `${id} is still open`);
      assert.deepEqual(await page.locator('[data-quest="guards_50"] .quest-count, [data-quest="iron_30"] .quest-count, [data-quest="rocks_200"] .quest-count').allInnerTexts(), ['12/50', '11/30', '37/200'], 'the partial counters are the server\'s');
      assert.equal(await page.locator('[data-quest="guards_50"] .quest-bar i').evaluate((e) => e.style.width), '24%');
      assert.equal(await page.locator('[data-quest="copper_40"] .ore-dot.ore-copper').count(), 1, 'an ore quest wears its ore\'s colour');
      await shot(page, 'quests-list.jpg');

      const before = await snapshot(page);
      await page.locator('[data-quest-claim="copper_40"]').click();
      const instant = await snapshot(page);
      assert.equal(instant.gold, before.gold + 100, 'the gold shows at once, before the server answers');
      assert.match(await stateOf(page, 'copper_40'), /claimed/); assert.equal(await page.locator('[data-quest="copper_40"] .quest-claim').count(), 0, 'its button is gone');
      assert.equal((await page.locator('#quests-count').innerText()).trim(), '2/12 · 1 جاهزة');
      await synced(page);
      const after = await snapshot(page);
      assert.deepEqual([after.gold, after.xp, after.claimed, after.ready], [before.gold + 100, before.xp + 40, 2, 1], 'the server confirmed exactly +100 gold and +40 XP, once');
      assert.match(await page.locator('#sync-status').innerText(), /مهمة مغامرة مُعتمدة: \+100 .* \+40 خبرة/);
      // a second tap on a claimed quest does nothing (there is no button); the other ready one is still claimable
      assert.equal(await page.locator('[data-quest="win_stone"] .quest-claim').count(), 1);
      // it stays claimed after a reload, and the server's gold is the same
      await reload(page);
      await open(page);
      assert.match(await stateOf(page, 'copper_40'), /claimed/); assert.match(await stateOf(page, 'win_stone'), /ready/);
      assert.deepEqual(await snapshot(page), after, 'the same gold, XP and counts after a reload');
      report.progress = { claimed: 2, ready: 1, partial: ['12/50', '11/30', '37/200'] };
      report.claim = { gold: 100, xp: 40, instant: true, persisted: true };
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 3) nothing the server sends becomes markup (a hostile quest title in a reply)
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      await open(page);
      const out = await page.evaluate(() => {
        profile.quests = { ...profile.quests, items: profile.quests.items.map((i, n) => (n === 0 ? { ...i, title: '<img src=x onerror="window.__pwned=1">', desc: '<b id="evil">x</b>', icon: 'i-check"><script>window.__pwned=2</script>', id: 'first"onclick="window.__pwned=3', done: true, value: 1 } : i)) };
        renderQuests();
        return { pwned: window.__pwned || 0, evil: Boolean(document.getElementById('evil')), imgs: document.querySelectorAll('#quests-list img').length, scripts: document.querySelectorAll('#quests-list script').length, text: document.querySelector('#quests-list .quest-row b').textContent };
      });
      assert.deepEqual([out.pwned, out.evil, out.imgs, out.scripts], [0, false, 0, 0], 'hostile text stays text');
      assert.equal(out.text, '<img src=x onerror="window.__pwned=1">', 'and is shown as typed');
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 4) phones: nothing overflows, every row and button can be reached
    const fits = async (page, vp, tag) => {
      await open(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${tag}: no sideways scroll`);
      const rows = await page.evaluate(() => [...document.querySelectorAll('#quests-list .quest-row')].map((r) => {
        const rect = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        return { row: rect(r), body: rect(r.querySelector('.quest-body')), side: rect(r.querySelector('.quest-side')), ico: rect(r.querySelector('.quest-ico')), fill: r.querySelector('.quest-bar i').getBoundingClientRect().width, track: r.querySelector('.quest-bar').getBoundingClientRect().width };
      }));
      assert.equal(rows.length, 12);
      rows.forEach((r, i) => {
        assert.ok(r.row.l >= -1 && r.row.r <= vp.width + 1, `${tag}: row ${i} is inside the screen width`);
        assert.ok(r.side.r <= r.row.r + 1 && r.side.l >= r.row.l - 1, `${tag}: row ${i}: the reward column stays inside its row`);
        for (const [a, b] of [['body', 'side'], ['body', 'ico'], ['side', 'ico']]) assert.equal(overlap(r[a], r[b]), false, `${tag}: row ${i}: ${a} and ${b} do not overlap`);
        assert.ok(r.fill <= r.track + 0.5, `${tag}: row ${i}: the bar never outgrows its track`);
      });
      const claim = await box(page, '[data-quest-claim]');
      assert.ok(claim.h >= 24 && claim.w >= 44, `${tag}: the claim button is tappable (${claim.w}x${claim.h})`);
      await page.locator('[data-quest="warden"]').scrollIntoViewIfNeeded();
      const last = await box(page, '[data-quest="warden"]');
      assert.ok(last.t >= 0 && last.b <= vp.height + 1, `${tag}: the last quest can be scrolled into view`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${tag}: still no sideways scroll`);
    };
    for (const vp of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const { ctx, page } = await context(vp, { reducedMotion: vp.width === 320 ? 'reduce' : 'no-preference' });
      await patch(page, (u) => { u.sync.quests = { ...PROGRESS, claimed: { first_rock: Date.now() } }; u.state.mines.wins = [2, 1, 0, 0, 0, 0]; });
      await reload(page);
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
