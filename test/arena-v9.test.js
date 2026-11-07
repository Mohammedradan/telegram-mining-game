// V9: توازن الساحة (قلب إضافي، استشفاء 52، ارتداد بدل الانتقال)، مهارة «ظل الساكورا»،
// وذكاء خصم يقرأ حالة اللاعب — مع الحفاظ على الحتمية وإعادة التشغيل الخادمية.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const R = require('../public/platform-rules');

const DUEL = { zone: 0, mode: 'duel' };
const MINE = { zone: 0 };

// ---------- 1) الأرقام المعتمدة ----------
test('V9 balance: four hearts in the arena only, the mining run keeps its own hearts', () => {
  const duel = R.create('miner', 7, DUEL);
  const mine = R.create('miner', 7, MINE);
  assert.equal(duel.player.maxHearts, 4, 'the arena grants one extra heart');
  assert.equal(duel.player.hearts, 4);
  assert.equal(mine.player.maxHearts, 3, 'mining is untouched');
  assert.equal(mine.player.hearts, 3);
  assert.equal(R.DUEL.extraHearts, 1);
  assert.equal(R.DUEL.rival.recover, 52, 'the rival recovery window is 52 frames');
  assert.equal(R.create('miner', 7, DUEL).enemies[0].ai.recover, 52);
  assert.equal(R.COMBAT.heavy.damage, 3, 'the heavy hit stays at 3');
  assert.equal(R.create('miner', 7, DUEL).enemies[0].maxHp, 34, 'the first-zone rival stays at 34 HP');
  // الاقتصاد لم يتحرك
  const won = R.create('miner', 7, DUEL);
  won.status = 'won';
  assert.equal(R.rewardFor(won), R.DUEL.reward, 'duel reward pool unchanged');
});

// ---------- 2) الارتداد بدل الانتقال ----------
test('V9: a duel hit knocks the player back instead of teleporting to the mine checkpoint', () => {
  const s = R.create('miner', 7, DUEL);
  s.player.x = 300;
  const before = s.player.x;
  // خصم يهجم على اللاعب: ننتظر حتى تُسجَّل إصابة
  let hit = false;
  for (let i = 0; i < 400 && !hit; i++) {
    R.step(s, 0);
    if (s.events.some((e) => e.type === 'hurt')) hit = true;
  }
  assert.equal(hit, true, 'the rival landed a hit');
  assert.equal(s.player.hearts, 3, 'one heart lost');
  assert.ok(Math.abs(s.player.x - before) < 120, 'the player stays inside the fight (no teleport to x=64)');
  assert.ok(s.player.x > 24, 'inside the arena walls');
  assert.ok(s.player.knock.ticks > 0 || s.player.knock.vx !== 0, 'a knockback was applied');
  // التعدين كما كان: فرع نقطة الحفظ باقٍ حرفياً في المحرك (مسار الساحة وحده تغيّر)
  const rules = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'platform-rules.js'), 'utf8');
  assert.match(rules, /\} else \{\n\s+p\.x = s\.checkpoint; p\.y = 240; p\.vx = 0; p\.vy = 0;/, 'mining keeps the checkpoint reset');
  assert.match(rules, /if \(s\.mode === 'duel'\) \{\n\s+\/\/ في الساحة لا يعود اللاعب إلى نقطة حفظ المنجم/, 'only the arena branch changed');
  // ولا يوجد في الساحة أي قفز إلى نقطة الحفظ أثناء القتال
  assert.equal(s.player.x === s.checkpoint && s.player.hearts < s.player.maxHearts, false, 'no checkpoint teleport in the duel');
});

// ---------- 3) ظل الساكورا ----------
test('V9 skill: shadow blossom costs guard breath, has a cooldown, and lands two real hits', () => {
  const s = R.create('miner', 7, DUEL);
  s.player.x = 250; s.enemies[0].x = 300;
  const stamina0 = s.player.guard.stamina;
  const hp0 = s.enemies[0].hp;
  R.step(s, R.INPUT.SKILL);
  assert.equal(s.player.guard.stamina, stamina0 - R.DUEL.skill.cost, 'the skill is paid from the visible breath bar');
  assert.equal(s.player.skillCooldown, R.DUEL.skill.cooldown, 'and starts its cooldown');
  assert.ok(s.player.skill, 'the dash is active');
  assert.ok(s.player.invulnerable > 0, 'i-frames during the dash');
  const seen = [];
  for (let i = 0; i < 24; i++) {
    R.step(s, 0);
    for (const e of s.events) if (e.type === 'skill_hit') seen.push(e.hits);
  }
  assert.equal(seen.length, 2, 'two separate strike moments');
  assert.ok(hp0 - s.enemies[0].hp >= 6, 'both hits landed for real damage');
  assert.equal(s.player.skill, null, 'the dash ends');
  // لا تُكرَّر: مهلة + نَفَس
  const blocked = R.create('miner', 7, DUEL);
  blocked.player.x = 250; blocked.enemies[0].x = 300;
  R.step(blocked, R.INPUT.SKILL);
  R.step(blocked, R.INPUT.SKILL);
  assert.ok(blocked.player.skillCooldown > R.DUEL.skill.cooldown - 3, 'a second press does not reset the cooldown');
  // نَفَس غير كافٍ ⇒ لا مهارة
  const tired = R.create('miner', 7, DUEL);
  tired.player.guard.stamina = 10; // أقل بكثير من الكلفة، ولا يكفيها إطار تجديد واحد
  R.step(tired, R.INPUT.SKILL);
  assert.equal(tired.player.skill, null, 'no skill without enough breath');
  // ومهارة التعدين لم تُمسّ: عامل المنجم ما زال يضرب الصدمة الأرضية في المنجم
  const mine = R.create('miner', 7, MINE);
  R.step(mine, R.INPUT.SKILL);
  assert.equal(mine.player.skill, null, 'the duel dash never exists in a mining run');
  assert.equal(mine.player.skillCooldown, mine.player.skillMaxCooldown, 'the mining skill still fires as before');
});

// ---------- 4) ذكاء الخصم ----------
test('V9 rival AI: reads the player state, punishes mistakes, and stays deterministic', () => {
  const run = () => {
    const s = R.create('miner', 99, DUEL);
    const picks = [];
    for (let i = 0; i < 900; i++) {
      // لاعب يقترب ويضرب أحياناً ويرفع درعه أحياناً — لنرى ردود الخصم على الحالات الثلاث
      const rival = s.enemies[0];
      const dx = (rival.x + rival.w / 2) - (s.player.x + s.player.w / 2);
      const close = Math.abs(dx) < 56;
      const mask = !close ? (dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT)
        : i % 9 === 0 ? R.INPUT.DEFEND : i % 3 === 0 ? R.INPUT.ATTACK : 0;
      R.step(s, mask);
      for (const e of s.events) if (e.type === 'boss_windup') picks.push(`${e.attack}${e.counter ? '*' : ''}`);
    }
    return picks;
  };
  const a = run(), b = run();
  assert.deepEqual(a.join(','), b.join(','), 'the same seed produces the same sequence of attacks (no Math.random)');
  const kinds = new Set(a.map((p) => p.replace('*', '')));
  assert.ok(kinds.size >= 3, 'the rival mixes several attacks instead of repeating one pattern');
  assert.ok(a.some((p) => p.endsWith('*')), 'it uses a fast counter when the player is exposed');
  // الرد السريع مرتبط بحالة اللاعب الحقيقية
  const rules = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'platform-rules.js'), 'utf8');
  assert.match(rules, /const counter = b\.attack === 'slash' && !p\.swing && p\.attack > 4;/, 'the counter reads the player swing recovery');
  assert.match(rules, /if \(p\.guard\.active && cycle % 2 === 0 && dist < 110\) return 'overhead';/, 'a raised guard is answered with the unblockable');
  assert.match(rules, /if \(p\.combo >= 2 && dist < 120 && cycle % 2 === 1\) return 'wave';/, 'a mashing player is answered with a wave');
});

// ---------- 5) قياس التوازن ----------
test('V9 balance matrix: skill output is monotonic and every recorded duel replays exactly', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'duel-balance.cjs'), '--json'], { encoding: 'utf8', timeout: 120000 });
  const res = JSON.parse(out);
  const win = (bot) => res[bot].all.winRate;
  assert.ok(win('novice') < win('intermediate'), `novice ${win('novice')}% must lose more than intermediate ${win('intermediate')}%`);
  assert.ok(win('intermediate') <= win('expert'), `intermediate ${win('intermediate')}% must not beat expert ${win('expert')}%`);
  assert.ok(win('expert') >= 60, `an expert should win most duels (got ${win('expert')}%)`);
  assert.ok(win('novice') <= 70, `button mashing must not be a winning strategy everywhere (got ${win('novice')}%)`);
  for (const bot of ['novice', 'intermediate', 'expert']) {
    for (const zone of [0, 1, 2, 3]) {
      assert.equal(res[bot][zone].replaySame, true, `${bot} z${zone}: server replay matches the client`);
      assert.ok(res[bot][zone].avgSeconds > 4 && res[bot][zone].avgSeconds < 40, `${bot} z${zone}: fights last a sane time`);
    }
  }
  // المتقدم يجب أن يتلقّى ضربات أقل من المبتدئ
  const taken = (bot) => [0, 1, 2, 3].reduce((n, z) => n + res[bot][z].avgTaken, 0) / 4;
  assert.ok(taken('expert') < taken('novice'), `expert takes ${taken('expert').toFixed(2)} hits vs novice ${taken('novice').toFixed(2)}`);
});
