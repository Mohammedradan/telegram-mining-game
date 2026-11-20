'use strict';
/* Stone Mine scene controller.
 *
 * Responsibilities, in order of importance:
 *   1. Turn keyboard / pointer / touch into an *input mask* and a list of discrete
 *      commands. It never edits the world directly.
 *   2. Run a fixed-step simulation locally (StoneMineRules.step) so the mine is playable
 *      while offline, and periodically ship the command log to the server, which replays
 *      it from the last authoritative snapshot. The client cannot mint ore: the server
 *      owns the snapshot, the mission counters and the warehouse totals.
 *   3. Paint the state with AdventureRenderer and mirror it into the DOM HUD at a low,
 *      fixed rate — no DOM writes per frame, no listeners created per frame.
 *
 * Everything is created once in `create()`. `destroy()` removes every listener it added,
 * which is what keeps Telegram tab switches and `visibilitychange` from leaking.
 */
(function (root, factory) {
  // `factory` builds the scene. It is called with a deps object: `{doc, win, rules, map,
  // camera, renderer}`. Node passes them explicitly (so this file is testable headlessly);
  // the browser resolves the globals the page already loaded and exposes `init(hooks)`.
  // `factory(deps)` closes over the deps and returns the module descriptor; the descriptor's
  // own `create(options)` is what builds a scene. Both loaders must therefore return the
  // *scene*, not the descriptor — `create(deps)` used to hand back `{create, …}` and every
  // caller silently got a descriptor instead of a game.
  if (typeof module === 'object' && module.exports) {
    module.exports = { create: (options) => factory(options).create(options) };
  } else {
    root.AdventureScene = {
      create: (options) => factory(options).create(options),
      init: (hooks) => {
        const deps = {
          doc: root.document,
          win: root,
          rules: root.StoneMineRules,
          map: root.StoneMineMap,
          camera: root.AdventureCamera,
          renderer: root.AdventureRenderer,
        };
        return factory(deps).create(Object.assign({}, deps, hooks || {}));
      },
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAdventureScene(deps) {
  const {
    doc, win, rules, map, camera: cameraModule, renderer,
  } = deps || {};

  const INPUT = rules ? rules.INPUT : Object.freeze({});
  // Two commands must never share a tick or the replay cannot tell them apart.
  const COMMAND_SPACING = 2;
  // How many times per second the DOM HUD may be written.
  const HUD_HZ = 8;
  const SYNC_HZ = 0.2;           // one server sync every 5s
  const MAX_OPS = 600;           // hard cap per batch, mirrored by the server

  const KEY_MAP = {
    ArrowLeft: INPUT.LEFT, KeyA: INPUT.LEFT,
    ArrowRight: INPUT.RIGHT, KeyD: INPUT.RIGHT,
    ArrowUp: INPUT.UP, KeyW: INPUT.UP,
    ArrowDown: INPUT.DOWN, KeyS: INPUT.DOWN,
    Space: INPUT.JUMP,
    ShiftLeft: INPUT.RUN, ShiftRight: INPUT.RUN,
    KeyF: INPUT.MINE,
    KeyE: INPUT.INTERACT,
  };

  /** Build the scene for one canvas. `options` (the deps) must carry doc, win and rules. */
  function create(options) {
    const opts = options || {};
    if (!doc || !win || !rules) throw new Error('AdventureScene requires doc, win and rules');
    const reduceMotion = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const canvas = doc.getElementById('adv-canvas');
    const rootEl = doc.getElementById('adv-scene');
    if (!canvas || !rootEl) return null;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;

    const assets = renderer.createAssets();
    const cam = cameraModule && cameraModule.create ? cameraModule.create({}) : null;

    let state = rules.freshState();
    let running = false;
    let paused = true;
    let lastTime = 0;
    let acc = 0;
    let rafId = 0;
    let view = { w: 800, h: 450, dpr: 1 };
    let quality = 'high';
    let backdrop = null;
    let cameraPos = { x: 0, y: 0 };
    let keyboardMask = 0;
    let stickMask = 0;
    let pointerDig = false;
    // Ordered op log: input runs and discrete commands interleaved exactly as they happened.
    // Ordering matters — the server must see `mine_start` at the same point in time the
    // player issued it, not after the whole movement batch.
    let ops = [];
    let lastSyncAt = 0;
    let hudAcc = 0;
    let lastContext = null;
    let lastCommandTick = -99;
    let destroyed = false;
    const listeners = [];
    const now = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());

    // ------------------------------------------------------------------ utilities
    const on = (target, type, handler, opt) => {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, handler, opt);
      // Teardown must never throw: a host page that half-supports the listener API (or a
      // test double) must still be able to destroy the scene without an exception storm.
      listeners.push(() => {
        if (typeof target.removeEventListener === 'function') target.removeEventListener(type, handler, opt);
      });
    };
    const $ = (id) => doc.getElementById(id);
    const setText = (id, text) => {
      const el = $(id);
      if (el && el.textContent !== String(text)) el.textContent = String(text);
    };
    const setHidden = (id, hidden) => {
      const el = $(id);
      if (el && el.hidden !== hidden) el.hidden = hidden;
    };
    // Which `lastEvents` entries are worth interrupting the player for. Everything else is
    // ambient (ore pieces, conveyor moves) and would drown the HUD if it were announced.
    const ANNOUNCE = {
      incident: (e) => [e.title || 'عطل في المنجم', 'warn'],
      machine_broke: (e) => (e.scripted ? null : ['تعطّلت آلة — اقترب منها للإصلاح', 'warn']),
      machine_repaired: () => ['أُصلحت الآلة ✓', 'ok'],
      vein_depleted: () => ['نفد العرق', 'warn'],
      gate_open: (e) => ['انفتح ' + (e.name || 'ممر جديد') + ' ✓', 'ok'],
      mission_complete: () => ['اكتملت المهمة! ✓', 'ok'],
    };

    /** Turn per-tick simulation events into at most one toast per frame. */
    function announce(events) {
      if (!events || !events.length) return;
      for (const event of events) {
        const rule = ANNOUNCE[event.type];
        if (!rule) continue;
        const said = rule(event);
        if (said) toast(said[0], said[1]);
      }
    }

    const toast = (text, tone) => {
      const el = $('adv-status');
      if (!el) return;
      if (el.textContent === text && el.dataset.tone === (tone || 'info')) return;
      el.textContent = text;
      el.dataset.tone = tone || 'info';
      el.classList.remove('is-show');
      // Force a reflow only when the same element is reused, which is at most a few Hz.
      void el.offsetWidth;
      el.classList.add('is-show');
      win.clearTimeout(toast.timer);
      toast.timer = win.setTimeout(() => el.classList.remove('is-show'), 2600);
    };

    // ------------------------------------------------------------------ resizing
    function resize() {
      const rect = rootEl.getBoundingClientRect();
      const w = Math.max(240, Math.round(rect.width || win.innerWidth || 320));
      const h = Math.max(180, Math.round(rect.height || 480));
      const dpr = Math.min(win.devicePixelRatio || 1, 2.5);
      view = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      // Keep the physics viewport in CSS pixels: the renderer scales by dpr itself.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (cam) {
        // Snap on resize: a viewport change is not a walk, and lerping across it would
        // show the camera sliding over the map for a second.
        cameraPos = cam.jumpTo(cameraView());
      }
      // A narrower viewport drops the most expensive ambient effects first.
      quality = w * h > 700000 ? 'high' : w * h > 260000 ? 'mid' : 'low';
      rootEl.dataset.quality = quality;
      backdrop = renderer.makeBackdrop(Math.min(1400, Math.ceil(w * 1.6)), Math.ceil(h), 7);
    }

    // ------------------------------------------------------------------ input
    function recomputeMask() {
      return (keyboardMask | stickMask | (pointerDig ? INPUT.MINE : 0)) & rules.MASK;
    }

    function issue(type, extra, okayText) {
      const command = Object.assign({ type, tick: state.tick }, extra || {});
      if (state.tick - lastCommandTick < COMMAND_SPACING) return null;
      lastCommandTick = state.tick;
      const result = rules.applyCommand(state, command);
      if (result && result.ok) {
        pushOp({ t: 'c', command });
        // A command is applied outside the frame loop, so the events it produces would sit
        // in `lastEvents` until the next step overwrote them. Consume them here or the
        // player never sees the answer to the button they just pressed.
        announce(state.lastEvents.splice(0));
        if (okayText) toast(okayText, 'ok');
      } else if (result && result.reason && result.reason !== 'crew-only') {
        toast(reasonText(result.reason), 'warn');
      }
      hudDirty = true;
      return result;
    }

    function reasonText(reason) {
      switch (reason) {
        case 'out-of-reach': return 'اقترب من العرق أولاً';
        case 'empty': return 'لا يوجد خام هنا';
        case 'bag-full': return 'الحقيبة ممتلئة — فرّغها في المخزن';
        case 'crew-only': return 'هذا العرق مخصص للعامل';
        case 'warehouse-full': return 'المخزن ممتلئ';
        case 'no-ore': return 'الحقيبة فارغة';
        case 'not-near-warehouse': return 'اقترب من المخزن لتفريغ الحقيبة';
        case 'unknown-machine': return 'لا توجد آلة بهذا المعرف';
        case 'unknown-action': return 'أمر غير معروف';
        case 'broken': return 'الآلة معطلة';
        case 'not-idle': return 'العامل مشغول';
        case 'unknown-worker': return 'عامل غير معروف';
        case 'unknown-site': return 'موقع غير معروف';
        case 'out-of-body': return 'ابدأ العمل على الآلة مباشرة';
        default: return '';
      }
    }

    // ------------------------------------------------------------------ op log
    function pushOp(op) {
      const last = ops[ops.length - 1];
      if (op.t === 'i' && last && last.t === 'i' && last.mask === op.mask) {
        last.ticks += op.ticks;
      } else {
        ops.push(op);
      }
      if (ops.length > MAX_OPS) ops.splice(0, ops.length - MAX_OPS);
    }

    /** Drain the log. The host page owns the transport and the retry policy. */
    function takeBatch() {
      if (!ops.length) return null;
      // Never split an input run across two requests: the cut is always at an op boundary.
      const batch = { ops: ops.splice(0, MAX_OPS) };
      return batch;
    }

    /** Replace the local world with the server's. The server always wins. */
    function adoptAuthoritative(snapshot) {
      if (!snapshot) return;
      state = rules.hydrate(snapshot);
      if (cam) cameraPos = cam.jumpTo(cameraView());
      hudDirty = true;
      lastCommandTick = state.tick;
    }

    // ------------------------------------------------------------------ interaction context
    /** What can the player act on right now? Rendering and the context buttons share this. */
    function contextOf() {
      const p = state.player;
      const px = p.x + p.w / 2;
      const py = p.y + p.h;
      const near = (x, y, r) => Math.hypot(px - x, py - y) <= r;
      // Nearest mineable vein.
      let vein = null;
      let bestDist = Infinity;
      for (const spec of map.MAP.deposits) {
        if (spec.crewOnly) continue;
        const saved = state.deposits[spec.id];
        if (!saved || saved.remaining <= 0) continue;
        const d = Math.hypot(px - spec.x, py - (spec.y - 20));
        if (d < rules.REACH + 24 && d < bestDist) { bestDist = d; vein = spec; }
      }
      // Nearest machine.
      let machine = null;
      for (const spec of map.MAP.machines) {
        if (near(spec.x + spec.w / 2, spec.y - spec.h / 2, 90)) { machine = spec; break; }
      }
      const warehouseSpec = map.MAP.machines.find((m) => m.kind === 'warehouse');
      const atWarehouse = warehouseSpec ? near(warehouseSpec.x + warehouseSpec.w / 2, warehouseSpec.y, 96) : false;
      const liftSpec = map.MAP.lift;
      const atLift = near(liftSpec.x + liftSpec.w / 2, state.lift.y, 110);
      let secret = null;
      for (const s of map.MAP.secrets) {
        if (state.secrets.includes(s.id)) continue;
        if (near(s.x, s.y, 70)) { secret = s; break; }
      }
      return { vein, machine, atWarehouse, atLift, secret, px, py };
    }

    function drawTime() {
      return { cam, view, quality, reduced: reduceMotion };
    }

    // ------------------------------------------------------------------ mining
    function startDig() {
      pointerDig = true;
      if (!state.player.mining) issue('mine_start');
    }
    function stopDig() {
      pointerDig = false;
      if (state.player.mining) issue('mine_stop');
    }

    // ------------------------------------------------------------------ lift / machines / crew
    function callLift() {
      const result = issue('lift');
      if (result && result.ok) toast(result.action === 'ride' ? 'المصعد ينزل بك' : 'تم نداء المصعد', 'ok');
    }

    function toggleMachine() {
      const spec = contextOf().machine;
      if (!spec) { toast('اقترب من آلة أولاً', 'warn'); return; }
      const machine = state.machines[spec.id];
      // A broken machine has exactly one legal action. Offering "start" here meant the
      // player pressed the button, the server refused with `broken`, and nothing on screen
      // said how to fix it — the repair command existed but was unreachable.
      let action;
      if (machine.broken) action = 'repair';
      else if (machine.status === 'working' || machine.status === 'starting') action = 'stop';
      else action = 'start';

      const result = issue('machine', { machineId: spec.id, action });
      if (!result || !result.ok) return;
      if (action === 'repair') toast('أُصلحت ' + labelOf(spec) + ' ✓', 'ok');
      else if (action === 'start') toast(labelOf(spec) + ' تعمل', 'ok');
      else toast(labelOf(spec) + ' متوقفة', 'ok');
    }

    function labelOf(spec) {
      switch (spec.kind) {
        case 'drill': return 'الحفارة';
        case 'conveyor': return 'السير الناقل';
        case 'cart': return 'العربة';
        case 'warehouse': return 'المخزن';
        default: return 'الآلة';
      }
    }

    function unload() {
      const result = issue('unload');
      if (!result) return;
      if (result.ok) toast(result.amount ? `خُزّن ${result.amount} خامة (${result.total}/${result.capacity})` : 'الحقيبة فارغة', result.amount ? 'ok' : 'warn');
    }

    function interact() {
      const c = contextOf();
      if (c.secret) { issue('inspect'); return; }
      if (c.machine) { toggleMachine(); return; }
      if (c.atWarehouse) { unload(); return; }
      if (c.atLift) { callLift(); return; }
      if (c.vein) { startDig(); return; }
      toast('لا شيء قريب للتفاعل معه', 'warn');
    }

    // ------------------------------------------------------------------ crew sheet
    function openCrewSheet() {
      const sheet = $('adv-crew-sheet');
      if (!sheet) return;
      sheet.hidden = false;
      paused = true;
      releaseAll();
      renderCrewSheet();
      $('adv-crew-close') && $('adv-crew-close').focus();
    }
    function closeCrewSheet() {
      const sheet = $('adv-crew-sheet');
      if (!sheet || sheet.hidden) return;
      sheet.hidden = true;
      if (running) resume();
      canvas.focus && canvas.focus({ preventScroll: true });
    }
    function renderCrewSheet() {
      const list = $('adv-crew-list');
      const sites = $('adv-site-list');
      if (!list || !sites) return;
      list.textContent = '';
      sites.textContent = '';
      for (const worker of Object.values(state.crew)) {
        const row = doc.createElement('button');
        row.type = 'button';
        row.className = 'adv-crew-row';
        row.dataset.worker = worker.id;
        row.setAttribute('aria-pressed', String(selectedWorker === worker.id));
        const dot = doc.createElement('i');
        dot.className = `adv-dot adv-dot--${worker.status}`;
        const name = doc.createElement('b');
        name.textContent = worker.role === 'miner' ? 'عامل حفر' : worker.role === 'hauler' ? 'عامل نقل' : 'مشغّل';
        const info = doc.createElement('small');
        info.textContent = crewStatusText(worker);
        row.append(dot, name, info);
        row.addEventListener('click', () => { selectedWorker = worker.id; renderCrewSheet(); });
        list.append(row);
      }
      for (const site of map.MAP.crewSites) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'adv-site-row';
        btn.textContent = site.label || site.id;
        const busy = Object.values(state.crew).some((w) => w.site === site.id);
        btn.disabled = !selectedWorker || busy;
        btn.addEventListener('click', () => {
          if (!selectedWorker) return;
          const result = issue('assign_worker', { workerId: selectedWorker, siteId: site.id });
          if (result && result.ok) { toast('تم التكليف — العامل في طريقه', 'ok'); closeCrewSheet(); }
        });
        sites.append(btn);
      }
      $('adv-crew-badge') && ($('adv-crew-badge').hidden = false);
    }
    let selectedWorker = null;

    function crewStatusText(worker) {
      if (worker.status === 'walking') return 'في الطريق…';
      if (worker.status === 'working') return `يعمل ${Math.round((worker.progress || 0) * 100)}%`;
      if (worker.status === 'returning') return 'عائد';
      if (worker.status === 'blocked') return 'متعطل';
      return 'جاهز';
    }

    // ------------------------------------------------------------------ HUD
    let hudDirty = true;
    function paintHud() {
      if (!hudDirty && !state.player.mining) return;
      hudDirty = false;
      const counters = state.mission.counters;
      setText('adv-gold', opts.gold ? opts.gold() : 0);
      setText('adv-energy', opts.energy ? opts.energy() : 0);
      setText('adv-ore', rules.bagTotal(state) + state.warehouse.total);
      setText('adv-level', opts.levelText ? opts.levelText() : 'المستوى 1');
      const pct = opts.xpPercent ? Math.max(0, Math.min(100, Math.round(opts.xpPercent()))) : 0;
      const fill = $('adv-xp-fill');
      if (fill && fill.style.width !== `${pct}%`) fill.style.width = `${pct}%`;
      const track = fill && fill.parentElement;
      if (track) track.setAttribute('aria-valuenow', String(pct));

      // Mission checklist: real counters, nothing inferred.
      const steps = $('adv-quest-steps');
      if (steps) {
        const items = [
          ['mined', 'احفر 3 خامات', Math.min(3, counters.copper + counters.iron + counters.gold + counters.crystal), 3],
          ['assigned', 'كلّف عاملًا بموقع', Math.min(1, counters.assigned), 1],
          ['machinesOn', 'شغّل الحفارة والسير', Math.min(2, counters.machinesOn), 2],
          ['delivered', 'سلّم 10 خامات للمخزن', Math.min(10, counters.delivered), 10],
        ];
        const signature = items.map((i) => `${i[1]}:${i[2]}`).join('|') + state.mission.completed;
        if (steps.dataset.sig !== signature) {
          steps.dataset.sig = signature;
          steps.textContent = '';
          for (const [key, label, value, target] of items) {
            const li = doc.createElement('li');
            li.className = value >= target ? 'is-done' : '';
            const box = doc.createElement('i');
            if (value >= target) box.className = 'is-check';
            const span = doc.createElement('span');
            span.textContent = label;
            const num = doc.createElement('em');
            num.textContent = `${value}/${target}`;
            li.append(box, span, num);
            void key;
            steps.append(li);
          }
        }
      }
      setText('adv-quest-name', state.mission.completed ? 'اكتملت المهمة ✓' : 'أول حمولة');

      // Context buttons: enabled only where the action is genuinely possible.
      const c = contextOf();
      const btnAssign = $('adv-btn-assign');
      const btnMachine = $('adv-btn-machine');
      const btnLift = $('adv-btn-lift');
      const btnUnload = $('adv-btn-unload');
      const btnInspect = $('adv-btn-inspect');
      const mark = (el, active) => {
        if (!el) return;
        const wanted = active ? 'true' : 'false';
        if (el.dataset.on !== wanted) { el.dataset.on = wanted; el.classList.toggle('is-on', active); }
      };
      mark(btnMachine, Boolean(c.machine));
      mark(btnLift, c.atLift);
      mark(btnUnload, c.atWarehouse && rules.bagTotal(state) > 0);
      mark(btnInspect, Boolean(c.secret));
      if (btnInspect) btnInspect.classList.toggle('adv-round--hidden', !c.secret);
      if (btnAssign) {
        const working = Object.values(state.crew).filter((w) => w.site).length;
        btnAssign.dataset.busy = working ? 'true' : 'false';
      }
      // Mining bar: a lossless mirror of the authoritative swing progress.
      const bar = $('adv-minebar');
      const fillEl = $('adv-minebar-fill');
      if (bar && fillEl) {
        const mining = state.player.mining;
        if (mining) {
          const spec = map.MAP.deposits.find((v) => v.id === mining.depositId);
          const ticks = rules.MINE_TICKS[mining.ore] || rules.MINE_TICKS.copper;
          const pctMine = Math.max(0, Math.min(100, Math.round(((mining.ticks || 0) / ticks) * 100)));
          bar.hidden = false;
          fillEl.style.width = `${pctMine}%`;
          setText('adv-minebar-label', spec ? `${oreName(mining.ore)} ${pctMine}%` : `جارٍ التعدين ${pctMine}%`);
        } else if (!bar.hidden) {
          bar.hidden = true;
        }
      }
    }

    function oreName(ore) {
      return ore === 'gold' ? 'ذهب' : ore === 'iron' ? 'حديد' : ore === 'crystal' ? 'بلور' : 'نحاس';
    }

    // ------------------------------------------------------------------ main loop
    function frame(t) {
      if (destroyed) return;
      rafId = win.requestAnimationFrame(frame);
      if (!running) return;
      if (!lastTime) lastTime = t;
      const elapsed = Math.min(0.25, Math.max(0, (t - lastTime) / 1000));
      lastTime = t;
      if (!paused) {
        acc += elapsed;                 // seconds
        const stepSec = 1 / rules.FPS;  // seconds per simulation tick
        let guard = 0;
        while (acc >= stepSec && guard++ < 8) {
          acc -= stepSec;
          const mask = recomputeMask();
          rules.step(state, mask);
          pushOp({ t: 'i', mask, ticks: 1 });
          // Speak the simulation's own output. Until now nothing read `lastEvents`, so a
          // drill could seize and the player would see only a machine that stopped moving.
          // `applyCommand` *appends* to this list rather than replacing it, so entries from
          // an earlier tick survive into the next one; consume them or the stale
          // "it broke" message re-fires on top of the "it's fixed" one.
          announce(state.lastEvents.splice(0));
          if (state.status !== 'playing') { running = false; toast('انتهت الجولة', 'warn'); break; }
        }
        followCamera(elapsed);
        if (ops.length > MAX_OPS * 0.8 && now() - lastSyncAt > 1000 / SYNC_HZ && opts.onBatch) {
          lastSyncAt = now();
          opts.onBatch(takeBatch());
        }
      }
      renderFrame(t);
      hudAcc += elapsed;
      if (hudAcc >= 1 / HUD_HZ) { hudAcc = 0; paintHud(); }
    }

    /** The camera's input contract: where the player is and how big the world is. */
    function cameraView() {
      const p = state.player;
      return {
        x: p.x + p.w / 2,
        y: p.y + p.h,
        w: 0,
        h: 0,
        facing: p.facing || 1,
        worldW: map.WIDTH,
        worldH: map.HEIGHT,
        viewW: view.w,
        viewH: view.h,
      };
    }

    function followCamera(elapsed) {
      if (!cam) return;
      cameraPos = cam.update(cameraView(), elapsed);
    }

    function renderFrame(t) {
      const c = contextOf();
      const cx = c.vein ? c.vein.x : c.machine ? c.machine.x + c.machine.w / 2 : c.secret ? c.secret.x : c.px;
      const cy = c.vein ? c.vein.y - 58 : c.machine ? c.machine.y - c.machine.h - 14 : c.secret ? c.secret.y - 46 : c.py - 52;
      const prompt = state.player.mining ? null : (c.vein || c.machine || c.secret)
        ? { x: cx, y: cy, glyph: c.vein ? '⛏' : c.secret ? '★' : '⚙' }
        : null;
      lastContext = c;
      renderer.draw(ctx, {
        state, map, camera: cameraPos, view, assets, backdrop,
        quality, reduced: reduceMotion, time: t, prompt,
      });
    }

    // ------------------------------------------------------------------ lifecycle
    function resume() {
      if (!running) {
        running = true;
        rafId = win.requestAnimationFrame(frame);
      }
      paused = false;
      lastTime = 0;
      acc = 0;
    }
    function pause() {
      paused = true;
      releaseAll();
    }
    function releaseAll() {
      keyboardMask = 0;
      stickMask = 0;
      if (pointerDig) stopDig();
      pointerDig = false;
      knobReset();
    }
    function knobReset() {
      const knob = $('adv-knob');
      if (knob) knob.style.transform = 'translate(-50%, -50%)';
      const pad = $('adv-pad');
      if (pad) pad.dataset.dir = 'none';
    }

    // ------------------------------------------------------------------ keyboard
    function onKeyDown(event) {
      if (!running) return;
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.code === 'Escape') { closeCrewSheet(); return; }
      if (event.code === 'KeyE' && !event.repeat) {
        event.preventDefault();
        interact();
        return;
      }
      if (event.code === 'KeyF' && !event.repeat) {
        event.preventDefault();
        startDig();
        return;
      }
      const bit = KEY_MAP[event.code];
      if (bit === undefined) return;
      // Space and arrows would scroll the page behind the mine; they never do here.
      event.preventDefault();
      keyboardMask |= bit;
    }
    function onKeyUp(event) {
      const bit = KEY_MAP[event.code];
      if (bit === undefined) return;
      keyboardMask &= ~bit;
      if (event.code === 'KeyF') stopDig();
    }

    // ------------------------------------------------------------------ touch stick
    let stickPointer = null;
    let stickOrigin = 0;
    function stickMove(clientX) {
      if (stickPointer === null) return;
      const dx = clientX - stickOrigin;
      const dir = dx > 14 ? 1 : dx < -14 ? -1 : 0;
      stickMask = dir > 0 ? INPUT.RIGHT : dir < 0 ? INPUT.LEFT : 0;
      if (Math.abs(dx) > 60) stickMask |= INPUT.RUN;
      const knob = $('adv-knob');
      if (knob) knob.style.transform = `translate(calc(-50% + ${Math.max(-1, Math.min(1, dx / 60)) * 26}px), -50%)`;
      const pad = $('adv-pad');
      if (pad) pad.dataset.dir = dir > 0 ? 'right' : dir < 0 ? 'left' : 'none';
    }
    function stickEnd() {
      stickPointer = null;
      stickMask = 0;
      knobReset();
    }

    // ------------------------------------------------------------------ wiring (once)
    on(win, 'resize', resize);
    on(win, 'orientationchange', () => win.setTimeout(resize, 120));
    on(doc, 'keydown', onKeyDown);
    on(doc, 'keyup', onKeyUp);
    on(win, 'blur', () => { releaseAll(); });
    on(doc, 'visibilitychange', () => {
      if (doc.hidden) { pause(); }
    });
    // Losing focus mid-hold must not leave the miner running forever.
    on(canvas, 'pointerdown', () => { if (running) canvas.focus({ preventScroll: true }); });

    const pad = $('adv-pad');
    if (pad) {
      on(pad, 'pointerdown', (e) => {
        stickPointer = e.pointerId;
        stickOrigin = e.clientX;
        pad.setPointerCapture && pad.setPointerCapture(e.pointerId);
        stickMove(e.clientX);
        e.preventDefault();
      });
      on(pad, 'pointermove', (e) => { if (e.pointerId === stickPointer) stickMove(e.clientX); });
      const end = (e) => { if (e.pointerId === stickPointer) stickEnd(); };
      on(pad, 'pointerup', end);
      on(pad, 'pointercancel', end);
      on(pad, 'lostpointercapture', end);
    }
    // Arrow buttons inside the pad work for accessibility and single taps.
    for (const btn of Array.from(doc.querySelectorAll('[data-adv-dir]'))) {
      on(btn, 'pointerdown', (e) => {
        e.stopPropagation();
        stickMask = btn.dataset.advDir === 'right' ? INPUT.RIGHT : INPUT.LEFT;
      });
      on(btn, 'pointerup', () => { stickMask = 0; });
      on(btn, 'pointerleave', () => { stickMask = 0; });
    }

    const bind = (id, type, handler) => {
      const el = $(id);
      if (el) on(el, type, handler);
    };
    bind('adv-jump', 'pointerdown', (e) => {
      e.preventDefault();
      keyboardMask |= INPUT.JUMP;
      win.setTimeout(() => { keyboardMask &= ~INPUT.JUMP; }, 90);
    });
    const digBtn = $('adv-dig');
    if (digBtn) {
      on(digBtn, 'pointerdown', (e) => { e.preventDefault(); startDig(); });
      on(digBtn, 'pointerup', () => stopDig());
      on(digBtn, 'pointercancel', () => stopDig());
      on(digBtn, 'pointerleave', () => stopDig());
      on(digBtn, 'keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); startDig(); } });
      on(digBtn, 'keyup', () => stopDig());
    }
    bind('adv-interact', 'click', (e) => { e.preventDefault(); interact(); });
    bind('adv-btn-machine', 'click', toggleMachine);
    bind('adv-btn-lift', 'click', callLift);
    bind('adv-btn-unload', 'click', unload);
    bind('adv-btn-inspect', 'click', () => issue('inspect'));
    bind('adv-btn-assign', 'click', openCrewSheet);
    bind('adv-crew-close', 'click', closeCrewSheet);
    bind('adv-crew-sheet', 'pointerdown', (e) => { if (e.target && e.target.id === 'adv-crew-sheet') closeCrewSheet(); });
    bind('adv-classic', 'click', () => {
      if (opts.onClassic) opts.onClassic();
    });
    bind('adv-help', 'click', () => {
      const overlay = $('adv-overlay');
      if (overlay) { overlay.hidden = false; pause(); }
    });
    bind('adv-start', 'click', () => {
      const overlay = $('adv-overlay');
      if (overlay) overlay.hidden = true;
      resize();
      resume();
      canvas.focus({ preventScroll: true });
    });
    bind('adv-sound', 'click', (e) => {
      const btn = e.currentTarget;
      const muted = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!muted));
      if (opts.onSound) opts.onSound(!muted);
    });

    // ------------------------------------------------------------------ public API
    const instance = {
      get state() { return state; },
      get context() { return lastContext; },
      get running() { return running; },
      get paused() { return paused; },
      resize, resume, pause, destroy,
      /** Called by the host page when the mining tab becomes visible. */
      show() { resize(); resume(); },
      hide() { pause(); },
      setState: adoptAuthoritative,
      snapshot() { return rules.snapshotOf(state); },
      command(type, extra) { return issue(type, extra); },
      redraw() { renderFrame(now()); },
      takeBatch,
      adoptAuthoritative,
      get pendingOps() { return ops.length; },
      flush() { const batch = takeBatch(); if (batch && opts.onBatch) opts.onBatch(batch); },
    };

    function destroy() {
      destroyed = true;
      paused = true;
      running = false;
      if (rafId) win.cancelAnimationFrame(rafId);
      for (const off of listeners.splice(0)) off();
      releaseAll();
    }

    // Load the art in the background; the vector fallback draws until it arrives.
    assets.load();
    resize();
    // Paint a first frame even before the player presses start, so the world is visible
    // behind the intro panel instead of a black rectangle.
    renderFrame(now());
    if (typeof opts.onReady === 'function') opts.onReady(instance);
    return instance;
  }

  return Object.freeze({ create, COMMAND_SPACING, HUD_HZ, SYNC_HZ });
});
