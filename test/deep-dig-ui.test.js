// اختبارات الدوال النقية في واجهة «الحفر العميق» (public/deep-dig-ui.js): العصا والاتجاه والكاميرا والجسيمات
// وحاكم الجودة والسجلات المحلية. الواجهة نفسها (DOM وCanvas) تُختبر في page-boot.test.js وفي Chromium الحقيقي.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UI = require('../public/deep-dig-ui.js');
const DD = require('../public/deep-dig.js');
const Render = require('../public/deep-dig-render.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const memory = (initial) => { const m = new Map(Object.entries(initial || {})); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }; };

// ───────────────────────────── العصا ─────────────────────────────
test('stickVector: a dead zone that rescales (no jump), clamped at the rim, direction preserved, garbage safe', () => {
  assert.deepEqual(UI.stickVector(2, 2, 40), { x: 0, y: 0, mag: 0 }, 'داخل المنطقة الميتة');
  const edge = UI.stickVector(40 * UI.CFG.PAD_DEAD + 0.5, 0, 40);
  assert.ok(edge.mag > 0 && edge.mag < 0.02, 'تبدأ من الصفر عند حافة المنطقة الميتة لا بقفزة');
  near(UI.stickVector(40, 0, 40).mag, 1);
  const over = UI.stickVector(400, 0, 40);
  near(over.mag, 1); near(over.x, 1);
  const diag = UI.stickVector(30, -30, 40);
  near(Math.atan2(diag.y, diag.x), Math.atan2(-30, 30), 1e-9);
  assert.ok(Math.hypot(diag.x, diag.y) <= 1 + 1e-9, 'داخل الدائرة الواحدية');
  assert.deepEqual(UI.stickVector(NaN, undefined, 0), { x: 0, y: 0, mag: 0 });
  assert.deepEqual(UI.stickVector(10, 10, -5, 5), UI.stickVector(10, 10, 1, 0.9), 'نصف قطر وميتة خارج المدى يُقصّان');
});

test('pickDir: the stronger axis wins, the current axis sticks near the diagonal, and a release keeps its memory', () => {
  assert.deepEqual(UI.pickDir(0.9, 0.2, 'v'), { dx: 1, dy: 0, axis: 'h' });
  assert.deepEqual(UI.pickDir(-0.9, 0.2, 'v'), { dx: -1, dy: 0, axis: 'h' });
  assert.deepEqual(UI.pickDir(0.1, 0.9, 'h'), { dx: 0, dy: 1, axis: 'v' });
  assert.deepEqual(UI.pickDir(0.1, -0.9, 'h'), { dx: 0, dy: -1, axis: 'v' });
  // قرب القطر: المحور الحالي يثبت ما لم يتفوق الآخر بنسبة HYST (فلا يرتجف الاتجاه بين نقرتين)
  assert.equal(UI.pickDir(0.55, 0.5, 'v').axis, 'v');
  assert.equal(UI.pickDir(0.55, 0.5, 'h').axis, 'h');
  assert.equal(UI.pickDir(0.5, 0.55, 'h').axis, 'h');
  assert.equal(UI.pickDir(0.7, 0.5, 'v').axis, 'h', '0.7 > 0.5 × 1.2');
  assert.equal(UI.pickDir(0.5, 0.7, 'h').axis, 'v');
  // بلا محور سابق: الأقوى يفوز، والتعادل رأسي (النزول)
  assert.equal(UI.pickDir(0.8, 0.4, null).axis, 'h');
  assert.equal(UI.pickDir(0.4, 0.8, null).axis, 'v');
  assert.equal(UI.pickDir(0.5, 0.5, null).axis, 'v');
  // المنطقة الميتة: لا اتجاه، والمحور يُحفظ
  assert.deepEqual(UI.pickDir(0.1, 0.1, 'h'), { dx: 0, dy: 0, axis: 'h' });
  assert.deepEqual(UI.pickDir(0, 0, null), { dx: 0, dy: 0, axis: 'v' });
  assert.deepEqual(UI.pickDir(NaN, undefined, 'h'), { dx: 0, dy: 0, axis: 'h' });
  // لوحة المفاتيح: ±1 يتجاوز المنطقة الميتة دائماً
  assert.equal(UI.pickDir(1, 0, 'v').dx, 1);
  assert.equal(UI.pickDir(0, -1, 'h').dy, -1);
});

// ───────────────────────────── الكاميرا ─────────────────────────────
test('camera: sky above the surface, the miner at the lead position mid-shaft, the floor at the bottom', () => {
  const rows = DD.ROWS, view = 15;
  near(UI.cameraTarget(0.5, view, rows), 0.5 - view * UI.CFG.CAM_LEAD);            // على السطح: المعدّن عند موضعه المعتاد وفوقه سماء
  assert.equal(UI.cameraTarget(0.5, 22, rows), -UI.CFG.SKY_ROWS, 'شاشة طويلة جداً: تُقصّ على السماء المتاحة');
  near(UI.cameraTarget(30.5, view, rows), 30.5 - view * UI.CFG.CAM_LEAD);
  assert.equal(UI.cameraTarget(70, view, rows), rows - view, 'لا تتجاوز الأرضية');
  assert.equal(UI.cameraTarget(1, 80, rows), -UI.CFG.SKY_ROWS, 'شاشة أطول من البئر كله: تبقى الكاميرا على السماء');
  // عند السطح يقف المعدّن تحت الشريط العلوي: على الأقل خُمس الشاشة من الأعلى
  const cam = UI.cameraTarget(0.5, view, rows);
  assert.ok((0.5 - cam) / view >= 0.28, `موضع المعدّن من أعلى الشاشة ${(0.5 - cam) / view}`);
});

test('cameraStep: smooth, monotonic, never overshoots, and nearly frame-rate independent', () => {
  let c = 0;
  const seq = [];
  for (let i = 0; i < 40; i++) { c = UI.cameraStep(c, 10, 1 / 60); seq.push(c); }
  assert.ok(seq.every((v, i) => v <= 10 && (i === 0 || v >= seq[i - 1])), 'يقترب بلا تجاوز');
  assert.ok(seq[39] > 9, 'يلحق بالهدف خلال ثلثي ثانية');
  assert.equal(UI.cameraStep(3, 10, 0), 3, 'بلا زمن لا حركة');
  assert.ok(UI.cameraStep(0, 10, 100) <= 10, 'إطار شاذ الطول لا يقفز بعيداً');
  const one = UI.cameraStep(0, 10, 1 / 30), two = UI.cameraStep(UI.cameraStep(0, 10, 1 / 60), 10, 1 / 60);
  near(one, two, 1e-9);
  assert.equal(UI.cameraStep(5, 5, 0.1), 5);
  assert.ok(Number.isFinite(UI.cameraStep(1, 2, NaN)));
});

// ───────────────────────────── الجسيمات ─────────────────────────────
test('particles: the cap protects weak phones, labels always get in, lifetimes end, motion integrates', () => {
  const P = UI.createParticles(5);
  for (let i = 0; i < 9; i++) P.add({ kind: 'dust', x: i, y: 0, life: 1 });
  assert.equal(P.list.length, 5, 'السقف');
  assert.equal(P.add({ kind: 'label', x: 0, y: 0, life: 1, text: 'x' }), true);
  assert.equal(P.list.length, 5, 'التسمية تُخرج أقدم جسيم لتدخل');
  assert.equal(P.list[P.list.length - 1].kind, 'label');
  P.clear();
  P.add({ kind: 'chip', x: 0, y: 0, vx: 2, vy: -3, g: 10, life: 0.5, rot: 0, vr: 4 });
  P.step(0.1);
  const p = P.list[0];
  near(p.x, 0.2); near(p.vy, -2); near(p.y, -0.2); near(p.rot, 0.4); near(p.life, 0.4);
  assert.equal(p.max, 0.5, 'max = العمر الأصلي (للتلاشي)');
  P.step(0.5);
  assert.equal(P.list.length, 0, 'انتهى العمر');
  P.add({ kind: 'dust', x: 1, y: 1, life: 0.05 }); P.add({ kind: 'dust', x: 2, y: 2, life: 5 });
  P.step(0.1);
  assert.deepEqual(P.list.map((q) => q.x), [2], 'الإزالة لا تُسقط الجسيمات الحية');
  assert.deepEqual(UI.CFG.PARTICLES.slice().sort((a, b) => a - b), [...UI.CFG.PARTICLES], 'الجودة الأقل = جسيمات أقل');
});

// ───────────────────────────── حاكم الجودة ─────────────────────────────
test('quality governor: drops a level after sustained slow frames, ignores pauses, and never climbs back', () => {
  const q = UI.createQuality({ slowN: 10 });
  assert.equal(q.level, 2);
  for (let i = 0; i < 9; i++) q.sample(60);
  assert.equal(q.level, 2, 'لم يكتمل العدد بعد');
  q.sample(60);
  assert.equal(q.level, 1);
  for (let i = 0; i < 40; i++) q.sample(16);
  assert.equal(q.level, 1, 'لا يرتفع ثانية (فلا يتأرجح)');
  for (let i = 0; i < 25; i++) q.sample(70);
  assert.equal(q.level, 0);
  for (let i = 0; i < 50; i++) q.sample(70);
  assert.equal(q.level, 0, 'الحد الأدنى');
  const r = UI.createQuality({ slowN: 3 });
  for (let i = 0; i < 20; i++) r.sample(5000);                 // تبديل تبويب أو إيقاف: ليس بطئاً
  assert.equal(r.level, 2);
  for (let i = 0; i < 20; i++) { r.sample(0); r.sample(-4); r.sample(NaN); }
  assert.equal(r.level, 2);
  const s = UI.createQuality({ slowN: 5 });
  for (let i = 0; i < 4; i++) s.sample(60);
  s.sample(16); s.sample(16); s.sample(16);                     // الإطارات السريعة تُنقص العدّاد البطيء
  for (let i = 0; i < 2; i++) s.sample(60);
  assert.equal(s.level, 2, 'بطء متقطع لا يخفض الجودة');
  s.set(0); assert.equal(s.level, 0);
  s.set(99); assert.equal(s.level, 2);
  assert.ok(UI.createQuality().ema > 0);
});

// ───────────────────────────── السجلات المحلية ─────────────────────────────
test('records: safe defaults, round trip, clamping of hostile storage, and honest "new best" flags', () => {
  assert.deepEqual(UI.loadRecords(memory()), UI.emptyRecord());
  assert.deepEqual(UI.loadRecords(memory({ [UI.CFG.RECORD_KEY]: '{not json' })), UI.emptyRecord());
  assert.deepEqual(UI.loadRecords(memory({ [UI.CFG.RECORD_KEY]: 'null' })), UI.emptyRecord());
  assert.deepEqual(UI.loadRecords(null), UI.emptyRecord(), 'بلا تخزين');
  const st = memory();
  UI.saveRecords(st, { depthM: 44, value: 120, legend: true, runs: 3, wins: 1, hinted: true });
  assert.deepEqual(UI.loadRecords(st), { depthM: 44, value: 120, legend: true, runs: 3, wins: 1, hinted: true });
  const hostile = UI.loadRecords(memory({ [UI.CFG.RECORD_KEY]: JSON.stringify({ depthM: 9e9, value: -5, runs: 'x', wins: 1.9, legend: 'yes', hinted: 1 }) }));
  assert.deepEqual(hostile, { depthM: UI.DEPTH_MAX_M, value: 0, legend: false, runs: 0, wins: 1, hinted: false });
  UI.saveRecords({ setItem() { throw new Error('quota'); } }, UI.emptyRecord());   // لا يرمي

  const base = { depthM: 40, value: 100, legend: false, runs: 2, wins: 0, hinted: true };
  const a = UI.applyResult(base, { depthM: 60, value: 80, reason: 'rope' });
  assert.equal(a.newDepth, true); assert.equal(a.newValue, false);
  assert.deepEqual(a.rec, { depthM: 60, value: 100, legend: false, runs: 3, wins: 0, hinted: true });
  assert.equal(base.runs, 2, 'لا يعدّل المدخل');
  const b = UI.applyResult(a.rec, { depthM: 60, value: 100, reason: 'faint' });
  assert.equal(b.newDepth, false, 'التعادل ليس رقماً قياسياً'); assert.equal(b.newValue, false);
  const c = UI.applyResult(b.rec, { depthM: 122, value: 400, reason: 'won' });
  assert.deepEqual([c.newDepth, c.newValue, c.rec.legend, c.rec.wins, c.rec.depthM, c.rec.value, c.rec.runs], [true, true, true, 1, 122, 400, 5]);
  assert.equal(UI.applyResult(c.rec, { depthM: 10, value: 0, reason: 'rope' }).rec.legend, true, 'الأسطورة تبقى');
  assert.equal(UI.applyResult(UI.emptyRecord(), { depthM: 9999, value: 1, reason: 'rope' }).rec.depthM, UI.DEPTH_MAX_M, 'العمق مقصوص على عمق الصندوق');
});

test('result copy and depth text', () => {
  assert.equal(UI.resultCopy({ reason: 'won', lostCount: 0 }, true).tone, 'win');
  const f = UI.resultCopy({ reason: 'faint', lostCount: 4 }, false);
  assert.equal(f.tone, 'faint'); assert.match(f.sub, /4/);
  assert.match(UI.resultCopy({ reason: 'faint', lostCount: 0 }, false).sub, /نجوتَ/);
  assert.equal(UI.resultCopy({ reason: 'rope' }, true).tone, 'best');
  assert.equal(UI.resultCopy({ reason: 'surface' }, false).tone, 'safe');
  assert.equal(UI.depthText(52), '52 م');
  assert.equal(UI.depthText(-3), '0 م'); assert.equal(UI.depthText('x'), '0 م'); assert.equal(UI.depthText(7.9), '7 م');
});

test('the best depth ring scale is the chest depth, and the module is inert without a DOM', () => {
  assert.equal(UI.DEPTH_MAX_M, DD.CHEST_ROW * DD.METERS_PER_ROW);
  assert.equal(UI.init(), false, 'بلا document لا تهيئة');
  assert.equal(UI.active, false);
  assert.equal(UI.open(), false, 'لا يفتح وهو غير نشط (ولا يرمي)');
  const i = UI.inspect();
  assert.equal(i.active, false); assert.equal(i.phase, 'closed');
});

// ───────────────────────────── عقد الفن ─────────────────────────────
// الأبعاد من ترويسة WebP (VP8 / VP8L / VP8X) بلا مكتبات: إن تغيّر الأطلس أو الورقة تظهر بلاطات مقطوعة بصمت
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF'); assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const fmt = buf.toString('ascii', 12, 16);
  if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >>> 14) & 0x3fff) }; }
  throw new Error(`unknown WebP chunk ${fmt}`);
}

test('the art contract: the rock atlas has one square cell per layer, the hero sheet the 3x2 pose cells the renderer cuts, and every image the code asks for exists', () => {
  const dir = path.join(__dirname, '..', 'public', 'assets', 'cave');
  const read = (...p) => fs.readFileSync(path.join(dir, ...p));
  assert.deepEqual(webpSize(read('deep', 'rock-atlas.webp')), { w: Render.ATLAS_CELL * DD.LAYERS.length, h: Render.ATLAS_CELL }, 'one square cell per layer, in layer order');
  assert.deepEqual(webpSize(read('hero-sheet.webp')), { w: Render.HERO.cw * Render.HERO.cols, h: Render.HERO.ch * 2 }, 'the pose cells the renderer cuts out');
  assert.deepEqual(webpSize(read('icons', 'dive.webp')), { w: 192, h: 192 }, 'the medal icon size every painted medal uses');
  assert.deepEqual(Object.keys(Render.CELL), ['idle', 'walk1', 'walk2', 'raise', 'strike', 'cheer'], 'pose order of the sheet');
  assert.equal(Render.LAYER_FALLBACK.length, DD.LAYERS.length, 'a fallback colour per layer');
  assert.ok(fs.statSync(path.join(dir, 'deep', 'rock-atlas.webp')).size < 120_000, 'the whole atlas stays light (one request for five layers)');
  for (const file of ['deep-dig-ui.js', 'deep-dig-render.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
    for (const m of src.matchAll(/(\/assets\/cave\/[A-Za-z0-9_.\/-]+)\?v=(\d+)/g)) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', m[1])), `${file}: ${m[1]} exists`);
  }
});

// ───────────────────────────── ربط الأزرار ─────────────────────────────
// زر بلا معالج نقر = طريق مسدود للاعب (حدث فعلاً: البطاقة الأولى بلا خروج على اللمس). الـ DOM الوهمي لا ينقر، فنفرض الربط من المصدر.
test('every button in the dive window is wired to a click handler in init (no dead ends on a phone)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'deep-dig-ui.js'), 'utf8');
  const overlay = html.slice(html.indexOf('<div id="dd-overlay"'), html.indexOf('<!-- محرك الساحة المشترك'));
  const buttons = [...overlay.matchAll(/<button id="(dd-[a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(buttons.length >= 8, `found the window's buttons (${buttons})`);
  for (const id of buttons) {
    const key = (src.match(new RegExp(`(\\w+): \\$\\('${id}'\\)`)) || [])[1];
    assert.ok(key, `${id} is looked up by init`);
    assert.match(src, new RegExp(`els\\.${key}\\.addEventListener\\('click'`), `${id} (els.${key}) has a click handler`);
  }
  assert.ok(buttons.includes('dd-intro-back') && buttons.includes('dd-start'), 'the first card offers both "start" and a way back');
});

// ───────────────────────────── جودة الرسم تضبط سقف الجسيمات فعلاً ─────────────────────────────
test('the quality level really caps the particles (the cap table is not decoration)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'deep-dig-ui.js'), 'utf8');
  assert.match(src, /particles\.cap = CFG\.PARTICLES\[q\]/, 'applyQuality sets the cap');
  assert.match(src, /meter\.sample\(dt \* 1000\) !== before\) applyQuality\(meter\.level\)/, 'the automatic governor goes through it');
  assert.match(src, /setQuality\(q\) \{ meter\.set\(q\); applyQuality\(meter\.level\); draw\(\); \}/, 'and so does the test hook');
  const P = UI.createParticles(UI.CFG.PARTICLES[0]);
  for (let i = 0; i < 200; i++) P.add({ kind: 'dust', x: i, y: 0, life: 1 });
  assert.equal(P.list.length, UI.CFG.PARTICLES[0], 'the lowest level keeps the fewest particles');
  assert.ok(UI.CFG.PARTICLES[0] < UI.CFG.PARTICLES[1] && UI.CFG.PARTICLES[1] < UI.CFG.PARTICLES[2]);
});


// ───────────────────────────── آلات المنجم الحيّة ─────────────────────────────
test('deep-mine machinery: the drill upgrade adds a spinning tool and the robot relocates to the active dig tile', () => {
  const trace = (equipment, droneOn) => {
    const calls = [];
    const ctx = new Proxy({}, {
      get(_target, key) {
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
        if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
        return (...args) => { calls.push(String(key)); };
      },
      set(_target, key, value) { calls.push(`set:${String(key)}`); return true; },
    });
    const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    const canvas = { width: 0, height: 0, clientWidth: 320, clientHeight: 568, getContext: () => ctx };
    const renderer = Render.create({ canvas, doc, DD });
    renderer.resize(320, 568, 1, 2);
    const game = DD.create({ seed: 17, equipment });
    game.miner.state = 'dig';
    game.miner.dig = { col: 4, row: 1, t: 0.31, need: 1 };
    renderer.draw({ game, cam: -6, t: 2.4, particles: [], droneOn, shakeX: 0, shakeY: 0, digShake: 0, flash: 0, gold: 0 });
    return calls;
  };
  const base = trace({ drill: 0, robot: 0 }, false);
  const drill = trace({ drill: 1, robot: 0 }, false);
  const robot = trace({ drill: 1, robot: 1 }, true);
  assert.ok(drill.filter(x => x === 'rotate').length > base.filter(x => x === 'rotate').length,
    'the purchased drill adds a rotating mechanical head while the miner digs');
  assert.ok(robot.filter(x => x === 'rotate').length > drill.filter(x => x === 'rotate').length,
    'the robot rotors animate when the companion is active');
  assert.ok(robot.filter(x => x === 'lineTo').length > drill.filter(x => x === 'lineTo').length,
    'the working robot draws a beam to the tile being mined');
  assert.doesNotThrow(() => trace({ drill: 5, robot: 5 }, true), 'maximum equipment remains render-safe');
});
