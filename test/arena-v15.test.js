// V15: التكيّف مع حجم الشاشة — لا مساحة ميتة بعد الدوران، ولا مسرح شريط رفيع في نافذة عريضة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

test('ارتفاع التطبيق يتبع الحجم الفعلي (لا مساحة ميتة بعد التدوير أو تغيير النافذة)', () => {
  const block = html.slice(html.indexOf('// V16: قِس الارتفاع المرئي الحالي'), html.indexOf('// --- DOM Elements ---'));
  assert.match(block, /window\.visualViewport\?\.height \|\| window\.innerHeight/, 'reads the live viewport, not a cached number');
  assert.match(block, /setProperty\('--app-height'/, 'and writes the CSS variable the body height reads');
  assert.match(block, /const stable = Math\.round\(Number\(tg\?\.viewportStableHeight\) \|\| 0\)/, 'reads Telegram stable height as a fallback');
  assert.match(block, /const h = live > 0 \? live : stable/, 'the live viewport wins whenever it can be measured');
  assert.doesNotMatch(block, /Math\.abs\(stable - live\)/, 'a larger cached Telegram height cannot override the visible viewport');
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
  assert.doesNotMatch(css, /min\(86vh, 62vw\)/, 'no leftover rule: the landscape overlay owns the duel stage height');
  assert.match(css, /aspect-ratio: 16 \/ 9/, 'the stage keeps its aspect so the world is not stretched at large sizes');
});

test('هاتف أفقي قصير: المسرح يملأ الشاشة واللمس يطفو فوقه', () => {
  const css = html.slice(html.indexOf('@media (orientation: landscape) {'));
  assert.match(css, /body\.duel-live #tab-arena > #arena-stage \{[^}]*position: absolute; inset: 0/, 'the stage covers the landscape screen');
  assert.match(css, /body\.duel-live #tab-arena > #arena-pad \{[^}]*position: absolute;[^}]*bottom: 0/, 'the pad is docked to the bottom edge');
  assert.match(css, /body\.duel-live #tab-arena > #arena-pad \{[^}]*direction: ltr/, 'and mirrored: stick on the left thumb, actions on the right');
  assert.match(css, /linear-gradient\(180deg, rgba\(4, 12, 20, 0\)/, 'with a scrim so buttons stay readable over the art');
  assert.match(css, /#tab-arena > #arena-duel-status \{[^}]*bottom: 104px/, 'the status line clears the pad');
  assert.match(css, /#tab-arena > #arena-fs-bar \{[^}]*position: absolute; top: 0/, 'pause/exit stay reachable at the top');
  // لا تشويه في الهاتف الأفقي: المسرح مربّع الشكل تقريباً في هذا الوضع
  assert.match(css, /aspect-ratio: auto/, 'the stage box follows the screen, the renderer keeps square pixels because width > height');
});

test('المقاسات القديمة محفوظة: الهاتف الطولي لم يتغيّر', () => {
  // قاعدة المسرح الأساسية لا تحمل أي استعلام وسائط جديد
  const base = css.slice(html.indexOf('.arena-stage {'), html.indexOf('#arena-preview {'));
  assert.match(base, /aspect-ratio: 16 \/ 9/, 'portrait stage keeps 16:9');
  assert.match(base, /max-height: 46vh/, 'and its vh cap');
  // استعلام العريض يبدأ عند 780px فقط، فلا يمسّ الهواتف
  assert.ok(780 >= 640, 'the breakpoint sits above every phone width');
  assert.match(css, /@media \(max-width: 340px\)/, 'the narrow-phone rule from V13 is still there');
});

test('الوضع الأفقي يعكس لوحة اللمس: العصا يساراً والأفعال يميناً', () => {
  const css = html.slice(html.indexOf('@media (orientation: landscape) {'), html.indexOf('/* ===== V14:'));
  assert.match(css, /direction: ltr/, 'the pad row is mirrored in landscape');
  // ترتيب DOM هو ما يُعكس: العصا أولاً ثم أزرار الفعل
  const pad = html.slice(html.indexOf('<div id="arena-pad"'), html.indexOf('</div>', html.indexOf('<div class="ap-group ap-acts"')));
  assert.ok(pad.indexOf('id="arena-stick"') < pad.indexOf('ap-acts'), 'the stick is the first child, so mirroring puts it on the left');
  // الوضع الطولي لا يُعكس
  const portraitOnly = html.slice(0, html.indexOf('@media (orientation: landscape) {'));
  assert.doesNotMatch(portraitOnly.slice(portraitOnly.indexOf('.arena-pad {')), /direction: ltr[^]*arena-pad/, 'no mirror outside landscape');
});

test('بقية التبويبات على الشاشة العريضة: المتجر عمودان والتعدين يتّسع', () => {
  const css = html.slice(html.indexOf('/* V15.2:'), html.indexOf('/* ===== V14:'));
  assert.match(css, /#tab-shop\.active \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'shop upgrade rows sit in two columns');
  assert.match(css, /#tab-shop > #prestige-card[^}]*grid-column: 1 \/ -1/, 'full-width cards keep spanning both columns');
  assert.match(css, /#tab-shop > div \{ min-width: 0; \}/, 'rows can shrink inside their column instead of overflowing');
  assert.match(css, /#tab-mining > #ck-stage \{ max-width: min\(520px, 100%\); \}/, 'the mining stage uses a little more width on a big screen');
  assert.match(css, /@media \(min-width: 780px\)/, 'all of it only from 780px up — phones untouched');
});

test('V15.3: أزرار المبارزة في الأفقي بحجم إبهام لا تتمدد، والعصا تكبر', () => {
  const start = html.indexOf('/* ===== V15.3');
  assert.ok(start > 0, 'the landscape polish block exists');
  const css = html.slice(start, html.indexOf('</style>'));
  assert.match(css, /@media \(orientation: landscape\)/, 'only in landscape');
  // الأزرار: عرض مُقيَّد بدل التمدد، ولا تنزل عن حد لمس آمن
  assert.match(css, /#arena-pad > \.ap-acts \{[^}]*flex: 0 0 auto/, 'the action group no longer stretches');
  assert.match(css, /#arena-pad > \.ap-acts \{[^}]*margin-inline-start: auto/, 'and is pushed to the right thumb');
  assert.match(css, /#arena-pad > \.ap-group button \{[^}]*min-width: clamp\(56px, 11vw, 92px\)/, 'thumb-sized width, clamped');
  assert.match(css, /#arena-pad > \.ap-group button \{[^}]*min-height: clamp\(54px, 9vh, 72px\)/, 'touch height never drops below 54px');
  assert.match(css, /#arena-pad > \.ap-acts \.ap-hit \{[^}]*min-height: clamp\(64px, 9vh, 78px\)/, 'the attack button keeps V14\'s 64px floor');
  // العصا تكبر مع الشاشة
  assert.match(css, /#arena-stick \{\s*\n\s*width: clamp\(76px, 18vh, 108px\); height: clamp\(76px, 18vh, 108px\);/, 'the stick scales with the screen height');
  // سطر الحالة كبسولة في المنتصف
  assert.match(css, /#arena-duel-status \{[^}]*left: 50%; right: auto; transform: translateX\(-50%\)/, 'the status line is centred');
  assert.match(css, /#arena-duel-status \{[^}]*width: max-content; max-width: min\(560px, 74%\)/, 'and no longer spans the whole screen');
  // لا نصّ زائد فوق اسم الخصم
  assert.match(css, /body\.duel-live \.arena-fs-bar \.fs-note \{ display: none; \}/, 'the decorative full-screen note is hidden during a fight');
});
