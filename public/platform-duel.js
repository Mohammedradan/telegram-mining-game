(() => {
  'use strict';

  function create(options) {
    const {
      rules: R, el, renderer, bridge, canvas: arenaCanvas, arenaFx, arenaPreview,
      getHero, getGoal, liveLoadout, request, say, save, setPending, audioUnlock, reduced,
      intentLabel: INTENT_LABEL, showPreview: showArenaPreview, hidePreview: hideArenaPreview,
      setStatus: duelStatusLine,
    } = options;
    const DUEL_KEYMAP = {
      ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, Space: 4, KeyW: 4, ArrowUp: 4,
      KeyJ: 16, Enter: 16, KeyK: 256, KeyL: 128, KeyS: 64, KeyQ: 32, KeyE: 32,
    };
    let duelSim = null, duelTicket = null, duelRaf = 0, duelAcc = 0, duelStamp = 0, duelEndedTick = 0;
    let duelRunning = false, duelPaused = false, duelSubmitting = false, duelZone = 0, duelOver = false;
    let duelInputs = [];
    // تجميد عرض قصير عند الضربة (لا يوقف الإدخال ولا يغيّر المحاكاة الخادمية)
    let duelFreeze = 0, duelLastCombo = 0, duelPendingMask = 0;
    const duelKeys = new Set(), duelPointers = new Map(), duelPulses = new Map();
    const arenaDuelVisible = () => Boolean(el('tab-arena')?.classList?.contains('active'));
    const duelBusy = () => ({
      running: duelRunning, paused: duelPaused, submitting: duelSubmitting, zone: duelZone,
      tick: duelSim?.tick || 0, status: duelSim?.status || 'idle',
      // حقول عرض فقط لشاشة الإيقاف المؤقت (المرحلة C): تُقرأ من المحاكاة ولا تُغذّيها
      hearts: duelSim?.player?.hearts ?? null,
      maxHearts: duelSim?.player?.maxHearts ?? null,
      rivalHp: duelSim?.enemies?.[0]?.hp ?? null,
      rivalMaxHp: duelSim?.enemies?.[0]?.maxHp ?? null,
      timeLeft: duelSim ? Math.max(0, Math.ceil((R.MAX_TICKS - duelSim.tick) / R.FPS)) : null,
    });

    function duelBanner(text) {
      const live = el('arena-live-banner'), t = el('arena-live-text');
      if (!live || !t) return;
      if (!text) { live.hidden = true; return; }
      live.hidden = false; t.textContent = text;
      if (el('arena-resume-btn')) el('arena-resume-btn').hidden = true;
      if (el('arena-abandon-btn')) el('arena-abandon-btn').hidden = true;
    }
    function duelRecord(mask) {
      const prev = duelInputs[duelInputs.length - 1];
      if (prev && prev.mask === mask) prev.frames++;
      else duelInputs.push({ mask, frames: 1 });
    }
    function duelMaskNow() {
      let mask = 0;
      for (const k of duelKeys) mask |= DUEL_KEYMAP[k] || 0;
      for (const v of duelPointers.values()) mask |= v;
      for (const v of duelPulses.values()) mask |= v;
      duelPulses.clear();
      // V13: اتجاه السحب الأفقي يُدمج بعد الأزرار — زرُ جهة يفوز ولا يلغيه السحب
      if (R.padMask) mask = R.padMask({ stick: arenaStick.inspect().dir, bits: [mask] });
      if (duelSim?.player) duelSim.lastMask = mask;
      return mask;
    }
    function duelHeat() {
      const rival = duelSim?.enemies?.[0];
      if (!rival) return 0;
      const left = Math.max(0, rival.hp) / Math.max(1, rival.maxHp);
      return Math.max(0, Math.min(1, 1 - left)); // 0 = بداية المبارزة، 1 = الخصم على وشك السقوط
    }
    function duelDraw() {
      if (!duelSim || !arenaCanvas) return;
      try {
        renderer.draw(arenaCanvas, duelSim, {
          arena: true, arenaId: duelZone % 4, reduced, arenaHeat: duelHeat(),
          ...arenaFx.effects(), beams: [],
        });
      } catch (_) {}
    }
    const duelHud = window.PlatformDuelHud.create({
      rules: R, el, doc: document, win: window,
      getState: () => ({ sim: duelSim, zone: duelZone }),
      getHero: () => getHero(), intentLabel: INTENT_LABEL, setStatus: duelStatusLine,
    });

    function duelFrame(now) {
      duelRaf = 0;
      if (!duelRunning) return;
      if (duelPaused) return;
      if (!arenaDuelVisible() || document.hidden) { duelPaused = true; return; }
      const stamp = Number(now) || 0;
      duelAcc += Math.min(0.1, duelStamp ? (stamp - duelStamp) / 1000 : R.DT);
      duelStamp = stamp;
      let count = 0;
      while (duelAcc >= R.DT && count++ < 6 && duelSim.status === 'playing') {
        // إيقاف إطار قصير عند الإصابة: يجعل الضربة «تُحسّ» بلا أن يمسّ الحتمية (الإدخال يُسجّل، والخادم يعيد التشغيل)
        if (duelFreeze > 0) {
          // أثناء التجميد لا تُقدَّم خطوة ولا تُسجَّل إدخالات، لكن الإدخال يُقرأ ويُحفظ في
          // pending ثم يُضاف للخطوة التالية — فلا تضيع ضغطة خفيفة خلال إطارات التجميد.
          duelPendingMask |= duelMaskNow();
          duelFreeze--; duelAcc -= R.DT; continue;
        }
        const mask = duelMaskNow() | duelPendingMask;
        duelPendingMask = 0;
        if (duelInputs.length >= R.MAX_SEGMENTS && duelInputs[duelInputs.length - 1]?.mask !== mask) break;
        duelRecord(mask);
        R.step(duelSim, mask);
        arenaFx.collect(duelSim, true);
        for (const ev of duelSim.events || []) {
          if (ev.type === 'hit' && ev.damage > 0) duelFreeze = Math.max(duelFreeze, ev.damage >= 2 ? 4 : 2);
          else if (ev.type === 'hurt') duelFreeze = Math.max(duelFreeze, 3);
        }
        // لافتة السلسلة: تُعلن عند العتبات فقط (٣، ٥، …) فوق رأس البطل
        const combo = duelSim.player.combo || 0;
        if (combo >= 3 && combo !== duelLastCombo) {
          const pl = duelSim.player;
          arenaFx.addComboFloater(pl, combo);
        }
        duelLastCombo = combo;
        duelAcc -= R.DT;
      }
      arenaFx.tick();
      duelDraw();
      duelHud.render();
      if (duelSim.status !== 'playing') { duelEndedTick++; if (duelEndedTick > 45) { void duelFinish(); return; } }
      duelRaf = requestAnimationFrame(duelFrame);
    }
    function duelSchedule() {
      if (!duelRunning || duelPaused) return;
      if (duelRaf) cancelAnimationFrame(duelRaf);
      duelRaf = requestAnimationFrame(duelFrame);
    }

    async function startArenaRun(zone) {
      if (duelRunning || duelSubmitting) return false;
      // جولة المنجم لا تمنع المبارزة: لكل وضع حالته وتذكرته الخادمية المستقلة (تبقى جولة المنجم كما هي وتُستأنف لاحقًا)
      const z = Math.max(0, Math.min((R.MINES?.length || 1) - 1, Number.isInteger(zone) ? zone : arenaPreview.zone()));
      hideArenaPreview();
      duelZone = z;
      duelInputs = []; duelKeys.clear(); duelPointers.clear(); duelPulses.clear();
      arenaFx.clearEffects();
      duelAcc = 0; duelStamp = 0; duelOver = false; duelEndedTick = 0;
      duelFreeze = 0; duelLastCombo = 0; duelPendingMask = 0; duelHud.reset();
      duelVerdictHide();
      arenaFx.resetHint();
      duelStatusLine('جارٍ فتح المبارزة…');
      duelBanner('');
      let config = R.normalizeConfig({ zone: z, goal: getGoal(), mode: 'duel', loadout: liveLoadout() });
      try {
        await bridge.ready(); const owner = bridge.user();
        if (owner) {
          const issued = await request('/api/platform/start', { zone: z, goal: getGoal(), mode: 'duel' });
          if (issued.version !== R.VERSION) throw new Error('حدّث الصفحة للحصول على نسخة المستوى الحالية');
          duelTicket = issued;
          config = R.normalizeConfig(issued.config);
          duelZone = config.zone;
        } else {
          duelTicket = null;
          duelStatusLine('تدريب بلا اتصال: لا مكافأة خادمية لهذه المبارزة.');
        }
      } catch (e) {
        duelTicket = null;
        duelStatusLine(`تعذّر فتح المبارزة: ${e.message || 'انقطاع'}. جرّب مجددًا.`);
        duelBanner('');
        return false;
      }
      duelSim = R.create(getHero(), duelTicket?.id ? R.seedFromId(duelTicket.id) : undefined, config);
      duelRunning = true; duelPaused = false;
      document.body.classList.add('duel-live');
      const pad = el('arena-pad'); if (pad) pad.hidden = false;
      audioUnlock();
      duelStatusLine('اقرأ إنذار الخصم: الضربة القريبة تُصدّ، والكاسرة تُقفز أو تُراوغ.');
      duelDraw(); duelHud.render();
      duelSchedule();
      return true;
    }

    async function duelFinish() {
      if (!duelSim || !duelRunning || duelSubmitting || duelOver) return;
      duelOver = true; duelRunning = false;
      if (duelRaf) cancelAnimationFrame(duelRaf);
      duelRaf = 0;
      document.body.classList.remove('duel-live');
      const pad = el('arena-pad'); if (pad) pad.hidden = true;
      const won = duelSim.status === 'won';
      const rival = duelSim.enemies[0];
      duelStatusLine('');
      duelVerdict(won, rival);
      duelBanner(won
        ? `انتصرت على «${rival?.name || 'المبارز'}» — جارٍ التحقق من المكافأة على الخادم…`
        : `سقطت أمام «${rival?.name || 'المبارز'}» — لا مكافأة، والموارد لم تُمسّ.`);
      const payload = { id: duelTicket?.id, inputs: duelInputs, hero: getHero() };
      if (!duelTicket) {
        duelBanner(`${won ? 'انتصار' : 'خسارة'} في مبارزة تدريبية (بلا اتصال) — لا ذهب ولا خبرة.`);
        duelWrapUp();
        return;
      }
      duelSubmitting = true;
      try {
        await bridge.flush();
        const result = await request('/api/platform/finish', payload);
        bridge.adopt(result.profile);
        duelBanner(`${won ? 'انتصرت!' : 'سقطت'} — نتيجتك مؤكدة على الخادم: +${result.gold} ذهب · +${result.xp} خبرة${result.reason === 'daily_cap' ? ' (سقف المبارزات اليومي)' : ''}.`);
        say(`مبارزة موثّقة: ${result.score} نقطة · +${result.gold} ذهب · +${result.xp} خبرة.`);
        window.dispatchEvent(new CustomEvent('platform-duel-result', { detail: { won, receipt: result } }));
      } catch (e) {
        // لا نُهمل نتيجة أبدًا: نبقيها للخادم في تبويب اللعب
        setPending(payload); save(true); el('platform-start').disabled = true;
        duelBanner(`${won ? 'انتصار' : 'خسارة'} — تعذّر تأكيد المكافأة (${e.message || 'انقطاع'}). النتيجة محفوظة محليًا، وتُرسل من تبويب «اللعب» بزر «أعد الإرسال».`);
      } finally {
        duelSubmitting = false;
        duelWrapUp();
      }
    }
    // شارة الحكم: «انتصار» أو «سقوط» فوق المسرح نفسه لحظة الحسم
    function duelVerdict(won, rival) {
      const box = el('arena-ko'), title = el('arena-ko-title'), sub = el('arena-ko-sub');
      if (!box) return;
      box.classList.toggle('loss', !won);
      if (title) title.textContent = won ? 'انتصار' : 'سقوط';
      if (sub) {
        const secs = duelSim ? (duelSim.tick / R.FPS).toFixed(0) : '0';
        sub.textContent = won ? `أُسقط ${rival?.name || 'المبارز'} في ${secs} ثانية` : `${rival?.name || 'المبارز'} صمد ${secs} ثانية`;
      }
      box.hidden = false;
    }
    function duelVerdictHide() { const box = el('arena-ko'); if (box) box.hidden = true; }
    function duelWrapUp() {
      duelTicket = null; duelRunning = false; duelPaused = false;
      duelVerdictHide();
      duelKeys.clear(); duelPointers.clear(); duelPulses.clear(); clearHolds(); stickReset();
      document.body.classList.remove('duel-live');
      const pad = el('arena-pad'); if (pad) pad.hidden = true;
      duelSim = null;
      duelStatusLine('');
      // نُعيد مسرح الاستعراض الحيّ بعد انتهاء المبارزة
      if (arenaDuelVisible()) { arenaPreview.reset(duelZone); showArenaPreview(duelZone); }
      window.dispatchEvent(new CustomEvent('platform-duel-done', { detail: { zone: duelZone } }));
    }
    // خطوة يدوية (للاختبار الآلي ولمُغذّي المتصفح): تُسجّل الإدخال وتُقدّم المحاكاة بلا rAF
    function duelAdvance(mask = 0, frames = 1) {
      if (!duelSim) return null;
      const n = Math.max(1, Math.min(900, Number(frames) || 1));
      for (let i = 0; i < n && duelSim.status === 'playing'; i++) {
        duelRecord(mask);
        R.step(duelSim, mask);
        arenaFx.collect(duelSim, true);
      }
      arenaFx.tick();
      duelDraw(); duelHud.render();
      const snap = {
        status: duelSim.status, tick: duelSim.tick, x: duelSim.player.x, y: duelSim.player.y,
        hearts: duelSim.player.hearts, combo: duelSim.player.combo, guard: duelSim.player.guard?.stamina ?? null,
        rivalHp: duelSim.enemies[0]?.hp ?? null, rivalState: duelSim.enemies[0]?.state ?? null,
        inputs: duelInputs.length, running: duelRunning,
      };
      if (duelSim.status !== 'playing' && duelRunning) {
        duelEndedTick = 46;
        void duelFinish();
      }
      return snap;
    }
    function duelAbandon() {
      if (!duelSim && !duelRunning) return false;
      duelSim = null; duelRunning = false; duelPaused = false; duelTicket = null; duelInputs = [];
      if (duelRaf) cancelAnimationFrame(duelRaf);
      duelRaf = 0;
      document.body.classList.remove('duel-live');
      const pad = el('arena-pad'); if (pad) pad.hidden = true;
      duelStatusLine('');
      window.dispatchEvent(new CustomEvent('platform-duel-done', { detail: { zone: duelZone, abandoned: true } }));
      return true;
    }

    function pauseDuel() {
      if (!duelRunning || duelPaused) return;
      duelPaused = true;
      if (duelRaf) cancelAnimationFrame(duelRaf);
      duelRaf = 0;
    }
    function resumeDuel() {
      if (!duelRunning || !duelPaused) return;
      duelPaused = false; duelStamp = 0; duelAcc = 0;
      duelSchedule();
    }

    // ===== V13: طريقة التحكم — سحب أفقي للحركة (افتراضي) أو الأزرار الثمانية القديمة =====
    // الحركة في المحرك ثنائية، فالسحب الأفقي بمنطقة ميتة يعطي نفس الدقة بلا هدف تُخطئه،
    // ويترك الإبهام اليمنى لأربعة أزرار فعل بدل ثمانية.
    const PAD_MODE_KEY = 'arenaPadMode';
    let padMode = 'stick';
    const stickEl = el('arena-stick');
    const stickKnob = stickEl && typeof stickEl.querySelector === 'function' ? stickEl.querySelector('.as-knob') : null;
    const arenaStick = window.PlatformStick.create({ rules: R, element: stickEl, knob: stickKnob });
    const stickReset = () => arenaStick.reset();
    const stickMove = clientX => arenaStick.move(clientX);
    function applyPadMode(mode) {
      padMode = mode === 'buttons' ? 'buttons' : 'stick';
      if (document.body?.classList) document.body.classList.toggle('pad-stick', padMode === 'stick');
      for (const b of document.querySelectorAll('[data-pad-mode]')) b.setAttribute('aria-pressed', String(b.dataset.padMode === padMode));
      try { localStorage.setItem(PAD_MODE_KEY, padMode); } catch (_) {}
      return padMode;
    }
    (() => {
      let saved = null;
      try { saved = localStorage.getItem(PAD_MODE_KEY); } catch (_) {}
      applyPadMode(saved === 'buttons' ? 'buttons' : 'stick');
      for (const b of document.querySelectorAll('[data-pad-mode]')) b.addEventListener('click', () => applyPadMode(b.dataset.padMode));
    })();
    if (stickEl) {
      stickEl.addEventListener('pointerdown', e => {
        if (!duelRunning || duelPaused) return;
        e.preventDefault();
        arenaStick.begin(e.pointerId, e.clientX);
        stickEl.setPointerCapture?.(e.pointerId);
        stickEl.dataset.active = 'true';
        stickMove(e.clientX);
      });
      stickEl.addEventListener('pointermove', e => { if (arenaStick.matches(e.pointerId)) stickMove(e.clientX); });
      // رفع الإصبع أو فقدانه يُصفّر الحركة فوراً — لا «مشي معلّق» بعد خروج الإبهام
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
        stickEl.addEventListener(type, e => { if (arenaStick.matches(e.pointerId)) stickReset(); });
      stickEl.addEventListener('contextmenu', e => e.preventDefault());
    }
    // الضغط المطوّل على «ضرب» = ضربة قوية واحدة (يُغني عن زر «قوي» في وضع العصا)
    const holdTimers = new Map();
    function clearHold(id) {
      const t = holdTimers.get(id);
      if (t) { clearTimeout(t); holdTimers.delete(id); }
    }
    function clearHolds() { for (const t of holdTimers.values()) clearTimeout(t); holdTimers.clear(); }

    // ===== ربط أدوات تحكم الساحة: أزرار لمس + لوحة مفاتيح، بتعدد لمس مستقل عن لوحة اللعب =====
    const duelButtons = () => document.querySelectorAll('[data-duel-input]');
    for (const button of duelButtons()) {
      button.addEventListener('pointerdown', e => {
        if (!duelRunning || duelPaused) return;
        e.preventDefault();
        const mask = Number(button.dataset.duelInput);
        button.setPointerCapture?.(e.pointerId);
        duelPointers.set(e.pointerId, mask);
        // V11.1: نبضة إطار واحد لكل زر فعل (قفز/ضرب/مهارة/صدّ/مراوغة/ثقيل) — لمسة أسرع من
        // إطار واحد كانت تُفقد قبل أن تُقرأ. الحركة تبقى حالة مستمرة لا نبضة.
        const ACTION_BITS = R.INPUT.JUMP | R.INPUT.ATTACK | R.INPUT.SKILL | R.INPUT.DEFEND | R.INPUT.DODGE | R.INPUT.HEAVY;
        if (mask & ACTION_BITS) duelPulses.set(`d:${e.pointerId}`, mask & ACTION_BITS);
        button.dataset.down = 'true';
        // V13: إبقاء الإصبع على «ضرب» (وضع العصا) يحوّل الضربة التالية إلى قوية بدل زر مستقل
        if (padMode === 'stick' && button.dataset.holdHeavy === 'true') {
          clearHold(e.pointerId);
          holdTimers.set(e.pointerId, setTimeout(() => {
            holdTimers.delete(e.pointerId);
            if (!duelPointers.has(e.pointerId) || !duelRunning || duelPaused) return;
            duelPulses.set(`h:${e.pointerId}`, R.INPUT.HEAVY);
            button.dataset.charge = 'true';
          }, R.PAD?.heavyHoldMs || 260));
        }
      });
      const release = e => {
        duelPointers.delete(e.pointerId);
        clearHold(e.pointerId);
        button.dataset.charge = 'false';
        button.dataset.down = String([...duelPointers.values()].includes(Number(button.dataset.duelInput)));
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
      button.addEventListener('contextmenu', e => e.preventDefault());
      button.addEventListener('touchend', e => e.preventDefault(), { passive: false });
    }
    window.addEventListener('keydown', e => {
      if (!duelRunning || duelPaused) return;
      if (!arenaDuelVisible() || !DUEL_KEYMAP[e.code]) return;
      if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
      e.preventDefault();
      const mask = DUEL_KEYMAP[e.code];
      if (!e.repeat) duelPulses.set(`k:${e.code}`, mask);
      duelKeys.add(e.code);
    });
    window.addEventListener('keyup', e => { duelKeys.delete(e.code); });
    window.addEventListener('blur', () => { duelKeys.clear(); duelPointers.clear(); clearHolds(); stickReset(); pauseDuel(); });


    return {
      startArenaRun, duelBusy, pauseDuel, resumeDuel, duelAdvance, duelAbandon,
      padMode: () => padMode, setPadMode: applyPadMode, stickState: () => arenaStick.inspect(),
      duelInspect: () => ({ ...duelBusy(), rival: duelSim?.enemies?.[0]?.name || null, hearts: duelSim?.player?.hearts ?? null, inputs: duelInputs.length }),
      startDuel(zone = 0) {
        if (duelRunning || duelSubmitting) return false;
        void startArenaRun(Number.isInteger(zone) ? zone : arenaPreview.zone());
        return true;
      },
    };
  }

  window.PlatformDuel = { create };
})();
