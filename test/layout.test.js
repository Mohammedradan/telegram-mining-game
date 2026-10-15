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
  // Tailwind CDN يحقن body { margin: 0 } بعد <style> فيدفع العمود لأقصى اليمين في RTL لولا !important و mx-auto
  assert.match(style, /margin-left:\s*auto\s*!important;\s*margin-right:\s*auto\s*!important;/);
  assert.match(html, /<body class="[^"]*\bmx-auto\b/);
  assert.match(style, /html\s*\{[^}]*background:\s*radial-gradient/s);
  assert.doesNotMatch(html, /<body class="[^"]*h-screen/);
  // شريط التمرير داكن والخط الاحتياطي يدعم رموز Unicode 13+ مثل 🪙 و🪨 على ويندوز 10
  assert.match(style, /\.tab-content::-webkit-scrollbar-thumb/);
  assert.match(style, /Noto Color Emoji/);
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

test('play is a fixed app screen with focused sub-tabs instead of one long page', () => {
  assert.match(style, /#tab-play\s*\{\s*overflow:\s*hidden;/);
  assert.match(style, /\.play-panel\s*\{[^}]*display:\s*none;[^}]*min-height:\s*0;/s);
  assert.match(style, /\.play-panel\.active\s*\{\s*display:\s*flex;/);
  for (const panel of ['adventure', 'missions', 'customize', 'social']) {
    assert.match(html, new RegExp(`id="play-nav-${panel}"`));
    assert.match(html, new RegExp(`id="play-panel-${panel}"`));
  }
  assert.match(html, /function switchPlayPanel\(panelId\)/);
  assert.match(html, /panel\.hidden = !selected/);
});

test('adventure canvas fills the remaining game panel and the backing store follows it', () => {
  assert.match(style, /\.adventure-stage #game-canvas \{[^}]*height:\s*100%;/s);
  assert.match(style, /\.adventure-stage\s*\{\s*min-height:\s*150px;/);
  assert.doesNotMatch(html, /id="game-canvas"[^>]*h-\[330px\]/);
  assert.match(html, /advCanvas\.height = Math\.max\(200, rect\.height\) \* dpr;/);
});

test('arena shows illustrated sword fighters and action animations, not clipped emoji cards', () => {
  assert.match(html, /id="arena-player-fighter"[^>]*arena-fighter player/);
  assert.match(html, /id="arena-enemy-fighter"[^>]*arena-fighter enemy/);
  assert.match(html, /src="\/assets\/arena-player\.png\?v=3"[^>]*alt="محارب المنجم يحمل سيفاً"/);
  assert.match(html, /src="\/assets\/arena-enemy\.png\?v=3"[^>]*alt="مبارز يحمل سيفاً"/);
  assert.match(html, /class="arena-battle-stage"/);
  assert.match(style, /\.arena-battle-stage\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(style, /\.arena-fighter-body\s*\{[^}]*object-fit:\s*contain;/s);
  assert.match(style, /@keyframes arenaLungePlayer/);
  assert.match(style, /@keyframes arenaHit/);
  assert.match(style, /@keyframes arenaDamageFloat/);
  assert.match(html, /id="arena-stage-banner"/);
  assert.match(html, /id="arena-damage-enemy"/);
  assert.match(html, /function animateArenaFighter\(actor, action, event = \{\}\)/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'arena-player.png')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'arena-enemy.png')));
});

test('telegram viewport height and vertical-swipe guard are applied when running inside Telegram', () => {
  assert.match(html, /tg\.viewportStableHeight/);
  assert.match(html, /setProperty\('--app-height'/);
  assert.match(html, /tg\.onEvent\?\.\('viewportChanged'/);
  assert.match(html, /tg\.disableVerticalSwipes\?\.\(\)/);
  // الطاقة عنصر تبويب التعدين فقط؛ التبويب الابتدائي هو اللعب
  assert.match(html, /<div id="energy-container" class="w-full mb-3" style="display:none">/);
});
