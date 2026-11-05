// V8: قتال الأكشن على محرك المنصّات نفسه — سلسلة ضربات، ضربة ثقيلة، مراوغة بمناعة،
// وخصم بثلاثة أنماط هجوم أحدها كاسر للدرع. كل شيء حتمي: نفس الأقنعة = نفس النتيجة على الخادم.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const advance = (s, mask, ticks) => { for (let i = 0; i < ticks && s.status === 'playing'; i++) R.step(s, mask); };
const events = (s) => (s.events = []);

// مبارزة مُهيّأة: المبارز مُجمّد في وضع الترنّح (لا يهجم) ليُقاس ضرر اللاعب وحده.
function frozenDuel(seed = 7) {
  const s = R.create('miner', seed, { zone: 0, mode: 'duel' });
  const rival = s.enemies[0];
  s.player.x = 300; s.player.y = 262; s.player.grounded = true; s.player.facing = 1;
  rival.x = 330; rival.y = 236; rival.hp = 60; rival.maxHp = 60;
  rival.state = 'stagger'; rival.timer = 99999; rival.staggerCd = 99999; rival.vx = 0;
  return { s, rival };
}
// ضغطة واحدة ثم انتظار التبريد حتى تصبح الضربة التالية ممكنة دون أن تنتهي نافذة السلسلة (28 إطاراً).
function tapAttack(s, mask) {
  const hp = s.enemies[0].hp;
  events(s);
  R.step(s, mask);
  const hit = s.events.find(e => e.type === 'hit');
  return { dealt: hp - s.enemies[0].hp, hit, vx: s.enemies[0].vx };
}

test('V8 inputs: dodge, heavy and the analog walk bit are part of the recorded mask', () => {
  assert.equal(R.VERSION, 8);
  assert.equal(R.INPUT.DODGE, 128);
  assert.equal(R.INPUT.HEAVY, 256);
  assert.equal(R.INPUT.SOFT, 512);
  assert.equal(R.MAX_MASK, 1023, 'the server must accept exactly the bits the client can send');
  // كل بتات V8 مسجّلة في الإيصال، فإعادة التشغيل على الخادم تراها كما هي
  assert.equal(R.replay([{ mask: R.MAX_MASK, frames: 1 }]).ok, true);
  assert.equal(R.replay([{ mask: R.MAX_MASK + 1, frames: 1 }]).ok, false);
  // الضربة الأولى من السلسلة هي نفس ضربة V3 الواحدة تماماً: لا تُغيّر فيزياء الجولات القديمة
  const first = R.COMBAT.chain[0];
  assert.deepEqual([first.mul, first.reachBonus, first.knock], [1, 0, 100]);
  assert.ok(R.COMBAT.chain[2].finisher, 'the third hit is a finisher');
  assert.ok(R.COMBAT.heavy.damage > R.COMBAT.chain[2].mul, 'the heavy hit outdamages even the finisher');
});

test('V8 light chain: three timed presses escalate stage, reach and knockback — then reset', () => {
  const { s, rival } = frozenDuel();
  const first = tapAttack(s, R.INPUT.ATTACK);
  assert.equal(first.dealt, 1, 'stage 1 lands at once (no delay on the opening hit)');
  assert.equal(s.player.combo, 1);
  assert.ok(first.vx > 0, 'stage 1 pushes the rival like the V3 single hit');
  advance(s, 0, 14);
  const second = tapAttack(s, R.INPUT.ATTACK);
  assert.equal(second.dealt, 1);
  assert.equal(s.player.combo, 2);
  assert.ok(second.vx > first.vx, 'stage 2 pushes harder');
  advance(s, 0, 14);
  const third = tapAttack(s, R.INPUT.ATTACK);
  assert.equal(third.dealt, 2, 'the finisher hits twice as hard');
  assert.equal(s.player.combo, 3);
  assert.ok(third.vx > second.vx, 'the finisher really knocks the rival back');
  assert.ok(rival.x > 330, 'the rival was pushed by the finisher');
  // بعد انتهاء النافذة تعود السلسلة إلى الضربة الأولى
  advance(s, 0, R.COMBAT.chainWindow + 4);
  assert.equal(s.player.combo, 0, 'the chain window closes');
  const again = tapAttack(s, R.INPUT.ATTACK);
  assert.equal(again.dealt, 1, 'a fresh chain starts from stage 1');
});

test('V8 one swing deals damage once, even while the rival stays inside the box', () => {
  const { s } = frozenDuel();
  events(s);
  R.step(s, R.INPUT.ATTACK);
  let hits = s.events.filter(e => e.type === 'hit').length;
  for (let i = 0; i < 12; i++) { R.step(s, 0); hits += s.events.filter(e => e.type === 'hit').length; }
  assert.equal(hits, 1, 'a single swing registers exactly one hit (no double ticks of damage)');
});

test('V8 heavy attack: slow wind-up, three damage, and its own cooldown', () => {
  const { s } = frozenDuel();
  events(s);
  const hp = s.enemies[0].hp;
  R.step(s, R.INPUT.HEAVY);
  assert.equal(s.enemies[0].hp, hp, 'the heavy hit does not land on the same tick: there is a readable wind-up');
  assert.equal(s.player.pose, 'heavy', 'and the hero is drawn winding up');
  advance(s, 0, R.COMBAT.heavy.wind);
  assert.equal(hp - s.enemies[0].hp, R.COMBAT.heavy.damage, 'then it lands for three');
  // المهلة: لا تكرار فوري
  const hp2 = s.enemies[0].hp;
  R.step(s, R.INPUT.HEAVY);
  advance(s, 0, R.COMBAT.heavy.wind + 2);
  assert.equal(s.enemies[0].hp, hp2, 'the heavy attack cannot be spammed');
  assert.ok(s.player.heavyCooldown > 0);
});

test('V8 dodge: i-frames, a real dash, and a cooldown — never permanent immunity', () => {
  const s = R.create('miner', 5, { zone: 0, mode: 'duel' });
  const p = s.player;
  p.x = 300; p.y = 262; p.grounded = true; p.facing = 1;
  const startX = p.x;
  events(s);
  R.step(s, R.INPUT.DODGE);
  assert.equal(p.dodge.ticks, R.COMBAT.dodge.ticks - 1);
  assert.ok(p.invulnerable >= R.COMBAT.dodge.iframes - 1, 'the dodge grants its i-frames');
  assert.equal(s.events.some(e => e.type === 'dodge'), true);
  const dash = p.x - startX;
  assert.ok(dash > 4, `the dodge really moves the hero (${dash}px in one tick)`);
  // ضربة أثناء المناعة: لا قلب يفقد، ويُعلَن «تفاديت»
  s.waves.push({ x: p.x - 6, y: p.y + 6, w: 40, h: 32, vx: 0, ttl: 12, kind: 'wave' });
  const hearts = p.hearts;
  events(s);
  R.step(s, 0);
  assert.equal(p.hearts, hearts, 'the i-frames eat the hit');
  assert.equal(s.events.some(e => e.type === 'evade'), true);
  // بعد انتهاء المناعة يعود الضرر ممكناً، والمهلة تمنع مراوغة أخرى فوراً
  advance(s, 0, R.COMBAT.dodge.ticks + 2);
  events(s);
  R.step(s, R.INPUT.DODGE);
  assert.equal(p.dodge.ticks, 0, 'the dodge cooldown blocks an immediate second dodge');
  assert.ok(p.dodge.cooldown > 0);
  s.waves.push({ x: p.x - 6, y: p.y + 6, w: 40, h: 32, vx: 0, ttl: 12, kind: 'wave' });
  events(s);
  R.step(s, 0);
  assert.ok(p.hearts < hearts, 'without i-frames the same hit does hurt');
});

test('V8 guard: a slash is blocked and costs breath, but the overhead crushes through the shield', () => {
  const setup = (attack) => {
    const s = R.create('miner', 3, { zone: 0, mode: 'duel' });
    const p = s.player, b = s.enemies[0];
    p.x = 300; p.y = 262; p.grounded = true; p.facing = 1;
    b.x = 330; b.y = 236; b.aim = -1; b.state = 'windup'; b.attack = attack; b.timer = 1;
    return { s, p, b };
  };
  // الضربة القريبة: يصدّها الدرع
  const blocked = setup('slash');
  events(blocked.s);
  R.step(blocked.s, R.INPUT.DEFEND);
  assert.equal(blocked.p.hearts, blocked.p.maxHearts, 'blocking a slash costs no heart');
  assert.equal(blocked.s.events.some(e => e.type === 'guard'), true, 'and it reads as a block');
  assert.ok(blocked.p.guard.blocks >= 1);
  assert.ok(blocked.p.guard.stamina < R.GUARD.max, 'the shield is not free: a block spends breath');

  // الضربة الكاسرة: تتجاوز الدرع عمداً
  const crushed = setup('overhead');
  events(crushed.s);
  R.step(crushed.s, R.INPUT.DEFEND);
  assert.equal(crushed.p.guard.active, true, 'the shield was up…');
  assert.equal(crushed.s.events.some(e => e.type === 'guard'), false, '…and it did not block');
  assert.ok(crushed.p.hearts < crushed.p.maxHearts, 'the overhead is unblockable: it must be jumped or dodged');
});

test('V8 rival AI: four readable attacks, three phases, and it staggers when hit', () => {
  const attacks = new Set(), phases = new Set(), states = new Set();
  let staggered = false, charged = false, contactFree = true;
  // بوت بسيط يقترب ويضرب ويصدّ الإنذارات (مثل لاعب منتبه) لأكثر من بذرة حتى تظهر كل الأنماط
  for (const seed of ['2', '5', '7', '11', '23', '42']) {
    const s = R.create('miner', seed, { zone: 0, mode: 'duel' });
    let ticks = 0;
    while (s.status === 'playing' && ticks < 60 * 90) {
      const b = s.enemies[0], p = s.player;
      const dx = b.x + b.w / 2 - (p.x + p.w / 2), dist = Math.abs(dx);
      let mask = 0;
      if (b.state === 'windup' || b.state === 'charge' || s.waves.length) {
        mask |= R.INPUT.DEFEND;
        if (b.attack === 'overhead' && dist < 120) mask = R.INPUT.DODGE | (dx > 0 ? R.INPUT.LEFT : R.INPUT.RIGHT);
      } else if (dist > 50) mask |= dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
      else mask |= ticks % 40 < 12 ? R.INPUT.HEAVY : R.INPUT.ATTACK;
      R.step(s, mask);
      for (const e of s.events) {
        if (e.type === 'boss_windup') attacks.add(e.attack);
        if (e.type === 'boss_windup' && e.attack === 'overhead') assert.equal(e.unblockable, true, 'the unblockable attack is announced as such');
        if (e.type === 'enemy_stagger') staggered = true;
        if (e.type === 'boss_charge') charged = true;
      }
      phases.add(b.phase);
      states.add(b.state);
      // التلاصق وحده لا يؤذي: الخصم لا يضرب إلا بهجوم معلن
      if (b.state === 'approach' && R.overlap(s.player, b) && s.events.some(e => e.type === 'hurt')) contactFree = false;
      s.events.length = 0;
      ticks++;
    }
  }
  for (const attack of ['slash', 'wave', 'overhead', 'charge']) assert.equal(attacks.has(attack), true, `the rival uses ${attack}`);
  assert.deepEqual([...phases].sort(), [1, 2, 3], 'the fight passes through three phases as its health drops');
  assert.ok(states.has('approach') && states.has('windup') && states.has('recover'), 'it approaches, telegraphs and recovers');
  assert.equal(staggered, true, 'heavy hits actually stagger it');
  assert.equal(charged, true, 'the charge shows up');
  assert.equal(contactFree, true, 'touching the rival while it is only approaching deals no damage');
});

test('V8 duel determinism: a combat-heavy run replays to the exact same state on the server', () => {
  const run = () => {
    const s = R.create('miner', '13', { zone: 0, mode: 'duel' });
    const inputs = [];
    let mask = 0, frames = 0, ticks = 0;
    const push = (m) => { if (m === mask) { frames++; return; } if (frames) inputs.push({ mask, frames }); mask = m; frames = 1; };
    while (s.status === 'playing' && ticks < 60 * 90) {
      const b = s.enemies[0], p = s.player;
      const dx = b.x + b.w / 2 - (p.x + p.w / 2), dist = Math.abs(dx);
      let m = 0;
      if (b.state === 'windup') m |= b.attack === 'overhead' ? R.INPUT.DODGE : R.INPUT.DEFEND;
      else if (dist > 50) m |= dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
      else m |= ticks % 30 < 8 ? R.INPUT.HEAVY : R.INPUT.ATTACK;
      R.step(s, m); push(m); ticks++;
    }
    if (frames) inputs.push({ mask, frames });
    return { s, inputs };
  };
  const a = run(), b = run();
  assert.equal(a.s.status, b.s.status);
  assert.equal(a.s.tick, b.s.tick);
  assert.deepEqual(a.inputs, b.inputs, 'the same controller records the same masks');
  const replayed = R.replay(a.inputs, 'miner', '13', { zone: 0, mode: 'duel' });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.state.status, a.s.status);
  assert.equal(replayed.state.tick, a.s.tick);
  assert.equal(replayed.state.player.combo, a.s.player.combo);
  assert.equal(replayed.state.enemies[0].hp, a.s.enemies[0].hp);
  assert.equal(replayed.state.player.hearts, a.s.player.hearts);
});

test('V8 client wiring: dodge/heavy buttons, analog joystick bit, and saved control settings', () => {
  const html = read('public/index.html');
  const game = read('public/platform-game.js');
  const css = read('public/platform.css');
  const bosses = read('public/platform-bosses.js');
  assert.match(html, /data-platform-input="128"[^>]*aria-label="مراوغة"/, 'the phone pad has a dodge button');
  assert.match(html, /data-platform-input="256"[^>]*aria-label="ضربة قوية"/, 'and a heavy attack button');
  assert.match(html, /id="i-dash"/, 'the dodge icon is an inline SVG symbol');
  assert.match(html, /id="i-heavy"/);
  assert.match(game, /KeyV: 128/, 'V dodges on desktop');
  assert.match(game, /KeyL: 256/, 'L hits heavy on desktop');
  assert.match(game, /mask \|= 512/, 'a partial joystick push sends the analog walk bit');
  assert.match(game, /joystickDeadZone/, 'the stick has a dead zone');
  assert.match(game, /platform-controls/, 'control settings are stored locally, never on the account');
  assert.match(html, /data-ctl-size="lg"/, 'the settings panel can resize the controls');
  assert.match(html, /data-ctl-sensitivity=/, 'and change stick sensitivity');
  assert.match(css, /\.action-btn\.dodge-btn\{/);
  assert.match(css, /\.action-btn\.heavy-btn\{/);
  // على الهاتف تكفي العصا للحركة، وفي المبارزة يختفي زر الحفر: أزرار القتال تبقى واسعة بلا حجب للمشهد
  assert.match(css, /@media\(max-width:768px\)\{\.mine-controls-actions \.move-btn\{display:none\}\}/);
  assert.match(css, /\.mine-controls\.duel-mode \.mine-btn\{display:none\}/);
  assert.match(game, /classList\?\.toggle\('duel-mode'/, 'the pad itself drops the mining button during a duel');
  assert.match(bosses, /function duelist\(/, 'the rival has its own vector character, not the boss art');
  assert.match(bosses, /e\.attack === 'overhead'/, 'the unblockable attack gets its own warning lane');
});

test('V8 mining is untouched: one attack still deals exactly the hero damage', () => {
  const s = R.create('miner', 7, { zone: 0 });
  s.player.x = 245; s.player.y = 192; s.player.grounded = true; s.player.facing = 1;
  const goblin = s.enemies.find(e => e.id === 1);
  const hp = goblin.hp;
  R.step(s, R.INPUT.ATTACK);
  assert.equal(hp - goblin.hp, s.player.damage, 'the first press of the chain equals the legacy single hit');
  assert.equal(s.player.combo, 1);
});

test('V8 rival ladder: a deeper mine means a different fighter, not the same one with more health', () => {
  const names = new Set(), openings = new Set();
  for (const zone of [0, 2, 4]) {
    const b = R.create('miner', '7', { zone, mode: 'duel' }).enemies[0];
    names.add(b.name);
    openings.add(b.ai.phases[0].join(','));
    assert.equal(b.arch, zone >= 4 ? 2 : zone >= 2 ? 1 : 0, `zone ${zone} fields the right archetype`);
    assert.equal(b.armored, false, 'the rival never becomes an invulnerable wall');
  }
  assert.equal(names.size, 3, 'three named fighters');
  assert.equal(openings.size, 3, 'each one opens the fight differently');
  const shallow = R.create('miner', '7', { zone: 0, mode: 'duel' }).enemies[0];
  const deep = R.create('miner', '7', { zone: 5, mode: 'duel' }).enemies[0];
  assert.ok(deep.maxHp > shallow.maxHp, 'deeper = tougher');
  assert.ok(deep.ai.windup < shallow.ai.windup, 'and it telegraphs faster');
  assert.equal(R.duelStatus(R.create('miner', '7', { zone: 2, mode: 'duel' })).name, 'المقاتل المدرّع',
    'the HUD reads the archetype name from the simulation, not from the client');
  // نفس البذرة ونفس العمق = نفس المبارز تماماً (حتمية)
  assert.deepEqual(
    R.create('miner', '99', { zone: 3, mode: 'duel' }).enemies[0].ai.phases,
    R.create('miner', '99', { zone: 3, mode: 'duel' }).enemies[0].ai.phases);
});
