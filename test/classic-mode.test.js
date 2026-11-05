'use strict';
// الوضع الكلاسيكي (الدفعة 3أ′): ربط الواجهة بالصفحة. السلوك الفعلي (الدخول والخروج، الجولة، السقف، الجوالات) يثبته
// `npm run test:classic` في متصفح حقيقي، والخادم والسقف يثبتهما classic-cap.test.js؛ هنا ما يمكن إثباته من المصدر:
// موضع البطاقة وصنفها (المناجم الستة وحدها .mine-card، تعدّها اختبارات المتصفح الأخرى)، وأن عناصرها الجديدة SVG بلا إيموجي
// (اللعبة الكلاسيكية نفسها تبقى بإيموجيها الأصلي عمداً)، ومعالجات الدخول والخروج وحراسة السباق، وتبنّي المحفظة من ردود الخادم.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const html = read('public', 'index.html');
const css = read('public', 'platform.css');
const EMOJI = /\p{Extended_Pictographic}/u;
const section = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); assert.ok(a >= 0 && b > a, `${from} … ${to}`); return html.slice(a, b); };

test('entry: the classic card is a footer of the mines map, not a seventh mine', () => {
  const map = section('<div id="mines-overlay"', '<!-- المرشد «العم سراج»');
  assert.ok(map.indexOf('id="mines-list"') < map.indexOf('id="mine-classic"'), 'under the list of mines');
  const card = /<div id="mine-classic" class="mine-classic">[\s\S]*?<button id="classic-open"[^>]*>[^<]*<\/button>\s*<\/div>/.exec(map)[0];
  assert.doesNotMatch(card, /mine-card/, 'the six mines are the only .mine-card (the browser tests count them)');
  assert.match(card, /<use href="#i-cart"\/>/, 'its art is an SVG icon');
  assert.match(html, /<symbol id="i-cart"/);
  assert.match(card, /<button id="classic-open" type="button" class="mine-pick" aria-label="العب الوضع الكلاسيكي">العب<\/button>/, 'a label that makes sense out of context');
  assert.match(card, /<b id="classic-left"><\/b>/, 'the purse left is filled by the script');
  assert.doesNotMatch(card, EMOJI, 'the new card is emoji-free');
  assert.doesNotMatch(card, /\sonclick=/, 'listeners, not inline handlers');
  assert.match(card, /ذهبها يتقاسم سقف اليوم مع المناجم وبيع الخامات/, 'it says the gold is shared');
  assert.equal((html.match(/id="mine-classic"/g) || []).length, 1);
});

test('way back: the classic panel opens with a bar that returns to the mine and shows the shared purse', () => {
  const bar = section('<div id="legacy-bar"', '<div class="grid grid-cols-4 gap-1.5 text-center">');
  assert.match(bar, /<button id="legacy-back" type="button" class="legacy-back[^"]*">/);
  assert.match(bar, /<use href="#i-right"\/>/);
  assert.match(html, /<symbol id="i-right"/);
  assert.match(bar, /العودة إلى المنجم/);
  assert.match(bar, /<div id="adv-daily"[^>]*aria-live="polite"><\/div>/, 'the purse line is announced politely');
  assert.doesNotMatch(bar, EMOJI, 'the new bar is emoji-free');
  // the bar is the first thing inside the classic panel, which stays hidden until someone opens it
  const panel = section('<div id="legacy-adventure"', '<div class="grid grid-cols-4 gap-1.5 text-center">');
  assert.match(panel, /^<div id="legacy-adventure" hidden class="[^"]*">\s*<div id="legacy-bar"/);
});

test('behaviour in the page script: enter closes the map and reveals the panel, leave pauses the round, neither touches a race', () => {
  const open = /function openClassic\(\) \{([\s\S]*?)\n    \}/.exec(html)[1];
  assert.ok(open.indexOf("race.inRace) return;") >= 0 && open.indexOf('race.inRace) return;') < open.indexOf('minesClose()'), 'a race in progress is never left, checked first');
  assert.match(open, /minesClose\(\);\s*\n\s*window\.PlatformGame\?\.showLegacy\?\.\(\);/);
  assert.match(open, /updateClassicDaily\(\); updateAdventureUI\(\);/);
  assert.match(open, /getElementById\('game-overlay-btn'\)\?\.focus/, 'focus lands on "play"');
  const leave = /function leaveClassic\(\) \{([\s\S]*?)\n    \}/.exec(html)[1];
  assert.ok(leave.indexOf('race.inRace) return;') >= 0 && leave.indexOf('race.inRace) return;') < leave.indexOf('showPlatform'), 'a race is not left through the way back either');
  assert.match(leave, /if \(adv\.running && !adv\.paused\) setAdventurePaused\(true\);/, 'a round in progress is paused, not abandoned');
  assert.ok(leave.indexOf('setAdventurePaused(true)') < leave.indexOf('showPlatform'), 'paused before the scene changes');
  assert.match(leave, /getElementById\('mine-select'\)\?\.focus/, 'focus goes back to the map button');
  assert.match(html, /getElementById\('classic-open'\)\?\.addEventListener\('click', openClassic\);/);
  assert.match(html, /getElementById\('legacy-back'\)\?\.addEventListener\('click', leaveClassic\);/);
  // the map shows a fresh purse every time it opens
  assert.match(html, /minesOpenFlag = true; overlay\.hidden = false; minesRender\(\); updateClassicDaily\(\);/);
  // and the way back disappears while racing
  assert.match(html, /legacyBack\.hidden = Boolean\(adv\.mode === 'race' && typeof race !== 'undefined' && race\.inRace\);/);
});

test('the purse: adopted from every server reply, shown, and used to show what a round will really pay', () => {
  assert.match(html, /if \(data\.dailyGold && Number\.isFinite\(data\.dailyGold\.remaining\)\) profile\.dailyGold = data\.dailyGold;/);
  assert.match(html, /if \(typeof updateClassicDaily === 'function'\) updateClassicDaily\(\);/, 'every adopted state refreshes the bar and the card');
  const upd = /function updateClassicDaily\(\) \{([\s\S]*?)\n    \}/.exec(html)[1];
  assert.match(upd, /classic-left/); assert.match(upd, /adv-daily/);
  assert.match(upd, /سقف اليوم المشترك: متبقٍ \$\{fmt\(d\.remaining\)\} من \$\{fmt\(d\.cap\)\}/);
  assert.match(upd, /bar && bar\.textContent !== line/, 'the bar is written only when its text changed (the panel redraws every frame)');
  assert.match(upd, /left && left\.textContent !== text/, 'and so is the card');
  // reward preview: never more than the room that is left, and the purse is kept in step until the server's reply
  assert.match(html, /const classicRoom = \(\) => \{ const d = classicPurse\(\); return d \? Math\.max\(0, d\.remaining\) : Infinity; \};/, 'unknown purse = no prediction, the server still decides');
  const purse = /const classicPurse = \(\) => \{([\s\S]*?)\n    \};/.exec(html)[1];
  assert.match(purse, /if \(!d \|\| !Number\.isFinite\(d\.remaining\)\) return null;/);
  assert.match(purse, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, 'the day is UTC, like the server\'s');
  assert.match(purse, /return d\.day === day \? d : \{ day, used: 0, cap: d\.cap, remaining: d\.cap \};/, 'yesterday\'s purse is a full purse today');
  assert.match(html, /profile\.dailyGold = \{ day: d\.day, cap: d\.cap, used: d\.used \+ reward, remaining: Math\.max\(0, d\.remaining - reward\) \};/);
  assert.match(upd, /const d = classicPurse\(\);/, 'the bar and the card read the same normalised purse');
  assert.match(html, /\(cut \? `<span class="text-sky-300">سقف الذهب اليوم مشترك مع المناجم وبيع الخامات: \$\{reward \? `دُفع لك الباقي فقط \(\$\{reward\} من \$\{claimed\}\)` : `لا ذهب إضافي اليوم \(كان \$\{claimed\}\)`\} — يتجدّد \$\{classicResetTime\(\)\}<\/span><br>` : ''\)/);
  // the reset time is shown in the player's own clock: the purse refills at 00:00 UTC
  const reset = /function classicResetTime\(\) \{([\s\S]*?)\n    \}/.exec(html)[1];
  assert.match(reset, /Date\.UTC\(d\.getUTCFullYear\(\), d\.getUTCMonth\(\), d\.getUTCDate\(\) \+ 1\)/);
  assert.match(reset, /toLocaleTimeString\('ar'/);
});

test('sync message: a capped round is explained, ahead of the generic "too soon" one', () => {
  const capped = html.indexOf("r.reason === 'daily_cap'"), tooSoon = html.indexOf("r.reason === 'too_soon'))");
  assert.ok(capped > 0 && tooSoon > capped, 'the cap message comes first');
  assert.match(html, /بلغت سقف الذهب اليومي المشترك \(\$\{fmt\(profile\?\.dailyGold\?\.cap \|\| 10000\)\}\): حُفظت الجولة وإحصاؤها \$\{runs\.some\(\(r\) => r\.gold > 0\) \? 'ودُفع الباقي فقط' : 'دون ذهب إضافي'\}/);
  assert.match(html, /haptic\(claimed > 0 \? 'success' : 'error'\);/, 'a round that the cap paid nothing for is still a round that was played');
});

test('styles: the footer card is its own thing (not .mine-card) and adapts to short and narrow screens', () => {
  for (const sel of ['.mine-classic{', '.mine-classic-art{', '.mine-classic-body h3{', '.mine-classic .mine-pick{', '.legacy-back .ui-icon{']) assert.ok(css.includes(sel), sel);
  assert.doesNotMatch(css, /\.mine-classic\.mine-card|\.mine-card\.mine-classic/);
  assert.match(css, /@media\(max-height:480px\)\{[^@]*\.mine-classic\{margin-bottom:6px;padding:6px 8px\}\.mine-classic-body p\{display:none\}\}/, 'landscape phones: the description folds away');
  assert.match(css, /@media\(max-width:360px\)\{[^@]*\.mine-classic-art\{display:none\}\}/, 'narrow phones: no art');
  assert.doesNotMatch(css.slice(css.indexOf('.mine-classic{'), css.indexOf('@media(max-height:480px){.mines-top')), EMOJI);
});

test('what stays untouched: the classic game keeps its own code and its original emoji art (a request, kept)', () => {
  const panel = section('<div id="legacy-adventure"', '<!-- 🧭 منجم المنصّة: جولة حتمية 60Hz');
  assert.match(panel, /data-adv-mode="classic"[\s\S]*data-adv-mode="blitz"[\s\S]*data-adv-mode="survival"[\s\S]*data-adv-mode="boss"/, 'the four modes are all there');
  assert.match(panel, /<canvas id="game-canvas"/);
  assert.match(panel, EMOJI, 'the classic game still draws its own emoji UI; converting it to SVG is a separate, optional job');
  assert.match(html, /function startAdventure\(mode = 'solo', seed = null, duration = null\)/, 'the entry point races use is unchanged');
});
