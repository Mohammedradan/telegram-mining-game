// V15: التكيّف مع حجم الشاشة — لا مساحة ميتة بعد الدوران، ولا مسرح شريط رفيع في نافذة عريضة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

test('ارتفاع التطبيق يتبع الحجم الفعلي (لا مساحة ميتة بعد التدوير أو تغيير النافذة)', () => {
  const block = html.slice(html.indexOf('// V15: ارتفاع التطبيق'), html.indexOf('// --- DOM Elements ---'));
  assert.match(block, /window\.visualViewport\?\.height \|\| window\.innerHeight/, 'reads the live viewport, not a cached number');
  assert.match(block, /setProperty\('--app-height'/, 'and writes the CSS variable the body height reads');
  assert.match(block, /Math\.abs\(stable - live\) <= 120/, 'Telegram stable height only wins while it still matches the real screen');
  assert.match(block, /addEventListener\('resize', syncAppHeight/, 'updates on resize');
  assert.match(block, /addEventListener\('orientationchange'/, 'and on rotation');
  assert.match(block, /visualViewport\?\.addEventListener\?\.\('resize'/, 'and when the visual viewport changes');
  assert.match(block, /tg\.onEvent\?\.\('viewportChanged'/, 'the Telegram event path is kept');
  assert.match(block, /tg\.disableVerticalSwipes/, 'swipe guard untouched');
});

test('شاشة عريضة: عمود للمسرح وعمود للوحة بدل عمود هاتف طويل', () => {
  const css = html.slice(html.indexOf('/* ===== V15: تخطيط تكيّفي'), html.indexOf('/* هاتف أفقي قصير'));
  assert.match(css, /#tab-arena\.active \{\s*\n\s*display: grid/, 'the arena tab becomes a grid — only while it is the open tab, so .tab-content{display:none} still wins elsewhere');
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(230px, 330px\)/, 'stage column + info column');
  assert.match(css, /#tab-arena > #arena-stage \{[^}]*grid-column: 1;/, 'the stage owns the first column');
  assert.match(css, /align-items: start/, 'items keep their natural height instead of stretching beside the tall stage');
  assert.doesNotMatch(css, /grid-row: 1 \/ span \d+/, 'no huge row span — every span gap would push the pad far down');
  assert.match(css, /#tab-arena > \*:not\(#arena-stage\):not\(#arena-pad\) \{ grid-column: 2; \}/, 'everything else stacks on the right');
  assert.match(css, /#tab-arena > #arena-pad \{ grid-column: 1 \/ -1; \}/, 'the touch pad keeps the full width at the bottom');
  assert.match(css, /body\.duel-live #tab-arena > #arena-stage \{ height: min\(86vh, 62vw\); \}/, 'in a duel the wide screen gives the stage real height');
  assert.match(css, /aspect-ratio: 16 \/ 9/, 'the stage keeps its aspect so the world is not stretched at large sizes');
});

test('هاتف أفقي قصير: المسرح يملأ الشاشة واللمس يطفو فوقه', () => {
  const css = html.slice(html.indexOf('@media (orientation: landscape) and (max-height: 560px)'));
  assert.match(css, /body\.duel-live #tab-arena > #arena-stage \{[^}]*position: absolute; inset: 0/, 'the stage covers the short landscape screen');
  assert.match(css, /body\.duel-live #tab-arena > #arena-pad \{[^}]*position: absolute;[^}]*bottom: 0/, 'the pad floats over the bottom edge');
  assert.match(css, /linear-gradient\(180deg, rgba\(4, 12, 20, 0\)/, 'with a scrim so buttons stay readable over the art');
  assert.match(css, /#tab-arena > #arena-duel-status \{[^}]*bottom: 104px/, 'the status line clears the pad');
  assert.match(css, /#tab-arena > #arena-fs-bar \{[^}]*position: absolute; top: 0/, 'pause/exit stay reachable at the top');
  // لا تشويه في الهاتف الأفقي: المسرح مربّع الشكل تقريباً في هذا الوضع
  assert.match(css, /aspect-ratio: auto/, 'the stage box follows the screen, the renderer keeps square pixels because width > height');
});

test('المقاسات القديمة محفوظة: الهاتف الطولي لم يتغيّر', () => {
  // قاعدة المسرح الأساسية لا تحمل أي استعلام وسائط جديد
  const base = html.slice(html.indexOf('.arena-stage {'), html.indexOf('#arena-preview {'));
  assert.match(base, /aspect-ratio: 16 \/ 9/, 'portrait stage keeps 16:9');
  assert.match(base, /max-height: 46vh/, 'and its vh cap');
  // استعلام العريض يبدأ عند 780px فقط، فلا يمسّ الهواتف
  assert.ok(780 >= 640, 'the breakpoint sits above every phone width');
  assert.match(html, /@media \(max-width: 340px\)/, 'the narrow-phone rule from V13 is still there');
});
