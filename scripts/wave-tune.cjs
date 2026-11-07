// ضبط موجتي سيّاف الريح: يجرّب (سرعة، عرض، فجوة) على نسخة معدّلة من المحرك الحقيقي
// ويقيس نافذة القفز فوق الموجتين. لا يعدّل أي ملف إنتاجي.
//   node scripts/wave-tune.cjs
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { waveWindow } = require('./wave-probe.cjs');
const SRC = path.join(__dirname, '..', 'public', 'platform-rules.js');
const source = fs.readFileSync(SRC, 'utf8');
const LINE = /waveTune: Object\.freeze\(\{ speed: \d+, w: \d+, gap: \d+ \}\)/;

const candidates = [
  { speed: 190, w: 28, gap: 10, note: 'V10 (المرجع)' },
  { speed: 240, w: 28, gap: 10, note: '' },
  { speed: 280, w: 28, gap: 10, note: '' },
  { speed: 320, w: 28, gap: 10, note: '' },
  { speed: 340, w: 28, gap: 10, note: '' },
  { speed: 360, w: 28, gap: 10, note: '' },
  { speed: 320, w: 24, gap: 10, note: '' },
  { speed: 300, w: 26, gap: 10, note: '' },
];

const rows = [];
for (const c of candidates) {
  if (!LINE.test(source)) throw new Error('waveTune line not found');
  const patched = source.replace(LINE, `waveTune: Object.freeze({ speed: ${c.speed}, w: ${c.w}, gap: ${c.gap} })`);
  const file = path.join(os.tmpdir(), `rules-tune-${c.speed}-${c.w}-${c.gap}.js`);
  fs.writeFileSync(file, patched);
  delete require.cache[require.resolve(file)];
  const R = require(file);
  const near = waveWindow(R, { keep: 140 });
  const mid = waveWindow(R, { keep: 200 });
  const pick = (arr, k) => arr.find((t) => t.input === k) || {};
  rows.push({
    cfg: `${c.speed}/${c.w}/${c.gap}`, note: c.note,
    nearDist: pick(near, 'jump').dist, nearJump: pick(near, 'jump').safeFrames,
    nearDodge: pick(near, 'dodge').safeFrames, nearGuard: pick(near, 'guard').safeFrames,
    midJump: pick(mid, 'jump').safeFrames, midDodge: pick(mid, 'dodge').safeFrames,
    travel: pick(near, 'jump').travel,
  });
  fs.unlinkSync(file);
}
console.log('سرعة/عرض/فجوة | مسافة | وصول | قفز(قريب) | مراوغة(قريب) | صدّ | قفز(134px) | مراوغة(134px) | ملاحظة');
for (const r of rows) {
  console.log(`${r.cfg.padEnd(12)} | ${String(r.nearDist).padStart(4)}px | ${String(r.travel).padStart(3)}f | ${String(r.nearJump).padStart(10)} | ${String(r.nearDodge).padStart(12)} | ${String(r.nearGuard).padStart(4)} | ${String(r.midJump).padStart(10)} | ${String(r.midDodge).padStart(13)} | ${r.note}`);
}
