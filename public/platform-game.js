/* One scene controller, one fixed-step RAF, one set of input listeners. */
(() => {
  'use strict';
  if (window.PlatformGame) return;
  const R = window.PlatformRules, renderer = window.PlatformRenderer, bridge = window.PlatformBridge;
  const el = id => document.getElementById(id);
  const canvas = el('platform-canvas');
  if (!canvas || !R || !renderer || !bridge) return;

  let currentHero = 'miner';
  try {
    const savedHero = localStorage.getItem('platform-hero');
    if (savedHero && R.CHARACTERS?.[savedHero]) currentHero = savedHero;
  } catch (_) {}

  let sim = R.create(currentHero), inputs = [], ticket = null, owner = null;
  // تخطيط المرحلة يتبع بذرة الجولة المشتقة من معرّف تذكرة الخادم (الخادم يعيد التشغيل بالبذرة نفسها)
  const seedOf = (t) => (t?.id ? R.seedFromId(t.id) : undefined);
  let running = false, paused = false, starting = false, restoring = true, submitting = false, pending = null;
  let raf = 0, last = 0, accumulator = 0;
  let audio = null, muted = false, particles = [];
  const keys = new Set(), pointers = new Map();
  const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  try { muted = localStorage.getItem('platform-muted') === 'true'; } catch (_) {}

  const keyMap = {
    ArrowLeft: 1, KeyA: 1,
    ArrowRight: 2, KeyD: 2,
    Space: 4, ArrowUp: 4, KeyW: 4,
    KeyE: 8, KeyX: 8,
    KeyF: 16, KeyJ: 16, KeyZ: 16,
    KeyQ: 32, KeyK: 32, KeyC: 32,
  };

  const storageKey = () => `platform-run:v1:${owner}`;
  const say = text => { el('platform-status').textContent = text; };
  const visible = () => !document.hidden && !el('platform-scene').hidden && el('play-panel-adventure').classList.contains('active') && el('tab-play').classList.contains('active');
  const draw = () => renderer.draw(canvas, sim, { reduced, particles });

  function clearInput() {
    keys.clear(); pointers.clear();
    document.querySelectorAll('[data-platform-input]').forEach(b => { b.dataset.down = 'false'; });
  }

  function audioUnlock() {
    if (muted) return;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!audio && AC) audio = new AC(); audio?.resume()?.catch(() => {}); } catch (_) {}
  }

  function beep(type) {
    if (muted || !audio || audio.state !== 'running') return;
    try {
      const frequencies = {
        jump: 420, land: 75, mine: 150, attack: 520, hit: 680,
        enemy_death: 240, skill: 780, collect: 840, hurt: 90, win: 1040, game_over: 120,
      };
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = (type === 'mine' || type === 'hurt' || type === 'enemy_death') ? 'triangle' :
               (type === 'attack' || type === 'hit') ? 'sawtooth' : 'sine';
      const baseFreq = frequencies[type] || 300;
      o.frequency.setValueAtTime(baseFreq, audio.currentTime);
      if (type === 'jump') o.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, audio.currentTime + 0.1);
      else if (type === 'hurt' || type === 'game_over') o.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, audio.currentTime + 0.15);
      else if (type === 'win') o.frequency.exponentialRampToValueAtTime(baseFreq * 1.8, audio.currentTime + 0.2);
      else o.frequency.exponentialRampToValueAtTime(baseFreq * 1.2, audio.currentTime + 0.08);

      g.gain.setValueAtTime(0.045, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.14);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.15);
    } catch (_) {}
  }

  function save(finished = false) {
    if (!ticket || !owner || (!running && !pending)) return;
    try { localStorage.setItem(storageKey(), JSON.stringify({ version: R.VERSION, ticket, inputs, hero: currentHero, finished })); }
    catch (_) { say('التخزين المحلي غير متاح؛ لا تغلق الصفحة قبل تأكيد الخادم للنتيجة.'); }
  }

  function hud() {
    const fullHearts = Math.max(0, sim.player.hearts);
    const emptyHearts = Math.max(0, (sim.player.maxHearts || 3) - fullHearts);
    el('platform-hearts').textContent = '♥ '.repeat(fullHearts) + (emptyHearts > 0 ? '♡ '.repeat(emptyHearts) : '') || 'انتهت القلوب';
    el('platform-resources').textContent = `💎 ${Math.min(3, sim.collected)}/3 · ⛏ ${Math.min(1, sim.mined)}/1 · 👾 ${sim.defeated || 0}`;
    el('platform-progress').textContent = `${(R.ZONES[sim.zone] || R.ZONES[0]).name} · ${sim.status === 'won' ? 100 : Math.min(99, Math.floor(sim.player.x / R.LEVEL.exit.x * 100))}% · ${Math.ceil((R.MAX_TICKS - sim.tick) / R.FPS)}ث`;

    // Skill button cooldown label
    const skillBtn = document.querySelector('[data-platform-input="32"]');
    if (skillBtn) {
      const label = skillBtn.querySelector('span');
      if (label) label.textContent = sim.player.skillCooldown > 0 ? `${(sim.player.skillCooldown / R.FPS).toFixed(1)}ث` : 'قوة';
      skillBtn.style.opacity = sim.player.skillCooldown > 0 ? '0.6' : '1';
    }
  }

  function overlay(title, text, resume = false) {
    el('platform-overlay').hidden = false;
    el('platform-title').textContent = title;
    el('platform-message').textContent = text;
    el('platform-resume').hidden = !resume;
    el('platform-start').textContent = running ? 'إعادة من البداية' : 'جولة جديدة';
  }

  function pause() {
    clearInput();
    if (!running || paused) return;
    paused = true; cancelAnimationFrame(raf); raf = 0;
    save(); audio?.suspend?.()?.catch(() => {});
    overlay('استراحة عند المصباح', 'الجولة متوقفة. لن تتقدم الفيزياء أو الوقت أثناء مغادرتك. تابع عندما تكون جاهزًا.', true);
    draw();
  }

  function schedule() { if (!raf && running && !paused && visible()) raf = requestAnimationFrame(frame); }

  function resume() {
    if (!running || !visible()) return;
    paused = false; clearInput(); accumulator = 0; last = 0;
    el('platform-overlay').hidden = true; audioUnlock(); schedule(); canvas.focus({ preventScroll: true });
  }

  function record(mask) {
    const previous = inputs[inputs.length - 1];
    if (previous && previous.mask === mask) previous.frames++;
    else inputs.push({ mask, frames: 1 });
  }

  function consumeEvents() {
    for (const event of sim.events) {
      beep(event.type);
      if (!reduced) {
        if (event.type === 'mine') {
          for (let i = 0; i < 7; i++) particles.push({ x: event.x, y: event.y, vx: (i - 3) * 0.7, vy: -1.2 - (i % 3) * 0.4, life: 25, color: '#9fb3b8', size: 3 });
        } else if (event.type === 'collect') {
          for (let i = 0; i < 8; i++) particles.push({ x: event.x, y: event.y, vx: (i - 4) * 0.6, vy: -1.5 - (i % 3) * 0.5, life: 30, color: '#5cf3d2', size: 4 });
        } else if (event.type === 'attack') {
          for (let i = 0; i < 4; i++) particles.push({ x: event.x + (event.facing > 0 ? 30 : -10), y: event.y + 15, vx: event.facing * (1 + i * 0.5), vy: -0.5, life: 15, color: '#ffeaa7', size: 3 });
        } else if (event.type === 'hit') {
          for (let i = 0; i < 8; i++) particles.push({ x: event.x, y: event.y, vx: (i - 4) * 0.8, vy: -1.5 - (i % 3), life: 22, color: '#ff9f43', size: 4 });
        } else if (event.type === 'enemy_death') {
          for (let i = 0; i < 12; i++) particles.push({ x: event.x, y: event.y, vx: (i - 6) * 0.9, vy: -2 - (i % 4), life: 35, color: '#a55eea', size: 5 });
        } else if (event.type === 'skill') {
          for (let i = 0; i < 14; i++) particles.push({ x: event.x, y: event.y + 20, vx: (i - 7) * 1.2, vy: -1.8 - (i % 3), life: 30, color: '#e056fd', size: 5 });
        } else if (event.type === 'hurt') {
          for (let i = 0; i < 8; i++) particles.push({ x: event.x, y: event.y, vx: (i - 4) * 0.65, vy: -1 - (i % 3), life: 30, color: '#ff6b6b', size: 4 });
        } else if (event.type === 'land') {
          for (let i = 0; i < 5; i++) particles.push({ x: event.x + (i - 2) * 5, y: event.y, vx: (i - 2) * 0.5, vy: -0.4, life: 15, color: '#7f8c8d', size: 2.5 });
        } else if (event.type === 'win') {
          for (let i = 0; i < 16; i++) particles.push({ x: event.x, y: event.y, vx: (i - 8) * 0.8, vy: -2.5 - (i % 4), life: 45, color: i % 2 === 0 ? '#ffd32a' : '#0be881', size: 4 });
        }
      }
    }
    particles = particles.slice(-96);
    for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life--; }
    particles = particles.filter(p => p.life > 0);
  }

  function frame(time) {
    raf = 0;
    if (!running || paused) return;
    if (!visible()) { pause(); return; }
    if (!last) last = time;
    accumulator += Math.min(0.1, (time - last) / 1000); last = time;
    let count = 0;
    while (accumulator >= R.DT && count++ < 6 && sim.status === 'playing') {
      let mask = 0;
      for (const key of keys) mask |= keyMap[key] || 0;
      for (const value of pointers.values()) mask |= value;
      if (inputs.length >= 1000 && inputs[inputs.length - 1].mask !== mask) {
        pause(); say('وصلت إلى حد تسجيل الحركات؛ أعد بدء الجولة.'); return;
      }
      record(mask); R.step(sim, mask); consumeEvents(); accumulator -= R.DT;
      if (sim.tick % 120 === 0) save();
    }
    hud(); draw();
    if (sim.status !== 'playing') { finish(); return; }
    schedule();
  }

  async function request(path, body) {
    const options = { method: 'POST', body: JSON.stringify(body || {}) };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) options.signal = AbortSignal.timeout(15000);
    return bridge.request(path, options);
  }

  async function submit() {
    if (!pending || submitting) return;
    submitting = true; el('platform-retry').hidden = true; el('platform-discard').hidden = true;
    say('جارٍ إعادة محاكاة الجولة وتأكيد المكافأة على الخادم…');
    try {
      await bridge.flush();
      const result = await request('/api/platform/finish', pending);
      bridge.adopt(result.profile);
      el('platform-title').textContent = result.won ? 'وصلت إلى قلب المنجم!' : 'انتهت الجولة — جرّب من جديد';
      el('platform-message').textContent = `${result.gems} بلورات · ${result.mined} صخور · ${Math.floor(result.duration)} ثانية. نتيجتك مؤكدة ومحفوظة؛ +${result.gold} ذهب افتراضي. يمكنك بدء رحلة جديدة.`;
      pending = null; ticket = null;
      try { localStorage.removeItem(storageKey()); } catch (_) {}
      say(`محفوظ على الخادم: ${result.score} نقطة · +${result.gold} ذهب افتراضي · +${result.xp} خبرة${result.duplicate ? ' — تأكيد سابق، بلا مكافأة مكررة' : ''}${result.reason === 'cooldown' ? ' — مهلة المكافأة: 20 ثانية بين جائزتي مغامرة' : ''}`);
      el('platform-start').disabled = false;
    } catch (e) {
      say(`${e.message || 'انقطع الاتصال'}. النتيجة محفوظة محليًا؛ أعد الإرسال، ولا تبدأ حسابًا آخر.`);
      el('platform-retry').hidden = false; el('platform-discard').hidden = false;
    } finally { submitting = false; }
  }

  function finish() {
    if (!running) return;
    running = false; paused = false; clearInput(); cancelAnimationFrame(raf); raf = 0;
    const won = sim.status === 'won';
    overlay(won ? 'وصلت إلى قلب المنجم!' : 'المصباح ينتظر عودتك', `${sim.collected} بلورات · ${sim.mined} صخور · أعداء ${sim.defeated || 0} · ${Math.floor(sim.tick / R.FPS)} ثانية. ${won ? 'أحسنت! تجاوزت الحفر والأخطار وهزمت الوحوش.' : 'راقب ضربات الوحوش واقفز قبل الحفر. استخدم زر الهجوم (⚔️) أو المهارة (💥) للدفاع عن نفسك.'}`);
    hud(); draw();
    if (ticket) {
      pending = { id: ticket.id, inputs, hero: currentHero }; save(true); el('platform-start').disabled = true; submit();
    } else say('جولة تدريبية بلا اتصال: لا ذهب ولا مكافأة محلية. أعد المحاولة متصلًا للحفظ الخادمي.');
  }

  function setHero(heroId) {
    if (!R.CHARACTERS?.[heroId] || heroId === currentHero) return;
    currentHero = heroId;
    try { localStorage.setItem('platform-hero', currentHero); } catch (_) {}
    document.querySelectorAll('.mine-hero-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.hero === currentHero);
      btn.setAttribute('aria-selected', String(btn.dataset.hero === currentHero));
    });
    if (!running) {
      sim = R.create(currentHero, seedOf(ticket));
      hud(); draw();
    }
  }

  async function start() {
    if (starting || restoring || submitting || pending) return;
    starting = true; el('platform-start').disabled = true; clearInput(); cancelAnimationFrame(raf); raf = 0;
    bridge.pauseLegacy(); audioUnlock();
    try {
      await bridge.ready(); owner = bridge.user();
      if (owner) {
        ticket = await request('/api/platform/start');
        if (ticket.version !== R.VERSION) throw new Error('حدّث الصفحة للحصول على نسخة المستوى الحالية');
        say(`الهدف: 3 بلورات وصخرة واحدة، ثم بوابة الخروج. ${R.CHARACTERS[currentHero]?.name || 'عامل المنجم'} — تحرّك، اقفز، وعدّن بحكمة.`);
      } else { ticket = null; say('تدريب بلا اتصال — لا مكافأة. يمكنك اللعب ثم إعادة المحاولة متصلًا.'); }
      sim = R.create(currentHero, seedOf(ticket)); inputs = []; particles = []; running = true; paused = false; save();
      resume();
    } catch (e) { say(`تعذّر بدء الجولة: ${e.message}. جرّب مجددًا عند الاتصال.`); }
    finally { starting = false; el('platform-start').disabled = Boolean(pending); }
  }

  async function restore() {
    await bridge.ready(); owner = bridge.user(); if (!owner) return;
    let stored;
    try { stored = JSON.parse(localStorage.getItem(storageKey()) || 'null'); } catch (_) { return; }
    if (!stored || stored.version !== R.VERSION || !stored.ticket?.id) return;
    if (stored.hero && R.CHARACTERS?.[stored.hero]) currentHero = stored.hero;
    const replay = stored.inputs?.length ? R.replay(stored.inputs, currentHero, seedOf(stored.ticket)) : { ok: true, state: R.create(currentHero, seedOf(stored.ticket)) };
    if (!replay.ok) { say('ملف جولة غير صالح؛ يمكنك البدء مجددًا.'); return; }
    ticket = stored.ticket; inputs = stored.inputs || []; sim = replay.state;
    hud(); draw();
    if (sim.status !== 'playing') {
      pending = { id: ticket.id, inputs, hero: currentHero }; el('platform-start').disabled = true;
      overlay(sim.status === 'won' ? 'استرجاع نتيجة جولتك' : 'جولة سابقة انتهت', 'جارٍ استرجاع تأكيد الخادم. إعادة الطلب لا تضاعف الجائزة.');
      submit();
    } else if (sim.status === 'playing') {
      try {
        const current = await request('/api/platform/start');
        if (current.id !== ticket.id) { ticket = null; say('انتهت صلاحية الحفظ السابق؛ ابدأ جولة جديدة.'); return; }
        running = true; paused = false; pause();
      } catch (_) { say('حفظ سابق موجود؛ أعد فتح الصفحة بعد عودة الاتصال لاستئنافه.'); }
    }
  }

  function showLegacy() {
    pause(); el('platform-scene').hidden = true; el('legacy-adventure').hidden = false;
    el('platform-mode').setAttribute('aria-pressed', 'false'); el('legacy-mode').setAttribute('aria-pressed', 'true');
    if (typeof resizeAdventureCanvas === 'function') resizeAdventureCanvas();
  }

  function showPlatform() {
    bridge.pauseLegacy(); el('legacy-adventure').hidden = true; el('platform-scene').hidden = false;
    el('platform-mode').setAttribute('aria-pressed', 'true'); el('legacy-mode').setAttribute('aria-pressed', 'false'); draw();
  }

  for (const button of document.querySelectorAll('[data-platform-input]')) {
    button.addEventListener('pointerdown', e => {
      e.preventDefault(); if (!running || paused) return;
      audioUnlock(); button.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId, Number(button.dataset.platformInput)); button.dataset.down = 'true';
    });
    const release = e => { pointers.delete(e.pointerId); button.dataset.down = 'false'; };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
    button.addEventListener('contextmenu', e => e.preventDefault());
  }

  document.querySelectorAll('.mine-hero-btn').forEach(btn => {
    btn.addEventListener('click', () => setHero(btn.dataset.hero));
  });

  window.addEventListener('keydown', e => {
    if (!visible() || !keyMap[e.code] || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    e.preventDefault(); if (running && !paused) keys.add(e.code);
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); });
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { save(Boolean(pending)); pause(); });
  window.addEventListener('online', () => { if (pending) submit(); });
  window.addEventListener('resize', draw);
  el('platform-start').addEventListener('click', start);
  el('platform-resume').addEventListener('click', resume);
  el('platform-pause').addEventListener('click', () => { if (paused) resume(); else pause(); });
  el('platform-retry').addEventListener('click', submit);
  el('platform-discard').addEventListener('click', () => {
    if (submitting || !pending || !confirm('إلغاء النتيجة المحلية المعلقة؟ قد تفقد جولة لم يؤكدها الخادم. أي مكافأة حُفظت خادميًا تبقى محفوظة ولا تُمنح مرتين.')) return;
    pending = null; ticket = null;
    try { localStorage.removeItem(storageKey()); } catch (_) {}
    el('platform-start').disabled = false; el('platform-retry').hidden = true; el('platform-discard').hidden = true;
    say('أُلغي الحفظ المحلي المعلق فقط. يمكنك بدء جولة جديدة؛ أرصدة الخادم لم تُحذف.');
  });
  el('platform-mode').addEventListener('click', showPlatform); el('legacy-mode').addEventListener('click', showLegacy);
  el('platform-menus').addEventListener('click', showLegacy);
  el('platform-mute').setAttribute('aria-pressed', String(muted)); el('platform-mute').textContent = muted ? 'صوت ×' : 'صوت ✓';
  el('platform-mute').addEventListener('click', () => {
    muted = !muted; el('platform-mute').setAttribute('aria-pressed', String(muted)); el('platform-mute').textContent = muted ? 'صوت ×' : 'صوت ✓';
    try { localStorage.setItem('platform-muted', String(muted)); } catch (_) {}
    if (muted) audio?.suspend?.()?.catch(() => {}); else audioUnlock();
  });

  window.PlatformGame = {
    pause, showLegacy, showPlatform, setHero,
    inspect: () => ({
      tick: sim.tick, status: sim.status, pose: sim.player.pose,
      x: sim.player.x, y: sim.player.y, gems: sim.collected, mined: sim.mined,
      hearts: sim.player.hearts, running, paused, scheduled: Boolean(raf),
      ticket: ticket?.id, pending: Boolean(pending), hero: sim.player.hero,
      defeated: sim.defeated,
    }),
  };

  el('platform-start').disabled = true;
  draw(); restore().catch(() => say('تعذّر استرجاع الجولة؛ يمكنك بدء رحلة جديدة.')).finally(() => { restoring = false; el('platform-start').disabled = Boolean(pending); });
})();
