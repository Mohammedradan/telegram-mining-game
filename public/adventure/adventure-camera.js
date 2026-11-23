/* Two-axis follow camera for the mining world.
 *
 * Presentation only: it reads the player's world position and produces a viewport
 * origin. It never writes to the simulation, so replays stay identical no matter
 * what a device's aspect ratio is.
 *
 * Guarantees (covered by test/adventure-camera.test.js):
 *  - clamps to the map bounds on both axes, and never shows outside the map;
 *  - centres on the player with a small dead zone so walking does not jitter;
 *  - smooths with a frame-rate independent exponential, so 60/120/30 fps agree
 *    on the same settled position;
 *  - when the map is smaller than the viewport on an axis it centres instead of
 *    producing negative or overflowing coordinates;
 *  - a single large teleport (lift, respawn) snaps when the gap exceeds `snapAt`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdventureCamera = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    follow: 6.5,        // 1/s: higher = snappier
    deadzoneX: 46,      // world px of horizontal slack around the focal point
    deadzoneY: 64,
    snapAt: 520,        // a bigger jump than this is a teleport, not a walk
    lookAhead: 0.22,    // lead the camera in the facing direction (fraction of viewport)
  });

  const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** Where the camera *wants* to be, given a viewport and the map bounds. */
  function targetFor(view, options = {}) {
    const cfg = { ...DEFAULTS, ...options };
    const worldW = Math.max(1, num(view.worldW, 1));
    const worldH = Math.max(1, num(view.worldH, 1));
    const viewW = Math.max(1, num(view.viewW, 1));
    const viewH = Math.max(1, num(view.viewH, 1));
    const focusX = num(view.x) + num(view.w, 0) / 2 + num(view.facing, 1) * viewW * cfg.lookAhead;
    const focusY = num(view.y) + num(view.h, 0) / 2;

    const freeX = Math.max(0, worldW - viewW);
    const freeY = Math.max(0, worldH - viewH);
    // Centre the world on an axis that is smaller than the viewport.
    const centredX = -Math.max(0, (viewW - worldW) / 2);
    const centredY = -Math.max(0, (viewH - worldH) / 2);

    return {
      x: freeX <= 0 ? centredX : clamp(focusX - viewW / 2, 0, freeX),
      y: freeY <= 0 ? centredY : clamp(focusY - viewH / 2, 0, freeY),
    };
  }

  function create(options = {}) {
    const cfg = { ...DEFAULTS, ...options };
    let x = 0;
    let y = 0;
    let ready = false;

    /** Snap immediately — used on spawn, respawn and scene entry. */
    function jumpTo(view, overrides = {}) {
      const target = targetFor(view, { ...cfg, ...overrides });
      x = target.x;
      y = target.y;
      ready = true;
      return { x, y };
    }

    /** Advance one frame. `dt` is seconds; the result is frame-rate independent. */
    function update(view, dt, overrides = {}) {
      const target = targetFor(view, { ...cfg, ...overrides });
      const step = clamp(num(dt, 0), 0, 0.25);
      if (!ready) return jumpTo(view, overrides);
      if (Math.hypot(target.x - x, target.y - y) > cfg.snapAt) return jumpTo(view, overrides);
      // Exponential smoothing: same distance travelled for a given elapsed time.
      const k = 1 - Math.exp(-cfg.follow * step);
      x += (target.x - x) * k;
      y += (target.y - y) * k;
      return { x, y };
    }

    /** Apply the dead zone: keeps the player inside a box, not pinned to the centre. */
    function withDeadzone(view, overrides = {}) {
      const c = { ...cfg, ...overrides };
      const viewW = Math.max(1, num(view.viewW, 1));
      const worldW = Math.max(1, num(view.worldW, 1));
      const freeX = Math.max(0, worldW - viewW);
      const pcx = num(view.x) + num(view.w, 0) / 2;
      const screen = pcx - x;
      let nextX = x;
      if (freeX > 0) {
        if (screen < viewW / 2 - c.deadzoneX) nextX = pcx - (viewW / 2 - c.deadzoneX);
        else if (screen > viewW / 2 + c.deadzoneX) nextX = pcx - (viewW / 2 + c.deadzoneX);
        nextX = clamp(nextX, 0, freeX);
      }
      return { x: nextX, y };
    }

    return {
      update,
      jumpTo,
      withDeadzone,
      get position() { return { x, y }; },
      get ready() { return ready; },
      reset() { ready = false; x = 0; y = 0; },
    };
  }

  /** World rect → screen rect (sub-pixel, no DOM). */
  function toScreen(box, camera) {
    return {
      x: num(box.x) - camera.x,
      y: num(box.y) - camera.y,
      w: num(box.w),
      h: num(box.h),
    };
  }

  /** Visible world box, used to cull drawing work on small screens. */
  function viewportBox(camera, viewW, viewH) {
    return { x: num(camera.x), y: num(camera.y), w: num(viewW), h: num(viewH) };
  }

  const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  return Object.freeze({ DEFAULTS, create, targetFor, toScreen, viewportBox, intersects });
});
