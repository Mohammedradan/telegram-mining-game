// سياسات اللاعبين الافتراضيين الثلاثة في الساحة — مصدر واحد تستخدمه كل أدوات القياس
// والاختبارات، فالمقارنة بين نسختين من المحرك تبقى على نفس السلوك تماماً.
// كل سياسة دالة حتمية في (الحالة) فقط، بلا Math.random ولا مؤقّتات خارجية.
const R = require('../public/platform-rules');

const SKILL_COST = R.DUEL.skill ? R.DUEL.skill.cost : Infinity;

const facingBits = (dx) => (dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT);

// مبتدئ: يقترب ويضغط الهجوم، ويصدّ أحياناً حين يرى الإنذار. لا يقفز موجات ولا يراوغ بذكاء.
function novice(s) {
  const r = s.enemies.find((e) => !e.dead);
  if (!r) return 0;
  const me = s.player;
  const dx = r.x + r.w / 2 - (me.x + me.w / 2), ad = Math.abs(dx);
  if (r.state === 'windup' && ad < 80 && s.tick % 9 < 4) return R.INPUT.DEFEND;
  if (ad > 50) return facingBits(dx);
  return R.INPUT.ATTACK;
}

// متوسط: سلسلة ضربات، صدّ للقريبة، مراوغة للكاسرة، قفز فوق الموجة، وضربة قوية في الاستشفاء.
function intermediate(s) {
  const r = s.enemies.find((e) => !e.dead);
  if (!r) return 0;
  const me = s.player;
  const dx = r.x + r.w / 2 - (me.x + me.w / 2), ad = Math.abs(dx);
  if (r.state === 'windup' && ad < 95) return r.attack === 'overhead' ? R.INPUT.DODGE : R.INPUT.DEFEND;
  const wave = (s.waves || []).find((w) => !(w.delay > 0) && Math.abs((w.x + w.w / 2) - (me.x + me.w / 2)) < 80);
  if (wave && me.grounded) return R.INPUT.JUMP;
  if (r.state === 'recover' && ad <= 66) return R.INPUT.HEAVY;
  if (ad > 60) return facingBits(dx);
  return R.INPUT.ATTACK;
}

// متقن: يقرأ عدّاد الإنذار ويتفادى في الإطارات الأخيرة، يقفز الصدمة الأرضية،
// ويستغل كل نافذة بضربة قوية أو بالمهارة، ويحافظ على مسافة السيف.
function expert(s) {
  const r = s.enemies.find((e) => !e.dead);
  if (!r) return 0;
  const me = s.player;
  const dx = r.x + r.w / 2 - (me.x + me.w / 2), ad = Math.abs(dx);
  if (r.state === 'windup') {
    const close = ad < 118;
    const late = r.timer <= 9;
    if (close && late) {
      if (r.attack !== 'overhead') return R.INPUT.DEFEND;
      return (r.ai && r.ai.wideSlam) ? R.INPUT.JUMP : R.INPUT.DODGE;
    }
    if (close) return 0; // ينتظر ولا يفتح نفسه
    return facingBits(dx);
  }
  if (r.state === 'charge' && ad < 130) return R.INPUT.JUMP;
  const wave = (s.waves || []).find((w) => !(w.delay > 0) && Math.abs((w.x + w.w / 2) - (me.x + me.w / 2)) < 90);
  if (wave && me.grounded) return R.INPUT.JUMP;
  const safe = r.state === 'recover' || r.state === 'retreat' || r.state === 'stagger';
  if (safe) {
    if (ad > 68) return facingBits(dx);
    if (Number.isFinite(SKILL_COST) && me.skillCooldown <= 0 && me.guard.stamina >= SKILL_COST + 10) return R.INPUT.SKILL;
    if (me.heavyCooldown <= 0) return R.INPUT.HEAVY;
    return R.INPUT.ATTACK;
  }
  if (ad > 70) return facingBits(dx);
  return 0;
}

module.exports = { BOTS: { novice, intermediate, expert }, SKILL_COST };

// مشغّل مبارزة كامل يعيد كل ما تحتاجه القياسات: النتيجة، الزمن، الضرر، النوافذ، والاستشفاء.
function fight(botName, { zone = 0, seed = 11, gear = 0, hero = 'miner', maxTicks = 9000 } = {}) {
  const bot = module.exports.BOTS[botName];
  const loadout = { pickaxe: gear, armor: gear, drill: gear };
  const config = { zone, mode: 'duel', loadout };
  const s = R.create(hero, seed, config);
  const inputs = [];
  let freeze = 0, pending = 0, taken = 0, landed = 0, damageDealt = 0, windows = 0, windowsUsed = 0;
  let skillUses = 0, prevRivalState = '', prevSkillCd = s.player.skillCooldown;
  const rec = (m) => {
    const prev = inputs[inputs.length - 1];
    if (prev && prev.mask === m) prev.frames++;
    else inputs.push({ mask: m, frames: 1 });
  };
  for (let t = 0; t < maxTicks && s.status === 'playing'; t++) {
    const r = s.enemies[0];
    const inReach = Math.abs(r.x + r.w / 2 - (s.player.x + s.player.w / 2)) <= 70;
    if (r.state !== prevRivalState) {
      if (r.state === 'recover' && inReach) { windows++; windowsUsed++; }
      prevRivalState = r.state;
    }
    if (freeze > 0) { pending |= bot(s); freeze--; continue; }
    const mask = bot(s) | pending;
    pending = 0;
    rec(mask);
    R.step(s, mask);
    if (s.player.skillCooldown > prevSkillCd) skillUses++;
    prevSkillCd = s.player.skillCooldown;
    for (const ev of s.events || []) {
      if (ev.type === 'hit') { landed++; damageDealt += ev.damage || 0; freeze = Math.max(freeze, ev.damage >= 2 ? 4 : 2); }
      else if (ev.type === 'hurt') { taken++; freeze = Math.max(freeze, 3); }
    }
  }
  const replay = R.replay(inputs, hero, seed, config);
  return {
    win: s.status === 'won' ? 1 : 0, status: s.status,
    seconds: +(s.tick / R.FPS).toFixed(2), taken, landed, damageDealt, windows, windowsUsed, skillUses,
    hearts: s.player.hearts, maxHearts: s.player.maxHearts,
    rivalHpPct: +((Math.max(0, s.enemies[0].hp) / s.enemies[0].maxHp) * 100).toFixed(1),
    damage: s.player.damage, stamina: s.player.guard.maxStamina, skillCd: s.player.skillMaxCooldown,
    replaySame: Boolean(replay.ok) && replay.state.status === s.status && replay.state.tick === s.tick
      && replay.state.enemies.map((e) => e.hp).join() === s.enemies.map((e) => e.hp).join(),
    inputs,
  };
}
module.exports.fight = fight;
