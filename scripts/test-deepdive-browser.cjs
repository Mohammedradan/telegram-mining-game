// Real-Chromium E2E for the deep dive ("الحفر العميق"). Run against a LOCAL development server:
//   CHROMIUM_PATH=/path/to/chromium TEST_APP_URL=http://127.0.0.1:3000 npm run test:deepdive
// It drives real touch (CDP), mouse and keyboard input and checks that the full-screen dive opens from the fifth hub medal, adds only server-verified ores (no gold or energy), keeps its controls clear of the HUD on every
// screen size, plays its three hazards (loose boulder, gas pocket, lava heat), ends by rope / faint / treasure, saves the best depth
// on the device only, pauses when the page loses focus, and shares one mute switch with the hub.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser tests require a local development server, never a public deployment');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium executable');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const report = { entry: {}, intro: {}, run: {}, controls: {}, ore: {}, hazards: {}, endings: {}, economy: {}, pause: {}, sound: {}, reducedMotion: {}, viewports: [], errors };

  async function open(viewport, extras = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'no-preference', ...extras });
    const page = await ctx.newPage();
    page.posts = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    page.on('requestfailed', (r) => { if (new URL(r.url()).origin === new URL(base).origin) errors.push(`request failed: ${r.url()}`); });
    page.on('request', (r) => { if (r.method() !== 'GET' && new URL(r.url()).origin === new URL(base).origin) page.posts.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.route('**/*', (r) => (new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort()));
    // optional stress knob for slow CI runners: CLICKER_CPU_THROTTLE=4 makes the page 4x slower (assertions must not depend on speed)
    if (Number(process.env.CLICKER_CPU_THROTTLE) > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CLICKER_CPU_THROTTLE) });
    await page.goto(base);
    await page.waitForFunction(() => window.ClickerFX && window.ClickerFX.active && window.DeepDigUI && window.DeepDigUI.active && typeof serverMode !== 'undefined' && serverMode === true, null, { timeout: 20000 });
    await page.evaluate(() => { try { localStorage.removeItem('mining-deep-dig'); localStorage.removeItem('mining-fx-muted'); localStorage.setItem('mining-fx-hint', '1'); } catch (e) { /* لا شيء */ } });
    await page.locator('#nav-mining').tap();
    await page.waitForFunction(() => document.getElementById('tab-mining').classList.contains('active'));
    await page.waitForFunction(() => [...document.querySelectorAll('#tab-mining img, #ck-nodes img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 });
    return { ctx, page };
  }
  const openDive = async (page) => {
    await page.locator('[data-ck-item="deepdive"]').tap();
    await page.waitForFunction(() => DeepDigUI.inspect().phase === 'intro', null, { timeout: 8000 });
    await page.waitForFunction(() => { const r = DeepDigUI.inspect().ready; return r && r.atlas && r.hero; }, null, { timeout: 15000 });
    await page.evaluate(() => { DeepDigUI.debug.lockQuality(true); DeepDigUI.debug.setQuality(2); });
  };
  const startRun = async (page) => { await page.locator('#dd-start').tap(); await page.waitForFunction(() => DeepDigUI.inspect().phase === 'run'); };
  const newRun = async (page) => { await page.locator('#dd-again').tap(); await page.waitForFunction(() => DeepDigUI.inspect().phase === 'run'); await page.evaluate(() => DeepDigUI.debug.freeze(true)); };
  const I = (page) => page.evaluate(() => DeepDigUI.inspect());
  const step = (page, n) => page.evaluate((k) => DeepDigUI.debug.step(1 / 60, k), n);
  const overlap = (a, b) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;
  // a clean rock world (rows 1..60 plain rock, empty bag, full health) so each scene tests exactly one rule
  const BLANK = `(() => { const D = DeepDig, g = DeepDigUI.debug.game(); for (let r = 1; r <= 60; r++) for (let c = 0; c < 7; c++) { g.tiles[D.idx(c, r)] = D.TILE.ROCK; g.ore[D.idx(c, r)] = 0; } g.loose.length = 0; g.clouds.length = 0; g.miner.hp = g.stats.maxHp; g.miner.inv = 0; g.miner.stun = 0; g.miner.heat = 0; g.miner.gasT = 0; D.ORE_IDS.forEach((id) => DeepDigUI.debug.fillBag(id, 0)); DeepDigUI.debug.setStick(0, 0); })()`;
  const air = (c, r0, r1) => `(() => { const D = DeepDig, g = DeepDigUI.debug.game(); for (let r = ${r0}; r <= ${r1}; r++) g.tiles[D.idx(${c}, r)] = D.TILE.AIR; })()`;

  try {
    // ---------------------------------------------------------------- 390x844 phone: entry, intro, layout, real input
    const { ctx, page } = await open({ width: 390, height: 844 });

    // 1) the fifth hub medal: painted art loaded, a label, fully on screen, clear of its neighbours
    const medals = await page.evaluate(() => [...document.querySelectorAll('#ck-nodes .ck-node')].map((n) => { const b = n.getBoundingClientRect(), img = n.querySelector('.cv-art'); return { key: n.dataset.ckItem, l: b.left, r: b.right, t: b.top, b: b.bottom, art: img ? img.naturalWidth > 0 : false, tag: n.querySelector('.ck-node-tag b')?.textContent }; }));
    assert.deepEqual(medals.map((m) => m.key), ['click', 'bot', 'rig', 'workshop', 'deepdive']);
    const dive = medals[4];
    assert.equal(dive.art, true, 'the mine-lift medal is painted and loaded');
    assert.equal(dive.tag, 'الأعماق');
    assert.ok(medals.every((m) => m.l >= 0 && m.r <= 390 && m.t >= 0), 'every medal is on screen');
    for (let i = 0; i < medals.length; i++) for (let j = i + 1; j < medals.length; j++) assert.ok(medals[i].r <= medals[j].l + 1 || medals[j].r <= medals[i].l + 1, `medals ${medals[i].key}/${medals[j].key} do not overlap`);
    assert.ok(dive.r - dive.l >= 44, 'finger-sized');
    report.entry.medal = { ok: true, width: Math.round(dive.r - dive.l) };

    // the hub before the dive: an economy snapshot (the dive must not move any of it)
    const eco0 = await page.evaluate(() => ({ gold: state.gold, energy: Math.round(state.energy), pending: SYNC.pending.length, miner: DigSite.inspect().miner }));
    const posts0 = page.posts.length;

    // 2) opening: full-screen overlay, intro card first, the platformer stopped, the hub's miner paused
    await openDive(page);
    const intro = await page.evaluate(() => {
      const o = document.getElementById('dd-overlay').getBoundingClientRect(), card = document.getElementById('dd-intro').getBoundingClientRect(), art = document.querySelector('#dd-intro .dd-card-art'), st = document.getElementById('dd-start').getBoundingClientRect();
      const c = document.getElementById('dd-canvas');
      return { overlay: [o.left, o.top, o.width, o.height], card: { t: card.top, b: card.bottom, l: card.left, r: card.right }, startH: st.height, art: art.complete && art.naturalWidth > 0,
        canvas: [c.width, c.height, c.clientWidth, c.clientHeight], bodyLocked: document.body.classList.contains('dd-open'), display: getComputedStyle(document.getElementById('dd-overlay')).display,
        platform: window.PlatformGame && PlatformGame.inspect ? PlatformGame.inspect().running : null, dig: DigSite.inspect().paused, title: document.getElementById('dd-intro-title').textContent,
        best: document.getElementById('dd-intro-best').textContent, gear: document.getElementById('dd-intro-gear').textContent, active: document.activeElement && document.activeElement.id };
    });
    assert.notEqual(intro.display, 'none');
    assert.deepEqual(intro.overlay, [0, 0, 390, 844], 'covers the whole screen');
    assert.deepEqual(intro.canvas.slice(0, 2), intro.canvas.slice(2), 'canvas pixels match its box at DPR 1');
    assert.ok(intro.card.t >= 0 && intro.card.b <= 844 && intro.card.l >= 0 && intro.card.r <= 390, 'the intro card is fully on screen (its medal is not clipped)');
    assert.equal(intro.art, true); assert.ok(intro.startH >= 48, 'the start button is finger-sized');
    assert.equal(intro.bodyLocked, true); assert.equal(intro.platform, false, 'no platformer round runs behind the dive'); assert.equal(intro.dig, true, 'the hub miner is paused behind the dive');
    assert.equal(intro.title, 'الحفر العميق'); assert.match(intro.best, /أول نزول/); assert.match(intro.gear, /الحقيبة 8/); assert.equal(intro.active, 'dd-start', 'keyboard focus moved into the dialog');
    report.intro = { fits: true, art: true, pausedBehind: true };

    // 3) start: HUD on, controls on, the miner stands BELOW the HUD (not hidden behind it), the picture is real (not blank)
    await startRun(page);
    const frames0 = (await I(page)).frames;
    await page.waitForFunction((f) => DeepDigUI.inspect().frames > f + 3, frames0, { timeout: 15000 });   // a few real frames have been drawn
    const run0 = await page.evaluate(() => {
      const i = DeepDigUI.inspect(), tile = i.layout.tile, y = (0.5 - i.cam) * tile, hud = document.querySelector('.dd-hud').getBoundingClientRect();
      const px = (x, yy) => { const d = document.getElementById('dd-canvas').getContext('2d').getImageData(x, yy, 1, 1).data; return [d[0], d[1], d[2]]; };
      return { minerTop: y - tile * 1.1, hudBottom: hud.bottom, hearts: document.querySelectorAll('#dd-hearts .dd-heart').length, empty: document.querySelectorAll('#dd-hearts .dd-heart.is-empty').length,
        depth: document.getElementById('dd-depth').textContent, layer: document.getElementById('dd-layer').textContent, bag: document.getElementById('dd-bag-count').textContent, ropeDisabled: document.getElementById('dd-rope').disabled,
        banner: document.getElementById('dd-banner').textContent, sky: px(30, 20), underMiner: px(Math.round(i.layout.ox + 3.5 * tile), Math.round(y + tile * 1.2)), dark: px(30, 800),
        controls: [document.getElementById('dd-pad'), document.getElementById('dd-rope')].map((e) => getComputedStyle(e).display) };
    });
    assert.ok(run0.minerTop >= run0.hudBottom - 2, `the miner starts below the HUD (head ${Math.round(run0.minerTop)} vs HUD ${Math.round(run0.hudBottom)})`);
    assert.deepEqual([run0.hearts, run0.empty, run0.depth, run0.layer, run0.bag, run0.ropeDisabled], [5, 0, '0 م', 'السطح', '0/8', true]);
    assert.match(run0.banner, /اسحب العصا/, 'the first-run hint explains the stick and the rope');
    assert.ok(run0.sky[2] > run0.sky[0], `the sky is blue-ish (${run0.sky})`);
    assert.ok(run0.underMiner[0] + run0.underMiner[1] + run0.underMiner[2] > 60, `the rock under the miner is lit by the torch (${run0.underMiner})`);
    assert.ok(run0.dark[0] + run0.dark[1] + run0.dark[2] < 45, `far from the torch it is dark (${run0.dark})`);
    assert.ok(run0.controls.every((d) => d !== 'none'), 'the stick and the rope button are shown');
    report.run.start = { minerBelowHud: true, picture: true };

    // 4) the real touch stick (CDP): push down → the miner digs down; release → he stops; the stick vector follows the finger
    const cdp = await ctx.newCDPSession(page);
    const pad = await page.locator('#dd-pad').boundingBox();
    const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + pad.height * 0.4, id: 1 }] });
    await page.waitForFunction(() => DeepDigUI.inspect().game.depthM >= 4, null, { timeout: 25000 });
    const dragging = await I(page);
    assert.ok(dragging.stick.y > 0.5 && Math.abs(dragging.stick.x) < 0.2 && dragging.axis === 'v', `the stick follows the finger (${JSON.stringify(dragging.stick)})`);
    assert.ok(await page.evaluate(() => document.getElementById('dd-pad').classList.contains('is-on')));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(350);
    const released = await I(page);
    assert.deepEqual(released.stick, { x: 0, y: 0 }, 'releasing the finger releases the stick');
    const d1 = released.game.depthM; await wait(500);
    assert.ok((await I(page)).game.depthM - d1 <= 2, 'he stops when the stick is released');
    const col0 = (await I(page)).game.col;                    // sideways with the real mouse on the same pad
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + pad.width * 0.4, cy, { steps: 4 });
    await page.waitForFunction((c) => DeepDigUI.inspect().game.col > c, col0, { timeout: 25000 });
    await page.mouse.up();
    assert.equal((await I(page)).stick.x, 0);
    report.controls.touch = { dig: true, release: true, sideways: true };

    // 5) finish one untouched-by-debug round end-to-end: the server replay must credit the kept ores.
    const oresBeforeDeepDig = await page.evaluate(() => ({ ...state.ores }));
    await page.evaluate(() => DeepDigUI.debug.setStick(0, 1));
    await page.waitForFunction(() => DeepDigUI.inspect().game.bagCount > 0, null, { timeout: 45000 });
    await page.evaluate(() => DeepDigUI.debug.setStick(0, 0));
    await page.locator('#dd-rope').tap();
    await page.waitForFunction(() => DeepDigUI.inspect().phase === 'summary', null, { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('dd-banner').textContent.includes('تم حفظ خامات الجولة'), null, { timeout: 15000 });
    const settledOres = await page.evaluate(() => ({ ...state.ores }));
    assert.ok(Object.keys(settledOres).some((k) => (settledOres[k] || 0) > (oresBeforeDeepDig[k] || 0)), 'a real server-verified dive credits at least one kept ore');
    report.economy.serverSettlement = { ores: true };

    // 6) keyboard: arrows steer, R pulls the rope, Escape pauses and resumes; nothing leaks to the hub miner behind
    await newRun(page);
    await page.evaluate(BLANK); await page.evaluate(() => DeepDigUI.debug.teleport(3, 6)); await page.evaluate(air(3, 6, 8));
    await page.keyboard.down('ArrowDown');
    assert.equal((await I(page)).keys.d, true);
    await step(page, 40);
    assert.ok((await I(page)).game.row >= 7, 'the arrow key walks down the dug shaft');
    await page.keyboard.up('ArrowDown');
    assert.equal((await I(page)).keys.d, false);
    await page.keyboard.down('KeyD'); await step(page, 3);
    assert.equal((await I(page)).keys.r, true, 'WASD works too'); await page.keyboard.up('KeyD');
    await page.keyboard.press('Escape');
    assert.equal((await I(page)).phase, 'paused'); assert.equal(await page.evaluate(() => document.getElementById('dd-pause').hidden), false);
    const tk = (await I(page)).game.tick; await step(page, 30); assert.equal((await I(page)).game.tick, tk, 'nothing advances while paused');
    await page.keyboard.press('Escape');
    assert.equal((await I(page)).phase, 'run');
    await page.keyboard.press('KeyR');
    assert.equal((await I(page)).game.state, 'rope', 'R pulls the rope');
    await step(page, 400);
    assert.equal((await I(page)).phase, 'summary');
    assert.equal(await page.evaluate(() => DigSite.inspect().paused), true, 'the hub miner never reacted to the keys');
    report.controls.keyboard = { arrows: true, wasd: true, rope: true, escape: true };

    // 7) "new dive" from the summary: a fresh seed, the surface, an empty bag
    const seed1 = (await I(page)).seed;
    await newRun(page);
    const fresh = await I(page);
    assert.deepEqual([fresh.game.depthM, fresh.game.bagCount], [0, 0], 'a new dive starts at the surface with an empty bag');
    assert.notEqual(fresh.seed, seed1, 'with a new world');

    // 8) ore: digging an ore tile fills the bag, the HUD chip + value update; a full bag swaps its cheapest piece for a better ore
    await page.evaluate(BLANK);
    await page.evaluate(() => { const D = DeepDig, g = DeepDigUI.debug.game(); DeepDigUI.debug.teleport(3, 0); g.tiles[D.idx(3, 1)] = D.TILE.ORE; g.ore[D.idx(3, 1)] = D.ORE_N.gold; DeepDigUI.debug.setStick(0, 1); });
    await step(page, 40);
    await page.evaluate(() => DeepDigUI.debug.setStick(0, 0)); await step(page, 2);
    const ore = await page.evaluate(() => ({ count: document.getElementById('dd-bag-count').textContent, value: document.getElementById('dd-value').textContent, chip: (() => { const c = document.querySelector('#dd-chips .dd-chip[data-ore="gold"]'); return c ? { hidden: c.hidden, n: c.querySelector('b').textContent } : null; })(), chipsShown: !document.getElementById('dd-chips').hidden, fill: document.getElementById('dd-bag-fill').style.getPropertyValue('--fill'), particles: DeepDigUI.inspect().particles }));
    assert.deepEqual([ore.count, ore.value, ore.chip.hidden, ore.chip.n, ore.chipsShown], ['1/8', '8', false, '1', true]);
    assert.equal(ore.fill, '13%'); assert.ok(ore.particles > 0, 'sparkles and a label spawned');
    await page.evaluate(() => { const D = DeepDig, g = DeepDigUI.debug.game(); DeepDigUI.debug.fillBag('gold', 0); DeepDigUI.debug.fillBag('copper', 8); g.tiles[D.idx(3, 2)] = D.TILE.ORE; g.ore[D.idx(3, 2)] = D.ORE_N.crystal; DeepDigUI.debug.setStick(0, 1); });
    await step(page, 90);
    await page.evaluate(() => DeepDigUI.debug.setStick(0, 0));
    const swap = await page.evaluate(() => ({ count: document.getElementById('dd-bag-count').textContent, crystal: document.querySelector('#dd-chips .dd-chip[data-ore="crystal"] b').textContent, copper: document.querySelector('#dd-chips .dd-chip[data-ore="copper"] b').textContent, full: document.getElementById('dd-bag').dataset.full }));
    assert.deepEqual([swap.count, swap.crystal, swap.copper, swap.full], ['8/8', '1', '7', '1'], 'a full bag swaps its cheapest piece for the better ore');
    report.ore = { chip: true, swap: true };

    // 9) hazards through the real UI. (a) a loose boulder: it stays put until the tile under it is dug, warns, then falls where the miner is not
    await page.evaluate(BLANK);
    await page.evaluate(() => { const D = DeepDig, g = DeepDigUI.debug.game(); DeepDigUI.debug.teleport(2, 10); for (let r = 6; r <= 10; r++) g.tiles[D.idx(2, r)] = D.TILE.AIR; g.tiles[D.idx(3, 9)] = D.TILE.BOULDER; });
    await step(page, 30);
    assert.equal(await page.evaluate(() => DeepDigUI.debug.game().loose.length), 0, 'a boulder resting on rock never moves');
    await page.evaluate(() => DeepDigUI.debug.setStick(1, 0));                       // dig the tile under it (3,10), then let go before stepping in
    await page.evaluate(() => { for (let i = 0; i < 100 && DeepDig.kindAt(DeepDigUI.debug.game(), 3, 10) !== DeepDig.TILE.AIR; i++) DeepDigUI.debug.step(1 / 60, 1); DeepDigUI.debug.setStick(0, 0); DeepDigUI.debug.step(1 / 60, 2); });
    const warn = await page.evaluate(() => ({ loose: DeepDigUI.debug.game().loose.length, banner: document.getElementById('dd-banner').textContent, on: document.getElementById('dd-banner').classList.contains('is-on'), kind: document.getElementById('dd-banner').dataset.kind }));
    assert.ok(warn.loose >= 1 && /صخرة سائبة/.test(warn.banner) && warn.kind === 'boulder' && warn.on, `digging under it wakes it with a warning (${JSON.stringify(warn)})`);
    await step(page, 80);
    assert.equal(await page.evaluate(() => DeepDigUI.debug.game().miner.hp), 5, 'the miner stood aside: no damage');
    //   and when it lands on him: two hearts, the hearts show it, the screen shakes
    await page.evaluate(BLANK);
    await page.evaluate(() => { const D = DeepDig, g = DeepDigUI.debug.game(); DeepDigUI.debug.teleport(3, 12); for (let r = 9; r <= 13; r++) g.tiles[D.idx(3, r)] = D.TILE.AIR; g.tiles[D.idx(3, 8)] = D.TILE.BOULDER; g.loose.push({ c: 3, r: 8, wobble: 0.02, fall: null }); });
    const shook = await page.evaluate(() => { let max = 0; for (let i = 0; i < 80 && DeepDigUI.debug.game().miner.hp === 5; i++) { DeepDigUI.debug.step(1 / 60, 1); } max = DeepDigUI.inspect().shake; DeepDigUI.debug.step(1 / 60, 20); return max; });
    const hit = await page.evaluate(() => ({ hp: DeepDigUI.debug.game().miner.hp, empty: document.querySelectorAll('#dd-hearts .dd-heart.is-empty').length, label: document.getElementById('dd-hearts').getAttribute('aria-label') }));
    assert.deepEqual([hit.hp, hit.empty, hit.label], [3, 2, 'الصحة 3 من 5'], 'a boulder costs two hearts and the hearts show it');
    assert.ok(shook > 0, `the screen shook on impact (${shook})`);
    //   (b) gas: bursts when dug, a banner warns, lingering costs a heart
    await page.evaluate(BLANK);
    await page.evaluate(() => { const D = DeepDig, g = DeepDigUI.debug.game(); DeepDigUI.debug.teleport(3, 20); for (let r = 18; r <= 20; r++) g.tiles[D.idx(3, r)] = D.TILE.AIR; g.tiles[D.idx(4, 20)] = D.TILE.GAS; DeepDigUI.debug.setStick(1, 0); for (let i = 0; i < 120 && !g.clouds.length; i++) DeepDigUI.debug.step(1 / 60, 1); DeepDigUI.debug.setStick(0, 0); });
    const gas0 = await page.evaluate(() => ({ clouds: DeepDigUI.debug.game().clouds.length, banner: document.getElementById('dd-banner').textContent, hp: DeepDigUI.debug.game().miner.hp }));
    assert.ok(gas0.clouds === 1 && /غاز/.test(gas0.banner), `a gas pocket bursts with a warning (${JSON.stringify(gas0)})`);
    await step(page, 70);
    assert.equal(await page.evaluate(() => DeepDigUI.debug.game().miner.hp), gas0.hp - 1, 'lingering in the cloud costs a heart');
    //   (c) lava: standing beside it burns; two hearts left turns the danger state on; the lava tile glows on the canvas
    await page.evaluate(BLANK);
    await page.evaluate(() => { const D = DeepDig, g = DeepDigUI.debug.game(); DeepDigUI.debug.teleport(3, 50); for (let r = 48; r <= 52; r++) g.tiles[D.idx(3, r)] = D.TILE.AIR; g.tiles[D.idx(4, 50)] = D.TILE.LAVA; DeepDigUI.debug.setHp(3); });
    await step(page, 75);
    const lava = await page.evaluate(() => ({ hp: DeepDigUI.debug.game().miner.hp, danger: document.getElementById('dd-overlay').dataset.danger, layer: document.getElementById('dd-layer').textContent, px: (() => { const i = DeepDigUI.inspect(), t = i.layout.tile, d = document.getElementById('dd-canvas').getContext('2d').getImageData(Math.round(i.layout.ox + 4.5 * t), Math.round((50.5 - i.cam) * t), 1, 1).data; return [d[0], d[1], d[2]]; })() }));
    assert.equal(lava.hp, 2, 'a heat tick burned one heart'); assert.equal(lava.danger, '1', 'two hearts left: the danger state is on'); assert.equal(lava.layer, 'الحمم');
    assert.ok(lava.px[0] > lava.px[2] + 40, `the lava tile glows orange on the canvas (${lava.px})`);
    report.hazards = { boulder: true, gas: true, lava: true, hearts: true };

    // 10) endings: the rope banks everything, fainting loses the cheaper half, the chest wins; each saves on the device only
    await page.evaluate(BLANK);
    await page.evaluate(() => { DeepDigUI.debug.teleport(3, 26); DeepDigUI.debug.fillBag('gold', 3); DeepDigUI.debug.fillBag('crystal', 2); });
    await page.locator('#dd-rope').tap();
    assert.equal((await I(page)).game.state, 'rope');
    assert.equal(await page.evaluate(() => document.getElementById('dd-rope').disabled), true, 'no second rope while being pulled');
    await step(page, 400);
    const rope = await page.evaluate(() => ({ depth: document.getElementById('dd-sum-depth').textContent, value: document.getElementById('dd-sum-value').textContent, best: !document.getElementById('dd-sum-best').hidden, chips: document.querySelectorAll('#dd-sum-loot .dd-chip').length, tone: document.getElementById('dd-summary').dataset.tone, rec: JSON.parse(localStorage.getItem('mining-deep-dig')) }));
    // the depth is the deepest point reached in the run: the lava scene above put the miner at row 50 (100 m)
    assert.deepEqual([rope.value, rope.depth, rope.best, rope.tone, rope.chips], ['48', '100 م', true, 'best', 2]);
    assert.deepEqual([rope.rec.depthM, rope.rec.value >= 48, rope.rec.runs >= 2], [100, true, true]);
    await newRun(page);
    await page.evaluate(BLANK);
    await page.evaluate(() => { const D = DeepDig, g = DeepDigUI.debug.game(); DeepDigUI.debug.teleport(3, 42); for (let r = 40; r <= 44; r++) g.tiles[D.idx(3, r)] = D.TILE.AIR; g.tiles[D.idx(4, 42)] = D.TILE.LAVA; DeepDigUI.debug.fillBag('copper', 3); DeepDigUI.debug.fillBag('gold', 2); DeepDigUI.debug.setHp(1); });
    await step(page, 220);
    const faint = await page.evaluate(() => ({ phase: DeepDigUI.inspect().phase, title: document.getElementById('dd-sum-title').textContent, sub: document.getElementById('dd-sum-sub').textContent, tone: document.getElementById('dd-summary').dataset.tone, lost: document.querySelectorAll('#dd-sum-loot .dd-chip small').length, value: document.getElementById('dd-sum-value').textContent }));
    assert.equal(faint.phase, 'summary'); assert.match(faint.title, /أُغمي/); assert.equal(faint.tone, 'faint');
    assert.match(faint.sub, /فقدتَ 2/); assert.ok(faint.lost >= 1, 'the lost pieces are shown'); assert.equal(faint.value, '18', 'two gold (16) + one copper (2) kept: the best half');
    await newRun(page);
    await page.evaluate(BLANK);
    await page.evaluate(() => { const D = DeepDig, g = DeepDigUI.debug.game(); DeepDigUI.debug.teleport(3, 60); for (let r = 58; r <= 60; r++) g.tiles[D.idx(3, r)] = D.TILE.AIR; DeepDigUI.debug.setStick(0, 1); });
    await step(page, 300);
    const win = await page.evaluate(() => ({ phase: DeepDigUI.inspect().phase, title: document.getElementById('dd-sum-title').textContent, tone: document.getElementById('dd-summary').dataset.tone, legend: !document.getElementById('dd-sum-legend').hidden, depth: document.getElementById('dd-sum-depth').textContent, rec: JSON.parse(localStorage.getItem('mining-deep-dig')) }));
    assert.deepEqual([win.phase, win.tone, win.legend, win.depth, win.rec.legend, win.rec.wins], ['summary', 'win', true, '120 م', true, 1]);
    assert.match(win.title, /قلب الأسطورة/);
    report.endings = { rope: true, faint: true, win: true, savedLocally: true };

    // 11) only the expected authenticated Deep Dig endpoints are used; the other economy remains unchanged
    const eco1 = await page.evaluate(() => ({ gold: state.gold, energy: Math.round(state.energy), pending: SYNC.pending.length, inflight: !!SYNC.inflight, miner: DigSite.inspect().miner }));
    assert.equal(eco1.gold, eco0.gold, 'no gold was added or spent'); assert.ok(eco1.energy >= eco0.energy - 1, 'no energy was spent');
    assert.deepEqual([eco1.pending, eco1.inflight], [0, false], 'no operation was queued');
    const deepPosts = page.posts.slice(posts0);
    assert.ok(deepPosts.includes('POST /api/deep-dig/start'), `a server ticket was issued: ${deepPosts}`);
    assert.ok(deepPosts.includes('POST /api/deep-dig/finish'), `the finished dive was verified: ${deepPosts}`);
    assert.ok(deepPosts.every((p) => p === 'POST /api/deep-dig/start' || p === 'POST /api/deep-dig/finish'), `no unrelated economy API was called: ${deepPosts}`);
    assert.deepEqual([eco1.miner.x, eco1.miner.y], [eco0.miner.x, eco0.miner.y], 'the hub miner did not move');
    report.economy = { gold: true, energy: true, ops: true, verifiedDeepDigRequests: true };

    // 12) pause with the LIVE loop: losing focus / hiding the page pauses the run and shows the card; no time passes; resume works
    await page.locator('#dd-again').tap();
    await page.waitForFunction(() => DeepDigUI.inspect().phase === 'run');
    await page.evaluate(() => DeepDigUI.debug.freeze(false));
    const f0 = (await I(page)).frames; await page.waitForFunction((f) => DeepDigUI.inspect().frames > f + 5, f0, { timeout: 15000 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal((await I(page)).phase, 'paused', 'blur pauses'); assert.equal(await page.evaluate(() => document.getElementById('dd-pause').hidden), false);
    await page.locator('#dd-resume').tap();
    await page.waitForFunction(() => DeepDigUI.inspect().phase === 'run');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal((await I(page)).phase, 'paused', 'a hidden page pauses');
    await page.evaluate(() => { delete document.hidden; });
    const frozenAt = await I(page); await wait(400);
    const later = await I(page);
    assert.deepEqual([later.frames, later.game.tick], [frozenAt.frames, frozenAt.game.tick], 'neither frames nor game time pass while paused');
    await page.locator('#dd-resume').tap();
    await page.locator('#dd-close').tap();
    assert.equal((await I(page)).phase, 'paused', 'the X during a run asks first (the loot would be lost)');
    await page.locator('#dd-quit').tap();
    await page.waitForFunction(() => DeepDigUI.inspect().phase === 'closed');
    assert.deepEqual(await page.evaluate(() => [document.getElementById('dd-overlay').hidden, document.body.classList.contains('dd-open'), document.activeElement && document.activeElement.dataset.ckItem]), [true, false, 'deepdive'], 'closed, scroll lock off, focus back on the medal');
    const ring = await page.evaluate(() => { const n = document.querySelector('[data-ck-item="deepdive"]'); return { p: parseFloat(n.querySelector('.cv-medal').style.getPropertyValue('--p')), label: n.getAttribute('aria-label') }; });
    assert.ok(ring.p > 0.9, `the medal ring shows the best depth (${ring.p})`); assert.match(ring.label, /أعمق نزول لك 120 م/);
    report.pause = { blur: true, hidden: true, quitAsks: true, focusBack: true, ring: true };

    // 13) sound: the ambience starts with the dive, follows the layer, and one mute switch is shared with the hub
    await openDive(page); await startRun(page);
    const snd0 = (await I(page)).sound;
    assert.equal(snd0.mood, 'surface');
    if (snd0.ctx) {
      assert.equal(snd0.bed, true, 'the ambient bed plays');
      await page.evaluate(() => { DeepDigUI.debug.freeze(true); DeepDigUI.debug.teleport(3, 12); DeepDigUI.debug.game().tiles[DeepDig.idx(3, 13)] = DeepDig.TILE.AIR; DeepDigUI.debug.setStick(0, 1); });
      await step(page, 20);
      assert.equal((await I(page)).sound.mood, 'iron', 'the mood follows the layer');
    }
    await page.locator('#dd-sound').tap();
    const muted = await page.evaluate(() => [document.getElementById('dd-sound').getAttribute('aria-pressed'), localStorage.getItem('mining-fx-muted'), DeepDigUI.inspect().sound.bed]);
    assert.deepEqual(muted, ['false', 'true', false], 'muting stops the bed and is stored under the hub\'s own key');
    await page.locator('#dd-close').tap(); await page.locator('#dd-quit').tap();
    await page.waitForFunction(() => DeepDigUI.inspect().phase === 'closed');
    assert.equal(await page.evaluate(() => document.getElementById('ck-sound').getAttribute('aria-pressed')), 'true', 'the hub sound button shows muted too (one switch)');
    await page.locator('#ck-sound').tap();                    // unmute from the hub
    await openDive(page);
    assert.equal(await page.evaluate(() => document.getElementById('dd-sound').getAttribute('aria-pressed')), 'true', 'and the dive follows the hub');
    await page.locator('#dd-intro-back').tap();               // the intro card has its own way out (no Escape key on a phone)
    await page.waitForFunction(() => DeepDigUI.inspect().phase === 'closed');
    report.sound = { ctx: snd0.ctx, shared: true };

    // 14) the hub still works after all of that: a tap on the rock pays exactly as before
    const g0 = await page.evaluate(() => state.gold);
    const rock = await page.locator('#ck-ore').boundingBox();
    await page.touchscreen.tap(rock.x + rock.width / 2, rock.y + rock.height / 2);
    assert.ok((await page.evaluate(() => state.gold)) - g0 >= 0.99, 'a rock tap mines normally after the dive');
    await ctx.close();

    // ---------------------------------------------------------------- reduced motion: no shake, everything still works
    const rm = await open({ width: 390, height: 844 }, { reducedMotion: 'reduce' });
    await openDive(rm.page); await startRun(rm.page);
    await rm.page.evaluate(() => DeepDigUI.debug.freeze(true));
    await rm.page.evaluate(BLANK);
    await rm.page.evaluate(() => { const D = DeepDig, g = DeepDigUI.debug.game(); DeepDigUI.debug.teleport(3, 12); for (let r = 9; r <= 13; r++) g.tiles[D.idx(3, r)] = D.TILE.AIR; g.tiles[D.idx(3, 8)] = D.TILE.BOULDER; g.loose.push({ c: 3, r: 8, wobble: 0.02, fall: null }); });
    await step(rm.page, 40);
    const rmState = await I(rm.page);
    assert.equal(rmState.reduced, true); assert.equal(rmState.shake, 0, 'no screen shake under reduced motion');
    assert.equal(rmState.game.hp, 3, 'the game itself is unchanged');
    report.reducedMotion = { shake: 0, works: true };
    await rm.ctx.close();

    // ---------------------------------------------------------------- every screen size: medals fit, the dive's controls are clear of the HUD and of each other
    for (const viewport of [{ width: 360, height: 740 }, { width: 412, height: 915 }, { width: 375, height: 667 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
      const tag = `${viewport.width}x${viewport.height}`;
      const v = await open(viewport);
      const row = await v.page.evaluate(() => [...document.querySelectorAll('#ck-nodes .ck-node')].map((n) => { const b = n.getBoundingClientRect(); return { key: n.dataset.ckItem, l: b.left, r: b.right, t: b.top, b: b.bottom }; }));
      assert.equal(row.length, 5, `${tag}: five medals`);
      assert.ok(row.every((m) => m.l >= -0.5 && m.r <= viewport.width + 0.5 && m.t >= 0 && m.b <= viewport.height + 0.5), `${tag}: every medal is on screen (${JSON.stringify(row.map((m) => [m.key, Math.round(m.l), Math.round(m.r), Math.round(m.t), Math.round(m.b)]))})`);
      for (let i = 0; i < row.length; i++) for (let j = i + 1; j < row.length; j++) assert.ok(!overlap({ l: row[i].l, r: row[i].r, t: row[i].t, b: row[i].b }, { l: row[j].l, r: row[j].r, t: row[j].t, b: row[j].b }), `${tag}: medals ${row[i].key}/${row[j].key} do not overlap`);
      assert.equal(await v.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${tag}: no horizontal overflow on the hub`);
      await openDive(v.page);
      const card = await v.page.evaluate(() => { const c = document.getElementById('dd-intro'), s = document.getElementById('dd-start'); s.scrollIntoView({ block: 'nearest' }); const cb = c.getBoundingClientRect(), sb = s.getBoundingClientRect(); return { top: cb.top, bottom: cb.bottom, l: cb.left, r: cb.right, start: { t: sb.top, b: sb.bottom, h: sb.height }, scroll: c.scrollHeight > c.clientHeight + 1 }; });
      assert.ok(card.top >= -0.5 && card.bottom <= viewport.height + 0.5 && card.l >= 0 && card.r <= viewport.width + 0.5, `${tag}: the intro card is on screen`);
      assert.ok(card.start.t >= card.top - 1 && card.start.b <= card.bottom + 1 && card.start.h >= 44, `${tag}: the start button is reachable and finger-sized (card scrolls: ${card.scroll})`);
      const back = await v.page.evaluate(() => { const c = document.getElementById('dd-intro'), b = document.getElementById('dd-intro-back'); b.scrollIntoView({ block: 'nearest' }); const cb = c.getBoundingClientRect(), bb = b.getBoundingClientRect(); return { t: bb.top, b: bb.bottom, h: bb.height, top: cb.top, bottom: cb.bottom }; });
      assert.ok(back.t >= back.top - 1 && back.b <= back.bottom + 1 && back.h >= 40, `${tag}: the intro card has a reachable "back" button`);
      await startRun(v.page);
      await v.page.evaluate(() => DeepDigUI.debug.freeze(true));
      const L = await v.page.evaluate(() => {
        const R = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const i = DeepDigUI.inspect(), t = i.layout.tile;
        return { hud: R('.dd-hud'), pad: R('#dd-pad'), rope: R('#dd-rope'), close: R('#dd-close'), bag: R('#dd-bag'), depth: R('#dd-layerbox'), minerHead: (0.5 - i.cam) * t - t * 1.1, minerFoot: (0.5 - i.cam) * t + t * 0.5, tile: t, W: innerWidth, H: innerHeight, ox: i.layout.ox };
      });
      for (const k of ['pad', 'rope', 'close', 'bag', 'depth']) assert.ok(L[k].l >= -0.5 && L[k].r <= L.W + 0.5 && L[k].t >= -0.5 && L[k].b <= L.H + 0.5, `${tag}: ${k} is fully on screen`);
      assert.ok(L.pad.w >= 88 && L.pad.h >= 88, `${tag}: the stick is finger-sized (${Math.round(L.pad.w)}px)`);
      assert.ok(L.rope.w >= 88 && L.rope.h >= 52, `${tag}: the rope button is finger-sized (${Math.round(L.rope.w)}x${Math.round(L.rope.h)})`);
      assert.ok(!overlap(L.pad, L.rope), `${tag}: the stick and the rope button do not overlap`);
      assert.ok(!overlap(L.pad, L.hud) && !overlap(L.rope, L.hud), `${tag}: the controls are clear of the HUD`);
      assert.ok(L.minerHead >= L.hud.b - 3, `${tag}: the miner starts below the HUD (head ${Math.round(L.minerHead)} vs HUD ${Math.round(L.hud.b)})`);
      await v.page.evaluate(() => DeepDigUI.debug.setStick(0, 1)); await step(v.page, 120);
      assert.ok((await I(v.page)).game.depthM >= 2, `${tag}: the dive plays`);
      report.viewports.push(`${tag} ok`);
      await v.ctx.close();
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], `no page errors, console errors or failed requests: ${errors.join(' | ')}`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
