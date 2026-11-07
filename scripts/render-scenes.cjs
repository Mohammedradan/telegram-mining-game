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

function frame(sim, opts, file, w, h, scale = 1) {
  const canvas = createCanvas(w, h);
  canvas.clientWidth = w / scale; canvas.clientHeight = h / scale;
  const sandbox = { PlatformRules: R, devicePixelRatio: Math.min(2, scale), Math, Date, console,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['platform-scenery.js', 'platform-bosses.js', 'platform-arena-scene.js', 'platform-renderer.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'), sandbox);
  const { hint, caption, ...drawOpts } = opts;
  sandbox.PlatformRenderer.draw(canvas, sim, { particles: [], floaters: [], beams: [], shake: 0, ...drawOpts });
  if (hint || caption) overlay(canvas, w / scale, h / scale, scale, hint, caption);
  const target = path.join(OUT, file);
  fs.writeFileSync(target, canvas.toBuffer('image/png'));
  console.log(`${file}  ${w}×${h}`);
}

// إطار الواجهة فوق القماش: التلميح وشريط الحالة كما في index.html (نفس الألوان والأحجام وحد 88%
// من العرض) — يُعاد رسمه هنا لأن CSS لا يُنفَّذ بلا متصفح، والقيم منقولة من CSS نفسه.
const rounded = (c, x, y, w, h, r) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};
function overlay(canvas, cssW, cssH, scale, hint, caption) {
  const c = canvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); // الرسم يترك تحويلاً (scale/translate) — نعيده قبل طبقة الواجهة
  const S = scale;
  if (hint) {
    // .arena-hint: top 44px · max-width 88% · rgba(28,14,4,.9) · إطار rgba(255,196,120,.7) · 10.5px/1.5
    c.font = `800 ${10.5 * S}px sans-serif`;
    const maxW = cssW * 0.88 * S;
    const lines = [];
    let line = '';
    for (const word of String(hint).split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && c.measureText(next).width > maxW - 22 * S) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    const lineH = 10.5 * S * 1.5;
    const boxW = Math.min(maxW, Math.max(...lines.map((l) => c.measureText(l).width)) + 22 * S);
    const boxH = lines.length * lineH + 10 * S;
    const x = (cssW * S - boxW) / 2, y = 44 * S;
    rounded(c, x, y, boxW, boxH, 10 * S);
    c.fillStyle = 'rgba(28,14,4,.9)'; c.fill();
    c.lineWidth = 1 * S; c.strokeStyle = 'rgba(255,196,120,.7)'; c.stroke();
    c.fillStyle = '#ffe6c2';
    c.textAlign = 'left'; // العربية تُرسم بمحاذاة يسار داخل عرضها المقيس
    c.textBaseline = 'middle';
    lines.forEach((l, i) => c.fillText(l, x + (boxW - c.measureText(l).width) / 2, y + 5 * S + lineH * (i + 0.5)));
  }
  if (caption) {
    // شريط حالة المسرح أثناء اللقطة (.arena-duel-status)
    c.font = `800 ${11 * S}px sans-serif`;
    const w = c.measureText(caption).width + 20 * S, h = 18 * S;
    rounded(c, (cssW * S - w) / 2, cssH * S - h - 8 * S, w, h, 9 * S);
    c.fillStyle = 'rgba(8,14,24,.78)'; c.fill();
    c.lineWidth = 1 * S; c.strokeStyle = 'rgba(255,200,120,.28)'; c.stroke();
    c.fillStyle = '#ffe9c0';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(caption, (cssW * S - (w - 20 * S)) / 2, cssH * S - h / 2 - 8 * S);
  }
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

// 2.5) ساحة ثانية (البامبو) لإثبات أن البيئات قابلة للتعدّد بنفس البنية
const bamboo = R.create(1, 9001, { zone: 1, mode: 'duel' });
bamboo.enemies[0].x = 380;
bamboo.player.x = 240;
for (let i = 0; i < 90; i++) R.step(bamboo, demoMask(bamboo, i));
frame(bamboo, { arenaId: 1, reduced: false }, 'arena-bamboo.png', 960, 540);

// 3) جولة تعدين عادية للمقارنة (يجب أن تبقى أنفاقًا لا ساحة)
const mine = R.create(0, 4242, { zone: 0 });
for (let i = 0; i < 40; i++) R.step(mine, R.INPUT.RIGHT);
frame(mine, { reduced: false }, 'mine-run.png', 960, 540);

// 4) V12: لقطتا المراجعة البصرية على هاتف صغير (360×202 CSS بكثافة 2) — اللحظة تُصنع بالمحرك
//    نفسه (R.capture) لا بيد ولا بحالة مكتوبة، فالموضع والحجم والتباين هي ما يراه اللاعب فعلاً.
const PHONE_W = 360, PHONE_H = 202, SCALE = 2;
const captureLoadout = { pickaxe: 2, armor: 2, drill: 2 }; // عتاد L2: منتصف الطريق، لا أقصى ولا صفر
for (const [kind, file, hint, caption] of [
  ['boss', 'arena-shot-boss.png', R.DUEL.phase2Hint, 'لقطة: الزعيم — المرحلة الثانية (مجموعة)'],
  ['wave', 'arena-shot-wave.png', null, 'لقطة: موجة الريح قريبة (مجموعة)'],
]) {
  const sim = R.capture.sim(kind, 'miner', { loadout: captureLoadout });
  if (!sim) { console.log(`تعذّرت لقطة ${kind}: اللحظة لم تُبلَغ`); continue; }
  const heat = Math.max(0, Math.min(1, 1 - Math.max(0, sim.enemies[0].hp) / Math.max(1, sim.enemies[0].maxHp)));
  frame(sim, { arena: true, arenaId: sim.zone % 4, arenaHeat: heat, hint, caption },
    file, PHONE_W * SCALE, PHONE_H * SCALE, SCALE);
  const wave = (sim.waves || []).find((w) => !(w.delay > 0));
  console.log(`   ${kind}: tick ${sim.tick} · ${sim.enemies[0].name} ${sim.enemies[0].state}/${sim.enemies[0].attack}` +
    ` · مرحلة ${sim.enemies[0].phase} · مؤقّت ${sim.enemies[0].timer}` +
    (wave ? ` · فجوة الموجة ${Math.round(Math.abs((wave.x + wave.w / 2) - (sim.player.x + sim.player.w / 2)))}px` : ''));
}

console.log(`تم. اللقطات في ${path.relative(ROOT, OUT) || '.'}`);
