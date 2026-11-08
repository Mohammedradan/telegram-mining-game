// تكوين الساحة (المرحلة A/B): اختبار حقيقي لمنظور الكاميرا بلا متصفح.
// الدرس الذي كشفته لقطات المتصفح: خلفية الحلبة تُرسم في فضاء الشاشة بإزاحة الكاميرا الخاصة بها،
// أما المقاتلان فيُحدثان في فضاء العالم — فإذا لم تُطبَّق `translate(-camera)` على العالم انفصل
// موضع المقاتلَين عن المنصّة وخرجا من الكادر. هذا الاختبار يثبّت العقد: الخلفية بلا إزاحة،
// والعالم (المقاتلان) بإزاحة كاملة، والمقاتلان داخل الكادر دائماً.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../public/platform-rules');

const ROOT = path.join(__dirname, '..');
const NEAR = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// قماش وهمي يحفظ تحويلاً متراكماً (بلا دوران) كي نقرأ أين رُسم كل شيء فعلاً.
function harness(cssW, cssH) {
  const stack = [{ a: 1, d: 1, e: 0, f: 0 }];
  const cur = () => stack[stack.length - 1];
  const gradient = { addColorStop() {} };
  const canvas = { clientWidth: cssW, clientHeight: cssH, width: cssW, height: cssH, getContext: () => ctx };
  const ctx = new Proxy({}, {
    get(target, key) {
      const k = String(key);
      if (key === 'canvas') return canvas;
      if (key === 'measureText') return () => ({ width: 10 });
      if (/^create(Linear|Radial|Conic)Gradient$|^createPattern$/.test(k)) return () => gradient;
      if (k === 'save') return () => stack.push({ ...cur() });
      if (k === 'restore') return () => { if (stack.length > 1) stack.pop(); };
      if (k === 'translate') return (x, y = 0) => { const m = cur(); m.e += x * m.a; m.f += y * m.d; };
      if (k === 'scale') return (x, y = x) => { const m = cur(); m.a *= x; m.d *= y; };
      if (k === 'setTransform') return (a, b, c, d, e, f) => { stack[stack.length - 1] = { a, d, e, f }; };
      if (k === 'getTransform') return () => ({ ...cur() });
      if (k === 'setLineDash' || k === 'getLineDash') return () => [];
      if (typeof key === 'string' && target[key] !== undefined) return target[key];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { canvas, ctx };
}

function drawArena({ cssW = 374, cssH = 828, heroX = 230, rivalX = 380 } = {}) {
  const { canvas } = harness(cssW, cssH);
  const seen = [];
  const scene = {
    // خلفية الحلبة: تُرسم في فضاء الشاشة وتتولّى إزاحة الكاميرا بنفسها (parallax)
    backdrop: (c) => seen.push({ who: 'backdrop', m: c.getTransform() }),
    fighter: (c, ent, isPlayer) => seen.push({ who: isPlayer ? 'hero' : 'rival', m: c.getTransform(), ent }),
  };
  const sandbox = {
    PlatformRules: R,
    PlatformArenaScene: scene,
    devicePixelRatio: 1,
    Math, Date, console,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['platform-scenery.js', 'platform-bosses.js', 'platform-renderer.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', file), 'utf8'), sandbox);
  }
  const renderer = sandbox.PlatformRenderer;
  assert.ok(renderer, 'the renderer registers itself');

  const sim = R.create('miner', 909, { zone: 0, mode: 'duel' });
  sim.player.x = heroX;
  sim.player.vx = 0;
  sim.enemies[0].x = rivalX;
  sim.enemies[0].vx = 0;
  renderer.draw(canvas, sim, { arena: true, reduced: true, beams: [] });
  const layout = renderer.arenaLayout(sim, cssW, cssH);
  return { seen, layout, sim, cssW, cssH };
}

test('كادر الساحة: الخلفية تُرسم بلا إزاحة، والمقاتلان بإزاحة الكاميرا الكاملة', () => {
  const { seen, layout, cssW } = drawArena();
  const back = seen.find((x) => x.who === 'backdrop');
  const hero = seen.find((x) => x.who === 'hero');
  const rival = seen.find((x) => x.who === 'rival');
  assert.ok(back && hero && rival, 'الخلفية والمقاتلان كلهم مرسومون');

  const scale = cssW / layout.w;
  assert.ok(NEAR(back.m.a, scale, 0.001), 'مقياس الخلفية = مقياس الكادر');
  assert.ok(NEAR(back.m.e, 0, 0.001), 'الخلفية لا تُزاح داخل العالم (تتولّى الكاميرا بنفسها)');
  assert.ok(NEAR(hero.m.a, scale, 0.001) && NEAR(rival.m.a, scale, 0.001), 'العالم يستخدم مقياس الكادر نفسه');
  assert.ok(NEAR(hero.m.e, -layout.camera * scale, 0.5), 'إزاحة العالم = -camera × scale (البطل)');
  assert.ok(NEAR(rival.m.e, hero.m.e, 0.5), 'المقاتلان في فضاء واحد (نفس الإزاحة)');
});

test('كادر الساحة: المقاتلان داخل الإطار دوماً — لا يخرج أحدهما عند تحرّك الكاميرا', () => {
  const cases = [
    { cssW: 374, cssH: 828, heroX: 230, rivalX: 380 }, // هاتف 390×844
    { cssW: 304, cssH: 796, heroX: 230, rivalX: 380 }, // 320×568
    { cssW: 806, cssH: 352, heroX: 230, rivalX: 380 }, // 844×390 أفقياً
    { cssW: 940, cssH: 612, heroX: 60, rivalX: 470 },  // سطح مكتب — متباعدان
    { cssW: 374, cssH: 828, heroX: 300, rivalX: 330 }, // متلاصقان (اندفاع)
  ];
  for (const c of cases) {
    const { seen, layout } = drawArena(c);
    const scale = c.cssW / layout.w;
    for (const who of ['hero', 'rival']) {
      const rec = seen.find((x) => x.who === who);
      const cx = rec.ent.x + rec.ent.w / 2;
      const screenX = rec.m.e + cx * rec.m.a;
      assert.ok(screenX > 0 && screenX < c.cssW, `${who} داخل الإطار عند ${c.cssW}×${c.cssH} (x=${Math.round(screenX)})`);
      assert.ok(NEAR(rec.m.a, scale, 0.001), `${who} بمقياس الكادر عند ${c.cssW}×${c.cssH}`);
    }
    const hx = seen.find((x) => x.who === 'hero');
    const rx = seen.find((x) => x.who === 'rival');
    assert.ok(hx.m.e + (hx.ent.x + hx.ent.w / 2) * hx.m.a < rx.m.e + (rx.ent.x + rx.ent.w / 2) * rx.m.a + 1,
      'البطل على يسار الخصم في كل المقاسات');
  }
});

test('كادر الساحة: الإطار يبقى متمركزاً على المقاتلَين (لا كاميرا ثابتة عند 0)', () => {
  const { layout, sim } = drawArena({ heroX: 230, rivalX: 380 });
  const pc = sim.player.x + sim.player.w / 2;
  const ec = sim.enemies[0].x + sim.enemies[0].w / 2;
  assert.ok(NEAR(layout.camera, (pc + ec) / 2 - layout.w / 2, 0.001), 'الكاميرا تُوسّط المقاتلَين');
  assert.ok(layout.w >= 200 && layout.w <= 760, 'عرض النافذة داخل الحدود المصمّمة');
  assert.ok(layout.worldH >= 300, 'لا سحق رأسٍ للمشهد');
});
