// Real-Chromium E2E for the interactive mining (clicker) screen. Run against a LOCAL development server:
//   CHROMIUM_PATH=/path/to/chromium TEST_APP_URL=http://127.0.0.1:3000 npm run test:clicker
// It drives real touch/keyboard input and checks that the visual layer (tilt, floating numbers, particles, streak/heat,
// energy states, live boost button, goal card, sound toggle) never changes the economy: gold/energy/ops accounting stays
// exactly what the game logic decides, and the server agrees once the ops queue drains.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser tests require a local development server, never a public deployment');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const EMOJI = /\p{Extended_Pictographic}/u;

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium executable');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const report = { layout: {}, taps: {}, energy: {}, boost: {}, goal: {}, sound: {}, keyboard: {}, level: {}, reducedMotion: {}, viewports: [], errors };

  async function open(viewport, extras = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'no-preference', ...extras });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // The aborted Telegram SDK request is expected: the page must work with every external resource unavailable.
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await page.route('**/*', (r) => (new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort()));
    // optional stress knob for slow CI runners: CLICKER_CPU_THROTTLE=4 makes the page 4x slower (assertions must not depend on speed)
    if (Number(process.env.CLICKER_CPU_THROTTLE) > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CLICKER_CPU_THROTTLE) });
    await page.goto(base);
    await page.waitForFunction(() => window.ClickerFX && window.ClickerFX.active && typeof serverMode !== 'undefined' && serverMode === true, null, { timeout: 20000 });
    await page.locator('#nav-mining').tap();
    await page.waitForFunction(() => document.getElementById('tab-mining').classList.contains('active'));
    return { ctx, page };
  }
  // Drains the ops queue so the server and the screen agree before comparing them.
  const settle = (page) => page.waitForFunction(() => !SYNC.inflight && SYNC.pending.length === 0 && SYNC.clicks === 0, null, { timeout: 20000, polling: 100 });
  // A synthetic pointerdown on the coin: runs the page's real handler and reads the DOM in the same task (no timing races).
  const TAP = `(opt) => {
    const btn = document.getElementById('mine-btn'), r = document.getElementById('click-area').getBoundingClientRect();
    const x = r.left + r.width * (opt.fx ?? 0.5), y = r.top + r.height * (opt.fy ?? 0.5);
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y, button: 0 }));
  }`;

  try {
    // ---------------------------------------------------------------- 390x844 phone: layout + interactions
    const { ctx, page } = await open({ width: 390, height: 844 });

    // 1) layout: everything fits without scrolling, nothing overlaps, and the screen is SVG-only (no emoji tofu boxes)
    const geo = await page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const tab = document.getElementById('tab-mining');
      return { coin: r('#mine-btn'), boost: r('#boost-btn'), goal: r('#ck-goal'), energy: r('#energy-container'), nav: r('nav'), balance: r('.balance-strip'),
        scrollFits: tab.scrollHeight <= tab.clientHeight + 1, hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        // #sync-status is a screen-reader-only line (never painted), so it is not part of "what the screen shows"
        text: [...document.querySelectorAll('#tab-mining, .app-header, .balance-strip, #energy-container')].map((e) => { const c = e.cloneNode(true); c.querySelector('#sync-status')?.remove(); return c.textContent; }).join(' ') };
    });
    assert.equal(geo.scrollFits, true, 'the mining tab needs no scrolling on a phone');
    assert.equal(geo.hScroll, false, 'no horizontal overflow');
    assert.ok(geo.coin.w >= 200 && geo.coin.l >= 0 && geo.coin.r <= 390, 'the coin is big and inside the viewport');
    assert.ok(geo.balance.b <= geo.coin.t + 1, 'the balance strip sits above the coin');
    assert.ok(geo.coin.b <= geo.boost.t + 1 && geo.boost.b <= geo.goal.t + 1 && geo.goal.b <= geo.energy.t + 1 && geo.energy.b <= geo.nav.t + 1, 'coin, boost, goal, energy and nav stack without overlap');
    assert.equal(EMOJI.test(geo.text), false, 'the mining screen uses SVG icons only');
    const gemPaints = await page.evaluate(() => document.querySelectorAll('#ck-gem polygon').length);
    assert.ok(gemPaints >= 7, 'the gem is a faceted SVG, not a font glyph');
    report.layout.phone = true;

    // 2) tilt follows the touch point (right edge presses the right side in, top edge presses the top in)
    const tilt = await page.evaluate(`(() => { const tap = ${TAP}; const read = () => { const c = document.getElementById('ck-coin'); return [parseFloat(c.style.getPropertyValue('--ry')), parseFloat(c.style.getPropertyValue('--rx')), c.classList.contains('is-down'), parseFloat(c.style.getPropertyValue('--sc'))]; };
      tap({ fx: 0.98, fy: 0.5 }); const right = read(); tap({ fx: 0.02, fy: 0.5 }); const left = read(); tap({ fx: 0.5, fy: 0.02 }); const top = read(); tap({ fx: 0.5, fy: 0.98 }); const bottom = read();
      return { right, left, top, bottom }; })()`);
    assert.ok(tilt.right[0] > 8 && Math.abs(tilt.right[1]) < 3, `right edge tilts +Y (${tilt.right})`);
    assert.ok(tilt.left[0] < -8, `left edge tilts -Y (${tilt.left})`);
    assert.ok(tilt.top[1] > 8, `top edge tilts +X (${tilt.top})`);
    assert.ok(tilt.bottom[1] < -8, `bottom edge tilts -X (${tilt.bottom})`);
    assert.ok(tilt.right[2] && tilt.right[3] < 1, 'the coin is pressed (scaled down) on a tap');
    await page.waitForFunction(() => { const c = document.getElementById('ck-coin'); return !c.classList.contains('is-down') && c.style.getPropertyValue('--ry') === '0deg'; }, null, { timeout: 4000 });
    const rest = await page.evaluate(() => { const c = document.getElementById('ck-coin'); return [c.style.getPropertyValue('--ry'), c.style.getPropertyValue('--rx'), c.style.getPropertyValue('--sc'), c.classList.contains('is-down')]; });
    assert.deepEqual(rest, ['0deg', '0deg', '1', false], 'the coin springs back to rest');
    report.taps.tilt = true;
    await wait(900); // let the streak from the synthetic taps fade
    await settle(page);

    // 3) a counted burst: accounting is exact, caps hold, and the visual layer reacts
    const burst = await page.evaluate(`(async () => { const tap = ${TAP};
      const g0 = state.gold, e0 = state.energy, p = state.clickPower, N = 12;
      const before = document.getElementById('mine-btn').getBoundingClientRect();
      for (let i = 0; i < N; i++) tap({ fx: 0.3 + (i % 5) * 0.1, fy: 0.35 + (i % 4) * 0.1 });
      const q = (s) => document.querySelector(s);
      const out = { dGold: state.gold - g0, dEnergy: e0 - state.energy, N, p, fx: ClickerFX.inspect(), streakOn: q('#ck-streak').classList.contains('is-on'), streakN: q('#ck-streak-n').textContent,
        heat: parseFloat(q('#ck-stage').style.getPropertyValue('--heat')), floats: document.querySelectorAll('#ck-layer .ck-num').length, rings: document.querySelectorAll('#ck-layer .ck-ring').length };
      const after = document.getElementById('mine-btn').getBoundingClientRect();
      const topEl = document.elementFromPoint(before.left + before.width / 2, before.top + 4);
      return { ...out, shifted: Math.abs(before.top - after.top) > 0.5 || Math.abs(before.left - after.left) > 0.5, passThrough: !!topEl && q('#mine-btn').contains(topEl), counter: q('#gold-counter').textContent, gold: Math.floor(state.gold) }; })()`);
    assert.ok(Math.abs(burst.dGold - burst.N * burst.p) < 1e-6, `each tap credits exactly clickPower gold (the effects add nothing): ${burst.dGold}`);
    assert.ok(Math.abs(burst.dEnergy - burst.N * burst.p) < 1e-6, `each tap spends exactly clickPower energy: ${burst.dEnergy}`);
    assert.ok(burst.fx.streak >= 12 && burst.streakOn && Number(burst.streakN) >= 12, `the streak badge counts the taps: ${JSON.stringify({ streak: burst.fx.streak, on: burst.streakOn, n: burst.streakN })}`);
    assert.ok(burst.heat > 0.4 && burst.heat <= 1, `the heat ring fills (${burst.heat})`);
    assert.ok(burst.floats > 0 && burst.floats <= 24, `floating numbers appear and stay capped (${burst.floats})`);
    assert.ok(burst.rings > 0, 'tap ripples appear');
    assert.ok(burst.fx.particles > 0 && burst.fx.particles <= 150, `particles are emitted and capped (${burst.fx.particles})`);
    assert.equal(burst.shifted, false, 'effects never shift the coin');
    assert.equal(burst.passThrough, true, 'the streak badge does not swallow touches on the coin rim');
    assert.equal(burst.counter, burst.gold.toLocaleString('en-US'), 'the balance shows the true gold');
    // the canvas actually paints the particles on the next frames (read only the area around the coin: full-canvas readbacks are slow)
    const painted = await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = document.getElementById('ck-fx'), k = c.width / c.clientWidth, a = document.getElementById('click-area').getBoundingClientRect();
      const x = Math.max(0, Math.floor((a.left - 60) * k)), y = Math.max(0, Math.floor((a.top - 140) * k));
      const w = Math.min(c.width - x, Math.ceil((a.width + 120) * k)), h = Math.min(c.height - y, Math.ceil((a.height + 220) * k));
      const d = c.getContext('2d').getImageData(x, y, w, h).data; let lit = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
      return { lit, particles: ClickerFX.inspect().particles };
    });
    assert.ok(painted.lit > 50, `the canvas paints the particles (${JSON.stringify(painted)})`);
    report.taps.burst = { floats: burst.floats, particles: burst.fx.particles, litPixels: painted.lit };

    // real CDP touch taps register too (this is what a finger does)
    const coinBox = await page.locator('#mine-btn').boundingBox();
    const g1 = await page.evaluate(() => state.gold);
    for (let i = 0; i < 4; i++) { await page.touchscreen.tap(coinBox.x + coinBox.width * (0.35 + i * 0.1), coinBox.y + coinBox.height * 0.5); await wait(30); }
    const g2 = await page.evaluate(() => state.gold);
    assert.ok(g2 - g1 >= 3.99, 'real touch taps credit gold');

    // 4) frenzy: 26 quick taps light the whole screen up, then everything fades after a pause
    await wait(1200); await settle(page);
    const frenzy = await page.evaluate(`(async () => { const tap = ${TAP}; for (let i = 0; i < 26; i++) tap({ fx: 0.4 + (i % 3) * 0.1, fy: 0.45 });
      const q = (s) => document.querySelector(s); return { fx: ClickerFX.inspect(), attr: q('#ck-stage').dataset.frenzy, banner: q('#ck-banner').classList.contains('is-on') ? q('#ck-banner').textContent : '',
        status: q('#ck-status').classList.contains('is-on') ? q('#ck-status').dataset.kind : '', tier: q('#ck-streak').dataset.tier, floats: document.querySelectorAll('#ck-layer > *').length }; })()`);
    assert.equal(frenzy.fx.frenzy, true, 'frenzy starts after a long streak');
    assert.equal(frenzy.attr, '1');
    assert.match(frenzy.banner, /حمّى/);
    assert.equal(frenzy.status, 'hot');
    assert.equal(frenzy.tier, '3', 'the streak badge reaches its top tier');
    assert.ok(frenzy.floats <= 24, 'the DOM layer stays capped during a burst');
    await page.waitForFunction(() => { const f = ClickerFX.inspect(); return !f.frenzy && f.heat === 0 && f.streak === 0; }, null, { timeout: 8000 });
    const calm = await page.evaluate(() => ({ streakOn: document.getElementById('ck-streak').classList.contains('is-on'), attr: document.getElementById('ck-stage').dataset.frenzy, particles: ClickerFX.inspect().particles }));
    assert.deepEqual(calm, { streakOn: false, attr: '0', particles: 0 }, 'frenzy, streak and particles all settle after a pause');
    report.taps.frenzy = true;

    // 5) energy: low warning, empty refusal, refill
    const low = await page.evaluate(() => { state.energy = 150; updateUI(); const q = (s) => document.querySelector(s); return { level: q('#energy-container').dataset.level, pill: q('#ck-status').classList.contains('is-on') ? `${q('#ck-status').dataset.kind}:${q('#ck-status-text').textContent}` : '', regen: q('#ck-regen').classList.contains('is-on'), ghost: q('#energy-ghost').style.width }; });
    assert.equal(low.level, 'low');
    assert.match(low.pill, /^low:.*150/, 'the low-energy pill reports how many taps remain');
    assert.equal(low.regen, true, 'the +3/s chip shows while recharging');
    assert.equal(low.ghost, '15%');
    const empty = await page.evaluate(`(() => { const tap = ${TAP}; state.energy = 0; updateUI(); const g0 = state.gold, c0 = SYNC.clicks, q = (s) => document.querySelector(s);
      const level = q('#energy-container').dataset.level, pill = q('#ck-status').dataset.kind; tap({}); const deny = [...document.querySelectorAll('#ck-layer .ck-num.is-deny')].map((e) => e.textContent);
      return { level, pill, deny, dGold: state.gold - g0, dClicks: SYNC.clicks - c0, streak: ClickerFX.inspect().streak }; })()`);
    assert.equal(empty.level, 'empty');
    assert.equal(empty.pill, 'empty');
    assert.deepEqual(empty.deny, ['لا طاقة'], 'a tap without energy shows a red notice');
    assert.equal(empty.dGold, 0, 'a refused tap credits nothing');
    assert.equal(empty.dClicks, 0, 'a refused tap queues nothing for the server');
    assert.equal(empty.streak, 0, 'a refused tap does not extend the streak');
    await page.evaluate(() => { state.energy = state.maxEnergy; updateUI(); });
    assert.equal(await page.evaluate(() => document.getElementById('energy-container').dataset.level), 'full');
    report.energy = { low: true, empty: true, refill: true };
    await wait(2200); // the notice and the status pill finish
    await settle(page);

    // 6) keyboard: Enter/Space mine once per press, holding does not repeat
    await page.focus('#mine-btn');
    const k0 = await page.evaluate(() => state.gold);
    await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    const k1 = await page.evaluate(() => state.gold);
    assert.equal(k1 - k0, 2, 'Enter and Space each mine once');
    await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
    const k2 = await page.evaluate(() => state.gold);
    assert.equal(k2 - k1, 1, 'holding a key does not auto-repeat');
    report.keyboard = { enterSpace: true, noRepeat: true };
    await wait(1000);
    await settle(page);

    // 7) boost: the button looks active (not greyed out), doubles the numbers, and the ring/aura turn violet
    await page.locator('#boost-btn').tap();
    await page.waitForFunction(() => document.getElementById('boost-btn').dataset.state === 'active');
    const boost = await page.evaluate(`(() => { const tap = ${TAP}; const b = document.getElementById('boost-btn'), cs = getComputedStyle(b), q = (s) => document.querySelector(s);
      const g0 = state.gold; tap({}); const nums = [...document.querySelectorAll('#ck-layer .ck-num.is-boost')].map((e) => e.textContent);
      return { disabled: b.disabled, opacity: cs.opacity, filter: cs.filter, label: q('.ck-boost-label').textContent, time: q('.ck-boost-time').textContent, aura: q('#ck-stage').dataset.boost, body: document.body.classList.contains('ck-boost-on'),
        nums, dGold: state.gold - g0, income: getComputedStyle(q('#profit-per-sec'), '::after').content, p: parseFloat(b.style.getPropertyValue('--p')) }; })()`);
    assert.equal(boost.disabled, true, 'a running boost cannot be re-activated');
    assert.equal(boost.opacity, '1', 'the active boost button is not dimmed');
    assert.equal(boost.filter, 'none', 'the active boost button is not greyscaled');
    assert.match(boost.label, /فعّال/);
    assert.match(boost.time, /^0:(2\d|30)$/, `the countdown is a clean m:ss clock (${boost.time})`);
    assert.equal(boost.aura, '1');
    assert.equal(boost.body, true);
    assert.deepEqual(boost.nums, ['+2'], 'boosted taps show the doubled gain in the boost style');
    assert.equal(boost.dGold, 2, 'and the economy doubles exactly as before');
    assert.match(boost.income, /×2/, 'the income chip shows the x2 badge');
    assert.ok(boost.p > 0.9 && boost.p <= 1, `the countdown bar is nearly full right after activation (${boost.p})`);
    report.boost = { active: true, doubled: true };

    // 8) goal card: tap with the boost until 50 gold, buy the pickaxe from the screen, the server accepts it
    await page.evaluate(`(() => { const tap = ${TAP}; while (state.gold < 50) tap({}); })()`);
    const ready = await page.evaluate(() => { const q = (s) => document.querySelector(s); return { ready: q('#ck-goal').dataset.ready, disabled: q('#ck-goal-buy').disabled, name: q('#ck-goal-name').textContent, dot: document.body.classList.contains('ck-can-buy'), have: q('#ck-goal-have').textContent, fill: q('#ck-goal-fill').style.width, hidden: q('#ck-goal').hidden }; });
    assert.equal(ready.hidden, false);
    assert.equal(ready.ready, '1');
    assert.equal(ready.disabled, false, 'the buy button is enabled once the price is covered');
    assert.equal(ready.dot, true, 'the upgrades tab shows a notification dot');
    assert.equal(ready.fill, '100%');
    assert.equal(ready.name, 'فأس فولاذي');
    await settle(page); // the clicks reach the server first, so the purchase is valid there too
    const goldBeforeBuy = await page.evaluate(() => state.gold);
    await page.locator('#ck-goal-buy').tap();
    const bought = await page.evaluate(() => { const q = (s) => document.querySelector(s); return { owned: state.owned.click, power: state.clickPower, gold: state.gold, cost: state.costs.click, nextCost: q('#ck-goal-cost').textContent, name: q('#ck-goal-name').textContent, costNums: [...document.querySelectorAll('#ck-layer .ck-num.is-cost')].map((e) => e.textContent), p: ClickerFX.inspect().particles }; });
    assert.equal(bought.owned, 1);
    assert.equal(bought.power, 2, 'the pickaxe upgrade doubles the tap power');
    assert.equal(Math.round(goldBeforeBuy - bought.gold), 50);
    assert.equal(bought.nextCost, '75', 'the card moves on to the next price (50 x 1.5)');
    assert.deepEqual(bought.costNums, ['-50'], 'the spent amount floats up');
    assert.ok(bought.p > 0, 'a purchase burst is emitted');
    await settle(page);
    const server = await page.evaluate(() => api('/api/me'));
    assert.equal(server.state.owned.click, 1, 'the server accepted the purchase made from the mining screen');
    assert.equal(server.state.clickPower, 2);
    assert.equal(Math.floor(server.state.gold), Math.floor(await page.evaluate(() => state.gold)), 'server and screen agree on the balance once the queue drained');
    report.goal = { ready: true, bought: true, serverAgrees: true };

    // 9) the x2 badge in the header follows the boost on every tab, even when it ends while the player is elsewhere
    const badge = await page.evaluate(() => {
      const out = {}, chip = () => getComputedStyle(document.getElementById('profit-per-sec'), '::after').content;
      state.boostUntil = Date.now() + 20_000; state.boostCooldownUntil = Date.now() + 300_000; updateUI();
      out.on = document.body.classList.contains('ck-boost-on');
      switchTab('shop');
      out.onShop = chip();
      state.boostUntil = 0; updateUI(); // the boost ends while the player is on another tab
      out.off = document.body.classList.contains('ck-boost-on');
      out.offChip = chip();
      out.aura = document.getElementById('ck-stage').dataset.boost;
      switchTab('mining');
      return out;
    });
    assert.equal(badge.on, true);
    assert.match(badge.onShop, /×2/, 'the badge shows on other tabs too');
    assert.equal(badge.off, false, 'and clears when the boost ends off-screen');
    assert.match(badge.offChip, /^(none|normal)$/);
    assert.equal(badge.aura, '0');
    report.boost.badgeFollowsAcrossTabs = true;

    // 10) auto-miners show they work: a small green number every second (only when not tapping), doubled during the boost
    await wait(1400);
    await page.waitForFunction(() => { state.passiveIncome = 5; state.boostUntil = 0; return !!document.querySelector('#ck-layer .ck-num.is-auto'); }, null, { timeout: 4000, polling: 100 });
    const auto = await page.evaluate(() => [...document.querySelectorAll('#ck-layer .ck-num.is-auto')].map((e) => e.textContent));
    assert.ok(auto.length >= 1 && auto.every((t) => t === '+5'), `passive income shows its real per-second number (${auto})`);
    await page.evaluate(() => { state.passiveIncome = 0; });
    report.goal.passivePulse = true;

    // 11) leaving the tab clears every transient effect and returning is clean
    await page.evaluate(`(() => { const tap = ${TAP}; for (let i = 0; i < 8; i++) tap({}); switchTab('shop'); })()`);
    const away = await page.evaluate(() => ({ layer: document.getElementById('ck-layer').childElementCount, fx: ClickerFX.inspect(), streakOn: document.getElementById('ck-streak').classList.contains('is-on') }));
    assert.equal(away.layer, 0, 'no floating numbers linger over other tabs');
    assert.deepEqual([away.fx.particles, away.fx.heat, away.fx.streak, away.streakOn], [0, 0, 0, false]);
    await page.evaluate(() => switchTab('mining'));
    report.layout.leaveReturn = true;

    // 12) sound toggle persists across reloads (default is on, quiet synthesized ticks)
    assert.equal(await page.evaluate(() => ClickerFX.inspect().muted), false, 'sound is on by default');
    await page.locator('#ck-sound').tap();
    assert.equal(await page.evaluate(() => [document.getElementById('ck-sound').getAttribute('aria-pressed'), localStorage.getItem('mining-fx-muted')].join()), 'true,true');
    await page.reload();
    await page.waitForFunction(() => window.ClickerFX && window.ClickerFX.active && typeof serverMode !== 'undefined' && serverMode === true, null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => [ClickerFX.inspect().muted, document.getElementById('ck-sound').getAttribute('aria-pressed')].join()), 'true,true', 'the choice survives a reload');
    report.sound = { toggle: true, persisted: true };

    // 13) level-up: a rising level (same source) triggers the celebration once; a first sync never does
    await page.evaluate(() => { switchTab('mining'); updateUI(); });
    const level = await page.evaluate(`(async () => { const q = (s) => document.querySelector(s); const lv = profile.progress.level;
      updateUI(); const quiet = q('#ck-banner').classList.contains('is-on');
      profile.progress = { ...profile.progress, level: lv + 1, current: 0, needed: 999 }; updateUI();
      return { quiet, banner: q('#ck-banner').textContent, on: q('#ck-banner').classList.contains('is-on'), particles: ClickerFX.inspect().particles, live: q('#ck-live').textContent, lv: lv + 1, xp: q('#xp-text').textContent }; })()`);
    assert.equal(level.quiet, false, 'no celebration without a level change');
    assert.equal(level.on, true);
    assert.match(level.banner, new RegExp(`المستوى ${level.lv}`));
    assert.ok(level.particles > 40, 'confetti');
    assert.match(level.live, new RegExp(`${level.lv}`), 'screen readers hear about it');
    assert.match(level.xp, /^0\/999 XP$/, 'the XP numbers sit on the level label row');
    report.level = { celebration: true };

    await ctx.close();

    // ---------------------------------------------------------------- reduced motion: no tilt / particles / floating flight
    const rm = await open({ width: 390, height: 844 }, { reducedMotion: 'reduce' });
    const rmRes = await rm.page.evaluate(`(() => { const tap = ${TAP}; const g0 = state.gold; for (let i = 0; i < 5; i++) tap({ fx: 0.95, fy: 0.5 });
      const c = document.getElementById('ck-coin'); return { dGold: state.gold - g0, fx: ClickerFX.inspect(), ry: c.style.getPropertyValue('--ry'), sc: c.style.getPropertyValue('--sc'),
        floats: document.querySelectorAll('#ck-layer .ck-num').length, bob: getComputedStyle(document.querySelector('.ck-bob')).animationName, aura: getComputedStyle(document.querySelector('.ck-aura')).animationName }; })()`);
    assert.equal(rmRes.dGold, 5, 'mining works the same with reduced motion');
    assert.equal(rmRes.fx.reduced, true);
    assert.equal(rmRes.fx.particles, 0, 'no particles with reduced motion');
    assert.equal(parseFloat(rmRes.ry), 0, 'no tilt with reduced motion');
    assert.ok(rmRes.floats > 0, 'the gain is still shown');
    assert.equal(rmRes.bob, 'none', 'idle bobbing is off');
    assert.equal(rmRes.aura, 'none', 'idle breathing is off');
    report.reducedMotion = { tilt: false, particles: 0, gainShown: true };
    await rm.ctx.close();

    // ---------------------------------------------------------------- other screens: nothing overflows, everything reachable
    for (const viewport of [{ width: 360, height: 740 }, { width: 375, height: 667 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
      const v = await open(viewport);
      const m = await v.page.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s), b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, w: b.width }; };
        const tab = document.getElementById('tab-mining');
        return { coin: r('#mine-btn'), boost: r('#boost-btn'), goal: r('#ck-goal'), nav: r('nav'), fits: tab.scrollHeight <= tab.clientHeight + 1, h: document.documentElement.scrollWidth > document.documentElement.clientWidth, vh: innerHeight, vw: innerWidth };
      });
      assert.equal(m.fits, true, `${viewport.width}x${viewport.height}: the tab needs no scrolling`);
      assert.equal(m.h, false, `${viewport.width}x${viewport.height}: no horizontal overflow`);
      for (const k of ['coin', 'boost', 'goal']) assert.ok(m[k].t >= 0 && m[k].b <= m.vh && m[k].l >= 0 && m[k].r <= m.vw, `${viewport.width}x${viewport.height}: ${k} is fully on screen`);
      assert.ok(m.coin.w >= 140, `${viewport.width}x${viewport.height}: the coin stays tappable (${Math.round(m.coin.w)}px)`);
      // a real tap lands on the coin at every size
      const g0 = await v.page.evaluate(() => state.gold);
      const box = await v.page.locator('#mine-btn').boundingBox();
      await v.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      assert.ok((await v.page.evaluate(() => state.gold)) - g0 >= 0.99, `${viewport.width}x${viewport.height}: a real tap mines`);
      report.viewports.push(`${viewport.width}x${viewport.height}`);
      await v.ctx.close();
    }

    assert.deepEqual(errors, [], 'no page or console errors');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.race([browser.close(), wait(3000)]);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
