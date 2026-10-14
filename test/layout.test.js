// حارس انحدار لتخطيط الواجهة: عمود بعرض هاتف على الشاشات الكبيرة،
// وتمرير داخلي للتبويبات وارتفاع فعلي لمنفذ العرض على الشاشات الصغيرة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

test('large screens: the app is a centered phone-width column, background covers the root', () => {
  assert.match(style, /body\s*\{[^}]*max-width:\s*520px;[^}]*margin:\s*0 auto;/s);
  assert.match(style, /html\s*\{[^}]*background:\s*radial-gradient/s);
  assert.doesNotMatch(html, /<body class="[^"]*h-screen/);
});

test('small screens: body height follows the real viewport and tabs scroll internally', () => {
  assert.match(style, /height:\s*var\(--app-height,\s*100vh\)/);
  assert.match(style, /@supports \(height: 100dvh\)\s*\{\s*body \{ height: var\(--app-height, 100dvh\); \}/);
  assert.match(style, /\.tab-content\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  for (const tab of ['tab-shop', 'tab-leaderboard', 'tab-arena']) {
    const tag = html.match(new RegExp(`<main id="${tab}" class="([^"]*)"`));
    assert.ok(tag, `${tab} should exist`);
    assert.doesNotMatch(tag[1], /max-h-\[/, `${tab} must not cap its height to a viewport fraction`);
  }
});

test('adventure canvas height scales with the screen and the backing store never exceeds it', () => {
  assert.match(style, /#game-canvas \{ height: clamp\(230px, 40vh, 330px\); \}/);
  assert.doesNotMatch(html, /id="game-canvas"[^>]*h-\[330px\]/);
  assert.match(html, /advCanvas\.height = Math\.max\(200, rect\.height\) \* dpr;/);
});

test('telegram viewport height and vertical-swipe guard are applied when running inside Telegram', () => {
  assert.match(html, /tg\.viewportStableHeight/);
  assert.match(html, /setProperty\('--app-height'/);
  assert.match(html, /tg\.onEvent\?\.\('viewportChanged'/);
  assert.match(html, /tg\.disableVerticalSwipes\?\.\(\)/);
  // الطاقة عنصر تبويب التعدين فقط؛ التبويب الابتدائي هو اللعب
  assert.match(html, /<div id="energy-container" class="w-full mb-3" style="display:none">/);
});
