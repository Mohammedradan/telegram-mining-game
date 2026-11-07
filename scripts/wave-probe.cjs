// مجسّ نافذة القفز/المراوغة/الصدّ فوق موجتي الساحة، على المحرك الحقيقي.
// يُستعمل من تقرير القياس ومن أداة ضبط الموجة، فيبقى الرقم واحداً في كل التقارير.
//
// الطريقة: لاعب «وسادة» يحافظ على مسافة، ثم نعيد الإطارات ونضغط «قفز» في كل إطار ممكن
// ونحسب الإطارات التي تعبر فيها الموجتان بلا ضرر. القياس على الموجة وحدها (لا ضربة قريبة).
const overlapBox = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ضربة موجة = نقص قلب في الإطار نفسه الذي يلامس فيه جسمُ موجة غير مؤجّلة جسدَ اللاعب.
function waveHitOnStep(R, sim, heartsBefore) {
  const p = sim.player;
  if (sim.player.hearts >= heartsBefore) return false;
  return sim.waves.some((w) => !(w.delay > 0) && overlapBox(p, w));
}

function spacer(R, s, keep) {
  const p = s.player, e = s.enemies[0];
  if (!e) return 0;
  const d = (e.x + e.w / 2) - (p.x + p.w / 2);
  if (Math.abs(d) < keep - 20) return d > 0 ? R.INPUT.LEFT : R.INPUT.RIGHT;
  if (Math.abs(d) > keep + 20) return d > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
  return 0;
}

function captureWavePrefix(R, zone, seed, keep) {
  const s = R.create('miner', seed, { zone, mode: 'duel' });
  const masks = [];
  let windupTicks = null;
  for (let t = 0; t < 3000 && s.status === 'playing'; t++) {
    const before = s.waves.length;
    masks.push(spacer(R, s, keep));
    R.step(s, masks[masks.length - 1]);
    for (const ev of s.events || []) if (ev.type === 'boss_windup' && ev.attack === 'wave' && windupTicks === null) windupTicks = ev.ticks;
    if (s.waves.length > before) {
      const w = s.waves[s.waves.length - 1];
      const dist = Math.abs(w.x - (s.player.x + s.player.w));
      if (dist >= keep - 80) {
        return { masks: masks.slice(), spawnTick: s.tick, dist: Math.round(dist), windupTicks,
          travel: Math.round((dist / (s.enemies[0].ai.wave.speed || 190)) * 60) };
      }
    }
  }
  return null;
}

// keep = المسافة التي يحافظ عليها اللاعب الوسادة · kinds = قفز/مراوغة/صدّ
function waveWindow(R, { zone = 2, keep = 140, seeds = [424242, 9001, 31337, 606, 1408, 2024, 7777, 11], kinds = ['jump', 'dodge', 'guard'] } = {}) {
  const out = [];
  for (const kind of kinds) {
    const input = kind === 'jump' ? R.INPUT.JUMP : kind === 'dodge' ? R.INPUT.DODGE : R.INPUT.DEFEND;
    let best = null;
    for (const seed of seeds) {
      const cap = captureWavePrefix(R, zone, seed, keep);
      if (!cap) continue;
      const safe = [];
      const fan = kind === 'guard' ? 1 : 60;
      for (let k = 0; k <= fan; k++) {
        const sim = R.create('miner', seed, { zone, mode: 'duel' });
        for (const m of cap.masks) R.step(sim, m);
        let hit = false;
        for (let j = 0; j <= 60; j++) {
          const hb = sim.player.hearts;
          const mask = kind === 'guard' ? (j >= k ? input : 0) : (j === k ? input : 0);
          R.step(sim, mask);
          if (waveHitOnStep(R, sim, hb)) { hit = true; break; }
        }
        if (!hit) safe.push(k);
      }
      const ranges = [];
      for (const k of safe) {
        const last = ranges[ranges.length - 1];
        if (last && k === last[1] + 1) last[1] = k; else ranges.push([k, k]);
      }
      const cand = { seed, spawnTick: cap.spawnTick, windupTicks: cap.windupTicks, dist: cap.dist, travel: cap.travel,
        safeFrames: safe.length, ranges };
      if (!best || cand.safeFrames > best.safeFrames) best = cand;
    }
    out.push({ input: kind, ...(best || { safeFrames: 0, ranges: [], seed: null, dist: null }) });
  }
  return out;
}

module.exports = { waveWindow, captureWavePrefix, waveHitOnStep, spacer, overlapBox };
