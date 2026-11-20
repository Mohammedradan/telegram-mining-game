/* Deterministic Stone Mine simulation. Same inputs → same output, on the browser and
 * on the server, so the server can replay what the client claims and never trust a
 * client-supplied quantity.
 *
 * Division of authority:
 *  - Movement uses the shared motion kernel (PlatformRules.motion), so gravity,
 *    collision, ladders and the passenger lift are one implementation.
 *  - This module owns deposits, the crew, the machines, cargo and the mission.
 *  - The server owns every resource value: it runs `applyCommand` itself and stores
 *    the resulting snapshot. The client only ever displays a snapshot.
 *
 * A command is { type, ...args } and is validated against the authoritative state.
 * Rejected commands are reported, never silently applied.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../platform-rules'), require('./stone-mine-map'));
  } else {
    root.StoneMineRules = factory(root.PlatformRules, root.StoneMineMap);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, MapModule) {
  'use strict';

  if (!R || !R.motion) throw new Error('StoneMineRules requires PlatformRules (motion kernel)');
  if (!MapModule) throw new Error('StoneMineRules requires StoneMineMap');

  const VERSION = 1;
  const FPS = 60;
  const DT = 1 / FPS;
  const MAX_TICKS = FPS * 60 * 45;          // one session never exceeds 45 minutes
  const MAX_COMMANDS_PER_CHECKPOINT = 400;
  const { MAP, levelFor } = MapModule;

  // Input bits mirror the platform kernel so one key map serves both.
  const INPUT = Object.freeze({ LEFT: 1, RIGHT: 2, JUMP: 4, MINE: 8, INTERACT: 32, UP: 1024, DOWN: 2048, RUN: 4096, CALL_LIFT: 8192 });
  const MASK = INPUT.LEFT | INPUT.RIGHT | INPUT.JUMP | INPUT.MINE | INPUT.INTERACT | INPUT.UP | INPUT.DOWN | INPUT.RUN | INPUT.CALL_LIFT;

  const REACH = 48;                          // world px: pickaxe reach to a vein
  const PICKUP_REACH = 40;
  const BAG_CAPACITY = 24;                   // ore pieces the miner can carry
  const CARRY_CAPACITY = 8;                  // ore per cart load
  const MINE_TICKS = Object.freeze({ copper: 18, iron: 26, gold: 34, crystal: 42 });
  const CREW_SPEED = 92;                     // world px per second
  const MACHINE_ENERGY_CAP = 100;
  const MACHINE_ENERGY_REGEN = 0.35;         // per tick, when not working

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const int = (value, fallback = 0) => Math.floor(num(value, fallback));

  // ---------------------------------------------------------------- state

  function freshState() {
    const machines = {};
    for (const machine of MAP.machines) {
      machines[machine.id] = {
        id: machine.id,
        kind: machine.kind,
        // Capacity is a map property, copied in so rules never read it from a snapshot.
        capacity: Number(machine.capacity) || 0,
        // The warehouse keeps its inventory on the machine itself: one object, one
        // truth. (A parallel `warehouse` field silently diverged from it.)
        ...(machine.kind === 'warehouse' ? { stored: {}, total: 0 } : {}),
        status: 'off',            // off | starting | working | blocked | broken
        energy: MACHINE_ENERGY_CAP,
        progress: 0,
        buffer: 0,                // ore waiting at this machine's input
        cargo: 0,                 // ore inside the conveyor/cart
        broken: false,
        reason: null,
      };
    }
    const deposits = {};
    for (const vein of MAP.deposits) {
      deposits[vein.id] = { id: vein.id, remaining: vein.amount, mined: 0, state: 'intact' };
    }
    const crew = {};
    MAP.crewSites.forEach((site, index) => {
      crew[`worker-${index + 1}`] = {
        id: `worker-${index + 1}`,
        role: index === 0 ? 'miner' : index === 1 ? 'hauler' : 'operator',
        status: 'idle',           // idle | walking | working | blocked | returning
        x: site.x - 60,
        y: site.y,
        site: null,
        target: null,
        task: null,
        progress: 0,
        reason: null,
      };
    });
    return {
      version: VERSION,
      mapId: MAP.id,
      mapVersion: MapModule.VERSION,
      tick: 0,
      lastMask: 0,
      status: 'playing',
      // Veins are interaction targets, never collision bodies: a vein that blocked walking
      // could seal the only gallery route past it. Kept as an empty list because the shared
      // motion kernel and the renderer both read `s.rocks`; `hp` is reserved for cave-ins.
      rocks: [],
      player: spawnPlayer(),
      bag: {},                    // ore carried by the miner
      warehouse: machines[MAP.machines.find((m) => m.kind === 'warehouse').id],
      deposits,
      machines,
      crew,
      lift: { y: MAP.lift.start, target: MAP.lift.start, direction: 1, riders: 0 },
      openGates: [],
      secrets: [],
      mission: { id: MAP.mission.id, counters: { copper: 0, iron: 0, gold: 0, crystal: 0, assigned: 0, machinesOn: 0, delivered: 0 }, completed: false, claimed: false },
      stats: { mined: 0, commands: 0, rejected: 0 },
      lastEvents: [],
    };
  }

  function spawnPlayer() {
    return {
      x: MAP.spawn.x,
      y: MAP.spawn.y - 40,
      w: 24,
      h: 40,
      // The shared kernel reads a few fields that the platform round sets up. They are
      // unused in the mine (no combat, no guard meter) but must exist for one physics
      // implementation rather than a second copy.
      hearts: 1,
      guard: { active: false, blocks: 0, timer: 0, stamina: 0, maxStamina: 0, regen: 0, broken: 0 },
      vx: 0,
      vy: 0,
      speed: 210,
      jumpSpeed: -450,
      grounded: true,
      facing: 1,
      coyote: 6,
      jumpBuffer: 0,
      upperRouteY: null,
      pose: 'idle',
      mining: null,           // { depositId, ticks }
      carrying: 0,
    };
  }

  /** Rebuild from a server snapshot without trusting its shape. */
  function hydrate(snapshot) {
    const base = freshState();
    if (!snapshot || typeof snapshot !== 'object' || snapshot.mapVersion !== MapModule.VERSION) return base;
    const out = { ...base };
    out.tick = clamp(int(snapshot.tick), 0, MAX_TICKS);
    out.status = snapshot.status === 'won' || snapshot.status === 'closed' ? snapshot.status : 'playing';
    if (snapshot.player && typeof snapshot.player === 'object') {
      const p = snapshot.player;
      out.player = {
        ...base.player,
        x: clamp(num(p.x, base.player.x), 0, MAP.width),
        y: clamp(num(p.y, base.player.y), 0, MAP.height),
        facing: p.facing === -1 ? -1 : 1,
        grounded: p.grounded !== false,
        upperRouteY: Number.isFinite(Number(p.upperRouteY)) ? Number(p.upperRouteY) : null,
      };
    }
    for (const key of Object.keys(base.deposits)) {
      const saved = snapshot.deposits && snapshot.deposits[key];
      if (!saved) continue;
      const max = MAP.deposits.find((v) => v.id === key).amount;
      out.deposits[key].remaining = clamp(int(saved.remaining), 0, max);
      out.deposits[key].mined = clamp(int(saved.mined), 0, max);
      out.deposits[key].state = out.deposits[key].remaining === 0 ? 'depleted' : out.deposits[key].mined > 0 ? 'cracked' : 'intact';
    }
    for (const key of Object.keys(base.machines)) {
      const saved = snapshot.machines && snapshot.machines[key];
      if (!saved) continue;
      const m = out.machines[key];
      // `m` is a fresh machine from freshState(), so its capacity already comes from the
      // map. The snapshot never widens it, and nothing here may overwrite it.
      m.status = ['off', 'starting', 'working', 'blocked', 'broken'].includes(saved.status) ? saved.status : 'off';
      m.energy = clamp(num(saved.energy, MACHINE_ENERGY_CAP), 0, MACHINE_ENERGY_CAP);
      m.progress = clamp(int(saved.progress), 0, 10_000);
      m.buffer = clamp(int(saved.buffer), 0, 1_000);
      m.cargo = clamp(int(saved.cargo), 0, 1_000);
      m.broken = saved.broken === true;
      m.reason = typeof saved.reason === 'string' ? saved.reason.slice(0, 40) : null;
    }
    for (const key of Object.keys(base.crew)) {
      const saved = snapshot.crew && snapshot.crew[key];
      if (!saved) continue;
      const w = out.crew[key];
      w.status = ['idle', 'walking', 'working', 'blocked', 'returning'].includes(saved.status) ? saved.status : 'idle';
      w.x = clamp(num(saved.x, w.x), 0, MAP.width);
      w.y = clamp(num(saved.y, w.y), 0, MAP.height);
      w.site = typeof saved.site === 'string' ? saved.site.slice(0, 32) : null;
      w.task = typeof saved.task === 'string' && ['mine', 'haul', 'operate'].includes(saved.task) ? saved.task : null;
      w.progress = clamp(int(saved.progress), 0, 10_000);
      w.reason = typeof saved.reason === 'string' ? saved.reason.slice(0, 40) : null;
    }
    out.rocks = [];   // see freshState: veins are not solids
    out.bag = {};
    for (const ore of ['copper', 'iron', 'gold', 'crystal']) out.bag[ore] = clamp(int(snapshot.bag && snapshot.bag[ore]), 0, BAG_CAPACITY);
    out.player.carrying = Object.values(out.bag).reduce((a, b) => a + b, 0);
    const store = out.machines[MAP.machines.find((m) => m.kind === 'warehouse').id];
    out.warehouse = store;
    store.stored = {};
    // Capacity comes from the map, never from the snapshot: a client cannot widen it.
    for (const ore of ['copper', 'iron', 'gold', 'crystal']) store.stored[ore] = clamp(int(snapshot.warehouse && snapshot.warehouse.stored && snapshot.warehouse.stored[ore]), 0, store.capacity);
    store.total = Object.values(store.stored).reduce((a, b) => a + b, 0);
    out.lift.y = MAP.lift.stops.includes(num(snapshot.lift && snapshot.lift.y, MAP.lift.start)) ? num(snapshot.lift && snapshot.lift.y) : MAP.lift.start;
    out.lift.target = out.lift.y;
    out.openGates = Array.isArray(snapshot.openGates) ? snapshot.openGates.filter((id) => MAP.gates.some((g) => g.id === id)).slice(0, 8) : [];
    out.secrets = Array.isArray(snapshot.secrets) ? snapshot.secrets.filter((id) => MAP.secrets.some((s) => s.id === id)).slice(0, 8) : [];
    if (snapshot.mission && typeof snapshot.mission === 'object') {
      for (const key of Object.keys(out.mission.counters)) out.mission.counters[key] = clamp(int(snapshot.mission.counters && snapshot.mission.counters[key]), 0, 1_000_000);
      out.mission.completed = snapshot.mission.completed === true;
      out.mission.claimed = snapshot.mission.claimed === true;
    }
    return out;
  }

  /** The only shape the server stores and the client renders. */
  function snapshotOf(s) {
    return {
      version: VERSION,
      mapId: s.mapId,
      mapVersion: s.mapVersion,
      tick: s.tick,
      status: s.status,
      player: { x: Math.round(s.player.x), y: Math.round(s.player.y), facing: s.player.facing, grounded: s.player.grounded, upperRouteY: s.player.upperRouteY },
      bag: { ...s.bag },
      warehouse: { stored: { ...s.warehouse.stored }, total: s.warehouse.total, capacity: s.warehouse.capacity },
      deposits: Object.fromEntries(Object.entries(s.deposits).map(([id, d]) => [id, { remaining: d.remaining, mined: d.mined, state: d.state }])),
      machines: Object.fromEntries(Object.entries(s.machines).map(([id, m]) => [id, { status: m.status, energy: Math.round(m.energy), progress: m.progress, buffer: m.buffer, cargo: m.cargo, broken: m.broken, reason: m.reason }])),
      crew: Object.fromEntries(Object.entries(s.crew).map(([id, w]) => [id, { status: w.status, x: Math.round(w.x), y: Math.round(w.y), site: w.site, task: w.task, progress: w.progress, reason: w.reason }])),
      lift: { y: s.lift.y, target: s.lift.target },
      openGates: [...s.openGates],
      secrets: [...s.secrets],
      mission: { id: s.mission.id, counters: { ...s.mission.counters }, completed: s.mission.completed, claimed: s.mission.claimed },
      stats: { ...s.stats },
    };
  }

  // ---------------------------------------------------------------- movement

  /** Build the level object the motion kernel needs (lift platform included). */
  function levelOf(s) {
    const level = levelFor(MAP, s.openGates);
    // The deck is continuous, and the cabin is where the miner stands while it moves. A
    // docked cabin needs no platform of its own (the deck is already there) — adding one
    // used to mean *removing* deck geometry, and an over-broad filter once deleted the whole
    // 2530px service deck. The cabin is added only while it is in motion.
    //
    // Cabin geometry, and why it is a rising body rather than a floor:
    //  • the deck runs continuously through the shaft, so boarding is "stand in the doorway
    //    and call the lift" — there is no gap to fall into and no lip to step over;
    //  • while the cabin rises it *is* the floor, and it carries the rider itself (see
    //    stepLift/stepPlayer), so the cabin body must sit above `lift.y` by real height.
    //    An earlier version drew it at the deck line, so a rider read as "off the cabin" the
    //    moment it moved one pixel and the lift left without them.
    const docked = s.lift.y === s.lift.target;
    const cabin = docked
      // Docked: a zero-height marker at the deck line. The deck itself is the floor, so the
      // miner simply walks into the doorway; the marker only tells the renderer where to
      // draw the open cabin and tells `callLift` that this is a ride.
      ? { x: MAP.lift.x, y: s.lift.y, w: MAP.lift.w, h: 0, route: 'upper', lift: true }
      : { x: MAP.lift.x, y: s.lift.y - 74, w: MAP.lift.w, h: 74, kind: 'lift', lift: true };
    // A zero-height docked marker keeps `collisionFor` shape-stable without ever blocking a
    // walk through the doorway; the moving body is a real platform for the rider.
    const platforms = level.platforms.concat([cabin]);
    // `downMask` is what teaches the shared kernel how to climb *down* a ladder. It was
    // never set here, so every ladder in the mine was one-way. Task requirement: ladders
    // go both ways.
    return { ...level, downMask: INPUT.DOWN, platforms };
  }

  /**
   * The walkable surface of the cabin is the deck line `lift.y`: the deck runs continuously
   * through the shaft, the controller has no step-up, and a raised sill turned the lift into
   * a body the miner could not enter. Kept as a named constant because the renderer and the
   * tests both need to know the cabin's floor height.
   */
  const CABIN_DECK = 0;

  function onLift(s) {
    const p = s.player;
    // While the cabin moves, the rider is pinned to it by stepLift(), so the tolerance only
    // has to distinguish "in the cabin" from "on the deck beside it". While docked it is a
    // boarding test, and a generous tolerance is desirable there.
    const riding = s.lift.riders > 0 && s.lift.y !== s.lift.target;
    const tolerance = riding ? 24 : 1.5;
    return p.grounded && Math.abs((p.y + p.h) - s.lift.y) < tolerance &&
      p.x + p.w > MAP.lift.x + 2 && p.x < MAP.lift.x + MAP.lift.w - 2;
  }

  /** A rider is someone standing on the cabin floor while it is docked or moving. */
  function syncRider(s) {
    const p = s.player;
    const riding = onLift(s);
    s.lift.riders = riding ? 1 : 0;
    return riding;
  }

  function stepLift(s) {
    const lift = s.lift;
    if (lift.y === lift.target) return;
    const rider = s.lift.riders > 0;
    const delta = Math.sign(lift.target - lift.y) * Math.min(MAP.lift.speed * DT, Math.abs(lift.target - lift.y));
    lift.y = Math.round((lift.y + delta) * 100) / 100;
    if (Math.abs(lift.y - lift.target) < 0.01) lift.y = lift.target;
    if (rider) {
      // The cabin is the authoritative mover: the rider keeps their feet on its cabin floor
      // even when the cabin's speed exceeds a single gravity step. The feet follow the cabin
      // top (not the old `lift.y`, which is the deck the cabin floor sits on) so the rider
      // rises and falls with the cabin.
      s.player.y = lift.y - s.player.h;
      s.player.vy = 0;
      s.player.grounded = true;
      s.player.upperRouteY = lift.y;
    }
    if (lift.y === lift.target) {
      if (rider) s.lift.riders = 0;
      s.lastEvents.push({ type: 'lift_arrive', y: lift.y });
    }
  }

  function callLift(s) {
    const p = s.player;
    const feet = p.y + p.h;
    // Inside the cabin the miner stands CABIN_DECK above the deck line, so the stop they are
    // at is the cabin's own stop, not the deck their feet are closest to.
    const inside = onLift(s);
    const here = inside ? MAP.lift.stops.find((stop) => Math.abs(stop - s.lift.y) < 6)
      : MAP.lift.stops.find((stop) => Math.abs(stop - feet) < 6);
    if (here === undefined) return { ok: false, reason: 'no-stop' };
    // Inside the cabin: ride to the next stop in the requested direction.
    if (inside) {
      s.lift.riders = 1;
      const index = MAP.lift.stops.indexOf(s.lift.y);
      const next = MAP.lift.stops[index + s.lift.direction];
      if (next === undefined) {
        s.lift.direction = -s.lift.direction;
        const back = MAP.lift.stops[index + s.lift.direction];
        if (back === undefined) return { ok: false, reason: 'no-target' };
        s.lift.target = back;
      } else {
        s.lift.target = next;
      }
      return { ok: true, action: 'ride', target: s.lift.target };
    }
    // On a landing: call the cabin here.
    if (Math.abs(s.lift.y - here) < 0.5) return { ok: false, reason: 'already-here' };
    s.lift.target = here;
    return { ok: true, action: 'call', target: s.lift.target };
  }

  function updateCameraFacing(s, mask) {
    const dir = Number(Boolean(mask & INPUT.RIGHT)) - Number(Boolean(mask & INPUT.LEFT));
    if (dir) s.player.facing = dir;
    return dir;
  }

  function stepPlayer(s, mask) {
    const p = s.player;
    const level = levelOf(s);
    const liftBoard = onLift(s);
    s.lift.riders = liftBoard ? 1 : 0;

    // A rider cannot jump. Steering on a *moving* cabin belongs to the cabin; on a docked
    // one, walking is normal movement — otherwise the miner who boards at the surface is
    // pinned in place forever. `onLift` is deliberately generous (a boarding test), so the
    // decision to walk is made here, not there.
    const docked = s.lift.y === s.lift.target;
    const rideLock = liftBoard && !docked;
    const walking = (mask & (INPUT.LEFT | INPUT.RIGHT)) !== 0;
    const effective = rideLock ? (mask & ~(INPUT.LEFT | INPUT.RIGHT | INPUT.JUMP | INPUT.UP | INPUT.DOWN)) : mask;
    const steering = !rideLock && (!liftBoard || walking);
    const direction = steering ? updateCameraFacing(s, mask) : 0;

    if (rideLock) {
      // The cabin owns the miner's vertical motion; the character controller would only
      // fight it (gravity pulled the rider out of a climbing cabin, one pixel per tick, and
      // the generous boarding test then lost them entirely).
      s.player.vx = 0;
      s.player.vy = 0;
      s.player.grounded = true;
      updateCameraFacing(s, 0);
      return;
    }

    R.motion.updateJumpWindow(s, effective);
    const running = Boolean(effective & INPUT.RUN);
    // A miner mid-swing plants their feet: mining is a place-bound action, so moving is
    // what cancels it — and the cancel must happen before an early piece is produced.
    // No input means no horizontal motion. Keeping the old velocity here made the miner
    // glide on forever after a key release (nothing else in the sim ever decayed `vx`),
    // so releasing a direction did not actually stop the player.
    p.vx = (direction && !p.mining) ? direction * p.speed * (running ? 1.35 : 0.62) : 0;
    if (!liftBoard) R.motion.applyJump(s);
    R.motion.moveActor(s, effective, level);

    if (p.y > MAP.height + 120) respawn(s);
    if (p.x < 4 && p.vx < 0) p.x = 4;
  }

  function respawn(s) {
    const p = s.player;
    p.x = MAP.spawn.x;
    p.y = MAP.spawn.y - p.h;
    p.vx = 0;
    p.vy = 0;
    p.grounded = true;
    p.upperRouteY = null;
    p.mining = null;
    s.lastEvents.push({ type: 'respawn', x: p.x, y: p.y });
  }

  // ---------------------------------------------------------------- mining

  function bagTotal(s) {
    return Object.values(s.bag).reduce((a, b) => a + b, 0);
  }

  /** Begin (or continue) mining the vein in reach. Server validates this command. */
  function startMining(s) {
    const p = s.player;
    if (bagTotal(s) >= BAG_CAPACITY) return { ok: false, reason: 'bag-full' };
    const vein = MapModule.depositInReach(MAP, p, REACH);
    if (!vein) return { ok: false, reason: 'no-vein' };
    const deposit = s.deposits[vein.id];
    if (!deposit || deposit.remaining <= 0) return { ok: false, reason: 'depleted' };
    if (vein.requires && !s.openGates.includes(vein.requires)) return { ok: false, reason: 'locked' };
    if (vein.crewOnly) return { ok: false, reason: 'crew-only' };
    if (!p.mining || p.mining.depositId !== vein.id) p.mining = { depositId: vein.id, ticks: 0 };
    return { ok: true, depositId: vein.id };
  }

  function cancelMining(s) {
    if (s.player.mining) s.player.mining = null;
  }

  function tickMining(s) {
    const p = s.player;
    if (!p.mining) return;
    const vein = MAP.deposits.find((v) => v.id === p.mining.depositId);
    const deposit = s.deposits[p.mining.depositId];
    if (!vein || !deposit || deposit.remaining <= 0) { p.mining = null; return; }
    // Walking away cancels the swing: mining is a place-bound action.
    if (MapModule.depositInReach(MAP, p, REACH) !== vein) { p.mining = null; return; }
    p.mining.ticks += 1;
    const needed = MINE_TICKS[vein.ore] || 24;
    if (p.mining.ticks < needed) return;
    p.mining.ticks = 0;
    if (bagTotal(s) >= BAG_CAPACITY) { p.mining = null; s.lastEvents.push({ type: 'bag_full' }); return; }
    // One piece per completed swing, decided here and re-derived by the server.
    deposit.remaining -= 1;
    deposit.mined += 1;
    deposit.state = deposit.remaining === 0 ? 'depleted' : 'cracked';
    s.bag[vein.ore] = (s.bag[vein.ore] || 0) + 1;
    p.carrying = bagTotal(s);
    s.stats.mined += 1;
    s.mission.counters[vein.ore] = (s.mission.counters[vein.ore] || 0) + 1;
    s.lastEvents.push({ type: 'ore_mined', depositId: vein.id, ore: vein.ore, x: vein.x, y: vein.y - 24, amount: 1, remaining: deposit.remaining });
    if (deposit.remaining === 0) {
      s.lastEvents.push({ type: 'vein_depleted', depositId: vein.id, x: vein.x, y: vein.y - 24 });
    }
  }

  // ---------------------------------------------------------------- crew

  function assignWorker(s, workerId, siteId) {
    const worker = s.crew[workerId];
    if (!worker) return { ok: false, reason: 'unknown-worker' };
    const site = MapModule.siteById(MAP, siteId);
    if (!site) return { ok: false, reason: 'unknown-site' };
    if (worker.status === 'working') return { ok: false, reason: 'busy' };
    if (site.deposit) {
      const deposit = s.deposits[site.deposit];
      if (!deposit || deposit.remaining <= 0) return { ok: false, reason: 'depleted' };
    }
    if (site.machine && s.machines[site.machine].broken) return { ok: false, reason: 'machine-broken' };
    worker.site = site.id;
    worker.task = site.task;
    worker.target = { x: site.x, y: site.y };
    worker.status = 'walking';
    worker.progress = 0;
    worker.reason = null;
    s.mission.counters.assigned = 1;
    s.lastEvents.push({ type: 'worker_assigned', workerId, siteId: site.id, task: site.task });
    return { ok: true, workerId, siteId: site.id, task: site.task };
  }

  function recallWorker(s, workerId) {
    const worker = s.crew[workerId];
    if (!worker) return { ok: false, reason: 'unknown-worker' };
    if (worker.status === 'idle') return { ok: true, already: true };
    worker.site = null;
    worker.task = null;
    worker.target = null;
    worker.status = 'returning';
    worker.progress = 0;
    s.lastEvents.push({ type: 'worker_recalled', workerId });
    return { ok: true };
  }

  /** Walk the worker along the walking surface: horizontal first, then vertical on a ladder. */
  function stepCrew(s) {
    for (const worker of Object.values(s.crew)) {
      if (worker.status !== 'walking' && worker.status !== 'returning') continue;
      const target = worker.target || { x: worker.x, y: worker.y };
      const dx = target.x - worker.x;
      const dy = target.y - worker.y;
      const budget = CREW_SPEED * DT;
      if (Math.abs(dx) > 0.5) {
        worker.x += Math.sign(dx) * Math.min(Math.abs(dx), budget);
      } else if (Math.abs(dy) > 0.5) {
        // A worker only changes floor on a ladder rail or inside the lift column.
        const onRail = MAP.ladders.some((rail) => Math.abs(worker.x - (rail.x + 14)) < 20) ||
          (worker.x > MAP.lift.x && worker.x < MAP.lift.x + MAP.lift.w);
        if (!onRail) {
          worker.status = 'blocked';
          worker.reason = 'no-path';
          s.lastEvents.push({ type: 'worker_blocked', workerId: worker.id, reason: 'no-path' });
          continue;
        }
        worker.y += Math.sign(dy) * Math.min(Math.abs(dy), budget);
      } else {
        worker.x = target.x;
        worker.y = target.y;
        if (worker.status === 'returning') {
          worker.status = 'idle';
          worker.target = null;
          s.lastEvents.push({ type: 'worker_idle', workerId: worker.id });
        } else {
          worker.status = 'working';
          s.lastEvents.push({ type: 'worker_working', workerId: worker.id, siteId: worker.site, task: worker.task });
        }
      }
    }
  }

  function stepWorkerProduction(s) {
    for (const worker of Object.values(s.crew)) {
      if (worker.status !== 'working' || !worker.site) continue;
      const site = MapModule.siteById(MAP, worker.site);
      if (!site) continue;
      worker.progress += 1;
      if (worker.task === 'mine' && site.deposit) {
        const deposit = s.deposits[site.deposit];
        if (!deposit || deposit.remaining <= 0) { worker.status = 'blocked'; worker.reason = 'depleted'; continue; }
        if (worker.progress >= 180) {
          worker.progress = 0;
          deposit.remaining -= 1;
          deposit.mined += 1;
          deposit.state = deposit.remaining === 0 ? 'depleted' : 'cracked';
          s.stats.mined += 1;
          const drill = s.machines['drill-1'];
          if (drill && drill.buffer < MAP.machines[0].buffer) drill.buffer += 1;
          s.lastEvents.push({ type: 'worker_ore', workerId: worker.id, ore: MAP.deposits.find((v) => v.id === site.deposit).ore, x: worker.x, y: worker.y - 30 });
        }
      } else if (worker.task === 'haul') {
        const cart = s.machines['cart-1'];
        if (worker.progress >= 150 && cart && cart.cargo < CARRY_CAPACITY) {
          worker.progress = 0;
          cart.cargo = Math.min(CARRY_CAPACITY, cart.cargo + 1);
          s.lastEvents.push({ type: 'worker_haul', workerId: worker.id, cart: cart.cargo });
        }
      } else if (worker.task === 'operate') {
        // The operator keeps the drill running while it has input and energy.
        const drill = s.machines['drill-1'];
        if (drill && drill.status === 'broken') { worker.status = 'blocked'; worker.reason = 'machine-broken'; }
      }
    }
  }

  // ---------------------------------------------------------------- machines

  function machineCommand(s, machineId, action) {
    const machine = s.machines[machineId];
    if (!machine) return { ok: false, reason: 'unknown-machine' };
    if (machine.broken && action === 'start') return { ok: false, reason: 'broken' };
    if (action === 'start') {
      if (machine.status === 'working') return { ok: true, already: true };
      machine.status = 'working';
      machine.reason = null;
      machine.progress = 0;
      s.lastEvents.push({ type: 'machine_started', machineId });
    } else if (action === 'stop') {
      machine.status = 'off';
      machine.reason = null;
      machine.progress = 0;
      s.lastEvents.push({ type: 'machine_stopped', machineId });
    } else if (action === 'repair') {
      if (!machine.broken) return { ok: false, reason: 'not-broken' };
      machine.broken = false;
      machine.status = 'off';
      machine.reason = null;
      s.lastEvents.push({ type: 'machine_repaired', machineId });
    } else {
      return { ok: false, reason: 'unknown-action' };
    }
    s.mission.counters.machinesOn = Object.values(s.machines).filter((m) => m.status === 'working').length;
    return { ok: true, machineId, status: machine.status };
  }

  function stepMachines(s) {
    const drill = s.machines['drill-1'];
    const conveyor = s.machines['conveyor-1'];
    const cart = s.machines['cart-1'];
    const warehouse = s.machines['warehouse-1'];
    const drillSpec = MAP.machines.find((m) => m.id === 'drill-1');
    const conveyorSpec = MAP.machines.find((m) => m.id === 'conveyor-1');

    for (const machine of Object.values(s.machines)) {
      if (machine.status !== 'working') machine.energy = Math.min(MACHINE_ENERGY_CAP, machine.energy + MACHINE_ENERGY_REGEN);
    }

    // Drill: consumes buffer input? No — the drill *produces* into its buffer, then
    // feeds the conveyor. It needs energy and free buffer space.
    const drillCost = drillSpec.energy * DT;
    const conveyorCost = conveyorSpec.energy * DT;
    if (drill.status === 'working') {
      if (drill.energy < drillCost) { drill.status = 'blocked'; drill.reason = 'no-energy'; s.lastEvents.push({ type: 'machine_blocked', machineId: 'drill-1', reason: 'no-energy' }); }
      else if (drill.buffer >= drillSpec.buffer) { drill.status = 'blocked'; drill.reason = 'buffer-full'; s.lastEvents.push({ type: 'machine_blocked', machineId: 'drill-1', reason: 'buffer-full' }); }
      else {
        drill.energy = Math.max(0, drill.energy - drillCost);
        drill.progress += 1;
        if (drill.progress >= drillSpec.rateTicks) { drill.progress = 0; drill.buffer += 1; s.lastEvents.push({ type: 'drill_ore', buffer: drill.buffer }); }
      }
    }
    if (drill.status === 'blocked' && drill.reason === 'buffer-full' && drill.buffer < drillSpec.buffer) { drill.status = 'working'; drill.reason = null; }
    if (drill.status === 'blocked' && drill.reason === 'no-energy' && drill.energy > 20) { drill.status = 'working'; drill.reason = null; }

    // Conveyor: only moves cargo that really exists upstream. Backpressure stops it
    // when the cart is full.
    if (conveyor.status === 'working') {
      if (conveyor.energy < conveyorCost) { conveyor.status = 'blocked'; conveyor.reason = 'no-energy'; s.lastEvents.push({ type: 'machine_blocked', machineId: 'conveyor-1', reason: 'no-energy' }); }
      else if (conveyor.cargo >= conveyorSpec.capacity) { conveyor.status = 'blocked'; conveyor.reason = 'conveyor-full'; s.lastEvents.push({ type: 'machine_blocked', machineId: 'conveyor-1', reason: 'conveyor-full' }); }
      else if (cart.cargo >= CARRY_CAPACITY) { conveyor.status = 'blocked'; conveyor.reason = 'cart-full'; s.lastEvents.push({ type: 'machine_blocked', machineId: 'conveyor-1', reason: 'cart-full' }); }
      else {
        conveyor.energy = Math.max(0, conveyor.energy - conveyorCost);
        conveyor.progress += 1;
        if (conveyor.progress >= conveyorSpec.rateTicks) {
          conveyor.progress = 0;
          // Take one piece from the drill buffer if present, otherwise from its own cargo.
          if (drill.buffer > 0) drill.buffer -= 1;
          conveyor.cargo = Math.min(conveyorSpec.capacity, conveyor.cargo + 1);
          s.lastEvents.push({ type: 'conveyor_move', cargo: conveyor.cargo });
        }
      }
    }
    if (conveyor.status === 'blocked' && cart.cargo < CARRY_CAPACITY && conveyor.energy > 10) { conveyor.status = 'working'; conveyor.reason = null; }

    // The cart is loaded by a running conveyor and drains itself into the warehouse while
    // the warehouse is running. This is the visible chain: belt moves ore, cart carries it,
    // warehouse stores it.
    if (cart.cargo < CARRY_CAPACITY && conveyor.status === 'working' && conveyor.cargo > 0) {
      cart.cargo += 1;
      conveyor.cargo -= 1;
      s.lastEvents.push({ type: 'cart_loaded', cargo: cart.cargo });
    }
    if (cart.cargo > 0 && warehouse.status === 'working') {
      cart.progress += 1;
      if (cart.progress >= 60) {
        cart.progress = 0;
        const capacity = Number(warehouse.capacity) || 0;
        const stored = Number(warehouse.total) || 0;
        const room = Math.max(0, capacity - stored);
        // Every piece is either stored or still on the cart. A blocked warehouse keeps its
        // cargo; it never drops it, and it never reports "full" while it still has room.
        const moved = Math.min(cart.cargo, room);
        if (moved > 0) {
          cart.cargo -= moved;
          const ore = 'copper';   // the cart carries mixed ore; the slice tracks copper
          s.warehouse.stored[ore] = (s.warehouse.stored[ore] || 0) + moved;
          s.warehouse.total = stored + moved;
          s.mission.counters.delivered += moved;
          s.lastEvents.push({ type: 'warehouse_delivery', ore, amount: moved, total: s.warehouse.total });
        }
        if (room <= 0) {
          warehouse.status = 'blocked';
          warehouse.reason = 'warehouse-full';
          s.lastEvents.push({ type: 'machine_blocked', machineId: 'warehouse-1', reason: 'warehouse-full' });
        } else if (cart.cargo === 0) {
          cart.progress = 0;
        }
      }
    }
    if (warehouse.status === 'blocked' && warehouse.reason === 'warehouse-full' && (Number(warehouse.total) || 0) < (Number(warehouse.capacity) || 0)) {
      warehouse.status = 'working';
      warehouse.reason = null;
    }
  }

  /** Unload the miner's bag into the warehouse when standing at its panel. */
  function unloadBag(s) {
    const p = s.player;
    const warehouse = s.machines['warehouse-1'];
    const spec = MAP.machines.find((m) => m.id === 'warehouse-1');
    if (!warehouse) return { ok: false, reason: 'no-warehouse' };
    const panel = MapModule.interactableInReach(MAP, p, 80);
    if (!panel || panel.kind !== 'warehouse') return { ok: false, reason: 'not-here' };
    const carried = bagTotal(s);
    if (!carried) return { ok: false, reason: 'empty' };
    const capacity = Number.isFinite(Number(warehouse.capacity)) ? Number(warehouse.capacity) : 0;
    const stored = Number.isFinite(Number(warehouse.total)) ? Number(warehouse.total) : 0;
    const room = Math.max(0, capacity - stored);
    if (room <= 0) {
      warehouse.status = 'blocked';
      warehouse.reason = 'warehouse-full';
      return { ok: false, reason: 'warehouse-full' };
    }
    let moved = 0;
    for (const ore of Object.keys(s.bag)) {
      const take = Math.min(s.bag[ore], room - moved);
      if (take <= 0) continue;
      s.bag[ore] -= take;
      s.warehouse.stored[ore] = (s.warehouse.stored[ore] || 0) + take;
      moved += take;
      if (moved >= room) break;
    }
    s.warehouse.total += moved;
    s.mission.counters.delivered += moved;
    p.carrying = bagTotal(s);
    if (warehouse.status === 'blocked' && warehouse.reason === 'warehouse-full') { warehouse.status = 'off'; warehouse.reason = null; }
    s.lastEvents.push({ type: 'bag_unloaded', amount: moved, total: s.warehouse.total });
    return { ok: true, amount: moved, total: s.warehouse.total, capacity: warehouse.capacity };
  }

  // ---------------------------------------------------------------- discoveries & gates

  function inspectSecret(s) {
    const secret = MapModule.secretInReach(MAP, s.player, s.secrets);
    if (!secret) return { ok: false, reason: 'nothing-here' };
    s.secrets.push(secret.id);
    s.lastEvents.push({ type: 'secret_found', id: secret.id });
    return { ok: true, id: secret.id };
  }

  function evaluateGates(s) {
    for (const gate of MAP.gates) {
      if (s.openGates.includes(gate.id)) continue;
      const need = gate.requires || {};
      const ready = need.objective === 'mine-copper'
        ? (s.mission.counters.copper || 0) >= 6
        : need.objective === 'deliver-ore'
          ? (s.mission.counters.delivered || 0) >= 8
          : false;
      if (!ready) continue;
      s.openGates.push(gate.id);
      s.lastEvents.push({ type: 'gate_open', id: gate.id, name: gate.name });
    }
  }

  function evaluateMission(s) {
    if (s.mission.completed) return;
    const done = MAP.mission.steps.every((step) => (s.mission.counters[step.counter] || 0) >= step.target);
    if (!done) return;
    s.mission.completed = true;
    s.status = 'won';
    s.lastEvents.push({ type: 'mission_complete', id: s.mission.id });
  }

  // ---------------------------------------------------------------- public step

  /** One fixed tick. `mask` is the input bitfield for this tick. */
  function step(s, mask) {
    if (!s || s.status !== 'playing') return s;
    // `s.events` is the shared motion kernel's output list; it is cleared here and
    // published at the end. It must never be used to hold state (an earlier version kept
    // *deliveries* in it and this reset silently rewound the warehouse every tick).
    const pending = [];
    s.events = pending;
    s.lastEvents = pending;
    s.tick += 1;
    const bits = Number.isInteger(mask) ? mask & MASK : 0;

    stepLift(s);
    syncRider(s);
    // A swing is a place-bound action: moving or releasing the mine input abandons it.
    // An idle tick (no input at all) neither starts nor cancels anything, so replaying a
    // command log is not affected by how the idle frames are spaced.
    if (bits) {
      if (s.player.mining) {
        if ((bits & (INPUT.LEFT | INPUT.RIGHT | INPUT.JUMP | INPUT.UP | INPUT.DOWN)) || !(bits & INPUT.MINE)) cancelMining(s);
      } else if (bits & INPUT.MINE) {
        startMining(s); // holding the mine input keeps mining where the player stands
      }
    }
    stepPlayer(s, bits);
    tickMining(s);
    stepCrew(s);
    stepWorkerProduction(s);
    stepMachines(s);
    evaluateGates(s);
    evaluateMission(s);

    s.player.pose = s.player.mining ? 'mine'
      : !s.player.grounded ? (s.player.vy < 0 ? 'jump' : 'fall')
        : (bits & (INPUT.LEFT | INPUT.RIGHT)) ? 'run' : 'idle';
    s.lastEvents = pending;
    return s;
  }

  // ---------------------------------------------------------------- commands

  const COMMANDS = Object.freeze(['mine_start', 'mine_stop', 'assign_worker', 'recall_worker', 'machine', 'lift', 'unload', 'inspect']);

  /**
   * Apply one discrete player command. The server calls this during replay with the
   * same command list the client sent, so a forged quantity has nothing to attach to.
   */
  function applyCommand(s, command) {
    if (!s || s.status !== 'playing') return { ok: false, reason: 'ended' };
    s.stats.commands += 1;
    if (!command || typeof command !== 'object' || !COMMANDS.includes(command.type)) {
      s.stats.rejected += 1;
      return { ok: false, reason: 'invalid' };
    }
    let result;
    switch (command.type) {
      case 'mine_start': result = startMining(s); break;
      case 'mine_stop': cancelMining(s); result = { ok: true }; break;
      case 'assign_worker': result = assignWorker(s, String(command.workerId || ''), String(command.siteId || '')); break;
      case 'recall_worker': result = recallWorker(s, String(command.workerId || '')); break;
      case 'machine': result = machineCommand(s, String(command.machineId || ''), String(command.action || '')); break;
      case 'lift': result = callLift(s); break;
      case 'unload': result = unloadBag(s); break;
      case 'inspect': result = inspectSecret(s); break;
      default: result = { ok: false, reason: 'invalid' };
    }
    if (!result || !result.ok) {
      s.stats.rejected += 1;
      return result && typeof result === 'object' ? result : { ok: false, reason: 'invalid' };
    }
    return result;
  }

  /**
   * Replay a command log from a starting snapshot. Returns the resulting state and
   * the applied/rejected outcomes, so the server can store exactly what happened.
   * Each command carries the tick at which the player issued it; ticks are clamped
   * and non-decreasing so a forged order cannot rewrite history.
   */
  function replay(snapshot, commands) {
    const s = hydrate(snapshot);
    const list = Array.isArray(commands) ? commands.slice(0, MAX_COMMANDS_PER_CHECKPOINT) : [];
    const applied = [];
    let cursor = s.tick;
    let hold = 0;   // the input still held from the previous command
    for (const command of list) {
      const at = clamp(int(command && command.tick, cursor), cursor, cursor + FPS * 60);
      const gap = Math.min(at - cursor, MAX_TICKS - s.tick);
      for (let i = 0; i < gap; i++) step(s, hold);
      cursor = at;
      if (command && command.type === 'mine_start') hold = INPUT.MINE;
      else if (command && command.type === 'mine_stop') hold = 0;
      const outcome = applyCommand(s, command);
      applied.push({ type: command && command.type, ok: outcome.ok, reason: outcome.reason || null });
      if (s.status !== 'playing') break;
    }
    return { ok: true, state: s, applied, snapshot: snapshotOf(s) };
  }

  return Object.freeze({
    VERSION, FPS, DT, MAX_TICKS, INPUT, MASK, REACH, BAG_CAPACITY, CARRY_CAPACITY, MINE_TICKS,
    BAG_CAPACITY_TOTAL: BAG_CAPACITY, COMMANDS, MAX_COMMANDS_PER_CHECKPOINT,
    freshState, spawnPlayer, hydrate, snapshotOf, step, applyCommand, replay, levelOf,
    onLift, callLift, bagTotal, unloadBag, respawn, machineCommand, assignWorker, recallWorker,
  });
});
