'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createSummary = require('../public/platform-summary');

function fakeDocument() {
  return {
    createElement(tag) {
      return { tagName: tag, children: [], appendChild(child) { this.children.push(child); } };
    },
  };
}

test('summary formats only positive ore quantities and uses configured names', () => {
  const summary = createSummary({ document: fakeDocument(), ores: { iron: { name: 'حديد' } } });
  assert.equal(summary.oreLineOf({ iron: 3, coal: 0, crystal: 2 }), 'حديد 3، crystal 2');
  assert.equal(summary.oreLineOf({ iron: 0 }), 'لا خامات');
});

test('summary row builds safe text nodes without interpolating HTML', () => {
  const summary = createSummary({ document: fakeDocument() });
  const row = summary.row('<img src=x>', '5 < 7');
  assert.equal(row.className, 'run-row');
  assert.deepEqual(row.children.map(child => child.tagName), ['span', 'b']);
  assert.equal(row.children[0].textContent, '<img src=x>');
  assert.equal(row.children[1].textContent, '5 < 7');
});
