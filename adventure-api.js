'use strict';
/* Stone Mine — authoritative session endpoint.
 *
 * The client sends inputs, never results: an input mask per tick, or discrete commands.
 * The server keeps the last safe checkpoint in `user.sync.adventureMine` and replays the
 * sent log with the same deterministic rules module the browser uses
 * (public/adventure/stone-mine-rules.js). A forged quantity has nothing to attach to —
 * the only numbers accepted are a mask, a command type and a tick.
 *
 * Where the ore goes
 * ------------------
 * Silo storage is the mine's own inventory (`snapshot.warehouse.stored`). The player drains
 * it into their permanent account with `collect`, which is the *only* place that touches
 * `state.ores`, and it is:
 *   - idempotent: a repeated (session, seq) returns the receipt instead of paying twice;
 *   - transactional: the whole read-modify-write happens inside `store.withUsers`, and a
 *     ledger row is written in the same transaction;
 *   - capped: a fixed per-day ore cap shared with the rest of the economy, so an automated
 *     run cannot out-earn the game's own clocks.
 *
 * Save/restore: `start` hydrates from the stored checkpoint, so closing the game and coming
 * back restores veins, machine buffers, crew assignments and the silo exactly.
 */
const crypto = require('node:crypto');
const Rules = require('./public/adventure/stone-mine-rules');
const MapModule = require('./public/adventure/stone-mine-map');

const SESSION_LIFETIME_MS = 60 * 60 * 1000;      // one mine visit
const MAX_INPUT_FRAMES = Rules.FPS * 60 * 30;    // 30 minutes of movement per request
const MAX_COMMANDS = 400;
const MAX_OPS = 600;
const MAX_DRIFT_TICKS = Rules.FPS * 10;          // a client clock may not run ahead of the wall clock
const DAILY_ORE_CAP = 1500;                      // units per UTC day across all mines
const ORE_TYPES = ['copper', 'iron', 'gold', 'crystal'];
const STATE_KEY = 'adventureMine';

const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const dayKey = (at) => new Date(at).toISOString().slice(0, 10);

/**
 * Validate the client's ordered op log: interleaved input runs and commands.
 * Ordering is the whole point — a `mine_start` must land at the same instant it happened
 * client-side, not after the entire movement batch. Returns a clean copy or null.
 */
function sanitizeOps(raw, frameLimit) {
  if (!Array.isArray(raw) || raw.length > MAX_OPS) return null;
  const out = [];
  let ticks = 0;
  for (const op of raw) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) return null;
    if (op.t === 'i') {
      const mask = int(op.mask, -1);
      if (mask < 0 || (mask & ~Rules.MASK) !== 0) return null;
      const n = int(op.ticks, 0);
      if (n < 1) return null;
      ticks += n;
      if (ticks > frameLimit) return null;
      out.push({ t: 'i', mask, ticks: n });
    } else if (op.t === 'c') {
      const command = sanitizeCommand(op.command);
      if (!command) return null;
      out.push({ t: 'c', command });
    } else {
      return null;
    }
  }
  return { ops: out, ticks };
}

const MACHINE_ACTIONS = Object.freeze(['start', 'stop', 'repair']);

function sanitizeCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return null;
  if (!Rules.COMMANDS.includes(command.type)) return null;
  const clean = { type: command.type, tick: Math.max(0, int(command.tick, 0)) };
  for (const key of ['workerId', 'siteId', 'machineId']) {
    if (command[key] === undefined) continue;
    if (typeof command[key] !== 'string' || command[key].length > 32) return null;
    clean[key] = command[key];
  }
  if (command.action !== undefined) {
    // This list must stay in step with the actions the simulation actually implements.
    // `repair` was missing, so the server rejected the one command that can recover a
    // seized drill: the client could render the repair button, send it, and be told the
    // whole batch was malformed — leaving a broken mine unrecoverable over the network.
    if (!MACHINE_ACTIONS.includes(command.action)) return null;
    clean.action = command.action;
  }
  return clean;
}

/** A bare command list (older clients) — validated with the same rules. */
function sanitizeCommands(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_COMMANDS) return null;
  const out = [];
  for (const command of raw) {
    const clean = sanitizeCommand(command);
    if (!clean) return null;
    out.push(clean);
  }
  return out;
}

/** Whatever is in the database is untrusted after a schema change, so clamp it. */
function safeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || raw.mapId !== MapModule.MAP.id) return null;
  if (int(raw.mapVersion, 0) !== MapModule.VERSION) return null;
  try {
    const state = Rules.hydrate(raw);
    return Rules.snapshotOf(state);
  } catch (_) {
    return null;
  }
}

function sessionOf(user, at) {
  const saved = user.sync && user.sync[STATE_KEY];
  if (!saved || typeof saved !== 'object' || saved.sessionId !== saved.sessionId) return null;
  if (typeof saved.sessionId !== 'string' || !saved.sessionId) return null;
  if (!Number.isFinite(saved.startedAt) || at - saved.startedAt > SESSION_LIFETIME_MS) return null;
  return saved;
}

function emptySession(at) {
  return {
    sessionId: crypto.randomUUID(),
    startedAt: at,
    seq: 0,
    lastDigest: null,
    lastReceipt: null,
    snapshot: null,
    oreDay: dayKey(at),
    oreCollected: 0,
  };
}

/** Per-day ore accounting, reset lazily on the first collect of a new UTC day. */
function oreBudget(session, at) {
  const day = dayKey(at);
  if (session.oreDay !== day) { session.oreDay = day; session.oreCollected = 0; }
  const used = clamp(int(session.oreCollected, 0), 0, DAILY_ORE_CAP);
  return { day, used, cap: DAILY_ORE_CAP, remaining: Math.max(0, DAILY_ORE_CAP - used) };
}

function mountAdventureMine({ app, store, requireAuth, rateLimit, asyncRoute, prepare, now = Date.now }) {
  const route = (path, limit, work) => app.post(`/api/adventure/mine/${path}`, requireAuth, rateLimit(`adv-mine-${path}`, limit), asyncRoute(async (req, res) => {
    const outcome = await store.withUsers([req.player.id], async () => {
      const user = await prepare(req.player);
      return work(user, req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}, now());
    });
    const status = outcome && outcome.status ? outcome.status : 200;
    const { status: _s, ...body } = outcome || {};
    if (status >= 400) return res.status(status).json(body);
    res.json(body);
  }));

  // ---------------------------------------------------------------- restore
  route('state', 120, async (user, _body, at) => {
    const saved = sessionOf(user, at);
    if (!saved) {
      // No live session: nothing is running, but the last checkpoint is still readable so
      // a returning player sees the mine where they left it.
      const leftover = user.sync && user.sync[STATE_KEY] && user.sync[STATE_KEY].snapshot;
      const snapshot = safeSnapshot(leftover);
      return { session: null, snapshot, budget: oreBudget(user.sync && user.sync[STATE_KEY] ? user.sync[STATE_KEY] : { oreDay: '', oreCollected: 0 }, at) };
    }
    if (!saved.snapshot) {
      const fresh = Rules.freshState();
      saved.snapshot = Rules.snapshotOf(fresh);
    }
    return { session: { id: saved.sessionId, seq: saved.seq, startedAt: saved.startedAt }, snapshot: safeSnapshot(saved.snapshot), budget: oreBudget(saved, at) };
  });

  // ---------------------------------------------------------------- start / resume
  route('start', 30, async (user, body, at) => {
    const existing = sessionOf(user, at);
    if (existing) {
      return {
        session: { id: existing.sessionId, seq: existing.seq, startedAt: existing.startedAt },
        snapshot: safeSnapshot(existing.snapshot) || Rules.snapshotOf(Rules.freshState()),
        resumed: true,
        budget: oreBudget(existing, at),
      };
    }
    // A stale checkpoint is kept as the starting point: the world persists across visits.
    // Starting over is an explicit act, so `restart` must be sent by the player.
    const previous = user.sync && user.sync[STATE_KEY];
    const snapshotFromPrevious = body.restart === true ? null : safeSnapshot(previous && previous.snapshot);
    const session = emptySession(at);
    session.snapshot = snapshotFromPrevious || Rules.snapshotOf(Rules.freshState());
    if (previous && previous.oreDay === dayKey(at)) {
      session.oreDay = previous.oreDay;
      session.oreCollected = int(previous.oreCollected, 0);
    }
    user.sync[STATE_KEY] = session;
    user.revision += 1;
    user.updatedAt = at;
    await store.putUser(user);
    return {
      session: { id: session.sessionId, seq: 0, startedAt: session.startedAt },
      snapshot: session.snapshot,
      resumed: false,
      budget: oreBudget(session, at),
    };
  });

  // ---------------------------------------------------------------- checkpoint
  route('checkpoint', 180, async (user, body, at) => {
    const saved = sessionOf(user, at);
    if (!saved) return { status: 409, error: 'انتهت جلسة المنجم؛ أعد فتح المنجم' };
    const id = typeof body.id === 'string' ? body.id : '';
    const seq = int(body.seq, 0);
    if (!id || id !== saved.sessionId) return { status: 409, error: 'جلسة منجم مختلفة' };
    if (seq < 1) return { status: 400, error: 'رقم حفظ غير صالح' };

    // The client sends an ordered op log. A bare command list is still accepted so an
    // older tab mid-session can finish without losing its work.
    let parsed;
    if (body.ops !== undefined) {
      parsed = sanitizeOps(body.ops, MAX_INPUT_FRAMES);
    } else {
      const commands = sanitizeCommands(body.commands === undefined ? [] : body.commands);
      parsed = commands ? { ops: commands.map((command) => ({ t: 'c', command })), ticks: 0 } : null;
    }
    if (!parsed) return { status: 400, error: 'مدخلات حركة غير صالحة' };

    // Ticks are a client-supplied clock, so they are bounded by real elapsed time. 60 Hz
    // over the wall-clock delta, with a little slack for a slow network, is the ceiling.
    const elapsedTicks = Math.floor(Math.max(0, at - saved.startedAt) * (Rules.FPS / 1000)) + MAX_DRIFT_TICKS;
    const base = safeSnapshot(saved.snapshot) || Rules.snapshotOf(Rules.freshState());
    if (base.tick + parsed.ticks > elapsedTicks) {
      return { status: 400, error: 'زمن حركة أسرع من الزمن الحقيقي' };
    }

    const digest = crypto.createHash('sha256').update(JSON.stringify(parsed.ops)).digest('hex');
    // Re-sending the same checkpoint (a retried request) must not advance the world twice.
    if (seq === saved.seq && digest === saved.lastDigest && saved.lastReceipt) {
      return { ...saved.lastReceipt, duplicate: true };
    }
    if (seq !== saved.seq + 1) return { status: 409, error: 'تعارض حفظ؛ أعد فتح المنجم' };

    const state = Rules.hydrate(base);
    const outcomes = [];
    for (const op of parsed.ops) {
      if (state.status !== 'playing') break;
      if (op.t === 'i') {
        for (let i = 0; i < op.ticks && state.status === 'playing'; i++) Rules.step(state, op.mask);
      } else {
        outcomes.push(Rules.applyCommand(state, op.command));
      }
    }

    const snapshot = Rules.snapshotOf(state);
    saved.snapshot = snapshot;
    saved.seq = seq;
    saved.lastDigest = digest;
    const receipt = {
      session: { id: saved.sessionId, seq, startedAt: saved.startedAt },
      snapshot,
      applied: outcomes.filter((o) => o && o.ok).length,
      rejected: outcomes.filter((o) => o && !o.ok).length,
      budget: oreBudget(saved, at),
    };
    saved.lastReceipt = receipt;
    user.revision += 1;
    user.updatedAt = at;
    await store.putUser(user);
    if (outcomes.some((o) => o && !o.ok)) {
      await store.appendLedger(user.id, [{
        session: `adv-mine:${saved.sessionId}`,
        seq,
        kind: 'adv_mine_rejected',
        goldDelta: 0,
        at,
        detail: { rejected: outcomes.filter((o) => o && !o.ok).map((o) => o.reason || 'unknown') },
      }]);
    }
    return receipt;
  });

  // ---------------------------------------------------------------- collect (the only place ore is minted)
  route('collect', 30, async (user, body, at) => {
    const saved = sessionOf(user, at);
    if (!saved) return { status: 409, error: 'انتهت جلسة المنجم؛ أعد فتح المنجم' };
    const id = typeof body.id === 'string' ? body.id : '';
    const seq = int(body.seq, 0);
    if (!id || id !== saved.sessionId) return { status: 409, error: 'جلسة منجم مختلفة' };
    if (seq < 1) return { status: 400, error: 'رقم تفريغ غير صالح' };

    const digest = crypto.createHash('sha256').update(JSON.stringify(['collect', seq, id])).digest('hex');
    if (saved.lastCollectSeq === seq && saved.lastCollectDigest === digest && saved.lastCollectReceipt) {
      return { ...saved.lastCollectReceipt, duplicate: true };
    }
    if (seq !== int(saved.lastCollectSeq, 0) + 1) return { status: 409, error: 'تعارض تفريغ؛ أعد فتح المنجم' };

    const base = safeSnapshot(saved.snapshot);
    if (!base) return { status: 409, error: 'لا توجد لقطة منجم محفوظة' };
    const state = Rules.hydrate(base);
    const stored = state.warehouse.stored || {};
    const want = {};
    let total = 0;
    for (const ore of ORE_TYPES) {
      const n = Math.max(0, Math.floor(Number(stored[ore]) || 0));
      if (n > 0) { want[ore] = n; total += n; }
    }
    if (!total) return { status: 409, error: 'المخزن فارغ' };

    const budget = oreBudget(saved, at);
    let allowed = Math.min(total, budget.remaining);
    // Partial collection: take ores in a fixed order so the outcome is deterministic.
    const take = {};
    let left = allowed;
    for (const ore of ORE_TYPES) {
      if (!want[ore] || left <= 0) continue;
      const n = Math.min(want[ore], left);
      take[ore] = n;
      left -= n;
    }
    allowed = Object.values(take).reduce((a, b) => a + b, 0);
    if (allowed <= 0) {
      return { status: 429, error: 'بلغت سقف الخام اليومي؛ عُد غداً', budget, snapshot: base };
    }

    // Apply inside the same transaction as the user write: either both land or neither does.
    for (const [ore, n] of Object.entries(take)) {
      const warehouse = state.warehouse;
      warehouse.stored[ore] = Math.max(0, (Math.floor(Number(warehouse.stored[ore])) || 0) - n);
      warehouse.total = Math.max(0, Math.floor(Number(warehouse.total) || 0) - n);
      user.state.ores[ore] = Math.max(0, Math.floor(Number(user.state.ores[ore]) || 0) + n);
    }
    const snapshot = Rules.snapshotOf(state);
    saved.snapshot = snapshot;
    saved.oreCollected = clamp(int(saved.oreCollected, 0) + allowed, 0, DAILY_ORE_CAP);
    saved.lastCollectSeq = seq;
    saved.lastCollectDigest = digest;
    const receipt = {
      collected: take,
      amount: allowed,
      total,
      capped: allowed < total,
      budget: oreBudget(saved, at),
      snapshot,
    };
    saved.lastCollectReceipt = receipt;
    user.revision += 1;
    user.updatedAt = at;
    // The ledger row is the audit trail: no gold moves, only ore, and the row is written
    // inside the user transaction so a crash cannot mint ore without a record.
    await store.appendLedger(user.id, [{
      session: `adv-mine:${saved.sessionId}`,
      seq,
      kind: 'adv_mine_collect',
      goldDelta: 0,
      at,
      detail: { ore: take, capped: receipt.capped, day: dayKey(at) },
    }]);
    await store.putUser(user);
    return receipt;
  });
}

module.exports = { mountAdventureMine, sanitizeOps, sanitizeCommands, safeSnapshot, DAILY_ORE_CAP, SESSION_LIFETIME_MS, ORE_TYPES, STATE_KEY };
