// V13: لوحة تحكم الهاتف — سحب أفقي للحركة + أزرار فعل على اليمين، مع مبدّل «عصا/أزرار».
// الحركة في المحرك ثنائية، فما يُختبر هنا: الرياضيات (منطقة ميتة، دمج الأقنعة)، والواجهة
// (عناصر موجودة مرة واحدة، هدف لمس كافٍ، لا مشي معلّق)، والتحويل إلى ضربة قوية بالضغط المطوّل.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('public/index.html');
const css = read('public/app-shell.css');
const game = read('public/platform-game.js');
const stick = read('public/platform-stick.js');
const rulesSource = read('public/platform-rules.js');

test('منطقة ميتة صريحة: لا حركة قبل 8 بكسل، ثم اتجاه واحد فقط', () => {
  assert.equal(R.PAD.deadzone, 8);
  const cases = [[-120, -1], [-9, -1], [-8, 0], [-4, 0], [0, 0], [7, 0], [8, 0], [9, 1], [120, 1]];
  for (const [dx, want] of cases) assert.equal(R.stickDir(dx), want, `dx=${dx}`);
  // المنطقة الميتة قابلة للتغيير من نفس المصدر (لا رقم سحري في الواجهة)
  assert.equal(R.stickDir(10, 12), 0);
});

test('دمج القناع: السحب + أزرار الفعل، وزرُ الجهة يفوز على السحب المعاكس', () => {
  const { LEFT, RIGHT, ATTACK, JUMP } = R.INPUT;
  assert.equal(R.padMask({ stick: 1 }), RIGHT);
  assert.equal(R.padMask({ stick: -1 }), LEFT);
  assert.equal(R.padMask({ stick: 0 }), 0);
  assert.equal(R.padMask({ stick: 1, bits: [ATTACK] }), RIGHT | ATTACK, 'مشى وضرب في نفس الإطار');
  assert.equal(R.padMask({ stick: -1, bits: [JUMP] }), LEFT | JUMP);
  assert.equal(R.padMask({ stick: 1, bits: [LEFT] }), LEFT, 'الزر لا يُلغى بالسحب، وإلا تجمّد اللاعب');
  assert.equal(R.padMask({ stick: 0, bits: [LEFT, RIGHT] }), 0, 'جهتان معاً تُلغي إحداهما الأخرى (لا تجميد صامت)');
  // لا يسار+يمين معاً بأي تركيبة
  for (const stick of [-1, 0, 1]) for (const bits of [[], [LEFT], [RIGHT], [LEFT, RIGHT], [ATTACK, RIGHT]]) {
    const mask = R.padMask({ stick, bits });
    assert.ok(!((mask & LEFT) && (mask & RIGHT)), `stick=${stick} bits=${bits}`);
    assert.ok(mask >= 0 && mask <= R.MAX_MASK);
  }
});

test('الواجهة: عصا واحدة، وأزرار الفعل مرة واحدة فقط، وزر «قوي» باقٍ لوضع الأزرار', () => {
  assert.equal((html.match(/id="arena-stick"/g) || []).length, 1, 'slide zone exists exactly once');
  assert.match(html, /id="arena-stick"[\s\S]{0,200}class="as-knob"/, 'the knob lives inside it');
  // نطاق الأزرار فقط (CSS يذكر نفس المحدّدات، فلا تُحسب مرتين)
  const padMarkup = html.slice(html.indexOf('<div id="arena-pad"'), html.indexOf('class="arena-keyhint"'));
  const masks = [...padMarkup.matchAll(/data-duel-input="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(new Set(masks).size, masks.length, 'no duplicated input button (bindings stay unique)');
  for (const bit of [1, 2, 4, 16, 32, 64, 128, 256]) assert.ok(masks.includes(bit), `mask ${bit} still has a button`);
  assert.match(padMarkup, /data-duel-input="16" class="ap-hit" data-hold-heavy="true"/, 'the attack button carries the hold flag');
  assert.match(padMarkup, /class="ap-heavy"/, 'the standalone heavy button survives for buttons mode');
});

test('مبدّل الطريقة: زرّان، وحفظ الاختيار، والافتراضي عصا', () => {
  assert.match(html, /id="arena-pad-mode"/, 'the switch lives outside the pad so it is usable before a duel');
  assert.match(html, /data-pad-mode="stick"/);
  assert.match(html, /data-pad-mode="buttons"/);
  assert.match(game, /let padMode = 'stick'/, 'stick is the default');
  assert.match(game, /localStorage\.setItem\(PAD_MODE_KEY, padMode\)/, 'the choice is remembered');
  assert.match(game, /saved === 'buttons' \? 'buttons' : 'stick'/, 'a stored choice wins, otherwise stick');
  assert.match(game, /classList\.toggle\('pad-stick', padMode === 'stick'\)/, 'the body class drives the CSS');
  assert.match(game, /padMode: \(\) => padMode, setPadMode: applyPadMode/, 'exposed for tests and QA');
});

test('CSS: السحب لا يمرّر الصفحة، والأهداف كبيرة، والوضعان يتبادلان بلا ازدواج', () => {
  const stickCss = css.slice(css.indexOf('.arena-stick {'), css.indexOf('.arena-stick::before'));
  assert.match(stickCss, /touch-action: none/, 'a drag never scrolls the page');
  assert.match(stickCss, /width: 60px; height: 60px; border-radius: 50%/, 'a round base, like the play-tab joystick');
  const knobCss = css.slice(css.indexOf('.arena-stick .as-knob {'), css.indexOf('.arena-stick[data-active'));
  assert.match(knobCss, /width: 30px; height: 30px; border-radius: 50%/, 'the knob is the same visual language');
  assert.match(knobCss, /translate\(-50%, -50%\)/, 'it rests centred');
  assert.match(css, /body\.pad-stick \.ap-move button\[data-duel-input="1"\],[\s\S]{0,160}body\.pad-stick \.ap-heavy \{ display: none; \}/, 'stick mode drops the two arrows and the heavy button');
  assert.doesNotMatch(css, /body\.pad-stick \.ap-move \{ display: none/, 'but the jump button must survive: hiding the whole move group would delete it');
  assert.match(css, /body:not\(\.pad-stick\) \.arena-stick \{ display: none; \}/, 'buttons mode hides the stick');
  assert.match(css, /body\.pad-stick \.ap-acts button \{ flex: 1 1 0; min-width: 40px; min-height: 48px/, 'action targets shrink honestly on narrow phones but keep a 48px height');
  assert.match(css, /body\.pad-stick \.ap-acts \.ap-hit \{ flex: 0 0 56px; min-width: 56px; min-height: 54px/, 'the attack button is the biggest target');
  assert.match(css, /body\.pad-stick \.ap-acts \{ flex: 1 1 auto; display: flex; flex-wrap: nowrap/, 'all actions stay on one row');
  assert.match(css, /\.arena-stick\[data-active="true"\]/, 'the zone shows it is held');
});

test('الربط: السحب يُصفَّر عند رفع الإصبع أو فقدانه، ولا مشي معلّق', () => {
  assert.match(stick, /direction = rules && rules\.stickDir \? rules\.stickDir\(dx\) : 0/, 'the direction comes from the shared deadzone rule');
  assert.match(game, /for \(const type of \['pointerup', 'pointercancel', 'lostpointercapture'\]\)[\s\S]{0,120}stickReset\(\)/,
    'every way a finger can leave clears the movement');
  assert.match(game, /addEventListener\('blur'[\s\S]{0,120}clearHolds\(\); stickReset\(\)/, 'losing focus also stops the stick');
  assert.match(rulesSource, /const padMask = \(\{ stick = 0, bits = \[\] \} = \{\}\) =>/, 'the duel mask is assembled by the shared helper');
  assert.match(game, /if \(R\.padMask\) mask = R\.padMask\(\{ stick: duelStickDir, bits: \[mask\] \}\)/, 'the game delegates mask assembly to the shared helper');
});

test('الضغط المطوّل: ضربة قوية واحدة بعد 260ms، وفي وضع العصا فقط', () => {
  assert.equal(R.PAD.heavyHoldMs, 260);
  assert.match(game, /if \(padMode === 'stick' && button\.dataset\.holdHeavy === 'true'\)/, 'only in stick mode, and only on the flagged button');
  assert.match(game, /R\.PAD\?\.heavyHoldMs \|\| 260/, 'the threshold comes from the rules module');
  assert.match(game, /duelPulses\.set\(`h:\$\{e\.pointerId\}`, R\.INPUT\.HEAVY\)/, 'it emits a single HEAVY pulse, not a held state (no auto-chain)');
  assert.match(game, /if \(!duelPointers\.has\(e\.pointerId\) \|\| !duelRunning \|\| duelPaused\) return;/, 'a released finger or a paused duel never fires it');
  const releaseAt = game.lastIndexOf('const release = e => {');
  const release = game.slice(releaseAt, game.indexOf("button.addEventListener(type, release)", releaseAt));
  assert.match(release, /clearHold\(e\.pointerId\)/, 'releasing cancels the pending heavy');
});

test('لا تلميحات في المسرح الاستعراضي: الإرشاد للمبارزة الحقيقية فقط', () => {
  const fx = game.slice(game.indexOf('function collectFx'), game.indexOf('function arenaFx'));
  const plans = fx.match(/const plan = !withSound \? null : R\.duelHintPlan\?\.\(ev,/g) || [];
  assert.equal(plans.length, 2, 'both hint paths (enrage + second slam) are gated to a live duel');
  const game2 = read('public/platform-game.js');
  assert.match(game2, /function arenaFx\(\) \{ if \(arenaSim\) collectFx\(arenaSim\); \}/, 'the preview collects effects without sound, so it is the gated path');
});
