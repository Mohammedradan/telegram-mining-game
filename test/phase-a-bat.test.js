// المرحلة A (V19.2) — الخفاش عدوّ جوّي حقيقي.
// قبل الإصلاح: ارتفاعه كان يهتزّ حول baseY فقط، لا يلاحق ولا يلمس اللاعب ولا يُصاب من الأرض.
// القياس الموثّق وقتها: 1200 إطار من القفز والضرب تحته = صفر إصابة وصفر ضرر.
// هنا نُثبت السلوك الجديد على المحرك الحقيقي نفسه الذي يعيد الخادم تشغيله: إنذار ← انقضاض ← دوار ← صعود،
// وأنه يؤذي، وأنه يُتفادى بالحركة، وأنه يُقتل في نافذة الدوار، وأن ذلك يتحقق في كل منجم يظهر فيه.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/platform-rules');

const BATS = R.BAT;
// عزل الخفاش عن بقية المستوى: الاختبار يقيس هذا العدوّ وحده، لا حظّه من صعوبة المستوى.
function isolate(zone, seed = 4242, onlyId = null) {
  const s = R.create('miner', seed, { zone, goal: 0, mode: 'mine', loadout: {} });
  s.enemies = s.enemies.filter(e => e.flying && !e.dead && (onlyId === null || e.id === onlyId));
  s.hazards = [];
  s.rocks = [];
  s.gems = [];
  return s;
}
const center = e => e.x + e.w / 2;
const playerCenter = s => s.player.x + s.player.w / 2;
function standUnder(s, bat) {
  s.player.x = center(bat) - s.player.w / 2;
  s.player.vx = 0;
}
function run(s, mask, ticks) {
  for (let i = 0; i < ticks && s.status === 'playing'; i++) R.step(s, mask);
  return s;
}

test('bat: the dive cycle is a declared state machine and every dive is announced as an event', () => {
  const s = isolate(2);
  assert.ok(s.enemies.length >= 1, 'mine 3 has flying guards');
  const bat = s.enemies[0];
  const seen = new Set();
  let dives = 0;
  standUnder(s, bat);
  s.player.hearts = 99; // نقيس السلوك لا الضرر هنا
  for (let t = 0; t < 900 && s.status === 'playing'; t++) {
    R.step(s, 0);
    seen.add(bat.batState);
    dives += s.events.filter(e => e.type === 'bat_dive').length;
    standUnder(s, bat); // نبقيه تحته كي تُقاس الدورة كاملة
  }
  for (const state of ['windup', 'dive', 'stun', 'climb', 'patrol']) {
    assert.ok(seen.has(state), `the bat passes through the "${state}" state`);
  }
  assert.ok(dives >= 2, `the bat really dives more than once (${dives})`);
});

test('bat: a standing player under it loses a heart — it is no longer decoration', () => {
  const s = isolate(2);
  const bat = s.enemies[0];
  standUnder(s, bat);
  const hearts0 = s.player.hearts;
  let hurtAt = null;
  for (let t = 0; t < 300 && s.player.hearts === hearts0; t++) {
    R.step(s, 0);
    standUnder(s, bat); // اللاعب واقف: هذا هو الشرط الذي يعاقبه الخفاش
    if (s.player.hearts < hearts0 && hurtAt === null) hurtAt = s.tick;
  }
  assert.ok(s.player.hearts < hearts0, 'the bat lands a hit on a player who will not move');
  assert.ok(hurtAt !== null && hurtAt < 300, `the hit lands inside five seconds (${hurtAt})`);
});

test('bat: stepping out of the announced landing spot dodges the dive — no homing, no unavoidable hit', () => {
  const lone = R.create('miner', 4242, { zone: 2, goal: 0, mode: 'mine', loadout: {} }).enemies.filter(e => e.flying)[0];
  const s = isolate(2, 4242, lone.id);
  const bat = s.enemies[0];
  // نقف على يسار الخفاش بقليل (داخل مدى رصده) حتى يكون «الابتعاد» نحو بداية المستوى، لا نحو حفرة
  s.player.x = center(bat) - s.player.w / 2 - 40;
  const hearts0 = s.player.hearts;
  let guard = 0;
  while (bat.batState !== 'dive' && guard++ < 200) R.step(s, 0); // ننتظر انقضاضه المعلن
  assert.equal(bat.batState, 'dive', 'the bat announced and started its dive');
  const landing = center(bat); // الانقضاض عمودي: نقطة الهبوط معروفة سلفاً
  for (let t = 0; t < 90 && s.status === 'playing'; t++) R.step(s, R.INPUT.LEFT); // نبتعد عن نقطة الهبوط
  assert.equal(s.player.hearts, hearts0, 'moving out of the landing spot is enough to survive');
  assert.ok(Math.abs(playerCenter(s) - landing) > 40, `the player really left the landing spot (${Math.round(Math.abs(playerCenter(s) - landing))} px)`);
});

test('bat: the stun window is safe to punish — contact there deals no damage and one swing kills it', () => {
  const s = isolate(2);
  const bat = s.enemies[0];
  standUnder(s, bat);
  const p = s.player;
  // نمشي معه حتى يبدأ الدوار (الهبوط)، ثم نضرب من قريب
  for (let t = 0; t < 400 && bat.batState !== 'stun'; t++) { standUnder(s, bat); R.step(s, 0); }
  assert.equal(bat.batState, 'stun', 'the bat reaches its landing stun');
  const heartsAtStun = p.hearts;
  p.x = center(bat) - p.w / 2 - 20; p.facing = 1;
  let swings = 0;
  for (let t = 0; t < 60 && !bat.dead; t++) { R.step(s, R.INPUT.ATTACK); swings++; }
  assert.equal(bat.dead, true, `the stunned bat dies to a swing (${swings} frames)`);
  assert.equal(bat.hp <= 0, true);
  assert.equal(p.hearts, heartsAtStun, 'and the punish window never costs a heart in return');
  assert.equal(s.defeated, 1, 'the kill is counted as a defeated enemy');
});

test('bat: it stays inside its own patrol band and never leaves the level', () => {
  const s = isolate(4);
  const bat = s.enemies[0];
  standUnder(s, bat);
  for (let t = 0; t < 1200 && s.status === 'playing'; t++) {
    R.step(s, t % 120 < 60 ? R.INPUT.LEFT : R.INPUT.RIGHT);
    assert.ok(bat.x >= bat.minX - BATS.leash - 1 && bat.x <= bat.maxX + BATS.leash + 1, `the bat stays near its band at tick ${t} (${Math.round(bat.x)})`);
    assert.ok(bat.y >= 0 && bat.y < 300, `and above the floor (${Math.round(bat.y)})`);
  }
});

test('bat: the launch area is safe — a player who has not moved cannot be hurt at spawn', () => {
  for (const zone of [0, 1, 2, 3, 4, 5]) {
    const s = R.create('miner', 99, { zone, goal: 0, mode: 'mine', loadout: {} });
    while (s.status === 'playing' && s.tick < R.MAX_TICKS) R.step(s, 0);
    assert.equal(s.player.hearts, s.player.maxHearts, `mine ${zone}: idling at spawn costs no hearts`);
    assert.equal(s.tick, R.MAX_TICKS, `mine ${zone}: the run still ends on the round clock, not by a bat at spawn`);
  }
});

test('bat: in every mine it appears it dives, it can hurt, and it can be killed in the punish window', () => {
  // موضعٌ يقف عليه اللاعب على أرض المستوى (لا فوق منصّة ولا فوق حفرة) — القتل يحتاج وصولاً فعلياً.
  function floorSpot(zone, x) {
    const level = R.levelFor(zone), w = 26, h = 38;
    const onGround = level.platforms.some(p => p.y === 300 && x >= p.x && x + w <= p.x + p.w);
    if (!onGround) return false;
    const box = { x, y: 262, w, h };
    const solid = level.platforms.filter(p => p.y < 300
      && !(box.x + box.w <= p.x || box.x >= p.x + p.w || box.y + box.h <= p.y || box.y >= p.y + p.h));
    return solid.length === 0;
  }
  let hurtChecked = 0, killed = 0;
  for (let zone = 0; zone < 6; zone++) {
    const probe = R.create('miner', 777, { zone, goal: 0, mode: 'mine', loadout: {} });
    const bats = probe.enemies.filter(e => e.flying);
    if (!bats.length) continue; // منجم بلا خفافيش: لا شيء يُقاس هنا
    let killableHere = 0;
    for (const original of bats) {
      // 1) يؤذي لاعباً واقفاً
      const s = isolate(zone, 777, original.id);
      const bat = s.enemies[0];
      standUnder(s, bat);
      const hearts0 = s.player.hearts;
      let hurt = false;
      for (let t = 0; t < 400 && !hurt && s.status === 'playing'; t++) {
        R.step(s, 0);
        standUnder(s, bat);
        hurt = s.player.hearts < hearts0;
      }
      assert.ok(hurt, `mine ${zone} / bat ${bat.id}: it can hurt a standing player`);
      hurtChecked++;

      // 2) يُقتل في نافذة الدوار من أرض المستوى
      const s2 = isolate(zone, 777, original.id);
      const bat2 = s2.enemies[0];
      standUnder(s2, bat2);
      for (let t = 0; t < 400 && bat2.batState !== 'stun'; t++) { standUnder(s2, bat2); R.step(s2, 0); }
      assert.equal(bat2.batState, 'stun', `mine ${zone} / bat ${bat2.id}: it lands and becomes punishable`);
      const px = bat2.x - s2.player.w + 6;
      if (!floorSpot(zone, px)) continue; // نقطة هبوطه فوق حفرة/منصّة: لا موضع وقوف شرعي بجانبه
      s2.player.x = px; s2.player.y = 262; s2.player.vy = 0; s2.player.facing = 1;
      for (let t = 0; t < 60 && !bat2.dead; t++) R.step(s2, R.INPUT.ATTACK);
      assert.equal(bat2.dead, true, `mine ${zone} / bat ${bat2.id}: a single punish kills it`);
      assert.equal(s2.defeated, 1, `mine ${zone} / bat ${bat2.id}: the kill is counted`);
      killableHere++; killed++;
    }
    assert.ok(killableHere >= 1, `mine ${zone}: at least one bat is actually killable from the floor`);
  }
  assert.ok(hurtChecked >= 6, `the hurt check ran across the mines (${hurtChecked} bats)`);
  assert.ok(killed >= 6, `and so did the kill check (${killed} bats)`);
});

test('bat: the whole behaviour is deterministic and replays identically on the server path', () => {
  const inputs = [];
  for (let i = 0; i < 400; i++) inputs.push({ mask: i % 90 < 25 ? R.INPUT.RIGHT : 0, frames: 1 });
  const config = { zone: 4, goal: 0, mode: 'mine', loadout: {} };
  const seed = R.seedFromId('bat-determinism');
  const a = R.replay(inputs, 'miner', seed, config);
  const b = R.replay(inputs, 'miner', seed, config);
  assert.equal(a.ok, true);
  assert.deepEqual(a.state, b.state, 'replay is bit-identical');
  const bat = a.state.enemies.find(e => e.flying);
  assert.ok(bat && Number.isFinite(bat.x) && Number.isFinite(bat.y), 'the flying guard has a real position after the replay');
  assert.ok(['patrol', 'windup', 'dive', 'stun', 'climb'].includes(bat.batState), `its state survives the replay (${bat.batState})`);
});

test('bat: it never overrides the arena rival — duels keep their own brain', () => {
  const duel = R.create('miner', 5, { zone: 2, mode: 'duel', loadout: { pickaxe: 2, armor: 1 } });
  for (let t = 0; t < 240; t++) R.step(duel, R.INPUT.RIGHT);
  assert.equal(duel.enemies.filter(e => e.flying).length, 0, 'a duel has no flying guards');
  assert.equal(duel.enemies.every(e => e.batState === undefined), true, 'no arena fighter is driven by the bat brain');
  assert.equal(duel.mode, 'duel');
});
