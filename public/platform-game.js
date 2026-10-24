/* Professional 2D platformer controller — 60Hz fixed step, shake, rich particles, secure replay, responsive input */
(() => {
  'use strict';
  if (window.PlatformGame) return;
  let R = window.PlatformRules;
  const currentRules = R;
  const renderer = window.PlatformRenderer, bridge = window.PlatformBridge;
  const el = id => document.getElementById(id);
  const canvas = el('platform-canvas');
  if (!canvas || !R || !renderer || !bridge) return;

  let currentHero = 'miner';
  try {
    const savedHero = localStorage.getItem('platform-hero');
    if (savedHero && R.CHARACTERS?.[savedHero]) currentHero = savedHero;
  } catch (_) {}

  let sim = R.create(currentHero), inputs = [], ticket = null, owner = null;
  const seedOf = (t) => (t?.id ? R.seedFromId(t.id) : undefined);
  let running = false, paused = false, starting = false, restoring = true, submitting = false, pending = null;
  let raf = 0, last = 0, accumulator = 0;
  let audio = null, muted = false, particles = [], shake = 0;
  const keys = new Set(), pointers = new Map();
  // Preserve a quick jump/mine tap until one simulation step consumes it. Sources
  // are separate so cancelling a finger cannot erase a keyboard or another finger.
  const pulses = new Map();
  const queueAction = (source, mask) => { if (mask & 12) pulses.set(source, mask & 12); };
  function releasePointer(id, cancelled = false) {
    if (cancelled) pulses.delete(`pointer:${id}`);
    pointers.delete(id);
    document.querySelectorAll('[data-platform-input]').forEach(b => {
      b.dataset.down = String([...pointers.values()].includes(Number(b.dataset.platformInput)));
    });
  }
  const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const volume = 1; // master gain for the synthesised effects (0 mutes)
  let feedbackUntil = 0, observedCheckpoint = sim.checkpoint, observedMined = sim.mined;
  let learnedJump = false;
  function feedback(text) {
    const box = el('platform-feedback');
    if (!box) return;
    box.textContent = text; box.hidden = false;
    feedbackUntil = sim.tick + 150;
  }
  function resetFeedback() {
    feedbackUntil = 0; observedCheckpoint = sim.checkpoint; observedMined = sim.mined;
    const box = el('platform-feedback'); if (box) box.hidden = true;
  }
  try { muted = localStorage.getItem('platform-muted') === 'true'; } catch (_) {}

  const keyMap = {
    ArrowLeft: 1, KeyA: 1,
    ArrowRight: 2, KeyD: 2,
    Space: 4, ArrowUp: 4, KeyW: 4,
    KeyE: 8, KeyX: 8,
    KeyF: 16, KeyJ: 16, KeyZ: 16,
    KeyQ: 32, KeyK: 32, KeyC: 32,
  };

  // Virtual Joystick State
  let joystickActive = false;
  let joystickX = 0; // -1 to 1
  let joystickY = 0; // -1 to 1
  let joystickPointerId = null;

  const storageKey = () => `platform-run:v1:${owner}`;
  const say = text => { const s = el('platform-status'); if (s) s.textContent = text; };
  const visible = () => !document.hidden && !el('platform-scene').hidden && el('play-panel-adventure').classList.contains('active') && el('tab-play').classList.contains('active');
  const draw = () => renderer.draw(canvas, sim, { reduced, particles, shake });

  function clearInput() {
    keys.clear(); pointers.clear(); pulses.clear();
    document.querySelectorAll('[data-platform-input]').forEach(b => { b.dataset.down = 'false'; });
    // Reset analog input whenever the game pauses or resumes. A hidden tab can
    // miss pointerup, otherwise leaving the player walking after returning.
    joystickActive = false; joystickX = 0; joystickY = 0; joystickPointerId = null;
    const handle = el('virtual-joystick')?.querySelector('.joystick-handle');
    if (handle) handle.style.transform = 'translate(-50%, -50%)';
  }

  function audioUnlock() {
    if (muted) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!audio && AC) audio = new AC();
      audio?.resume()?.catch(() => {});
    } catch (_) {}
  }

  // Richer sound synthesis with per-event timbres
  function beep(type) {
    if (muted || volume === 0 || !audio || audio.state !== 'running') return;
    try {
      const defs = {
        jump: { freq: 440, dur: 0.14, type: 'sine', slide: 660 },
        land: { freq: 90, dur: 0.12, type: 'triangle', slide: 70 },
        mine: { freq: 160, dur: 0.11, type: 'triangle', slide: 220 },
        mine_miss: { freq: 120, dur: 0.08, type: 'triangle', slide: 90 },
        attack: { freq: 520, dur: 0.12, type: 'sawtooth', slide: 380 },
        hit: { freq: 720, dur: 0.10, type: 'sawtooth', slide: 480 },
        enemy_death: { freq: 280, dur: 0.22, type: 'triangle', slide: 120 },
        skill: { freq: 780, dur: 0.18, type: 'sine', slide: 1050 },
        collect: { freq: 880, dur: 0.13, type: 'sine', slide: 1220 },
        hurt: { freq: 110, dur: 0.18, type: 'sawtooth', slide: 55 },
        win: { freq: 1040, dur: 0.22, type: 'sine', slide: 1560 },
        game_over: { freq: 140, dur: 0.32, type: 'triangle', slide: 70 },
      };
      const d = defs[type] || { freq: 300, dur: 0.12, type: 'sine', slide: 360 };
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = d.type;
      o.frequency.setValueAtTime(d.freq, audio.currentTime);
      if (d.slide) o.frequency.exponentialRampToValueAtTime(d.slide, audio.currentTime + d.dur * 0.7);
      g.gain.setValueAtTime(0.055, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d.dur);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + d.dur);
      // second harmonic for win/collect
      if (type === 'win' || type === 'collect') {
        const o2 = audio.createOscillator(), g2 = audio.createGain();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(d.freq * 1.5, audio.currentTime);
        o2.frequency.exponentialRampToValueAtTime(d.slide * 1.5, audio.currentTime + d.dur);
        g2.gain.setValueAtTime(0.022, audio.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d.dur);
        o2.connect(g2); g2.connect(audio.destination);
        o2.start(); o2.stop(audio.currentTime + d.dur);
      }
    } catch (_) {}
  }

  function doShake(intensity) {
    if (!reduced) shake = Math.max(shake, intensity);
  }

  function haptic(kind) {
    try {
      const tg = window.Telegram?.WebApp?.HapticFeedback;
      if (tg) {
        if (kind === 'hurt') tg.notificationOccurred('error');
        else if (kind === 'win') tg.notificationOccurred('success');
        else tg.impactOccurred(kind === 'heavy' ? 'heavy' : 'light');
      } else if (navigator.vibrate) {
        navigator.vibrate(kind === 'hurt' ? 60 : kind === 'win' ? [30, 40, 60] : 18);
      }
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
    const heartsEl = el('platform-hearts');
    if (heartsEl) heartsEl.textContent = fullHearts > 0 ? '♥ '.repeat(fullHearts) + '♡ '.repeat(emptyHearts) : 'انتهت القلوب 💀';
    const resEl = el('platform-resources');
    if (resEl) resEl.textContent = `💎 ${Math.min(3, sim.collected)}/3 · ⛏ ${Math.min(1, sim.mined)}/1 · 👾 ${sim.defeated || 0}`;
    const progEl = el('platform-progress');
    const zoneName = R.ZONES?.[sim.zone || 0]?.name;
    if (progEl) progEl.textContent = `${zoneName ? `${zoneName} · ` : ''}${sim.status === 'won' ? 100 : Math.min(99, Math.floor(sim.player.x / R.LEVEL.exit.x * 100))}% · ${Math.ceil((R.MAX_TICKS - sim.tick) / R.FPS)}ث`;

    // Update gold and energy from main game state
    try {
      if (typeof state !== 'undefined' && state) {
        const goldEl = el('platform-gold');
        const energyEl = el('platform-energy');
        if (goldEl) goldEl.textContent = Math.floor(state.gold).toLocaleString('en-US');
        if (energyEl) energyEl.textContent = Math.floor(state.energy).toLocaleString('en-US');
      }
    } catch (_) {}

    const skillBtn = document.querySelector('[data-platform-input="32"]');
    if (skillBtn) {
      const label = skillBtn.querySelector('span');
      const cd = sim.player.skillCooldown;
      if (label) label.textContent = cd > 0 ? `${(cd / R.FPS).toFixed(1)}ث` : 'قوة';
      skillBtn.classList.toggle('skill-cooldown', cd > 0);
      skillBtn.style.opacity = cd > 0 ? '0.56' : '1';
    }
    // low health pulse on hearts HUD
    if (heartsEl) heartsEl.style.animation = fullHearts === 1 && sim.player.hearts > 0 ? 'progressPulse 1s ease-in-out infinite' : '';
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
    const prev = inputs[inputs.length - 1];
    if (prev && prev.mask === mask) prev.frames++;
    else inputs.push({ mask, frames: 1 });
  }

  function consumeEvents() {
    if (sim.mined > observedMined) feedback('تكسّر العِرق! جمعت بلورتين من المعدن.');
    if (sim.checkpoint !== observedCheckpoint) feedback('راية مفعّلة — ستعود إلى هنا إن أصابك خطر.');
    observedMined = sim.mined; observedCheckpoint = sim.checkpoint;
    for (const event of sim.events) {
      if (event.type === 'jump') learnedJump = true;
      if (event.type === 'hurt') feedback(sim.player.hearts > 0 ? (sim.checkpoint === 64 ? 'احذر الخطر! عدت إلى نقطة البداية.' : 'احذر الخطر! عدت إلى آخر راية، ومواردك باقية.') : 'نفدت القلوب — يمكنك المحاولة من جديد.');
      if (event.type === 'defeat') feedback('هزمت حارسًا — الطريق أكثر أمانًا.');
      beep(event.type);
      // shake feedback for impactful events
      if (event.type === 'hurt') { doShake(0.65); haptic('hurt'); }
      else if (event.type === 'enemy_death') { doShake(0.35); haptic('heavy'); }
      else if (event.type === 'skill') { doShake(0.45); haptic('heavy'); }
      else if (event.type === 'win') { doShake(0.55); haptic('win'); }
      else if (event.type === 'game_over') { doShake(0.5); haptic('hurt'); }
      else if (event.type === 'hit') haptic('light');

      if (!reduced) {
        if (event.type === 'mine') {
          for (let i = 0; i < 9; i++) particles.push({ x: event.x + (Math.random() - 0.5) * 6, y: event.y + (Math.random() - 0.5) * 4, vx: (Math.random() - 0.5) * 2.2, vy: -1.2 - Math.random() * 1.4, life: 22 + Math.random() * 8, color: Math.random() < 0.5 ? '#9fb3b8' : '#ffd27d', size: 2.2 + Math.random() * 2, glow: false });
          for (let i = 0; i < 3; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 1, vy: -0.6 - Math.random() * 0.8, life: 16, color: '#ffe8a0', size: 3.5, glow: true });
        } else if (event.type === 'mine_miss') {
          for (let i = 0; i < 4; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 1.5, vy: -0.4 - Math.random() * 0.6, life: 14, color: '#6b7a80', size: 2.2, glow: false });
        } else if (event.type === 'collect') {
          for (let i = 0; i < 10; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 2.6, vy: -1.6 - Math.random() * 1.6, life: 32, color: i % 2 ? '#5cf3d2' : '#a78bfa', size: 3.6, glow: true, vy2: 0.11 });
          // ring pulse
          particles.push({ x: event.x, y: event.y, vx: 0, vy: 0, life: 18, color: '#5cf3d233', size: 18, ring: true });
        } else if (event.type === 'attack') {
          for (let i = 0; i < 5; i++) particles.push({ x: event.x + (event.facing > 0 ? 28 : -8), y: event.y + 14, vx: event.facing * (1.2 + i * 0.5) + (Math.random() - 0.5), vy: (Math.random() - 0.5) * 0.8, life: 16, color: '#ffeaa7', size: 3, glow: true, trail: true });
        } else if (event.type === 'hit') {
          for (let i = 0; i < 10; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 2.8, vy: -1.4 - Math.random() * 1.2, life: 20, color: i % 3 === 0 ? '#ff6b6b' : '#ffa94d', size: 3.4, glow: true });
        } else if (event.type === 'enemy_death') {
          for (let i = 0; i < 16; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 3.4, vy: -2 - Math.random() * 2.2, life: 36, color: i % 2 ? '#a55eea' : '#ff6b8a', size: 4.5, glow: true, trail: i < 4 });
          particles.push({ x: event.x, y: event.y, vx: 0, vy: 0, life: 20, color: '#a55eea44', size: 28, ring: true });
        } else if (event.type === 'skill') {
          for (let i = 0; i < 18; i++) {
            const ang = (i / 18) * Math.PI * 2;
            particles.push({ x: event.x, y: event.y + 18, vx: Math.cos(ang) * (1.8 + Math.random()), vy: Math.sin(ang) * (1.8 + Math.random()) - 0.6, life: 30, color: i % 3 === 0 ? '#e056fd' : i % 3 === 1 ? '#7c3aed' : '#ff6b9d', size: 4, glow: true, trail: true });
          }
          particles.push({ x: event.x, y: event.y + 20, vx: 0, vy: 0, life: 22, color: '#e056fd33', size: 36, ring: true });
        } else if (event.type === 'hurt') {
          for (let i = 0; i < 10; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 2.2, vy: -1.2 - Math.random() * 1, life: 28, color: '#ff6b6b', size: 3.8, glow: true });
        } else if (event.type === 'land') {
          for (let i = 0; i < 6; i++) particles.push({ x: event.x + (i - 2.5) * 5, y: event.y, vx: (i - 2.5) * 0.6 + (Math.random() - 0.5) * 0.5, vy: -0.5 - Math.random() * 0.6, life: 16, color: '#7f8c8d', size: 2.2, glow: false });
        } else if (event.type === 'win') {
          for (let i = 0; i < 22; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 3, vy: -2.5 - Math.random() * 2.5, life: 48, color: i % 3 === 0 ? '#ffd32a' : i % 3 === 1 ? '#0be881' : '#a78bfa', size: 4, glow: true, trail: true });
        } else if (event.type === 'enemy_attack') {
          for (let i = 0; i < 5; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 1.6, vy: -0.6, life: 16, color: '#ff6b6b', size: 2.8, glow: false });
        }
      }
    }
    // cap particles
    if (particles.length > 96) particles = particles.slice(-96);
    for (const p of particles) {
      if (p.ring) { p.size += 1.4; p.life -= 1; continue; }
      p.x += p.vx; p.y += p.vy; p.vy += 0.13; p.life--;
      // slight air resistance
      p.vx *= 0.99;
    }
    particles = particles.filter(p => p.life > 0);
    if (feedbackUntil && sim.tick >= feedbackUntil) {
      const box = el('platform-feedback'); if (box) box.hidden = true;
      feedbackUntil = 0;
    }
    // decay shake
    if (shake > 0) shake = Math.max(0, shake - 0.07);
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
      for (const k of keys) mask |= keyMap[k] || 0;
      for (const v of pointers.values()) mask |= v;
      for (const v of pulses.values()) mask |= v; // quick taps survive until one physics step
      pulses.clear();

      // Add joystick input to mask
      if (joystickActive) {
        if (joystickX < -0.2) mask |= 1; // LEFT
        if (joystickX > 0.2) mask |= 2; // RIGHT
      }

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
      el('platform-title').textContent = result.won ? '🏆 وصلت إلى قلب المنجم!' : 'انتهت الجولة — جرّب من جديد';
      el('platform-message').textContent = `${result.gems} بلورات · ${result.mined} صخور · ${Math.floor(result.duration)} ثانية. نتيجتك مؤكدة ومحفوظة؛ +${result.gold} ذهب افتراضي. يمكنك بدء رحلة جديدة.`;
      pending = null; ticket = null; shake = 0;
      try { localStorage.removeItem(storageKey()); } catch (_) {}
      say(`محفوظ على الخادم: ${result.score} نقطة · +${result.gold} ذهب افتراضي · +${result.xp} خبرة${result.duplicate ? ' — تأكيد سابق، بلا مكافأة مكررة' : ''}${result.reason === 'cooldown' ? ' — مهلة المكافأة: 20 ثانية بين جائزتي مغامرة' : ''}${result.reason === 'daily_cap' ? ' — وصلت سقف 10,000 ذهب اليومي من المناجم' : ''}`);
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
    overlay(won ? '🏆 وصلت إلى قلب المنجم!' : 'المصباح ينتظر عودتك', `${sim.collected} بلورات · ${sim.mined} صخور · أعداء ${sim.defeated || 0} · ${Math.floor(sim.tick / R.FPS)} ثانية. ${won ? 'أحسنت! تجاوزت الحفر والأخطار وهزمت الوحوش.' : 'راقب ضربات الوحوش واقفز قبل الحفر. استخدم زر الهجوم (⚔️) أو المهارة (💥) للدفاع عن نفسك.'}`);
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
      particles = []; shake = 0;
      hud(); draw();
    }
    // subtle haptic on hero switch
    haptic('light');
  }

  async function start() {
    if (starting || restoring || submitting || pending) return;
    pause();
    starting = true; el('platform-start').disabled = true; clearInput(); cancelAnimationFrame(raf); raf = 0;
    audioUnlock();
    try {
      await bridge.ready(); owner = bridge.user();
      if (owner) {
        ticket = await request('/api/platform/start');
        if (ticket.version !== R.VERSION) throw new Error('حدّث الصفحة للحصول على نسخة المستوى الحالية');
        say(`الهدف: 3 بلورات وصخرة واحدة، ثم بوابة الخروج. ${R.CHARACTERS[currentHero]?.name || 'عامل المنجم'} — تحرّك، اقفز، وعدّن بحكمة.`);
      } else { ticket = null; say('تدريب بلا اتصال — لا مكافأة. يمكنك اللعب ثم إعادة المحاولة متصلًا.'); }
      sim = R.create(currentHero, seedOf(ticket)); inputs = []; particles = []; shake = 0; running = true; paused = false; save();
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
    // reflect restored hero in UI
    document.querySelectorAll('.mine-hero-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.hero === currentHero);
    });
    const replay = stored.inputs?.length ? R.replay(stored.inputs, currentHero, seedOf(stored.ticket)) : { ok: true, state: R.create(currentHero, seedOf(stored.ticket)) };
    if (!replay.ok) { say('ملف جولة غير صالح؛ يمكنك البدء مجددًا.'); return; }
    ticket = stored.ticket; inputs = stored.inputs || []; sim = replay.state;
    resetFeedback(); hud(); draw();
    if (sim.status !== 'playing') {
      pending = { id: ticket.id, inputs, hero: currentHero }; el('platform-start').disabled = true;
      overlay(sim.status === 'won' ? 'استرجاع نتيجة جولتك' : 'جولة سابقة انتهت', 'جارٍ استرجاع تأكيد الخادم. إعادة الطلب لا تضاعف الجائزة.');
      submit();
    } else if (sim.status === 'playing') {
      try {
        const current = await request('/api/platform/start');
        if (current.id !== ticket.id) { ticket = null; say('انتهت صلاحية الحفظ السابق؛ ابدأ جولة جديدة.'); return; }
        running = true; paused = false; pause();
      } catch (_) { running = true; paused = false; pause(); say('تعذّر الاتصال؛ جولتك محفوظة محليًا ويمكنك متابعتها. ستُرسل النتيجة عند عودة الشبكة قبل انتهاء التذكرة.'); }
    }
  }

  // --- Input: pointer + keyboard, prevent page scroll ---
  for (const button of document.querySelectorAll('[data-platform-input]')) {
    button.addEventListener('pointerdown', e => {
      e.preventDefault(); if (!running || paused) return;
      const mask = Number(button.dataset.platformInput);
      audioUnlock(); button.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId, mask);
      queueAction(`pointer:${e.pointerId}`, mask); button.dataset.down = 'true';
    });
    const release = e => releasePointer(e.pointerId, e.type === 'pointercancel' || (e.type === 'lostpointercapture' && pointers.has(e.pointerId)));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
    button.addEventListener('contextmenu', e => e.preventDefault());
    // prevent double-tap zoom
    button.addEventListener('touchend', e => e.preventDefault(), { passive: false });
  }

  // --- Virtual Joystick Logic ---
  const joystick = el('virtual-joystick');
  const joystickHandle = joystick?.querySelector('.joystick-handle');
  if (joystick && joystickHandle) {
    const maxRadius = 33; // Maximum distance from center

    const updateJoystick = (clientX, clientY) => {
      const rect = joystick.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Clamp to max radius
      if (distance > maxRadius) {
        dx = (dx / distance) * maxRadius;
        dy = (dy / distance) * maxRadius;
      }

      // Update handle position
      joystickHandle.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

      // Normalize to -1 to 1
      joystickX = dx / maxRadius;
      joystickY = dy / maxRadius;
    };

    const resetJoystick = () => {
      if (joystickHandle) joystickHandle.style.transform = 'translate(-50%, -50%)';
      joystickX = 0;
      joystickY = 0;
      joystickActive = false;
      joystickPointerId = null;
    };

    joystick.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!running || paused) return;
      audioUnlock();
      joystickActive = true;
      joystickPointerId = e.pointerId;
      joystick.setPointerCapture(e.pointerId);
      updateJoystick(e.clientX, e.clientY);
    });

    joystick.addEventListener('pointermove', e => {
      if (!joystickActive || e.pointerId !== joystickPointerId) return;
      e.preventDefault();
      updateJoystick(e.clientX, e.clientY);
    });

    joystick.addEventListener('pointerup', e => {
      if (e.pointerId !== joystickPointerId) return;
      resetJoystick();
    });

    joystick.addEventListener('pointercancel', e => {
      if (e.pointerId !== joystickPointerId) return;
      resetJoystick();
    });

    joystick.addEventListener('lostpointercapture', resetJoystick);
    joystick.addEventListener('contextmenu', e => e.preventDefault());
  }

  // Prevent scrolling while interacting with canvas
  canvas.addEventListener('touchmove', e => { if (running) e.preventDefault(); }, { passive: false });
  canvas.addEventListener('wheel', e => { if (running) e.preventDefault(); }, { passive: false });

  document.querySelectorAll('.mine-hero-btn').forEach(btn => {
    btn.addEventListener('click', () => setHero(btn.dataset.hero));
  });

  window.addEventListener('keydown', e => {
    if (!visible() || !keyMap[e.code] || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    e.preventDefault();
    if (running && !paused) {
      if (!e.repeat && !keys.has(e.code)) queueAction(`key:${e.code}`, keyMap[e.code]);
      keys.add(e.code);
    }
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); });
  window.addEventListener('blur', () => { keys.clear(); pause(); if (joystickActive) { joystickActive = false; joystickX = 0; joystickY = 0; joystickPointerId = null; if (joystickHandle) joystickHandle.style.transform = 'translate(-50%, -50%)'; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { save(Boolean(pending)); pause(); });
  window.addEventListener('online', () => { if (pending) submit(); });
  // Resize observer for responsive canvas
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
  if (resizeObserver) resizeObserver.observe(canvas);
  else window.addEventListener('resize', draw);
  el('platform-start').addEventListener('click', start);
  el('platform-resume').addEventListener('click', resume);
  el('platform-pause').addEventListener('click', () => { if (paused) resume(); else pause(); });
  el('platform-retry').addEventListener('click', submit);
  el('platform-discard').addEventListener('click', () => {
    if (submitting || !pending || !confirm('إلغاء النتيجة المحلية المعلقة؟ قد تفقد جولة لم يؤكدها الخادم. أي مكافأة حُفظت خادميًا تبقى محفوظة ولا تُمنح مرتين.')) return;
    pending = null; ticket = null; shake = 0;
    try { localStorage.removeItem(storageKey()); } catch (_) {}
    el('platform-start').disabled = false; el('platform-retry').hidden = true; el('platform-discard').hidden = true;
    say('أُلغي الحفظ المحلي المعلق فقط. يمكنك بدء جولة جديدة؛ أرصدة الخادم لم تُحذف.');
  });
  el('platform-mute').setAttribute('aria-pressed', String(muted)); el('platform-mute').textContent = muted ? '🔇 صوت ×' : '🔊 صوت ✓';
  el('platform-mute').addEventListener('click', () => {
    muted = !muted; el('platform-mute').setAttribute('aria-pressed', String(muted)); el('platform-mute').textContent = muted ? '🔇 صوت ×' : '🔊 صوت ✓';
    try { localStorage.setItem('platform-muted', String(muted)); } catch (_) {}
    if (muted) audio?.suspend?.()?.catch(() => {}); else audioUnlock();
  });

  // Expose for tests and cross-module coordination
  window.PlatformGame = {
    pause, setHero,
    // Races reuse the original cart scene; restore the side-scroller afterwards.
    showLegacy: () => {
      pause();
      const scene = el('platform-scene'), legacy = el('legacy-adventure');
      if (scene) scene.hidden = true;
      if (legacy) legacy.hidden = false;
      try { window.resizeAdventureCanvas?.(); } catch (_) {}
    },
    showPlatform: () => {
      const scene = el('platform-scene'), legacy = el('legacy-adventure');
      if (legacy) legacy.hidden = true;
      if (scene) scene.hidden = false;
      hud(); draw();
    },
    inspect: () => ({
      tick: sim.tick, status: sim.status, pose: sim.player.pose,
      x: sim.player.x, y: sim.player.y, gems: sim.collected, mined: sim.mined,
      hearts: sim.player.hearts, running, paused, scheduled: Boolean(raf),
      ticket: ticket?.id, pending: Boolean(pending), hero: sim.player.hero,
      defeated: sim.defeated, reduced, zone: sim.zone,
    }),
  };

  el('platform-start').disabled = true;
  // Initialize HUD immediately
  hud(); draw();
  restore().catch(() => say('تعذّر استرجاع الجولة؛ يمكنك بدء رحلة جديدة.')).finally(() => { restoring = false; el('platform-start').disabled = Boolean(pending); });
})();
