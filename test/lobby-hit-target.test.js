'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('informational lobby cards do not intercept the resume and start controls', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'game-showcase.css'), 'utf8');
  assert.match(
    css,
    /#platform-scene\.scene-lobby \.lobby-compass-card,\s*#platform-scene\.scene-lobby \.lobby-side-card \{\s*pointer-events: none !important;\s*\}/,
    'decorative information cards must allow taps to reach the actual lobby controls',
  );
});
