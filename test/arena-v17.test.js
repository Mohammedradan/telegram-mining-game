// V17: تبويب الساحة = شاشة اللعبة. المسرح يأخذ المساحة كلها، والهيدر وشريط التنقّل وما تحت
// المسرح تختفي — بلا حذف: «التبويبات» تُعيد الواجهة و«المزيد» يُعيد اللوحات.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = html.slice(html.indexOf('/* ===== V17'), html.indexOf('</style>'));

test('زرّان داخل تبويب الساحة: التبويبات والمزيد', () => {
  const start = html.indexOf('<div id="arena-x-bar"');
  assert.ok(start > 0, 'the arena screen bar exists');
  const bar = html.slice(start, html.indexOf('</div>', start));
  assert.match(bar, /id="arena-tabs-btn"[^>]*>التبويبات</, 'a button that restores the header and the tab bar');
  assert.match(bar, /id="arena-more-btn"[^>]*aria-pressed="false"[^>]*>المزيد</, 'and a toggle that brings back the panels');
  // داخل #tab-arena (بعد شريط المبارزة الكاملة)
  const tabStart = html.indexOf('id="tab-arena"');
  assert.ok(tabStart < start && start < html.indexOf('</main>', tabStart), 'it lives inside the arena tab');
});

test('الشاشة للعبة: الهيدر والذهب وشريط التنقّل تختفي في الساحة', () => {
  assert.match(css, /body\.arena-live \.app-header,/, 'the header is hidden');
  assert.match(css, /body\.arena-live \.ck-hud,/, 'so is the gold/balance HUD');
  assert.match(css, /body\.arena-live \.bottom-nav \{ display: none !important; \}/, 'and the bottom tab bar — this is what frees the height');
  assert.match(css, /body\.arena-live \.arena-x-bar \{[\s\S]*?display: flex;/, 'the two chips are the only chrome left');
});

test('عمود واحد على أي عرض: شبكة العمودين (V15) لا تُطبَّق في وضع الشاشة الكاملة', () => {
  assert.match(css, /body\.arena-live #tab-arena\.active \{\s*\n\s*display: flex; flex-direction: column;/, 'the two-column grid is explicitly overridden');
  const wideRule = html.indexOf('body:not(.duel-live) #tab-arena.active {');
  const v17Rule = html.indexOf('body.arena-live #tab-arena.active {');
  assert.ok(wideRule > 0 && v17Rule > wideRule, 'the override comes later in the stylesheet, so it wins the tie');
});

test('المسرح يأخذ كل الارتفاع بدل نسبة ثابتة', () => {
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-stage \{[^}]*flex: 1 1 auto; min-height: 0/, 'the stage grows into the freed space');
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-stage \{[^}]*aspect-ratio: auto/, 'no fixed 16:9 box in this mode');
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-stage \{[^}]*max-height: none/, 'and the old vh cap is lifted');
});

test('كل ما تحت المسرح يختفي، ويعود بـ«المزيد»', () => {
  for (const sel of ['#arena-ladder', '#arena-gear', '#arena-advice', '.arena-shots', '#classic-system', '.arena-keyhint', '#arena-pad-mode']) {
    assert.ok(css.includes(`body.arena-live:not(.arena-more) #tab-arena > ${sel}`), `${sel} is hidden in the game-only screen`);
  }
  assert.match(css, /body\.arena-live\.arena-more #tab-arena\.active \{ overflow-y: auto; \}/, 'the more-view scrolls instead of clipping');
  assert.match(css, /body\.arena-live\.arena-more #tab-arena > #arena-stage \{[^}]*aspect-ratio: 16 \/ 9/, 'and the stage goes back to its normal ratio so the lists are readable');
});

test('التبديل مربوط فعلاً: يفتح مع الساحة ويُغلق بزرّ «التبويبات»', () => {
  assert.match(html, /document\.body\.classList\.toggle\('arena-live', tabId === 'arena'\)/, 'the tab switcher owns the mode');
  assert.match(html, /arena-tabs-btn'\)\?\.addEventListener\('click', \(\) => \{\s*\n\s*document\.body\.classList\.remove\('arena-live', 'arena-more'\)/, 'the tabs chip drops both classes');
  assert.match(html, /arena-more-btn'\)\?\.addEventListener\('click',[\s\S]{0,200}setAttribute\('aria-pressed'/, 'the more chip keeps its pressed state honest');
  assert.match(html, /if \(tabId !== 'arena'\) \{\s*\n\s*document\.body\.classList\.remove\('arena-more'\)/, 'leaving the arena clears the more-view too');
});

test('أثناء المبارزة يبقى شريط المبارزة الكاملة فقط — الشاشتان لا تتزاحمان', () => {
  assert.match(html, /body\.duel-live #tab-arena > \*:not\(#arena-stage\):not\(#arena-pad\):not\(#arena-duel-status\):not\(#arena-fs-bar\) \{ display: none !important; \}/, 'the duel still hides every child except its four');
  assert.ok(!/duel-live[^}]*arena-x-bar/.test(html), 'and nothing re-enables the arena chips during a duel');
});
