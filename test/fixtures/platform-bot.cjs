// A reproducible legal controller for EVERY mine, hero and loadout — not an injected score or a physics override.
// It reads only the public run state and presses the same six buttons a player has, so a run it records is a run a player could
// have made. The tests use it as an existence proof: "this mine can be won" means "this bot wins it, and the server replays it".
//
//   travel : walk right, mine any rock ahead, jump at gap edges and in front of low hazards (and stop pushing in the air once past
//            them); before a tall timed hazard (crusher, geyser over a gap) it copies the state and simulates the default controller —
//            if that would cost a heart it simply waits one more tick.
//   fight  : boss arenas. The boss is armoured except while it recovers from an attack, so the bot keeps a stand-off distance,
//            jumps the shockwaves and the charge (the charge needs a run-up, so it backs off during the wind-up), and rushes in to
//            swing only while the boss is stunned.
const R = require('../../public/platform-rules');
const { INPUT: I, DT } = R;
// الخفاش (V19.2): انقضاضه مُلتزم بالمكان الذي كان فيه اللاعب لحظة الانطلاق، وسرعته الأفقية أقل من
// سرعة أبطأ بطل. فالنجاة منه ليست معجزة: ألّا تقف ساكناً أثناء نافذة التحذير. الروبوت يقرأ نفس
// الإنذار المتاح للاعب (حالة الخفاش وموضعه) ويستمر في الحركة — لا يعرف شيئاً خارج الحالة العامة.
const BAT_REACH = (R.BAT && R.BAT.detectX) || 170;
// الخفاش ينقضّ عمودياً على الموضع الذي انحرف إليه أثناء التحذير (لا يلاحق أفقياً)، فالنجاة منه
// هي ألّا تقف ساكناً تحت نقطة الانقضاض. الروبوت لا يقرأ إلا حالة الخفاش وموضعه — كما يفعل اللاعب.
function batThreat(s) {
  const p = s.player, pc = p.x + p.w / 2;
  return s.enemies.some(e => e.flying && !e.dead
    && (e.batState === 'windup' || e.batState === 'dive')
    && Math.abs(e.x + e.w / 2 - pc) < BAT_REACH);
}

const isTall = h => h.h > 40;
function gapsOf(level) {
  const ground = level.platforms.filter(p => p.y === 300 && p.h === 80).sort((a, b) => a.x - b.x), gaps = [];
  for (let i = 1; i < ground.length; i++) gaps.push([ground[i - 1].x + ground[i - 1].w, ground[i].x]);
  return gaps;
}
const overGap = (ctx, h) => ctx.gaps.some(([a, b]) => h.x >= a - 10 && h.x <= b);

function travel(s, ctx) {
  const p = s.player, front = p.x + p.w;
  let mask = I.RIGHT;
  if (s.rocks.some(r => r.hp > 0 && r.x >= p.x && r.x - p.x < 80)) mask |= I.MINE;
  const low = s.hazards.filter(h => !isTall(h) && !overGap(ctx, h));
  if (p.grounded) {
    for (const [g0] of ctx.gaps) if (front >= g0 - 20 && p.x < g0 + 6) mask |= I.JUMP;
    for (const h of low) if (front >= h.x - 36 && p.x < h.x + h.w - 10) mask |= I.JUMP;
  } else {
    for (const h of low) if (p.x > h.x + h.w + 2 && p.x < h.x + h.w + 60) mask &= ~I.RIGHT; // past it: land close, not 190px later
  }
  // وقوف اللاعب هدفٌ ساكن للانقضاض: أثناء التحذير نواصل التقدّم بدل التوقّف عند العائق
  if (batThreat(s)) mask |= I.RIGHT;
  return mask;
}

// A timed hazard ahead: simulate the default controller on a copy and wait while it would cost a heart.
function shielded(s, ctx, base) {
  const p = s.player, front = p.x + p.w;
  const near = s.hazards.some(h => h.period > 1 && (isTall(h) || overGap(ctx, h)) && front > h.x - 170 && p.x < h.x + h.w + 4);
  if (!near || !(base & I.RIGHT)) return base;
  const copy = structuredClone(s), hearts = copy.player.hearts;
  for (let k = 0; k < 90 && copy.status === 'playing'; k++) {
    R.step(copy, travel(copy, ctx));
    if (copy.player.hearts !== hearts) return batThreat(s) ? base : base & ~I.RIGHT & ~I.JUMP;
    if (copy.player.x > p.x + 240) break;
  }
  return base;
}

const RANGE = { miner: 54, warrior: 60, archer: 240 };
function fight(s, boss, ctx) {
  const p = s.player, melee = ctx.hero !== 'archer', range = Math.min(RANGE[ctx.hero], 215);
  const front = p.x + p.w, toward = boss.x + boss.w / 2 >= p.x + p.w / 2 ? 1 : -1;
  const d = toward > 0 ? boss.x - front : p.x - (boss.x + boss.w);       // gap between the two rectangles
  const T = toward > 0 ? I.RIGHT : I.LEFT, A = toward > 0 ? I.LEFT : I.RIGHT;
  const stunned = boss.state === 'recover';
  let mask = 0, jump = false;
  for (const w of s.waves) {
    const incoming = w.vx > 0 ? w.x + w.w <= p.x : w.x >= front;
    const wd = w.vx > 0 ? p.x - (w.x + w.w) : w.x - front;
    const endX = w.x + w.vx * DT * w.ttl;                                   // where the wave dies: will it ever reach us?
    const reaches = w.vx > 0 ? endX + w.w > p.x : endX < front;
    if (incoming && reaches && wd < ctx.waveJump) jump = true;
  }
  if (boss.state === 'windup' && boss.attack === 'slam' && boss.timer <= ctx.slamLead && d < 70) jump = true;
  if (boss.state === 'charge' && boss.vx * toward < 0) {
    const ticksToContact = d / (Math.abs(boss.vx) * DT);
    if (ticksToContact <= ctx.chargeLead && ticksToContact > -12) jump = true;
  }
  // stay close enough to rush in when it is stunned, far enough to react while it is armoured
  let near, far;
  if (stunned) { near = melee ? 8 : 120; far = melee ? range - 6 : 205; }
  else { near = melee ? ctx.standoff : 150; far = melee ? ctx.standoff + 60 : 205; }
  if (boss.state === 'windup' && boss.attack === 'charge') near = Math.max(near, ctx.chargeRoom);
  if (d < near) mask |= A;
  else if (p.facing !== toward) mask |= T;
  else if (d > far) mask |= T;
  const facing = (mask & T) ? toward : (mask & A) ? -toward : p.facing;     // the way the swing will really go
  const aimsAtBody = p.grounded || p.y + 14 >= boss.y;                      // an arrow loosed from a high jump flies over the boss
  if (stunned && aimsAtBody && facing === toward && d <= (melee ? range - 2 : 225) && d > -6) mask |= I.ATTACK;
  if (jump && p.grounded) mask |= I.JUMP;
  return mask;
}

// play(seed, hero, { zone, loadout }) → { state, inputs, stats }; `tune` overrides the reflex constants (used to measure dodge windows);
// `idleTicks` = ticks the run already spent with no button pressed (a browser run that was paused a moment after it started).
module.exports = function play(seed, hero = 'miner', config, tune = {}, idleTicks = 0) {
  const state = R.create(hero, seed, config), level = R.levelFor(state.zone), inputs = [];
  const ctx = { hero, gaps: gapsOf(level), waveJump: 70, slamLead: 9, chargeLead: 14, chargeRoom: 90, standoff: 70, ...tune };
  const boss = state.bossId ? state.enemies.find(e => e.id === state.bossId) : null;
  const stats = { fightFrom: null, bossDeadAt: null };
  for (let i = 0; i < idleTicks; i++) { if (inputs.at(-1)?.mask === 0) inputs.at(-1).frames++; else inputs.push({ mask: 0, frames: 1 }); R.step(state, 0); }
  for (let i = 0; i < R.MAX_TICKS && state.status === 'playing'; i++) {
    let mask;
    if (boss && !boss.dead && (ctx.fighting || state.player.x >= boss.wake - 10)) {
      ctx.fighting = true;
      if (stats.fightFrom === null) stats.fightFrom = state.tick;
      mask = fight(state, boss, ctx);
    } else mask = shielded(state, ctx, travel(state, ctx));
    if (inputs.at(-1)?.mask === mask) inputs.at(-1).frames++; else inputs.push({ mask, frames: 1 });
    R.step(state, mask);
    if (boss && boss.dead && stats.bossDeadAt === null) stats.bossDeadAt = state.tick;
  }
  return { state, inputs, stats };
};
