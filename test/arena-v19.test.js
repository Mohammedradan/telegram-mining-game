// V19: إطار الساحة على مسرح مِلء الشاشة. المشكلة التي ظهرت على الهاتف: تبويب الساحة صار يملأ
// الشاشة، فاشتُقّ عرض النافذة من نسبة الشاشة فانكمش إلى 280 وحدة — ومواضع مقاتلي الساحة ثابتة
// (البطل ≈230 والخصم حتى 470) فصار الخصم يُقصّ خارج الإطار، والمشهد مسحوقاً.
// الحل: حدّ أدنى لعرض نافذة الساحة + تعويض الفرق بالارتفاع (سماء ممتدة بلا شريط أسود).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(ROOT, 'public', 'platform-renderer.js'), 'utf8');
const scene = fs.readFileSync(path.join(ROOT, 'public', 'platform-arena-scene.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const frame = renderer.slice(renderer.indexOf('const ARENA_MIN_W'), renderer.indexOf('const camera = R.cameraFor'));

test('نافذة الساحة لها حدّ أدنى للعرض يكفي مقاتليها (حتى x=470)', () => {
  assert.match(renderer, /const ARENA_MIN_W = 5\d\d;/, 'arena window has a fixed minimum width');
  assert.match(frame, /let w = Math\.max\(arenaMode \? ARENA_MIN_W : 280, \(360 \/ zoom\) \* aspect\);/, 'the arena width never drops below it (the mine keeps its own floor of 280)');
  assert.match(frame, /const aspect = cssW \/ Math\.max\(1, cssH\);/, 'aspect is computed once');
  assert.match(frame, /const worldH = Math\.max\(360 \/ zoom, w \/ aspect\);/, 'extra room is taken as height, so scale stays uniform');
  assert.match(frame, /const scale = pixelW \/ w, sy = pixelH \/ worldH/, 'both scales still come from the same window');
});

test('السماء تمتد فوق y=0 بلا شريط أسود ولا حدّ حاد', () => {
  assert.match(scene, /const SKY_TOP = -\d+;/, 'the backdrop sky starts above the world top');
  assert.match(scene, /c\.fillRect\(0, -4000, w, 4000 \+ 360\);/, 'any further height is filled with the top sky colour');
  assert.match(scene, /c\.fillRect\(0, SKY_TOP, w, 360 - SKY_TOP\);/, 'the gradient covers the extended band');
  assert.match(scene, /السماء العالية/, 'a high star band keeps the extended sky textured');
  // التعتيم والأطراف يجب أن تغطّي المنطقة الممتدة نفسها وإلا ظهر خط أفقي عند y=0
  assert.match(scene, /c\.fillStyle = vig; c\.fillRect\(0, -4000, w, 4360\);/, 'the vignette covers the extended sky too');
  assert.match(scene, /c\.fillStyle = edge; c\.fillRect\(0, -4000, w, 4360\);/, 'and so does the rival-heat edge glow');
});

test('الأرض تبقى مثبّتة على y=360 مهما كان طول الشاشة', () => {
  assert.match(frame, /yTop = -\(360 - worldH\) \* sy;/, 'the frame is bottom-anchored at the fight floor');
  assert.match(scene, /const top = 300, bottom = 384;/, 'the dais still overshoots the world bottom');
});

test('المنجم لم يتغيّر: حدّه 280 ونافذته كما كانت', () => {
  assert.match(frame, /arenaMode \? ARENA_MIN_W : 280/, 'the mine keeps its previous minimum width');
  assert.match(renderer, /if \(!arenaMode && box\.y >= 290 && box\.h >= 40\)/, 'the V18 mine ground hook is intact');
});

test('بصمات الأصول حُدِّثت حتى يصل الكود الجديد للهاتف', () => {
  assert.match(html, /platform-renderer\.js\?v=16/);
  assert.match(html, /platform-arena-scene\.js\?v=9/);
});
