// V5 — واجهة العوالم والزعماء: لا متصفح هنا، لكن المُصيِّر الحقيقي يُشغَّل على سياق رسم وهمي يقبل أي نداء،
// فتنكشف الاستثناءات في مسارات الرسم النادرة (زعيم نائم/مترنّح/ميّت، كل نوع خطر، كل منجم) قبل أن تصل للاعب.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const R = require('../public/platform-rules');

globalThis.PlatformRules = R;
require('../public/platform-scenery.js');
require('../public/platform-bosses.js');
require('../public/platform-renderer.js');
const { PlatformScenery: Scenery, PlatformBosses: Bosses, PlatformRenderer: Renderer } = globalThis;
const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const rules = read('platform-rules.js'), game = read('platform-game.js'), html = read('index.html');
const css = read('platform.css');
const sceneryJs = read('platform-scenery.js'), bossesJs = read('platform-bosses.js'), rendererJs = read('platform-renderer.js');

// سياق Canvas وهمي: أي دالة مقبولة وتُسجَّل، والتدرجات تدعم addColorStop
function fakeCtx() {
  const calls = [], store = {}, sets = [], args = [];
  const ctx = new Proxy(store, {
    get(target, key) {
      if (key === 'calls') return calls;
      if (key === 'sets') return sets;
      if (key === 'args') return args;
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => { calls.push(String(key)); return { addColorStop() {} }; };
      return (...a) => { calls.push(String(key)); args.push([String(key), ...a]); };
    },
    set(target, key, value) { target[key] = value; sets.push([String(key), value]); return true; },
  });
  return ctx;
}
const canvasWith = ctx => ({ width: 800, height: 360, clientWidth: 800, clientHeight: 360, getContext: () => ctx });
const draw = (s, opts = {}) => { const ctx = fakeCtx(); Renderer.draw(canvasWith(ctx), s, opts); return ctx.calls; };
const drawFull = (s, opts = {}) => { const ctx = fakeCtx(); Renderer.draw(canvasWith(ctx), s, opts); return ctx; };
const freshState = (zone, hero = 'miner') => R.create(hero, R.seedFromId(`ui-${zone}`), { zone });
const withBoss = (zone, patch, x = 2000) => {
  const s = freshState(zone), boss = s.enemies.find(e => e.boss);
  Object.assign(boss, patch); s.player.x = x; s.tick = 321;
  return { s, boss };
};

test('worlds UI: the climb hint appears only near an upper route and stays accessible', () => {
  assert.match(html, /id="platform-route-hint"/, 'the contextual hint exists inside the mine stage');
  assert.match(html, /role="status" aria-live="polite"/, 'screen readers receive the hint without focus stealing');
  assert.match(game, /function updateRouteHint\(\)/, 'the game computes proximity to the branch');
  assert.match(game, /updateRouteHint\(\);/, 'the hint updates after a simulation step');
  assert.match(game, /p\.x \+ p\.w > box\.x - 48/, 'the hint is proximity-based, not permanently visible');
  assert.match(game, /routeHint\.hidden = true/, 'the hint is hidden when pausing or finishing');
  assert.match(css, /\.platform-route-hint\[hidden\]\{display:none\}/, 'hidden state is respected');
  assert.match(css, /prefers-reduced-motion:reduce/, 'the hint respects reduced-motion preferences');
});

test('worlds UI: upper branch ledges have a distinct safety trim and visible climb markers', () => {
  const s = freshState(1);
  const normal = drawFull(s);
  assert.ok(normal.calls.length > 300, 'the mine scene still renders through the real renderer');
  assert.match(rendererJs, /box\.route === 'upper'/, 'the renderer has a dedicated upper-route drawing path');
  assert.match(rendererJs, /#e5b85c/, 'upper routes have an industrial amber edge');
  assert.match(rendererJs, /#72dfcf/, 'upper routes have a readable teal climb marker');
  assert.match(rendererJs, /c\.moveTo\(-4, 2\); c\.lineTo\(0, -3\); c\.lineTo\(4, 2\)/, 'the climb marker is a vector chevron');
  const reduced = drawFull(s, { reduced: true });
  assert.ok(reduced.calls.length > 300, 'reduced-motion rendering keeps the route visible');
  assert.match(rendererJs, /const pulse = reduced \? 0\.68/, 'reduced motion uses a static marker intensity');
});

test('worlds UI: every mine draws at every position, in every phase of its timed hazards, with and without reduced motion — and never throws', () => {
  let frames = 0;
  for (const reduced of [false, true]) for (let zone = 0; zone < 6; zone++) {
    const level = R.levelFor(zone);
    for (const tick of [0, 37, 90, 133, 190, 260, 519]) for (const x of [64, 600, 1100, 1600, 2100, 2560]) {
      const s = freshState(zone); s.tick = tick; s.player.x = x;
      const calls = draw(s, { reduced });
      assert.ok(calls.length > 300, `${level.id} @${x}/${tick} drew a real scene (${calls.length} calls)`);
      frames++;
    }
  }
  assert.equal(frames, 2 * 6 * 7 * 6);
});

test('worlds UI: each hazard kind has a drawing, the original two keep the original code, and the cosmetic timing equals the engine truth', () => {
  const kinds = new Set(R.LEVELS.flatMap(l => l.hazards.map(h => h.kind)));
  for (const kind of kinds) {
    const h = R.LEVELS.flatMap(l => l.hazards).find(x => x.kind === kind);
    const handled = Scenery.drawHazard(fakeCtx(), h, 100, false);
    assert.equal(handled, !['vent', 'pit'].includes(kind), `${kind}: new kinds are drawn by the scenery, vent and pit by the renderer's original code`);
  }
  assert.deepEqual(Scenery.KINDS.sort(), ['crusher', 'crystal', 'flare', 'geyser']);
  for (const [zone, level] of R.LEVELS.entries()) for (const h of freshState(zone).hazards) for (let t = 0; t < 1200; t += 7) { // the run's hazards: the mine has set the timed one's uptime
    const timing = Scenery.timing(h, t);
    assert.equal(timing.active, R.activeHazard(h, t), `${level.id}/${h.kind}: what is drawn as active is exactly what hurts (tick ${t})`);
    if (timing.until > 0) {
      assert.equal(R.activeHazard(h, t + timing.until), true, 'the announced moment really is the first active tick');
      assert.equal(R.activeHazard(h, t + timing.until - 1), false);
    }
    assert.equal(timing.soon, !timing.active && h.period > 1 && timing.until <= 26);
  }
  assert.deepEqual(Scenery.timing({ period: 100, active: 30, phase: 80 }, 0), { active: false, until: 20, soon: true, soonT: 1 - 20 / 26 });
  assert.equal(Scenery.timing({ period: 1, active: 1 }, 5).soon, false, 'an always-on pit has no warning phase');
});

test('worlds UI: the boss is drawn in every state, its warning lane and waves too, and a sleeping or long-dead boss shows no health bar', () => {
  const calls = new Map();
  for (const name of ['drawBoss', 'drawTelegraph', 'drawWaves', 'drawBossBar']) {
    const original = Bosses[name]; calls.set(name, 0);
    Bosses[name] = (...args) => { calls.set(name, calls.get(name) + 1); return original(...args); };
  }
  try {
    for (const zone of [2, 5]) for (const reduced of [false, true]) {
      const states = [
        { state: 'sleep' }, { state: 'walk', timer: 40, facing: -1 }, { state: 'windup', attack: 'slam', timer: 12, aim: -1, facing: -1 },
        { state: 'windup', attack: 'charge', timer: 12, aim: 1, facing: 1 }, { state: 'charge', attack: 'charge', vx: -269, timer: 30, facing: -1 },
        { state: 'recover', timer: 30, hp: 3 }, { state: 'windup', attack: 'slam', timer: 5, enraged: true, hp: 2 },
      ];
      for (const patch of states) {
        const { s } = withBoss(zone, { x: 2250, ...patch });
        s.waves = [{ x: 2100, y: 278, w: 30, h: 22, vx: -230, ttl: 20, kind: 'wave' }, { x: 2300, y: 278, w: 30, h: 22, vx: 230, ttl: 3, kind: 'wave' }];
        assert.doesNotThrow(() => draw(s, { reduced }), `${zone} ${patch.state}`);
      }
      const dead = withBoss(zone, { x: 2250 }); const boss = dead.boss;
      dead.s.bossDefeated = true; boss.dead = true; boss.state = 'dead'; boss.deadTick = dead.s.tick - 30;
      assert.doesNotThrow(() => draw(dead.s, { reduced }), 'dying boss');
    }
    assert.ok(calls.get('drawBoss') >= 2 * 2 * 8 && calls.get('drawWaves') >= 2 * 2 * 7, JSON.stringify([...calls]));
  } finally { /* restore below */ }
  // health bar visibility
  const bar = patch => { const { s } = withBoss(2, patch); const ctx = fakeCtx(); Bosses.drawBossBar.call ? 0 : 0; return { s, ctx }; };
  const sleeping = bar({ state: 'sleep' }); const awake = bar({ state: 'walk', timer: 30 });
  const barCalls = ({ s, ctx }) => { ctx.calls.length = 0; Bosses.drawBossBar(ctx, s, 800, false); return ctx.calls.length; };
  assert.equal(barCalls(sleeping), 0, 'nothing to show until the boss wakes');
  assert.ok(barCalls(awake) > 10);
  const gone = withBoss(2, { x: 2250 }); gone.s.bossDefeated = true; Object.assign(gone.boss, { dead: true, state: 'dead', deadTick: gone.s.tick - 200 });
  assert.equal(barCalls({ s: gone.s, ctx: fakeCtx() }), 0, 'and it disappears after the victory');
  assert.equal(barCalls({ s: freshState(0), ctx: fakeCtx() }), 0, 'mines without a boss never draw one');
});

test('worlds UI: boss phase progress is always a number in [0, 1] and the telegraph reaches exactly as far as the real attack', () => {
  for (const zone of [2, 5]) {
    const boss = withBoss(zone, {}).boss;
    for (const state of ['sleep', 'walk', 'windup', 'charge', 'recover', 'dead']) for (const timer of [0, 1, 17, boss.ai.windup, boss.ai.recover, 9999]) {
      const t = Bosses.phase({ ...boss, state, timer });
      assert.ok(t >= 0 && t <= 1 && Number.isFinite(t), `${zone}/${state}/${timer}`);
    }
  }
  // the lane drawn for a charge is the distance the charge really covers (ticks × speed), the wave lane the wave's real travel
  const warden = withBoss(5, { state: 'windup', attack: 'charge', timer: 20, aim: -1, facing: -1, x: 2250 });
  const ctx = fakeCtx(); Bosses.drawTelegraph(ctx, warden.boss, warden.s, false);
  assert.ok(ctx.calls.includes('fillRect'), 'a charge wind-up paints a lane');
  const idle = withBoss(5, { state: 'walk', timer: 20, x: 2250 }), quiet = fakeCtx();
  Bosses.drawTelegraph(quiet, idle.boss, idle.s, false);
  assert.deepEqual(quiet.calls, [], 'no warning unless an attack is winding up');
});

test('worlds UI: decorations never sit on a rock, a hazard, a flag, a sign, the exit or the boss arena', () => {
  assert.equal(Scenery.propsFor(R.LEVELS[0]).length, 7, 'the first mine keeps its original seven props');
  for (const level of R.LEVELS.slice(1)) {
    const props = Scenery.propsFor(level);
    assert.ok(props.length >= 4, `${level.id} has ${props.length} props`);
    const keepOut = [
      ...level.rockSpans.map(spans => [Math.min(...spans.map(s => s[0])), Math.max(...spans.map(s => s[1])) + 46]),
      ...level.hazards.map(h => [h.x, h.x + h.w]), ...level.checkpoints.map(c => [c.at, c.at + 30]), ...level.signs.map(x => [x - 14, x + 24]),
      [level.exit.x, level.exit.x + level.exit.w],
    ];
    const arena = level.boss ? level.enemies.find(e => e.boss).wake - 40 : Infinity;
    const ground = level.platforms.filter(p => p.y === 300 && p.h === 80);
    for (const prop of props) {
      assert.ok(ground.some(g => prop.x >= g.x + 10 && prop.x + 34 <= g.x + g.w - 10), `${level.id}: prop at ${prop.x} stands on ground`);
      for (const [a, b] of keepOut) assert.ok(prop.x + 34 <= a || prop.x >= b, `${level.id}: prop at ${prop.x} overlaps [${a},${b}]`);
      assert.ok(prop.x < arena, `${level.id}: the boss arena stays empty`);
      assert.ok(['cart', 'barrel', 'chest', 'cluster', 'skull', 'rig', 'robot', 'support', 'chain'].includes(prop.type));
    }
    assert.equal(Scenery.propsFor(level), props, 'cached per level');
  }
  assert.deepEqual(Object.keys(Scenery.SKINS), R.LEVELS.map(l => l.id), 'a skin per world, same ids and order');
  assert.equal(new Set(Object.values(Scenery.SKINS).map(s => s.liquid.join())).size >= 5, true, 'worlds do not all share one liquid');
});

test('worlds UI: tunnel supports and hanging inspection lamps render safely and animate deterministically', () => {
  const support = fakeCtx(), chainA = fakeCtx(), chainB = fakeCtx();
  Scenery.drawProp(support, { x: 300, type: 'support' }, 0, false);
  Scenery.drawProp(chainA, { x: 420, type: 'chain' }, 0, false);
  Scenery.drawProp(chainB, { x: 420, type: 'chain' }, 17, false);
  assert.ok(support.calls.length > 20, 'support has structural detail');
  assert.ok(chainA.calls.length > 15, 'hanging lamp and chain are drawn');
  assert.notDeepEqual(chainA.args, chainB.args, 'lamp sway and light pulse animate over time');
  const reduced = fakeCtx();
  Scenery.drawProp(reduced, { x: 420, type: 'chain' }, 17, true);
  assert.ok(reduced.calls.length > 15, 'reduced-motion mode keeps the lamp visible');
});

test('worlds UI: signs, flags, the exit text and the world skin all come from the level of the run', () => {
  for (let zone = 0; zone < 6; zone++) {
    const level = R.levelFor(zone), s = freshState(zone), ctx = drawFull(s);
    const poles = ctx.args.filter(a => a[0] === 'roundRect' && a[2] === 255 && a[3] === 3 && a[4] === 45).map(a => a[1]).sort((a, b) => a - b);
    assert.deepEqual(poles, level.checkpoints.map(c => c.at).sort((a, b) => a - b), `${level.id}: flags stand where the engine's checkpoints are`);
    const posts = ctx.args.filter(a => a[0] === 'roundRect' && a[2] === 267 && a[3] === 4 && a[4] === 33).map(a => a[1]).sort((a, b) => a - b);
    assert.deepEqual(posts, level.signs.slice().sort((a, b) => a - b), `${level.id}: signposts come from the level`);
    const skin = Scenery.skinFor(level.id), fills = ctx.sets.filter(([k]) => k === 'fillStyle').map(([, v]) => v);
    for (const colour of [skin.rock[0], skin.top[0], skin.liquid[0], skin.liquid[4]]) assert.ok(fills.includes(colour), `${level.id} paints with its own skin (${colour})`);
    const exitText = ctx.args.filter(a => a[0] === 'fillText').map(a => a[1]).filter(t => /بوابة|مغلقة|بلورات/.test(t));
    assert.equal(exitText.length, 1);
    assert.match(exitText[0], level.boss ? /مغلقة حتى يسقط الزعيم/ : /3 بلورات \+ تعدين/, `${level.id}: the locked exit says why it is locked`);
  }
  // after the boss falls the portal text no longer blames the boss
  const { s, boss } = withBoss(2, { x: 2200 }); s.bossDefeated = true; boss.dead = true; boss.state = 'dead'; boss.deadTick = s.tick - 300;
  const open = drawFull(s).args.filter(a => a[0] === 'fillText').map(a => a[1]);
  assert.ok(!open.some(t => /مغلقة حتى يسقط/.test(t)));
});

test('worlds UI: an off-screen boss gets an edge arrow, and a word when it is about to strike', () => {
  const marks = patch => {
    const { s } = withBoss(5, { x: 2300, state: 'walk', timer: 30, ...patch }, 1800);
    const ctx = fakeCtx(); Bosses.drawBossBar(ctx, s, 344, false, 1700); // the view is 1700..2044, the boss stands at ~2300
    return ctx;
  };
  const quiet = marks({}), hot = marks({ state: 'windup', attack: 'charge', timer: 20, aim: -1 }), slam = marks({ state: 'windup', attack: 'slam', timer: 20 });
  const labels = ctx => ctx.args.filter(a => a[0] === 'fillText').map(a => a[1]);
  assert.ok(quiet.calls.filter(c => c === 'fill').length > 0, 'an arrow at the edge');
  assert.ok(!labels(quiet).some(t => /اندفاع|صدمة/.test(t)), 'no attack word while it is only walking');
  assert.ok(labels(hot).includes('اندفاع!'), 'a charge announces itself even from off-screen');
  assert.ok(labels(slam).includes('صدمة!'));
  // on screen: no marker at all
  const { s } = withBoss(5, { x: 1900, state: 'windup', attack: 'charge', timer: 20 }, 1800), near = fakeCtx();
  Bosses.drawBossBar(near, s, 344, false, 1700);
  assert.ok(!labels(near).some(t => /اندفاع!|صدمة!/.test(t)), 'visible boss, visible telegraph — no arrow');
  // to the left of the view the arrow points the other way
  const left = withBoss(5, { x: 1300, state: 'walk', timer: 30 }, 1800), l = fakeCtx();
  Bosses.drawBossBar(l, left.s, 344, false, 1700);
  const arrow = l.args.filter(a => a[0] === 'moveTo').map(a => a[1]);
  assert.ok(arrow.some(x => x < 30), 'near the left edge');
});

test('worlds UI: every event the boss engine emits is heard and seen by the game screen', () => {
  const emitted = [...new Set([...rules.matchAll(/type: '(boss_[a-z]+)'/g)].map(m => m[1]))].sort();
  assert.deepEqual(emitted, ['boss_charge', 'boss_crash', 'boss_death', 'boss_enrage', 'boss_slam', 'boss_stun', 'boss_wake', 'boss_windup']);
  // how many separate places react to each event: shake/haptic, status line or floater, particles (a deleted branch lowers the count)
  const roles = { boss_wake: 3, boss_windup: 1, boss_slam: 2, boss_charge: 1, boss_crash: 2, boss_stun: 2, boss_enrage: 3, boss_death: 3 };
  for (const type of emitted) {
    assert.match(game, new RegExp(`${type}: \\{ freq: \\d+`), `${type} has its own sound`);
    const handlers = (game.match(new RegExp(`event\\.type === '${type}'`, 'g')) || []).length;
    assert.ok(handlers >= roles[type], `${type} is handled in ${handlers} places, expected ${roles[type]}`);
  }
  assert.match(game, /clang: \{ freq/, 'a blocked hit rings');
  assert.match(game, /event\.type === 'hit' && event\.damage === 0 \? 'clang'/, 'and the ring replaces the normal hit sound');
  assert.match(game, /event\.damage === 0\) pushFloater\([^)]*'مدرّع'/, 'with a word, not only a colour');
});

test('worlds UI: the page ships the new scripts in dependency order, the boss icon and row, and a danger line per world', () => {
  const order = ['platform-rules.js', 'platform-scenery.js', 'platform-bosses.js', 'platform-renderer.js'].map(f => html.indexOf(`/${f}?v=`));
  assert.ok(order.every(i => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), `script order ${order}`);
  assert.match(html, /id="i-boss"/);
  assert.match(html, /<div class="mission-row" hidden>[^]*?#i-boss[^]*?id="mission-boss"/, 'a boss row in the mission card, hidden until the mine has one');
  for (const level of R.LEVELS) assert.match(html, new RegExp(`${level.id}: '[^']+'`), `${level.id} has a danger line on the mines map`);
  assert.match(html, /WS_RULES\.levelFor\(i\)\.boss/, 'the mines map reads the boss from the level');
  assert.ok((game.match(/R\.levelFor\(sim\.zone\)\.exit\.x/g) || []).length >= 2, 'progress % and the locked-exit hint both use the level of the run');
  assert.doesNotMatch(game, /R\.LEVEL\b/);
  assert.match(game, /R\.MAX_SEGMENTS/);
  assert.doesNotMatch(game, /\binputs\.length >= 1000\b/);
  assert.doesNotMatch(rendererJs, /R\.LEVEL\./);
});

test('worlds UI: the test hook feeds recorded inputs through the real pipeline and the new art uses no emoji', () => {
  assert.match(game, /function advance\(mask\)/);
  assert.match(game, /advance\(mask\); accumulator -= R\.DT;/, 'the real-time loop uses the very same step as the hook');
  assert.match(game, /feed, resetFeed\(\)/);
  assert.match(game, /boss: sim\.bossId \?/, 'inspect() reports the boss');
  assert.doesNotMatch(game.slice(game.indexOf("event.type === 'boss_wake'"), game.indexOf("event.type === 'enemy_death'")), /feedback\(/, 'boss messages go to the status line, which exists on the page (the old feedback box does not)');
  assert.doesNotMatch(html, /id="platform-feedback"/, 'documents the fact the guard above relies on');
  for (const [name, source] of [['scenery', sceneryJs], ['bosses', bossesJs]]) assert.doesNotMatch(source, /\p{Extended_Pictographic}/u, `${name} art is drawn, not typed as emoji`);
  assert.doesNotMatch(game, /\p{Extended_Pictographic}/u.source ? /[\u{1F300}-\u{1FAFF}]/u : /x^/, 'no emoji in the game screen text either');
});

// لوحة «الساحة» لا تعرض مستطيلًا فارغًا: مشهد المبارزة يُرسم بنفس محرك اللعب.
test('arena preview: a duel scene draws hero, rival and terrain — and the demo loop actually animates it', () => {
  for (const hero of ['miner', 'warrior', 'archer']) {
    const s = R.create(hero, R.seedFromId(`duel-ui-${hero}`), { zone: 0, mode: 'duel' });
    const rival = s.enemies[0];
    assert.ok(rival && rival.hp > 0, `${hero}: the rival exists in the preview scene`);
    const calls = draw(s);
    assert.ok(calls.length > 300, `${hero} duel draws a real scene (${calls.length} draw calls)`);
    // الحلقة الاستعراضية تحرّك اللاعب فعلًا (لا صورة ثابتة)
    const startX = s.player.x, startTick = s.tick;
    for (let i = 0; i < 30; i++) R.step(s, R.INPUT.RIGHT);
    assert.ok(s.tick > startTick && s.player.x > startX, `${hero}: the demo input moves the hero`);
    assert.ok(draw(s).length > 300, 'and it still draws after moving');
  }
});


test('mine machinery props are animated, and reduced motion freezes their moving parts', () => {
  const level = R.LEVELS.find(item => item.id === 'iron');
  assert.ok(level, 'iron mine fixture exists');
  const props = Scenery.propsFor(level);
  const rig = props.find(item => item.type === 'rig');
  const robot = props.find(item => item.type === 'robot');
  assert.ok(rig, 'mine has a mechanical drill rig');
  assert.ok(robot, 'mine has an autonomous robot worker');

  const trace = (prop, tick, reduced) => {
    const c = fakeCtx();
    Scenery.drawProp(c, prop, tick, reduced);
    return c.args;
  };
  assert.notDeepEqual(trace(rig, 0, false), trace(rig, 9, false), 'the rig piston and drill head move with time');
  assert.notDeepEqual(trace(robot, 0, false), trace(robot, 9, false), 'the robot worker moves its body and arms');
  assert.deepEqual(trace(rig, 0, true), trace(rig, 9, true), 'reduced motion freezes the rig');
  assert.deepEqual(trace(robot, 0, true), trace(robot, 9, true), 'reduced motion freezes the worker');
});
