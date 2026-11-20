(function (root) {
  'use strict';

  function create({
    rules, renderer, canvas, el, document: doc, window: win, getHero, getLoadout, reduced,
    isDuelRunning, effects, clearEffects, collectFx, tickEffects, resetHint, showHint, hideHint, setStatus,
  }) {
    let sim = null, raf = 0, acc = 0, stamp = 0, zone = 0, over = 0, seed = 7717, hero = null;
    let frozen = false, snapshotKind = null, poseTick = 0, hudTick = 0;

    const shown = () => Boolean(canvas && typeof canvas.getContext === 'function'
      && el('tab-arena')?.classList?.contains('active') && !doc.hidden);

    function buildSim() {
      if (!rules?.create) return;
      seed = (seed * 1103515245 + 12345) % 2147483647;
      sim = rules.create(getHero(), seed, { zone, mode: 'duel' });
      hero = getHero();
      over = 0;
      resetHint();
      const player = sim.player, rival = sim.enemies[0];
      if (rival) {
        const minX = Number.isFinite(rival.minX) ? rival.minX : 280;
        const maxX = Number.isFinite(rival.maxX) ? rival.maxX : 460;
        rival.x = Math.max(minX, Math.min(maxX, 380));
        rival.vx = 0;
        player.x = Math.max(24, rival.x - 150);
        player.vx = 0;
      }
    }

    function demoMask(current) {
      const player = current.player, rival = current.enemies[0];
      if (!rival || current.status !== 'playing') return 0;
      let mask = 0;
      const cx = player.x + player.w / 2, rx = rival.x + rival.w / 2;
      if (rival.state === 'windup' && player.guard && player.guard.stamina > 24) {
        if (rival.attack === 'pound') mask |= rules.INPUT.JUMP;
        else if (rival.attack === 'sweep') mask |= rules.INPUT.DEFEND;
        else if (rival.attack === 'charge' && (player.dodge?.cooldown || 0) <= 0) mask |= rules.INPUT.DODGE;
      }
      const incoming = (current.waves || []).some(w => Math.abs((w.x + w.w / 2) - cx) < 120);
      if (incoming && player.grounded) mask |= rules.INPUT.JUMP;
      const d = rx - cx;
      if (Math.abs(d) > 42) mask |= d > 0 ? rules.INPUT.RIGHT : rules.INPUT.LEFT;
      else if (player.attack <= 0 && !player.swing) mask |= (player.heavyCooldown <= 0 && current.tick % 150 > 100) ? rules.INPUT.HEAVY : rules.INPUT.ATTACK;
      return mask;
    }

    function readyHold() {
      return !isDuelRunning() && !frozen
        && doc.body.classList.contains('arena-live')
        && !doc.body.classList.contains('duel-live')
        && !doc.body.classList.contains('arena-more');
    }

    function poseState() {
      if (!sim) return sim;
      poseTick += 1;
      const player = sim.player;
      const enemies = Array.isArray(sim.enemies) ? sim.enemies : [];
      return Object.assign({}, sim, {
        tick: poseTick,
        player: Object.assign({}, player, { state: 'idle', vx: 0, vy: 0, air: false, attack: 0, pose: null }),
        enemies: enemies.map(enemy => Object.assign({}, enemy, { state: 'idle', vx: 0, vy: 0, air: false, attack: 0 })),
      });
    }

    function draw() {
      if (!sim || !canvas) return;
      const fx = effects();
      const drawState = readyHold() ? poseState() : sim;
      try {
        renderer.draw(canvas, drawState, {
          arena: true, reduced, particles: fx.particles, floaters: fx.floaters, shake: fx.shake, beams: [],
        });
      } catch (_) {}
    }

    function hud() {
      if (!sim) return;
      const player = sim.player, rival = sim.enemies[0];
      const heroBar = el('arena-hp-hero'), rivalBar = el('arena-hp-rival');
      if (heroBar) heroBar.style.width = `${Math.max(0, Math.min(100, (player.hearts / Math.max(1, player.maxHearts)) * 100))}%`;
      if (rivalBar && rival) rivalBar.style.width = `${Math.max(0, Math.min(100, (rival.hp / Math.max(1, rival.maxHp)) * 100))}%`;
      const maxSkill = Math.max(1, player.skillMaxCooldown || 1);
      const heroEn = el('arena-en-hero');
      if (heroEn) heroEn.style.width = `${Math.max(0, Math.min(100, 100 - (player.skillCooldown || 0) / maxSkill * 100))}%`;
      const rivalEn = el('arena-en-rival');
      if (rivalEn && rival) rivalEn.style.width = `${Math.max(0, Math.min(100, 100 - (rival.timer || 0) / Math.max(1, rival.ai?.walk || 30) * 100))}%`;
      const timer = el('arena-timer');
      if (timer) timer.textContent = String(Math.max(0, Math.ceil((rules.MAX_TICKS - sim.tick) / rules.FPS)));
      const round = el('arena-round');
      if (round) round.textContent = sim.status === 'playing' ? 'مبارزة' : (sim.status === 'won' ? 'انتصار' : 'خسارة');
    }

    function step() {
      if (!sim) return;
      if (readyHold()) return;
      if (sim.status !== 'playing') {
        if (++over > 90) buildSim();
        return;
      }
      rules.step(sim, demoMask(sim));
      collectFx(sim);
    }

    function frame(now) {
      raf = 0;
      if (!shown() || isDuelRunning()) return;
      const currentStamp = Number(now) || 0;
      const dt = stamp ? Math.min(60, currentStamp - stamp) : 16;
      stamp = currentStamp;
      acc += dt;
      let steps = 0;
      while (acc >= 1000 / (rules.FPS || 60) && steps < 3) {
        if (!frozen) step();
        acc -= 1000 / (rules.FPS || 60);
        steps++;
      }
      tickEffects();
      draw();
      if (++hudTick % 6 === 0) hud();
      raf = win.requestAnimationFrame(frame);
    }

    function snapshot(kind) {
      if (isDuelRunning() || !canvas || typeof canvas.getContext !== 'function' || !rules?.create) return false;
      if (frozen && snapshotKind === kind) { snapshotOff(); return true; }
      hide();
      clearEffects();
      const snapshotZone = kind === 'boss' ? 3 : 2;
      const captured = rules.capture ? rules.capture.sim(kind, getHero(), { loadout: getLoadout() }) : null;
      if (!captured) return false;
      sim = captured;
      zone = snapshotZone;
      hero = getHero();
      frozen = true;
      snapshotKind = kind;
      const label = el('arena-preview-rival');
      if (label) label.textContent = `${sim.enemies[0]?.name || rules.rivalFor?.(zone)?.name || 'المبارز'} · لقطة`;
      const heroLabel = el('arena-preview-hero');
      if (heroLabel) heroLabel.textContent = rules.CHARACTERS?.[hero]?.name || 'المحارب';
      setStatus(kind === 'boss' ? 'لقطة: الزعيم — المرحلة الثانية (مجموعة)' : 'لقطة: موجة الريح قريبة (مجموعة)');
      if (kind === 'boss') showHint(rules.DUEL.phase2Hint, 0); else hideHint();
      draw();
      hud();
      if (!raf) raf = win.requestAnimationFrame(frame);
      return true;
    }

    function snapshotOff() {
      frozen = false;
      snapshotKind = null;
      setStatus('');
      hideHint();
      const label = el('arena-preview-rival');
      if (label) label.textContent = `${rules.rivalFor?.(zone)?.name || 'المبارز'} · ${rules.MINES?.[zone]?.name || ''}`;
      if (!raf) raf = win.requestAnimationFrame(frame);
    }

    function show(requestedZone) {
      if (isDuelRunning() || !canvas || typeof canvas.getContext !== 'function' || !rules?.create) return false;
      const last = (rules.MINES?.length || 1) - 1;
      const nextZone = Math.max(0, Math.min(last, Number.isInteger(requestedZone) ? requestedZone : 0));
      if (frozen) snapshotOff();
      if (nextZone !== zone || hero !== getHero() || !sim) {
        zone = nextZone;
        buildSim();
        clearEffects();
      }
      const label = el('arena-preview-rival');
      if (label) label.textContent = `${rules.rivalFor?.(zone)?.name || 'المبارز'} · ${rules.MINES?.[zone]?.name || ''}`;
      const heroLabel = el('arena-preview-hero');
      if (heroLabel) heroLabel.textContent = rules.CHARACTERS?.[getHero()]?.name || 'المحارب';
      stamp = 0;
      acc = 0;
      draw();
      if (!raf) raf = win.requestAnimationFrame(frame);
      return true;
    }

    function hide() {
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
      stamp = 0;
    }

    function reset(nextZone) {
      sim = null;
      zone = nextZone;
    }

    function inspect() {
      return {
        zone, tick: sim?.tick ?? 0, running: Boolean(raf), rival: sim?.enemies?.[0]?.name || null,
        frozen, snapshot: snapshotKind, rivalState: sim?.enemies?.[0]?.state || null,
        waves: (sim?.waves || []).length,
      };
    }

    return { canvas, show, hide, snapshot, snapshotOff, reset, zone: () => zone, inspect };
  }

  root.PlatformArenaPreview = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
