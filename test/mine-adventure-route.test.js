'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const digSite = fs.readFileSync(path.join(root, 'public/dig-site.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/clicker.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

test('a connected overland landscape has walkable terrain, obstacles, and route progress driven by the miner', () => {
  assert.equal((digSite.match(/class="ck-route-node" data-route-index=/g) || []).length, 6);
  assert.match(digSite, /class="ck-overland-world" hidden role="region" aria-label="مسار جبلي متصل بين المناجم/);
  assert.match(digSite, /class="ck-overland-road"/);
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
  assert.match(styles, /\.ck-road-obstacle/);
});

test('mobile drill and assigned hauler are positioned in the playfield and follow actual miner movement', () => {
  assert.match(digSite, /class="ck-mobile-rig"/);
  assert.match(digSite, /class="ck-mobile-hauler"/);
  assert.match(digSite, /targetRigX = machinery\.drill && miningMode && rock \? rock\.x : clamp\(miner\.x/);
  assert.match(digSite, /targetWorkerX = machinery\.worker \? clamp\(miner\.x/);
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
  assert.match(page, /clicker\.css\?v=14/);
  assert.match(page, /mine-world\.js\?v=3/);
  assert.match(page, /mine-route-store\.js\?v=2/);
  assert.match(page, /dig-site\.js\?v=11/);
  assert.ok(page.indexOf('<script src="/mine-route-store.js') < page.indexOf('<script src="/dig-site.js'), 'the local route store loads before DigSite');
});
