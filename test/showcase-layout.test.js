'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/game-showcase.css'), 'utf8');

test('the redesigned lobby keeps the mine picker and workshop entry reachable', () => {
  assert.match(html, /id="mine-select"/);
  assert.match(html, /id="open-workshop-overlay"/);
  assert.match(html, /game-showcase\.css\?v=\d+/);
  assert.match(css, /#platform-scene\.scene-lobby \.overlay-row \{[\s\S]*?display: grid !important;/);
  assert.doesNotMatch(css, /#platform-scene\.scene-lobby \.overlay-row,\s*#platform-scene\.scene-lobby \.overlay-mission \{\s*display: none !important;/);
  assert.match(css, /@media \(max-width: 600px\) \{[\s\S]*?#platform-scene\.scene-lobby \.overlay-row \{[\s\S]*?display: flex !important;/);
});

test('a restored paused run hides the goal chooser so it cannot intercept Resume', () => {
  assert.match(css, /#platform-scene\.scene-lobby \.mine-overlay:has\(#platform-resume:not\(\[hidden\]\)\) #platform-goals \{\s*display: none !important;\s*\}/);
});

test('live mobile header compacts title, economy and actions into the phone viewport', () => {
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?body #platform-scene\.scene-live \.mine-topbar \{[\s\S]*?padding: 4px 6px !important;/);
  assert.match(css, /body #platform-scene\.scene-live \.mine-heading-actions button \{[\s\S]*?padding: 4px 6px !important;/);
  assert.match(css, /body #platform-scene\.scene-live \.mine-gold::after,[\s\S]*?display: none !important;/);
});
