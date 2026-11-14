/* Local, non-economic persistence for the cave route. This never owns a wallet, ore balance, or server entitlement. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.MineRouteStore = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const KEY = 'minequest.mine-route.v1';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const integer = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  };
  function localStorageSafe() {
    try { return root && root.localStorage ? root.localStorage : null; }
    catch (_) { return null; }
  }

  function create(storage) {
    const backing = storage || localStorageSafe();
    return Object.freeze({
      load(lastMine = 5) {
        try {
          const raw = backing && backing.getItem(KEY);
          const saved = raw ? JSON.parse(raw) : null;
          const last = clamp(integer(lastMine, 5), 0, 100);
          if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { index: 0, unlocked: 0, breaks: 0, mode: 'mine', travelDirection: 1, routeProgress: 0 };
          const index = clamp(integer(saved.index), 0, last);
          const unlocked = clamp(integer(saved.unlocked, index), index, last);
          const breaks = clamp(integer(saved.breaks), 0, 3);
          const travelDirection = Number(saved.travelDirection) === -1 ? -1 : 1;
          const canResumeTravel = saved.mode === 'overland' && (travelDirection < 0 ? index < last : index > 0);
          const routeProgress = Number(saved.routeProgress);
          return { index, unlocked, breaks, mode: canResumeTravel ? 'overland' : 'mine', travelDirection, routeProgress: canResumeTravel && Number.isFinite(routeProgress) ? clamp(routeProgress, 0, 1) : 0 };
        } catch (_) { return { index: 0, unlocked: 0, breaks: 0, mode: 'mine', travelDirection: 1, routeProgress: 0 }; }
      },
      save(progress, lastMine = 5) {
        try {
          if (!backing || typeof backing.setItem !== 'function' || !progress || typeof progress !== 'object') return false;
          const last = clamp(integer(lastMine, 5), 0, 100);
          const index = clamp(integer(progress.index), 0, last);
          const unlocked = clamp(integer(progress.unlocked, index), index, last);
          const breaks = clamp(integer(progress.breaks), 0, 3);
          const travelDirection = Number(progress.travelDirection) === -1 ? -1 : 1;
          const mode = progress.mode === 'overland' && (travelDirection < 0 ? index < last : index > 0) ? 'overland' : 'mine';
          const routeProgress = Number(progress.routeProgress);
          backing.setItem(KEY, JSON.stringify({ index, unlocked, breaks, mode, travelDirection, routeProgress: mode === 'overland' && Number.isFinite(routeProgress) ? clamp(routeProgress, 0, 1) : 0 }));
          return true;
        } catch (_) { return false; }
      },
    });
  }

  return Object.freeze({ KEY, create });
});
