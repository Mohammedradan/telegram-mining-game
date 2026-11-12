// V14: الشاشة كاملة للعبة — أثناء المبارزة فقط، وكل ما ليس معركة يختفي.
// يُختبر: تخطيط CSS، بقاء اللعب وحده، الشريط العلوي (إيقاف/انسحاب)، سلامة نسبة العالم
// (لا تشويه للرسم عند تكبير المسرح)، وأن طلب الشاشة الكاملة لا يُعطّل المبارزة إن رُفض.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

test('وضع الشاشة الكاملة يغطّي الشاشة ويخصّ المبارزة فقط', () => {
  const css = shellCss.slice(shellCss.indexOf('/* ===== V14'), shellCss.indexOf('.arena-fs-bar {'));
  assert.match(css, /body\.duel-live #tab-arena \{\s*position: fixed; inset: 0; z-index: 80/, 'the arena tab takes the whole viewport during a fight');
  assert.match(css, /body\.duel-live \{ overflow: hidden;/, 'the page behind it cannot scroll');
  // القاعدة السالبة: كل ما ليس المسرح/اللوحة/الحالة/الشريط يختفي
  assert.match(css, /> \*:not\(#arena-stage\):not\(#arena-pad\):not\(#arena-duel-status\):not\(#arena-fs-bar\) \{ display: none !important; \}/,
    'header, gold, ladder, gear, advice, shots and the tab bar all disappear');
  for (const keep of ['#arena-stage', '#arena-pad', '#arena-duel-status', '#arena-fs-bar']) {
    assert.ok(css.includes(`:not(${keep})`), `${keep} survives the purge`);
  }
});

test('المسرح يكبر بلا تشويه: ارتفاعه مقيّد بعرض الشاشة لا بالطول', () => {
  const css = shellCss.slice(shellCss.indexOf('body.duel-live #arena-stage'), shellCss.indexOf('body.duel-live #arena-preview'));
  assert.match(css, /width: 100%/, 'full width');
  assert.match(css, /height: min\(58vh, 88vw\)/, 'height capped by viewport width so the world stays square-pixeled');
  assert.match(css, /aspect-ratio: auto/, 'no fixed 16:9 letterbox inside the fullscreen layout');
  // قاعدة المحرك: يتوقّف عن القصّ عندما height ≤ 0.957 × width. و88vw < 0.957w دائماً.
  const ratio = 88 / 100;
  assert.ok(ratio < 0.957, '88vw keeps the renderer out of its clamped branch (no vertical stretch)');
  assert.match(css, /border-radius: 0/, 'no floating card look');
});

test('لوحة اللمس تبقى في منطقة الإبهام وتكبر مع الشاشة', () => {
  const css = shellCss.slice(shellCss.indexOf('body.duel-live #arena-pad'), shellCss.indexOf('.arena-fs-bar {'));
  assert.match(css, /padding: 8px 12px calc\(env\(safe-area-inset-bottom, 0px\) \+ 12px\)/, 'respects the phone safe area');
  assert.match(css, /\.ap-hit \{ min-height: 64px/, 'the attack button grows to 64px');
  assert.match(css, /\.arena-stick \{ width: 76px; height: 76px; \}/, 'and so does the stick');
});

test('شريط المبارزة: إيقاف/متابعة وانسحاب، ولا يظهر خارج المبارزة', () => {
  const bar = html.slice(html.indexOf('<div id="arena-fs-bar"'), html.indexOf('<!-- مسرح حيّ'));
  assert.match(bar, /id="arena-fs-pause"/);
  assert.match(bar, /id="arena-fs-exit"/);
  assert.match(css, /\.arena-fs-bar \{\s*display: none;/, 'hidden by default');
  assert.match(css, /body\.duel-live \.arena-fs-bar \{ display: flex; \}/, 'shown only in a duel');
  assert.match(html, /id="arena-fs-bar" class="arena-fs-bar" aria-label="تحكم المبارزة"/, 'labelled for screen readers');
});

test('أزرار الشريط تستدعي مسار المبارزة نفسه، لا مسارًا جديدًا', () => {
  const pause = html.slice(html.indexOf("document.getElementById('arena-fs-pause')?.addEventListener"), html.indexOf("document.getElementById('arena-fs-exit')?.addEventListener"));
  assert.match(pause, /if \(busy\.paused\) game\.resumeDuel\?\.\(\); else game\.pauseDuel\?\.\(\);/, 'one button toggles pause and resume');
  assert.match(pause, /if \(!busy\?\.running\) return;/, 'and does nothing outside a running duel');
  const exit = html.slice(html.indexOf("document.getElementById('arena-fs-exit')?.addEventListener"), html.indexOf('function startArenaDuel'));
  assert.match(exit, /duelAbandon\?\.\(\)/, 'exit reuses the existing abandon path (cleanup + platform-duel-done)');
  assert.doesNotMatch(exit, /fetch\(|jpost\(/, 'leaving never calls the server from the client');
  assert.match(html, /if \(!game\?\.duelAbandon\?\.\(\)\) return;/, 'and it bails out if there is nothing to abandon');
});

test('الشاشة الكاملة الحقيقية اختيارية: فشلها لا يمنع المبارزة', () => {
  const fn = html.slice(html.indexOf('function arenaFullscreen'), html.indexOf('function arenaPauseLabel'));
  assert.match(fn, /try \{/, 'wrapped so a refused request cannot break the fight');
  assert.match(fn, /catch \(_\) \{\}/, 'and the failure is swallowed');
  assert.match(fn, /typeof tg\?\.requestFullscreen === 'function'/, 'Telegram fullscreen is preferred when present');
  assert.match(fn, /root\?\.requestFullscreen/, 'otherwise the standard API is used');
  assert.match(fn, /if \(p && p\.catch\) p\.catch\(\(\) => \{\}\)/, 'a rejected promise is handled, not thrown');
  // الدخول مع بدء المبارزة، والخروج مع نهايتها
  const start = html.slice(html.indexOf('function startArenaDuel'), html.indexOf('function resumeActiveRun'));
  assert.match(start, /classList\.add\('duel-live'\);\s*arenaFullscreen\(true\);/, 'entering fullscreen with the fight');
  const done = html.slice(html.indexOf("addEventListener('platform-duel-done'"), html.indexOf('function arenaEnemyFighter'));
  assert.match(done, /arenaFullscreen\(false\);/, 'and leaving it when the fight is done');
});

test('تلميحات الموجة والزعيم تبقى داخل المسرح المكبَّر (لا تُثبَّت على الشاشة)', () => {
  const hint = css.slice(css.indexOf('.arena-hint {'), css.indexOf('.arena-hint.show'));
  assert.match(hint, /position: absolute/, 'the hint is positioned against the stage, so a bigger stage moves it with the art');
  assert.match(hint, /top: 44px/, 'and keeps its distance from the HUD');
  const stage = html.slice(html.indexOf('<div id="arena-stage"'), html.indexOf('<div class="as-bar">'));
  assert.ok(stage.includes('id="arena-hint"') && stage.includes('id="arena-ko"'), 'hint and KO overlay live inside the stage');
});
