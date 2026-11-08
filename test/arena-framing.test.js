// المرحلة A — تكوين الحلبة: الإطار والكاميرا وحجم المقاتلين.
//
// القياس قبل الإصلاح (بكسل حقيقي من المُصيِّر، لا تقدير): على 390×844 كان البطل 51px (6.0% من
// ارتفاع المسرح) والخصم 62px، والسماء 94%، والمقاتلان عند 10% و45% من العرض والكاميرا مقيّدة
// عند 0. السبب: عرض النافذة كان يُشتق من نسبة الشاشة (بحدّ 520 وحدة) فيصير ارتفاع العالم 1125.
//
// هذا الملف يقيس العقد الجديد سلوكياً (رياضيات إطار + رسم فعلي على سياق وهمي)، لا بنصوص المصدر.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/platform-rules');

globalThis.PlatformRules = R;
require('../public/platform-scenery.js');
require('../public/platform-bosses.js');
const T = require('../public/platform-telegraphs.js');
globalThis.PlatformTelegraphs = T;
const ArenaScene = require('../public/platform-arena-scene.js');
globalThis.PlatformArenaScene = ArenaScene;
require('../public/platform-renderer.js');
const Renderer = globalThis.PlatformRenderer;
const F = Renderer.ARENA_FRAME;

// سياق وهمي يتتبّع مصفوفة التحويل ويعيد كل نقطة إلى فضاء الجذر — لقياس أحجام الرسم فعلياً
function matrixCtx() {
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const pts = [];
  const ops = [];
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const add = (name, pairs) => {
    const root = pairs.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => at(p[0], p[1]));
    for (const p of root) pts.push(p);
    ops.push({ name, pts: root });
  };
  const grad = () => ({ addColorStop() {} });
  const api = {
    pts, ops,
    save() { stack.push(m.slice()); },
    restore() { if (stack.length) m = stack.pop(); },
    translate(x = 0, y = 0) { m = mul(m, [1, 0, 0, 1, x, y]); },
    scale(x = 1, y = 1) { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rotate(a = 0) { m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { m = [a, b, c, d, e, f]; },
    transform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { m = mul(m, [a, b, c, d, e, f]); },
    moveTo(x, y) { add('moveTo', [[x, y]]); },
    lineTo(x, y) { add('lineTo', [[x, y]]); },
    quadraticCurveTo(a, b, x, y) { add('quad', [[a, b], [x, y]]); },
    bezierCurveTo(a, b, c, d, x, y) { add('bezier', [[a, b], [c, d], [x, y]]); },
    arc(x, y, r) { add('arc', [[x - r, y - r], [x + r, y + r]]); },
    ellipse(x, y, rx, ry) { add('ellipse', [[x - rx, y - ry], [x + rx, y + ry]]); },
    rect(x, y, w, h) { add('rect', [[x, y], [x + w, y + h]]); },
    fillRect(x, y, w, h) { add('fillRect', [[x, y], [x + w, y + h]]); },
    strokeRect(x, y, w, h) { add('strokeRect', [[x, y], [x + w, y + h]]); },
    fill() {}, stroke() {}, clip() {},
    beginPath() {}, closePath() {}, setLineDash() {}, measureText: () => ({ width: 10 }),
    createLinearGradient: grad, createRadialGradient: grad, createPattern: () => null,
    drawImage() {}, fillText() {}, strokeText() {},
  };
  return new Proxy(api, {
    get(target, key) {
      if (key in target) return target[key];
      return () => undefined; // أي دالة رسم أخرى تُتجاهل بلا أثر
    },
    set() { return true; },
  });
}

const bbox = (pts) => pts.reduce((b, [x, y]) => ({
  minX: Math.min(b.minX, x), maxX: Math.max(b.maxX, x),
  minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y),
}), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

const duel = (zone = 1, seed = 4242) => R.create('miner', seed, { zone, mode: 'duel', loadout: {} });
const VIEWPORTS = [[390, 844], [390, 620], [360, 520], [430, 932], [800, 360]];

test('A: النافذة تكفي المقاتلين دائماً — فلا أحد يُقصّ عند أي مقاس أو مسافة', () => {
  for (const [W, H] of VIEWPORTS) {
    for (const sep of [40, 90, 150, 215, 320]) {
      const s = duel();
      s.player.x = 300;
      s.enemies[0].x = 300 + sep; // مسافة اللعب كما هي — نحرّك الخصم للنظر في أقصى الحالات
      const L = Renderer.arenaLayout(s, W, H);
      const pc = s.player.x + s.player.w / 2;
      const ec = s.enemies[0].x + s.enemies[0].w / 2;
      const leftPx = (pc - L.camera) / L.w, rightPx = (ec - L.camera) / L.w;
      for (const frac of [leftPx, rightPx]) {
        assert.ok(frac > 0.03 && frac < 0.97, `${W}×${H} sep=${sep}: fighter at ${(frac * 100).toFixed(1)}% is inside the frame`);
      }
      assert.ok(L.w >= Math.min(F.maxW, sep + s.player.w / 2 + s.enemies[0].w / 2 + 2 * F.margin) - 0.001,
        `${W}×${H} sep=${sep}: window ≥ pair + margins`);
    }
  }
});

test('A: المقاتلون أكبر بأشواط على كل مقاس، بلا قصّ ولا تمطيط', () => {
  const rows = [];
  for (const [W, H] of VIEWPORTS) {
    const s = duel();
    const L = Renderer.arenaLayout(s, W, H);
    // المقياس موحّد: نسبة العرض إلى الارتفاع في العالم تساوي نسبة الشاشة
    assert.ok(Math.abs(L.w / L.worldH - W / H) < 1e-9, `${W}×${H}: uniform scale (no stretching)`);
    // خط الأرض عند 82% من الارتفاع، وأرضية أمامية تحته
    assert.ok(Math.abs((360 - L.top) / L.worldH - F.groundAt) < 1e-9, `${W}×${H}: ground at ${F.groundAt * 100}%`);
    assert.ok(L.bottom > 360 + 8, `${W}×${H}: a foreground apron exists below the fight line`);
    // ارتفاع البطل على الشاشة: كان 6-9% في الرأسي و25% في الأفقي
    assert.ok(L.heroRatio >= 0.13, `${W}×${H}: hero is ${(L.heroRatio * 100).toFixed(1)}% of the stage (≥13%)`);
    assert.ok(L.heroRatio <= 0.40, `${W}×${H}: hero is not grotesquely large (≤40%)`);
    assert.ok(L.rivalRatio > L.heroRatio, 'the rival is drawn taller than the hero, as before');
    rows.push([`${W}×${H}`, (L.heroRatio * 100).toFixed(1)]);
  }
  assert.equal(rows.length, VIEWPORTS.length);
});

test('A: لا فراغ — السماء لا تبتلع المسرح على أي شاشة', () => {
  for (const [W, H] of VIEWPORTS) {
    const s = duel();
    const L = Renderer.arenaLayout(s, W, H);
    const sky = (292 - L.top) / L.worldH;       // من أعلى الإطار إلى خط الأفق
    const floor = (L.bottom - 292) / L.worldH;
    assert.ok(sky <= 0.72, `${W}×${H}: sky is ${(sky * 100).toFixed(1)}% (≤72%, was up to 94%)`);
    assert.ok(floor >= 0.28, `${W}×${H}: floor and apron are ${(floor * 100).toFixed(1)}% (≥28%)`);
    assert.ok(Math.abs(sky + floor - 1) < 1e-9, 'the two bands cover the frame exactly');
  }
});

test('A: الكاميرا تُوسّط المقاتلين وتتحرّك معهما بدل أن تُثبَّت عند الصفر', () => {
  const s = duel();
  const L = Renderer.arenaLayout(s, 390, 844);
  const mid = ((s.player.x + s.player.w / 2) + (s.enemies[0].x + s.enemies[0].w / 2)) / 2;
  assert.ok(Math.abs(L.camera + L.w / 2 - mid) < 0.001, 'the window centre sits on the pair midpoint');
  assert.notEqual(Math.round(L.camera), 0, 'and it is no longer pinned to 0');

  // تتحرّك مع الحركة: نفس المسافة، موضع مختلف ⇒ كاميرا مختلفة بنفس الإزاحة
  const s2 = duel();
  s2.player.x += 200; s2.enemies[0].x += 200;
  const L2 = Renderer.arenaLayout(s2, 390, 844);
  assert.ok(Math.abs((L2.camera - L.camera) - 200) < 0.001, 'the camera follows the fight by the same distance');
});

test('A: رسم المقاتل يكبر 1.3x مثبّتاً على القدمين (الرسم فقط لا الفيزياء)', () => {
  const s = duel();
  const ent = s.player;
  const draw = (scale) => {
    const c = matrixCtx();
    ArenaScene.fighter(c, ent, true, 30, true, 0, scale);
    return bbox(c.pts);
  };
  const one = draw(1), big = draw(F.fighterScale);
  assert.ok(Number.isFinite(one.minY) && Number.isFinite(big.minY), 'the fighter drew something');
  const h1 = one.maxY - one.minY, h2 = big.maxY - big.minY;
  assert.ok(h2 / h1 > 1.2 && h2 / h1 < 1.45, `drawn height grows by ${(h2 / h1).toFixed(2)}x (target ${F.fighterScale})`);
  // التكبير يدور حول القدمين: القمة ترتفع بالنسبة نفسها، والأسفل لا ينزل عن هالة التلامس
  const feet = ent.y + ent.h;
  const top1 = feet - one.minY, top2 = feet - big.minY;
  assert.ok(top2 / top1 > 1.2 && top2 / top1 < 1.45, 'the body grows upward from the feet');
  assert.ok(big.maxY - feet < 34, `nothing is drawn ${(big.maxY - feet).toFixed(0)}px below the ground line`);
  // والهيئة الفيزيائية لم تُمسّ
  assert.equal(ent.w, 24); assert.equal(ent.h, 38);
  assert.equal(duel().enemies[0].w, 44);
});

test('A: الإطار مملوء بالمحتوى — لا فراغ أعلى الشاشة ولا صف غير مرسوم', () => {
  for (const [W, H] of VIEWPORTS) {
    const s = duel();
    const L = Renderer.arenaLayout(s, W, H);
    const c = matrixCtx();
    ArenaScene.backdrop(c, L.w, 120, false, L.camera, 0, 0, L);

    // (١) لا صف غير مرسوم: تعبئة واحدة تغطّي من فوق الإطار إلى خط الأرض بكامل العرض
    const covered = c.ops.some((op) => {
      if (op.name !== 'fillRect') return false;
      const b = bbox(op.pts);
      return b.minY <= L.top + 1 && b.maxY >= 360 && (b.maxX - b.minX) >= L.w - 1;
    });
    assert.ok(covered, `${W}×${H}: a full-width fill covers the whole sky band (no unpainted row)`);

    // (٢) كل شريحة أفقية من الإطار فيها رسم: لا منطقة ميتة
    const slices = 10, bandTop = L.top, bandH = L.bottom - L.top;
    const filled = new Array(slices).fill(0);
    const shapes = c.ops.filter((op) => op.name !== 'fillRect');
    for (const op of shapes) {
      const b = bbox(op.pts);
      for (let i = 0; i < slices; i++) {
        const y0 = bandTop + (bandH * i) / slices, y1 = bandTop + (bandH * (i + 1)) / slices;
        if (b.maxY >= y0 && b.minY <= y1) filled[i]++;
      }
    }
    filled.forEach((n, i) => assert.ok(n >= 3, `${W}×${H}: slice ${i + 1}/${slices} has ${n} primitives (needs ≥3)`));

    // (٣) الثلث الأعلى فيه نجوم فعلاً (كان يُملأ بلون مسطّح)
    const band = 292 - L.top;
    const topStars = c.ops.filter((op) => {
      if (op.name !== 'arc') return false;
      const b = bbox(op.pts);
      const cy = (b.minY + b.maxY) / 2;
      return (b.maxX - b.minX) < 3.2 && cy > L.top && cy < L.top + band * 0.35;
    });
    assert.ok(topStars.length >= 5, `${W}×${H}: ${topStars.length} stars in the top third (needs ≥5)`);
  }
});

test('A: المنجم خارج الحلبة لا يمرّ بالمسار الجديد', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'platform-renderer.js'), 'utf8');
  const body = src.slice(src.indexOf('function draw(canvas, s, opts'), src.indexOf('root.PlatformRenderer ='));
  // كل استخدامات إطار الحلبة مشروطة بـ arena / arenaMode
  const arenaUses = (body.match(/ARENA_FRAME\./g) || []).length;
  const guarded = (body.match(/arena(?:Mode)? ?\?|arena &&|if \(arena\)/g) || []).length;
  assert.ok(arenaUses > 0 && guarded > 0);
  assert.match(body, /const camera = arena \? arenaCamera\(s, arena\) : R\.cameraFor\(s, w\);/, 'the mine keeps R.cameraFor');
  assert.match(body, /arenaMode && ArenaScene && ArenaScene\.fighter/, 'fighter scaling only runs on the arena canvas');
});
