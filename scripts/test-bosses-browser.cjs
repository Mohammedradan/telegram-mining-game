// Real Chromium E2E for V5 — a world per mine and two bosses. Run against a LOCAL development server, never production:
//   CHROMIUM_PATH=/path/to/chromium npm run test:bosses
// The server verifies every run by replaying it and refuses a round that is faster than real time. To exercise the whole real
// pipeline (mines map → server ticket → boss HUD → events → finish → receipt) without playing a minute of wall-clock per boss,
// this script (1) opens the dev SQLite file to unlock the mine for its throwaway guest, (2) computes a legal winning input list with the
// same generic bot the unit tests use, (3) moves the run's start time back by the round's duration, and (4) feeds the inputs through the
// client's own step function (PlatformGame.feed) in stages, checking the screen at the moments that matter.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');
const bot = require('../test/fixtures/platform-bot.cjs');
const { createStore } = require('../db');

const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser tests require a local development server, never a public deployment');
const media = path.join(__dirname, '../docs/media');
const dbFile = process.env.DATABASE_FILE || path.join(__dirname, '../data/game.db');
const wait = ms => new Promise(r => setTimeout(r, ms));
const read = page => page.evaluate(() => window.PlatformGame.inspect());
// the run is paused while the recorded inputs are fed, which raises the pause menu: hide it so the picture shows the scene
const shot = async (page, name) => {
  await page.evaluate(() => { document.getElementById('platform-overlay').hidden = true; });
  await page.screenshot({ path: path.join(media, name), type: 'jpeg', quality: 80, timeout: 60000 });
};

// the ticks at which the engine fires each event in the winning input list (so the stages below are exact, not sleeps)
function trace(seed, hero, config, inputs) {
  const s = R.create(hero, seed, config), at = {};
  let t = 0;
  for (const seg of inputs) for (let i = 0; i < seg.frames; i++) {
    R.step(s, seg.mask); t++;
    for (const e of s.events) (at[e.type] = at[e.type] || []).push({ t, e });
  }
  return { at, final: s, ticks: t };
}

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium executable');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], report = { map: null, fights: [], errors };
  fs.mkdirSync(media, { recursive: true });
  const store = createStore();
  const Database = require('better-sqlite3');
  const raw = new Database(dbFile);
  async function context(viewport, extras = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: true, ...extras });
    // الإرشاد يظهر مرة واحدة لكل جهاز جديد (platform-coach:v1) فيغطي أزرار اللوحة. هذا الاختبار يبدأ
    // بجهاز «شاهد الإرشاد» كي يقيس اللعب لا طبقة الشرح؛ سلوك اللعبة نفسه لم يُغيَّر، وللإرشاد اختبار مستقل
    // (scripts/test-coach-browser.cjs) يثبت ظهوره وإغلاقه.
    await ctx.addInitScript(() => { try { localStorage.setItem('platform-coach:v1', '1'); } catch (_) {} });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|favicon|fonts\.g|telegram\.org/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await page.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
    await page.goto(base);
    await page.waitForFunction(() => window.PlatformGame && !document.getElementById('platform-start').disabled);
    return { ctx, page };
  }
  try {
    // ------------------------------------------------------------------ the mines map shows each world's danger and its boss
    {
      const { ctx, page } = await context({ width: 390, height: 844 });
      await page.evaluate(() => window.openMines());
      assert.equal(await page.locator('.mine-card').count(), 6);
      assert.equal(await page.locator('.mine-boss').count(), 2, 'exactly two mines announce a boss');
      assert.match(await page.locator('[data-mine-card="2"] .mine-boss').textContent(), /عملاق الذهب/);
      assert.match(await page.locator('[data-mine-card="5"] .mine-boss').textContent(), /حارس القلب/);
      for (let i = 0; i < 6; i++) assert.ok((await page.locator(`[data-mine-card="${i}"] .mine-danger`).textContent()).trim().length > 3, `mine ${i} names its danger`);
      assert.equal(await page.locator('.mine-card .mine-world svg').count(), 8, 'six danger icons and two boss icons, all drawn as SVG');
      await page.locator('[data-mine-card="2"]').scrollIntoViewIfNeeded();
      await shot(page, 'worlds-map.jpg');
      report.map = { cards: 6, bosses: 2 };
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    // ------------------------------------------------------------------ both boss mines, both motion settings, through the real client
    const flows = [
      { zone: 2, hero: 'miner', wins: [1, 1, 0, 0, 0, 0], gear: { pickaxe: 1 }, reduced: false, boss: 'عملاق الذهب', shots: 'colossus', viewport: { width: 390, height: 844 } },
      { zone: 5, hero: 'warrior', wins: [1, 1, 1, 1, 1, 0], gear: { pickaxe: 4, armor: 3 }, reduced: true, boss: 'حارس القلب', shots: 'warden', viewport: { width: 844, height: 390 } },
    ];
    for (const flow of flows) {
      const { ctx, page } = await context(flow.viewport, { reducedMotion: flow.reduced ? 'reduce' : 'no-preference' });
      const owner = await page.evaluate(() => window.PlatformBridge.user());
      assert.ok(owner, 'the guest has a server identity');
      await store.withUsers([owner], async () => {
        const u = await store.getUser(owner);
        u.state.mines.wins = flow.wins.slice(); Object.assign(u.state.equipment, flow.gear);
        await store.putUser(u);
      });
      await page.reload();
      await page.waitForFunction(() => window.PlatformGame && !document.getElementById('platform-start').disabled);
      await page.evaluate(h => window.PlatformGame.setHero(h), flow.hero);
      await page.evaluate(() => window.openMines());
      assert.equal(await page.locator(`[data-mine-pick="${flow.zone}"]`).isEnabled(), true, 'the mine is open for this account');
      await page.locator(`[data-mine-pick="${flow.zone}"]`).click();
      assert.equal(await page.evaluate(() => window.PlatformGame.getZone()), flow.zone);
      await page.locator('#platform-start').click();
      await page.waitForFunction(() => window.PlatformGame.inspect().running);
      await page.locator('#platform-pause').click(); // the recorded inputs below replace the keyboard
      const start = await read(page);
      assert.equal(start.zone, flow.zone); assert.equal(start.hero, flow.hero);
      assert.deepEqual(start.boss && [start.boss.name, start.boss.state, start.boss.defeated], [flow.boss, 'sleep', false], 'the boss waits at the far end');
      assert.equal(await page.locator('#mission-boss').isVisible(), true, 'the mission card shows the boss row');
      assert.equal(await page.locator('#mission-boss').textContent(), '0/1');

      const seed = R.seedFromId(start.ticket), config = start.config;
      // the real-time loop may have stepped a few idle ticks before the pause landed: the bot continues from exactly there
      const idle = start.tick;
      const { state: expected, inputs: full } = bot(seed, start.hero, config, {}, idle);
      assert.equal(expected.status, 'won', 'the bot beats this exact ticket');
      if (idle) assert.deepEqual(full[0], { mask: 0, frames: idle }, 'the run so far is idle ticks only');
      const inputs = idle ? full.slice(1) : full;
      const { at, ticks } = trace(seed, start.hero, config, full);
      raw.prepare('UPDATE platform_runs SET started_at = ? WHERE id = ?').run(Date.now() - Math.ceil(ticks / 60 * 1000) - 6000, start.ticket);

      const feed = until => page.evaluate(([segs, tick]) => window.PlatformGame.feed(segs, tick), [inputs, until]);
      // wake
      await feed(at.boss_wake[0].t + 2);
      let now = await read(page);
      assert.equal(now.boss.state, 'walk', 'walking in wakes the boss'); assert.match(now.statusText, new RegExp(flow.boss));
      if (flow.shots === 'colossus') await shot(page, 'boss-wake.jpg');
      // the first warning: the lane and the floating word are on screen
      const windup = at.boss_windup[0];
      await feed(windup.t + Math.max(2, windup.e.ticks - 8));
      now = await read(page);
      assert.equal(now.boss.state, 'windup'); assert.ok(now.floaters > 0, 'the warning word floats above the boss');
      if (flow.shots === 'colossus') await shot(page, 'boss-windup.jpg');
      // the stun window: the only moment it can be hurt
      const stun = at.boss_stun[0];
      await feed(stun.t + 12);
      now = await read(page);
      assert.equal(now.boss.state, 'recover', 'after its attack the boss is stunned');
      if (flow.shots === 'colossus') await shot(page, 'boss-fight.jpg');
      if (flow.shots === 'warden') await shot(page, 'boss-warden.jpg');
      const hpAtStun = now.boss.hp;
      // keep fighting until it falls
      const death = at.boss_death[0];
      await feed(death.t - 1);
      now = await read(page);
      assert.ok(now.boss.hp < now.boss.maxHp && now.boss.hp <= hpAtStun, 'the stun windows wore the boss down');
      assert.equal(now.boss.defeated, false);
      await feed(death.t + 1);
      now = await read(page);
      assert.equal(now.boss.defeated, true); assert.equal(now.boss.state, 'dead');
      assert.equal(await page.locator('#mission-boss').textContent(), '1/1', 'the objective row ticks over');
      assert.match(now.statusText, /سقط/); assert.match(now.statusText, /غنيمة/);
      if (flow.shots === 'colossus') await shot(page, 'boss-victory.jpg');
      // the rest of the run, then the server's verdict
      const done = await feed(Infinity);
      assert.equal(done.status, 'won'); assert.equal(done.tick, ticks);
      await page.waitForFunction(() => !window.PlatformGame.inspect().pending && /محفوظ على الخادم/.test(document.getElementById('platform-status').textContent), null, { timeout: 30000 });
      const me = await page.evaluate(async () => (await window.PlatformBridge.request('/api/me')));
      const state = me.state;
      assert.equal(state.adventure.bossWins, 1, 'the server counted the kill from its own replay');
      assert.equal(state.mines.wins[flow.zone], 1);
      assert.ok(me.achievements.items.find(i => i.id === 'boss').done, 'the achievement nobody could reach before is unlocked');
      const loot = R.oreSummary(expected);
      for (const [ore, n] of Object.entries(loot)) assert.equal(state.ores[ore], n, `${ore} credited exactly as replayed`);
      // the adventure quests follow from the same replay (batch 3b): the right boss under its own key, this round's enemies and ores — and the
      // missions panel already shows them (the finish receipt refreshed the page, no reload) and pays a claim with one tap
      const bossQuest = flow.zone === 2 ? 'colossus' : 'warden', otherBoss = flow.zone === 2 ? 'warden' : 'colossus';
      const qs = Object.fromEntries(me.quests.items.map(i => [i.id, i]));
      assert.equal(qs[bossQuest].done, true, 'the boss quest of this mine is done'); assert.equal(qs[otherBoss].done, false, 'and the other boss is not');
      assert.equal(qs.first_rock.done, expected.mined >= 1, 'rocks mined, from the replay');
      assert.equal(qs.guards_50.value, Math.min(50, expected.defeated), 'enemies defeated, from the replay');
      for (const [ore, id, target] of [['copper', 'copper_40', 40], ['iron', 'iron_30', 30], ['gold', 'gold_25', 25], ['crystal', 'crystal_20', 20], ['lava', 'lava_15', 15]]) assert.equal(qs[id].value, Math.min(target, loot[ore]), `${ore} for the quests = the ${ore} the server credited`);
      assert.equal(qs.win_stone.done, flow.wins[0] >= 1 || false, 'a win in mine 1 comes from the mines record');
      assert.deepEqual(await page.evaluate(id => { const i = profile.quests.items.find(x => x.id === id); return { done: i.done, claimed: i.claimed }; }, bossQuest), { done: true, claimed: false }, 'the page already knows (the receipt refreshed it)');
      await page.evaluate(() => { switchPlayPanel('missions'); document.getElementById('quests-box').open = true; });
      assert.match(await page.locator(`[data-quest="${bossQuest}"]`).getAttribute('class'), /ready/);
      const goldBefore = await page.evaluate(() => Math.floor(state.gold));
      await page.locator(`[data-quest-claim="${bossQuest}"]`).click();
      await page.waitForFunction(() => SYNC.pending.length === 0 && !SYNC.inflight, null, { timeout: 30000 });
      const paid = await page.evaluate(async () => (await window.PlatformBridge.request('/api/me')));
      assert.equal(paid.quests.items.find(i => i.id === bossQuest).claimed, true);
      assert.equal(Math.floor(paid.state.gold), goldBefore + qs[bossQuest].gold, `the ${bossQuest} quest paid its ${qs[bossQuest].gold} gold`);
      assert.equal(paid.state.xp, state.xp + qs[bossQuest].xp, `and its ${qs[bossQuest].xp} XP`);
      report.fights.push({ zone: flow.zone, hero: flow.hero, reduced: flow.reduced, ticks, segments: inputs.length, bossHpAtFirstStun: hpAtStun, bossWins: state.adventure.bossWins, ores: loot, quest: { id: bossQuest, gold: qs[bossQuest].gold, xp: qs[bossQuest].xp } });
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    raw.close();
    await store.close?.();
    await Promise.race([browser.close(), wait(3000)]);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
