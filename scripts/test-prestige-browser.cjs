// Real Chromium E2E for prestige (batch 3c): +10% of the passive income per level (max 10 = ×2), paid for by resetting bots and rigs.
// Run against a LOCAL development server, never production:
//   CHROMIUM_PATH=/path/to/chromium npm run test:prestige
// It plays what a player does in the shop: sees the prestige card locked ("you need 15 bots and 3 rigs"), buys the 15th bot with a tap and sees
// the card become ready, taps prestige once (it only ASKS: a prestige resets bots and rigs, so one touch must not do it), lets a stale ask
// lapse, then asks and confirms: the page shows the reset at once, the server confirms it, and a reload finds the same. The guest's stock is
// moved through the dev SQLite file (the same trick as test:quests and test:bosses). It checks the new income is real (165 a second for the
// stock that earned 150, 5.5 and 27.5 per bot and rig in the shop), that the top level is shown as the top, that nothing but bots, rigs and
// their prices changed, that the card is emoji-free, and that it fits phones (320x568, 390x844) and a landscape phone (844x390) with the
// font of this machine and again with every glyph spread by 1px, in every state (locked, ready, asking, maxed). Writes docs/media/prestige-card.jpg.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../db');

const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser tests require a local development server, never a public deployment');
const media = path.join(__dirname, '../docs/media');
const EMOJI = /\p{Extended_Pictographic}/u;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium executable');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], report = { locked: null, ready: null, asked: null, done: null, income: null, top: null, phones: [], errors };
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
  const ready = (page) => page.waitForFunction(() => window.PlatformGame && typeof profile !== 'undefined' && profile && profile.state && document.getElementById('prestige-card') && window.PrestigeRules, null, { timeout: 30000 });
  const reload = async (page) => { await page.reload(); await ready(page); };
  const patch = async (page, mutate) => {
    const owner = await page.evaluate(() => window.PlatformBridge.user());
    assert.ok(owner, 'the guest has a server identity');
    await store.withUsers([owner], async () => { const u = await store.getUser(owner); mutate(u); await store.putUser(u); });
  };
  const stock = (bot, rig, level = 0, extra = {}) => (u) => { u.state.owned.bot = bot; u.state.owned.rig = rig; u.state.prestige = level; Object.assign(u.state, extra); u.sync.settledAt = Date.now(); };
  const synced = (page) => page.waitForFunction(() => SYNC.pending.length === 0 && !SYNC.inflight, null, { timeout: 30000 });
  const shop = async (page) => { await page.evaluate(() => switchTab('shop')); await page.locator('#prestige-card').waitFor({ state: 'visible' }); };
  const box = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }, sel);
  const overlap = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
  const text = (page, sel) => page.locator(sel).innerText().then((s) => s.replace(/\s+/g, ' ').trim());
  const server = (page) => page.evaluate(async () => (await window.PlatformBridge.request('/api/me')).state);
  const btn = (page) => page.evaluate(() => { const b = document.getElementById('prestige-btn'); return { state: b.dataset.state, disabled: b.disabled, text: b.textContent }; });

  try {
    // ================================================================== 1) a brand-new player (390x844): the card is there, locked, honest
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      await shop(page);
      assert.equal(await text(page, '#prestige-level'), 'المستوى 0 من 10');
      assert.equal(await text(page, '#prestige-mult'), '×1');
      assert.deepEqual(await btn(page), { state: 'locked', disabled: true, text: 'يلزمك 15 عاملاً و3 منصّة' });
      assert.deepEqual(await page.locator('#prestige-needs .prestige-need b').allInnerTexts(), ['0/15', '0/3']);
      assert.equal(await text(page, '#gain-bot'), '5'); assert.equal(await text(page, '#gain-rig'), '25', 'at level 0 a bot earns 5 and a rig 25, as ever');
      assert.doesNotMatch(await page.locator('#prestige-card').innerText(), EMOJI, 'the card is emoji-free');
      assert.equal(await page.locator('#prestige-card svg.ui-icon').count(), 3, 'its icons are SVG (the sparkle and one per need)');
      await page.locator('#prestige-btn').click({ force: true });
      assert.equal(await page.evaluate(() => SYNC.pending.length), 0, 'a locked button sends nothing');
      report.locked = { level: 0, needs: ['0/15', '0/3'] };
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 2) the whole flow: 14 bots → buy the 15th → ask → (a stale ask lapses) → ask → confirm → reset → reload
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      await patch(page, stock(14, 3, 0, { gold: 1_000_000, totalEarned: 2_000_000, xp: 777, ores: { copper: 5, iron: 4, gold: 3, crystal: 2, lava: 1 } }));
      await patch(page, (u) => { u.state.owned.click = 4; u.state.mines.wins = [3, 1, 0, 0, 0, 0]; u.state.equipment = { ...u.state.equipment, pickaxe: 2 }; });
      await reload(page); await shop(page);
      assert.equal(await text(page, '#prestige-btn'), 'يلزمك 15 عاملاً و3 منصّة', 'one bot short');
      assert.deepEqual(await page.locator('#prestige-needs .prestige-need b').allInnerTexts(), ['14/15', '3/3']);
      assert.equal(await page.locator('#prestige-needs .prestige-need.ok').count(), 1, 'the rigs are done, the bots are not');
      // the 15th bot, bought in the shop with a tap, completes the requirement live
      await page.locator('#btn-upgrade-bot').click();
      await page.waitForFunction(() => document.getElementById('prestige-btn').dataset.state === 'ready');
      assert.deepEqual(await btn(page), { state: 'ready', disabled: false, text: 'تبجيل ← ×1.1' });
      await synced(page);
      const before = await server(page), readAt = Date.now();
      assert.deepEqual([before.owned.bot, before.owned.rig, before.prestige], [15, 3, 0]);
      assert.equal(before.passiveIncome, 150);

      // one touch only asks
      await page.locator('#prestige-btn').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(media, 'prestige-card.jpg'), type: 'jpeg', quality: 80, timeout: 90000 });
      await page.locator('#prestige-btn').click();
      assert.deepEqual(await btn(page), { state: 'confirm', disabled: false, text: 'اضغط مرة أخرى للتأكيد: يُصفَّر 15 عاملاً و3 منصّة' });
      assert.equal(await page.evaluate(() => SYNC.pending.length), 0, 'the first touch sends nothing');
      assert.equal((await server(page)).prestige, 0);
      // a stale ask lapses by itself (6 seconds), and a later tap asks again instead of acting
      await page.waitForFunction(() => document.getElementById('prestige-btn').dataset.state === 'ready', null, { timeout: 12_000 });
      assert.equal(await page.evaluate(() => SYNC.pending.length), 0, 'the lapsed ask sent nothing either');
      report.asked = { onlyAsks: true, lapses: true };

      // ask and confirm
      await page.locator('#prestige-btn').click();
      assert.equal((await btn(page)).state, 'confirm');
      await page.locator('#prestige-btn').click();
      // at once, before any answer: the reset is on the page
      const instant = await page.evaluate(() => ({ bots: state.owned.bot, rigs: state.owned.rig, level: state.prestige, botCost: state.costs.bot, rigCost: state.costs.rig, income: state.passiveIncome, clicks: state.owned.click, ownedBot: document.getElementById('owned-bot').innerText, level_text: document.getElementById('prestige-level').textContent }));
      assert.deepEqual([instant.bots, instant.rigs, instant.level, instant.botCost, instant.rigCost, instant.income, instant.clicks], [0, 0, 1, 200, 1000, 0, 4], 'bots, rigs and their prices reset on the page at once; clicks stay');
      assert.equal(instant.ownedBot, ''); assert.equal(instant.level_text, 'المستوى 1 من 10 · دخلك السلبي +10%');
      assert.equal(await text(page, '#cost-upgrade-bot'), '200');
      await synced(page);
      assert.match(await page.locator('#sync-status').innerText(), /تبجيل مُعتمد: المستوى 1 — دخلك السلبي ×1\.1/);
      const after = await server(page);
      assert.deepEqual([after.owned.bot, after.owned.rig, after.prestige, after.costs.bot, after.costs.rig, after.passiveIncome], [0, 0, 1, 200, 1000, 0], 'the server agrees');
      for (const k of ['ores', 'equipment', 'mines', 'adventureUpgrades', 'adventure']) assert.deepEqual(after[k], before[k], `${k} is untouched`);
      assert.equal(after.owned.click, 4); assert.equal(after.xp, before.xp);
      const earnedMeanwhile = 150 * ((Date.now() - readAt) / 1000 + 2);   // 150 a second for as long as the test took (the waits above), plus slack
      assert.ok(after.gold >= before.gold && after.gold - before.gold <= earnedMeanwhile, `gold: nothing spent or lost, only the income earned meanwhile: ${before.gold} → ${after.gold} (at most +${Math.round(earnedMeanwhile)})`);
      // the card, locked again at level 1: it asks for more now
      assert.deepEqual(await btn(page), { state: 'locked', disabled: true, text: 'يلزمك 17 عاملاً و4 منصّة' });
      assert.equal(await text(page, '#prestige-mult'), '×1.1');
      // a third touch does nothing
      await page.locator('#prestige-btn').click({ force: true });
      assert.equal(await page.evaluate(() => SYNC.pending.length), 0);
      // it stays after a reload
      await reload(page); await shop(page);
      assert.equal(await text(page, '#prestige-level'), 'المستوى 1 من 10 · دخلك السلبي +10%');
      assert.deepEqual((await server(page)).owned, { click: 4, bot: 0, rig: 0 });
      report.done = { level: 1, reset: true, kept: ['ores', 'equipment', 'mines', 'adventureUpgrades', 'adventure', 'clicks', 'xp', 'gold'], persisted: true };
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 3) the income is real, and the top is the top
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      await patch(page, stock(15, 3, 1, { gold: 5_000 }));
      await reload(page); await shop(page);
      assert.equal(await text(page, '#profit-per-sec'), '+165', 'the stock that earned 150 earns 165 at level 1');
      assert.equal(await text(page, '#gain-bot'), '5.5'); assert.equal(await text(page, '#gain-rig'), '27.5');
      assert.equal((await server(page)).passiveIncome, 165);
      // a purchase now adds exactly what the shop line says
      await patch(page, stock(0, 0, 3, { gold: 5_000 }));
      await reload(page); await shop(page);
      await page.locator('#btn-upgrade-bot').click();
      await page.waitForFunction(() => state.owned.bot === 1);
      assert.equal(await page.evaluate(() => state.passiveIncome), 6.5, 'one bot at level 3 is 6.5 a second');
      assert.equal(await text(page, '#profit-per-sec'), '+6.5');
      await synced(page);
      assert.equal((await server(page)).passiveIncome, 6.5, 'and the server says the same');
      // the top level
      await patch(page, stock(500, 200, 10));
      await reload(page); await shop(page);
      assert.deepEqual(await btn(page), { state: 'max', disabled: true, text: 'المستوى الأقصى ×2' });
      assert.equal(await text(page, '#prestige-level'), 'المستوى 10 من 10 · دخلك السلبي +100%');
      assert.equal(await page.locator('#prestige-needs .prestige-bar').count(), 0, 'nothing more to ask for');
      assert.equal((await server(page)).passiveIncome, (500 + 5 * 200) * 2 * 5, 'level 10: double');
      report.income = { level1: 165, bot: 5.5, rig: 27.5, level3Bot: 6.5 };
      report.top = { text: 'المستوى الأقصى ×2', income: 15_000 };
      assert.deepEqual(errors, []);
      await ctx.close();
    }

    // ================================================================== 4) phones: the card fits in every state, with two fonts
    const fits = async (page, vp, tag) => {
      const states = [['locked', stock(10, 2, 0)], ['ready', stock(15, 3, 0)], ['asking', stock(15, 3, 0)], ['maxed', stock(500, 200, 10)]];
      for (const [name, setup] of states) {
        await patch(page, setup);
        await reload(page); await shop(page);
        if (name === 'asking') await page.locator('#prestige-btn').click();
        await page.locator('#prestige-card').scrollIntoViewIfNeeded();
        const label = `${tag}/${name}`;
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${label}: no sideways scroll`);
        const card = await box(page, '#prestige-card'), button = await box(page, '#prestige-btn'), head = await box(page, '.prestige-head');
        assert.ok(card.l >= -1 && card.r <= vp.width + 1, `${label}: the card is inside the screen width`);
        assert.ok(button.l >= card.l - 1 && button.r <= card.r + 1, `${label}: the button is inside the card`);
        assert.ok(button.h >= 30, `${label}: a tappable button (${button.h}px)`);
        assert.ok(await page.evaluate(() => { const b = document.getElementById('prestige-btn'); return b.scrollWidth <= b.clientWidth + 1; }), `${label}: the button's text is not cut off sideways`);
        const parts = await page.evaluate(() => ['.prestige-ico', '.prestige-titles', '.prestige-mult'].map((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }));
        for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) assert.equal(overlap(parts[i], parts[j]), false, `${label}: the head's parts ${i} and ${j} do not overlap`);
        assert.ok(parts[2].r <= head.r + 1 && parts[0].l >= head.l - 1, `${label}: the head's parts stay inside it`);
        if (name !== 'maxed') {
          const needs = await page.evaluate(() => [...document.querySelectorAll('.prestige-need')].map((r) => [...r.children].map((c) => { const b = c.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; })));
          needs.forEach((cells, k) => {
            for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) assert.equal(overlap(cells[i], cells[j]), false, `${label}: need ${k}: cells ${i} and ${j} do not overlap`);
            assert.ok(cells[1].r - cells[1].l >= 30, `${label}: need ${k}: the bar keeps a visible length (${Math.round(cells[1].r - cells[1].l)}px)`);
          });
        }
        // the shop lines above do not collide with the buy buttons
        for (const t of ['bot', 'rig']) {
          const line = await box(page, `#gain-${t}`), buy = await box(page, `#btn-upgrade-${t}`);
          assert.equal(overlap(line, buy), false, `${label}: the ${t} line and its buy button do not overlap`);
        }
        assert.doesNotMatch(await page.locator('#prestige-card').innerText(), EMOJI, `${label}: emoji-free`);
      }
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
