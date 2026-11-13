'use strict';
/* Arena horizontal touch stick: pointer state and visual feedback only. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.PlatformStick = { create: factory };
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPlatformStick({ rules, element, knob } = {}) {
  let direction = 0, pointer = null, originX = 0;
  function reset() {
    direction = 0; pointer = null;
    if (element) { element.dataset.active = 'false'; element.dataset.dir = 'none'; }
    if (knob && knob.style) knob.style.transform = '';
  }
  function move(clientX) {
    if (pointer === null) return 0;
    const dx = clientX - originX;
    direction = rules && rules.stickDir ? rules.stickDir(dx) : 0;
    const span = rules && rules.PAD && rules.PAD.knobMax || 26;
    if (knob && knob.style) {
      const offset = Math.max(-1, Math.min(1, dx / 60)) * span;
      knob.style.transform = `translate(calc(-50% + ${offset}px), -50%)`;
    }
    if (element) element.dataset.dir = direction > 0 ? 'right' : direction < 0 ? 'left' : 'none';
    return direction;
  }
  function begin(pointerId, clientX) {
    pointer = pointerId; originX = clientX;
    if (element) element.dataset.active = 'true';
    return move(clientX);
  }
  return Object.freeze({ begin, move, matches: pointerId => pointerId === pointer, reset, inspect: () => ({ dir: direction, pointer }) });
});
