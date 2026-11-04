// Real-Chromium E2E for the interactive mining hub ("the cave"). Run against a LOCAL development server:
//   CHROMIUM_PATH=/path/to/chromium TEST_APP_URL=http://127.0.0.1:3000 npm run test:clicker
// It drives real touch/mouse/keyboard input and checks that the visual layer (cave scene, tilt, floating numbers, particles, streak/heat,
// energy states, live boost button, upgrade medals + window, "to the mine" button, sound toggle) and the dig site (the miner walks with
// the stick and digs the rock) never change the economy: gold/energy/ops accounting stays exactly what the game logic decides
// (every swing that hits the rock is one ordinary tap), and the server agrees once the ops queue drains.
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
  const report = { layout: {}, scene: {}, taps: {}, energy: {}, boost: {}, upgrades: {}, cta: {}, sound: {}, keyboard: {}, level: {}, dig: {}, reducedMotion: {}, viewports: [], errors };

  async function open(viewport, extras = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'no-preference', ...extras });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // The aborted Telegram SDK request is expected: the page must work with every external resource unavailable.
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    page.on('requestfailed', (r) => { if (new URL(r.url()).origin === new URL(base).origin) errors.push(`request failed: ${r.url()}`); });
    await page.route('**/*', (r) => (new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort()));
    // optional stress knob for slow CI runners: CLICKER_CPU_THROTTLE=4 makes the page 4x slower (assertions must not depend on speed)
    if (Number(process.env.CLICKER_CPU_THROTTLE) > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CLICKER_CPU_THROTTLE) });
    await page.goto(base);
    await page.waitForFunction(() => window.ClickerFX && window.ClickerFX.active && typeof serverMode !== 'undefined' && serverMode === true, null, { timeout: 20000 });
    await page.locator('#nav-mining').tap();
    await page.waitForFunction(() => document.getElementById('tab-mining').classList.contains('active'));
    // the painted art is part of the screen: wait until every image the hub shows has really loaded
    await page.waitForFunction(() => [...document.querySelectorAll('#tab-mining img, #ck-nodes img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 });
    return { ctx, page };
  }
  // Drains the ops queue so the server and the screen agree before comparing them.
  const settle = (page) => page.waitForFunction(() => !SYNC.inflight && SYNC.pending.length === 0 && SYNC.clicks === 0, null, { timeout: 20000, polling: 100 });
  // A synthetic pointerdown on the rock: runs the page's real handler and reads the DOM in the same task (no timing races).
  const TAP = `(opt) => {
    const btn = document.getElementById('mine-btn'), r = document.querySelector('#mine-btn .ck-bob').getBoundingClientRect();
    const x = r.left + r.width * (opt.fx ?? 0.5), y = r.top + r.height * (opt.fy ?? 0.5);
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y, button: 0 }));
  }`;
  const rectOf = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }, sel);

  try {
    // ---------------------------------------------------------------- 390x844 phone: layout + interactions
    const { ctx, page } = await open({ width: 390, height: 844 });

    // 1) layout: everything fits without scrolling, nothing overlaps, and the screen is emoji-free (SVG + painted art only)
    const geo = await page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const tab = document.getElementById('tab-mining');
      return { ore: r('#ck-ore'), hero: r('#ck-hero'), nodes: r('#ck-nodes'), area: r('#click-area'), actions: r('.ck-actions'), go: r('#ck-go'), boost: r('#boost-btn'), energy: r('#energy-container'), nav: r('nav'), balance: r('.balance-strip'),
        scrollFits: tab.scrollHeight <= tab.clientHeight + 1, hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        medals: [...document.querySelectorAll('#ck-nodes .ck-node')].map((n) => n.dataset.ckItem),
        // #sync-status is a screen-reader-only line (never painted), so it is not part of "what the screen shows"
        text: [...document.querySelectorAll('#tab-mining, .app-header, .balance-strip, #energy-container')].map((e) => { const c = e.cloneNode(true); c.querySelector('#sync-status')?.remove(); return c.textContent; }).join(' ') };
    });
    assert.equal(geo.scrollFits, true, 'the mining tab needs no scrolling on a phone');
    assert.equal(geo.hScroll, false, 'no horizontal overflow');
    assert.ok(geo.ore.w >= 110 && geo.ore.l >= 0 && geo.ore.r <= 390, `the rock is big and inside the viewport (${Math.round(geo.ore.w)}px)`);
    assert.ok(geo.hero.h >= 120 && geo.hero.l >= 0 && geo.hero.r <= geo.ore.l + 40, `the miner stands beside the rock on a tall phone (${Math.round(geo.hero.h)}px)`);
    assert.deepEqual(geo.medals, ['click', 'bot', 'rig', 'workshop', 'deepdive'], 'three upgrade medals, the workshop medal and the deep-dive medal');
    assert.ok(geo.balance.b <= geo.nodes.t + 1, 'the gold counter sits above the medals');
    assert.ok(geo.nodes.b <= geo.area.t + 1 && geo.area.b <= geo.actions.t + 1 && geo.actions.b <= geo.energy.t + 1 && geo.energy.b <= geo.nav.t + 1, 'medals, field, buttons, energy and nav stack without overlap');
    assert.ok(geo.go.l >= geo.boost.r - 1 || geo.boost.l >= geo.go.r - 1, 'the two buttons sit side by side');
    assert.ok(geo.go.w > geo.boost.w, 'the "to the mine" button is the bigger one');
    assert.equal(EMOJI.test(geo.text), false, 'the mining screen is emoji-free');
    report.layout.phone = true;

    // 1b) the cave: scene layer on, the right picture, loaded; hero/ore/medals painted from real files
    const scene = await page.evaluate(() => {
      const el = document.querySelector('.ck-scene'), cs = getComputedStyle(el);
      return { display: cs.display, bg: cs.backgroundImage, cls: document.body.classList.contains('ck-cave'), z: cs.zIndex, pos: cs.position,
        res: performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /assets\/cave/.test(n)).map((n) => n.replace(/^.*assets\/cave\//, '').replace(/\?.*$/, '')),
        imgs: [...document.querySelectorAll('#tab-mining img, #ck-nodes img')].map((i) => [i.getAttribute('src').replace(/\?.*$/, '').replace(/^.*assets\/cave\//, ''), i.naturalWidth > 0]),
        art: [...document.querySelectorAll('#ck-nodes .cv-art')].length, ringVars: [...document.querySelectorAll('#ck-nodes .cv-medal')].map((m) => m.style.getPropertyValue('--p')) };
    });
    assert.equal(scene.display, 'block', 'the cave scene is shown while the mining tab is open');
    assert.equal(scene.cls, true);
    assert.equal(scene.pos, 'fixed');
    assert.equal(scene.z, '-1', 'behind the whole interface');
    assert.match(scene.bg, /cave-portrait\.jpg/, 'a portrait phone gets the portrait scene');
    assert.ok(scene.res.includes('cave-portrait.jpg'), `the scene picture was really requested (${scene.res})`);
    assert.ok(scene.imgs.every(([, ok]) => ok), `every painted image loaded: ${JSON.stringify(scene.imgs)}`);
    assert.ok(scene.art >= 3, `the medals carry painted art (${scene.art})`);
    // the miner and the rock are sprite sheets painted by the stylesheet: they were requested and neither fallback class was needed
    assert.ok(['hero-sheet.webp', 'ore-sheet.webp'].every((f) => scene.res.includes(f)), `the miner and ore sheets were requested (${scene.res})`);
    const sheets = await page.evaluate(() => ({ cls: document.getElementById('ck-stage').className, hero: getComputedStyle(document.getElementById('ck-hero')).backgroundImage, ore: getComputedStyle(document.querySelector('.ck-ore-img')).backgroundImage }));
    assert.doesNotMatch(sheets.cls, /no-hero-art|no-ore-art/, 'the sprite sheets loaded: no drawn stand-ins');
    assert.match(sheets.hero, /hero-sheet\.webp/);
    assert.match(sheets.ore, /ore-sheet\.webp/);
    report.scene.phone = { picture: 'portrait', images: scene.imgs.length, sheets: true };

    // 2) tilt follows the touch point (right edge presses the right side in, top edge presses the top in)
    const tilt = await page.evaluate(`(() => { const tap = ${TAP}; const read = () => { const c = document.getElementById('ck-ore'); return [parseFloat(c.style.getPropertyValue('--ry')), parseFloat(c.style.getPropertyValue('--rx')), c.classList.contains('is-down'), parseFloat(c.style.getPropertyValue('--sc'))]; };
      tap({ fx: 0.98, fy: 0.5 }); const right = read(); tap({ fx: 0.02, fy: 0.5 }); const left = read(); tap({ fx: 0.5, fy: 0.02 }); const top = read(); tap({ fx: 0.5, fy: 0.98 }); const bottom = read();
      return { right, left, top, bottom }; })()`);
    assert.ok(tilt.right[0] > 8 && Math.abs(tilt.right[1]) < 3, `right edge tilts +Y (${tilt.right})`);
    assert.ok(tilt.left[0] < -8, `left edge tilts -Y (${tilt.left})`);
    assert.ok(tilt.top[1] > 8, `top edge tilts +X (${tilt.top})`);
    assert.ok(tilt.bottom[1] < -8, `bottom edge tilts -X (${tilt.bottom})`);
    assert.ok(tilt.right[2] && tilt.right[3] < 1, 'the rock is pressed (scaled down) on a tap');
    await page.waitForFunction(() => { const c = document.getElementById('ck-ore'); return !c.classList.contains('is-down') && c.style.getPropertyValue('--ry') === '0deg'; }, null, { timeout: 4000 });
    const rest = await page.evaluate(() => { const c = document.getElementById('ck-ore'); return [c.style.getPropertyValue('--ry'), c.style.getPropertyValue('--rx'), c.style.getPropertyValue('--sc'), c.classList.contains('is-down')]; });
    assert.deepEqual(rest, ['0deg', '0deg', '1', false], 'the rock springs back to rest');
    report.taps.tilt = true;
    await wait(900); // let the streak from the synthetic taps fade
    await settle(page);

    // 3) a counted burst: accounting is exact, caps hold, and the visual layer reacts
    const burst = await page.evaluate(`(async () => { const tap = ${TAP};
      const g0 = state.gold, e0 = state.energy, p = state.clickPower, N = 12;
      const before = document.getElementById('ck-ore').getBoundingClientRect();
      for (let i = 0; i < N; i++) tap({ fx: 0.3 + (i % 5) * 0.1, fy: 0.35 + (i % 4) * 0.1 });
      const q = (s) => document.querySelector(s);
      const out = { dGold: state.gold - g0, dEnergy: e0 - state.energy, N, p, fx: ClickerFX.inspect(), streakOn: q('#ck-streak').classList.contains('is-on'), streakN: q('#ck-streak-n').textContent,
        heat: parseFloat(q('.ck-glow').style.getPropertyValue('--heat')), floats: document.querySelectorAll('#ck-layer .ck-num').length, rings: document.querySelectorAll('#ck-layer .ck-ring').length, sparks: document.querySelectorAll('#ck-layer .ck-spark').length };
      const sb = q('#ck-streak').getBoundingClientRect();
      const topEl = document.elementFromPoint(sb.left + sb.width / 2, sb.top + sb.height / 2);
      return { ...out, passThrough: !!topEl && !q('#ck-streak').contains(topEl) && getComputedStyle(q('#ck-streak')).pointerEvents === 'none', counter: q('#gold-counter').textContent, gold: Math.floor(state.gold) }; })()`);
    assert.ok(Math.abs(burst.dGold - burst.N * burst.p) < 1e-6, `each tap credits exactly clickPower gold (the effects add nothing): ${burst.dGold}`);
    assert.ok(Math.abs(burst.dEnergy - burst.N * burst.p) < 1e-6, `each tap spends exactly clickPower energy: ${burst.dEnergy}`);
    assert.ok(burst.fx.streak >= 12 && burst.streakOn && Number(burst.streakN) >= 12, `the streak badge counts the taps: ${JSON.stringify({ streak: burst.fx.streak, on: burst.streakOn, n: burst.streakN })}`);
    assert.ok(burst.heat > 0.4 && burst.heat <= 1, `the heat fills (${burst.heat})`);
    assert.ok(burst.floats > 0 && burst.floats <= 24, `floating numbers appear and stay capped (${burst.floats})`);
    assert.ok(burst.rings > 0 && burst.sparks > 0, `tap ripples and hit sparks appear (${burst.rings}/${burst.sparks})`);
    assert.ok(burst.fx.particles > 0 && burst.fx.particles <= 150, `particles are emitted and capped (${burst.fx.particles})`);
    assert.equal(burst.passThrough, true, 'the streak badge does not swallow touches');
    assert.equal(burst.counter, burst.gold.toLocaleString('en-US'), 'the balance shows the true gold');
    // the canvas actually paints the particles on the next frames (read only the area around the rock: full-canvas readbacks are slow)
    const painted = await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = document.getElementById('ck-fx'), k = c.width / c.clientWidth, a = document.getElementById('click-area').getBoundingClientRect();
      const x = Math.max(0, Math.floor((a.left - 40) * k)), y = Math.max(0, Math.floor((a.top - 100) * k));
      const w = Math.min(c.width - x, Math.ceil((a.width + 80) * k)), h = Math.min(c.height - y, Math.ceil((a.height + 160) * k));
      const d = c.getContext('2d').getImageData(x, y, w, h).data; let lit = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
      return { lit, particles: ClickerFX.inspect().particles };
    });
    assert.ok(painted.lit > 50, `the canvas paints the particles (${JSON.stringify(painted)})`);
    report.taps.burst = { floats: burst.floats, particles: burst.fx.particles, litPixels: painted.lit };

    // real CDP touch taps register too: on the rock; a tap on the miner or on the scenery between medals does not mine
    await page.evaluate(() => { DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 12); DigSite.debug.place({ x: 0.26, y: 0.8 }); }); // a whole rock at its usual spot: four taps cannot break it
    await wait(60);
    const oreBox = await page.locator('#ck-ore').boundingBox();
    const heroBox = await page.locator('#ck-hero').boundingBox();
    const g1 = await page.evaluate(() => state.gold);
    for (let i = 0; i < 4; i++) { await page.touchscreen.tap(oreBox.x + oreBox.width * (0.35 + i * 0.1), oreBox.y + oreBox.height * 0.5); await wait(30); }
    const g2 = await page.evaluate(() => state.gold);
    assert.ok(g2 - g1 >= 3.99, 'real touch taps on the rock credit gold');
    await page.touchscreen.tap(heroBox.x + heroBox.width * 0.3, heroBox.y + heroBox.height * 0.6);
    const g3 = await page.evaluate(() => state.gold);
    assert.equal(g3, g2, 'a stray tap on the miner is scenery: it costs no energy (he is steered with the stick)');
    const nodesBox = await page.locator('#ck-nodes').boundingBox();
    await page.touchscreen.tap(nodesBox.x + 4, nodesBox.y + 4); // the corner of the medal row: empty scenery
    assert.equal(await page.evaluate(() => state.gold), g3, 'scenery between the medals never mines');
    report.taps.realTouch = { rock: true, minerIsScenery: true, sceneryIgnored: true };

    // 4) frenzy: 26 quick taps light the whole screen up, then everything fades after a pause
    await wait(1200); await settle(page);
    const frenzy = await page.evaluate(`(async () => { const tap = ${TAP}; for (let i = 0; i < 26; i++) tap({ fx: 0.4 + (i % 3) * 0.1, fy: 0.45 });
      const q = (s) => document.querySelector(s); return { fx: ClickerFX.inspect(), attr: q('#ck-stage').dataset.frenzy, banner: q('#ck-banner').classList.contains('is-on') ? q('#ck-banner').textContent : '',
        status: q('#ck-status').classList.contains('is-on') ? q('#ck-status').dataset.kind : '', tier: q('#ck-streak').dataset.tier, floats: document.querySelectorAll('#ck-layer > *').length,
        glow: parseFloat(getComputedStyle(q('.ck-glow')).opacity) }; })()`);
    assert.equal(frenzy.fx.frenzy, true, 'frenzy starts after a long streak');
    assert.equal(frenzy.attr, '1');
    assert.match(frenzy.banner, /حمّى/);
    assert.equal(frenzy.status, 'hot');
    assert.equal(frenzy.tier, '3', 'the streak badge reaches its top tier');
    assert.ok(frenzy.floats <= 24, 'the DOM layer stays capped during a burst');
    assert.ok(frenzy.glow >= 0.99, `the ore veins glow at full heat (${frenzy.glow})`);
    await page.waitForFunction(() => { const f = ClickerFX.inspect(); return !f.frenzy && f.heat === 0 && f.streak === 0 && f.particles === 0; }, null, { timeout: 12000 });
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

    // 7) boost: the button looks active (not greyed out), doubles the numbers, and the glow turns violet
    await page.locator('#boost-btn').tap();
    await page.waitForFunction(() => document.getElementById('boost-btn').dataset.state === 'active');
    const boost = await page.evaluate(`(() => { const tap = ${TAP}; const b = document.getElementById('boost-btn'), cs = getComputedStyle(b), q = (s) => document.querySelector(s);
      const g0 = state.gold; tap({}); const nums = [...document.querySelectorAll('#ck-layer .ck-num.is-boost')].map((e) => e.textContent);
      return { disabled: b.disabled, opacity: cs.opacity, filter: cs.filter, label: q('.ck-boost-label').textContent, time: q('.ck-boost-time').textContent, aura: q('#ck-stage').dataset.boost, body: document.body.classList.contains('ck-boost-on'),
        nums, dGold: state.gold - g0, income: getComputedStyle(q('#profit-per-sec'), '::after').content, p: parseFloat(b.style.getPropertyValue('--p')), glow: getComputedStyle(q('.ck-glow')).backgroundImage }; })()`);
    assert.equal(boost.disabled, true, 'a running boost cannot be re-activated');
    assert.equal(boost.opacity, '1', 'the active boost button is not dimmed');
    assert.equal(boost.filter, 'none', 'the active boost button is not greyscaled');
    assert.match(boost.label, /فعّال/);
    assert.match(boost.time, /^0:(2\d|30)$/, `the countdown is a clean m:ss clock (${boost.time})`);
    assert.equal(boost.aura, '1');
    assert.equal(boost.body, true);
    assert.match(boost.glow, /232, 121, 249/, 'the ore glow turns violet during the boost');
    assert.deepEqual(boost.nums, ['+2'], 'boosted taps show the doubled gain in the boost style');
    assert.equal(boost.dGold, 2, 'and the economy doubles exactly as before');
    assert.match(boost.income, /×2/, 'the income chip shows the x2 badge');
    assert.ok(boost.p > 0.9 && boost.p <= 1, `the countdown bar is nearly full right after activation (${boost.p})`);
    report.boost = { active: true, doubled: true };

    // 8) upgrade medals: fill the ring from taps, the medal turns green with the first-run pointer, the window buys, the server accepts
    const before = await page.evaluate(() => { const n = document.querySelector('[data-ck-item="rig"]'), m = n.querySelector('.cv-medal'); return { state: n.dataset.state, p: parseFloat(m.style.getPropertyValue('--p')), tag: n.querySelector('.ck-node-tag b').textContent }; });
    assert.equal(before.state, 'poor', 'the 1,000-gold rig is not affordable yet');
    assert.ok(before.p > 0 && before.p < 1, `its ring is only partly filled (${before.p})`);
    assert.equal(before.tag, '1,000', 'the price tag shows the price');
    await page.evaluate(`(() => { const tap = ${TAP}; while (state.gold < 50) tap({}); })()`);
    // the ring colour eases over 0.2 s (a CSS transition): wait for it to land instead of racing the first frame
    await page.waitForFunction(() => /74, 222, 128/.test(getComputedStyle(document.querySelector('[data-ck-item="click"] .cv-ring-bar')).stroke), null, { timeout: 5000 });
    const ready = await page.evaluate(() => { const q = (s) => document.querySelector(s); const n = q('[data-ck-item="click"]'), m = n.querySelector('.cv-medal'), ptr = q('.ck-pointer');
      const up = getComputedStyle(m.querySelector('.cv-up')).display, bar = getComputedStyle(m.querySelector('.cv-ring-bar')).stroke;
      const nb = n.getBoundingClientRect(), pr = ptr.querySelector('svg').getBoundingClientRect();
      return { state: n.dataset.state, medal: m.dataset.state, p: parseFloat(m.style.getPropertyValue('--p')), up, bar, dot: document.body.classList.contains('ck-can-buy'), tag: n.querySelector('.ck-node-tag b').textContent,
        pointer: { hidden: ptr.hidden, text: ptr.textContent, arrowX: pr.left + pr.width / 2, nodeX: nb.left + nb.width / 2 }, label: n.getAttribute('aria-label') }; });
    assert.equal(ready.state, 'ready');
    assert.equal(ready.medal, 'ready');
    assert.ok(ready.p >= 0.999, 'the ring is full once the price is covered');
    assert.notEqual(ready.up, 'none', 'the green "upgrade available" arrow shows');
    assert.match(ready.bar, /74, 222, 128/, 'the ring turns green');
    assert.equal(ready.dot, true, 'the upgrades tab shows a notification dot');
    assert.equal(ready.tag, '50');
    assert.match(ready.label, /متاحة للشراء/, 'screen readers hear that it can be bought');
    assert.equal(ready.pointer.hidden, false, 'the first-run pointer appears');
    assert.match(ready.pointer.text, /اضغط على الأيقونة/);
    assert.ok(Math.abs(ready.pointer.arrowX - ready.pointer.nodeX) < 3, `the arrow sits under the ready medal (${Math.round(ready.pointer.arrowX)} vs ${Math.round(ready.pointer.nodeX)})`);
    await settle(page); // the clicks reach the server first, so the purchase is valid there too
    await page.locator('[data-ck-item="click"]').tap();
    await page.waitForFunction(() => !document.getElementById('ck-sheet').hidden);
    const sheet = await page.evaluate(() => { const q = (s) => document.querySelector(s); const card = q('.ck-sheet-card').getBoundingClientRect();
      return { title: q('#ck-sheet-title').textContent, desc: q('#ck-sheet-desc').textContent, owned: q('#ck-sheet-owned').textContent, now: q('#ck-sheet-now').textContent, next: q('#ck-sheet-next').textContent, cost: q('#ck-sheet-cost').textContent,
        buyDisabled: q('#ck-sheet-buy').disabled, focus: document.activeElement && document.activeElement.id, hinted: localStorage.getItem('mining-fx-hint'), ptrHidden: q('.ck-pointer').hidden,
        fits: card.top >= 0 && card.bottom <= innerHeight && card.left >= 0 && card.right <= innerWidth, art: q('#ck-sheet-art .cv-art') ? q('#ck-sheet-art .cv-art').naturalWidth > 0 : false, state: ClickerFX.inspect().sheet }; });
    assert.equal(sheet.title, 'فأس فولاذي');
    assert.equal(sheet.desc, '+1 لكل نقرة');
    assert.equal(sheet.owned, '0');
    assert.equal(sheet.now, '1 لكل نقرة');
    assert.equal(sheet.next, '2 لكل نقرة');
    assert.equal(sheet.cost, '50');
    assert.equal(sheet.buyDisabled, false);
    assert.equal(sheet.focus, 'ck-sheet-buy', 'keyboard focus moves into the window');
    assert.equal(sheet.hinted, '1', 'opening a window retires the first-run pointer for good');
    assert.equal(sheet.ptrHidden, true);
    assert.equal(sheet.fits, true, 'the window fits on screen');
    assert.equal(sheet.art, true, 'the big medal shows the painted pickaxe');
    const goldBeforeBuy = await page.evaluate(() => state.gold);
    await page.locator('#ck-sheet-buy').tap();
    const bought = await page.evaluate(() => { const q = (s) => document.querySelector(s); return { owned: state.owned.click, power: state.clickPower, gold: state.gold, cost: state.costs.click, sheetCost: q('#ck-sheet-cost').textContent, sheetOwned: q('#ck-sheet-owned').textContent, now: q('#ck-sheet-now').textContent,
      nodeLvl: q('[data-ck-item="click"] .cv-lvl').textContent, nodeTag: q('[data-ck-item="click"] .ck-node-tag b').textContent, costNums: [...document.querySelectorAll('#ck-layer .ck-num.is-cost')].map((e) => e.textContent), p: ClickerFX.inspect().particles, open: !q('#ck-sheet').hidden }; });
    assert.equal(bought.owned, 1);
    assert.equal(bought.power, 2, 'the pickaxe upgrade doubles the tap power');
    assert.equal(Math.round(goldBeforeBuy - bought.gold), 50);
    assert.equal(bought.sheetCost, '75', 'the window moves on to the next price (50 x 1.5)');
    assert.equal(bought.sheetOwned, '1');
    assert.equal(bought.now, '2 لكل نقرة');
    assert.equal(bought.nodeLvl, '1', 'the medal badge counts the new level');
    assert.equal(bought.nodeTag, '75', 'and its price tag follows');
    assert.deepEqual(bought.costNums, ['-50'], 'the spent amount floats up');
    assert.ok(bought.p > 0, 'a purchase burst is emitted');
    assert.equal(bought.open, true, 'the window stays open so upgrades can be chained');
    await settle(page);
    const server = await page.evaluate(() => api('/api/me'));
    assert.equal(server.state.owned.click, 1, 'the server accepted the purchase made from the mining screen');
    assert.equal(server.state.clickPower, 2);
    assert.equal(Math.floor(server.state.gold), Math.floor(await page.evaluate(() => state.gold)), 'server and screen agree on the balance once the queue drained');
    // not enough gold for the next level: the button says why and is disabled
    await page.evaluate(() => { state.gold = 10; updateUI(); });
    const poor = await page.evaluate(() => ({ disabled: document.getElementById('ck-sheet-buy').disabled, label: document.getElementById('ck-sheet-buy').textContent, have: document.getElementById('ck-sheet-have').textContent, lack: document.getElementById('ck-sheet-costbox').classList.contains('is-lack') }));
    assert.deepEqual(poor, { disabled: true, label: 'الذهب غير كافٍ', have: 'ينقصك 65', lack: true });
    // Escape closes it and focus returns to the medal that opened it
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => [document.getElementById('ck-sheet').hidden, document.activeElement && document.activeElement.dataset.ckItem].join()), 'true,click');
    // tapping the dim backdrop closes it too; the close button as well
    await page.locator('[data-ck-item="bot"]').tap();
    await page.waitForFunction(() => !document.getElementById('ck-sheet').hidden);
    assert.equal(await page.evaluate(() => document.getElementById('ck-sheet-title').textContent), 'عامل آلي');
    await page.touchscreen.tap(8, 8);
    assert.equal(await page.evaluate(() => document.getElementById('ck-sheet').hidden), true, 'the backdrop closes the window');
    await page.locator('[data-ck-item="rig"]').tap();
    await page.waitForFunction(() => !document.getElementById('ck-sheet').hidden);
    await page.locator('#ck-sheet-close').tap();
    assert.equal(await page.evaluate(() => document.getElementById('ck-sheet').hidden), true, 'the close button closes the window');
    report.upgrades = { ringFills: true, readyArrow: true, pointer: true, bought: true, serverAgrees: true, windowChained: true, closes: ['Escape', 'backdrop', 'button'] };

    // 8b) the workshop medal opens the full-screen workshop and closing it returns to the cave
    await page.locator('[data-ck-item="workshop"]').tap();
    await page.waitForFunction(() => !document.getElementById('ws-overlay').hidden);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#ws-nodes .ws-node').length), 8, 'the workshop shows its eight equipment medals');
    await page.locator('#ws-close').tap();
    await page.waitForFunction(() => document.getElementById('ws-overlay').hidden);
    assert.equal(await page.evaluate(() => [document.body.classList.contains('ck-cave'), ClickerFX.inspect().sheet].join()), 'true,');
    report.upgrades.workshopMedal = true;

    // 9) the x2 badge in the header follows the boost on every tab, even when it ends while the player is elsewhere
    const badge = await page.evaluate(() => {
      const out = {}, chip = () => getComputedStyle(document.getElementById('profit-per-sec'), '::after').content;
      state.boostUntil = Date.now() + 20_000; state.boostCooldownUntil = Date.now() + 300_000; updateUI();
      out.on = document.body.classList.contains('ck-boost-on');
      switchTab('shop');
      out.onShop = chip();
      out.sceneOnShop = [document.body.classList.contains('ck-cave'), getComputedStyle(document.querySelector('.ck-scene')).display].join();
      state.boostUntil = 0; updateUI(); // the boost ends while the player is on another tab
      out.off = document.body.classList.contains('ck-boost-on');
      out.offChip = chip();
      out.aura = document.getElementById('ck-stage').dataset.boost;
      switchTab('mining');
      return out;
    });
    assert.equal(badge.on, true);
    assert.match(badge.onShop, /×2/, 'the badge shows on other tabs too');
    assert.equal(badge.sceneOnShop, 'false,none', 'the cave scene is gone on other tabs (no picture is painted there)');
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
    report.boost.passivePulse = true;

    // 11) leaving the tab clears every transient effect (and an open window) and returning is clean
    await page.evaluate(`(() => { const tap = ${TAP}; for (let i = 0; i < 8; i++) tap({}); ClickerFX.openSheet('bot'); switchTab('shop'); })()`);
    const away = await page.evaluate(() => ({ layer: document.getElementById('ck-layer').childElementCount, fx: ClickerFX.inspect(), streakOn: document.getElementById('ck-streak').classList.contains('is-on'), sheetHidden: document.getElementById('ck-sheet').hidden }));
    assert.equal(away.layer, 0, 'no floating numbers linger over other tabs');
    assert.deepEqual([away.fx.particles, away.fx.heat, away.fx.streak, away.streakOn, away.sheetHidden, away.fx.sheet], [0, 0, 0, false, true, '']);
    await page.evaluate(() => switchTab('mining'));
    report.layout.leaveReturn = true;

    // 12) "to the mine": starts a round on the platform tab; coming back and pressing it again resumes instead of restarting
    await page.locator('#ck-go').tap();
    await page.waitForFunction(() => document.getElementById('tab-play').classList.contains('active') && window.PlatformGame.inspect().running, null, { timeout: 20000 });
    const run1 = await page.evaluate(() => { const i = PlatformGame.inspect(); return { ticket: i.ticket, running: i.running, paused: i.paused }; });
    assert.ok(run1.ticket && run1.running && !run1.paused, 'the button started a verified round');
    await page.locator('#nav-mining').tap();
    await page.waitForFunction(() => document.getElementById('tab-mining').classList.contains('active') && window.PlatformGame.inspect().paused);
    await page.locator('#ck-go').tap();
    await page.waitForFunction(() => document.getElementById('tab-play').classList.contains('active'));
    const run2 = await page.evaluate(() => { const i = PlatformGame.inspect(); return { ticket: i.ticket, paused: i.paused, resumeShown: !document.getElementById('platform-resume').hidden }; });
    assert.equal(run2.ticket, run1.ticket, 'the paused round was not replaced by a new one');
    assert.equal(run2.paused, true);
    assert.equal(run2.resumeShown, true, 'the player gets the resume button');
    report.cta = { startsRound: true, resumesPausedRound: true };
    await page.locator('#nav-mining').tap();
    await page.waitForFunction(() => document.getElementById('tab-mining').classList.contains('active'));

    // 13) sound toggle persists across reloads (default is on, quiet synthesized ticks)
    assert.equal(await page.evaluate(() => ClickerFX.inspect().muted), false, 'sound is on by default');
    await page.locator('#ck-sound').tap();
    assert.equal(await page.evaluate(() => [document.getElementById('ck-sound').getAttribute('aria-pressed'), localStorage.getItem('mining-fx-muted')].join()), 'true,true');
    await page.reload();
    await page.waitForFunction(() => window.ClickerFX && window.ClickerFX.active && typeof serverMode !== 'undefined' && serverMode === true, null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => [ClickerFX.inspect().muted, document.getElementById('ck-sound').getAttribute('aria-pressed')].join()), 'true,true', 'the choice survives a reload');
    assert.equal(await page.evaluate(() => [ClickerFX.inspect().hinted, ClickerFX.inspect().scene].join()), 'true,false', 'the pointer stays retired after a reload; the scene waits for the tab');
    report.sound = { toggle: true, persisted: true };

    // 14) level-up: a rising level (same source) triggers the celebration once; a first sync never does
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


    // ---------------------------------------------------------------- 15) the dig site: the miner walks with the stick and digs the rock
    // Every swing that hits the rock is one ordinary tap (handleMine): 1 energy, the current tap power in gold, one queued `mine` click.
    await page.evaluate(() => { switchTab('mining'); state.energy = state.maxEnergy; updateUI(); DigSite.debug.setStick(0, 0); DigSite.debug.setDig(false); DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 12); DigSite.debug.place({ x: 0.26, y: 0.8 }); });
    await settle(page);
    await page.waitForFunction(() => window.DigSite && DigSite.inspect().active && !DigSite.inspect().paused);
    const overlaps = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
    const site = await page.evaluate(() => { const cs = (s) => getComputedStyle(document.querySelector(s));
      return { stage: document.getElementById('ck-stage').dataset.dig, pad: cs('#ck-pad').display, dig: cs('#ck-dig').display, touch: [cs('#ck-pad').touchAction, cs('#ck-dig').touchAction], hint: document.getElementById('tap-hint').textContent,
        padLabel: document.getElementById('ck-pad').getAttribute('aria-label'), digLabel: document.getElementById('ck-dig').getAttribute('aria-label'), minerHidden: document.getElementById('ck-miner').getAttribute('aria-hidden'), insp: DigSite.inspect() }; });
    const padB = await rectOf(page, '#ck-pad'), digB = await rectOf(page, '#ck-dig'), areaB = await rectOf(page, '#click-area'), oreB0 = await rectOf(page, '#ck-ore');
    assert.equal(site.stage, '1', 'the dig site switched the field to its interactive layout');
    assert.deepEqual([site.pad, site.dig], ['grid', 'flex'], 'the stick and the dig button are shown (an absolutely placed inline-flex computes to flex)');
    assert.deepEqual(site.touch, ['none', 'none'], 'dragging the stick never scrolls or zooms the page');
    assert.ok(padB.w >= 64 && padB.h >= 64 && digB.w >= 56 && digB.h >= 56, `finger-sized controls (stick ${Math.round(padB.w)}px, button ${Math.round(digB.w)}px)`);
    for (const [name, b] of [['stick', padB], ['dig button', digB]]) assert.ok(b.l >= areaB.l - 1 && b.r <= areaB.r + 1 && b.t >= areaB.t - 1 && b.b <= areaB.b + 1, `the ${name} sits inside the field`);
    assert.equal(overlaps(padB, digB), false, 'the two controls do not overlap');
    const overlapArea = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    assert.ok(overlapArea(oreB0, padB) + overlapArea(oreB0, digB) <= 0.06 * oreB0.w * oreB0.h, 'the controls leave the rock free (at most a sliver of its box)');
    assert.match(site.hint, /العصا/, 'the hint tells how to play');
    assert.ok(site.padLabel && site.digLabel, 'both controls have accessible names');
    assert.equal(site.minerHidden, 'true', 'the miner is decoration for assistive tech');
    assert.equal(site.insp.rock.hp, 12);

    // 15a) a real touch drag on the stick: the miner walks where it points, the knob follows the finger, nothing digs until he reaches the rock
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, ...points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })) });
    const pc = [padB.l + padB.w / 2, padB.t + padB.h / 2];
    const m0 = await page.evaluate(() => DigSite.inspect());
    await touch('touchStart', pc);
    for (const dx of [-10, -22, -34]) await touch('touchMove', [pc[0] + dx, pc[1]]);
    await page.waitForFunction((x) => DigSite.inspect().miner.x < x - 0.05, m0.miner.x, { timeout: 15000 });
    const left = await page.evaluate(() => ({ i: DigSite.inspect(), sx: parseFloat(document.getElementById('ck-stick').style.getPropertyValue('--sx')), on: document.getElementById('ck-pad').classList.contains('is-on'), act: document.getElementById('ck-miner').dataset.act, face: document.getElementById('ck-miner').dataset.face, y: scrollY }));
    assert.equal(left.i.miner.face, -1, 'he turned left');
    assert.equal(left.face, '-1', 'the picture is mirrored');
    assert.equal(left.act, 'walk');
    assert.ok(left.sx < -10, `the knob follows the finger (${left.sx}px)`);
    assert.equal(left.on, true);
    assert.equal(left.i.stats.swings, m0.stats.swings, 'walking away from the rock digs nothing');
    assert.equal(left.y, 0, 'the page did not scroll under the finger');
    // …now toward the rock: he walks over and digs by himself, at a pace the economy already allows (about four swings a second at most)
    for (const dx of [10, 24, 36]) await touch('touchMove', [pc[0] + dx, pc[1]]);
    await page.waitForFunction((n) => DigSite.inspect().stats.swings >= n + 3, m0.stats.swings, { timeout: 25000 });
    const r0 = await page.evaluate(() => { const i = DigSite.inspect(); return { s: i.stats.swings, c: i.clock, face: i.miner.face, reach: i.inReach }; });
    await wait(1500);
    const r1 = await page.evaluate(() => { const i = DigSite.inspect(); return { s: i.stats.swings, c: i.clock, g: state.gold, e: state.energy }; });
    const perSecond = (r1.s - r0.s) / ((r1.c - r0.c) / 1000);
    assert.equal(r0.face, 1);
    assert.ok(r0.reach, 'he stopped at the rock instead of walking through it');
    assert.ok(r1.s > r0.s && perSecond <= 4.3, `he keeps digging at no more than ~4 swings/s (${perSecond.toFixed(2)}/s)`);
    await touch('touchEnd');
    const released = await page.evaluate(() => ({ stick: DigSite.inspect().stick, sx: document.getElementById('ck-stick').style.getPropertyValue('--sx'), on: document.getElementById('ck-pad').classList.contains('is-on') }));
    assert.deepEqual([released.stick, released.sx, released.on], [{ x: 0, y: 0 }, '0px', false], 'letting go re-centres the stick');
    await wait(900); // the swing in progress ends; no new one starts
    const stopS = await page.evaluate(() => DigSite.inspect().stats.swings);
    await wait(700);
    assert.equal(await page.evaluate(() => DigSite.inspect().stats.swings), stopS, 'without the stick he stops digging');
    report.dig.touchStick = { walksLeft: true, digsAtRock: true, swingsPerSecond: Number(perSecond.toFixed(2)), reCentres: true };
    await settle(page);
    const srv1 = await page.evaluate(() => api('/api/me'));
    assert.equal(Math.floor(srv1.state.gold), Math.floor(await page.evaluate(() => state.gold)), 'the server counted the swings exactly like taps: its gold equals the screen');

    // 15b) exact accounting, deterministic: N accepted swings = N x tap power of energy, N x gain of gold, N queued clicks, N health points
    const acc = await page.evaluate(() => {
      DigSite.debug.setStick(0, 0); DigSite.debug.setDig(false);
      DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 12); DigSite.debug.place({ x: 0.3, y: 0.8 });
      const g0 = state.gold, e0 = state.energy, c0 = SYNC.clicks + SYNC.pending.reduce((n, op) => n + (op.type === 'mine' ? op.clicks : 0), 0), s0 = DigSite.inspect().stats.swings, gain = clickGain(), p = state.clickPower;
      DigSite.debug.setDig(true);
      DigSite.debug.step(0.05, 50);
      DigSite.debug.setDig(false);
      DigSite.debug.step(0.05, 10);
      const i = DigSite.inspect(), swings = i.stats.swings - s0;
      return { swings, dGold: state.gold - g0, dEnergy: e0 - state.energy, dClicks: SYNC.clicks + SYNC.pending.reduce((n, op) => n + (op.type === 'mine' ? op.clicks : 0), 0) - c0, gain, p, hp: i.rock.hp, boosted: boostActive() };
    });
    assert.ok(acc.swings >= 5 && acc.swings < 12, `a stretch of digging (${acc.swings} swings)`);
    assert.ok(Math.abs(acc.dGold - acc.swings * acc.gain) < 1e-6, `every swing credits exactly the tap gain (${acc.dGold} = ${acc.swings} x ${acc.gain})`);
    assert.ok(Math.abs(acc.dEnergy - acc.swings * acc.p) < 1e-6, `every swing spends exactly the tap power of energy (${acc.dEnergy})`);
    assert.equal(acc.dClicks, acc.swings, 'every swing is one click queued for the server');
    assert.equal(acc.hp, 12 - acc.swings, 'and exactly one health point of the rock');
    report.dig.accounting = { swings: acc.swings, gold: acc.dGold, energy: acc.dEnergy };

    // 15c) breaking the rock: crumble burst, ghost of the old rock, a whole new rock out of reach, the miner cheers; none of it touches the economy
    const broke = await page.evaluate(() => {
      DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 2); DigSite.debug.place({ x: 0.3, y: 0.8 });
      const g0 = state.gold, s0 = DigSite.inspect().stats, before = DigSite.inspect().rock;
      DigSite.debug.setDig(true);
      let guard = 0; while (DigSite.inspect().stats.breaks === s0.breaks && guard++ < 200) DigSite.debug.step(0.05);
      DigSite.debug.setDig(false);
      const i = DigSite.inspect(), q = (sel) => document.querySelector(sel);
      return { swings: i.stats.swings - s0.swings, dGold: state.gold - g0, gain: clickGain(), breaks: i.stats.breaks - s0.breaks, before, after: i.rock, reach: i.inReach, ghosts: document.querySelectorAll('#ck-world .ck-ghost').length, particles: ClickerFX.inspect().particles,
        pose: i.miner.pose, stage: q('#ck-ore').dataset.stage, hpOn: q('#ck-rockhp').classList.contains('is-on'), hpWidth: q('#ck-rockhp i').style.width, cheering: i.cheering };
    });
    assert.deepEqual([broke.breaks, broke.swings], [1, 2], 'two swings broke a two-health rock');
    assert.ok(Math.abs(broke.dGold - 2 * broke.gain) < 1e-6, 'and paid exactly two taps, no break bonus');
    assert.equal(broke.after.hp, 12, 'a whole new rock appeared');
    assert.ok(Math.hypot(broke.after.x - broke.before.x, broke.after.y - broke.before.y) > 0.02 || broke.after.hp !== broke.before.hp, 'in another place');
    assert.equal(broke.reach, false, 'out of the miner\'s reach: he has to walk over');
    assert.equal(broke.ghosts, 1, 'the old rock fades out as a ghost');
    assert.ok(broke.particles > 10, `a crumble burst (${broke.particles} particles)`);
    assert.equal(broke.pose, 'cheer');
    assert.equal(broke.cheering, true);
    assert.equal(broke.stage, '0', 'the new rock has no cracks');
    assert.equal(broke.hpOn, false, 'its health bar is hidden until it is hit');
    await page.waitForFunction(() => document.querySelectorAll('#ck-world .ck-ghost').length === 0, null, { timeout: 4000 });
    report.dig.break = { ghost: true, particles: broke.particles };

    // 15d) real mouse: hold the dig button and he walks to the rock by himself and carries on to the next rock
    await page.evaluate(() => { DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 3); DigSite.debug.place({ x: 0.26, y: 0.8 }); });
    await settle(page);
    const hold0 = await page.evaluate(() => ({ i: DigSite.inspect(), g: state.gold }));
    const db = await rectOf(page, '#ck-dig');
    await page.mouse.move(db.l + db.w / 2, db.t + db.h / 2);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => [DigSite.inspect().digHeld, document.getElementById('ck-dig').classList.contains('is-down')].join()), 'true,true', 'the button looks pressed and the miner knows');
    await page.waitForFunction((n) => DigSite.inspect().stats.breaks > n, hold0.i.stats.breaks, { timeout: 30000 });
    await page.waitForFunction((n) => DigSite.inspect().stats.swings > n + 3, hold0.i.stats.swings + 3, { timeout: 30000 }); // …and keeps digging the next rock
    await page.mouse.up();
    assert.equal(await page.evaluate(() => DigSite.inspect().digHeld), false);
    await wait(1000);
    const hold1 = await page.evaluate(() => ({ i: DigSite.inspect(), g: state.gold }));
    assert.ok(hold1.g > hold0.g, 'holding the button earned gold');
    await settle(page);
    const srv2 = await page.evaluate(() => api('/api/me'));
    assert.equal(Math.floor(srv2.state.gold), Math.floor(await page.evaluate(() => state.gold)), 'server and screen still agree after the long hold');
    report.dig.holdButton = { breaks: hold1.i.stats.breaks - hold0.i.stats.breaks, swings: hold1.i.stats.swings - hold0.i.stats.swings };

    // 15e) a direct tap on the rock still mines at once; the miner then walks over and swings for show, charging nothing more
    await page.evaluate(() => { DigSite.debug.setStick(0, 0); DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 12); DigSite.debug.place({ x: 0.26, y: 0.8 }); });
    await settle(page);
    await wait(80);
    const tapBox = await page.locator('#ck-ore').boundingBox();
    const t0 = await page.evaluate(() => ({ g: state.gold, e: state.energy, taps: DigSite.inspect().stats.taps, hp: DigSite.inspect().rock.hp, x: DigSite.inspect().miner.x }));
    await page.touchscreen.tap(tapBox.x + tapBox.width / 2, tapBox.y + tapBox.height / 2);
    const t1 = await page.evaluate(() => ({ g: state.gold, e: state.energy, taps: DigSite.inspect().stats.taps, hp: DigSite.inspect().rock.hp, gain: clickGain(), p: state.clickPower, approaching: DigSite.inspect().approaching }));
    assert.ok(Math.abs(t1.g - t0.g - t1.gain) < 1e-6, 'a tap on the rock pays exactly the tap gain');
    assert.ok(t0.e - t1.e <= t1.p + 1e-6 && t0.e - t1.e >= t1.p - 1.5, `and costs the tap power of energy (energy also refills 3/s between the two reads: ${t0.e - t1.e} vs ${t1.p})`);
    assert.deepEqual([t1.taps - t0.taps, t0.hp - t1.hp], [1, 1], 'and chips one health point off the rock');
    assert.equal(t1.approaching, true);
    await page.waitForFunction((x) => DigSite.inspect().miner.x > x + 0.03 || DigSite.inspect().inReach, t0.x, { timeout: 15000 });
    await page.waitForFunction(() => DigSite.inspect().inReach && ['raise', 'strike'].includes(document.getElementById('ck-miner').dataset.pose), null, { timeout: 15000, polling: 30 });
    await wait(900);
    const t2 = await page.evaluate(() => ({ g: state.gold, hp: DigSite.inspect().rock.hp, swings: DigSite.inspect().stats.swings }));
    assert.equal(t2.g, t1.g, 'the show swing did not charge a second time');
    assert.equal(t2.hp, t1.hp, 'nor did it hurt the rock a second time');
    report.dig.tapOnRock = { paysLikeATap: true, minerWalksOver: true };

    // 15f) keyboard: arrows walk, space digs while held, the page does not scroll, and nothing is hijacked from a focused control
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); DigSite.debug.setRock({ x: 0.7, y: 0.76 }, 12); DigSite.debug.place({ x: 0.3, y: 0.8 }); });
    await settle(page);
    const k0x = (await page.evaluate(() => DigSite.inspect().miner.x));
    await page.keyboard.down('ArrowLeft');
    await page.waitForFunction((x) => DigSite.inspect().miner.x < x - 0.04 && DigSite.inspect().miner.moving, k0x, { timeout: 15000 });
    await page.keyboard.up('ArrowLeft');
    await wait(150);
    const dg_k1 = await page.evaluate(() => ({ x: DigSite.inspect().miner.x, face: DigSite.inspect().miner.face, y: scrollY, keys: DigSite.inspect().keys }));
    assert.equal(dg_k1.face, -1);
    assert.equal(dg_k1.y, 0, 'arrow keys steer the miner instead of scrolling the page');
    assert.deepEqual(dg_k1.keys, { l: false, r: false, u: false, d: false }, 'released keys are released');
    await page.waitForFunction(() => !DigSite.inspect().miner.moving, null, { timeout: 5000 });
    const s0 = await page.evaluate(() => ({ swings: DigSite.inspect().stats.swings, x: DigSite.inspect().miner.x }));
    await page.keyboard.down('KeyD');
    await page.waitForFunction((n) => DigSite.inspect().stats.swings > n + 1, s0.swings, { timeout: 30000 });   // D walks right into the rock and he digs by himself
    await page.keyboard.up('KeyD');
    assert.ok((await page.evaluate(() => DigSite.inspect().miner.x)) > s0.x, 'D walks right');
    await wait(900);
    const sp0 = await page.evaluate(() => DigSite.inspect().stats.swings);
    await page.keyboard.down('Space');
    await page.waitForFunction((n) => DigSite.inspect().stats.swings > n + 1, sp0, { timeout: 30000 });
    assert.equal(await page.evaluate(() => DigSite.inspect().digHeld), true, 'space is the dig button');
    await page.keyboard.up('Space');
    await wait(900);
    assert.equal(await page.evaluate(() => DigSite.inspect().digHeld), false);
    // a focused button keeps its own space/enter: pressing space on the rock mines once and does not start digging
    await page.focus('#mine-btn');
    const f0 = await page.evaluate(() => ({ g: state.gold, taps: DigSite.inspect().stats.taps }));
    await page.keyboard.press('Space');
    const f1 = await page.evaluate(() => ({ g: state.gold, taps: DigSite.inspect().stats.taps, held: DigSite.inspect().digHeld, gain: clickGain() }));
    assert.ok(Math.abs(f1.g - f0.g - f1.gain) < 1e-6 && f1.taps === f0.taps + 1 && f1.held === false, 'space on the focused rock is one ordinary tap');
    report.dig.keyboard = { arrows: true, wasd: true, space: true, noScroll: true };

    // 15g) no energy: swings are refused (nothing is paid, nothing is queued), the miner waits and carries on by himself once energy is back
    await settle(page);
    const dry = await page.evaluate(() => {
      document.activeElement && document.activeElement.blur();
      DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 12); DigSite.debug.place({ x: 0.4, y: 0.8 });
      state.energy = 0; updateUI();
      const queued = () => SYNC.clicks + SYNC.pending.length;
      const g0 = state.gold, c0 = queued(), a = DigSite.inspect().stats;
      DigSite.debug.setDig(true);
      DigSite.debug.step(0.05, 40);
      const mid = DigSite.inspect().stats, level = document.getElementById('energy-container').dataset.level, deny = [...document.querySelectorAll('#ck-layer .ck-num.is-deny')].length;
      const out = { refused: mid.refused - a.refused, swings: mid.swings - a.swings, dGold: state.gold - g0, dQueued: queued() - c0, level, deny, hp: DigSite.inspect().rock.hp };
      state.energy = state.maxEnergy; updateUI();
      DigSite.debug.step(0.05, 40);
      out.resumed = DigSite.inspect().stats.swings - mid.swings;
      DigSite.debug.setDig(false);
      DigSite.debug.step(0.05, 10);
      return out;
    });
    assert.ok(dry.refused >= 2 && dry.refused <= 4, `it tried a few times, not every frame (${dry.refused} refusals in two seconds)`);
    assert.deepEqual([dry.swings, dry.dGold, dry.dQueued, dry.hp], [0, 0, 0, 12], 'a refused swing pays nothing, queues nothing and does not hurt the rock');
    assert.equal(dry.level, 'empty');
    assert.ok(dry.deny >= 1, 'the red "no energy" notice appears over the rock');
    assert.ok(dry.resumed >= 3, `with energy back he digs again without a new touch (${dry.resumed} swings)`);
    report.dig.noEnergy = { refused: dry.refused, resumes: true };

    // 15h) windows and other tabs pause him: the stick is released, keys are ignored behind a window, and returning is clean
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); DigSite.debug.setRock({ x: 0.75, y: 0.7 }, 12); DigSite.debug.place({ x: 0.3, y: 0.8 }); ClickerFX.openSheet('click'); });
    await page.waitForFunction(() => !document.getElementById('ck-sheet').hidden);
    const p0 = await page.evaluate(() => DigSite.inspect().miner.x);
    await page.keyboard.down('ArrowRight');
    await wait(400);
    const paused = await page.evaluate(() => ({ x: DigSite.inspect().miner.x, paused: DigSite.inspect().paused, keys: DigSite.inspect().keys }));
    await page.keyboard.up('ArrowRight');
    assert.equal(paused.paused, true);
    assert.equal(paused.x, p0, 'behind an open window the miner does not move');
    assert.equal(paused.keys.r, false);
    await page.evaluate(() => ClickerFX.closeSheet());
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction((x) => DigSite.inspect().miner.x > x + 0.03, p0, { timeout: 15000 });
    await page.keyboard.up('ArrowRight');
    await page.evaluate(() => { DigSite.debug.setRock({ x: 0.75, y: 0.7 }, 12); switchTab('shop'); });
    const away2 = await page.evaluate(() => ({ paused: DigSite.inspect().paused, ghosts: document.querySelectorAll('#ck-world .ck-ghost').length, shown: getComputedStyle(document.getElementById('ck-pad')).display }));
    assert.equal(away2.paused, true, 'other tabs pause the dig site (no animation frames are spent there)');
    assert.equal(away2.ghosts, 0);
    await page.keyboard.press('ArrowLeft');
    await page.evaluate(() => switchTab('mining'));
    await page.waitForFunction(() => !DigSite.inspect().paused);
    const back = await page.evaluate(() => { const i = DigSite.inspect(); const m = document.getElementById('ck-miner').style.transform; return { m, x: i.miner.x, size: i.size }; });
    assert.match(back.m, /translate3d\(/, 'coming back re-places the miner');
    assert.ok(back.size.W > 100 && back.size.H > 60, 'and re-measures the field');
    report.dig.pause = { window: true, tab: true };

    // ---------------------------------------------------------------- the crew, the companion and the walk (display only)
    assert.equal(await page.evaluate(() => document.getElementById('ck-crew').hidden), true, 'no crew before anything is bought');
    await page.evaluate(() => { state.owned.bot = 3; state.owned.rig = 1; state.equipment = Object.assign({}, state.equipment, { robot: 2 }); updateUI(); });
    const crew = await page.evaluate(() => {
      const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const box = document.getElementById('ck-crew'), kids = [...box.children].filter((c) => !c.classList.contains('ck-crew-more'));
      const comp = document.querySelector('.ck-companion');
      return { hidden: box.hidden, bots: box.querySelectorAll('.ck-crew-bot').length, rigs: box.querySelectorAll('.ck-crew-rig').length, area: R(document.getElementById('click-area')), kids: kids.map(R), pe: getComputedStyle(box).pointerEvents,
        companion: { shown: getComputedStyle(comp).display !== 'none', rect: R(comp), miner: R(document.getElementById('ck-hero')) }, rock: R(document.getElementById('mine-btn')), pad: R(document.getElementById('ck-pad')), dig: R(document.getElementById('ck-dig')),
        rigImg: getComputedStyle(box.querySelector('.ck-crew-rig')).backgroundImage, rigLoaded: document.getElementById('ck-stage').classList.contains('no-crew-art') === false };
    });
    assert.deepEqual([crew.hidden, crew.bots, crew.rigs], [false, 3, 1], 'three workers and one rig, as bought');
    assert.equal(crew.pe, 'none'); assert.match(crew.rigImg, /crew\/rig\.webp/); assert.equal(crew.rigLoaded, true, 'the rig picture loaded (no fallback block)');
    for (const k of crew.kids) assert.ok(k.l >= crew.area.l - 1 && k.r <= crew.area.r + 1 && k.t >= crew.area.t - 1 && k.b <= crew.area.b + 1, 'the crew stands inside the field');
    for (const k of crew.kids) for (const o of [crew.rock, crew.pad, crew.dig]) assert.equal(overlaps(k, o), false, 'the crew never sits on the rock or the controls');
    assert.equal(crew.companion.shown, true, 'the upgraded robot walks beside the miner');
    assert.ok(Math.abs((crew.companion.rect.l + crew.companion.rect.r) / 2 - (crew.companion.miner.l + crew.companion.miner.r) / 2) < crew.companion.miner.w * 1.1, 'and stays next to him');
    const gCrew = await page.evaluate(() => state.gold);
    const rigBox = await page.locator('.ck-crew-rig').first().boundingBox();
    await page.touchscreen.tap(rigBox.x + rigBox.width / 2, rigBox.y + rigBox.height / 2);
    assert.equal(await page.evaluate(() => state.gold), gCrew, 'tapping the crew is scenery: it never mines');
    await page.evaluate(() => { state.owned.bot = 9; state.owned.rig = 3; updateUI(); });
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('#ck-crew .ck-crew-bot').length, document.querySelectorAll('#ck-crew .ck-crew-rig').length, [...document.querySelectorAll('#ck-crew .ck-crew-more')].map((b) => b.textContent)]), [5, 2, ['+1', '+4']], 'what the lane cannot hold becomes a +N badge');
    // the walk: stride (lean, squash, weight), a breathing shadow and dust behind the feet while he walks; breathing again when he stops
    const walk = await page.evaluate(async () => {
      const m = document.getElementById('ck-miner'), hero = document.getElementById('ck-hero'), cs = (e, ps) => getComputedStyle(e, ps);
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      DigSite.debug.place({ x: 0.2, y: 0.8 }); DigSite.debug.setStick(1, 0); DigSite.debug.step(1 / 60, 8); await frame();
      const walking = { act: m.dataset.act, hero: cs(hero).animationName, shadow: cs(m, '::before').animationName, dust: cs(document.querySelector('.ck-dust')).display, puff: cs(document.querySelector('.ck-dust i')).animationName };
      DigSite.debug.setStick(0, 0); DigSite.debug.step(1 / 60, 40); await frame();
      const idle = { act: m.dataset.act, hero: cs(hero).animationName, dust: cs(document.querySelector('.ck-dust')).display };
      DigSite.debug.place({ x: 0.26, y: 0.8 });
      return { walking, idle };
    });
    assert.deepEqual(walk.walking, { act: 'walk', hero: 'ck-stride', shadow: 'ck-footfall', dust: 'block', puff: 'ck-puff' });
    assert.deepEqual(walk.idle, { act: 'idle', hero: 'ck-breath', dust: 'none' });
    await page.evaluate(() => { state.owned.bot = 0; state.owned.rig = 0; state.equipment = Object.assign({}, state.equipment, { robot: 0 }); updateUI(); });
    assert.deepEqual(await page.evaluate(() => [document.getElementById('ck-crew').hidden, document.getElementById('ck-stage').dataset.companion]), [true, '0'], 'selling nothing, showing nothing');
    report.crew = { shown: true, capped: true, scenery: true, companion: true, walk: true };
    await ctx.close();

    // ---------------------------------------------------------------- reduced motion: no tilt / particles / floating flight
    const rm = await open({ width: 390, height: 844 }, { reducedMotion: 'reduce' });
    const rmRes = await rm.page.evaluate(`(() => { const tap = ${TAP}; const g0 = state.gold; for (let i = 0; i < 5; i++) tap({ fx: 0.95, fy: 0.5 });
      const c = document.getElementById('ck-ore'); return { dGold: state.gold - g0, fx: ClickerFX.inspect(), ry: c.style.getPropertyValue('--ry'), sc: c.style.getPropertyValue('--sc'),
        floats: document.querySelectorAll('#ck-layer .ck-num').length, sparks: document.querySelectorAll('#ck-layer .ck-spark').length, bob: getComputedStyle(document.querySelector('.ck-bob')).animationName, glow: getComputedStyle(document.querySelector('.ck-glow')).animationName,
        hero: getComputedStyle(document.getElementById('ck-hero')).animationName, scene: getComputedStyle(document.querySelector('.ck-scene')).animationName }; })()`);
    assert.equal(rmRes.dGold, 5, 'mining works the same with reduced motion');
    assert.equal(rmRes.fx.reduced, true);
    assert.equal(rmRes.fx.particles, 0, 'no particles with reduced motion');
    assert.equal(rmRes.sparks, 0, 'no hit sparks with reduced motion');
    assert.equal(parseFloat(rmRes.ry), 0, 'no tilt with reduced motion');
    assert.ok(rmRes.floats > 0, 'the gain is still shown');
    assert.deepEqual([rmRes.bob, rmRes.glow, rmRes.hero, rmRes.scene], ['none', 'none', 'none', 'none'], 'idle bobbing, glow breathing, miner breathing and the scene fade are off');
    await rm.page.evaluate(() => { state.owned.bot = 2; state.owned.rig = 1; state.equipment = Object.assign({}, state.equipment, { robot: 1 }); updateUI(); DigSite.debug.place({ x: 0.2, y: 0.8 }); DigSite.debug.setStick(1, 0); DigSite.debug.step(1 / 60, 8); });
    const rmCrew = await rm.page.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const cs = (sel, ps) => getComputedStyle(document.querySelector(sel), ps).animationName; return { bot: cs('.ck-crew-bot'), rig: cs('.ck-crew-rig'), companion: cs('.ck-companion'), stride: cs('#ck-hero'), puff: cs('.ck-dust i'), act: document.getElementById('ck-miner').dataset.act }; });
    assert.deepEqual(rmCrew, { bot: 'none', rig: 'none', companion: 'none', stride: 'none', puff: 'none', act: 'walk' }, 'with reduced motion the crew, the companion and the stride stand still (he still walks)');
    await rm.page.evaluate(() => { DigSite.debug.setStick(0, 0); DigSite.debug.step(1 / 60, 30); state.owned.bot = 0; state.owned.rig = 0; updateUI(); });
    // the dig site honours it too: the miner still walks and digs and the rock still breaks, without pop-in, ghost or crumble particles
    const rmDig = await rm.page.evaluate(() => {
      DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 2); DigSite.debug.place({ x: 0.3, y: 0.8 });
      const g0 = state.gold, b0 = DigSite.inspect().stats.breaks, gain = clickGain();
      DigSite.debug.setDig(true);
      let guard = 0; while (DigSite.inspect().stats.breaks === b0 && guard++ < 200) DigSite.debug.step(0.05);
      DigSite.debug.setDig(false);
      return { broke: DigSite.inspect().stats.breaks - b0, paid: (state.gold - g0) / gain, ghosts: document.querySelectorAll('#ck-world .ck-ghost').length, particles: ClickerFX.inspect().particles, popping: document.querySelector('#mine-btn .ck-bob').getAnimations().length,
        stickTransition: getComputedStyle(document.getElementById('ck-stick')).transitionDuration, hero: getComputedStyle(document.getElementById('ck-hero')).animationName };
    });
    assert.deepEqual([rmDig.broke, rmDig.paid, rmDig.ghosts, rmDig.particles, rmDig.popping], [1, 2, 0, 0, 0], `reduced motion: digging works, no ghost, no particles, no pop-in (${JSON.stringify(rmDig)})`);
    assert.equal(rmDig.hero, 'none');
    report.reducedMotion = { tilt: false, particles: 0, gainShown: true, digWorks: true };
    await rm.ctx.close();

    // ---------------------------------------------------------------- other screens: nothing overflows, everything reachable
    for (const viewport of [{ width: 360, height: 740 }, { width: 375, height: 667 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 821, height: 934 }, { width: 1280, height: 800 }]) {
      const tag = `${viewport.width}x${viewport.height}`;
      const v = await open(viewport);
      const m = await v.page.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s), b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, w: b.width, h: b.height }; };
        const tab = document.getElementById('tab-mining'), cs = getComputedStyle(document.querySelector('.ck-scene'));
        return { ore: r('#ck-ore'), nodes: r('#ck-nodes'), boost: r('#boost-btn'), go: r('#ck-go'), nav: r('nav'), energy: r('#energy-container'), fits: tab.scrollHeight <= tab.clientHeight + 1, h: document.documentElement.scrollWidth > document.documentElement.clientWidth, vh: innerHeight, vw: innerWidth,
          bg: cs.backgroundImage, display: cs.display, heroShown: getComputedStyle(document.getElementById('ck-hero')).display !== 'none', header: getComputedStyle(document.querySelector('.app-header')).display };
      });
      assert.equal(m.fits, true, `${tag}: the tab needs no scrolling`);
      assert.equal(m.h, false, `${tag}: no horizontal overflow`);
      for (const k of ['ore', 'nodes', 'boost', 'go']) assert.ok(m[k].t >= 0 && m[k].b <= m.vh + 0.5 && m[k].l >= 0 && m[k].r <= m.vw + 0.5, `${tag}: ${k} is fully on screen`);
      assert.ok(m.ore.w >= 84, `${tag}: the rock stays tappable (${Math.round(m.ore.w)}px)`);
      assert.ok(m.boost.h >= 40 && m.go.h >= 40, `${tag}: both buttons keep a finger-sized height`);
      assert.equal(m.display, 'block');
      const wantWide = viewport.width / viewport.height >= 1 && (viewport.width >= 1024 || viewport.height <= 520);
      assert.match(m.bg, wantWide ? /cave-wide\.jpg/ : /cave-portrait\.jpg/, `${tag}: the right scene picture for this shape`);
      if (viewport.height <= 700 && viewport.width <= 700) assert.equal(m.header, 'none', `${tag}: the header makes room on short screens`);
      // a real tap lands on the rock at every size
      const g0 = await v.page.evaluate(() => state.gold);
      const box = await v.page.locator('#ck-ore').boundingBox();
      await v.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      assert.ok((await v.page.evaluate(() => state.gold)) - g0 >= 0.99, `${tag}: a real tap mines`);
      // the dig site fits: finger-sized controls inside the field, clear of each other, and a rock that respawns anywhere is never hidden under them
      const dg = await v.page.evaluate(() => {
        const R = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const inter = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
        const area = R('#click-area'), pad = R('#ck-pad'), dig = R('#ck-dig'), miner = R('#ck-hero');
        let worst = 0, outside = 0, covered = 0;
        for (let i = 0; i < 30; i++) {
          DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 1); DigSite.debug.place({ x: 0.26, y: 0.8 }); DigSite.onTap({}); DigSite.debug.step(0.001); // a fresh respawn each time
          const o = R('#mine-btn');
          worst = Math.max(worst, (inter(o, pad) + inter(o, dig)) / (o.w * o.h));
          if (o.l < area.l - 1 || o.r > area.r + 1 || o.t < area.t - 1 || o.b > area.b + 1) outside++;
          const top = document.elementFromPoint((o.l + o.r) / 2, (o.t + o.b) / 2);
          if (!top || !document.getElementById('mine-btn').contains(top)) covered++;
        }
        DigSite.debug.setRock({ x: 0.6, y: 0.8 }, 12); DigSite.debug.place({ x: 0.26, y: 0.8 });
        return { area, pad, dig, miner, worst, outside, covered, spec: DigSite.inspect().size };
      });
      assert.ok(dg.pad.w >= 56 && dg.dig.w >= 50, `${tag}: finger-sized controls (stick ${Math.round(dg.pad.w)}px, button ${Math.round(dg.dig.w)}px)`);
      for (const k of ['pad', 'dig']) assert.ok(dg[k].l >= dg.area.l - 1 && dg[k].r <= dg.area.r + 1 && dg[k].t >= dg.area.t - 1 && dg[k].b <= dg.area.b + 1, `${tag}: the ${k} control is inside the field`);
      assert.equal(overlaps(dg.pad, dg.dig), false, `${tag}: the stick and the dig button do not overlap`);
      assert.ok(dg.miner.h >= 70, `${tag}: the miner is big enough to read (${Math.round(dg.miner.h)}px)`);
      assert.deepEqual([dg.outside, dg.covered], [0, 0], `${tag}: a respawned rock stays inside the field and its centre is never under a control`);
      assert.ok(dg.worst <= 0.1, `${tag}: a respawned rock overlaps the controls by at most a sliver (${(dg.worst * 100).toFixed(1)}%)`);
      // the crew (3 workers + 1 rig) stands inside the field, clear of the stick, the dig button and the rock
      const cw = await v.page.evaluate(() => { state.owned.bot = 3; state.owned.rig = 1; updateUI(); const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const kids = [...document.getElementById('ck-crew').children].map(R), area = R(document.getElementById('click-area')), others = ['#ck-pad', '#ck-dig', '#mine-btn'].map((s) => R(document.querySelector(s)));
        const out = { kids, area, others, hidden: document.getElementById('ck-crew').hidden }; state.owned.bot = 0; state.owned.rig = 0; updateUI(); return out; });
      assert.equal(cw.hidden, false, `${tag}: the crew shows`);
      for (const k of cw.kids) { assert.ok(k.l >= cw.area.l - 1 && k.r <= cw.area.r + 1 && k.t >= cw.area.t - 1 && k.b <= cw.area.b + 1, `${tag}: the crew is inside the field`); for (const o of cw.others) assert.equal(overlaps(k, o), false, `${tag}: the crew is clear of the controls and the rock`); }
      // the upgrade window fits on every screen, big medal included
      await v.page.evaluate(() => ClickerFX.openSheet('click'));
      const sh = await v.page.evaluate(() => { const c = document.querySelector('.ck-sheet-card').getBoundingClientRect(), a = document.getElementById('ck-sheet-art').getBoundingClientRect(), b = document.getElementById('ck-sheet-buy').getBoundingClientRect();
        return { card: [c.top, c.bottom, c.left, c.right], art: [a.top, a.bottom], buy: [b.top, b.bottom], vh: innerHeight, vw: innerWidth }; });
      assert.ok(sh.art[0] >= 0 && sh.card[1] <= sh.vh && sh.card[2] >= 0 && sh.card[3] <= sh.vw && sh.buy[1] <= sh.vh, `${tag}: the upgrade window fits (${JSON.stringify(sh)})`);
      await v.page.evaluate(() => ClickerFX.closeSheet());
      // the workshop fits and its medal ring stays above the call-to-action
      await v.page.evaluate(() => window.openWorkshop());
      await v.page.waitForFunction(() => !document.getElementById('ws-overlay').hidden && [...document.querySelectorAll('#ws-nodes img')].every((i) => i.complete && i.naturalWidth > 0));
      const ws = await v.page.evaluate(() => { const ring = document.querySelector('.ws-ring').getBoundingClientRect(), cta = document.getElementById('ws-cta').getBoundingClientRect(); const nodes = [...document.querySelectorAll('.ws-node')].map((n) => n.getBoundingClientRect());
        return { ringBottom: ring.bottom, ctaTop: cta.top, ctaBottom: cta.bottom, vh: innerHeight, nodesOn: nodes.every((n) => n.left >= 0 && n.right <= innerWidth && n.top >= 0 && n.bottom <= innerHeight), count: nodes.length, hero: document.getElementById('ws-hero').naturalWidth > 0 }; });
      assert.ok(ws.count === 8 && ws.nodesOn && ws.hero && ws.ringBottom <= ws.ctaTop + 1 && ws.ctaBottom <= ws.vh + 0.5, `${tag}: the workshop fits (${JSON.stringify(ws)})`);
      await v.page.evaluate(() => window.closeWorkshop());
      report.viewports.push(tag);
      await v.ctx.close();
    }

    assert.deepEqual(errors, [], 'no page, console or request errors');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.race([browser.close(), wait(3000)]);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
