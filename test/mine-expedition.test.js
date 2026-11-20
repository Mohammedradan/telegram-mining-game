'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Expedition = require('../public/mine-expedition');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/mine-expedition.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public/mine-expedition.js'), 'utf8');

const snapshot = (over = {}) => ({
  size: { W: 320, H: 640 },
  miner: { x: 0.5, y: 0.7 },
  mine: {
    index: 0,
    unlocked: 0,
    breaks: 0,
    floor: 'lower',
    transitions: 0,
    definition: { id: 'stone', name: 'المنجم الحجري', depth: '120 م', ore: 'نحاس وحديد' },
  },
  machinery: { drill: false, conveyor: false, worker: false },
  ...over,
});

test('discovery saves are normalized, deduped and tied to known caches', () => {
  const dirty = {
    'Stone!!': ['toolkit', 'toolkit', 'not-a-cache'],
    lava: ['secret', ' secret ', 'missing'],
    broken: 'toolkit',
  };
  const clean = Expedition.normalizeDiscoveries(dirty);
  assert.deepEqual(clean, { stone: ['toolkit'], lava: ['secret'] });
  const once = Expedition.markDiscovery(clean, 'stone', 'secret');
  assert.deepEqual(Expedition.normalizeDiscoveries(once), { stone: ['toolkit', 'secret'], lava: ['secret'] });
  assert.equal(Expedition.discoveryCount(clean, 'stone'), 1);
});

test('objectives describe real progress from DigSite state and saved discoveries', () => {
  const start = Expedition.objectiveSnapshot(snapshot(), {});
  assert.deepEqual(start.map((item) => item.id), ['rocks', 'upper', 'machinery', 'caches', 'next']);
  assert.deepEqual(start.map((item) => item.done), [false, false, false, false, false]);
  assert.equal(start.find((item) => item.id === 'machinery').current, 0);

  const powered = snapshot({
    mine: { index: 1, unlocked: 1, breaks: 3, floor: 'upper', transitions: 1, definition: { id: 'iron' } },
    machinery: { drill: true, conveyor: true, worker: true },
    miner: { x: 0.89, y: 0.63 },
  });
  const discoveries = { iron: ['toolkit', 'secret'] };
  const done = Expedition.objectiveSnapshot(powered, discoveries);
  assert.ok(done.every((item) => item.done), JSON.stringify(done));
  assert.equal(done.find((item) => item.id === 'caches').detail, `2 من ${Expedition.CACHE_DEFS.length} مخابئ`);
});

test('secret cache opens only after enough mining and a server-started machinery shift', () => {
  const toolkit = Expedition.CACHE_DEFS.find((cache) => cache.id === 'toolkit');
  const secret = Expedition.CACHE_DEFS.find((cache) => cache.id === 'secret');
  const beforeBreaks = snapshot();
  assert.equal(Expedition.cacheState(toolkit, beforeBreaks, {}), 'locked');

  const nearToolkit = snapshot({ mine: { ...snapshot().mine, breaks: 1 }, miner: { x: toolkit.x, y: toolkit.y } });
  assert.equal(Expedition.cacheState(toolkit, nearToolkit, {}), 'ready');

  const secretNeedsPower = snapshot({ mine: { ...snapshot().mine, breaks: 2 }, miner: { x: secret.x, y: secret.y }, machinery: { drill: true, conveyor: true, worker: false } });
  assert.equal(Expedition.cacheState(secret, secretNeedsPower, {}), 'needs-power');

  const secretPowered = snapshot({ mine: { ...snapshot().mine, breaks: 2 }, miner: { x: secret.x, y: secret.y }, machinery: { drill: true, conveyor: true, worker: true } });
  assert.equal(Expedition.cacheState(secret, secretPowered, {}), 'ready');
  assert.equal(Expedition.cacheState(secret, secretPowered, { stone: ['secret'] }), 'found');
});

test('each cave places caches in distinct reachable locations and checks the displayed position', () => {
  const toolkit = Expedition.CACHE_DEFS.find((cache) => cache.id === 'toolkit');
  const secret = Expedition.CACHE_DEFS.find((cache) => cache.id === 'secret');
  const layouts = Expedition.CACHE_POSITIONS.map((layout) => `${layout.toolkit.x},${layout.toolkit.y}:${layout.secret.x},${layout.secret.y}`);
  assert.equal(Expedition.CACHE_POSITIONS.length, Expedition.MINES.length);
  assert.equal(new Set(layouts).size, Expedition.MINES.length);
  for (const layout of Expedition.CACHE_POSITIONS) {
    for (const position of Object.values(layout)) {
      assert.ok(position.x >= 0.08 && position.x <= 0.92);
      assert.ok(position.y >= 0.34 && position.y <= 0.88);
    }
  }
  const stonePosition = Expedition.cachePosition(toolkit, 0);
  const ironPosition = Expedition.cachePosition(toolkit, 1);
  assert.notDeepEqual(stonePosition, ironPosition);
  assert.ok(stonePosition.y >= 0.56);
  assert.ok(ironPosition.y >= 0.56);

  const ironSecretPosition = Expedition.cachePosition(secret, 1);
  assert.ok(ironSecretPosition.y >= 0.34 && ironSecretPosition.y < 0.56);
  const ironMine = snapshot({
    miner: ironSecretPosition,
    mine: { ...snapshot().mine, index: 1, breaks: 2, definition: { id: 'iron' } },
    machinery: { drill: true, conveyor: true, worker: true },
  });
  assert.equal(Expedition.cacheState(secret, ironMine, {}), 'ready');
  assert.equal(Expedition.cacheNear(secret, snapshot({
    miner: Expedition.cachePosition(secret, 0),
    mine: { ...snapshot().mine, index: 1, breaks: 2, definition: { id: 'iron' } },
  })), false);
});

test('expanded mining shell is wired, responsive and focusable', () => {
  assert.match(html, /href="\/mine-expedition\.css\?v=16"/);
  assert.match(html, /src="\/mine-expedition\.js\?v=4"/);
  assert.match(html, /id="i-fullscreen"/);
  assert.equal(html.includes('\\n  <link'), false, 'no literal newline text can leak into the head');
  assert.match(css, /body\.ck-cave\s*\{[^}]*max-width:\s*none/s);
  assert.match(css, /\.ck-fullscreen-toggle/);
  assert.match(css, /body\.ck-mining-focus/);
  assert.match(css, /\.ck-expedition-rail/);
  assert.match(css, /\.ck-goal\.is-done/);
  assert.match(css, /\.ck-catwalk-upper\s*\{[^}]*left:\s*3%;[^}]*right:\s*48%;[^}]*top:\s*49%;/);
  assert.match(css, /\.ck-catwalk-lower\s*\{[^}]*left:\s*50%;[^}]*right:\s*2%;[^}]*top:\s*64%;/);
  assert.match(css, /\.ck-catwalk-lower::after\s*\{[^}]*height:\s*clamp\(70px,\s*28vh,\s*180px\)/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /body\.ck-cave \.ck-node \{ --ck-node: clamp\(44px, 8vh, 48px\) !important; \}/, 'mobile expedition medals keep at least a 44px touch target');
  assert.match(css, /@media\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*560px\)/);
  assert.match(css, /@media\s*\(min-width:\s*760px\)/);
  assert.match(css, /data-conveyor="on"\]\s*\.ck-ore-cart/);
  assert.match(css, /data-drill="off"\]\s*\.ck-drill-cart/);
  assert.match(css, /data-secret-open="true"\]\s*\.ck-treasure-vault/);
  assert.match(css, /body\.ck-cave #ck-stage \{[^}]*position: relative;[^}]*display: block;[^}]*flex: 1 1 0;/s,
    'the mining stage is a full-bleed positioning context');
  assert.match(css, /body\.ck-cave #ck-stage \.ck-area \{[^}]*position: absolute;[^}]*inset: 0;/s,
    'the cave art fills the stage without changing the scene dimensions');
  assert.match(css, /body\.ck-cave \.ck-hud \{[^}]*position: fixed;/s,
    'the balance and sound controls stay in the fixed toolbar');
  assert.match(css, /body\.ck-cave #energy-container \{[^}]*position: fixed;/s,
    'energy is a separate fixed HUD panel');
  assert.match(css, /body\.ck-cave \.bottom-nav \{[^}]*position: fixed;[^}]*top: 8px;/s,
    'navigation remains in the upper fixed toolbar');
  assert.match(css, /body\.ck-cave #ck-stage \.ck-nodes \{[^}]*position: absolute;[^}]*top: 67px;/s,
    'the medals are anchored below the toolbar rather than taking a flow row');
  const mobileField = css.slice(css.lastIndexOf('/* Restore a real portrait-phone flex field'));
  assert.match(mobileField, /@media\s*\(max-width:\s*520px\)\s*and\s*\(orientation:\s*portrait\)/);
  assert.match(mobileField, /body\.ck-cave #ck-stage \.ck-area \{[^}]*flex: 1 1 auto !important;[^}]*height: auto !important;[^}]*min-height: 220px !important;/s,
    'the mobile field regains a measurable flex height after leaving absolute positioning');
  assert.match(mobileField, /--rock-w: max\(110px, min\(36vw, 150px\)\) !important;/,
    'the mining target keeps a non-zero touch width on portrait phones');
  assert.match(mobileField, /--miner-h: max\(120px, min\(38vw, 150px\)\) !important;/,
    'the miner keeps a visible portrait-phone height');
});

test('expedition layer grants no economy or server rewards from the client', () => {
  assert.doesNotMatch(script, /\/api\//);
  assert.doesNotMatch(script, /fetch\(/);
  assert.doesNotMatch(script, /gold\s*\+=|ores\[[^\]]+\]\s*\+=/);
  assert.match(script, /لا تمنح ولا تخصم ذهباً/);
});
