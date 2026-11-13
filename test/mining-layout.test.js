'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/mining-layout.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test('mining playfield expands beyond the old narrow stage width', () => {
  assert.match(css, /#tab-mining > \.ck-stage\s*\{[^}]*max-width:\s*min\(100%,\s*760px\)/s);
  assert.match(css, /min-height:\s*clamp\(300px,\s*48dvh,\s*620px\)/);
  assert.match(html, /href="\/mining-layout\.css\?v=1"/);
});

test('mining machine controls stay compact and responsive over the expanded cave', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /@media\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*520px\)/);
});
