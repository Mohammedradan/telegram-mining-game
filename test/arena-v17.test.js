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

test('المسرح ملء الشاشة داخل التبويب، والأدوات تطفو أعلى المسرح', () => {
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena\.active \{[^}]*position: relative; display: block/, 'the tab becomes a positioning frame with no stacked rows');
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-stage \{[^}]*position: absolute; inset: 0/, 'the stage covers the whole tab');
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-x-bar \{[^}]*position: absolute; top: 8px; left: 8px/, 'the chips float in the sky (left)');
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > \.as-bar \{[^}]*position: absolute; top: 8px; right: 8px/, 'the start button floats in the sky (right) — never over the fighters');
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > \.as-bar \.arena-duel-btn \{[^}]*min-height: 40px/, 'and shrinks to a compact pill so it does not eat the frame');
  const wideRule = html.indexOf('body:not(.duel-live) #tab-arena.active {');
  const v17Rule = html.indexOf('body.arena-live:not(.arena-more) #tab-arena.active {');
  assert.ok(wideRule > 0 && v17Rule > wideRule, 'the two-column grid (V15) is overridden later in the file, so it loses the tie');
});

test('لا نسبة 16:9 ولا سقف ارتفاع في وضع الشاشة الكاملة', () => {
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-stage \{[^}]*aspect-ratio: auto/, 'no fixed 16:9 box in this mode');
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-stage \{[^}]*max-height: none/, 'and the old vh cap is lifted');
  assert.match(css, /body\.arena-live:not\(\.arena-more\) #tab-arena > #arena-stage \{[^}]*border: 0; border-radius: 0/, 'full-bleed: no card border/rounding');
});

test('كل ما تحت المسرح يختفي، ويعود بـ«المزيد»', () => {
  for (const sel of ['#arena-ladder', '#arena-gear', '#arena-advice', '.arena-shots', '#classic-system', '.arena-keyhint', '#arena-pad-mode']) {
    assert.ok(css.includes(`body.arena-live:not(.arena-more) #tab-arena > ${sel}`), `${sel} is hidden in the game-only screen`);
  }
  assert.match(css, /body\.arena-live\.arena-more #tab-arena\.active \{[^}]*overflow-y: auto/, 'the more-view scrolls instead of clipping');
  assert.match(css, /body\.arena-live\.arena-more #tab-arena > #arena-stage \{[^}]*position: relative; inset: auto;[^}]*aspect-ratio: 16 \/ 9/, 'and the stage returns to the normal flow with its 16:9 box so the lists are readable');
  assert.match(css, /body\.arena-live\.arena-more #tab-arena > #arena-x-bar,\s*\n\s*body\.arena-live\.arena-more #tab-arena > \.as-bar \{ position: static; max-width: none; \}/, 'the floating tools drop back into the flow');
});

test('التبديل مربوط فعلاً: يفتح مع الساحة ويُغلق بزرّ «التبويبات»', () => {
  assert.match(css, /document\.body\.classList\.toggle\('arena-live', tabId === 'arena'\)/, 'the tab switcher owns the mode');
  assert.match(css, /arena-tabs-btn'\)\?\.addEventListener\('click', \(\) => \{\s*\n\s*document\.body\.classList\.remove\('arena-live', 'arena-more'\)/, 'the tabs chip drops both classes');
  assert.match(html, /arena-more-btn'\)\?\.addEventListener\('click',[\s\S]{0,200}setAttribute\('aria-pressed'/, 'the more chip keeps its pressed state honest');
  assert.match(css, /if \(tabId !== 'arena'\) \{\s*\n\s*document\.body\.classList\.remove\('arena-more'\)/, 'leaving the arena clears the more-view too');
});

test('أثناء المبارزة يبقى شريط المبارزة الكاملة فقط — الشاشتان لا تتزاحمان', () => {
  assert.match(css, /body\.duel-live #tab-arena > \*:not\(#arena-stage\):not\(#arena-pad\):not\(#arena-duel-status\):not\(#arena-fs-bar\) \{ display: none !important; \}/, 'the duel still hides every child except its four');
  // V19.1 (D1): الشرائح تُخفى صراحةً في المبارزة (كانت تُخفى ضمناً بالقاعدة العامة) —
  // أي قاعدة جديدة تخصّ الشريحتين في المبارزة يجب أن تكون «إخفاءً» لا «إظهاراً».
  assert.match(css, /body\.duel-live #arena-x-bar \{ display: none; \}/, 'the arena chips are explicitly hidden during a duel');
});
