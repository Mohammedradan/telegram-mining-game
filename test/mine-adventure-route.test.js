'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const digSite = fs.readFileSync(path.join(root, 'public/dig-site.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/clicker.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

test('mountain route connects all six caves and places a traveler on the live progression path', () => {
  assert.equal((digSite.match(/class="ck-route-node" data-route-index=/g) || []).length, 6);
  assert.match(digSite, /ck-route-mountain/);
  assert.match(digSite, /ck-route-road/);
  assert.match(digSite, /ck-route-traveler/);
  assert.match(digSite, /traveler\.setAttribute\('transform', `translate\(\$\{x\} 38\)`/);
  assert.match(digSite, /Math\.min\(0\.55, mineWorld\.breaks \/ 3 \* 0\.55\)/, 'mining advances the route cart, and walking to the exit finishes the trip');
  assert.match(digSite, /hazard\.dataset\.cleared = MineWorld\.canAdvance\(mineWorld\)/);
  assert.match(digSite, /تحدّي الانهيار: احفر/);
  assert.match(digSite, /امشِ يميناً نحو بوابة الكهف التالي/);
  assert.match(digSite, /اصعد بالسلم أو المصعد إلى الممر العلوي/);
  assert.match(digSite, /data-route-index/);
});

test('a cave crossing plays an accessible mountain-trip scene from the old mine to the new one', () => {
  assert.match(digSite, /class="ck-overland-transition" hidden aria-live="polite"/);
  assert.match(digSite, /function showOverlandTrip\(fromIndex, toIndex, direction\)/);
  assert.match(digSite, /scene\.dataset\.from = from\.id/);
  assert.match(digSite, /scene\.dataset\.to = to\.id/);
  assert.match(digSite, /showOverlandTrip\(originMineIndex, mineWorld \? mineWorld\.index : originMineIndex, traversal\.transition\)/);
  assert.match(styles, /\.ck-overland-transition\[hidden\]\{display:none!important\}/);
  assert.match(styles, /@keyframes ck-overland-drive/);
  assert.match(styles, /ck-overland-drive-back/);
});

test('mobile drill and assigned hauler are positioned in the playfield and follow actual miner movement', () => {
  assert.match(digSite, /class="ck-mobile-rig"/);
  assert.match(digSite, /class="ck-mobile-hauler"/);
  assert.match(digSite, /targetRigX = machinery\.drill && rock \? rock\.x : clamp\(miner\.x/);
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
  assert.match(page, /clicker\.css\?v=13/);
  assert.match(page, /dig-site\.js\?v=10/);
  assert.ok(page.indexOf('<script src="/mine-route-store.js') < page.indexOf('<script src="/dig-site.js'), 'the local route store loads before DigSite');
});
