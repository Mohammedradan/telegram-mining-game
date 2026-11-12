// المرحلة C: واجهة القتال داخل المبارزة (HUD) — تثبيت العقد، لا الرسم.
// الغرض: أن يبقى كل رقم في الشاشة مشتقاً من المحاكاة نفسها، وأن يبقى الـ HUD طبقة عرض فقط
// لا تلمس القواعد ولا الضرر ولا المكافآت ولا التحقق على الخادم.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(ROOT, 'public', 'platform-game.js'), 'utf8');
const rules = fs.readFileSync(path.join(ROOT, 'public', 'platform-rules.js'), 'utf8');

const block = (start, end) => {
  const i = html.indexOf(start);
  assert.ok(i > -1, `the block ${start} exists`);
  const j = html.indexOf(end, i);
  return html.slice(i, j > i ? j : undefined);
};

test('C1: لوحتا المقاتلَين — اسم ومستوى وصحة وشبح ضرر وطاقة وقلوب ودرع', () => {
  const hero = block('id="cx-side-hero"', '</div>\n        <div class="as-center"');
  const rival = block('id="cx-side-rival"', '</header>');
  assert.ok(hero.length > 200 && rival.length > 200, 'both plates are their own element');
  assert.match(hero, /id="arena-preview-hero"[^>]*>[^<]+</, 'the hero name is written in the plate');
  assert.match(rival, /id="arena-preview-rival"[^>]*>[^<]+</, 'the rival name is written in the plate');
  assert.match(hero, /id="cx-lvl-hero"/, 'the hero level has its own slot');
  assert.match(rival, /id="cx-lvl-rival"/, 'the rival level has its own slot');
  assert.match(hero, /id="arena-ghost-hero"[\s\S]{0,60}?id="arena-hp-hero"/, 'the hero ghost bar trails the real one');
  assert.match(rival, /id="arena-ghost-rival"[\s\S]{0,60}?id="arena-hp-rival"/, 'the rival ghost bar does too');
  assert.match(hero, /class="as-seg"/, 'the bar is cut into quarters so the eye can count hits');
  assert.match(hero, /id="arena-en-hero"/, 'the hero energy bar survives');
  assert.match(rival, /id="arena-en-rival"/, 'the rival gets one as well');
  assert.match(hero, /id="arena-hearts-hero"/, 'the remaining hearts stay on the plate');
  assert.match(hero, /id="cx-guard-hero"/, 'the guard/energy meter is on the plate');
  assert.match(rival, /id="cx-hpnum-rival"/, 'the rival health is also readable as a number');
  assert.match(hero, /id="cx-delta-hero"/, 'the hero plate can show a damage number');
  assert.match(rival, /id="cx-delta-rival"/, 'the rival plate can too');
  // الأسماء لا تُقتطع: سطر الاسم يحتلّ عرض البطاقة كاملاً والصورة خارجه
  const side = html.match(/\.as-side \{[\s\S]*?\}/)[0];
  assert.match(side, /display: grid/, 'each plate is a small grid, not one squeezed flex row');
  assert.match(html, /\.as-nameline \{ grid-column: 1 \/ -1;/, 'the name row spans both columns');
  assert.match(html, /\.as-meta \{ display: contents; \}/, 'the meta wrapper does not create a second box');
});

test('C2: مركز الشاشة — المؤقّت والسجل، ولا شيء فوق المقاتلَين', () => {
  const center = block('<div class="as-center">', '<div class="as-side rival"');
  assert.match(center, /id="arena-timer"/, 'the round clock is in the middle');
  assert.match(center, /id="arena-round"/, 'with its label');
  assert.match(center, /id="cx-record"/, 'and the win/loss record when there is one');
  const hud = html.match(/\.as-hud \{[^}]*direction: ltr[^}]*\}/)[0];
  assert.match(hud, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/, 'three columns: hero, centre, rival');
  assert.match(hud, /direction: ltr/, 'the columns are laid out left-to-right so both sides mirror exactly');
  assert.match(hud, /padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 38px\)/, 'the plates start below the floating bar');
  assert.match(html, /#tab-arena > #arena-fs-bar \{[^}]*position: absolute; top: 0; left: 0; right: 0/, 'the pause/exit bar is pinned to the top edge');
  assert.match(html, /body\.duel-live \.arena-fs-bar \.fs-note \{ display: none; \}/, 'the bar keeps only its two buttons during a fight');
});

test('C3: حالة القتال — تحذير انخفاض الصحة، الدرع، التبريد، وأرقام لا تغطي المقاتلَين', () => {
  assert.match(html, /id="cx-danger"/, 'a danger frame exists');
  assert.match(html, /\.cx-danger \{[^}]*inset 0 0 0 2px/, 'the danger is a frame on the edges, not a wash over the fighters');
  assert.match(game, /classList\.toggle\('low', p\.hearts <= 1\)/, 'the hero plate warns when one heart is left');
  assert.match(game, /classList\.toggle\('low', Boolean\(rival\) && rival\.hp \/ Math\.max\(1, rival\.maxHp\) <= 0\.25\)/, 'the rival plate warns below a quarter health');
  assert.match(game, /classList\.toggle\('guard', Boolean\(p\.guard && p\.guard\.active\)\)/, 'guard is highlighted while the shield holds');
  assert.match(game, /classList\.toggle\('skillready'/, 'a ready skill is highlighted');
  assert.match(game, /const guardBar = el\('cx-guard-hero'\)[\s\S]{0,220}?guardBar\.style\.width = /, 'the guard meter is written from guard stamina');
  assert.match(game, /cx-guard-hero/, 'the guard meter has a real element');
  assert.match(html, /\[data-duel-input="32"\]\.cool::after \{\s*content: attr\(data-cd\)/, 'the skill button prints its own countdown');
  assert.match(game, /skillBtn\.dataset\.cd = String\(Math\.max\(0, Math\.ceil\(p\.skillCooldown \/ \(R\.FPS \|\| 60\)\)\)\)/, 'the countdown is in seconds, read from the simulation cooldown');
  // أرقام الضرر تُشتق من فرق الحالة بين إطارين، وتختفي وحدها
  assert.match(game, /function duelSideDelta\(/, 'damage numbers come from one helper');
  assert.match(game, /duelSideDelta\('hero', duelSidePrev\.hearts - heartsNow\)/, 'the hero number is the difference in hearts');
  assert.match(game, /duelSideDelta\('rival', duelSidePrev\.rival - rivalNow\)/, 'the rival number is the difference in hp');
  assert.match(game, /duelSidePrev = \{ hearts: heartsNow, rival: rivalNow \}/, 'the previous frame is kept for the next comparison');
  assert.match(html, /@keyframes cxDelta/, 'the number floats up and fades');
  assert.match(html, /\.as-delta \{[^}]*pointer-events: none/, 'it never eats a tap');
});

test('C4: الإيقاف والخروج — يمرّان عبر المسار القائم ولا يمنحان مكافأة', () => {
  const card = block('<div class="cx-pause" id="cx-pause"', '<div id="arena-ready"');
  assert.match(card, /role="dialog" aria-modal="true"/, 'the pause menu is a dialog');
  assert.match(card, /id="cx-pause-time"/, 'it shows the clock');
  assert.match(card, /id="cx-pause-hearts"/, 'the hearts left');
  assert.match(card, /id="cx-pause-rival"/, 'and the rival health');
  assert.match(card, /data-pad-mode="stick"/, 'the control scheme can be switched from the pause menu');
  assert.match(card, /data-pad-mode="buttons"/, 'both schemes are offered');
  assert.match(card, /id="cx-resume"/, 'resume is one tap');
  assert.match(card, /id="cx-exit"/, 'exit is explicit');
  assert.match(card, /لا فوز ولا خسارة ولا مكافأة/, 'the card states the consequences of leaving');
  const resumeAt = html.indexOf("getElementById('cx-resume')");
  assert.ok(resumeAt > -1, 'the resume button is wired');
  assert.match(html.slice(resumeAt, resumeAt + 400), /game\.resumeDuel\?\.\(\)/, 'resume reuses the duel resume path');
  const exitAt = html.indexOf("getElementById('cx-exit')");
  assert.ok(exitAt > -1, 'the exit button is wired');
  const exitSrc = html.slice(exitAt, exitAt + 500);
  assert.match(exitSrc, /game\?\.duelAbandon\?\.\(\)/, 'exit reuses the abandon path (no server call, no reward)');
  assert.match(exitSrc, /arenaFullscreen\(false\)/, 'and it leaves full screen so the ready screen is reachable');
  assert.match(html, /if \(busy\.paused\) game\.resumeDuel\?\.\(\); else game\.pauseDuel\?\.\(\);/, 'one button pauses and resumes the same simulation');
  assert.match(html, /function arenaPausePanel\(show\)/, 'opening/closing is one function');
  assert.match(html, /arenaPausePanel\(Boolean\(game\.duelBusy\?\.\(\)\.paused\)\)/, 'the panel follows the real paused state');
  assert.match(html, /'platform-duel-done'[\s\S]{0,120}?arenaPausePanel\(false\)/, 'a finished duel closes the panel');
  // نفس الأرقام تأتي من لقطة العرض في المحاكاة
  assert.match(game, /hearts: duelSim\?\.player\?\.hearts \?\? null/, 'the snapshot exposes hearts');
  assert.match(game, /rivalHp: /, 'and the rival hp');
  assert.match(game, /timeLeft: duelSim \? Math\.max\(0, Math\.ceil\(\(R\.MAX_TICKS - duelSim\.tick\) \/ R\.FPS\)\) : null/, 'and the clock');
});

test('C5: طبقة عرض فقط — القواعد والنسخة والضرر والمكافآت لم تُلمس', () => {
  assert.doesNotMatch(rules, /cx-hud|cx-pause|cx-delta|as-seg|as-pip/, 'no HUD code leaked into the rules');
  assert.match(rules, /const VERSION = 14/, 'the deep-mine route geometry is versioned');
  assert.doesNotMatch(game, /\.hearts = |\.maxHp = |\.hp = /, 'the display layer never writes combat state back');
  assert.match(game, /startDuel\(zone = 0\) \{/, 'the duel entry point is unchanged in name and place');
});

test('C6: الهوامش — الهاتف لا يصبح كومة أزرار واللوحة لا تتضخّم على الشاشات الكبيرة', () => {
  assert.match(html, /#tab-arena > #arena-stage \{\s*position: absolute; inset: 0;/, 'the arena fills the tab during a duel');
  assert.match(html, /body\.duel-live\.arena-live #tab-arena > #arena-pad \{[\s\S]{0,120}?position: absolute; left: 0; right: 0; bottom: 0/, 'the pad floats over the scene instead of pushing it down');
  assert.match(html, /@media \(max-height: 560px\) \{[\s\S]{0,600}?padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 34px\)/, 'landscape keeps the plates clear of the floating bar');
  assert.match(html, /@media \(max-width: 430px\)[\s\S]{0,700}?body\.duel-live \.arena-pad \.ap-acts \.ap-hit/, 'narrow phones shrink the pad targets instead of clipping a button');
  assert.match(html, /@media \(max-width: 360px\)[\s\S]{0,240}?\.as-name \{ font-size: 9\.5px/, 'the smallest phone trims the name type, not the name');
  assert.match(html, /--cx-pad-h/, 'the floating status line measures the pad instead of guessing');
  assert.match(game, /rootStyle\.setProperty\('--cx-pad-h'/, 'and the measurement comes from the real pad height');
  assert.match(html, /body\.duel-live\.arena-live #tab-arena > #arena-duel-status \{[\s\S]{0,260}?var\(--cx-pad-h/, 'the status pill sits right above it');
});
