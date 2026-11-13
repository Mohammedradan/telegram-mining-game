'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createStick = require('../public/platform-stick');
function fixture() {
  const element = { dataset: {} }, knob = { style: { transform: '' } };
  const rules = { PAD: { knobMax: 30 }, stickDir: dx => dx > 12 ? 1 : dx < -12 ? -1 : 0 };
  return { stick: createStick({ rules, element, knob }), element, knob };
}
test('arena stick tracks a pointer and maps movement through shared rules', () => {
  const { stick, element, knob } = fixture();
  stick.begin(7, 100);
  assert.equal(stick.matches(7), true);
  assert.equal(stick.matches(8), false);
  assert.equal(stick.move(125), 1);
  assert.equal(element.dataset.dir, 'right');
  assert.match(knob.style.transform, /12\.5px/);
  assert.deepEqual(stick.inspect(), { dir: 1, pointer: 7 });
});
test('arena stick reset clears pointer, direction and visual state', () => {
  const { stick, element, knob } = fixture();
  stick.begin(4, 50); stick.move(20); stick.reset();
  assert.deepEqual(stick.inspect(), { dir: 0, pointer: null });
  assert.equal(element.dataset.active, 'false');
  assert.equal(element.dataset.dir, 'none');
  assert.equal(knob.style.transform, '');
  assert.equal(stick.matches(4), false);
});
