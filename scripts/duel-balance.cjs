// مِقياس توازن المبارزة: ثلاثة مستويات مهارة × أربع مناطق × بذور متعددة، بنفس محرك
// public/platform-rules.js المستخدم في اللعبة والخادم — لا محاكاة موازية.
//   node scripts/duel-balance.cjs           → جدول نصّي
//   node scripts/duel-balance.cjs --json    → JSON للاختبارات
// كل بوت حتمي: القرار دالة في (الحالة، tick) فقط، بلا Math.random.
const path = require('node:path');
// يمكن تشغيله على نسخة محرك أخرى (لمقارنة قبل/بعد): DUEL_RULES=/tmp/rules-v8.js
const RULES_PATH = process.env.DUEL_RULES || path.join(__dirname, '..', 'public', 'platform-rules');
const R = require(RULES_PATH);
const SKILL_COST = R.DUEL.skill ? R.DUEL.skill.cost : Infinity;

const SEEDS = [11, 2024, 7777, 424242, 9001, 31337];
const ZONES = [0, 1, 2, 3];
const BOTS = {
  // مبتدئ: يهجم حين يقترب، ويصدّ أحيانًا فقط حين يرى الإنذار، ولا يراوغ ولا يستغل النوافذ
  novice(s) {
    const r = s.enemies.find((e) => !e.dead);
    if (!r) return 0;
    const me = s.player, dx = r.x + r.w / 2 - (me.x + me.w / 2), ad = Math.abs(dx), dir = dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
    if (r.state === 'windup' && ad < 80 && (s.tick % 9) < 4) return R.INPUT.DEFEND;
    if (ad > 50) return dir;
    return R.INPUT.ATTACK;
  },
  // متوسط: يضغط سلسلة الضربات، يصدّ القريبة، يراوغ الكاسرة، وينتهز الاستشفاء بالضربة القوية
  intermediate(s) {
    const r = s.enemies.find((e) => !e.dead);
    if (!r) return 0;
    const me = s.player, dx = r.x + r.w / 2 - (me.x + me.w / 2), ad = Math.abs(dx), dir = dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
    if (r.state === 'windup' && ad < 95) return r.attack === 'overhead' ? R.INPUT.DODGE : R.INPUT.DEFEND;
    // مهارة أساسية يعلّمها الدرس: القفز فوق الموجة الأرضية
    const wave = (s.waves || []).find((w) => !(w.delay > 0) && Math.abs((w.x + w.w / 2) - (me.x + me.w / 2)) < 80);
    if (wave && me.grounded) return R.INPUT.JUMP;
    if (r.state === 'recover' && ad <= 66) return R.INPUT.HEAVY;
    if (ad > 60) return dir;
    return R.INPUT.ATTACK;
  },
  // متقن: لا يضرب إلا في نافذة آمنة (استشفاء/تباعد)، يصدّ ويراوغ بحسب نوع الهجوم،
  // يحافظ على مسافة السيف، ويستخدم ظل الساكورا حين تكون جاهزة ونَفَس الدرع كافياً
  expert(s) {
    const r = s.enemies.find((e) => !e.dead);
    if (!r) return 0;
    const me = s.player, dx = r.x + r.w / 2 - (me.x + me.w / 2), ad = Math.abs(dx), dir = dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
    // 1) الدفاع أولاً: يقرأ عدّاد الإنذار ويتفادى في الإطارات الأخيرة (توقيت لا سباق)
    if (r.state === 'windup') {
      const close = ad < 118;
      const late = r.timer <= 9;
      if (close && late) {
        if (r.attack !== 'overhead') return R.INPUT.DEFEND;
        // الصدمة الواسعة تُقفز (أرضية)، والكاسرة العادية تُراوغ
        return (r.ai && r.ai.wideSlam) ? R.INPUT.JUMP : R.INPUT.DODGE;
      }
      if (close) return 0; // ينتظر ولا يفتح نفسه
      return dir;
    }
    if (r.state === 'charge' && ad < 130) return R.INPUT.JUMP;
    // الموجة الأرضية: يقفز فوقها (نفس النصيحة المعروضة في الواجهة)
    const wave = (s.waves || []).find((w) => !(w.delay > 0) && Math.abs((w.x + w.w / 2) - (me.x + me.w / 2)) < 90);
    if (wave && me.grounded) return R.INPUT.JUMP;
    // 2) الهجوم في نافذة آمنة فقط
    const safe = r.state === 'recover' || r.state === 'retreat' || r.state === 'stagger';
    if (safe) {
      // داخل النافذة: يلاحق ويضرب بالفعل — لا يضيّع أطراف الاستشفاء في التموضع
      if (ad > 68) return dir;
      if (Number.isFinite(SKILL_COST) && me.skillCooldown <= 0 && me.guard.stamina >= SKILL_COST + 10) return R.INPUT.SKILL;
      if (me.heavyCooldown <= 0) return R.INPUT.HEAVY;
      return R.INPUT.ATTACK;
    }
    // 3) خارج النافذة: يلاحق حتى حدّ السيف ثم ينتظر بلا فتح
    if (ad > 70) return dir;
    return 0;
  },
};

function fight(botName, zone, seed) {
  const bot = BOTS[botName];
  const s = R.create('miner', seed, { zone, mode: 'duel' });
  const inputs = [];
  let freeze = 0, pending = 0, taken = 0, landed = 0, windows = 0, usedWindows = 0, prevState = '';
  const rec = (m) => {
    const p = inputs[inputs.length - 1];
    if (p && p.mask === m) p.frames++;
    else inputs.push({ mask: m, frames: 1 });
  };
  const rivalReachable = () => {
    const r = s.enemies.find((e) => !e.dead);
    if (!r) return false;
    return Math.abs(r.x + r.w / 2 - (s.player.x + s.player.w / 2)) <= 70;
  };
  for (let t = 0; t < 9000 && s.status === 'playing'; t++) {
    const r = s.enemies[0];
    // فرصة هجوم: كل انتقال إلى recover واللاعب في المدى
    if (r && r.state !== prevState) {
      if (r.state === 'recover' && rivalReachable()) { windows++; if (botName !== 'novice') usedWindows++; }
      prevState = r.state;
    }
    if (freeze > 0) { pending |= bot(s); freeze--; continue; }
    const mask = bot(s) | pending;
    pending = 0;
    rec(mask);
    R.step(s, mask);
    for (const ev of s.events || []) {
      if (ev.type === 'hit' && ev.damage > 0) { freeze = Math.max(freeze, ev.damage >= 2 ? 4 : 2); landed++; }
      else if (ev.type === 'hurt') { freeze = Math.max(freeze, 3); taken++; }
    }
  }
  // تحقّق الخادم: نفس التدفق المسجّل يجب أن يعطي نفس النتيجة
  const replay = R.replay(inputs, 'miner', seed, { zone, mode: 'duel' });
  const same = replay.ok && replay.state.status === s.status && replay.state.tick === s.tick
    && replay.state.player.hearts === s.player.hearts
    && replay.state.enemies.map((e) => e.hp).join() === s.enemies.map((e) => e.hp).join();
  return {
    status: s.status, win: s.status === 'won' ? 1 : 0,
    seconds: +(s.tick / R.FPS).toFixed(2), taken, landed, windows, usedWindows,
    rivalHpLeft: s.enemies[0].hp, rivalMaxHp: s.enemies[0].maxHp,
    heartsLeft: s.player.hearts, maxHearts: s.player.maxHearts,
    skillUses: inputs.reduce((n, i) => n + ((i.mask & R.INPUT.SKILL) ? i.frames : 0), 0), replaySame: same,
  };
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const results = {};
for (const botName of Object.keys(BOTS)) {
  results[botName] = {};
  for (const zone of ZONES) {
    const runs = SEEDS.map((seed) => fight(botName, zone, seed));
    results[botName][zone] = {
      fights: runs.length,
      winRate: +(avg(runs.map((r) => r.win)) * 100).toFixed(1),
      avgSeconds: +avg(runs.map((r) => r.seconds)).toFixed(2),
      avgTaken: +avg(runs.map((r) => r.taken)).toFixed(2),
      avgLanded: +avg(runs.map((r) => r.landed)).toFixed(2),
      avgWindows: +avg(runs.map((r) => r.windows)).toFixed(2),
      avgUsedWindows: +avg(runs.map((r) => r.usedWindows)).toFixed(2),
      avgRivalHpPct: +avg(runs.map((r) => (r.rivalHpLeft / r.rivalMaxHp) * 100)).toFixed(1),
      hearts: `${runs[0].maxHearts}`,
      replaySame: runs.every((r) => r.replaySame),
    };
  }
  results[botName].all = {
    winRate: +((avg(ZONES.flatMap((z) => SEEDS.map((s) => fight(botName, z, s).win))) * 100)).toFixed(1),
  };
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(results, null, 2));
} else {
  const rows = [];
  for (const botName of Object.keys(results)) {
    for (const zone of ZONES) {
      const r = results[botName][zone];
      rows.push([botName, `z${zone}`, `${r.winRate}%`, `${r.avgSeconds}s`, `${r.avgTaken}`, `${r.avgLanded}`, `${r.avgWindows}`, `${r.avgRivalHpPct}%`, r.replaySame ? 'ok' : 'DIFF']);
    }
  }
  const head = ['bot', 'zone', 'win', 'time', 'taken', 'landed', 'windows', 'rivalHP', 'replay'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(head));
  for (const row of rows) console.log(line(row));
  for (const botName of Object.keys(results)) console.log(`\n${botName} overall win ${results[botName].all.winRate}%`);
}
