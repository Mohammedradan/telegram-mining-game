// V19.1 (D1): لا تقاطع بين الأدوات العائمة أعلى مسرح الساحة وشريط حالة المسرح (.as-hud).
//
// المشكلة المثبَتة بلقطة جهاز (2026-11-07): صفّ الشرائح «التبويبات/المزيد» عند top:8px وزرّ
// «ابدأ المبارزة» + الإحصاء عند top:8px يغطّون شريط الحالة المُثبَّت عند top:6px، فتُغطّى
// أسماء المقاتلين وأشرطة الصحة — وأثناء المبارزة كانت الشرائح ستغطّي أشرطة الصحة نفسها.
//
// هذا الملف يحرس الإصلاح فقط: لا شكل حلبة ولا كاميرا ولا اقتصاد ولا قواعد قتال.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'app-shell.css'), 'utf8');
const renderer = fs.readFileSync(path.join(ROOT, 'public', 'platform-renderer.js'), 'utf8');
const rules = fs.readFileSync(path.join(ROOT, 'public', 'platform-rules.js'), 'utf8');

const px = (re, src = html) => {
  const m = src.match(re);
  assert.ok(m, `لم يُعثر على ${re}`);
  return Number(m[1]);
};

test('قبل المبارزة: شريط الحالة ينزل تحت صف الأدوات (ولا يخرج من وضع المزيد)', () => {
  assert.match(
    css,
    /body\.arena-live:not\(\.arena-more\):not\(\.duel-live\) #arena-stage \.as-hud \{ top: 52px; \}/,
    'as-hud is pushed below the floating chips before the duel only'
  );
  // الصيغة الافتراضية تبقى كما هي (تُستخدم في المبارزة وفي وضع المزيد)
  assert.match(css, /\.as-hud \{\s*position: absolute; inset: 6px 8px auto 8px;/, 'the default as-hud placement is untouched');
});

test('الهندسة: ارتفاع زر البدء + هامشه لا يصل إلى موضع شريط الحالة', () => {
  const btnMin = px(/body\.arena-live:not\(\.arena-more\) #tab-arena > \.as-bar \.arena-duel-btn \{[^}]*min-height: (\d+)px/, css);
  const top = px(/body\.arena-live:not\(\.arena-more\) #tab-arena > \.as-bar \{\s*position: absolute; top: (\d+)px/);
  const hudTop = px(/body\.arena-live:not\(\.arena-more\):not\(\.duel-live\) #arena-stage \.as-hud \{ top: (\d+)px; \}/);
  const bottom = top + btnMin; // أسفل الزر/الإحصاء يمين الشاشة
  assert.ok(hudTop > bottom, `شريط الحالة (${hudTop}px) يجب أن يبدأ تحت أسفل الأدوات (${bottom}px) بفاصل مرئي`);
  assert.ok(hudTop - bottom >= 2, 'فاصل لا يقلّ عن 2px حتى لا يبدو ملتصقاً');
  // وصفّ الشرائح يسار المسرح بالحساب نفسه
  const chipMin = px(/\.arena-x-bar button \{[^}]*min-height: (\d+)px/);
  const chipTop = px(/body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-x-bar \{\s*position: absolute; top: (\d+)px/);
  assert.ok(hudTop > chipTop + chipMin, `شريط الحالة (${hudTop}px) يجب أن يبدأ تحت صف الشرائح (${chipTop + chipMin}px)`);
});

test('أثناء المبارزة: الشرائح تُخفى فيبقى شريط الحالة وأشرطة الصحة مكشوفة', () => {
  assert.match(css, /body\.duel-live #arena-x-bar \{ display: none; \}/, 'the chip row leaves the stage during a duel');
  // وأثناء المبارزة لا يُطبَّق إزاحة شريط الحالة (المسرح أقصر) — الشريحة مستثناة صراحةً أعلاه
  assert.doesNotMatch(css, /body\.duel-live #arena-stage \.as-hud \{ top:/, 'as-hud keeps its default spot in duels');
});

test('عناصر التحكم الضرورية أثناء المبارزة باقية ومرئية', () => {
  // شريط المبارزة (إيقاف/انسحاب) يظهر في الوضع الحيّ
  assert.match(css, /body\.duel-live \.arena-fs-bar \{ display: flex; \}/, 'the pause/abandon bar still shows during a duel');
  assert.match(html, /id="arena-fs-pause"/, 'pause button markup exists');
  assert.match(html, /id="arena-fs-exit"/, 'abandon button markup exists');
  // وزر البدء/الإحصاء يختفي في المبارزة (قاعدة قديمة) فلا يتقاطع مع شريط صحة الخصم
  assert.match(css, /body\.duel-live \.as-bar,/, 'the start pill/record row is hidden during a duel');
  // لوحة اللمس تبقى كما هي
  assert.match(css, /body\.duel-live #arena-pad \{/, 'the touch pad keeps its duel rules');
});

test('المسرح يبقى مِلء الشاشة، وتكوينه وحده تغيّر في المرحلة A', () => {
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-stage \{\s*position: absolute; inset: 0;/, 'the full-bleed stage rule is unchanged');
  // المرحلة A: التكوين صار من المقاتلين (كان مثبّتاً على نسبة الشاشة) — الحلبة فقط، المنجم كما هو.
  assert.match(renderer, /function arenaLayout\(state, cssW, cssH\)/, 'arena framing is a function of the fighters');
  assert.match(renderer, /const camera = arena \? arenaCamera\(s, arena\) : R\.cameraFor\(s, w\);/, 'the arena pans, the mine keeps its camera');
  assert.match(renderer, /fighterScale: 1\.3,/, 'fighters are drawn 1.3x larger (visual only)');
  assert.match(renderer, /const yTop = arena \? ARENA_FRAME\.groundAt \* pixelH - 360 \* sy/, 'the floor is pinned by the new frame');
});

test('لا مساس بقواعد القتال ولا الاقتصاد', () => {
  assert.match(rules, /reward: 60, rewardStep: 4/, 'duel reward unchanged');
  assert.match(rules, /rival: Object\.freeze\(\{ id: 80, w: 44, h: 64, hp: 34, hpPerZone: 6/, 'rival stats unchanged');
  assert.match(rules, /heartsFor: hero => hero\.hearts \+ 1/, 'arena hearts rule unchanged');
});
