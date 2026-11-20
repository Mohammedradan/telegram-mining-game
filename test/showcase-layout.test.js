'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/game-showcase.css'), 'utf8');
const liveCss = fs.readFileSync(path.join(root, 'public/game-showcase-live.css'), 'utf8');

test('the redesigned lobby keeps the mine picker and workshop entry reachable', () => {
  assert.match(html, /id="mine-select"/);
  assert.match(html, /id="open-workshop-overlay"/);
  assert.match(html, /game-showcase\.css\?v=\d+/, 'the showcase stylesheet uses an explicit cache-busting version');
  assert.match(css, /#platform-scene\.scene-lobby \.overlay-row \{[\s\S]*?display: grid !important;/);
  assert.doesNotMatch(css, /#platform-scene\.scene-lobby \.overlay-row,\s*#platform-scene\.scene-lobby \.overlay-mission \{\s*display: none !important;/);
  assert.match(css, /@media \(max-width: 600px\) \{[\s\S]*?#platform-scene\.scene-lobby \.overlay-row \{[\s\S]*?display: flex !important;/);
});

test('a restored paused run keeps goal options clickable without letting the empty panel intercept Resume', () => {
  assert.match(css, /#platform-scene #platform-goals \{\s*pointer-events: none !important;\s*\}/);
  assert.match(css, /#platform-scene #platform-goals \.goal-option \{\s*pointer-events: auto !important;\s*\}/);
});

test('live mobile header keeps utility controls inside the phone viewport', () => {
  assert.match(liveCss, /@media \(max-width: 600px\)[\s\S]*?body #platform-scene\.scene-live \.mine-topbar \{[\s\S]*?height: 44px !important;[\s\S]*?padding: 3px 6px !important;/);
  assert.match(liveCss, /body #platform-scene\.scene-live \.mine-heading-actions button \{[\s\S]*?width: 36px !important;[\s\S]*?height: 36px !important;[\s\S]*?padding: 4px !important;/);
  assert.match(liveCss, /body #platform-scene\.scene-live \.mine-title,\s*body #platform-scene\.scene-live \.mine-economy \{ display: none !important; \}/);
  assert.match(liveCss, /#platform-scene\.scene-live \.adv-topbar-brand \{\s*display: none !important;\s*pointer-events: none !important;/);
});
