'use strict';
// بطاقة التبجيل في تبويب الترقيات (الدفعة 3ج): دوال الصفحة الفعلية (renderPrestige وprestigeTap وapplyOpLocally) بعناصر وهمية،
// ما يُختبر هو الشيفرة المرسَلة فعلاً: الحالات الأربع للزر، التأكيد بلمستين وانتهاؤه، عدم التنفيذ دون خادم، وربط الصفحة.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../public/prestige-rules');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'platform.css'), 'utf8');
const EMOJI = /\p{Extended_Pictographic}/u;
const plain = (v) => JSON.parse(JSON.stringify(v));

const cut = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} … ${to}`); return html.slice(a, b); };
const CARD = cut('    let prestigeConfirmUntil = 0, prestigeSig = \'\';', "    document.getElementById('prestige-btn')?.addEventListener('click', prestigeTap);");
const APPLY = cut('    function applyOpLocally(s, op) {', '    // اعتماد حالة موثوقة من الخادم ثم إعادة تطبيق ما لم يؤكده بعد');

function sandbox({ owned = { click: 0, bot: 0, rig: 0 }, prestige = 0, serverMode = true } = {}) {
  const els = {};
  for (const id of ['prestige-card', 'prestige-level', 'prestige-mult', 'prestige-needs', 'prestige-btn']) els[id] = { textContent: '', innerHTML: '', dataset: {}, disabled: false };
  const calls = { ops: [], haptic: [], updateUI: 0, save: 0, timers: [] };
  let clock = 1_000_000;
  const ctx = {
    state: { gold: 123, owned: { ...owned }, costs: { click: 50, bot: 22_211, rig: 1_690 }, passiveIncome: owned.bot * 5 + owned.rig * 25, prestige, clickPower: 1 + owned.click, ores: { copper: 3 }, equipment: { pickaxe: 1 } },
    serverMode, PrestigeRules: P, window: {},
    fmt: (n) => Math.floor(n).toLocaleString('en-US'), fmtRate: (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }),
    haptic: (k) => calls.haptic.push(k), enqueueOp: (op) => calls.ops.push(op), updateUI: () => { calls.updateUI++; }, save: () => { calls.save++; },
    ADV_UPGRADE_DEFS: {}, Date: { now: () => clock }, setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; },
    document: { getElementById: (id) => els[id] || null },
  };
  vm.createContext(ctx);
  vm.runInContext(`${APPLY}\n${CARD}\nthis.applyOpLocally = applyOpLocally; this.renderPrestige = renderPrestige; this.prestigeTap = prestigeTap;`, ctx);
  return { ctx, els, calls, tick: (ms) => { clock += ms; } };
}

test('locked: the card shows the level, the multiplier and how far the player is, and the button is a disabled sentence', () => {
  const { ctx, els } = sandbox({ owned: { click: 0, bot: 12, rig: 2 } });
  ctx.renderPrestige();
  assert.equal(els['prestige-level'].textContent, 'المستوى 0 من 10');
  assert.equal(els['prestige-mult'].textContent, '×1');
  assert.match(els['prestige-needs'].innerHTML, /العمال الآليون<\/span><div class="prestige-bar" aria-hidden="true"><i style="width:80%"><\/i><\/div><b>12\/15<\/b>/);
  assert.match(els['prestige-needs'].innerHTML, /المنصّات العملاقة<\/span><div class="prestige-bar" aria-hidden="true"><i style="width:66%"><\/i><\/div><b>2\/3<\/b>/);
  assert.doesNotMatch(els['prestige-needs'].innerHTML, /prestige-need ok/, 'neither need is met');
  assert.deepEqual([els['prestige-btn'].disabled, els['prestige-btn'].dataset.state, els['prestige-btn'].textContent], [true, 'locked', 'يلزمك 15 عاملاً و3 منصّة']);
  assert.match(els['prestige-needs'].innerHTML, /<use href="#i-robot"\/>/); assert.match(els['prestige-needs'].innerHTML, /<use href="#i-drill"\/>/);
  assert.doesNotMatch(els['prestige-needs'].innerHTML + els['prestige-btn'].textContent, EMOJI);
});

test('ready: one bar turns green per met need, the button invites the prestige and names the multiplier it will give', () => {
  const { ctx, els } = sandbox({ owned: { click: 0, bot: 15, rig: 3 } });
  ctx.renderPrestige();
  assert.equal((els['prestige-needs'].innerHTML.match(/prestige-need ok/g) || []).length, 2, 'both needs met');
  assert.deepEqual([els['prestige-btn'].disabled, els['prestige-btn'].dataset.state, els['prestige-btn'].textContent], [false, 'ready', 'تبجيل ← ×1.1']);
  const later = sandbox({ owned: { click: 0, bot: 17, rig: 4 }, prestige: 1 });
  later.ctx.renderPrestige();
  assert.equal(later.els['prestige-level'].textContent, 'المستوى 1 من 10 · دخلك السلبي +10%');
  assert.equal(later.els['prestige-mult'].textContent, '×1.1');
  assert.equal(later.els['prestige-btn'].textContent, 'تبجيل ← ×1.2');
  const short = sandbox({ owned: { click: 0, bot: 15, rig: 3 }, prestige: 1 });
  short.ctx.renderPrestige();
  assert.deepEqual([short.els['prestige-btn'].disabled, short.els['prestige-btn'].textContent], [true, 'يلزمك 17 عاملاً و4 منصّة'], 'level 1 asks for more than level 0');
});

test('the top level: the card says so, shows no needs, and the button cannot be pressed', () => {
  const { ctx, els, calls } = sandbox({ owned: { click: 0, bot: 900, rig: 900 }, prestige: 10 });
  ctx.renderPrestige();
  assert.equal(els['prestige-level'].textContent, 'المستوى 10 من 10 · دخلك السلبي +100%');
  assert.equal(els['prestige-mult'].textContent, '×2');
  assert.match(els['prestige-needs'].innerHTML, /بلغت أقصى مستوى/); assert.doesNotMatch(els['prestige-needs'].innerHTML, /prestige-bar/);
  assert.deepEqual([els['prestige-btn'].disabled, els['prestige-btn'].dataset.state, els['prestige-btn'].textContent], [true, 'max', 'المستوى الأقصى ×2']);
  ctx.prestigeTap();
  assert.deepEqual([calls.ops.length, plain(calls.haptic)], [0, ['error']]);
});

test('two taps: the first only asks, the second does it once — the same reset the server applies — and a stale ask expires', () => {
  const { ctx, els, calls, tick } = sandbox({ owned: { click: 3, bot: 15, rig: 3 } });
  ctx.renderPrestige();
  ctx.prestigeTap();
  assert.equal(els['prestige-btn'].dataset.state, 'confirm'); assert.equal(els['prestige-btn'].textContent, 'اضغط مرة أخرى للتأكيد: يُصفَّر 15 عاملاً و3 منصّة');
  assert.deepEqual([calls.ops.length, plain(calls.haptic), ctx.state.prestige, ctx.state.owned.bot], [0, ['warning'], 0, 15], 'asking changes nothing');
  assert.equal(calls.timers.length, 1); assert.ok(calls.timers[0].ms > 6000, 'the ask times itself out');
  tick(2000);
  ctx.prestigeTap();
  assert.deepEqual(plain(calls.ops), [{ type: 'prestige' }], 'exactly one op, carrying nothing the client could inflate');
  assert.deepEqual([ctx.state.owned.bot, ctx.state.owned.rig, ctx.state.prestige, ctx.state.costs.bot, ctx.state.costs.rig, ctx.state.passiveIncome], [0, 0, 1, 200, 1000, 0], 'the reset shows at once');
  assert.deepEqual([ctx.state.owned.click, ctx.state.gold, ctx.state.ores.copper, ctx.state.equipment.pickaxe], [3, 123, 3, 1], 'and nothing else moved');
  assert.deepEqual(plain(calls.haptic), ['warning', 'success']); assert.ok(calls.updateUI >= 1 && calls.save >= 1);
  assert.equal(els['prestige-level'].textContent, 'المستوى 1 من 10 · دخلك السلبي +10%', 'the card already shows the new level');
  assert.equal(els['prestige-btn'].dataset.state, 'locked');
  ctx.prestigeTap();                                    // a third tap finds nothing left to give
  assert.equal(calls.ops.length, 1, 'no second op'); assert.equal(ctx.state.prestige, 1);
  // a stale ask: tap, wait past the window, tap again — it asks again instead of acting
  const stale = sandbox({ owned: { click: 0, bot: 15, rig: 3 } });
  stale.ctx.renderPrestige(); stale.ctx.prestigeTap(); stale.tick(7000); stale.ctx.prestigeTap();
  assert.equal(stale.calls.ops.length, 0, 'the old confirmation does not carry over'); assert.equal(stale.ctx.state.prestige, 0);
  assert.equal(stale.els['prestige-btn'].dataset.state, 'confirm', 'it is a fresh ask');
  stale.tick(1000); stale.ctx.prestigeTap();
  assert.equal(stale.calls.ops.length, 1, 'and the next tap inside the new window does it');
  // the timer's re-render puts a lapsed ask back to "ready"
  const timed = sandbox({ owned: { click: 0, bot: 15, rig: 3 } });
  timed.ctx.renderPrestige(); timed.ctx.prestigeTap(); timed.tick(6200); timed.calls.timers[0].fn();
  assert.equal(timed.els['prestige-btn'].dataset.state, 'ready', 'the question goes away on its own');
});

test('nothing happens when the stock is short, or without the server', () => {
  const short = sandbox({ owned: { click: 0, bot: 14, rig: 3 } });
  short.ctx.renderPrestige(); short.ctx.prestigeTap(); short.ctx.prestigeTap();
  assert.deepEqual([short.calls.ops.length, plain(short.calls.haptic), short.ctx.state.prestige], [0, ['error', 'error'], 0]);
  const offline = sandbox({ owned: { click: 0, bot: 15, rig: 3 }, serverMode: false });
  offline.ctx.renderPrestige();
  assert.deepEqual([offline.els['prestige-btn'].disabled, offline.els['prestige-btn'].textContent], [true, 'التبجيل يتطلب اتصالاً بالخادم']);
  offline.ctx.prestigeTap(); offline.ctx.prestigeTap();
  assert.deepEqual([offline.calls.ops.length, offline.ctx.state.prestige, offline.ctx.state.owned.bot], [0, 0, 15], 'without the server nothing is reset: the server is what makes it real');
});

test('the card is only redrawn when something it shows changed (updateUI calls it ten times a second)', () => {
  const { ctx, els } = sandbox({ owned: { click: 0, bot: 12, rig: 2 } });
  ctx.renderPrestige();
  els['prestige-needs'].innerHTML = 'MARK'; els['prestige-level'].textContent = 'MARK';
  ctx.renderPrestige(); ctx.renderPrestige();
  assert.equal(els['prestige-needs'].innerHTML, 'MARK'); assert.equal(els['prestige-level'].textContent, 'MARK', 'untouched while nothing changed');
  ctx.state.owned.bot = 13; ctx.renderPrestige();
  assert.match(els['prestige-needs'].innerHTML, /13\/15/, 'a changed count redraws it');
  els['prestige-needs'].innerHTML = 'MARK'; ctx.renderPrestige(true);
  assert.notEqual(els['prestige-needs'].innerHTML, 'MARK', 'and a forced draw always draws');
});

test('wiring: the card sits in the shop between the rig and the ore store, the rules load first, the shop lines follow the level', () => {
  const shop = cut('<main id="tab-shop"', '<!-- TAB 3: FRIENDS');
  assert.ok(shop.indexOf('id="btn-upgrade-rig"') < shop.indexOf('id="prestige-card"') && shop.indexOf('id="prestige-card"') < shop.indexOf('id="ore-storage"'), 'under the rig, above the ore store');
  const card = /<section id="prestige-card"[\s\S]*?<\/section>/.exec(shop)[0];
  for (const id of ['prestige-level', 'prestige-mult', 'prestige-needs', 'prestige-btn']) assert.match(card, new RegExp(`id="${id}"`), id);
  assert.match(card, /<button id="prestige-btn" type="button" class="prestige-btn" disabled><\/button>/);
  assert.match(card, /<use href="#i-sparkle"\/>/); assert.match(html, /<symbol id="i-sparkle"/);
  assert.match(card, /الذهب والخامات والمعدات والمناجم والنقرات لا تتأثر/, 'it says what is NOT touched');
  assert.match(card, /aria-live="polite"/);
  assert.doesNotMatch(card, EMOJI, 'the card is emoji-free'); assert.doesNotMatch(card, /\sonclick=/);
  for (const id of ['prestige-card', 'btn-upgrade-rig', 'ore-storage', 'prestige-btn', 'prestige-needs']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} appears once`);
  assert.match(html, /for \(const \[type, one\] of \[\['bot', \{ bot: 1 \}\], \['rig', \{ rig: 1 \}\]\]\) \{\s*\n\s*const gainEl = document\.getElementById\(`gain-\$\{type\}`\), text = fmtRate\(PrestigeRules\.passiveFor\(one, state\.prestige\)\);\s*\n\s*if \(gainEl && gainEl\.textContent !== text\) gainEl\.textContent = text;/, 'updateUI keeps the shop lines at the level\'s rate');
  assert.ok(html.indexOf('/platform-rules.js') < html.indexOf('/prestige-rules.js?v=1') && html.indexOf('/prestige-rules.js?v=1') < html.indexOf('<script>\n'), 'the shared rules load before the page script');
  assert.match(html, /document\.getElementById\('prestige-btn'\)\?\.addEventListener\('click', prestigeTap\);/);
  assert.match(html, /renderPrestige\(\);\n/, 'updateUI keeps the card current');
  assert.match(shop, /\+<span id="gain-bot">5<\/span> ذهب\/ثانية/); assert.match(shop, /\+<span id="gain-rig">25<\/span> ذهب\/ثانية/);
  assert.match(html, /profitCounter\.innerText = `\+\$\{fmtRate\(passiveGain\(\)\)\}`;/, 'the income chip shows halves');
  assert.match(html, /prestigeDone\.length\) setSyncStatus\(`🌟 تبجيل مُعتمد: المستوى \$\{prestigeDone\[prestigeDone\.length - 1\]\.level\}/);
  assert.match(html, /prestige: 0,\s+\/\/ مستوى التبجيل/, 'the default state carries the level');
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.build.includes('node --check public/prestige-rules.js'), 'the build syntax-checks the rules');
  for (const sel of ['.prestige-card{', '.prestige-head{', '.prestige-need{', '.prestige-bar{', '.prestige-btn{', '.prestige-btn[data-state="confirm"]{', '.prestige-btn:disabled{']) assert.ok(css.includes(sel), sel);
  assert.doesNotMatch(css.slice(css.indexOf('/* التبجيل (3ج)')), EMOJI);
});
