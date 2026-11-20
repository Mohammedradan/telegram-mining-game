'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const digSite = fs.readFileSync(path.join(root, 'public/dig-site.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/clicker.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

test('classic mining stays visible while the adventure world is an explicit switch', () => {
  assert.match(page, /<div id="adv-scene"[^>]* hidden>/);
  assert.match(page, /<div id="ck-stage"[^>]*>/);
  assert.doesNotMatch(page.slice(page.indexOf('<div id="ck-stage"'), page.indexOf('<div id="ck-stage"') + 180), /hidden/);
  assert.match(page, /<button id="adv-open"[^>]*>عالم المنجم<\/button>/);
  assert.match(page, /classicEl\.hidden = true;\s*sceneEl\.hidden = false;/);
  assert.match(page, /sceneEl\.hidden = true;\s*classicEl\.hidden = false;/);
});

test('a connected overland landscape has walkable terrain, obstacles, and route progress driven by the miner', () => {
  assert.equal((digSite.match(/class="ck-route-node" data-route-index=/g) || []).length, 6);
  assert.match(digSite, /class="ck-overland-world" hidden role="region" aria-label="مسار جبلي متصل بين المناجم/);
  assert.match(digSite, /class="ck-land-ground" aria-hidden="true"/);
  assert.match(digSite, /class="ck-overland-road"/);
  assert.match(digSite, /overlandWorld\.dataset\.segment = String\(MineWorld\.routeSegment\(mineWorld\)\)/);
  assert.match(digSite, /MineWorld\.routeObstacles\(mineWorld\)/);
  assert.match(digSite, /element\.style\.left = `\$\{\(obstacle\.x \* 100\)\.toFixed\(2\)\}%`/);
  assert.match(styles, /\.ck-overland-world\[data-segment="4"\]/);
  assert.match(styles, /\.ck-land-ground:before/);
  assert.match(digSite, /data-obstacle="boulder"/);
  assert.match(digSite, /data-obstacle="steam"/);
  assert.match(digSite, /mineWorld\.routeProgress/);
  assert.match(digSite, /traveler\.setAttribute\('transform', `translate\(\$\{x\} 38\)`/);
  assert.match(digSite, /تحدّي الانهيار: احفر/);
  assert.match(digSite, /اصعد بالسلم أو المصعد إلى الممر العلوي/);
  assert.match(digSite, /data-route-index/);
  assert.doesNotMatch(digSite, /showOverlandTrip|ck-overland-transition/);
});

test('mine exits and overland travel preserve the physical edge while the player walks to the next cave', () => {
  const world = fs.readFileSync(path.join(root, 'public/mine-world.js'), 'utf8');
  assert.match(world, /state\.mode='overland'/);
  assert.match(world, /state\.travelDirection=-1/);
  assert.match(world, /state\.index=Math\.min\(MINES\.length-1,state\.index\+1\)/);
  assert.match(world, /state\.lastExit='arrive-forward'; miner\.x=band\.x0/);
  assert.match(digSite, /overlandWorld\.hidden = !overland/);
  assert.match(digSite, /if \(traversal\.transition === 'arrive'\)/);
  assert.match(styles, /\.ck-overland-world\[hidden\]\{display:none!important\}/);
  assert.match(styles, /\.ck-mine-set\[data-route-mode="overland"\]/);
  assert.match(styles, /#ck-world\[data-route-mode="overland"\] #mine-btn \{ visibility: hidden; pointer-events: none; \}/);
  assert.match(styles, /\.ck-road-obstacle/);
});

test('mobile drill and assigned hauler are positioned around the mine deposit', () => {
  assert.match(digSite, /class="ck-mobile-rig"/);
  assert.match(digSite, /class="ck-mobile-hauler"/);
  const targets = digSite.slice(digSite.indexOf('function fieldTargets'), digSite.indexOf('function positionFieldUnits'));
  assert.match(targets, /rig: drilling[\s\S]*rock\.x/);
  assert.match(targets, /worker: assigned[\s\S]*rock\.x - 0\.16/);
  assert.match(digSite, /fieldUnitsNeedFrame/);
  assert.match(styles, /\.ck-mobile-rig\{/);
  assert.match(styles, /\.ck-mobile-hauler\{/);
  assert.match(styles, /assets\/cave\/crew\/rig\.webp/);
});

test('the mountain obstacle unlocks only through mining progress, with responsive and reduced-motion styling', () => {
  assert.match(digSite, /صخور تسد الطريق/);
  assert.match(digSite, /انهيار صخري · 3 صخور متبقية/);
  assert.match(digSite, /class="ck-rockslide"/);
  assert.match(digSite, /rockslide\.dataset\.cleared = MineWorld\.canAdvance\(mineWorld\)/);
  assert.match(styles, /\.ck-rockslide\{/);
  assert.match(styles, /@media\(max-width:520px\).*ck-expedition-route/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\).*ck-mobile-rig-bit/);
  // لا نُثبّت رقم نسخة الكاش (?v=) هنا: كل رفع لرقم النسخة كان يُسقط هذا الاختبار بلا أي عطل حقيقي.
  // المطلوب أن الوسم موجود في الصفحة، وأن الترتيب صحيح (المخزن المحلي قبل DigSite).
  for (const asset of ['clicker\\.css', 'mine-world\\.js', 'mine-route-store\\.js', 'dig-site\\.js']) {
    assert.match(page, new RegExp(`["']\\/${asset}\\?v=\\d+["']`), `${asset} must be loaded with a cache-busting version`);
  }
  const order = ['<script src="/mine-route-store.js', '<script src="/dig-site.js'].map((tag) => page.indexOf(tag));
  assert.ok(order.every((i) => i >= 0), 'both scripts must be present in the page');
  assert.ok(order[0] < order[1], 'the local route store loads before DigSite');
});
