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

test('expanded mining shell is wired, responsive and focusable', () => {
  assert.match(html, /href="\/mine-expedition\.css\?v=1"/);
  assert.match(html, /src="\/mine-expedition\.js\?v=1"/);
  assert.match(html, /id="i-fullscreen"/);
  assert.equal(html.includes('\\n  <link'), false, 'no literal newline text can leak into the head');
  assert.match(css, /body\.ck-cave\s*\{[^}]*max-width:\s*none/s);
  assert.match(css, /\.ck-fullscreen-toggle/);
  assert.match(css, /body\.ck-mining-focus/);
  assert.match(css, /\.ck-expedition-rail/);
  assert.match(css, /\.ck-goal\.is-done/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /@media\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*560px\)/);
  assert.match(css, /@media\s*\(min-width:\s*760px\)/);
  assert.match(css, /data-conveyor="on"\]\s*\.ck-ore-cart/);
  assert.match(css, /data-drill="off"\]\s*\.ck-drill-cart/);
  assert.match(css, /data-secret-open="true"\]\s*\.ck-treasure-vault/);
});

test('expedition layer grants no economy or server rewards from the client', () => {
  assert.doesNotMatch(script, /\/api\//);
  assert.doesNotMatch(script, /fetch\(/);
  assert.doesNotMatch(script, /gold\s*\+=|ores\[[^\]]+\]\s*\+=/);
  assert.match(script, /لا تمنح ولا تخصم ذهباً/);
});
