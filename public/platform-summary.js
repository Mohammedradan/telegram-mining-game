'use strict';

/* Small DOM/presentation helpers for the platform run summary. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.PlatformSummary = { create: factory };
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPlatformSummary({ document, ores = {} } = {}) {
  function oreLineOf(items) {
    return Object.entries(items || {}).filter(([, amount]) => amount > 0)
      .map(([id, amount]) => `${ores[id]?.name || id} ${amount}`).join('، ') || 'لا خامات';
  }

  function row(label, value) {
    if (!document || typeof document.createElement !== 'function') {
      throw new TypeError('Platform summary requires a document implementation');
    }
    const element = document.createElement('div');
    element.className = 'run-row';
    const caption = document.createElement('span');
    caption.textContent = label;
    const result = document.createElement('b');
    result.textContent = value;
    element.appendChild(caption);
    element.appendChild(result);
    return element;
  }

  return Object.freeze({ oreLineOf, row });
});
