/* Stone Mine world geometry, authored as data.
 *
 * Coordinates are WORLD PIXELS with y growing downward; the origin is the top-left
 * of the mine, not of the screen. Nothing here depends on a viewport: the renderer
 * and the camera both read this object and know nothing about CSS.
 *
 * Layout follows the approved reference: a horizontal gallery with a lower service
 * deck (machinery and conveyor), an upper timber walkway reached by ladders, a
 * passenger lift joining all three levels, a vault that opens on a mission gate,
 * and one optional discovery chamber behind a cracked wall.
 *
 * This module is pure data + pure queries. It never mutates its own definition and
 * never touches the economy: the server owns every resource value.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StoneMineMap = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const WIDTH = 3400;
  const HEIGHT = 1180;
  const SURFACE = 340;   // gallery floor: feet stand here
  const SERVICE = 640;   // lower deck floor: machinery and conveyor
  const VAULT = 940;     // deepest floor: the sealed vault

  // Solid collision boxes. "floor" boxes are full solids; "ledge" boxes are one-way
  // (land on top, jump through from below); "shaft" boxes are drawing markers only.
  //
  // Geometry note (a real bug was fixed here): both shafts used to carry a solid box from
  // y=200 down to the deck, nominally a "header". Because the box was flush with the floor
  // it behaved as a wall across the whole shaft: the lift could not be boarded and the east
  // gallery was sealed. Shafts are now open air. Vertical travel is the lift plus five
  // ladders, and the one true hole — the service-deck gap at 2530..2590 — is a real fall
  // to the vault, not a decoration.
  const PLATFORMS = [
    // ---- gallery (surface): ONE continuous deck, end to end ----
    // (Splitting the deck into boxes around the lift dock left 8px seams where a walker
    // had no support; the dock is handled by levelOf() instead, see below.)
    { x: 0, y: SURFACE, w: WIDTH, h: 90, kind: 'floor' },
    // East end wall: starts above standing height so it can never be used as a step.
    { x: 3320, y: 180, w: 80, h: 120, kind: 'wall' },
    { x: 3320, y: 300, w: 80, h: 40, kind: 'wall' },

    // ---- shafts: drawing markers only, never solids ----
    // Both shafts used to carry a solid "header" box flush with the floor. Because it sat
    // at floor level it behaved as a wall straight across the shaft: the lift could not be
    // boarded and the east gallery was sealed off. A shaft is open air.
    { x: 1240, y: 200, w: 130, h: 140, kind: 'lift-shaft' },
    { x: 2530, y: 200, w: 60, h: 140, kind: 'drop-shaft' },

    // ---- gallery ledges (optional exploration) ----
    { x: 300, y: 250, w: 150, h: 18, kind: 'ledge' },
    { x: 620, y: 232, w: 120, h: 18, kind: 'ledge' },
    { x: 1620, y: 246, w: 150, h: 18, kind: 'ledge' },
    { x: 2020, y: 232, w: 140, h: 18, kind: 'ledge' },
    { x: 2410, y: 244, w: 120, h: 18, kind: 'ledge' },
    { x: 2860, y: 236, w: 150, h: 18, kind: 'ledge' },

    // ---- upper timber walkway: reached only by ladders ----
    { x: 180, y: 150, w: 700, h: 16, kind: 'ledge', route: 'upper' },
    { x: 1500, y: 150, w: 560, h: 16, kind: 'ledge', route: 'upper' },
    { x: 2760, y: 150, w: 420, h: 16, kind: 'ledge', route: 'upper' },

    // ---- lower service deck: the 60px gap at 2530 is a real hole down to the vault ----
    { x: 0, y: SERVICE, w: 2530, h: 90, kind: 'floor' },
    { x: 2590, y: SERVICE, w: 810, h: 90, kind: 'floor' },

    // ---- vault level ----
    { x: 0, y: VAULT, w: WIDTH, h: 120, kind: 'floor' },
  ];

  // The lift column occupies x 1240..1370 on every level. Its stops are the three
  // floors; the cabin floor is a platform while docked (the lift rules own that).
  const LIFT = {
    id: 'lift-main',
    x: 1240,
    w: 130,
    h: 18,
    speed: 118,
    stops: [SURFACE, SERVICE, VAULT],
    start: SURFACE,
  };

  // Ladder rails. x is the rail's left edge; the shared motion kernel aligns the
  // player's centre to rail.x + 14, and the climb ends at `y` (the ledge top).
  const LADDERS = [
    { id: 'ladder-gallery-w', x: 470, y: 150, bottom: SURFACE },
    { id: 'ladder-gallery-e', x: 1720, y: 150, bottom: SURFACE },
    { id: 'ladder-vault-w', x: 240, y: SERVICE, bottom: VAULT },
    { id: 'ladder-vault-e', x: 2400, y: SERVICE, bottom: VAULT },
    { id: 'ladder-surface-e', x: 2990, y: 150, bottom: SURFACE },
  ];

  const ROOMS = [
    { id: 'entry', name: 'مدخل المنجم', x: 0, y: 0, w: 1240, h: HEIGHT },
    { id: 'gallery', name: 'معرض التعدين', x: 1370, y: 0, w: 960, h: HEIGHT },
    { id: 'east', name: 'الممر الشرقي', x: 2590, y: 0, w: 810, h: HEIGHT },
    { id: 'workshop', name: 'سطح الآلات', x: 0, y: 340, w: 2530, h: 600 },
    { id: 'vault', name: 'القبو المسدود', x: 0, y: 940, w: WIDTH, h: 240 },
    { id: 'cache', name: 'المخبأ الجانبي', x: 3080, y: 236, w: 240, h: 104 },
  ];

  // Ore veins: fixed identities, world positions and server-side amounts.
  // `amount` is the *server ceiling* for a full vein; the client never sends it.
  // `y` is the vein's base (it sits on the floor at that height).
  const DEPOSITS = [
    // A worker-only shelf: low grade, large reserve, no reward ceiling to farm because it
    // feeds the machines rather than the player's bag.
    { id: 'shelf-crew-1', ore: 'copper', x: 2130, y: SURFACE, hardness: 2, amount: 60, tool: 'pickaxe', route: 'gallery', crewOnly: true },
    { id: 'vein-copper-1', ore: 'copper', x: 900,  y: SURFACE, hardness: 3, amount: 12, tool: 'pickaxe', route: 'gallery' },
    { id: 'vein-copper-2', ore: 'copper', x: 1560, y: SURFACE, hardness: 3, amount: 14, tool: 'pickaxe', route: 'gallery' },
    { id: 'vein-iron-1',   ore: 'iron',   x: 2260, y: SURFACE, hardness: 5, amount: 10, tool: 'pickaxe', route: 'gallery' },
    { id: 'vein-iron-2',   ore: 'iron',   x: 1120, y: SERVICE, hardness: 5, amount: 12, tool: 'pickaxe', route: 'service' },
    { id: 'vein-gold-1',   ore: 'gold',   x: 3100, y: SURFACE, hardness: 7, amount: 8,  tool: 'drill',   route: 'east',  requires: 'gate-east' },
    { id: 'vein-crystal-1',ore: 'crystal',x: 1860, y: SERVICE, hardness: 8, amount: 6,  tool: 'drill',   route: 'service', requires: 'gate-deep' },
  ];

  // Machines on the service deck: the approved production chain
  // deposit -> drill -> conveyor -> cart -> warehouse.
  const MACHINES = [
    { id: 'drill-1', kind: 'drill', x: 1180, y: SERVICE, w: 96, h: 84, energy: 4, rateTicks: 240, buffer: 6 },
    { id: 'conveyor-1', kind: 'conveyor', x: 1290, y: SERVICE - 34, w: 620, h: 34, energy: 1, rateTicks: 60, capacity: 8 },
    { id: 'cart-1', kind: 'cart', x: 1930, y: SERVICE - 46, w: 88, h: 46, capacity: 8 },
    { id: 'warehouse-1', kind: 'warehouse', x: 2180, y: SERVICE, w: 150, h: 110, capacity: 240 },
  ];

  // Where a worker can stand and what they may be sent to do.
  const CREW_SITES = [
    // The crew works the low-grade shelf on the solid east block, not the player's main
    // gallery veins: a dispatched worker must never consume the vein the player is mining.
    { id: 'site-mine-a', x: 2130, y: SURFACE, task: 'mine', deposit: 'shelf-crew-1', label: 'رفّ الخام الشرقي' },
    { id: 'site-haul-a', x: 1880, y: SERVICE, task: 'haul', deposit: 'vein-iron-2', label: 'نقل الخام إلى العربة' },
    { id: 'site-operator', x: 1226, y: SERVICE, task: 'operate', machine: 'drill-1', label: 'تشغيل الحفارة' },
  ];

  // Sealed passages: world objects that block movement until the gate opens.
  const GATES = [
    { id: 'gate-east', name: 'بوابة الممر الشرقي', x: 3300, y: 180, w: 24, h: 160, requires: { objective: 'mine-copper' } },
    { id: 'gate-deep', name: 'بوابة القبو', x: 2460, y: SERVICE - 300, w: 24, h: 300, requires: { objective: 'deliver-ore' } },
  ];

  const CHECKPOINTS = [{ id: 'entry', name: 'نقطة البداية', x: 120, y: SURFACE, room: 'entry' }];

  const INTERACTABLES = [
    { id: 'lift-call', kind: 'lift', x: LIFT.x + LIFT.w / 2, y: SURFACE, label: 'نداء المصعد' },
    { id: 'warehouse-panel', kind: 'warehouse', x: 2255, y: SERVICE, label: 'لوحة المخزن' },
    { id: 'drill-panel', kind: 'machine', x: 1228, y: SERVICE, label: 'لوحة الحفارة' },
  ];

  // Optional discovery: found by walking up to it and pressing interact. It grants
  // no resources; it records a discovery flag the server persists.
  const SECRETS = [
    { id: 'cache-side', name: 'المخبأ الجانبي', x: 3170, y: 236, label: 'شقّ في الجدار الشرقي', radius: 90 },
  ];

  const MISSION = {
    id: 'stone-1',
    title: 'أول حمولة',
    steps: [
      { id: 'mine', label: 'استخرج 6 نحاس من العروق', counter: 'copper', target: 6 },
      { id: 'assign', label: 'كلّف عاملًا بمهمة في المنجم', counter: 'assigned', target: 1 },
      { id: 'machine', label: 'شغّل الحفارة والسير الناقل', counter: 'machinesOn', target: 2 },
      { id: 'deliver', label: 'سلّم 8 خامات إلى المخزن', counter: 'delivered', target: 8 },
    ],
  };

  const SPAWN = { x: CHECKPOINTS[0].x, y: SURFACE };

  const all = (list, id) => list.find((item) => item.id === id) || null;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** Solid boxes that block walking, plus one-way ledges the mover lands on. */
  // Veins are *targets*, not walls. An earlier version registered every un-mined vein as a
  // 36x40 solid, which let a single vein seal a gallery: the miner could not walk past the
  // rock they were about to mine. Mining reach is checked by `depositInReach`, so the vein
  // does not need to be a collision body at all.
  function collisionFor(map, openGates) {
    const open = new Set(openGates || []);
    // `kind` is carried through on purpose: the tests and the renderer both need to tell
    // a wall from a floor, and the shared motion kernel ignores unknown fields.
    // 'shaft' is a visual marker (open air with a lit rim), never a solid.
    // `route` is carried through on floors as well: the shared motion kernel treats
    // `route:'upper'` geometry as the persistent-support band, and the surface floor must
    // not be one — otherwise a miner standing on a crossing ledge is pinned there forever.
    const solids = PLATFORMS.filter((box) => box.kind === 'floor' || box.kind === 'pit' || box.kind === 'wall')
      .map(({ x, y, w, h, kind, route }) => ({ x, y, w, h, kind, ...(route ? { route } : {}) }));
    const ledges = PLATFORMS.filter((box) => box.kind === 'ledge')
      .map(({ x, y, w, h, route }) => ({ x, y, w, h, ...(route ? { route } : {}) }));
    for (const gate of GATES) {
      if (!open.has(gate.id)) solids.push({ x: gate.x, y: gate.y, w: gate.w, h: gate.h, gate: gate.id });
    }
    return { solids, ledges };
  }

  /** The level object the shared motion kernel expects (platforms + ladders + bounds). */
  function levelFor(map, openGates) {
    const { solids, ledges } = collisionFor(map, openGates);
    return {
      id: 'stone-mine',
      width: WIDTH,
      height: HEIGHT,
      walkableRoutes: true,
      platforms: solids.concat(ledges),
      ladders: LADDERS.map(({ x, y, bottom }) => ({ x, y, bottom })),
    };
  }

  /** Nearest deposit the player may mine from where they stand, or null. */
  function depositInReach(map, player, reach = 46) {
    let best = null;
    for (const vein of DEPOSITS) {
      const cx = player.x + player.w / 2;
      const feet = player.y + player.h;
      const dx = Math.abs(cx - vein.x);
      const dy = Math.abs(feet - vein.y);
      const distance = Math.hypot(dx, dy);
      if (distance <= reach && (!best || distance < best.distance)) best = { vein, distance };
    }
    return best ? best.vein : null;
  }

  /** Nearest interactable (machine panel, lift call, warehouse) within reach. */
  function interactableInReach(map, player, reach = 64) {
    const cx = player.x + player.w / 2;
    const feet = player.y + player.h;
    let best = null;
    for (const item of INTERACTABLES) {
      const distance = Math.hypot(cx - item.x, feet - item.y);
      if (distance <= reach && (!best || distance < best.distance)) best = { ...item, distance };
    }
    return best;
  }

  function secretInReach(map, player, found = []) {
    const cx = player.x + player.w / 2;
    const feet = player.y + player.h;
    for (const secret of SECRETS) {
      if (found.includes(secret.id)) continue;
      if (Math.hypot(cx - secret.x, feet - secret.y) <= secret.radius) return secret;
    }
    return null;
  }

  function roomAt(map, x, y) {
    return ROOMS.find((room) => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h) || ROOMS[0];
  }

  function gateById(map, id) { return all(GATES, id); }
  function depositById(map, id) { return all(DEPOSITS, id); }
  function machineById(map, id) { return all(MACHINES, id); }
  function siteById(map, id) { return all(CREW_SITES, id); }

  const deepFreeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const inner of Object.values(value)) deepFreeze(inner);
    }
    return value;
  };

  const MAP = deepFreeze({
    id: 'stone-mine',
    version: VERSION,
    name: 'المنجم الحجري',
    subtitle: 'الطبقة الأولى',
    width: WIDTH,
    height: HEIGHT,
    levels: Object.freeze({ surface: SURFACE, service: SERVICE, vault: VAULT }),
    spawn: Object.freeze(SPAWN),
    platforms: Object.freeze(PLATFORMS.map(Object.freeze)),
    ladders: Object.freeze(LADDERS.map(Object.freeze)),
    lift: Object.freeze(LIFT),
    rooms: Object.freeze(ROOMS.map(Object.freeze)),
    deposits: Object.freeze(DEPOSITS.map(Object.freeze)),
    machines: Object.freeze(MACHINES.map(Object.freeze)),
    crewSites: Object.freeze(CREW_SITES.map(Object.freeze)),
    gates: Object.freeze(GATES.map(Object.freeze)),
    checkpoints: Object.freeze(CHECKPOINTS.map(Object.freeze)),
    interactables: Object.freeze(INTERACTABLES.map(Object.freeze)),
    secrets: Object.freeze(SECRETS.map(Object.freeze)),
    mission: Object.freeze(MISSION),
  });

  return Object.freeze({
    VERSION, WIDTH, HEIGHT, SURFACE, SERVICE, VAULT,
    MAP, collisionFor, levelFor, depositInReach, interactableInReach, secretInReach,
    roomAt, gateById, depositById, machineById, siteById, clamp,
  });
});
