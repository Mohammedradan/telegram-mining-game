// تقرير الساحة التفصيلي: مصفوفة (منطقة × مستوى معدات × مستوى مهارة) + تشخيصات للعدالة.
//   node scripts/arena-report.cjs          → جداول نصّية
//   node scripts/arena-report.cjs --json   → JSON للاختبارات ولأي أداة أخرى
// لا يغيّر أي رقم في المحرك: قياس فقط.
const path = require('node:path');
const R = require(path.join(__dirname, '..', 'public', 'platform-rules'));
const { BOTS, fight } = require('./duel-bots.cjs');

const BOTS_ORDER = ['novice', 'intermediate', 'expert'];
const GEARS = [0, 2, 5];
const ZONES = [0, 1, 2, 3];
const SEEDS = [11, 2024, 7777, 424242, 9001, 31337, 606, 1408];
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r1 = (n) => Math.round(n * 10) / 10;

// ===== 1) المصفوفة الكاملة =====
const matrix = {};
for (const bot of BOTS_ORDER) {
  matrix[bot] = {};
  for (const gear of GEARS) {
    matrix[bot][gear] = {};
    for (const zone of ZONES) {
      const runs = SEEDS.map((seed) => fight(bot, { zone, seed, gear }));
      matrix[bot][gear][zone] = {
        fights: runs.length,
        winRate: +(avg(runs.map((r) => r.win)) * 100).toFixed(1),
        avgSeconds: +avg(runs.map((r) => r.seconds)).toFixed(1),
        avgTaken: +avg(runs.map((r) => r.taken)).toFixed(2),
        avgLanded: +avg(runs.map((r) => r.landed)).toFixed(1),
        avgDamage: +avg(runs.map((r) => r.damageDealt)).toFixed(1),
        avgWindows: +avg(runs.map((r) => r.windows)).toFixed(1),
        avgSkillUses: +avg(runs.map((r) => r.skillUses)).toFixed(2),
        avgRivalHpPct: +avg(runs.map((r) => r.rivalHpPct)).toFixed(1),
        replaySame: runs.every((r) => r.replaySame),
        hearts: runs[0].maxHearts,
        died: runs.filter((r) => r.status === 'lost' && r.hearts <= 0).length,
        timedOut: runs.filter((r) => r.status === 'lost' && r.hearts > 0).length,
      };
    }
  }
}

// ===== 2) اعتماد الفوز على المعدات (فارق L5 عن L0) =====
const gearDelta = {};
for (const bot of BOTS_ORDER) {
  gearDelta[bot] = {};
  for (const zone of ZONES) {
    const a = matrix[bot][0][zone], b = matrix[bot][5][zone];
    gearDelta[bot][zone] = {
      winDelta: +(b.winRate - a.winRate).toFixed(1),
      takenDelta: +(b.avgTaken - a.avgTaken).toFixed(2),
      secondsDelta: +(b.avgSeconds - a.avgSeconds).toFixed(1),
      damageL0: a.avgDamage, damageL5: b.avgDamage,
    };
  }
}

// ===== 2ب) تفكيك أثر المعدات: أي بند يقود الفوز؟ ومنحنى القلوب =====
// نفس البوت بثلاث لقطات: الأساس (0/0/0)، ثم سلاح واحد فقط في أقصى مستوى. بهذا نعرف أي بند
// في المعدات يقلب النتيجة — لا نعدّل شيئاً، نقيس فقط.
function noviceJumper(s) {
  // «مبتدئ واعٍ»: نفس سياسة المبتدئ + ردة فعل واحدة تعلّمها: القفز فوق الموجة القريبة.
  const wave = (s.waves || []).find((w) => !(w.delay > 0) && Math.abs((w.x + w.w / 2) - (s.player.x + s.player.w / 2)) < 80);
  if (wave && s.player.grounded) return R.INPUT.JUMP;
  return BOTS.novice(s);
}
const DECOMP_LOADOUTS = [
  { key: 'base 0/0/0', loadout: { pickaxe: 0, armor: 0, drill: 0 } },
  { key: 'فأس 5 فقط', loadout: { pickaxe: 5, armor: 0, drill: 0 } },
  { key: 'درع 5 فقط', loadout: { pickaxe: 0, armor: 5, drill: 0 } },
  { key: 'مثقاب 5 فقط', loadout: { pickaxe: 0, armor: 0, drill: 5 } },
  { key: 'الكل 5', loadout: { pickaxe: 5, armor: 5, drill: 5 } },
];
function runLoadout(botFn, loadout, zone, seed) {
  const s = R.create('miner', seed, { zone, mode: 'duel', loadout });
  const fn = typeof botFn === 'string' ? BOTS[botFn] : botFn;
  for (let t = 0; t < 9000 && s.status === 'playing'; t++) R.step(s, fn(s));
  return { win: s.status === 'won' ? 1 : 0, status: s.status, hearts: s.player.hearts, maxHearts: s.player.maxHearts,
    seconds: +(s.tick / 60).toFixed(1), damage: s.player.damage, stamina: s.player.guard.maxStamina,
    skillCd: s.player.skillMaxCooldown };
}
const decompose = {};
for (const [botKey, botFn] of [['novice', 'novice'], ['noviceJump', noviceJumper], ['intermediate', 'intermediate']]) {
  decompose[botKey] = {};
  for (const zone of ZONES) {
    decompose[botKey][zone] = DECOMP_LOADOUTS.map(({ key, loadout }) => {
      const runs = SEEDS.map((seed) => runLoadout(botFn, loadout, zone, seed));
      return { key, winRate: +(avg(runs.map((r) => r.win)) * 100).toFixed(1),
        avgSeconds: +avg(runs.map((r) => r.seconds)).toFixed(1),
        heartsLeft: +avg(runs.map((r) => r.hearts)).toFixed(2), maxHearts: runs[0].maxHearts,
        damage: runs[0].damage, stamina: runs[0].stamina, skillCd: runs[0].skillCd };
    });
  }
}
const heartsLadder = [0, 1, 2, 3, 4, 5].map((lv) => {
  const st = R.loadoutStats('miner', R.normalizeLoadout({ pickaxe: lv, armor: lv, drill: lv }));
  const c = R.combatGear('miner', { pickaxe: lv, armor: lv, drill: lv });
  return { level: lv, hearts: st.hearts, maxHearts: st.maxHearts, duelHearts: st.maxHearts + R.DUEL.extraHearts,
    damage: 1 + st.combat.damage, stamina: R.GUARD.max + st.combat.guardStamina,
    skillCd: st.combat.duelSkillCooldown, dodgeCd: st.combat.dodgeCooldown,
    labels: c.map((x) => `${x.name} ${x.level}`) };
});

// ===== 3) تشخيص سيّاف الريح: هل توجد نافذة قفز/مراوغة حقيقية بين الموجتين؟ =====
// القياس على الموجة نفسها فقط: نضع لاعباً «وسادة» يحافظ على مسافة آمنة (لا يهجم ولا يلتصق)،
// حتى لا تصبح الإصابة من ضربة قريبة جزءاً من الحساب. ثم نعيد الإطارات ونضغط «قفز» في كل إطار.
const overlapBox = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
// ضربة موجة = نقص قلب في الإطار نفسه الذي يلامس فيه جسدَ اللاعب جسمُ موجة غير مؤجّلة.
// (لا نستخدم p.invulnerable لأن المحرك يضبطها 90 إطاراً في الإطار نفسه الذي وقع فيه الضرر.)
function waveHitOnStep(sim, heartsBefore) {
  const p = sim.player;
  if (sim.player.hearts >= heartsBefore) return false;
  return sim.waves.some((w) => !(w.delay > 0) && overlapBox(p, w));
}
// سياسة «وسادة»: حافظ على 150px، لا تهجم، اقفز فقط إن طُلب ذلك. تعمل على المحرك الحقيقي.
function spacer(s, keep = 150) {
  const p = s.player, e = s.enemies[0];
  if (!e) return 0;
  const d = (e.x + e.w / 2) - (p.x + p.w / 2);
  if (Math.abs(d) < keep - 20) return d > 0 ? R.INPUT.LEFT : R.INPUT.RIGHT;
  if (Math.abs(d) > keep + 20) return d > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
  return 0;
}
// نلتقط المباراة حتى إنذار موجة ثم لحظة إطلاقها، ونحفظ الإدخالات حتى لحظة الإطلاق.
function captureWavePrefix(zone, seed, keep) {
  const s = R.create('miner', seed, { zone, mode: 'duel' });
  const masks = [];
  let windupTick = null;
  for (let t = 0; t < 3000 && s.status === 'playing'; t++) {
    const before = s.waves.length;
    masks.push(spacer(s, keep));
    R.step(s, masks[masks.length - 1]);
    for (const ev of s.events || []) if (ev.type === 'boss_windup' && ev.attack === 'wave' && windupTick === null) windupTick = ev.ticks;
    if (s.waves.length > before) {
      const w = s.waves[s.waves.length - 1];
      const dist = Math.abs(w.x - (s.player.x + s.player.w));
      if (dist >= keep - 80) return { masks: masks.slice(), spawnTick: s.tick, dist: Math.round(dist), windupTick,
        travel: Math.round((dist / 190) * 60), hearts: s.player.hearts };
    }
  }
  return null;
}
function waveWindow(zone = 2, seeds = [424242, 9001, 31337, 606, 1408, 2024, 7777, 11]) {
  const distances = [];
  for (const keep of [140, 200, 260]) {
    const trials = [];
    for (const kind of ['jump', 'dodge', 'guard']) {
      const input = kind === 'jump' ? R.INPUT.JUMP : kind === 'dodge' ? R.INPUT.DODGE : R.INPUT.DEFEND;
      let best = null;
      for (const seed of seeds) {
        const cap = captureWavePrefix(zone, seed, keep);
        if (!cap) continue;
        const safe = [];
        for (let k = 0; k <= (kind === 'guard' ? 1 : 60); k++) {
          const sim = R.create('miner', seed, { zone, mode: 'duel' });
          for (const m of cap.masks) R.step(sim, m);
          let hit = false;
          for (let j = 0; j <= 60; j++) {
            const hb = sim.player.hearts;
            const mask = kind === 'guard' ? (j >= k ? input : 0) : (j === k ? input : 0);
            R.step(sim, mask);
            if (waveHitOnStep(sim, hb)) { hit = true; break; }
          }
          if (!hit) safe.push(k);
        }
        const ranges = [];
        for (const k of safe) {
          const last = ranges[ranges.length - 1];
          if (last && k === last[1] + 1) last[1] = k; else ranges.push([k, k]);
        }
        const cand = { seed, spawnTick: cap.spawnTick, windupTicks: cap.windupTick, dist: cap.dist, travel: cap.travel, safeFrames: safe.length, ranges };
        if (!best || cand.safeFrames > best.safeFrames) best = cand;
      }
      trials.push({ input: kind, ...(best || { safeFrames: 0, ranges: [], seed: null, dist: null }) });
    }
    distances.push({ keep, trials });
  }
  const probe = R.create('miner', 1, { zone, mode: 'duel' });
  const a = probe.enemies[0].ai;
  return {
    ok: true,
    wave: { w: a.wave.w, h: a.wave.h, speed: a.wave.speed, ttl: a.wave.ttl, gap: a.wave.gap },
    jumpAirtime: Math.round((2 * 450 / 1200) * 60),
    jumpApex: Math.round((450 * 450) / (2 * 1200)),
    distances,
  };
}

// ===== 4) تشخيص الزعيم: هل نافذة الاستشفاء قابلة للاستغلال؟ وهل المرحلة الثانية تعاقب بلا وقت ردّ؟ =====
// (أ) الجدار المدرّع: لا ضرر إلا في حالة recover — نقيسه فعلياً ونحصي الضرر داخل النوافذ وخارجها.
// (ب) إنتاجية النافذة: ضرر لكل نافذة، وهل تسمح بضربة قوية + ضربة سلسلة.
// (ج) الانتقال للمرحلة الثانية: كم إطار إنذار يحصل عليه اللاعب قبل أول هجوم بعد الاهتياج.
// (د) الصدمة التابعة (+١٤): هل يكفي قفز واحد للاثنتين؟ وهل تعاقب من يستغل النافذة؟
function bossReport(seed = 424242) {
  const s = R.create('miner', seed, { zone: 3, mode: 'duel' });
  const b = s.enemies[0];
  let windows = 0, dmgInWindow = 0, dmgOutWindow = 0, hitsInWindow = 0, hitsOutWindow = 0;
  let inWindow = false, windowDamage = [], cur = 0, curHits = 0;
  let enrageTick = null, firstWindupAfterEnrage = null, enrageWindupTicks = null;
  let phase2SlamGaps = [], lastSlam = null, followUps = 0, prevHp = b.hp;
  for (let t = 0; t < 9000 && s.status === 'playing'; t++) {
    const mask = BOTS.expert(s);
    R.step(s, mask);
    const hpNow = Math.max(0, b.hp);
    const dealt = prevHp - hpNow; prevHp = hpNow;
    if (b.state === 'recover' && !inWindow) { windows++; inWindow = true; cur = 0; curHits = 0; }
    if (b.state !== 'recover' && inWindow) {
      inWindow = false; windowDamage.push(cur);
      dmgOutWindow += 0; // الضرر الخارجي يُحسب أدناه من الأحداث
    }
    for (const ev of s.events || []) {
      if (ev.type === 'hit') {
        (inWindow ? (hitsInWindow++, curHits++, cur += ev.damage || 0, dmgInWindow += ev.damage || 0) : (hitsOutWindow++, dmgOutWindow += ev.damage || 0));
      }
      if (ev.type === 'boss_enrage' && enrageTick === null) { enrageTick = s.tick; }
      if (ev.type === 'boss_windup' && enrageTick !== null && firstWindupAfterEnrage === null) {
        firstWindupAfterEnrage = s.tick - enrageTick; enrageWindupTicks = ev.ticks;
      }
      if (ev.type === 'boss_slam' && ev.unblockable && (ev.phase || 1) >= 2) {
        if (ev.follow) followUps++;
        if (lastSlam !== null) phase2SlamGaps.push(s.tick - lastSlam);
        lastSlam = s.tick;
      }
    }
  }
  return {
    windows, dmgInWindow, hitsInWindow, hitsOutWindow, dmgOutWindow,
    hitsPerWindow: windows ? +r1(hitsInWindow / windows) : 0,
    dmgPerWindow: windows ? +r1(dmgInWindow / windows) : 0,
    maxDamageInWindow: windowDamage.length ? Math.max(...windowDamage) : 0,
    enrageTick, enrageToFirstWindup: firstWindupAfterEnrage, enrageWindupTicks,
    followUps, phase2SlamGapMin: phase2SlamGaps.length ? Math.min(...phase2SlamGaps) : null,
    recoverWindow: b.ai.recover, windup: b.ai.windup, slamRadius: b.ai.slamRadius,
    result: s.status, seconds: +(s.tick / 60).toFixed(1), hearts: s.player.hearts, rivalHp: Math.max(0, b.hp),
  };
}
// (د) تجربة حقيقية: نقف عند بداية إنذار صدمة في المرحلة الثانية (اللاعب واقف داخل نصف القطر)،
// ثم نقفز في كل إطار من إطارات الإنذار ونرى أي التوقيتات تنجّي من الصدمتين معاً.
function bossWindupPrefix(seed, radius) {
  const s = R.create('miner', seed, { zone: 3, mode: 'duel' });
  const masks = [];
  for (let t = 0; t < 9000 && s.status === 'playing'; t++) {
    const b = s.enemies[0];
    const m = BOTS.expert(s);
    const before = s.tick;
    masks.push(m);
    R.step(s, m);
    const ev = (s.events || []).find((e) => e.type === 'boss_windup' && e.attack === 'overhead');
    if (ev && (b.phase || 1) >= 2) {
      const dist = Math.abs((b.x + b.w / 2) - (s.player.x + s.player.w / 2));
      if (dist <= radius && s.player.grounded) {
        return { masks: masks.slice(), ticks: ev.ticks, dist: Math.round(dist), grounded: s.player.grounded, tick: s.tick };
      }
    }
    if (s.tick === before) break;
  }
  return null;
}
function bossFollowTest(seeds = [424242, 9001, 31337, 606, 1408, 2024, 7777, 11]) {
  const radius = R.create('miner', 1, { zone: 3, mode: 'duel' }).enemies[0].ai.slamRadius;
  let best = null;
  for (const seed of seeds) {
    const cap = bossWindupPrefix(seed, radius);
    if (!cap) continue;
    const jumpSafe = [], punished = [];
    for (let k = 0; k <= cap.ticks + 6; k++) {
      const sim = R.create('miner', seed, { zone: 3, mode: 'duel' });
      for (const m of cap.masks) R.step(sim, m);
      const h0 = sim.player.hearts;
      for (let j = 0; j <= cap.ticks + 40; j++) R.step(sim, j === k ? R.INPUT.JUMP : 0);
      if (sim.player.hearts >= h0) jumpSafe.push(k);
      // من يستغل النافذة بضربة قوية من الإطار 0 (كما يفعل اللاعب الطمّاع)
      const sim2 = R.create('miner', seed, { zone: 3, mode: 'duel' });
      for (const m of cap.masks) R.step(sim2, m);
      const h1 = sim2.player.hearts;
      for (let j = 0; j <= cap.ticks + 40; j++) R.step(sim2, j === 0 || j === 1 ? R.INPUT.HEAVY : 0);
      if (sim2.player.hearts < h1) punished.push(k);
    }
    const ranges = [];
    for (const k of jumpSafe) {
      const last = ranges[ranges.length - 1];
      if (last && k === last[1] + 1) last[1] = k; else ranges.push([k, k]);
    }
    const cand = { seed, windupTicks: cap.ticks, dist: cap.dist, jumpSafeFrames: jumpSafe.length,
      totalFrames: cap.ticks + 7, ranges, greedyPunished: punished.length > 0 };
    if (!best || cand.jumpSafeFrames > best.jumpSafeFrames) best = cand;
  }
  return best;
}

const report = { matrix, gearDelta, decompose, heartsLadder, wind: waveWindow(), boss: bossReport(), bossFollow: bossFollowTest() };

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2));
} else {
  console.log('=== مصفوفة الفوز: منطقة × مستوى معدات × مستوى مهارة (٨ بذور لكل خلية) ===\n');
  for (const bot of BOTS_ORDER) {
    console.log(`— ${bot} —`);
    console.log('gear | قلوب |   z0   |   z1   |   z2   |   z3   |  زمن(z3) | ضربات متلقاة | مهارات | وفاة/مهلة');
    for (const gear of GEARS) {
      const row = ZONES.map((z) => String(matrix[bot][gear][z].winRate).padStart(5) + '%');
      const hp = matrix[bot][gear][0].hearts;
      const dd = ZONES.reduce((a, z) => a + matrix[bot][gear][z].died, 0);
      const tt = ZONES.reduce((a, z) => a + matrix[bot][gear][z].timedOut, 0);
      const t3 = matrix[bot][gear][3].avgSeconds;
      const taken = avg(ZONES.map((z) => matrix[bot][gear][z].avgTaken)).toFixed(2);
      const win = avg(ZONES.map((z) => matrix[bot][gear][z].avgWindows)).toFixed(1);
      const sk = avg(ZONES.map((z) => matrix[bot][gear][z].avgSkillUses)).toFixed(2);
      console.log(` L${gear}  | ${String(hp).padStart(4)} | ${row.join(' | ')} | ${String(t3).padStart(6)}s | ${String(taken).padStart(12)} | ${sk} | ${dd}/${tt}`);
    }
    console.log('');
  }
  console.log('=== سلّم القلوب/الضرر مع المعدات (بطل المنجم) ===');
  console.log('gear | قلوب | قلوب الساحة | ضرر/ضربة | نَفَس | مهلة المهارة | مهلة المراوغة');
  for (const h of report.heartsLadder) {
    console.log(` L${h.level}  | ${String(h.maxHearts).padStart(4)} | ${String(h.duelHearts).padStart(11)} | ${String(h.damage).padStart(9)} | ${String(h.stamina).padStart(4)} | ${String(h.skillCd).padStart(13)} | ${String(h.dodgeCd).padStart(13)}`);
  }
  console.log('\n=== تفكيك أثر بنود المعدات: أي بند يقلب النتيجة؟ (٨ بذور) ===');
  for (const bot of ['novice', 'noviceJump', 'intermediate']) {
    console.log(`— ${bot} —`);
    console.log('loadout        |  z0  |  z1  |  z2  |  z3  | قلوب الساحة');
    for (let i = 0; i < report.decompose[bot][0].length; i++) {
      const row = ZONES.map((z) => String(report.decompose[bot][z][i].winRate).padStart(4) + '%');
      console.log(`${report.decompose[bot][0][i].key.padEnd(14)} | ${row.join(' | ')} | ${report.decompose[bot][0][i].maxHearts}`);
    }
    console.log('');
  }
  console.log('=== اعتماد الفوز على المعدات (L5 − L0) ===\n');
  console.log('bot          | z0 winΔ  takenΔ | z1 winΔ  takenΔ | z2 winΔ  takenΔ | z3 winΔ  takenΔ');
  for (const bot of BOTS_ORDER) {
    const cells = ZONES.map((z) => {
      const g = gearDelta[bot][z];
      return `${String(g.winDelta).padStart(6)}% ${String(g.takenDelta).padStart(7)}`;
    });
    console.log(`${bot.padEnd(12)} | ${cells.join(' | ')}`);
  }
  console.log('\n=== سيّاف الريح: نافذة القفز/المراوغة/الصدّ فوق الموجتين ===');
  const w = report.wind;
  console.log(`الموجة: عرض ${w.wave.w}px وارتفاع ${w.wave.h}px وسرعة ${w.wave.speed}px/ث · فجوة الموجة الثانية ${w.wave.gap} إطارات`);
  console.log(`القفزة: ${w.jumpAirtime} إطاراً في الهواء · ارتفاع ${w.jumpApex}px · أقصى مدى للموجة ${Math.round((w.wave.ttl * w.wave.speed) / 60)}px (العمر ${w.wave.ttl} إطاراً)`);
  for (const d of w.distances) {
    const cells = d.trials.map((t) => {
      const name = t.input === 'jump' ? 'قفز' : t.input === 'dodge' ? 'مراوغة' : 'صدّ';
      return `${name} ${t.safeFrames}${t.input === 'guard' ? '' : '/' + (t.total || 61)}${t.ranges.length && t.input !== 'guard' ? ' ' + JSON.stringify(t.ranges) : ''}`;
    });
    const t0 = d.trials.find((t) => t.dist) || {};
    console.log(`مدى ${d.keep}px → إطلاق على ${t0.dist ?? '—'}px · إنذار ${t0.windupTicks ?? '—'} إطاراً · وصول الموجة بعد ${t0.travel ?? '—'} إطاراً من الإطلاق: ${cells.join(' · ')}`);
  }
  console.log('\n=== الزعيم: استغلال نافذة الاستشفاء والاستجابة للمرحلة الثانية ===');
  const b = report.boss;
  console.log(`نوافذ الاستشفاء ${b.windows} · ضربات داخلها ${b.hitsInWindow} (${b.hitsPerWindow} لكل نافذة) · ضربات خارجها ${b.hitsOutWindow}`);
  console.log(`ضرر داخل النوافذ ${b.dmgInWindow} · ضرر خارجها ${b.dmgOutWindow} (الجدار المدرّع) · أقصى ضرر في نافذة واحدة ${b.maxDamageInWindow}`);
  console.log(`النافذة ${b.recoverWindow} إطاراً · الإنذار ${b.windup} إطاراً · نصف قطر الصدمة ${b.slamRadius}px`);
  console.log(`بعد الاهتياج: أول إنذار بعد ${b.enrageToFirstWindup} إطاراً ويُمنح اللاعب ${b.enrageWindupTicks} إطاراً للقراءة`);
  console.log(`صدمات تابعة في المرحلة الثانية: ${b.followUps} · أقصر فاصل بين صدمتين ${b.phase2SlamGapMin} إطاراً`);
  const bf = report.bossFollow;
  if (bf) {
    console.log(`اختبار الصدمة المزدوجة (منذ بداية الإنذار، مسافة ${bf.dist}px، إنذار ${bf.windupTicks} إطاراً):`);
    console.log(`  قفزة واحدة تنجّي من الصدمتين في ${bf.jumpSafeFrames} من ${bf.totalFrames} توقيتاً · النوافذ ${JSON.stringify(bf.ranges)}`);
    console.log(`  من يهجم بدل القفز داخل الإنذار يُصاب بالصدمة: ${bf.greedyPunished ? 'نعم' : 'لا'}`);
  } else console.log('اختبار الصدمة المزدوجة: لم تُلتقط حالة صالحة (لاعب واقف داخل نصف القطر عند إنذار المرحلة الثانية)');
  console.log(`نتيجة قياس الزعيم: ${b.result} في ${b.seconds} ثانية بقلوب ${b.hearts} · صحة الزعيم المتبقية ${b.rivalHp}`);

}
