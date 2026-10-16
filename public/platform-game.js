/* One scene controller, one fixed-step RAF, one set of input listeners. */
(() => {
  'use strict';
  if (window.PlatformGame) return;
  let R = window.PlatformRules;
  const currentRules = R;
  const renderer = window.PlatformRenderer, bridge = window.PlatformBridge;
  const el = id => document.getElementById(id);
  const canvas = el('platform-canvas');
  if (!canvas || !R || !renderer || !bridge) return;
  let sim = R.create(), inputs = [], ticket = null, owner = null;
  let running = false, paused = false, starting = false, restoring = true, submitting = false, pending = null;
  let raf = 0, last = 0, accumulator = 0;
  let audio = null, muted = false, volume = .75, particles = [];
  let feedbackUntil = 0, observedCheckpoint = sim.checkpoint, observedMined = sim.mined;
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
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = Boolean(motionQuery?.matches), motionOverride = false;
  try { const preference = localStorage.getItem('platform-reduced'); if (preference !== null) { reduced = preference === 'true'; motionOverride = true; } } catch (_) {}
  let learnedJump = false;
  try {
    muted = localStorage.getItem('platform-muted') === 'true';
    const savedVolume = localStorage.getItem('platform-volume');
    if (savedVolume !== null && Number.isFinite(Number(savedVolume))) volume = Math.max(0, Math.min(1, Number(savedVolume)));
  } catch (_) {}
  const keyMap = { ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, Space: 4, ArrowUp: 4, KeyW: 4, KeyE: 8, KeyX: 8 };
  const storageKey = () => `platform-run:v1:${owner}`;
  const say = text => { el('platform-status').textContent = text; };
  const visible = () => !document.hidden && !el('platform-scene').hidden && el('play-panel-adventure').classList.contains('active') && el('tab-play').classList.contains('active');
  const draw = () => renderer.draw(canvas, sim, { reduced, particles, rules: R });
  function clearInput() {
    keys.clear(); pointers.clear(); pulses.clear();
    document.querySelectorAll('[data-platform-input]').forEach(b => { b.dataset.down = 'false'; });
  }
  function audioUnlock() {
    if (muted || volume === 0) return;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!audio && AC) audio = new AC(); audio?.resume()?.catch(() => {}); } catch (_) {}
  }
  function beep(type) {
    if (muted || volume === 0 || !audio || audio.state !== 'running') return;
    try {
      const frequencies = { jump: 420, collect: 840, mine: 150, hurt: 90, win: 1040, land: 70, warning: 240, defeat: 600 };
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type === 'mine' || type === 'hurt' ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(frequencies[type] || 300, audio.currentTime);
      o.frequency.exponentialRampToValueAtTime((frequencies[type] || 300) * 1.4, audio.currentTime + .1);
      g.gain.setValueAtTime(.045 * volume, audio.currentTime); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .13);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + .14);
    } catch (_) {}
  }
  function save(finished = false) {
    if (!ticket || !owner || (!running && !pending)) return;
    try { localStorage.setItem(storageKey(), JSON.stringify({ version: R.VERSION, ticket, inputs, finished })); }
    catch (_) { say('التخزين المحلي غير متاح؛ لا تغلق الصفحة قبل تأكيد الخادم للنتيجة.'); }
  }
  const setText = (id, value) => { if (el(id).textContent !== value) el(id).textContent = value; };
  function guide() {
    let text;
    if (sim.status === 'won') text = 'اكتمل الهدف! مكافأتك يحددها الخادم بعد التحقق من الجولة.';
    else if (sim.player.x < 180 && !sim.collected) text = '١ / تحرك نحو البلورة المضيئة: ◀ ▶ أو الأسهم. يمكنك ضغط زرين معًا.';
    else if (!learnedJump && sim.player.x < 390) text = '٢ / جرّب القفز بزر «قفز» أو المسافة. حرّك الشخصية أثناء القفز للوصول للمنصات.';
    else if (!sim.mined && sim.player.x < 600) text = '٣ / اقترب من العِرق الفيروزي واضغط «تعدين» أو E. ثلاث ضربات تكسّر الصخرة.';
    else if (sim.player.x < 850) text = '٤ / أمامك نهر حار! اقفز قبل حافة الأرض، واستمر بالتحرك أثناء القفزة.';
    else if (sim.player.x < 1310) text = 'راقب البخار: الفوهة تفتح وتغلق. انتظر أو اقفز فوقها. الراية تحفظ نقطة العودة.';
    else if (sim.player.x < 1800) text = 'الراية التالية بعد الحفرة. استكشف المنصات المرتفعة لجمع بلورات إضافية.';
    else if (sim.player.x < 2160) text = 'اقفز فوق الأشواك. لا تفقد تقدمك عند الاستراحة؛ زر الإيقاف يوقف الوقت.';
    else if (sim.player.x < 2440) text = 'حارس الحجر: ! إنذار قبل الضربة. اقفز أو ابتعد ثم اضرب بزر «تعدين». الزعيم فوق المنصة اختياري.';
    else text = sim.mined >= 1 && sim.collected >= 3 ? 'البوابة مفتوحة! واصل لليمين لإكمال الجولة وحفظ المكافأة.' : 'البوابة تحتاج صخرة واحدة و٣ بلورات. عُد إلى العروق المضيئة وعدّنها.';
    setText('platform-guide', text);
  }
  function hud() {
    guide();
    setText('platform-hearts', '♥ '.repeat(Math.max(0, sim.player.hearts)) || 'انتهت القلوب');
    setText('platform-resources', `بلورات ${sim.collected} · صخور ${sim.mined}`);
    setText('platform-progress', `${sim.status === 'won' ? 100 : Math.min(99, Math.floor(sim.player.x / R.LEVEL.exit.x * 100))}% · ${Math.ceil((R.MAX_TICKS - sim.tick) / R.FPS)}ث`);
  }
  function overlay(title, text, resume = false) {
    el('platform-overlay').hidden = false; el('platform-title').textContent = title; el('platform-message').textContent = text;
    el('platform-resume').hidden = !resume; el('platform-start').textContent = running ? 'إعادة من البداية' : 'جولة جديدة';
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
  function feedback(text) {
    setText('platform-feedback', text);
    el('platform-feedback').hidden = false;
    feedbackUntil = sim.tick + 150; // Simulation time: pause freezes the message too.
  }
  function resetFeedback() {
    feedbackUntil = 0; observedCheckpoint = sim.checkpoint; observedMined = sim.mined;
    el('platform-feedback').hidden = true;
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
      if (!reduced && ['mine', 'collect', 'hurt', 'win'].includes(event.type)) {
        for (let i = 0; i < 8; i++) particles.push({ x: event.x, y: event.y, vx: (i - 4) * .65, vy: -1 - (i % 3), life: 30, color: event.type === 'hurt' ? '#ff9b7e' : '#8ce6cc' });
      }
    }
    if (feedbackUntil && sim.tick >= feedbackUntil) { el('platform-feedback').hidden = true; feedbackUntil = 0; }
    particles = particles.slice(-96);
    for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += .12; p.life--; }
    particles = particles.filter(p => p.life > 0);
  }
  function frame(time) {
    raf = 0;
    if (!running || paused) return;
    if (!visible()) { pause(); return; }
    if (!last) last = time;
    accumulator += Math.min(.1, (time - last) / 1000); last = time;
    let count = 0;
    while (accumulator >= R.DT && count++ < 6 && sim.status === 'playing') {
      let mask = 0;
      for (const key of keys) mask |= keyMap[key] || 0;
      for (const value of pointers.values()) mask |= value;
      for (const value of pulses.values()) mask |= value;
      pulses.clear();
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
      el('platform-message').textContent = `${result.gems} بلورات · ${result.mined} صخور · ${Math.floor(result.duration)} ثانية${result.boss ? ' · هزمت حارس العقيق' : ''}. نتيجتك مؤكدة ومحفوظة؛ +${result.gold} ذهب افتراضي. يمكنك بدء رحلة جديدة.`;
      pending = null; ticket = null;
      try { localStorage.removeItem(storageKey()); } catch (_) {}
      say(`محفوظ على الخادم: ${result.score} نقطة · +${result.gold} ذهب افتراضي · +${result.xp} خبرة${result.duplicate ? ' — تأكيد سابق، بلا مكافأة مكررة' : ''}${result.reason === 'cooldown' ? ' — مهلة المكافأة: 20 ثانية بين جائزتي مغامرة' : ''}`);
      el('platform-start').disabled = false;
    } catch (e) {
      say(`${e.message || 'انقطع الاتصال'}. النتيجة محفوظة محليًا؛ أعد الإرسال، ولا تبدأ حسابًا آخر.`);
      el('platform-retry').hidden = false; el('platform-discard').hidden = false;
      // Preserve receipt inputs on all errors; never substitute an unverified local award.
    } finally { submitting = false; }
  }
  function finish() {
    if (!running) return;
    running = false; paused = false; clearInput(); cancelAnimationFrame(raf); raf = 0;
    const won = sim.status === 'won';
    overlay(won ? 'وصلت إلى قلب المنجم!' : 'المصباح ينتظر عودتك', `${sim.collected} بلورات · ${sim.mined} صخور · ${Math.floor(sim.tick / R.FPS)} ثانية. ${won ? 'أحسنت! تم تجاوز الحفر والأخطار.' : 'راقب البخار واقفز قبل حافة الحفرة. لا مكافأة للفشل.'}`);
    hud(); draw();
    if (ticket) {
      pending = { id: ticket.id, inputs }; save(true); el('platform-start').disabled = true; submit();
    } else say('جولة تدريبية بلا اتصال: لا ذهب ولا مكافأة محلية. أعد المحاولة متصلًا للحفظ الخادمي.');
  }
  async function start() {
    if (starting || restoring || submitting || pending) return;
    pause();
    starting = true; el('platform-start').disabled = true; clearInput(); cancelAnimationFrame(raf); raf = 0;
    bridge.pauseLegacy(); audioUnlock();
    try {
      await bridge.ready(); owner = bridge.user();
      if (owner) {
        const nextTicket = await request('/api/platform/start');
        const nextRules = currentRules.forVersion(nextTicket.version);
        if (!nextRules) throw new Error('حدّث الصفحة للحصول على نسخة المستوى الحالية');
        ticket = nextTicket; R = nextRules;
        say('جولة محفوظة الهوية. عدّن صخرة واجمع 3 بلورات، ثم اعبر بوابة الخروج.');
      } else { R = currentRules; ticket = null; say('تدريب بلا اتصال — لا مكافأة. يمكنك اللعب ثم إعادة المحاولة متصلًا.'); }
      sim = R.create(); inputs = []; particles = []; learnedJump = false; running = true; paused = false; save();
      resetFeedback(); hud();
      if (visible()) resume(); else pause();
    } catch (e) { say(`تعذّر بدء الجولة: ${e.message}. جرّب مجددًا عند الاتصال.`); }
    finally { starting = false; el('platform-start').disabled = Boolean(pending); }
  }
  async function restore() {
    await bridge.ready(); owner = bridge.user(); if (!owner) return;
    let stored;
    try { stored = JSON.parse(localStorage.getItem(storageKey()) || 'null'); } catch (_) { return; }
    if (!stored || !stored.ticket?.id) return;
    const savedRules = currentRules.forVersion(stored.version);
    if (!savedRules) { say('حفظ من نسخة غير مدعومة؛ ابدأ جولة جديدة.'); return; }
    R = savedRules;
    const replay = stored.inputs?.length ? R.replay(stored.inputs) : { ok: true, state: R.create() };
    if (!replay.ok) { say('ملف جولة غير صالح؛ يمكنك البدء مجددًا.'); return; }
    ticket = stored.ticket; inputs = stored.inputs || []; sim = replay.state;
    resetFeedback(); hud(); draw();
    if (sim.status !== 'playing') {
      pending = { id: ticket.id, inputs }; el('platform-start').disabled = true;
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
      const mask = Number(button.dataset.platformInput);
      audioUnlock(); button.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId, mask);
      queueAction(`pointer:${e.pointerId}`, mask); button.dataset.down = 'true';
    });
    const release = e => releasePointer(e.pointerId, e.type === 'pointercancel' || (e.type === 'lostpointercapture' && pointers.has(e.pointerId)));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
    button.addEventListener('contextmenu', e => e.preventDefault());
  }
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, e => {
    releasePointer(e.pointerId, type === 'pointercancel');
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
  function audioUI() {
    const silent = muted || volume === 0;
    el('platform-mute').setAttribute('aria-pressed', String(silent));
    el('platform-mute').textContent = silent ? 'صوت ×' : 'صوت ✓';
    el('platform-volume').value = String(Math.round(volume * 100));
    el('platform-volume').setAttribute('aria-valuetext', `${Math.round(volume * 100)} بالمئة`);
  }
  function applyAudioPreference() {
    audioUI();
    try {
      localStorage.setItem('platform-muted', String(muted));
      localStorage.setItem('platform-volume', String(volume));
    } catch (_) {}
    if (muted || volume === 0) audio?.suspend?.()?.catch(() => {}); else audioUnlock();
  }
  el('platform-mute').addEventListener('click', () => {
    muted = !(muted || volume === 0);
    if (!muted && volume === 0) volume = .5;
    applyAudioPreference();
  });
  el('platform-volume').addEventListener('input', () => {
    const value = Number(el('platform-volume').value);
    if (!Number.isFinite(value)) return;
    volume = Math.max(0, Math.min(1, value / 100));
    if (volume > 0) muted = false;
    applyAudioPreference();
  });
  audioUI();
  function motionUI() {
    el('platform-motion').setAttribute('aria-pressed', String(reduced));
    el('platform-motion').textContent = reduced ? 'حركة مخففة' : 'حركة كاملة';
  }
  el('platform-motion').addEventListener('click', () => {
    reduced = !reduced; motionOverride = true; particles = [];
    try { localStorage.setItem('platform-reduced', String(reduced)); } catch (_) {}
    motionUI(); draw();
  });
  motionQuery?.addEventListener?.('change', e => { if (!motionOverride) { reduced = e.matches; particles = []; motionUI(); draw(); } });
  motionUI();
  // Read-only diagnostics support reproducible browser tests, not reward authority.
  window.PlatformGame = { pause, showLegacy, showPlatform, inspect: () => ({ tick: sim.tick, status: sim.status, pose: sim.player.pose, facing: sim.player.facing, x: sim.player.x, y: sim.player.y, gems: sim.collected, mined: sim.mined, hearts: sim.player.hearts, running, paused, scheduled: Boolean(raf), ticket: ticket?.id, pending: Boolean(pending), reduced, muted: muted || volume === 0, volume, checkpoint: sim.checkpoint, version: R.VERSION, defeated: sim.defeated || 0, boss: Boolean(sim.bossDefeated) }) };
  el('platform-start').disabled = true;
  draw(); restore().catch(() => say('تعذّر استرجاع الجولة؛ يمكنك بدء رحلة جديدة.')).finally(() => { restoring = false; el('platform-start').disabled = Boolean(pending); });
})();
