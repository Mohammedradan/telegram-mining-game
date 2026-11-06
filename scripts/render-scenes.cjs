// لقطات مشهد حقيقية بلا متصفح: يرسم مسرح الساحة والمبارزة على قماش فعلي (@napi-rs/canvas)
// ويحفظها PNG كي تُراجع بالعين. لا يُشغَّل ضمن `npm test` لأنه يحتاج حزمة اختيارية.
//
//   npm i --no-save @napi-rs/canvas
//   node scripts/render-scenes.cjs --out .shots
//
// المقاسات: سطح المكتب 960×540 (16:9) والهاتف 360×203 — نفس نسبة مسرح تبويب الساحة.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let createCanvas;
try {
  ({ createCanvas } = require('@napi-rs/canvas'));
} catch (_) {
  console.log('SKIPPED: @napi-rs/canvas غير مثبتة. شغّل: npm i --no-save @napi-rs/canvas');
  process.exit(0);
}

const R = require(path.join(ROOT, 'public/platform-rules'));
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return path.resolve(ROOT, i > -1 && process.argv[i + 1] ? process.argv[i + 1] : '.shots');
})();
fs.mkdirSync(OUT, { recursive: true });

function frame(sim, opts, file, w, h) {
  const canvas = createCanvas(w, h);
  canvas.clientWidth = w; canvas.clientHeight = h;
  const sandbox = { PlatformRules: R, devicePixelRatio: Math.min(2, 1), Math, Date, console,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['platform-scenery.js', 'platform-bosses.js', 'platform-renderer.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'), sandbox);
  sandbox.PlatformRenderer.draw(canvas, sim, { particles: [], floaters: [], beams: [], shake: 0, ...opts });
  const target = path.join(OUT, file);
  fs.writeFileSync(target, canvas.toBuffer('image/png'));
  console.log(`${file}  ${w}×${h}`);
}

// الأوامر نفسها التي يستخدمها المسرح الاستعراضي في تبويب الساحة
function demoMask(s, tick) {
  const p = s.player, rival = s.enemies[0];
  if (!rival) return 0;
  let mask = 0;
  const cx = p.x + p.w / 2, rx = rival.x + rival.w / 2, d = rx - cx;
  if (Math.abs(d) > 42) mask |= d > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
  else if (p.attack <= 0 && !p.swing) mask |= tick % 150 > 100 && p.heavyCooldown <= 0 ? R.INPUT.HEAVY : R.INPUT.ATTACK;
  return mask;
}

function duelSim() {
  const s = R.create(0, 7717, { zone: 0, mode: 'duel' });
  s.enemies[0].x = 380;
  s.player.x = 230;
  return s;
}

// 1) مبارزة جارية
const duel = duelSim();
for (let i = 0; i < 150; i++) R.step(duel, demoMask(duel, i));
frame(duel, { reduced: false }, 'arena-duel.png', 960, 540);
frame(duel, { reduced: false }, 'arena-duel-phone.png', 360, 203);

// 2) لحظة إنذار الخصم (قراءة النيّة)
const warn = duelSim();
let guard = 0;
while (guard++ < 900 && !(warn.enemies[0].state === 'windup' && warn.enemies[0].timer < warn.enemies[0].ai.windup * 0.45)) {
  R.step(warn, demoMask(warn, guard));
}
frame(warn, { reduced: false }, 'arena-windup.png', 960, 540);

// 3) جولة تعدين عادية للمقارنة (يجب أن تبقى أنفاقًا لا ساحة)
const mine = R.create(0, 4242, { zone: 0 });
for (let i = 0; i < 40; i++) R.step(mine, R.INPUT.RIGHT);
frame(mine, { reduced: false }, 'mine-run.png', 960, 540);

console.log(`تم. اللقطات في ${path.relative(ROOT, OUT) || '.'}`);
