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

test('the lobby goals container does not block controls outside its goal buttons', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'game-showcase.css'), 'utf8');
  assert.match(
    css,
    /#platform-scene\.scene-lobby #platform-goals \{\s*pointer-events: none !important;\s*\}/,
    'the goals panel must not intercept clicks in its empty area',
  );
  assert.match(
    css,
    /#platform-scene\.scene-lobby #platform-goals \.goal-option \{\s*pointer-events: auto !important;\s*\}/,
    'the actual goal choices must remain clickable',
  );
});
