// V12: جولة اللعب الحسّي — لقطتان مرجعيتان للمراجعة البصرية، ونبضة اللمس لكل زر فعل.
// (1) المحرك: اللحظتان تُبلَغان فعلاً بالسياسة نفسها المستخدمة في القياس، بلا خادم وبلا تغيير صحة.
// (2) الواجهة: زرا اللقطة ومسارس التثبيت، ونبضة ACTION_BITS على pointerdown.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const GEARS = [0, 2, 5];
const loadoutOf = (g) => ({ pickaxe: g, armor: g, drill: g });

test('لقطة الزعيم: المرحلة الثانية وإنذار الصدمة الكاسرة ما زال أمام اللاعب', () => {
  for (const gear of GEARS) {
    const sim = R.capture.sim('boss', 'miner', { loadout: loadoutOf(gear) });
    assert.ok(sim, `boss capture must be reachable at gear L${gear}`);
    const boss = sim.enemies[0];
    assert.equal(sim.status, 'playing', 'the capture freezes a live duel, not a finished one');
    assert.equal(boss.state, 'windup', 'the warning is on screen');
    assert.equal(boss.attack, 'overhead', 'the guard-breaking slam is the moment being shown');
    assert.ok(boss.phase >= 2, 'boss is in phase 2 or beyond');
    assert.ok(boss.hp > 0 && boss.hp < boss.maxHp, 'boss HP is real damage from real play, not scripted');
    const warn = boss.ai.windup;
    assert.ok(boss.timer >= 16 && boss.timer <= warn - 12, `warning still ahead (timer ${boss.timer}/${warn})`);
    assert.ok(sim.player.hearts > 0, 'player is alive in the frozen frame');
  }
});

test('لقطة الموجة: موجة حيّة على وشك ملامسة قدمي اللاعب وهو يقفز فوقها', () => {
  for (const gear of GEARS) {
    const sim = R.capture.sim('wave', 'miner', { loadout: loadoutOf(gear) });
    assert.ok(sim, `wave capture must be reachable at gear L${gear}`);
    const live = (sim.waves || []).filter((w) => !(w.delay > 0));
    assert.ok(live.length >= 1, 'a live wind wave exists');
    const p = sim.player, w = live[0];
    const gap = Math.abs((w.x + w.w / 2) - (p.x + p.w / 2));
    assert.ok(gap >= 45 && gap <= 95, `wave is close (gap ${Math.round(gap)} px)`);
    assert.equal(p.grounded, false, 'the hero has left the ground');
    assert.ok(p.vy < 0, 'and is still rising — the jump is readable, not mid-fall');
    // القلوب في اللقطة نتيجة لعب حقيقي (قد يكون أصابها ضرر سابق)، لكن السقف لم يُرفع ولا أُعيد ملؤها
    assert.equal(p.maxHearts, 4, 'arena hearts stay at 4 — the cap did not move for the screenshot');
    assert.ok(p.hearts >= 1 && p.hearts <= p.maxHearts, 'hearts are a real in-duel value');
  }
});

test('اللقطتان حتميتان: نفس البذرة ونفس السياسة تعطيان نفس الإطار', () => {
  for (const kind of ['boss', 'wave']) {
    const a = R.capture.sim(kind, 'miner', { loadout: loadoutOf(2) });
    const b = R.capture.sim(kind, 'miner', { loadout: loadoutOf(2) });
    assert.equal(a.tick, b.tick, `${kind}: same tick`);
    assert.equal(a.enemies[0].hp, b.enemies[0].hp, `${kind}: same rival HP`);
    assert.equal(a.player.x, b.player.x, `${kind}: same player position`);
  }
});

test('سياسة الالتقاط تحترم قناع الإدخال: لا بتات خارج MAX_MASK ولا يسار+يمين معاً', () => {
  for (const kind of ['boss', 'wave']) {
    const sim = R.capture.sim(kind, 'miner', { loadout: loadoutOf(0) });
    for (let t = 0; t < 240 && sim; t++) {
      const mask = R.capture.mask(sim);
      assert.ok(mask >= 0 && mask <= R.MAX_MASK, `mask ${mask} inside MAX_MASK`);
      assert.ok(!((mask & R.INPUT.LEFT) && (mask & R.INPUT.RIGHT)), 'never both directions');
      if (sim.status !== 'playing') break;
      R.step(sim, mask);
    }
  }
});

test('الواجهة: زرّا اللقطة موجودان ويظهران خارج المبارزة فقط', () => {
  const html = read('public/index.html');
  assert.match(html, /onclick="arenaShot\('boss'\)"/, 'a boss-shot button');
  assert.match(html, /onclick="arenaShot\('wave'\)"/, 'a wave-shot button');
  assert.match(html, /class="arena-shots"/, 'grouped and labelled');
  assert.match(html, /body\.duel-live \.arena-shots \{ display: none; \}/, 'hidden during a real duel');
  const shot = html.slice(html.indexOf('function arenaShot'), html.indexOf('function startArenaDuel'));
  assert.match(shot, /game\.arenaSnapshot\(kind\)/, 'it goes through the arena controller');
  assert.doesNotMatch(shot, /fetch\(|jpost\(|api\//, 'no server call: a capture never starts a run');
});

test('واجهة المسرح: اللقطة تُجمّد العرض فقط، والتلميح يبقى حتى تُلغى', () => {
  const game = read('public/platform-game.js');
  assert.match(game, /arenaSnapshot,\s*arenaSnapshotOff/, 'both entry points are exposed');
  // التثبيت: خطوة محاكاة متوقفة عند التجميد
  assert.match(game, /if \(!arenaFrozen\) arenaStep\(\)/, 'a frozen snapshot stops stepping the simulation');
  // التلميح الثابت: ms ≤ 0 لا يضع مؤقّتاً، ويُمسح بـ arenaHintHide
  const hint = game.slice(game.indexOf('function arenaHint'), game.indexOf('function arenaHintHide'));
  assert.match(hint, /if \(ms > 0\) arenaHintTimer = setTimeout/, 'ms ≤ 0 keeps the hint on screen');
  const snap = game.slice(game.indexOf('function arenaSnapshot('), game.indexOf('function showArenaPreview('));
  assert.match(snap, /arenaHint\(R\.DUEL\.phase2Hint, 0\)/, 'the boss shot pins the real phase-2 hint text');
  assert.match(snap, /R\.capture\.sim\(/, 'the moment comes from the shared engine policy, not a hardcoded state');
});

test('اللمس: كل زر فعل يُرسل نبضة إطار واحد حتى لا تُفقد اللمسة السريعة', () => {
  const game = read('public/platform-game.js');
  const bits = /const ACTION_BITS = ([^;]+);/.exec(game);
  assert.ok(bits, 'ACTION_BITS is defined in the pointer path');
  const expected = ['JUMP', 'ATTACK', 'SKILL', 'DEFEND', 'DODGE', 'HEAVY'].every((k) => bits[1].includes(`R.INPUT.${k}`));
  assert.ok(expected, `action mask covers every action button: ${bits[1]}`);
  assert.match(game, /duelPulses\.set\(`d:\$\{e\.pointerId\}`, mask & ACTION_BITS\)/, 'pointerdown pulses the action bits');
  // مسار الساحة فقط: نبضة المنجم تبقي 12 (قفز/تعدين) لأن المنجم لا يملك مهارة ولا صدّ ولا مراوغة
  const pad = game.slice(game.indexOf('function duelButtons'), game.indexOf('function arenaHint'));
  assert.doesNotMatch(pad, /mask & 12\b/, 'the arena pad no longer drops a fast skill/guard/dodge tap');
});
