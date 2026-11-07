// V16: مسرح الساحة صار بمنظور ثلاثي الأبعاد — عرض بصري فقط.
// هذه الاختبارات تحرس ثلاث نقاط: (1) الأرضية مرسومة بمنظور فعلي، (2) العمق (ضباب الأفق،
// الظلال، برك الضوء) موجود، (3) المشهد ما زال حتمياً ولا يلمس حالة المحاكاة إطلاقاً.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const scene = fs.readFileSync(path.join(ROOT, 'public', 'platform-arena-scene.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('أرضية الساحة بمنظور: صفوف تتباعد هندسياً وخطوط تتلاقى عند نقطة تلاشٍ', () => {
  const dais = scene.slice(scene.indexOf('function drawDais'), scene.indexOf('// ===== الخلفية الكاملة ====='));
  assert.match(dais, /const VPX = w \/ 2, K = [\d.]+;/, 'a vanishing point with a convergence factor is defined');
  assert.match(dais, /const ROWS = \d+;/, 'the floor is split into perspective rows');
  assert.match(dais, /Math\.pow\(r \/ ROWS, 2\.1\)/, 'row spacing grows toward the viewer (geometric perspective)');
  assert.match(dais, /const sx = x - camera, farX = VPX \+ \(sx - VPX\) \* K;/, 'longitudinal seams pull toward the vanishing point');
  assert.match(dais, /c\.moveTo\(sx, bottom\); c\.lineTo\(farX, top\);/, 'and are drawn from the near edge up to the horizon');
  // الأرضية تمتد تحت 360 كي لا تظهر حافة عند التكبير
  assert.match(dais, /const top = 300, bottom = 3\d\d;/, 'the platform overshoots the world bottom so zoom never reveals an edge');
});

test('عمق المشهد: ضباب أفق يفصل الخلفية، وبركات ضوء تتباعد، وظل مقدمة', () => {
  assert.match(scene, /ضباب الأفق/, 'the horizon haze layer is there');
  assert.match(scene, /createLinearGradient\(0, 232, 0, 300\)/, 'and sits exactly between the trees and the fight floor');
  const dais = scene.slice(scene.indexOf('function drawDais'), scene.indexOf('// ===== الخلفية الكاملة ====='));
  assert.match(dais, /for \(let r = 0; r < 3; r\+\+\)[\s\S]*Math\.pow\(t, 2\.1\)/, 'lantern light pools follow the same perspective');
  assert.match(dais, /ظلمة المقدمة/, 'a near-camera falloff closes the bottom edge');
});

test('المقاتلون: ظل تلامس + ظل مرمي في اتجاه واحد (حجم واتجاه)', () => {
  const ninja = scene.slice(scene.indexOf('function drawNinja'), scene.indexOf('function drawNinja') + 4000);
  assert.match(ninja, /const shR = \d+ \* \(p\.air \? 0\.7 : 1\), shA = p\.air \? [\d.]+ : [\d.]+;/, 'shadow size and strength follow the airborne state');
  assert.match(ninja, /createRadialGradient\(0, 0, 1, 0, 0, shR\)/, 'the soft shadow is a radial falloff, not a flat disc');
  assert.match(ninja, /c\.scale\(1, 0\.28\)/, 'it is squashed onto the floor plane');
  assert.match(ninja, /c\.ellipse\(11, 2, shR \* 0\.78, shR \* 0\.62/, 'a second shadow is cast to one side (light direction)');
  assert.match(ninja, /c\.ellipse\(0, 1, 11, 5/, 'plus a tight contact shadow at the feet');
});

test('الرسم بلا عشوائية وبلا لمس للمحاكاة: الحتمية محفوظة', () => {
  assert.doesNotMatch(scene, /Math\.random/, 'no Math.random anywhere in the arena scene');
  assert.doesNotMatch(scene, /ent\.(x|y|w|h|vx|vy)\s*[-+*/]?=/, 'the scene never moves or resizes an entity');
});

test('الملف يُقدّم بنسخة جديدة كي لا تُخدم نسخة قديمة من الكاش', () => {
  assert.match(html, /platform-arena-scene\.js\?v=8/, 'the arena scene buster moved to v=8');
});
