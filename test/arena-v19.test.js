// V19 (مُحدَّث في المرحلة A): إطار الساحة مستقل عن إطار المنجم.
//
// تاريخ المشكلة: على مسرح مِلء الشاشة اشتُقّ عرض النافذة من نسبة الشاشة (بحدّ أدنى 520 وحدة)،
// فصار ارتفاع العالم 1125 وحدة على هاتف 390×844: البطل 6% من ارتفاع المسرح والسماء 94%.
// المرحلة A استبدلت المعادلة: النافذة تُشتق الآن من **مسافة المقاتلين** (arenaLayout في المُصيِّر)،
// والأرض تُثبَّت عند 82% من الارتفاع، والديكور يتبع الشريط المرئي. هذا الملف يحرس المبدأين
// اللذين لا يجوز كسرهما: (١) الحلبة لها إطارها الخاص، (٢) المنجم لم يتغيّر.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(ROOT, 'public', 'platform-renderer.js'), 'utf8');
const scene = fs.readFileSync(path.join(ROOT, 'public', 'platform-arena-scene.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const frame = renderer.slice(renderer.indexOf('const ARENA_FRAME = Object.freeze'), renderer.indexOf('const camera = arena ? arenaCamera'));

test('نافذة الساحة تُشتق من المقاتلين لا من نسبة الشاشة', () => {
  assert.match(renderer, /function arenaLayout\(state, cssW, cssH\)/, 'a pure framing function exists');
  assert.match(frame, /const fitW = sep \+ ARENA_FRAME\.margin \* 2;/, 'the window fits the pair plus a margin');
  assert.match(frame, /let w = Math\.min\(ARENA_FRAME\.maxW, Math\.max\(ARENA_FRAME\.minW, fitW\)\)/, 'and never drops below what fits them');
  assert.match(frame, /w = Math\.max\(w, ARENA_FRAME\.minWorldH \* aspect\)/, 'wide screens widen the window instead of squashing the world');
  assert.match(renderer, /const w = arena \? arena\.w : Math\.max\(280, \(360 \/ zoom\) \* aspect\);/, 'the arena and the mine each keep their own width rule');
  assert.match(renderer, /const worldH = arena \? arena\.worldH : Math\.max\(360 \/ zoom, w \/ aspect\);/, 'same for the height');
});

test('الكاميرا تُوسّط المقاتلين (كانت مقيّدة عند 0 فتُركت نصف الحلبة فارغة)', () => {
  assert.match(frame, /camera: mid - w \/ 2,/, 'the camera centres on the pair midpoint');
  assert.match(renderer, /const camera = arena \? arenaCamera\(s, arena\) : R\.cameraFor\(s, w\);/, 'the arena uses its own camera, the mine keeps cameraFor');
  assert.match(renderer, /arenaCamX \+= \(target - arenaCamX\) \* ARENA_FRAME\.panLerp;/, 'with light damping so it does not jitter');
  assert.match(renderer, /if \(state !== arenaCamSim\) \{ arenaCamSim = state; arenaCamX = layout\.camera; \}/, 'and it snaps when the fight changes');
});

test('السماء تتبع الإطار المرئي (لا شريط مسطّح بلا نجوم)', () => {
  assert.match(scene, /const SKY_TOP = V \? V\.top : -420;/, 'the sky starts at the visible top the renderer supplies');
  assert.match(scene, /c\.fillRect\(0, SKY_TOP - 600, w, \(360 - SKY_TOP\) \+ 600\);/, 'anything above it is filled with the top sky colour');
  assert.match(scene, /const starCount = Math\.round\(Math\.min\(150, skyBand \* 0\.34\)\);/, 'star density follows the visible band, not a fixed strip');
  assert.match(scene, /const farStars = Math\.round\(Math\.min\(80, skyBand \* 0\.16\)\);/, 'a second, slower layer fills the top of the frame');
  // التعتيم والأطراف يجب أن تغطّي المنطقة الممتدة نفسها وإلا ظهر خط أفقي عند y=0
  assert.match(scene, /c\.fillStyle = vig; c\.fillRect\(0, -4000, w, 4360\);/, 'the vignette covers the extended sky too');
  assert.match(scene, /c\.fillStyle = edge; c\.fillRect\(0, -4000, w, 4360\);/, 'and so does the rival-heat edge glow');
});

test('الأرض تُثبَّت عند 82% من ارتفاع المسرح والمنصّة تمتد أسفله', () => {
  assert.match(renderer, /const yTop = arena \? ARENA_FRAME\.groundAt \* pixelH - 360 \* sy : -\(360 - worldH\) \* sy;/, 'the arena pins the floor at a fixed share of the stage; the mine stays bottom-anchored');
  assert.match(scene, /const bottom = Math\.max\(384, Number\.isFinite\(bottomY\) \? bottomY \+ 14 : 0\);/, 'the dais reaches the visible bottom (no exposed edge)');
  assert.match(scene, /drawDais\(c, w, camera, th, tick, reduced, V \? V\.bottom : 0\);/, 'and receives the arena frame');
});

test('المنجم لم يتغيّر: حدّه 280 ونافذته وكاميرته كما كانت', () => {
  assert.match(renderer, /Math\.max\(280, \(360 \/ zoom\) \* aspect\)/, 'the mine keeps its previous minimum width');
  assert.match(renderer, /R\.cameraFor\(s, w\)/, 'and its own camera');
  assert.match(renderer, /if \(!arenaMode && box\.y >= 290 && box\.h >= 40\)/, 'the V18 mine ground hook is intact');
});

test('بصمات الأصول حُدِّثت حتى يصل الكود الجديد للهاتف', () => {
  assert.match(html, /platform-renderer\.js\?v=18/);
  assert.match(html, /platform-arena-scene\.js\?v=10/);
});
