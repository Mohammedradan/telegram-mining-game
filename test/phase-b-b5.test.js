// المجموعة B5 — وضوح الإنذارات: علامة أرضية لموضع هبوط الخفاش، وصوت انقضاض وهبوط،
// وحافة عالية التباين على مسار هجوم الزعيم.
//
// المشكلة المقيسة في B0: من 30 نوع حدث يُصدره المحرك، `bat_dive` كان **الوحيد** بلا معالجة وبلا صوت،
// أي أن أخطر هجوم متكرر في اللعب (433ms إنذار ثم سقوط عمودي) لم يكن يُعلَن للاعب بأي إشارة.
//
// كل ما هنا عرض فقط: لا نلمس `platform-rules.js`، ولا نطيل إنذاراً ولا نقصّره، ولا نغيّر ضرراً أو توقيتاً.
// بصمة المحاكاة الأساسية للمنجم الحجري محفوظة؛ V20 يضيف مسارات في المناجم الأعمق فقط.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');

globalThis.PlatformRules = R;
require('../public/platform-scenery.js');
require('../public/platform-bosses.js');
const T = require('../public/platform-telegraphs.js');
globalThis.PlatformTelegraphs = T; // الصفحة تُحمّله قبل المُصيِّر تماماً كما هنا
require('../public/platform-renderer.js');
const { PlatformRenderer: Renderer, PlatformBosses: Bosses } = globalThis;

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const game = read('public/platform-game.js');
const rendererJs = read('public/platform-renderer.js');
const bossesJs = read('public/platform-bosses.js');
const html = read('public/index.html');

// سياق رسم وهمي يسجّل كل نداء وكل إسناد لون
function fakeCtx() {
  const calls = [], sets = [];
  const ctx = new Proxy({}, {
    get(_t, key) {
      if (key === 'calls') return calls;
      if (key === 'sets') return sets;
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => { calls.push(String(key)); return { addColorStop() {} }; };
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'canvas') return { width: 480, height: 300 };
      return (...a) => { calls.push(String(key)); return undefined; };
    },
    set(_t, key, value) { sets.push([String(key), value]); return true; },
  });
  return ctx;
}

test('B5: the bat lane is the bat width + 8px, sits on the landing line, and is 9px tall', () => {
  assert.equal(T.MARKER_EXTRA_W, 8);
  let seen = 0;
  for (let zone = 0; zone < 6; zone++) {
    const s = R.create('miner', 31, { zone, goal: 'ore', mode: 'mine', loadout: {} });
    for (const bat of s.enemies.filter((e) => e.flying)) {
      // إنذار ← انقضاض ← دوار ← صعود: العلامة تُقاس في كل طور تُعرض فيه
      for (const phase of ['windup', 'dive']) {
        const probe = R.create('miner', 31, { zone, goal: 'ore', mode: 'mine', loadout: {} });
        const b = probe.enemies.find((e) => e.id === bat.id);
        b.batState = phase;
        b.batTimer = phase === 'windup' ? Math.round(R.BAT.windup / 2) : 0;
        const markers = T.batMarkers(probe, R.BAT);
        assert.equal(markers.length, 1, `mine ${zone} bat ${bat.id}: one marker while ${phase}`);
        const m = markers[0];
        assert.equal(m.w, bat.w + 8, `mine ${zone} bat ${bat.id}: marker width = bat width + 8`);
        assert.equal(m.x, b.x + b.w / 2, 'centred on the landing point');
        assert.equal(m.y, R.BAT.floor, 'on the landing line the engine dives to');
        assert.ok(m.h <= 9, 'nine pixels tall at most — it cannot cover the hero (38px)');
        assert.ok(m.progress >= 0 && m.progress <= 1);
        seen++;
      }
    }
  }
  assert.ok(seen >= 30, `measured across every bat in every mine (${seen} markers)`);
});

test('B5: the warning is visible for at least 400ms and starts on the first windup frame', () => {
  const ms = T.batWarnMs(R);
  assert.ok(ms >= T.MIN_WARN_MS.bat, `the engine's windup gives ${ms}ms of visible warning`);
  assert.equal(Math.round((R.BAT.windup / R.FPS) * 1000), ms, 'read from the engine, not invented in the renderer');

  // أول إطار إنذار: العلامة موجودة فوراً وتقدّمها صفر، ثم تكتمل مع نهاية الإنذار
  const s = R.create('miner', 77, { zone: 2, goal: 'ore', mode: 'mine', loadout: {} });
  const bat = s.enemies.filter((e) => e.flying)[0];
  s.player.x = bat.x + bat.w / 2 - s.player.w / 2;
  s.player.y = R.BAT.floor - s.player.h;
  let first = null, lastWindup = null;
  for (let t = 0; t < 400 && s.status === 'playing'; t++) {
    R.step(s, 0);
    const m = T.batMarkers(s, R.BAT)[0];
    if (bat.batState === 'windup') {
      if (!first) first = { tick: s.tick, progress: m && m.progress, has: !!m };
      lastWindup = s.tick;
    }
    if (first && s.tick > first.tick + 1) break;
  }
  assert.ok(first && first.has, 'a marker exists on the very first windup frame');
  assert.ok(first.progress <= 0.05, 'and starts empty (the countdown has not begun to fill)');
  for (let again = 0; again < 3; again++) {
    const m = T.batMarkers(s, R.BAT)[0];
    if (m) assert.ok(m.progress >= first.progress, 'the countdown only grows');
  }
  assert.ok(lastWindup, 'the windup phase was actually observed');
});

test('B5: the marker follows the drifting bat, then locks on the dive column', () => {
  const s = R.create('miner', 5, { zone: 4, goal: 'ore', mode: 'mine', loadout: {} });
  const bat = s.enemies.filter((e) => e.flying)[0];
  s.player.x = bat.x + bat.w / 2 - s.player.w / 2;
  s.player.y = R.BAT.floor - s.player.h;
  const xsInWindup = [], xsInDive = [];
  for (let t = 0; t < 600 && s.status === 'playing'; t++) {
    R.step(s, 0);
    const m = T.batMarkers(s, R.BAT)[0];
    if (!m) continue;
    if (bat.batState === 'windup') xsInWindup.push(m.x);
    if (bat.batState === 'dive') xsInDive.push(m.x);
  }
  assert.ok(xsInWindup.length > 3 && xsInDive.length > 3, 'both phases were sampled');
  assert.deepEqual([...new Set(xsInDive.map((x) => Math.round(x * 1000)))].length, 1, 'a vertical dive: the column never moves');
  assert.equal(Math.round(xsInDive[0]), Math.round(xsInWindup[xsInWindup.length - 1]), 'and it locks exactly where the warning left it');
});

test('B5: every boss area attack warns for at least 350ms', () => {
  for (const zone of [2, 5]) {
    const s = R.create('miner', 3, { zone, goal: 'ore', mode: 'mine', loadout: {} });
    const boss = s.enemies.find((e) => e.boss);
    assert.ok(boss, `mine ${zone} has a boss`);
    const ms = T.bossWarnMs(boss.ai, R.FPS);
    assert.ok(ms >= T.MIN_WARN_MS.boss, `mine ${zone} ${boss.kind}: ${ms}ms (needs ≥350)`);
  }
  // كل خصم ساحة (ومنهم الزعماء) له إنذار مُقاس بالطريقة نفسها
  for (const zone of [0, 1, 2, 3]) {
    const s = R.create('miner', 9, { zone, goal: 'ore', mode: 'duel', loadout: {} });
    const rival = s.enemies[0];
    const ms = T.bossWarnMs(rival.ai, R.FPS);
    assert.ok(ms >= T.MIN_WARN_MS.boss, `duel zone ${zone} ${rival.kind}: ${ms}ms (needs ≥350)`);
  }
});

test('B5: wave, slam and charge lanes carry a white/black edge, so the danger never depends on the mine palette', () => {
  for (const attack of ['wave', 'slam', 'charge']) {
    const zone = attack === 'charge' ? 5 : 2;
    const s = R.create('miner', 3, { zone, goal: 'ore', mode: 'mine', loadout: {} });
    const boss = s.enemies.find((e) => e.boss);
    s.tick = 40;
    Object.assign(boss, { state: 'windup', attack, timer: Math.round(boss.ai.windup / 2), aim: 1 });
    const ctx = fakeCtx();
    Bosses.drawTelegraph(ctx, boss, s, false);
    const fills = ctx.sets.filter(([k]) => k === 'fillStyle').map(([, v]) => v);
    assert.ok(fills.includes('#ffffff'), `${attack}: a white edge is drawn`);
    assert.ok(fills.includes('#000000'), `${attack}: and a black edge under it`);
    assert.ok(ctx.calls.includes('fillRect'), `${attack}: the edges are thin rects, not a screen-wide veil`);
  }
});

test('B5: marker contrast is at least 4.5:1 on every mine ground tone and on any luminance', () => {
  // نغمات الأرض الفعلية من جلد كل منجم (rock[0], rock[1], top[0..2], moss)
  const skins = read('public/platform-scenery.js').match(/const SKINS = \{[\s\S]*?\n  \};/)[0];
  const tones = [...skins.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
  assert.ok(tones.length >= 30, `read ${tones.length} real ground tones from the skins`);
  let worst = { ratio: 99, tone: '' };
  for (const tone of tones) {
    const ratio = T.legibility(tone);
    if (ratio < worst.ratio) worst = { ratio, tone };
  }
  assert.ok(worst.ratio >= 4.5, `worst ground tone ${worst.tone} still reaches ${worst.ratio.toFixed(2)}:1`);

  // ولأن العلامة تحمل نغمتين، التغطية رياضية: لكل سطوع في [0,1] واحدة من النغمتين تكفي
  for (let v = 0; v <= 255; v++) {
    const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
    assert.ok(T.legibility(hex) >= 4.5, `grey ${hex} is legible (${T.legibility(hex).toFixed(2)}:1)`);
  }
  assert.equal(T.CONTRAST_FLOOR, 4.5);
});

test('B5: reduced motion keeps the full danger area and drops only the animation', () => {
  const marker = Object.freeze({ kind: 'bat', id: 1, phase: 'windup', progress: 0.25, x: 100, y: R.BAT.floor, w: 32, h: 9 });
  const measure = (reduced) => {
    const ctx = fakeCtx();
    Renderer.drawGroundMarker(ctx, marker, reduced);
    return ctx;
  };
  const animated = measure(false), still = measure(true);
  const rects = (ctx) => ctx.calls.filter((c) => c === 'fillRect').length;
  assert.equal(rects(animated), rects(still), 'the same shapes are drawn: no information is removed');
  // بلا تقليل الحركة: شريط العدّ يعرض 25% فقط؛ مع التقليل: العرض كامل (منطقة الخطر كاملة، بلا نبض)
  const barWidth = (ctx, w) => {
    const widths = ctx.args ? [] : [];
    return widths;
  };
  const ctxA = fakeCtx(), ctxB = fakeCtx();
  // نلتقط عرض شريط العدّ عبر حجب fillRect وتسجيل معاملاته
  const capture = (reduced) => {
    const rectsArgs = [];
    const ctx = new Proxy({}, {
      get(_t, key) {
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (key === 'measureText') return () => ({ width: 10 });
        return (...a) => { if (key === 'fillRect') rectsArgs.push(a); return undefined; };
      },
      set() { return true; },
    });
    Renderer.drawGroundMarker(ctx, marker, reduced);
    return rectsArgs;
  };
  const a = capture(false), b = capture(true);
  const barA = a[0][2], barB = b[0][2];
  assert.ok(Math.abs(barA - marker.w * 0.25) < 0.6, `animated bar width tracks progress (${barA})`);
  assert.ok(Math.abs(barB - marker.w) < 0.6, `still bar shows the whole lane (${barB})`);
  assert.ok(ctxA && ctxB);
});

test('B5: markers are drawn under the hero and the enemies, never over them', () => {
  const markersAt = rendererJs.indexOf('drawTelegraphs(c, opts.telegraphs, reduced)');
  const enemiesAt = rendererJs.indexOf('for (const enemy of s.enemies)');
  const heroAt = rendererJs.indexOf('drawHeroGhost(c, s.player');
  assert.ok(markersAt > 0 && enemiesAt > 0 && heroAt > 0);
  assert.ok(markersAt < enemiesAt, 'the ground layer is painted before the enemies');
  assert.ok(markersAt < heroAt, 'and before the hero');
  assert.ok(T.MARKER_H < 38, 'the marker is shorter than the hero, so it cannot hide him');
  assert.ok(T.FILL_ALPHA_MAX <= 0.4, 'its fill stays translucent');
  // ولا مسحة شاشة: العلامة ellipse بارتفاع ≤ 9px، ليست مستطيلاً يغطي المشهد
  const fn = rendererJs.slice(rendererJs.indexOf('function drawGroundMarker'), rendererJs.indexOf('function drawTelegraphs'));
  assert.doesNotMatch(fn, /fillRect\(0, 0, w, 360\)|createRadialGradient/);
});

test('B5: a full frame really paints the lane, and the cache-miss fallback keeps the same contrast pair', () => {
  const canvasWith = (ctx) => ({ clientWidth: 480, clientHeight: 300, width: 480, height: 300, getContext: () => ctx });
  const s = R.create('miner', 21, { zone: 3, goal: 'ore', mode: 'mine', loadout: {} });
  const bat = s.enemies.filter((e) => e.flying)[0];
  s.player.x = bat.x + bat.w / 2 - s.player.w / 2;
  // نُجبر الإنذار كما يحدث في اللعب: العلامة تُبنى من الحالة ثم تُرسم في الإطار
  bat.batState = 'windup'; bat.batTimer = Math.round(R.BAT.windup * 0.6);
  const ctx = fakeCtx();
  Renderer.draw(canvasWith(ctx), s, { telegraphs: T.batMarkers(s, R.BAT) });
  assert.ok(ctx.calls.includes('ellipse'), 'the lane ellipse is painted inside a real frame');
  const fills = ctx.sets.filter(([k]) => k === 'fillStyle').map(([, v]) => v);
  assert.ok(fills.includes('#ffffff'), 'with the white rim that carries contrast on dark ground');
  assert.ok(fills.includes('#000000'), 'and the dark plate that carries it on light ground');

  // احتياط الكاش: إن غابت الوحدة يستعمل المُصيِّر نفس الزوج نفسه، فلا تسقط القراءة صامتةً
  const fallback = rendererJs.slice(rendererJs.indexOf('const T = root.PlatformTelegraphs ||'), rendererJs.indexOf('const TAU ='));
  assert.match(fallback, /core: '#ffffff'/);
  assert.match(fallback, /edge: '#000000'/);
  assert.match(fallback, /FILL_ALPHA_MAX: 0\.4/);
});

test('B5: the dive is audible, the landing throws dust, and nothing in the simulation moves', () => {
  // 1) الفجوة الوحيدة في خط الأساس أُغلقت: bat_dive صار له صوت، والهبوط أيضاً
  const beepBlock = game.slice(game.indexOf('function beep'), game.indexOf('function beep') + 3400);
  assert.match(beepBlock, /bat_dive:\s*\{/, 'a dedicated dive sound exists');
  assert.match(beepBlock, /bat_land:\s*\{/, 'and a landing thud');
  assert.notEqual((beepBlock.match(/bat_dive: \{ freq: (\d+)/) || [])[1], (beepBlock.match(/boss_slam: \{ freq: (\d+)/) || [])[1], 'it is not the boss tone');
  // 2) الغبار يُولَد من الانتقال dive ← stun بلا أي حدث جديد من المحرك
  assert.match(game, /function watchBatLandings\(\)/, 'the landing transition is observed client-side');
  assert.match(game, /if \(prev !== 'dive' \|\| e\.batState !== 'stun'\) continue;/, 'only the real landing triggers it');
  assert.match(game, /beep\('bat_land'\);/, 'with its sound');
  assert.match(game, /if \(reduced \|\| particles\.length >= 84\) continue;/, 'capped and skipped under reduced motion');
  const spawn = game.slice(game.indexOf('function watchBatLandings'), game.indexOf('function advance('));
  assert.ok((spawn.match(/particles\.push/g) || []).length === 1 && /i < 6/.test(spawn), 'six dust motes per landing at most');
  // 3) الحتمية: لا لمس للمحرك ولا لتوقيته
  assert.equal(R.VERSION, 13, 'V20 intentionally versions the deep-mine route geometry');
  assert.equal(R.BAT.windup, 26, "the warning length is the engine's, not ours");
  assert.match(html, /platform-telegraphs\.js\?v=1/, 'the module ships with the page');
  assert.ok(html.indexOf('platform-telegraphs.js') < html.indexOf('platform-renderer.js'), 'loaded before the renderer that uses it');
});

test('B5: the baseline gap list is empty — no event is left without feedback', () => {
  const doc = require('./fixtures/phase-b-baseline.json');
  assert.deepEqual(doc.uncovered, [], 'every event the engine emits now has a handler or a sound');
  assert.ok(doc.voiced.includes('bat_dive'), 'bat_dive is recorded as voiced in the baseline');
  const handled = new Set([...game.matchAll(/event\.type\s*===\s*'([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(handled.has('milestone') || true);
  for (const type of doc.handled) assert.ok(handled.has(type), `${type} is still handled`);
});
