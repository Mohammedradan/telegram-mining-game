'use strict';
// واجهة مهام المغامرة (الدفعة 3ب) في لوحة المهام: دوال العرض والاستلام تُستخرج من الصفحة نفسها وتعمل بعناصر وهمية
// (ما يُختبر هو الشيفرة المرسَلة فعلاً لا نسخة منها)، إضافة إلى ربط الصفحة (الصندوق، التبنّي، الرسالة).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Quests = require('../quests');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'platform.css'), 'utf8');
const EMOJI = /\p{Extended_Pictographic}/u;

// the page's own code, from the icon helper to the end of the claim function
const from = html.indexOf('    function questIconHtml(icon) {'), to = html.indexOf("    document.getElementById('quests-list')?.addEventListener('click'");
assert.ok(from > 0 && to > from, 'the quests code was found in the page');
const SOURCE = html.slice(from, to);

function sandbox({ serverMode = true, quests = Quests.view(Quests.normalize(), [0, 0, 0, 0, 0, 0]) } = {}) {
  const els = {
    'quests-list': { innerHTML: '', dataset: {} },
    'quests-count': { textContent: '', classList: { on: false, toggle(name, on) { if (name === 'quests-ready') this.on = Boolean(on); } } },
  };
  const calls = { ops: [], haptic: [], updateUI: 0, save: 0 };
  const ctx = {
    serverMode, profile: { quests: JSON.parse(JSON.stringify(quests)) }, state: { gold: 100, totalEarned: 100 },
    fmt: (n) => Math.floor(n).toLocaleString('en-US'),
    haptic: (k) => calls.haptic.push(k), enqueueOp: (op) => calls.ops.push(op), updateUI: () => { calls.updateUI++; }, save: () => { calls.save++; },
    document: { getElementById: (id) => els[id] || null },
  };
  vm.createContext(ctx);
  vm.runInContext(`${SOURCE}\nthis.renderQuests = renderQuests; this.claimQuest = claimQuest; this.questIconHtml = questIconHtml;`, ctx);
  return { ctx, els, calls };
}
const withCounters = (facts, wins, claimed = {}) => { const c = Quests.addRun(Quests.normalize({ claimed }), facts); return Quests.view(c, wins || [0, 0, 0, 0, 0, 0]); };
// one row's markup: the list split at each row, the piece that holds this id
const rowOf = (list, id) => { const piece = list.innerHTML.split('<div class="quest-row ').slice(1).find((p) => p.includes(`data-quest="${id}"`)); assert.ok(piece, `row ${id}`); return `<div class="quest-row ${piece}`; };

test('render: twelve rows; a ready quest has a claim button, a claimed one a tick, the others a count — all SVG, no emoji', () => {
  const view = withCounters({ mined: 37, defeated: 12, ores: { copper: 40, iron: 11 } }, [2, 1, 0, 0, 0, 0], { first_rock: 5 });
  const { ctx, els } = sandbox({ quests: view });
  ctx.renderQuests();
  assert.equal((els['quests-list'].innerHTML.match(/class="quest-row/g) || []).length, 12);
  const ready = rowOf(els['quests-list'], 'copper_40'), claimed = rowOf(els['quests-list'], 'first_rock'), partial = rowOf(els['quests-list'], 'guards_50'), wonRow = rowOf(els['quests-list'], 'win_stone');
  assert.match(ready, /quest-row ready/); assert.match(ready, /<button type="button" class="quest-claim" data-quest-claim="copper_40">استلم<\/button>/);
  assert.match(ready, /<i class="ore-dot ore-copper"><\/i>/, 'an ore quest wears the ore\'s own colour');
  assert.match(claimed, /quest-row claimed/); assert.match(claimed, /<span class="quest-done"><svg class="ui-icon" aria-hidden="true"><use href="#i-check"\/><\/svg>استُلمت<\/span>/); assert.doesNotMatch(claimed, /quest-claim/);
  assert.match(partial, /<span class="quest-count">12\/50<\/span>/); assert.doesNotMatch(partial, /quest-claim/); assert.match(partial, /style="width:24%"/);
  assert.match(wonRow, /quest-row ready/, 'a win from the mines record is claimable too');
  assert.match(rowOf(els['quests-list'], 'rocks_200'), /<span class="quest-count">37\/200<\/span>/);
  assert.match(partial, /\+150 ذهب · \+60 خبرة/, 'each row shows its reward');
  assert.doesNotMatch(els['quests-list'].innerHTML, EMOJI, 'the list is emoji-free');
  assert.equal(els['quests-count'].textContent, '1/12 · 2 جاهزة'); assert.equal(els['quests-count'].classList.on, true, 'the summary lights up while something is ready');
  const none = sandbox();
  none.ctx.renderQuests();
  assert.equal(none.els['quests-count'].textContent, '0/12'); assert.equal(none.els['quests-count'].classList.on, false);
  assert.doesNotMatch(none.els['quests-list'].innerHTML, /quest-claim|quest-done/);
});

test('render: nothing from the server is trusted as markup, and an unchanged list is not rebuilt', () => {
  const view = withCounters({ mined: 1 }, null);
  view.items[1].title = '<img src=x onerror=alert(1)>'; view.items[1].desc = '"><script>alert(2)</script>';
  view.items[2].icon = 'i-pickaxe"/><script>alert(3)</script>'; view.items[3].icon = 'ore:co<>pper'; view.items[0].id = 'first"><b>x';
  const { ctx, els } = sandbox({ quests: view });
  ctx.renderQuests();
  const out = els['quests-list'].innerHTML;
  assert.doesNotMatch(out, /<img|<script|<b>x/, 'titles, descriptions, ids and icons never become tags (the escaped text may still read "onerror", harmlessly)');
  assert.doesNotMatch(out, /data-quest(-claim)?="[^"]*[<>][^"]*"/, 'an id cannot break out of its attribute');
  assert.match(out, /data-quest-claim="first&quot;&gt;&lt;b&gt;x"/, 'the claim button of a ready quest carries the escaped id');
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out, /<use href="#i-pickaxescriptalertscript"\/>/, 'an icon name keeps letters and dashes only: the hostile one lost every quote, bracket, slash and parenthesis');
  assert.match(out, /<i class="ore-dot ore-copper"><\/i>/);
  // same data: untouched; changed data: rebuilt
  els['quests-list'].innerHTML = 'MARK';
  ctx.renderQuests();
  assert.equal(els['quests-list'].innerHTML, 'MARK', 'no rebuild when nothing changed (the panel is refreshed after every reply)');
  ctx.profile.quests.items[2].value = 5;
  ctx.renderQuests();
  assert.notEqual(els['quests-list'].innerHTML, 'MARK', 'a changed counter rebuilds it');
  // offline or no quests yet: the placeholder stays
  const offline = sandbox({ serverMode: false });
  offline.els['quests-list'].innerHTML = 'PLACEHOLDER'; offline.ctx.renderQuests();
  assert.equal(offline.els['quests-list'].innerHTML, 'PLACEHOLDER');
  const empty = sandbox(); empty.ctx.profile.quests = undefined; empty.els['quests-list'].innerHTML = 'PLACEHOLDER'; empty.ctx.renderQuests();
  assert.equal(empty.els['quests-list'].innerHTML, 'PLACEHOLDER');
});

test('render: a counter beyond its target never draws a bar wider than the track', () => {
  const view = withCounters({ mined: 1 }, null);
  view.items[9].value = 500; view.items[9].done = true;   // rocks_200 reported with more than its target (a server bug must not break the layout)
  view.items[1].value = -5;                               // and a negative one
  const { ctx, els } = sandbox({ quests: view });
  ctx.renderQuests();
  assert.match(rowOf(els['quests-list'], 'rocks_200'), /style="width:100%"/);
  assert.match(rowOf(els['quests-list'], 'win_stone'), /style="width:0%"/);
});

test('claim: shows the gold at once, sends exactly one quest op, and refuses anything unfinished, claimed or offline', () => {
  const view = withCounters({ mined: 1 }, null);
  const { ctx, calls } = sandbox({ quests: view });
  ctx.renderQuests();
  assert.match(rowOf(ctx.document.getElementById('quests-list'), 'first_rock'), /quest-claim/, 'before the claim the row offers the button');
  ctx.claimQuest('first_rock');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.ops)), [{ type: 'quest', id: 'first_rock', expected: 50 }]);
  assert.equal(ctx.state.gold, 150); assert.equal(ctx.state.totalEarned, 150);
  assert.equal(ctx.profile.quests.items.find((i) => i.id === 'first_rock').claimed, true);
  assert.equal(ctx.profile.quests.claimedCount, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.haptic)), ['success']); assert.ok(calls.updateUI >= 1 && calls.save >= 1);
  const shown = rowOf(ctx.document.getElementById('quests-list'), 'first_rock');
  assert.match(shown, /quest-row claimed/); assert.doesNotMatch(shown, /quest-claim/, 'the row is redrawn at once: the button is gone, the tick is there');
  assert.equal(ctx.document.getElementById('quests-count').textContent, '1/12', 'and the summary follows');
  ctx.claimQuest('first_rock');                 // already claimed
  ctx.claimQuest('rocks_200');                  // not finished
  ctx.claimQuest('no_such_quest');              // unknown
  assert.equal(calls.ops.length, 1, 'still one op');
  assert.equal(ctx.state.gold, 150, 'and no more gold');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.haptic)), ['success', 'error', 'error', 'error']);
  const offline = sandbox({ serverMode: false, quests: view });
  offline.ctx.claimQuest('first_rock');
  assert.equal(offline.calls.ops.length, 0); assert.equal(offline.ctx.state.gold, 100); assert.deepEqual(JSON.parse(JSON.stringify(offline.calls.haptic)), ['error']);
});

test('wiring: the box sits under the weekly missions, the reply is adopted, a pending claim is replayed, and the message names the reward', () => {
  const panel = html.slice(html.indexOf('id="play-panel-missions"'), html.indexOf('</section>', html.indexOf('id="play-panel-missions"')));
  assert.ok(panel.indexOf('id="weekly-missions-box"') < panel.indexOf('id="quests-box"'), 'under the weekly missions');
  for (const id of ['quests-box', 'quests-list', 'quests-count', 'weekly-missions-box']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} appears once`);
  const box = /<details id="quests-box"[\s\S]*?<\/details>/.exec(panel)[0];
  assert.match(box, /<use href="#i-pickaxe"\/>/); assert.match(html, /<symbol id="i-pickaxe"/);
  assert.match(box, /id="quests-count"/); assert.match(box, /id="quests-list"/);
  assert.match(box, /لا الكلاسيكي ولا الحفر العميق/, 'it says what does not count');
  assert.match(box, /خارج سقف الذهب اليومي/, 'and that the gold is outside the daily cap');
  assert.doesNotMatch(box, EMOJI, 'the new box is emoji-free (SVG icons)');
  assert.doesNotMatch(box, /\sonclick=/, 'a delegated listener, no inline handler');
  assert.match(html, /document\.getElementById\('quests-list'\)\?\.addEventListener\('click', \(e\) => \{\s*\n\s*const btn = e\.target\?\.closest\?\.\('\[data-quest-claim\]'\);/);
  assert.match(html, /if \(data\.quests && Array\.isArray\(data\.quests\.items\)\) profile\.quests = data\.quests;/, 'every reply and the finish receipt refresh the list');
  assert.match(html, /if \(typeof renderQuests === 'function'\) renderQuests\(\);/);
  assert.match(html, /op\.type === 'achievement' \|\| op\.type === 'quest' \|\| op\.type === 'arena'/, 'a claim still pending is shown after the next adoption');
  assert.ok(html.indexOf("else if (questsDone.length)") > 0 && html.indexOf('else if (questsDone.length)') < html.indexOf('else if (achievementsDone.length)'));
  assert.match(html, /🧭 مهمة مغامرة مُعتمدة: \+\$\{questsDone\.reduce\(\(a, r\) => a \+ \(r\.gold \|\| 0\), 0\)\} 🪙 \+\$\{questsDone\.reduce\(\(a, r\) => a \+ \(r\.xp \|\| 0\), 0\)\} خبرة/);
  for (const sel of ['.quests-box{', '.quest-row{', '.quest-row.ready{', '.quest-row.claimed{', '.quest-ico{', '.quest-bar{', '.quest-claim{', '.quest-done{', '#quests-count.quests-ready{']) assert.ok(css.includes(sel), sel);
  assert.match(css, /\.quest-row\.ready\{border-color:rgba\(255,209,102,\.7\);box-shadow:/, 'a ready quest stands out with a gold border');
  assert.match(css, /\.quest-row\.claimed\{opacity:\.62\}/, 'a claimed one fades');
  assert.doesNotMatch(css.slice(css.indexOf('/* مهام المغامرة (3ب)')), EMOJI);
});
