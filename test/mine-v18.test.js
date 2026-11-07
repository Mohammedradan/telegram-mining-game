// V18: أرض المنجم صارت بمنظور (مثل أرضية الساحة) بدل الكتلة المسطّحة ذات الشقوق الأفقية.
// هذه الاختبارات تحرس: (1) المنظور موجود فعلاً، (2) الحافة العشبية التي يقف عليها البطل باقية،
// (3) ألوان كل منجم من جلده لا لون موحّد، (4) الشاشة عرض فقط — لا تلمس حالة المحاكاة،
// و(5) الساحة ما زالت تستثني كتل الأرض كما كانت.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(ROOT, 'public', 'platform-renderer.js'), 'utf8');

const groundStart = renderer.indexOf('function drawMineGround');
const helper = groundStart >= 0 ? renderer.slice(groundStart, renderer.indexOf('// ---- Main draw ----')) : '';

test('drawMineGround موجود ويستعمل نقطة تلاشٍ وصفوفاً تتباعد هندسياً', () => {
  assert.ok(groundStart > 0, 'drawMineGround is defined');
  assert.match(helper, /const vpx = camera \+ w \/ 2, K = [\d.]+;/, 'a screen-centred vanishing point with a convergence factor');
  assert.match(helper, /const ROWS = \d+/, 'the floor is split into perspective rows');
  assert.match(helper, /Math\.pow\(r \/ ROWS, 2\)/, 'row spacing grows toward the viewer');
  assert.match(helper, /const farX = vpx \+ \(x - vpx\) \* K;/, 'longitudinal seams pull toward the vanishing point');
  assert.match(helper, /c\.moveTo\(x, bottom\); c\.lineTo\(farX, top \+ 10\);/, 'and are drawn from the near edge up to the floor top');
});

test('الحافة العشبية (سطح الوقوف) باقية كما كانت فوق الأرض المنظورية', () => {
  assert.match(helper, /c\.fillStyle = sk\.top\[0\]; c\.fillRect\(box\.x, top, box\.w, 9\);/, 'the grassy top edge is still painted');
  assert.match(helper, /c\.fillStyle = sk\.top\[1\]; c\.fillRect\(box\.x, top, box\.w, 6\);/, 'with the same three-layer trim');
  assert.match(helper, /c\.fillStyle = sk\.top\[2\]; c\.fillRect\(box\.x, top \+ 2, box\.w, 3\);/, 'and the bright highlight line');
  assert.match(helper, /c\.fillStyle = sk\.moss;/, 'moss patches stay too');
  // الترتيب: العشب يُرسم بعد التربة فيغطّي أعلى العمود
  assert.ok(helper.indexOf('sk.top[0]') > helper.indexOf('sk.rock[1]'), 'the trim is drawn after the dirt');
});

test('ألوان الأرض من جلد المنجم لا لون واحد لكل العوالم', () => {
  assert.match(helper, /g\.addColorStop\(0, sk\.rock\[1\]\); g\.addColorStop\(0\.45, sk\.rock\[0\]\)/, 'dirt gradient uses the zone rock palette');
  assert.doesNotMatch(helper, /#3a2f24|#2c2217|#171109|#0d0a07/, 'no hard-coded brown overrides the zone skin');
  assert.match(helper, /c\.fillStyle = t > 0\.55 \? sk\.hi : sk\.crack;/, 'pebbles are tinted by the same skin');
  assert.match(helper, /تعتيم المقدمة/, 'a near-camera falloff closes the bottom edge');
});

test('الأرض المنظورية مرتبطة بكتل الأرض فقط والساحة ما زالت تستثنيها', () => {
  const arenaSkip = renderer.indexOf('if (arenaMode && box.y >= 290) continue;');
  const hook = renderer.indexOf('if (!arenaMode && box.y >= 290 && box.h >= 40) { drawMineGround(c, box, camera, w, sk); continue; }');
  assert.ok(arenaSkip > 0, 'the arena still skips mine ground blocks');
  assert.ok(hook > 0, 'the mine ground hook exists');
  assert.ok(hook > arenaSkip, 'and runs after the arena bypass, so the arena floor is untouched');
  // لا استبدال للمنصّات المعلّقة: الشرط يقيّد الكتلة العريضة عند خط الأرض
  assert.match(renderer, /box\.y >= 290 && box\.h >= 40/, 'only thick ground blocks (y>=290, h>=40) take the new path');
});

test('عرض فقط: الأرض لا تلمس حالة المحاكاة ولا تُغيّر أي رقم في القواعد', () => {
  assert.doesNotMatch(helper, /s\.(player|enemies|vein|fork|tick)\b/, 'the helper never reads or writes simulation state');
  assert.doesNotMatch(helper, /PlatformRules|R\.(step|create|LEVEL)/, 'and never touches the rules module');
  const rules = fs.readFileSync(path.join(ROOT, 'public', 'platform-rules.js'), 'utf8');
  assert.match(rules, /\{ x: 0, y: 300, w: 720, h: 80 \}/, 'the physics ground boxes are unchanged');
});

test('V18.1: ضباب أرضي وظل تلامس للديكور — قبل طبقة المقدمة فقط', () => {
  const haze = renderer.indexOf('V18.1: ضباب أرضي');
  const fgBlock = renderer.indexOf('c.save();\n    c.translate(-camera, 0);\n\n    // ---- Cavern props');
  assert.ok(haze > 0, 'the ground haze layer is documented');
  assert.ok(fgBlock > haze, 'it is painted before the foreground world layer');
  assert.match(renderer, /const groundHaze = c\.createLinearGradient\(0, 244, 0, 302\);/, 'haze spans the wall base above the floor line');
  // الظل يُرسم لكائنات الأرض فقط وداخل نفس الحلقة المحجوبة بالكاميرا
  assert.match(renderer, /V18\.1: ظل تلامس يثبّت الديكور على خط الأرض/, 'props get a contact shadow');
  assert.match(renderer, /const shadowW = ex\.type === 'cart' \? 22 : ex\.type === 'chest' \? 18 : 14;/, 'shadow width per prop type');
  assert.ok(renderer.indexOf('ظل تلامس') < renderer.indexOf("if (ex.type === 'cart') {\n        // mine cart"), 'the shadow is laid down before the prop body');
});
