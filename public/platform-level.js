/* Level 1: Lantern Hollow. Original geometry, no downloaded assets. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformLevel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return Object.freeze({
    width: 2680, height: 360, exit: { x: 2540, y: 222, w: 70, h: 78 },
    platforms: [
      { x: 0, y: 300, w: 720, h: 80 }, { x: 810, y: 300, w: 720, h: 80 },
      { x: 1640, y: 300, w: 1040, h: 80 },
      { x: 260, y: 230, w: 115, h: 20 }, { x: 560, y: 222, w: 105, h: 20 },
      { x: 900, y: 228, w: 100, h: 20 }, { x: 1320, y: 224, w: 112, h: 20 },
      { x: 1780, y: 230, w: 110, h: 20 }, { x: 2180, y: 230, w: 135, h: 20 },
    ],
    rocks: [{ x: 440, y: 252, w: 46, h: 48 }, { x: 1040, y: 252, w: 46, h: 48 }, { x: 1940, y: 252, w: 46, h: 48 }],
    gems: [{ x: 196, y: 276 }, { x: 309, y: 207 }, { x: 603, y: 199 }, { x: 860, y: 276 }, { x: 948, y: 205 }, { x: 1370, y: 201 }, { x: 1730, y: 276 }, { x: 1828, y: 207 }, { x: 2240, y: 207 }, { x: 2450, y: 276 }],
    enemies: [{ kind: 'crab', x: 2420, y: 268, w: 36, h: 32, hp: 3, range: 100, windup: 48, strike: 12, recovery: 72 }, { kind: 'boss', x: 2220, y: 184, w: 56, h: 46, hp: 6, range: 110, windup: 60, strike: 18, recovery: 100 }],
    hazards: [{ x: 1190, y: 265, w: 42, h: 35, period: 180, active: 84 }, { x: 2080, y: 279, w: 48, h: 21, period: 1, active: 1 }],
  });
 });
