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

  // المرحلة 3: المنجم المختار (تفضيل محلي) ومعدات اللاعب (من حالته الخادمية المعروضة). الخادم هو من يثبّت
  // لقطة المنجم والمعدات في تذكرة الجولة ويعيد التشغيل بها؛ هنا نعرضها ونحاكيها بنفس القواعد المشتركة.
  let selectedZone = 0;
  try {
    const savedZone = Number(localStorage.getItem('platform-zone'));
    if (Number.isInteger(savedZone) && savedZone >= 0 && savedZone < (R.MINES?.length || 1)) selectedZone = savedZone;
  } catch (_) {}
  // V6: هدف الجولة المختار (تفضيل محلي) — يُثبَّت في تذكرة الخادم عند البدء ولا يُقبل تبديله بعدها.
  let selectedGoal = 0;
  try {
    const savedGoal = Number(localStorage.getItem('platform-goal'));
    if (Number.isInteger(savedGoal) && savedGoal >= 0 && savedGoal < (R.GOALS?.length || 1)) selectedGoal = savedGoal;
  } catch (_) {}
  // V7: وضع الجولة — 'mine' (الافتراضي) أو 'duel' (مبارزة قتال حيّة على نفس محرك الحركة).
  let selectedMode = 'mine';
  try {
    const savedMode = localStorage.getItem('platform-mode');
    if (R.MODES?.includes(savedMode)) selectedMode = savedMode;
  } catch (_) {}
  const liveLoadout = () => {
    try { return R.normalizeLoadout(typeof state !== 'undefined' && state ? state.equipment : null); } catch (_) { return R.normalizeLoadout(null); }
  };
  const configFor = (t) => (t?.config ? R.normalizeConfig(t.config) : R.normalizeConfig({ zone: selectedZone, goal: selectedGoal, mode: selectedMode, loadout: liveLoadout() }));

  let sim = R.create(currentHero, undefined, configFor(null)), inputs = [], ticket = null, owner = null;
  const seedOf = (t) => (t?.id ? R.seedFromId(t.id) : undefined);
  let running = false, paused = false, starting = false, restoring = true, submitting = false, pending = null;
  let raf = 0, last = 0, accumulator = 0;
  let audio = null, muted = false, particles = [], shake = 0;
  // المرحلة 1: مؤثرات عرض فقط — لا تدخل في R.step ولا في مسار الحركات المرسل للخادم.
  let floaters = [], floatersSpawned = 0, combo = 0, comboUntil = 0, comboPeak = 0, beams = [];
  let frameTime = 0, hitStopUntil = 0, lastHitStop = -1e9;
  // أسماء نيّة الخصم: يُعلَن الهجوم قبل وقوعه بكلمة واحدة مفهومة (العدالة أساس القتال)
  const INTENT_LABEL = { slash: 'ضربة قريبة', wave: 'موجة — اقفز', overhead: 'كاسرة — اقفز أو رُوغ', charge: 'اندفاع!',
    slam: 'موجة — اقفز', pound: 'صدمة أرضية — اقفز!', sweep: 'ضربة قريبة — صدّها' };
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
  let feedbackUntil = 0, observedCheckpoint = sim.checkpoint, observedMined = sim.mined, exitHinted = false;
  let learnedJump = false;
  function feedback(text) {
    const box = el('platform-feedback');
    if (!box) return;
    box.textContent = text; box.hidden = false;
    feedbackUntil = sim.tick + 150;
  }
  function resetFeedback() {
    feedbackUntil = 0; observedCheckpoint = sim.checkpoint; observedMined = sim.mined; exitHinted = false;
    const box = el('platform-feedback'); if (box) box.hidden = true;
    resetImpact();
  }

  function resetImpact() {
    floaters = []; floatersSpawned = 0; beams = [];
    combo = 0; comboUntil = 0; comboPeak = 0;
    hitStopUntil = 0; lastHitStop = -1e9;
  }
  function pushFloater(x, y, text, color, size = 12) {
    if (floaters.length > 24) floaters.shift();
    const life = reduced ? 45 : 52;
    floaters.push({ x, y, text, color, size, life, maxLife: life, vy: reduced ? 0 : -0.9, scale: reduced ? 1 : 1.25 });
    floatersSpawned++;
  }
  function bumpCombo() {
    if (sim.tick > comboUntil) combo = 0;
    combo += 1; comboUntil = sim.tick + 300; // 5 ثوانٍ تكفي للوصول للصخرة التالية
    comboPeak = Math.max(comboPeak, combo);
  }
  // تجميد عرض قصير فقط: time هو طابع requestAnimationFrame نفسه، فيبقى
  // عدد خطوات R.step كما هو تماماً (لا حتمية تنكسر ولا مكافأة تتغير).
  function requestHitStop(ms) {
    if (reduced || frameTime - lastHitStop < 90) return;
    lastHitStop = frameTime;
    hitStopUntil = Math.max(hitStopUntil, frameTime + Math.min(60, ms));
  }
  function spawnBurst(x, y, color, count = 14) {
    if (reduced) return;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 1.2 + Math.random() * 2;
      particles.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - 0.8,
        life: 22 + Math.random() * 14, color, size: 2.4 + Math.random() * 2.6, glow: true });
    }
    particles.push({ x, y, vx: 0, vy: 0, life: 18, color: `${color}55`, size: 22, ring: true });
  }
  function spawnRockBurst(rock) {
    if (reduced) return;
    const cx = rock.x + rock.w / 2, cy = rock.y + rock.h / 2;
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + Math.random() * 0.35;
      const speed = 1.4 + Math.random() * 2.4;
      particles.push({ x: cx, y: cy, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - 1.1,
        life: 26 + Math.random() * 16, color: i % 3 === 0 ? '#ffd166' : i % 3 === 1 ? '#9fb3b8' : '#56ebd3',
        size: 2.6 + Math.random() * 3, glow: i % 3 === 2 });
    }
    particles.push({ x: cx, y: cy, vx: 0, vy: 0, life: 22, color: '#ffd16655', size: 26, ring: true });
    doShake(0.32); haptic('heavy');
  }
  try { muted = localStorage.getItem('platform-muted') === 'true'; } catch (_) {}

  const keyMap = {
    ArrowLeft: 1, KeyA: 1,
    ArrowRight: 2, KeyD: 2,
    Space: 4, ArrowUp: 4, KeyW: 4,
    KeyE: 8, KeyX: 8,
    KeyF: 16, KeyJ: 16, KeyZ: 16,
    KeyQ: 32, KeyK: 32, KeyC: 32,
    KeyS: 64, ArrowDown: 64, ShiftLeft: 64, ShiftRight: 64,
    // V8: المراوغة والضربة الثقيلة — مفاتيح مستقلة لا تلمس اختصارات اللعبة القديمة
    KeyV: 128, KeyB: 128,
    KeyL: 256, KeyU: 256,
  };
  // أسماء المفاتيح للعرض في الإرشاد (تُبنى من keyMap نفسه فلا تتناقض معه)
  const KEY_HINTS = 'الأسهم/WASD حركة · Space قفز · J ضرب خفيف (سلسلة) · L ضربة قوية · V مراوغة · S صدّ · Q مهارة · E حفر';

  // إعدادات التحكم (حجم العصا وشفافيتها وحساسيتها والاهتزاز) — تُحفظ محليًا فقط ولا تمسّ حساب اللاعب.
  // touchPad: أزرار اللمس (العصا + أزرار القتال).
  //   auto  = تظهر على الجوال والتابلت (مؤشر خشن) وتختفي على الكمبيوتر (مؤشر دقيق) — الافتراضي
  //   show  = تظهر دائمًا (لمن يريد اللمس على شاشة كبيرة)
  //   hide  = تختفي دائمًا (لوحة المفاتيح فقط)
  const CONTROL_DEFAULTS = { size: 'md', opacity: 'md', sensitivity: 'md', haptics: true, touchPad: 'auto' };
  const TOUCH_ORDER = ['auto', 'show', 'hide'];
  const coarsePointer = () => {
    try { if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true; } catch (_) {}
    return (navigator.maxTouchPoints || 0) > 0;
  };
  function touchPadVisible() {
    const mode = controlSettings.touchPad || 'auto';
    if (mode === 'show') return true;
    if (mode === 'hide') return false;
    return coarsePointer();
  }
  let controlSettings = { ...CONTROL_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem('platform-controls') || 'null');
    if (saved && typeof saved === 'object') controlSettings = { ...CONTROL_DEFAULTS, ...saved };
  } catch (_) {}
  const JOYSTICK_SENSITIVITY = { lg: 0.14, md: 0.2, sm: 0.28 }; // منطقة ميتة أصغر = استجابة أسرع
  let joystickDeadZone = JOYSTICK_SENSITIVITY[controlSettings.sensitivity] || 0.2;

  // Virtual Joystick State
  let joystickActive = false;
  let joystickX = 0; // -1 to 1
  let joystickY = 0; // -1 to 1
  let joystickPointerId = null;

  // وصف مكافأة المبارزة يُبنى من القواعد نفسها فلا ينحرف النص عن الحساب الخادمي
  try {
    const note = document.getElementById('duel-reward-note');
    const lowest = R.duelReward(0), deepest = R.duelReward(R.MINES.length - 1);
    if (note && Number.isFinite(lowest)) note.textContent = `مكافأة المبارزة الحيّة: ${lowest}–${deepest} ذهباً حسب عمق المنجم · بسقف يومي مستقل لا يمسّ أرباح التعدين.`;
  } catch (_) {}

  const storageKey = () => `platform-run:v1:${owner}`;
  const say = text => { const s = el('platform-status'); if (s) s.textContent = text; };
  const visible = () => !document.hidden && !el('platform-scene').hidden && el('play-panel-adventure').classList.contains('active') && el('tab-play').classList.contains('active');
  const draw = () => renderer.draw(canvas, sim, { reduced, particles, shake, floaters, beams });

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
        robot_mine: { freq: 300, dur: 0.09, type: 'square', slide: 420 },
        attack: { freq: 520, dur: 0.12, type: 'sawtooth', slide: 380 },
        hit: { freq: 720, dur: 0.10, type: 'sawtooth', slide: 480 },
        enemy_death: { freq: 280, dur: 0.22, type: 'triangle', slide: 120 },
        skill: { freq: 780, dur: 0.18, type: 'sine', slide: 1050 },
        collect: { freq: 880, dur: 0.13, type: 'sine', slide: 1220 },
        hurt: { freq: 110, dur: 0.18, type: 'sawtooth', slide: 55 },
        win: { freq: 1040, dur: 0.22, type: 'sine', slide: 1560 },
        game_over: { freq: 140, dur: 0.32, type: 'triangle', slide: 70 },
        // الزعماء: كل حدث له نبرة تُعرَف بلا نظر (إنذار صاعد، ضربة ثقيلة، انهيار، رنين الدرع)
        clang: { freq: 1500, dur: 0.09, type: 'square', slide: 900 },
        boss_wake: { freq: 90, dur: 0.5, type: 'sawtooth', slide: 52 },
        boss_windup: { freq: 260, dur: 0.32, type: 'sawtooth', slide: 560 },
        boss_slam: { freq: 72, dur: 0.3, type: 'triangle', slide: 38 },
        boss_charge: { freq: 120, dur: 0.36, type: 'sawtooth', slide: 230 },
        boss_crash: { freq: 95, dur: 0.38, type: 'square', slide: 40 },
        boss_stun: { freq: 700, dur: 0.14, type: 'sine', slide: 420 },
        boss_enrage: { freq: 210, dur: 0.5, type: 'sawtooth', slide: 92 },
        boss_death: { freq: 320, dur: 0.7, type: 'triangle', slide: 60 },
        // V8: نبرات القتال الجديد — ضربة ثقيلة، مراوغة، صدّ، ترنّح
        swing: { freq: 640, dur: 0.07, type: 'sawtooth', slide: 300 },
        heavy: { freq: 190, dur: 0.2, type: 'square', slide: 90 },
        dodge: { freq: 900, dur: 0.1, type: 'sine', slide: 320 },
        guard: { freq: 1200, dur: 0.1, type: 'square', slide: 700 },
        evade: { freq: 1320, dur: 0.09, type: 'sine', slide: 1700 },
        stagger: { freq: 380, dur: 0.16, type: 'triangle', slide: 160 },
        swing_hit: { freq: 760, dur: 0.1, type: 'sawtooth', slide: 300 },
        enemy_stagger: { freq: 380, dur: 0.16, type: 'triangle', slide: 160 },
        enemy_slash: { freq: 420, dur: 0.1, type: 'sawtooth', slide: 240 },
        enemy_block: { freq: 980, dur: 0.08, type: 'square', slide: 620 },
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
    if (controlSettings && controlSettings.haptics === false) return;
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
    if (heartsEl) heartsEl.textContent = fullHearts > 0 ? '♥ '.repeat(fullHearts) + '♡ '.repeat(emptyHearts) : 'انتهت القلوب';
    const resEl = el('platform-resources');
    if (resEl) {
      // عدّادات منفصلة مع أيقونات SVG: لا تُستبدل بنية الشريط في كل إطار.
      const chip = (id, value) => { const node = el(id); if (node) node.textContent = String(value); };
      chip('res-gems', Math.min(3, sim.collected));
      chip('res-rocks', Math.min(1, sim.mined));
      chip('res-foes', sim.defeated || 0);
      if (sim.mode === 'duel') {
        const rival = sim.enemies.find((e) => e.type === 'rival') || sim.enemies[0];
        chip('res-gems', Math.max(0, rival ? Math.ceil(rival.hp) : 0));
        chip('res-rocks', 0);
        chip('res-foes', sim.player.guard?.blocks || 0);
      }
    }
    // شريط صحة الخصم داخل المشهد (وضع المبارزة): يُقرأ من المحاكاة نفسها، ويختفي خارج المبارزة
    const foeBox = el('stage-foe');
    if (foeBox) {
      const foe = sim.mode === 'duel' ? (sim.enemies.find((e) => e.type === 'rival') || sim.enemies[0]) : null;
      const showFoe = Boolean(foe) && sim.status === 'playing';
      if (foeBox.hidden === showFoe) foeBox.hidden = !showFoe;
      if (foe) {
        const nameEl = el('stage-foe-name');
        if (nameEl && nameEl.textContent !== (foe.name || 'الخصم')) nameEl.textContent = foe.name || 'الخصم';
        const fill = el('stage-foe-fill');
        if (fill) fill.style.width = `${Math.max(0, Math.min(100, (foe.hp / Math.max(1, foe.maxHp)) * 100))}%`;
      }
    }
    const progEl = el('platform-progress');
    const zoneName = R.ZONES?.[sim.zone || 0]?.name;
    if (progEl) progEl.textContent = sim.mode === 'duel'
      ? (() => {
        const rival = sim.enemies.find((e) => e.type === 'rival') || sim.enemies[0];
        const hp = rival ? Math.max(0, Math.ceil(rival.hp)) : 0;
        const max = rival ? rival.maxHp : 0;
        const g = sim.player.guard || { stamina: 0, maxStamina: 1 };
        const guardPct = Math.round(100 * g.stamina / Math.max(1, g.maxStamina));
        const cb = sim.player.combo || 0;
        const intent = rival && rival.state === 'windup' ? INTENT_LABEL[rival.attack] || 'هجوم' : '';
        // الاسم وصحة الخصم لهما شريط مستقل فوق المشهد؛ هنا نُبقي ما يخصّ اللاعب فقط (لا تكرار ولا حشو)
        return `${cb ? `سلسلة ×${cb} · ` : ''}درع ${guardPct}%${intent ? ` · ${intent}` : ''} · ${Math.ceil((R.MAX_TICKS - sim.tick) / R.FPS)}ث`;
      })()
      : `${zoneName ? `${zoneName} · ` : ''}${sim.status === 'won' ? 100 : Math.min(99, Math.floor(sim.player.x / R.levelFor(sim.zone).exit.x * 100))}% · ${Math.ceil((R.MAX_TICKS - sim.tick) / R.FPS)}ث`;

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
    // أزرار القتال: مهلة المراوغة ومهلة الضربة الثقيلة تُعرض داخل الزر نفسه (لا HUD إضافي يحجب المشهد).
    const cdButton = (id, ticks, label) => {
      const btn = document.querySelector(`[data-platform-input="${id}"]`);
      if (!btn) return;
      const text = btn.querySelector('span');
      const left = Math.max(0, ticks || 0);
      if (text) text.textContent = left > 0 ? `${(left / R.FPS).toFixed(1)}ث` : label;
      btn.classList.toggle('skill-cooldown', left > 0);
      btn.style.opacity = left > 0 ? '0.56' : '';
    };
    // في المبارزة يختفي زر الحفر (لا صخور) لتبقى أزرار القتال واسعة على شاشات الهاتف.
    document.querySelector('.mine-controls')?.classList?.toggle('duel-mode', sim.mode === 'duel');
    // في المبارزة لا معنى لعدّادات البلورات/الصخور: شريحة الموارد تُخفى بدل عرض أرقام مضلّلة
    document.querySelector('.mine-hud')?.classList?.toggle('duel-hud', sim.mode === 'duel');
    cdButton(128, sim.player.dodge?.cooldown, 'مراوغة');
    cdButton(256, sim.player.heavyCooldown, 'قوي');
    // low health pulse on hearts HUD
    if (heartsEl) heartsEl.style.animation = fullHearts === 1 && sim.player.hearts > 0 ? 'progressPulse 1s ease-in-out infinite' : '';
    // المرحلة 1: شارة السلسلة وبطاقة المهمة (عرض فقط).
    const comboEl = el('platform-combo');
    if (comboEl) {
      const live = running && !paused && sim.tick <= comboUntil && combo >= 2;
      comboEl.hidden = !live;
      if (live) comboEl.textContent = `×${combo}`;
    }
    // شريحة الهدف: الهدف المختار وتقدّمه من حالة المحاكاة نفسها (لا تُحسب من الواجهة).
    const gs = R.goalStatus ? R.goalStatus(sim) : null;
    const chipText = el('goal-chip-text'), chipBox = el('goal-chip'), chipUse = el('goal-chip-use');
    if (gs && chipText) {
      const value = gs.id === 'speed' ? `${Math.min(gs.target, gs.now)}/${gs.target}ث` : `${Math.min(gs.target, gs.now)}/${gs.target}`;
      const goalDef = R.GOALS?.[sim.goal || 0];
      chipText.textContent = `${goalDef?.short || gs.name} ${value}`;
      if (chipBox) {
        chipBox.classList.toggle('done', Boolean(gs.done));
        chipBox.title = gs.done ? `الهدف محقّق: ${gs.name}` : `هدف الجولة: ${gs.name}`;
      }
      if (chipUse) chipUse.setAttribute('href', gs.id === 'ore' ? '#i-bag' : gs.id === 'vein' ? '#i-gem' : '#i-bolt');
    }
    tickEventBanner();
    const mg = el('mission-gems'), mr = el('mission-rocks'), mf = el('mission-fill'), mb = el('mission-boss');
    if (mg) mg.textContent = `${Math.min(3, sim.collected)}/3`;
    if (mr) mr.textContent = `${Math.min(1, sim.mined)}/1`;
    if (mb) { const row = mb.closest('.mission-row'); if (row) row.hidden = !sim.bossId; mb.textContent = sim.bossDefeated ? '1/1' : '0/1'; }
    const milestoneCount = sim.milestones?.length || 0, milestoneTotal = R.MILESTONES?.length || 5;
    const mc = el('milestone-count'), mm = el('mission-milestones');
    if (mc) mc.textContent = `${milestoneCount}/${milestoneTotal}`;
    if (mm) mm.textContent = `${milestoneCount}/${milestoneTotal}`;
    if (mf) mf.style.width = `${Math.round(((Math.min(3, sim.collected) / 3) * (sim.bossId ? 0.3 : 0.45) + Math.min(1, sim.mined) * (sim.bossId ? 0.15 : 0.25) + (sim.bossDefeated ? 0.3 : 0) + (milestoneCount / milestoneTotal) * (sim.bossId ? 0.25 : 0.30)) * 100)}%`;
  }

  // المناجم المفتوحة لحالة اللاعب (الشروط من القواعد المشتركة؛ الخادم يعيد التحقق عند بدء الجولة)
  function unlockedMines(st) {
    const src = st || (typeof state !== 'undefined' ? state : null) || {};
    return R.MINES.map((_, i) => i).filter(i => R.mineUnlocked(i, src.mines, src.equipment));
  }

  // شاشة البدء: سطر واحد قصير، والشرح الكامل داخل «كيف ألعب؟» كي لا يفيض الغطاء بحاجة إلى تمرير.
  const OVERLAY_LEAD = 'اختر هدف الجولة ثم ابدأ — واقرأ «كيف ألعب؟» إن كانت هذه أول مرة.';

  // ===== V6.3: ضمان «بلا تمرير» بالقياس لا بالتقدير =====
  // نقيس فيض الغطاء الفعلي (scrollHeight مقابل clientHeight) ونخفّف المحتوى درجةً درجة
  // حتى يتوقف التمرير تمامًا. المقاسات الثابتة تخطئ مع الخط العربي وأحجام النوافذ المختلفة.
  // الترتيب مقصود: نُخفي الشرح ثم الزينة ثم المهمة (المكرّرة في الشريط العلوي)، ولا نُخفي أبدًا
  // أزرار الهدف أو زر البدء.
  const FIT_STEPS = ['fit-1', 'fit-2', 'fit-3', 'fit-4'];
  function overlayOverflows(ov) {
    return ov.scrollHeight - ov.clientHeight > 1;
  }
  function syncOverlayFit() {
    const ov = el('platform-overlay');
    if (!ov || !ov.classList || ov.hidden || !ov.clientHeight) return;
    for (const step of FIT_STEPS) ov.classList.remove(step);
    let over = overlayOverflows(ov);
    for (const step of FIT_STEPS) {
      if (!over) break;
      ov.classList.add(step);
      over = overlayOverflows(ov);
    }
    // لا يظهر شريط التمرير إلا إذا بقي فيض حقيقي (مثل فتح الشرح اختياريًا).
    if (over) ov.classList.add('overlay-scrolls'); else ov.classList.remove('overlay-scrolls');
  }
  let overlayFitFrame = 0;
  function scheduleOverlayFit() {
    if (overlayFitFrame) return;
    const run = () => { overlayFitFrame = 0; syncOverlayFit(); };
    if (typeof requestAnimationFrame === 'function') overlayFitFrame = requestAnimationFrame(run);
    else run();
  }
  // ارتفاع الغطاء يتغيّر بعد أول إطار أحيانًا: خط عربي يُحمّل، أو مشهد يظهر بعد الاتصال،
  // أو شريط علوي يعيد الترتيب. إعادة قياس واحدة متأخرة تمنع أن يبقى التمرير الذي «ظهر لاحقًا».
  function refitOverlayLater() {
    if (typeof document !== 'undefined' && document?.fonts?.ready?.then) {
      try { document.fonts.ready.then(() => scheduleOverlayFit()).catch(() => {}); } catch (_) {}
    }
    if (typeof setTimeout === 'function') setTimeout(() => { overlayFitFrame = 0; syncOverlayFit(); }, 260);
  }

  function overlay(title, text, resume = false) {
    const help = el('overlay-help');
    if (help) {
      help.open = false;
      // نُزيل أثر الشرح المفتوح فورًا كي يُقاس الارتفاع الحقيقي لا ارتفاع شرح مطوي.
      el('platform-overlay')?.classList?.remove('help-open');
    }
    el('platform-overlay').hidden = false;
    el('platform-title').textContent = title;
    el('platform-message').textContent = text;
    el('platform-resume').hidden = !resume;
    el('platform-start').textContent = running ? 'إعادة من البداية' : 'جولة جديدة';
    scheduleOverlayFit();
    refitOverlayLater();
  }

  // ===== V6: هدف الجولة =====
  function setGoal(goal, announce = true) {
    // لا تبديل لهدف جولة جارية: التذكرة الخادمية مثبّتة عليه أصلاً، وهذا يمنع اختلاف المعاينة عن المحاكاة.
    if (running || pending || submitting) return false;
    const g = Number(goal);
    if (!Number.isInteger(g) || g < 0 || g >= (R.GOALS?.length || 1) || g === selectedGoal) return false;
    selectedGoal = g;
    try { localStorage.setItem('platform-goal', String(g)); } catch (_) {}
    syncGoalButtons();
    refreshPreview();
    scheduleOverlayFit();
    if (announce) haptic('light');
    return true;
  }
  function syncGoalButtons() {
    document.querySelectorAll('.goal-option').forEach(btn => {
      const on = Number(btn.dataset.goal) === selectedGoal;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });
    const def = R.GOALS?.[selectedGoal];
    const hint = el('goal-hint');
    if (hint && def) hint.textContent = `${def.hint} — ${def.blurb}.`;
  }

  // ===== V6: لافتة حدث قصيرة داخل المشهد (بلا نوافذ تحجب اللعب) =====
  let eventUntil = 0;
  function eventBanner(title, text, ticks = 240) {
    const box = el('platform-event');
    if (!box) return;
    const t = el('platform-event-title'), b = el('platform-event-text');
    if (t) t.textContent = title;
    if (b) b.textContent = text ? ` ${text}` : '';
    box.hidden = false;
    box.classList.add('show');
    eventUntil = sim.tick + ticks;
  }
  function tickEventBanner() {
    if (!eventUntil || sim.tick < eventUntil) return;
    eventUntil = 0;
    const box = el('platform-event');
    if (box) { box.classList.remove('show'); box.hidden = true; }
  }

  function pause() {
    clearInput();
    if (!running || paused) return;
    paused = true; cancelAnimationFrame(raf); raf = 0; hitStopUntil = 0;
    save(); audio?.suspend?.()?.catch(() => {});
    overlay('استراحة عند المصباح', 'الجولة متوقفة. لن تتقدم الفيزياء أو الوقت أثناء مغادرتك. تابع عندما تكون جاهزًا.', true);
    draw();
  }

  function schedule() { if (!raf && running && !paused && visible()) raf = requestAnimationFrame(frame); }

  function resume() {
    if (!running) return;
    paused = false; clearInput(); accumulator = 0; last = 0; hitStopUntil = 0;
    // الغلاف يُخفى دائمًا عند الاستئناف: بدء المبارزة من الساحة قد يسبق ظهور المشهد بجزء من الثانية،
    // وكان هذا يترك اللاعب على «شاشة البداية» رغم أن الجولة بدأت على الخادم.
    el('platform-overlay').hidden = true; audioUnlock();
    if (!visible()) return; // الإطارات لا تُشغَّل إلا في مشهد مرئي؛ onShow يعيدها عند الدخول
    schedule(); canvas.focus({ preventScroll: true });
  }
  // يُنادى عند فتح تبويب اللعب: يعيد تشغيل الحلقة إن كانت الجولة جارية ومتوقفة على الظهور فقط
  function onShow() {
    if (!running || paused) { draw(); return; }
    el('platform-overlay').hidden = true;
    schedule(); draw();
  }

  function record(mask) {
    const prev = inputs[inputs.length - 1];
    if (prev && prev.mask === mask) prev.frames++;
    else inputs.push({ mask, frames: 1 });
  }

  function consumeEvents(broken = []) {
    for (const rock of broken) spawnRockBurst(rock);
    if (sim.mined > observedMined) feedback('تكسّر العِرق! جمعت بلورتين من المعدن.');
    if (sim.checkpoint !== observedCheckpoint) feedback('راية مفعّلة — ستعود إلى هنا إن أصابك خطر.');
    observedMined = sim.mined; observedCheckpoint = sim.checkpoint;
    if (sim.bossId && !sim.bossDefeated && !exitHinted && sim.mined >= 1 && sim.collected >= 3 && sim.player.x > R.levelFor(sim.zone).exit.x - 150) {
      exitHinted = true; say('البوابة مغلقة حتى يسقط الزعيم.');
    }
    for (const event of sim.events) {
      if (event.type === 'jump') learnedJump = true;
      if (event.type === 'hurt') feedback(sim.player.hearts > 0 ? (sim.checkpoint === 64 ? 'احذر الخطر! عدت إلى نقطة البداية.' : 'احذر الخطر! عدت إلى آخر راية، ومواردك باقية.') : 'نفدت القلوب — يمكنك المحاولة من جديد.');
      if (event.type === 'defeat') feedback('هزمت حارسًا — الطريق أكثر أمانًا.');
      beep(event.type === 'hit' && event.damage === 0 ? 'clang' : event.type);
      // shake feedback for impactful events
      if (event.type === 'hurt') { doShake(0.65); haptic('hurt'); }
      else if (event.type === 'enemy_death') { doShake(0.35); haptic('heavy'); }
      else if (event.type === 'skill') { doShake(0.45); haptic('heavy'); }
      else if (event.type === 'win') { doShake(0.55); haptic('win'); }
      else if (event.type === 'game_over') { doShake(0.5); haptic('hurt'); }
      else if (event.type === 'hit') haptic('light');
      else if (event.type === 'boss_wake') { doShake(0.45); haptic('heavy'); }
      else if (event.type === 'boss_slam') { doShake(0.7); haptic('heavy'); }
      else if (event.type === 'boss_crash') { doShake(0.8); haptic('heavy'); }
      else if (event.type === 'boss_enrage') { doShake(0.55); haptic('heavy'); }
      else if (event.type === 'boss_death') { doShake(0.9); haptic('win'); }

      // أرقام الضرر/المكافأة وسلسلة التعدين — خارج المحرك الحتمي تماماً.
      if (event.type === 'robot_mine') {
        pushFloater(event.x, event.y - 8, `-${Math.max(1, event.damage || 1)}`, '#7dffd4', 11);
        const drone = renderer.dronePos ? renderer.dronePos(sim.player, sim.tick, reduced) : { x: sim.player.x, y: sim.player.y };
        beams.push({ x1: drone.x, y1: drone.y, x2: event.x, y2: event.y, life: 8 });
        if (!reduced) for (let i = 0; i < 6; i++) particles.push({ x: event.x + (Math.random() - 0.5) * 6, y: event.y + (Math.random() - 0.5) * 4, vx: (Math.random() - 0.5) * 2, vy: -1 - Math.random() * 1.2, life: 20, color: '#7dffd4', size: 2.4, glow: true });
      } else if (event.type === 'mine') {
        pushFloater(event.x, event.y - 8, `-${Math.max(1, event.damage || sim.player.miningPower || 1)}`, '#ffe08a');
        bumpCombo();
        if (combo >= 2) pushFloater(sim.player.x + (sim.player.w || 20) / 2, sim.player.y - 12, `×${combo}`, '#ffd166', 13);
        requestHitStop(45);
      } else if (event.type === 'collect') {
        const fromRock = broken.length > 0;
        pushFloater(event.x + 10, event.y - 6, event.bonus ? '+خام' : fromRock ? '+2' : '+1', event.bonus ? '#ffd166' : fromRock ? '#7dffd4' : '#b9a6ff');
        bumpCombo();
        if (combo >= 2) pushFloater(sim.player.x + (sim.player.w || 20) / 2, sim.player.y - 14, `×${combo}`, '#ffd166', 13);
      } else if (event.type === 'hit') {
        if (event.damage === 0) pushFloater(event.x, event.y - 8, 'مدرّع', '#9fb4c4', 10); // درع الزعيم: لا ضرر خارج مرحلة الذهول
        else { pushFloater(event.x, event.y - 8, `-${event.damage || 1}`, event.heavy ? '#ffd166' : '#ff9b7a', event.heavy ? 15 : 12); requestHitStop(event.heavy ? 55 : 35); }
      } else if (event.type === 'swing') {
        // الرياح الجوية للضربة: الثقيلة أقوى وأثقل
        if (event.heavy) { spawnBurst(event.x + (event.facing > 0 ? 30 : -30), event.y + 16, '#ffd166', 8); doShake(0.22); }
      } else if (event.type === 'swing_hit') {
        if (event.hits > 0) { requestHitStop(event.heavy ? 70 : 30); if (event.heavy) doShake(0.4); }
      } else if (event.type === 'swing_miss') {
        // لا شيء: الصوت وحده يكفي ليعرف اللاعب أن الضربة لم تصل
      } else if (event.type === 'dodge') {
        // أثر المراوغة: خط من الشظايا في اتجاه الحركة
        if (!reduced) for (let i = 0; i < 7; i++) particles.push({ x: event.x - event.dir * (8 + i * 5), y: event.y + 18 + (i % 3) * 3,
          vx: -event.dir * (0.6 + Math.random() * 0.8), vy: -0.4 - Math.random() * 0.5, life: 14 + i, color: i % 2 ? '#9fe8ff' : '#c7d2fe', size: 3.4 - i * 0.25, glow: true });
      } else if (event.type === 'evade') {
        pushFloater(event.x, event.y - 16, 'تفاديت!', '#9fe8ff', 13);
        haptic('light');
      } else if (event.type === 'enemy_stagger') {
        pushFloater(event.x, event.y - 20, 'ترنّح!', '#ffe28a', 12);
      } else if (event.type === 'guard') {
        pushFloater(event.x, event.y - 18, 'صدّ!', '#93c5fd', 13);
        doShake(0.25); haptic('light');
      } else if (event.type === 'enemy_slash') {
        if (!reduced) for (let i = 0; i < 6; i++) particles.push({ x: event.x + event.dir * 26, y: event.y + 26 + i * 2,
          vx: event.dir * (0.8 + Math.random()), vy: -0.3, life: 12, color: '#ffb4a2', size: 2.6, glow: false });
      } else if (event.type === 'boss_wake') {
        const boss = sim.enemies.find(e => e.id === event.id);
        say(`${boss ? boss.name : 'الزعيم'} استيقظ — درعه لا يُخترق إلا حين يترنّح بعد هجومه: تفادَ الضربة ثم اضربه.`);
        pushFloater(event.x, event.y - 30, boss ? boss.name : 'الزعيم', '#ffd166', 13);
      } else if (event.type === 'boss_windup') {
        const label = event.unblockable ? 'كاسرة — اقفز أو رُوغ!' : (INTENT_LABEL[event.attack] || 'صدمة — اقفز!');
        pushFloater(event.x, event.y - 14, label, event.unblockable ? '#ff6b6b' : '#ff9b7a', event.unblockable ? 14 : 12);
        if (event.unblockable) { doShake(0.3); haptic('heavy'); }
      } else if (event.type === 'boss_stun') {
        pushFloater(event.x, event.y - 16, 'مذهول — اضربه!', '#ffe28a', 12);
      } else if (event.type === 'boss_enrage') {
        say('اهتاج الزعيم — أسرع وأقصر إنذاراً! لا تزال نافذة الذهول هي فرصتك.');
        pushFloater(event.x, event.y - 24, 'اهتاج!', '#ff6b4d', 14);
      } else if (event.type === 'boss_death') {
        const boss = sim.enemies.find(e => e.id === event.id);
        const loot = Object.entries(event.ores || {}).filter(([, n]) => n > 0).map(([k, n]) => `${R.ORES[k]?.name || k} ${n}`).join('، ');
        say(`سقط ${boss ? boss.name : 'الزعيم'}! البوابة انفتحت${loot ? ` — غنيمة: ${loot}` : ''}.`);
        pushFloater(event.x, event.y - 20, 'سقط الزعيم!', '#ffd166', 15);
        Object.entries(event.ores || {}).filter(([, n]) => n > 0).forEach(([k, n], i) => pushFloater(event.x + (i - 0.5) * 30, event.y - 44 - i * 12, `+${n} ${R.ORES[k]?.name || k}`, '#9fe8ff', 11));
        spawnBurst(event.x, event.y, '#ffd166', 28);
      } else if (event.type === 'enemy_death') {
        pushFloater(event.x, event.y - 12, '+1', '#ffd166');
      } else if (event.type === 'hurt') {
        combo = 0; comboUntil = 0;
      } else if (event.type === 'milestone') {
        pushFloater(event.x, event.y - 18, `+${event.gold} ذهب`, '#ffd166', 13);
        pushFloater(event.x, event.y - 34, event.label, '#7dffd4', 10);
        feedback(`معلم: ${event.label} — +${event.gold} ذهب من مكافأة الجولة`);
        spawnBurst(event.x, event.y, '#ffd166'); requestHitStop(30);
      } else if (event.type === 'ore') {
        const def = R.ORES?.[event.ore];
        if (def) pushFloater(event.x, event.y - 6, `+${event.count} ${def.name}`, '#9fe8ff', 11);
      } else if (event.type === 'chest') {
        pushFloater(event.x, event.y - 10, 'صندوق!', '#ffd166', 13);
        feedback('صندوق كنز — ذهب خام وبلّور وحمم أُضيفت لمخزنك بعد انتهاء الجولة.');
        spawnBurst(event.x, event.y, '#ffd166', 18);
      } else if (event.type === 'vein_hit') {
        pushFloater(event.x, event.y - 10, `-1 · ${event.hp}/${event.maxHp}`, '#c4b5fd', 12);
        feedback(`العرق النادر ${event.hp}/${event.maxHp} — أكمل الضرب قبل أن يتصلّب (${Math.ceil((event.ticks || 90) / R.FPS)} ثانية).`);
      } else if (event.type === 'vein_harden') {
        pushFloater(event.x, event.y - 14, 'تصلّب!', '#9fb4c4', 12);
        feedback('تصلّب العرق النادر من جديد — اضربه ثلاث ضربات متتابعة لكسره.');
      } else if (event.type === 'vein_break') {
        const loot = Object.entries(event.ores || {}).filter(([, n]) => n > 0).map(([k, n]) => `${R.ORES[k]?.name || k} ${n}`).join('، ');
        pushFloater(event.x, event.y - 16, 'العرق النادر!', '#ffd166', 14);
        if (loot) pushFloater(event.x, event.y - 34, loot, '#9fe8ff', 11);
        eventBanner('العرق النادر', `كسرته! ${loot ? `${loot} إلى مخزنك` : ''}.`, 260);
        doShake(0.35); haptic('win'); spawnBurst(event.x, event.y, '#c4b5fd', 22);
      } else if (event.type === 'fork_safe') {
        pushFloater(event.x, event.y - 12, 'فتح آمن', '#7dffd4', 13);
        eventBanner('المفترق — أمان', event.healed ? 'خام متوسط وقلب مستعاد. اضربه مرتين أخريين بسرعة للجيب الغني — على مسؤوليتك.' : 'خام متوسط في حقيبتك. اضربه مرتين أخريين بسرعة للجيب الغني — على مسؤوليتك.', 300);
      } else if (event.type === 'fork_rich') {
        const loot = Object.entries(event.ores || {}).filter(([, n]) => n > 0).map(([k, n]) => `${R.ORES[k]?.name || k} ${n}`).join('، ');
        pushFloater(event.x, event.y - 16, 'الجيب الغني!', '#ffd166', 14);
        if (loot) pushFloater(event.x, event.y - 34, loot, '#9fe8ff', 11);
        eventBanner('المفترق — جشع', `خام نادر ${loot ? `${loot} ` : ''}— لكن ${event.guards || 2} من حرّاس الجيب استيقظوا.`, 340);
        doShake(0.4); haptic('heavy');
      } else if (event.type === 'fork_lock') {
        pushFloater(event.x, event.y - 12, event.choice === 'safe' ? 'اخترت الأمان' : 'انتهى الوقت', '#9fb4c4', 11);
      } else if (event.type === 'ore_wind') {
        eventBanner('نسمة الخام', 'ثلاث بلورات ظهرت قرب المفترق — اقفز والتقطها قبل أن تذهب مع الريح.', 320);
        feedback('نسمة خام: ثلاث بلورات فوق أرض المفترق — اقفز لالتقاطها.');
        spawnBurst(event.x, event.y, '#ffd166', 16);
      }

      if (!reduced) {
        if (event.type === 'mine') {
          particles.push({ x: event.x, y: event.y, vx: 0, vy: 0, life: 7, color: '#fff6c9', size: 8, glow: true });
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
        } else if (event.type === 'hit' && event.damage === 0) {
          for (let i = 0; i < 6; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 3.4, vy: -0.8 - Math.random() * 1.4, life: 14, color: i % 2 ? '#dfeaf2' : '#8fa3b3', size: 2.2, glow: true });
        } else if (event.type === 'hit') {
          for (let i = 0; i < 10; i++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 2.8, vy: -1.4 - Math.random() * 1.2, life: 20, color: i % 3 === 0 ? '#ff6b6b' : '#ffa94d', size: 3.4, glow: true });
        } else if (event.type === 'boss_slam' || event.type === 'boss_crash') {
          for (let i = 0; i < 14; i++) particles.push({ x: event.x + (i - 7) * 9, y: 298, vx: (i - 7) * 0.35 + (Math.random() - 0.5), vy: -0.8 - Math.random() * 1.6, life: 24, color: i % 2 ? '#8f8272' : '#b8ab96', size: 3.2, glow: false });
          particles.push({ x: event.x, y: 296, vx: 0, vy: 0, life: 20, color: '#ffd9a055', size: 30, ring: true });
        } else if (event.type === 'boss_charge') {
          for (let i = 0; i < 8; i++) particles.push({ x: event.x + (Math.random() - 0.5) * 30, y: 296, vx: (Math.random() - 0.5) * 2.4, vy: -0.6 - Math.random() * 1.2, life: 22, color: i % 2 ? '#8f8272' : '#b8ab96', size: 3, glow: false });
        } else if (event.type === 'boss_enrage' || event.type === 'boss_wake') {
          particles.push({ x: event.x, y: event.y + 30, vx: 0, vy: 0, life: 24, color: event.type === 'boss_enrage' ? '#ff5a3688' : '#ffd16688', size: 34, ring: true });
        } else if (event.type === 'boss_stun') {
          for (let i = 0; i < 6; i++) particles.push({ x: event.x + (Math.random() - 0.5) * 24, y: event.y - 4, vx: (Math.random() - 0.5) * 1.2, vy: -1.2 - Math.random() * 0.8, life: 26, color: '#ffe28a', size: 3, glow: true });
        } else if (event.type === 'boss_death') {
          for (let i = 0; i < 30; i++) particles.push({ x: event.x + (Math.random() - 0.5) * 50, y: event.y + (Math.random() - 0.5) * 40, vx: (Math.random() - 0.5) * 4, vy: -2.4 - Math.random() * 2.6, life: 48, color: i % 3 === 0 ? '#ffd166' : i % 3 === 1 ? '#ff9b5a' : '#a78bfa', size: 4.4, glow: true, trail: i < 6 });
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
    for (const f of floaters) {
      f.y += f.vy; f.vy *= 0.93; f.life--;
      if (f.scale > 1) f.scale = Math.max(1, f.scale - 0.05);
    }
    floaters = floaters.filter(f => f.life > 0);
    for (const b of beams) b.life--;
    beams = beams.filter(b => b.life > 0);
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

  // خطوة محاكاة واحدة: تسجيل الإدخال ← R.step ← أحداث العرض. يستعملها حلقة الزمن الحقيقي ومُغذّي اختبار المتصفح بلا فرق.
  function advance(mask) {
    const hpBefore = sim.rocks.map(r => r.hp);
    record(mask); R.step(sim, mask);
    const broken = sim.rocks.filter((r, i) => hpBefore[i] > 0 && r.hp === 0);
    consumeEvents(broken);
    if (sim.tick % 120 === 0) save();
  }
  // اختبار المتصفح فقط: يمرّر حركات مسجّلة عبر المسار نفسه (HUD والأحداث والإنهاء والإرسال) دون انتظار 60 إطاراً في الثانية.
  // الخادم يعيد المحاكاة من الصفر ويرفض ما يخالف الزمن الحقيقي، فلا يمنح هذا المدخل أي ميزة.
  let feedIndex = 0, feedFrame = 0;
  function feed(segments, untilTick = Infinity) {
    let fed = 0;
    while (running && feedIndex < segments.length && sim.status === 'playing' && sim.tick < untilTick) {
      const seg = segments[feedIndex];
      advance(seg.mask); fed++;
      if (++feedFrame >= seg.frames) { feedIndex++; feedFrame = 0; }
    }
    hud(); draw();
    if (sim.status !== 'playing' && running) finish();
    return { tick: sim.tick, status: sim.status, fed };
  }

  function frame(time) {
    raf = 0;
    if (!running || paused) return;
    if (!visible()) { pause(); return; }
    frameTime = time;
    if (hitStopUntil > time) { last = time; draw(); schedule(); return; }
    if (!last) last = time;
    accumulator += Math.min(0.1, (time - last) / 1000); last = time;
    let count = 0;
    while (accumulator >= R.DT && count++ < 6 && sim.status === 'playing') {
      let mask = 0;
      for (const k of keys) mask |= keyMap[k] || 0;
      for (const v of pointers.values()) mask |= v;
      for (const v of pulses.values()) mask |= v; // quick taps survive until one physics step
      pulses.clear();

      // العصا التناظرية: منطقة ميتة تمنع الحركة غير المقصودة، ودفعٌ جزئي = مشي (SOFT) ودفعٌ كامل = جري.
      if (joystickActive) {
        const ax = Math.abs(joystickX), dead = joystickDeadZone;
        if (ax > dead) {
          mask |= joystickX < 0 ? 1 : 2; // LEFT / RIGHT
          if (ax < 0.62) mask |= 512;    // SOFT: 55% من سرعة الجري
        }
      }

      if (inputs.length >= R.MAX_SEGMENTS && inputs[inputs.length - 1].mask !== mask) {
        pause(); say('وصلت إلى حد تسجيل الحركات؛ أعد بدء الجولة.'); return;
      }
      advance(mask); accumulator -= R.DT;
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
      const unlockedBefore = unlockedMines();
      bridge.adopt(result.profile);
      const opened = unlockedMines(result.profile?.state).filter(z => !unlockedBefore.includes(z));
      const duelReceipt = result.mode === 'duel';
      el('platform-title').textContent = duelReceipt
        ? (result.won ? 'انتصرت في المبارزة!' : 'سقطت في المبارزة')
        : (result.won ? 'وصلت إلى قلب المنجم!' : 'انتهت الجولة — جرّب من جديد');
      const oreLine = Object.entries(result.ores || {}).filter(([, v]) => v > 0)
        .map(([k, v]) => `${R.ORES[k].name} ${v}`).join('، ') || 'لا خامات';
      const mineName = R.MINES[result.zone || 0]?.name;
      renderSummary(null, result);
      const unlockLine = opened.length ? ` فُتح منجم جديد: ${opened.map(z => R.MINES[z].name).join('، ')}.` : '';
      el('platform-message').textContent = duelReceipt
        ? `${result.duel?.hearts ?? 0} قلوب متبقية · ${result.duel?.blocks ?? 0} صدّة ناجحة · ${Math.floor(result.duration)} ثانية. نتيجتك مؤكدة: +${result.gold} ذهب · +${result.xp} خبرة${result.duelCap ? ` (سقف المبارزات اليومي ${result.duelCap} ذهب)` : ''}.`
        : `${mineName ? `${mineName} · ` : ''}${result.gems} بلورات · ${result.mined} صخور · ${Math.floor(result.duration)} ثانية. نتيجتك مؤكدة: +${result.gold} ذهب (منها ${result.milestoneGold || 0} من المعالم) · ${result.milestones?.length || 0} معالم · خامات أُضيفت للمخزن: ${oreLine}.${unlockLine}`;
      pending = null; ticket = null; shake = 0;
      try { localStorage.removeItem(storageKey()); } catch (_) {}
      say(`محفوظ على الخادم: ${result.score} نقطة · +${result.gold} ذهب افتراضي · +${result.xp} خبرة${result.duplicate ? ' — تأكيد سابق، بلا مكافأة مكررة' : ''}${result.reason === 'cooldown' ? ' — مهلة المكافأة: 20 ثانية بين جائزتي مغامرة' : ''}${result.reason === 'daily_cap' ? ' — وصلت سقف 10,000 ذهب اليومي من المناجم' : ''}`);
      el('platform-start').disabled = false;
    } catch (e) {
      say(`${e.message || 'انقطع الاتصال'}. النتيجة محفوظة محليًا؛ أعد الإرسال، ولا تبدأ حسابًا آخر.`);
      el('platform-retry').hidden = false; el('platform-discard').hidden = false;
    } finally { submitting = false; }
  }

  // ===== V6: ملخص الجولة وسطر «لماذا جولة أخرى؟» =====
  const oreLineOf = ores => Object.entries(ores || {}).filter(([, v]) => v > 0)
    .map(([k, v]) => `${R.ORES[k]?.name || k} ${v}`).join('، ') || 'لا خامات';
  function summaryRow(label, value) {
    const r = document.createElement('div'); r.className = 'run-row';
    const l = document.createElement('span'); l.textContent = label;
    const v = document.createElement('b'); v.textContent = value;
    r.appendChild(l); r.appendChild(v);
    return r;
  }
  function nextStepHint(receipt) {
    let st = null;
    try { st = typeof state !== 'undefined' && state ? state : null; } catch (_) { st = null; }
    if (st && R.mineStatus) {
      for (let z = 0; z < (R.MINES?.length || 0); z++) {
        const status = R.mineStatus(z, st.mines, st.equipment);
        if (status && !status.unlocked) {
          const need = status.needs.find(n => !n.ok);
          if (need) return `لماذا جولة أخرى؟ لفتح ${R.MINES[z].name}: ${need.label}.`;
        }
      }
    }
    if (st && R.EQUIPMENT_ORDER) {
      const lvl = R.normalizeLoadout(st.equipment);
      let best = null;
      for (const id of R.EQUIPMENT_ORDER) {
        const cost = R.equipCost(id, lvl[id]); if (!cost) continue;
        const needGold = Math.max(0, cost.gold - (Number(st.gold) || 0));
        const needOre = Object.entries(cost.ores || {}).map(([k, n]) => [k, Math.max(0, n - ((st.ores || {})[k] || 0))]).filter(([, n]) => n > 0);
        const score = needGold + needOre.reduce((a, [, n]) => a + n * 12, 0);
        if (!best || score < best.score) best = { id, cost, needGold, needOre, score };
      }
      if (best) {
        const orePart = best.needOre.map(([k, n]) => `${R.ORES[k]?.name || k} ${n}`).join('، ');
        if (!best.needGold && !orePart) return `جاهز الآن: رقِّ «${R.EQUIPMENT[best.id].name}» في الورشة — ${R.effectText(best.id, lvl[best.id] + 1)}.`;
        const needs = [best.needGold ? `${best.needGold} ذهب` : '', orePart].filter(Boolean).join(' و');
        return `لماذا جولة أخرى؟ «${R.EQUIPMENT[best.id].name}» تنتظرك: تحتاج ${needs} — ${R.EQUIPMENT[best.id].blurb}.`;
      }
    }
    if (receipt && receipt.mode === 'duel') {
      return receipt.won
        ? 'لماذا مبارزة أخرى؟ كل عمق يقدّم نمط خصم أسرع (المدرّع ثم سيّاف الريح) وذهبًا أكثر لكل انتصار.'
        : 'لماذا مبارزة أخرى؟ اقرأ إنذار الخصم: الكاسرة تُقفز أو تُراوغ، والضربة القريبة تُصدّ — والصدّ يستهلك درعك.';
    }
    if (receipt && receipt.goal && !receipt.goal.done) return `لماذا جولة أخرى؟ أكمل هدف «${receipt.goal.name}» لتحصل على خام إضافي يسرّع ترقية الورشة.`;
    return 'لماذا جولة أخرى؟ جرّب هدفًا مختلفًا: كسر العرق النادر أو الجشع في المفترق يمنحك خامًا نادرًا للورشة.';
  }
  // stateLike = حالة المحاكاة فوراً، وreceipt = نتيجة الخادم المؤكَّدة (تستبدلها عند وصولها)
  function renderSummary(stateLike, receipt) {
    const box = el('platform-summary'), rows = el('summary-rows');
    if (!box || !rows) return;
    // المبارزة لها ملخصها: صحة الخصم والقلوب والصدّات — لا صخور ولا بلورات ولا مفترق.
    const mode = receipt?.mode || stateLike?.mode || 'mine';
    const duelRun = mode === 'duel';
    const gs = receipt?.goal || (duelRun
      ? (stateLike && R.duelStatus ? R.duelStatus(stateLike) : null)
      : (R.goalStatus && stateLike ? R.goalStatus(stateLike) : null));
    const badge = el('summary-goal');
    const titleEl = el('summary-title');
    if (titleEl) titleEl.textContent = duelRun ? 'ملخص المبارزة' : 'ملخص الجولة';
    if (duelRun) {
      const won = receipt ? receipt.won !== false : stateLike?.status === 'won';
      if (badge) {
        badge.textContent = won ? 'انتصار' : 'خسارة';
        badge.className = `run-badge ${won ? 'ok' : 'fail'}`;
      }
      const rivalHp = Math.max(0, receipt?.duel ? receipt.duel.rivalHp : (gs?.rivalHp || 0));
      const rivalMax = Math.max(1, receipt?.duel ? receipt.duel.rivalMaxHp : (gs?.rivalMaxHp || 1));
      const hearts = Math.max(0, receipt?.duel ? receipt.duel.hearts : (gs?.hearts || 0));
      const blocks = Math.max(0, receipt?.duel ? receipt.duel.blocks : (gs?.blocks || 0));
      const maxHearts = stateLike?.player?.maxHearts || 3;
      const secs = Math.floor(receipt ? receipt.duration : (stateLike?.tick || 0) / R.FPS);
      rows.innerHTML = '';
      rows.appendChild(summaryRow('الخصم', gs?.name || 'المبارز'));
      rows.appendChild(summaryRow('صحة الخصم', rivalHp <= 0 ? 'أُسقط بالكامل' : `${Math.ceil(rivalHp)} من ${rivalMax}`));
      rows.appendChild(summaryRow('قلوبك', `${hearts} من ${maxHearts}`));
      rows.appendChild(summaryRow('صدّات ناجحة', String(blocks)));
      rows.appendChild(summaryRow('الزمن', `${secs} ثانية`));
      if (receipt) rows.appendChild(summaryRow('المكافأة المؤكدة', `+${receipt.gold} ذهب · +${receipt.xp} خبرة`));
      const next = el('summary-next');
      if (next) next.textContent = nextStepHint(receipt);
      box.hidden = false;
      scheduleOverlayFit();
      return;
    }
    if (badge && gs) {
      badge.textContent = gs.done ? `الهدف محقّق: ${gs.name}` : `الهدف: ${gs.name}`;
      badge.className = `run-badge ${gs.done ? 'ok' : 'fail'}`;
    }
    rows.innerHTML = '';
    if (gs) rows.appendChild(summaryRow(`هدف «${gs.name}»`, gs.id === 'speed' ? `${gs.done ? 'قبل المهلة' : `${gs.now}ث`} / ${gs.target}ث` : `${Math.min(gs.target, gs.now)}/${gs.target}`));
    const choice = receipt ? receipt.choice : stateLike?.choice;
    rows.appendChild(summaryRow('المفترق', choice === 'rich' ? 'جيب غني + حارسان' : choice === 'safe' ? 'فتح آمن' : 'لم تفتحه'));
    rows.appendChild(summaryRow('العرق النادر', (receipt ? receipt.veinBroken : stateLike?.veinBroken) ? 'مكسور — خام نادر' : 'لم يُكسر'));
    rows.appendChild(summaryRow('بلورات · صخور', `${receipt ? receipt.gems : (stateLike?.collected ?? 0)} · ${receipt ? receipt.mined : (stateLike?.mined ?? 0)}`));
    rows.appendChild(summaryRow('الزمن', `${Math.floor(receipt ? receipt.duration : (stateLike?.tick || 0) / R.FPS)} ثانية`));
    rows.appendChild(summaryRow('خامات الجولة', oreLineOf(receipt ? receipt.ores : (R.oreSummary && stateLike ? R.oreSummary(stateLike) : {}))));
    if (receipt) rows.appendChild(summaryRow('المكافأة المؤكدة', `+${receipt.gold} ذهب · +${receipt.xp} خبرة`));
    const next = el('summary-next');
    if (next) next.textContent = nextStepHint(receipt);
    box.hidden = false;
    scheduleOverlayFit();
  }

  function finish() {
    if (!running) return;
    running = false; paused = false; clearInput(); cancelAnimationFrame(raf); raf = 0;
    const won = sim.status === 'won';
    const duel = sim.mode === 'duel';
    const rival = duel ? (sim.enemies.find(e => e.type === 'rival') || sim.enemies[0]) : null;
    // سطر واحد قصير فقط: التفصيل كله في بطاقة الملخص تحته (لا تكرار، ولا غطاء يفيض).
    const summaryLead = duel
      ? `${rival?.name || 'المبارز'} · ${Math.floor(sim.tick / R.FPS)} ثانية · ${won ? 'أُسقط الخصم' : `بقي له ${Math.max(0, Math.ceil(rival?.hp || 0))} من ${rival?.maxHp || 0}`}`
      : `${sim.collected} بلورات · ${sim.mined} صخور · ${Math.floor(sim.tick / R.FPS)} ثانية${won ? ' · هدف محقّق' : ''}`;
    renderSummary(sim, null);
    overlay(duel ? (won ? 'انتصرت في المبارزة!' : 'سقطت في المبارزة')
      : (won ? 'وصلت إلى قلب المنجم!' : 'المصباح ينتظر عودتك'), summaryLead);
    if (duel) el('platform-start').textContent = 'مبارزة أخرى';
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
    refreshPreview();
    window.dispatchEvent(new CustomEvent('platform-config-change', { detail: { hero: heroId } })); // ضربات الكسر تتبع قوة الشخصية
    // subtle haptic on hero switch
    haptic('light');
  }

  // يعيد بناء مشهد الانتظار بعد تغيّر البطل أو المنجم أو المعدات (لا يلمس جولة جارية ولا نتيجة معلّقة).
  function refreshPreview() {
    if (running || pending || starting || restoring) return;
    sim = R.create(currentHero, seedOf(ticket), configFor(ticket));
    particles = []; shake = 0; resetImpact();
    hud(); draw();
  }
  function setZone(zone, announce = true) {
    const z = Number(zone);
    if (!Number.isInteger(z) || z < 0 || z >= (R.MINES?.length || 1) || z === selectedZone) return false;
    selectedZone = z;
    try { localStorage.setItem('platform-zone', String(z)); } catch (_) {}
    refreshPreview();
    if (announce) window.dispatchEvent(new CustomEvent('platform-config-change', { detail: { zone: z } }));
    return true;
  }

  async function start() {
    if (starting || restoring || submitting || pending) return;
    pause();
    starting = true; el('platform-start').disabled = true; clearInput(); cancelAnimationFrame(raf); raf = 0;
    audioUnlock();
    try {
      await bridge.ready(); owner = bridge.user();
      if (owner) {
        // التذكرة الحالية (جولة موقوفة مثلاً) لا تُستبدل إلا بعد نجاح الطلب والتحقق من نسخة المستوى
        const issued = await request('/api/platform/start', { zone: selectedZone, goal: selectedGoal, mode: selectedMode });
        if (issued.version !== R.VERSION) throw new Error('حدّث الصفحة للحصول على نسخة المستوى الحالية');
        ticket = issued;
        const mine = R.MINES[ticket.config?.zone ?? selectedZone];
        const goalDef = R.GOALS?.[ticket.config?.goal ?? selectedGoal];
        const duelTicket = (ticket.config?.mode || selectedMode) === 'duel';
        say(duelTicket
          ? `مبارزة حيّة ضد «مبارز الظلال» — تحرّك، اقفز فوق الموجة، اضرب في النافذة، وادفع الدرع بـ S عند الإنذار.`
          : `${mine ? `${mine.name}: ` : ''}هدف الجولة «${goalDef?.name || ''}» — ${goalDef?.hint || ''}. شرط الخروج: 3 بلورات وصخرة${R.levelFor(ticket.config?.zone ?? selectedZone).boss ? '، ثم اهزم الزعيم' : ''}. ${R.CHARACTERS[currentHero]?.name || 'عامل المنجم'} — تحرّك، اقفز، وعدّن بحكمة.`);
      } else { ticket = null; say('تدريب بلا اتصال — لا مكافأة. يمكنك اللعب ثم إعادة المحاولة متصلًا.'); }
      const summaryBox = el('platform-summary');
      if (summaryBox) summaryBox.hidden = true;
      const leadMsg = el('platform-message');
      if (leadMsg) leadMsg.textContent = OVERLAY_LEAD;
      const helpBox = el('overlay-help');
      if (helpBox) helpBox.open = false;
      const eventBox = el('platform-event');
      if (eventBox) { eventBox.hidden = true; eventBox.classList.remove('show'); }
      eventUntil = 0;
      sim = R.create(currentHero, seedOf(ticket), configFor(ticket)); inputs = []; particles = []; shake = 0; resetImpact(); feedIndex = 0; feedFrame = 0; running = true; paused = false; save();
      resume();
    } catch (e) {
      // منجم مقفل (حساب آخر/تقدّم أقدم): نرجع للمنجم الأول بدل أن يبقى اللاعب عالقاً عند الخطأ نفسه
      if (/مقفل/.test(e.message || '') && selectedZone !== 0) setZone(0);
      say(`تعذّر بدء الجولة: ${e.message}. جرّب مجددًا عند الاتصال.`);
    }
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
    const storedConfig = configFor(stored.ticket); // لقطة المنجم والهدف والمعدات المثبّتة في التذكرة، لا الحالية
    if (Number.isInteger(storedConfig.goal) && storedConfig.goal !== selectedGoal) { selectedGoal = storedConfig.goal; try { localStorage.setItem('platform-goal', String(selectedGoal)); } catch (_) {} syncGoalButtons(); }
    const replay = stored.inputs?.length ? R.replay(stored.inputs, currentHero, seedOf(stored.ticket), storedConfig) : { ok: true, state: R.create(currentHero, seedOf(stored.ticket), storedConfig) };
    if (!replay.ok) { say('ملف جولة غير صالح؛ يمكنك البدء مجددًا.'); return; }
    ticket = stored.ticket; inputs = stored.inputs || []; sim = replay.state;
    resetFeedback(); hud(); draw();
    if (sim.status !== 'playing') {
      pending = { id: ticket.id, inputs, hero: currentHero }; el('platform-start').disabled = true;
      overlay(sim.status === 'won' ? 'استرجاع نتيجة جولتك' : 'جولة سابقة انتهت', 'جارٍ استرجاع تأكيد الخادم. إعادة الطلب لا تضاعف الجائزة.');
      submit();
    } else if (sim.status === 'playing') {
      try {
        const current = await request('/api/platform/start', { resume: true }); // استئناف: لا يستبدل الجولة بتغيّر المعدات
        if (current.id !== ticket.id) {
          // التذكرة المحفوظة لم تعد جولة الخادم النشطة: نُفرغ كل حالة الجولة حتى لا يبقى اللاعب محبوسًا
          // خلف جولة منتهية الصلاحية (لا «جولة جارية» وهمية تمنع بدء مبارزة).
          ticket = null; inputs = []; running = false; paused = false;
          say('انتهت صلاحية الحفظ السابق؛ ابدأ جولة جديدة.');
          return;
        }
        running = true; paused = false; pause();
      } catch (_) { running = true; paused = false; pause(); say('تعذّر الاتصال؛ جولتك محفوظة محليًا ويمكنك متابعتها. ستُرسل النتيجة عند عودة الشبكة قبل انتهاء التذكرة.'); }
    }
  }

  // --- Input: pointer + keyboard, prevent page scroll ---
  for (const button of document.querySelectorAll('[data-platform-input]')) {
    button.addEventListener('pointerdown', e => {
      e.preventDefault(); if (layoutEditing || !running || paused) return;
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
    // نصف قطر الحركة يتبع حجم القاعدة الفعلي (يتغيّر مع إعداد الحجم)، فلا يخرج المقبض عن قاعدته.
    const maxRadiusOf = () => Math.max(22, joystick.getBoundingClientRect().width * 0.34);

    const updateJoystick = (clientX, clientY) => {
      const rect = joystick.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const maxRadius = maxRadiusOf();
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
      if (layoutEditing || !running || paused) return;
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

  // تطبيق إعدادات التحكم على CSS: الحجم والشفافية فقط، فلا يتغيّر منطق اللعب ولا الحساب.
  const CONTROL_SIZES = { sm: 0.86, md: 1, lg: 1.18 };
  const CONTROL_OPACITY = { sm: 0.55, md: 0.78, lg: 1 };
  function applyControlSettings() {
    const box = document.querySelector('.mine-controls');
    if (box?.style) {
      box.style.setProperty('--ctl-scale', String(CONTROL_SIZES[controlSettings.size] || 1));
      box.style.setProperty('--ctl-opacity', String(CONTROL_OPACITY[controlSettings.opacity] || 0.78));
    }
    joystickDeadZone = JOYSTICK_SENSITIVITY[controlSettings.sensitivity] || 0.2;
    document.querySelectorAll('[data-ctl-size]').forEach(b => b.classList.toggle('active', b.dataset.ctlSize === controlSettings.size));
    document.querySelectorAll('[data-ctl-opacity]').forEach(b => b.classList.toggle('active', b.dataset.ctlOpacity === controlSettings.opacity));
    document.querySelectorAll('[data-ctl-sensitivity]').forEach(b => b.classList.toggle('active', b.dataset.ctlSensitivity === controlSettings.sensitivity));
    const hapticBtn = el('ctl-haptics');
    if (hapticBtn) { hapticBtn.setAttribute('aria-pressed', String(controlSettings.haptics !== false)); hapticBtn.classList.toggle('active', controlSettings.haptics !== false); }
    // أزرار اللمس: تُخفى تلقائيًا على الكمبيوتر (لوحة المفاتيح)، وتظهر على الجوال والتابلت
    const padShown = touchPadVisible();
    if (box?.classList) box.classList.toggle('touch-hidden', !padShown);
    const stickBtn = el('ctl-stick');
    if (stickBtn) {
      const mode = controlSettings.touchPad || 'auto';
      stickBtn.setAttribute('aria-pressed', String(padShown));
      stickBtn.classList.toggle('active', padShown);
      stickBtn.textContent = mode === 'auto' ? 'تلقائي' : padShown ? 'ظاهرة دائمًا' : 'مخفية دائمًا';
    }
    const keyHint = el('platform-keyhint');
    if (keyHint) keyHint.hidden = padShown;
  }
  function saveControlSettings() {
    try { localStorage.setItem('platform-controls', JSON.stringify(controlSettings)); } catch (_) {}
    applyControlSettings();
  }
  document.querySelectorAll('[data-ctl-size]').forEach(b => b.addEventListener('click', () => { controlSettings.size = b.dataset.ctlSize; saveControlSettings(); }));
  document.querySelectorAll('[data-ctl-opacity]').forEach(b => b.addEventListener('click', () => { controlSettings.opacity = b.dataset.ctlOpacity; saveControlSettings(); }));
  document.querySelectorAll('[data-ctl-sensitivity]').forEach(b => b.addEventListener('click', () => { controlSettings.sensitivity = b.dataset.ctlSensitivity; saveControlSettings(); }));
  el('ctl-haptics')?.addEventListener('click', () => { controlSettings.haptics = controlSettings.haptics === false; saveControlSettings(); });
  el('ctl-stick')?.addEventListener('click', () => {
    const i = TOUCH_ORDER.indexOf(controlSettings.touchPad || 'auto');
    controlSettings.touchPad = TOUCH_ORDER[(i + 1) % TOUCH_ORDER.length];
    saveControlSettings();
  });
  // تغيّر نوع المؤشر (تدوير الجهاز، لوحة مفاتيح تُوصل بالتابلت): نعيد التقييم في وضع auto
  try { window.matchMedia?.('(pointer: coarse)')?.addEventListener?.('change', () => applyControlSettings()); } catch (_) {}
  applyControlSettings();

  // --- تخصيص مواضع التحكم (سحب) — يُحفظ في localStorage لهذا الجهاز فقط ---
  // لا يمسّ الحساب ولا يُرسل للخادم، ولا يغيّر أي بت إدخال: الإزاحة بصرية بحتة (style.translate).
  const LAYOUT_KEY = 'platform-control-layout';
  const LAYOUT_LIMIT = 150; // أقصى إزاحة لكل عنصر بالبكسل، فلا يهرب عن حدود الشاشة
  const clampOff = v => Math.max(-LAYOUT_LIMIT, Math.min(LAYOUT_LIMIT, Math.round(Number(v) || 0)));
  let controlLayout = {};
  try {
    const savedLayout = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (savedLayout && typeof savedLayout === 'object') {
      for (const [k, v] of Object.entries(savedLayout)) {
        if (v && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y))) controlLayout[k] = { x: clampOff(v.x), y: clampOff(v.y) };
      }
    }
  } catch (_) { controlLayout = {}; }
  let layoutEditing = false;
  const layoutKeyOf = node => (joystick && node === joystick) ? 'joy' : String(node?.dataset?.platformInput ?? '');
  function applyControlLayout() {
    const targets = [joystick, ...document.querySelectorAll('[data-platform-input]')].filter(Boolean);
    for (const node of targets) {
      const off = controlLayout[layoutKeyOf(node)];
      if (node.style) node.style.translate = off ? `${off.x}px ${off.y}px` : '';
    }
  }
  function saveControlLayout() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(controlLayout)); } catch (_) {} }
  function setLayoutEditing(on) {
    layoutEditing = Boolean(on);
    document.querySelector('.mine-controls')?.classList?.toggle('ctl-editing', layoutEditing);
    const btn = el('ctl-edit');
    if (btn) { btn.classList.toggle('active', layoutEditing); btn.setAttribute('aria-pressed', String(layoutEditing)); }
    const hint = el('ctl-layout-hint'); if (hint) hint.hidden = !layoutEditing;
    if (layoutEditing) { clearInput(); pause(); say('وضع التحريك: اسحب العصا والأزرار إلى موضعها المريح.'); }
    else say('توقف التحريك؛ المواضع محفوظة على هذا الجهاز.');
  }
  el('ctl-edit')?.addEventListener('click', () => setLayoutEditing(!layoutEditing));
  el('ctl-reset')?.addEventListener('click', () => {
    controlLayout = {}; try { localStorage.removeItem(LAYOUT_KEY); } catch (_) {}
    controlSettings = { ...CONTROL_DEFAULTS }; saveControlSettings(); applyControlLayout();
    say('أُعيد الوضع الافتراضي للتحكم.');
  });
  // السحب نفسه: حركة الإصبع تترجم العنصر فقط، ولا تُسجَّل كإدخال لعب (الحارسان أعلاه يمنعان ذلك).
  function bindLayoutDrag(node) {
    if (!node) return;
    node.addEventListener('pointerdown', e => {
      if (!layoutEditing) return;
      e.preventDefault(); e.stopPropagation();
      const key = layoutKeyOf(node);
      const base = controlLayout[key] || { x: 0, y: 0 };
      const ox = e.clientX, oy = e.clientY;
      let moved = false;
      node.setPointerCapture?.(e.pointerId);
      const onMove = ev => {
        if (ev.pointerId !== e.pointerId) return;
        if (!moved && Math.abs(ev.clientX - ox) + Math.abs(ev.clientY - oy) > 3) moved = true;
        controlLayout[key] = { x: clampOff(base.x + ev.clientX - ox), y: clampOff(base.y + ev.clientY - oy) };
        applyControlLayout();
      };
      const onUp = ev => {
        if (ev.pointerId !== e.pointerId) return;
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.removeEventListener('pointercancel', onUp);
        if (moved) { saveControlLayout(); say('حُفظ الموضع على هذا الجهاز.'); }
      };
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onUp);
    });
  }
  for (const node of [joystick, ...document.querySelectorAll('[data-platform-input]')]) bindLayoutDrag(node);
  applyControlLayout();

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
  // كثافة الغطاء تتبع حجم المشهد الفعلي (لا حجم النافذة): بلا تمرير على الهواتف القصيرة.
  const stageBox = canvas.parentElement;
  function syncStageDensity() {
    if (!stageBox?.classList) return;
    const h = stageBox.clientHeight || 0, w = stageBox.clientWidth || 0;
    stageBox.classList.toggle('stage-short', h > 0 && h < 400);
    stageBox.classList.toggle('stage-tight', h > 0 && h < 340);
    stageBox.classList.toggle('stage-narrow', w > 0 && w < 430);
    stageBox.classList.toggle('stage-ultra', h > 0 && h < 300);
    scheduleOverlayFit();
  }
  // فتح «كيف ألعب؟» يزيد الارتفاع: نعيد القياس، والشرح المفتوح لا يُخفى أبدًا.
  const helpToggle = el('overlay-help');
  if (helpToggle?.addEventListener) helpToggle.addEventListener('toggle', () => {
    el('platform-overlay')?.classList?.toggle('help-open', Boolean(helpToggle.open));
    scheduleOverlayFit();
  });
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { syncStageDensity(); draw(); }) : null;
  if (resizeObserver) resizeObserver.observe(canvas);
  else window.addEventListener('resize', () => { syncStageDensity(); draw(); });
  syncStageDensity();
  // أول قياس قد يسبق ظهور المشهد أو تحميل الخط: نعيده عند اكتمال تحميل الصفحة.
  window.addEventListener('load', () => scheduleOverlayFit());
  // اختيار الهدف (V6): لا يبدأ جولة ولا يمسّ تذكرة جارية، فقط يغيّر هدف الجولة القادمة.
  document.querySelectorAll('.goal-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (running || pending || submitting) { feedback('أنهِ الجولة الحالية أولًا لتغيير الهدف.'); return; }
      setGoal(btn.dataset.goal);
    });
  });
  syncGoalButtons();

  // إرشاد أول مرة: ثلاث خطوات قصيرة، قابل للتخطّي، ولا يتكرر على الجهاز.
  const coachSteps = [
    { title: 'اختر هدفك أولًا', text: 'لكل جولة هدف: جمع خام، أو كسر العرق النادر، أو الوصول قبل 75 ثانية. الهدف يغيّر ما تفعله داخل المنجم لا الشكل فقط.' },
    { title: 'في الطريق: عرق ومفترق', text: 'على أرض المفترق شيءان: العرق النادر (ثلاث ضربات متتابعة قبل أن يتصلّب) وصندوق المخاطرة (ضربة = فتح آمن، ثلاث ضربات سريعة = جيب غني مع حارسين).' },
    { title: 'ثم البوابة', text: 'اجمع 3 بلورات واكسر صخرة ليُفتح الخروج. في الختام ترى ملخص قراراتك وخاماتك، وما الترقية التي تقربك من جولة أقوى.' },
  ];
  let coachIndex = 0;
  const coachKey = 'platform-coach:v1';
  const coachSeen = () => { try { return localStorage.getItem(coachKey) === '1'; } catch (_) { return true; } };
  function showCoachStep() {
    const step = coachSteps[coachIndex];
    const box = el('platform-coach');
    if (!box || !step) return;
    box.hidden = false;
    const n = el('coach-step'), t = el('coach-title'), x = el('coach-text'), next = el('coach-next');
    if (n) n.textContent = `${coachIndex + 1}/${coachSteps.length}`;
    if (t) t.textContent = step.title;
    if (x) x.textContent = step.text;
    if (next) next.textContent = coachIndex === coachSteps.length - 1 ? 'ابدأ' : 'التالي';
  }
  function closeCoach() {
    const box = el('platform-coach');
    if (box) box.hidden = true;
    try { localStorage.setItem(coachKey, '1'); } catch (_) {}
  }
  function maybeCoach() {
    const box = el('platform-coach');
    if (!box) return;
    if (coachSeen() || running || pending) { box.hidden = true; return; }
    coachIndex = 0; showCoachStep();
  }
  el('coach-next')?.addEventListener('click', () => {
    coachIndex++;
    if (coachIndex >= coachSteps.length) closeCoach(); else showCoachStep();
  });
  el('coach-skip')?.addEventListener('click', closeCoach);

  el('platform-start').addEventListener('click', () => { setLayoutEditing(false); start(); });
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
  function updateMuteUI() {
    const btn = el('platform-mute');
    btn.setAttribute('aria-pressed', String(muted));
    // حدّث النص فقط: لا تستبدل محتوى الزر حتى لا تُحذف أيقونة SVG.
    const label = btn.querySelector?.('.mute-label');
    const text = muted ? 'صوت ×' : 'صوت ✓';
    if (label) label.textContent = text; else btn.textContent = text;
  }
  updateMuteUI();
  el('platform-mute').addEventListener('click', () => {
    muted = !muted; updateMuteUI();
    try { localStorage.setItem('platform-muted', String(muted)); } catch (_) {}
    if (muted) audio?.suspend?.()?.catch(() => {}); else audioUnlock();
  });

  // ===== معاينة الساحة الحيّة =====
  // لوحة «الساحة» تعرض المشهد الحقيقي (نفس المحرك ونفس الرسم) بجولة استعراضية حتمية:
  // لاعب آلي بسيط يقاتل مبارز المنجم. لا تمسّ الحساب ولا الجولة الجارية، وتتوقف فور مغادرة التبويب.
  const arenaCanvas = el('arena-preview');
  let arenaSim = null, arenaRaf = 0, arenaAcc = 0, arenaStamp = 0, arenaZone = 0, arenaOver = 0, arenaSeed = 7717, arenaHero = null;
  const arenaShown = () => Boolean(arenaCanvas && typeof arenaCanvas.getContext === 'function'
    && el('tab-arena')?.classList?.contains('active') && !document.hidden);
  function buildArenaSim() {
    if (!R?.create) return;
    arenaSeed = (arenaSeed * 1103515245 + 12345) % 2147483647;
    arenaSim = R.create(currentHero, arenaSeed, { zone: arenaZone, mode: 'duel' });
    arenaHero = currentHero;
    arenaOver = 0;
    // إطار المعاينة: البطل والخصم في كادر واحد (الجولة الحقيقية تبدأ من مواقعها الطبيعية)
    const p = arenaSim.player, rival = arenaSim.enemies[0];
    if (rival) {
      const minX = Number.isFinite(rival.minX) ? rival.minX : 280;
      const maxX = Number.isFinite(rival.maxX) ? rival.maxX : 460;
      rival.x = Math.max(minX, Math.min(maxX, 380));
      rival.vx = 0;
      p.x = Math.max(24, rival.x - 150);
      p.vx = 0;
    }
  }
  // مدخلات اللاعب الآلي: يلاحق الخصم، يقفز فوق الموجة، ويضرب عند المدى
  function arenaDemoMask(simNow) {
    const p = simNow.player, rival = simNow.enemies[0];
    if (!rival || simNow.status !== 'playing') return 0;
    let mask = 0;
    const cx = p.x + p.w / 2, rx = rival.x + rival.w / 2;
    // المسرح الاستعراضي يعرض المهارات الحقيقية: قفز فوق الموجة، صدّ الضربة القريبة، مراوغة الاندفاع
    if (rival.state === 'windup' && p.guard && p.guard.stamina > 24) {
      if (rival.attack === 'pound') mask |= R.INPUT.JUMP;
      else if (rival.attack === 'sweep') mask |= R.INPUT.DEFEND;
      else if (rival.attack === 'charge' && (p.dodge?.cooldown || 0) <= 0) mask |= R.INPUT.DODGE;
    }
    const incoming = (simNow.waves || []).some(w => Math.abs((w.x + w.w / 2) - cx) < 120);
    if (incoming && p.grounded) mask |= R.INPUT.JUMP;
    const d = rx - cx;
    if (Math.abs(d) > 42) mask |= d > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
    else if (p.attack <= 0 && !p.swing) mask |= (p.heavyCooldown <= 0 && simNow.tick % 150 > 100) ? R.INPUT.HEAVY : R.INPUT.ATTACK;
    return mask;
  }
  function arenaStep() {
    if (!arenaSim) return;
    if (arenaSim.status !== 'playing') { if (++arenaOver > 90) buildArenaSim(); return; }
    R.step(arenaSim, arenaDemoMask(arenaSim));
  }
  function arenaDraw() {
    if (!arenaSim || !arenaCanvas) return;
    // arena: true ← مسرح الساحة يرسم حلبة المبارزة (جمهور ومشاعل وأرض رملية) لا أنفاق المنجم
    try { renderer.draw(arenaCanvas, arenaSim, { arena: true, reduced, particles: [], shake: 0, floaters: [], beams: [] }); } catch (_) {}
  }
  // شريطا الصحة في كتلة المسرح: يُحدَّثان من حالة المحاكاة نفسها (لا رسم تخييلي)
  let arenaHudTick = 0;
  function arenaHud() {
    if (!arenaSim) return;
    const p = arenaSim.player, rival = arenaSim.enemies[0];
    const heroBar = el('arena-hp-hero'), rivalBar = el('arena-hp-rival');
    if (heroBar) heroBar.style.width = `${Math.max(0, Math.min(100, (p.hearts / Math.max(1, p.maxHearts)) * 100))}%`;
    if (rivalBar && rival) rivalBar.style.width = `${Math.max(0, Math.min(100, (rival.hp / Math.max(1, rival.maxHp)) * 100))}%`;
  }
  function arenaFrame(now) {
    arenaRaf = 0;
    if (!arenaShown()) return;
    const stamp = Number(now) || 0;
    const dt = arenaStamp ? Math.min(60, stamp - arenaStamp) : 16;
    arenaStamp = stamp; arenaAcc += dt;
    let steps = 0;
    while (arenaAcc >= 1000 / (R.FPS || 60) && steps < 3) { arenaStep(); arenaAcc -= 1000 / (R.FPS || 60); steps++; }
    arenaDraw();
    if (++arenaHudTick % 6 === 0) arenaHud();
    arenaRaf = requestAnimationFrame(arenaFrame);
  }
  function showArenaPreview(zone) {
    if (!arenaCanvas || typeof arenaCanvas.getContext !== 'function' || !R?.create) return false;
    const last = (R.MINES?.length || 1) - 1;
    const z = Math.max(0, Math.min(last, Number.isInteger(zone) ? zone : 0));
    if (z !== arenaZone || arenaHero !== currentHero || !arenaSim) { arenaZone = z; buildArenaSim(); }
    const label = el('arena-preview-rival');
    if (label) label.textContent = `${R.rivalFor?.(z)?.name || 'المبارز'} · ${R.MINES?.[z]?.name || ''}`;
    const heroLabel = el('arena-preview-hero');
    if (heroLabel) heroLabel.textContent = R.CHARACTERS?.[currentHero]?.name || 'المحارب';
    arenaStamp = 0; arenaAcc = 0;
    arenaDraw();
    if (!arenaRaf) arenaRaf = requestAnimationFrame(arenaFrame);
    return true;
  }
  function hideArenaPreview() {
    if (arenaRaf) cancelAnimationFrame(arenaRaf);
    arenaRaf = 0; arenaStamp = 0;
  }

  // Expose for tests and cross-module coordination
  window.PlatformGame = {
    pause, onShow, showArenaPreview, hideArenaPreview,
    // حالة المسرح الاستعراضي (لاختبار بصري حقيقي: هل يتقدّم؟ من الخصم المعروض؟)
    arenaInspect: () => ({ zone: arenaZone, tick: arenaSim?.tick ?? 0, running: Boolean(arenaRaf), rival: arenaSim?.enemies?.[0]?.name || null }), setHero, setZone, setGoal, refresh: refreshPreview, getZone: () => selectedZone, getGoal: () => selectedGoal, getHero: () => currentHero, unlockedMines, coach: maybeCoach,
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
      hud(); onShow();
    },
    inspect: () => ({
      tick: sim.tick, status: sim.status, pose: sim.player.pose,
      x: sim.player.x, y: sim.player.y, gems: sim.collected, mined: sim.mined,
      hearts: sim.player.hearts, running, paused, scheduled: Boolean(raf),
      ticket: ticket?.id, pending: Boolean(pending), hero: sim.player.hero,
      defeated: sim.defeated, reduced, zone: sim.zone,
      combo, comboPeak, floaters: floaters.length, floatersSpawned, hitStop: hitStopUntil > frameTime,
      milestones: sim.milestones?.length || 0, ores: R.oreSummary(sim),
      config: { zone: sim.zone, loadout: { ...sim.loadout } }, selectedZone,
      miningPower: sim.player.miningPower, speed: sim.player.speed, maxHearts: sim.player.maxHearts,
      rockMaxHp: sim.rocks[0]?.maxHp, robot: Boolean(sim.player.robot), beams: beams.length,
      boss: sim.bossId ? (() => { const b = sim.enemies.find(e => e.id === sim.bossId); return { name: b.name, state: b.state, hp: b.hp, maxHp: b.maxHp, enraged: b.enraged, defeated: sim.bossDefeated, waves: sim.waves.length, x: b.x }; })() : null,
      statusText: el('platform-status')?.textContent || '',
    }),
    feed, resetFeed() { feedIndex = 0; feedFrame = 0; },
    // يبدأ مبارزة حيّة من شاشة الساحة: نفس محرك الحركة، وضع duel فقط.
    startDuel(zone = 0) {
      if (running || pending) { say('أكمل الجولة الحالية أولًا.'); return false; }
      selectedMode = 'duel';
      try { localStorage.setItem('platform-mode', selectedMode); } catch (_) {}
      if (Number.isInteger(zone) && zone >= 0 && zone < (R.MINES?.length || 1)) setZone(zone, false);
      start();
      return true;
    },
    // حالة الجولة كما تراها الواجهة: هل هناك جولة جارية أو نتيجة تنتظر الخادم؟
    busy: () => ({ running, paused, pending: Boolean(pending), submitting }),
    // التخلّي عن جولة غير منتهية: لا مكافأة لها أصلاً (المكافأة تُحسب من إعادة تشغيل الخادم عند الإنهاء)،
    // فهي لا تُنقص شيئًا من الحساب — لكنها تفتح الطريق لبدء مبارزة بدل البقاء محبوسًا في جولة قديمة.
    // نتيجة بانتظار الخادم (pending) لا تُهمل أبدًا: تُرسل أولًا.
    abandon() {
      if (pending || submitting || starting) return false;
      if (!running && !ticket) return false;
      running = false; paused = false;
      cancelAnimationFrame(raf); raf = 0;
      ticket = null; inputs = [];
      try { localStorage.removeItem(storageKey()); } catch (_) {}
      el('platform-start').disabled = false;
      resetFeedback();
      overlay('منجم المنصّة', 'تخلّينا عن الجولة السابقة بلا مكافأة. اضغط «جولة جديدة» للبدء من جديد.');
      draw();
      return true;
    },
    resumeRun() {
      if (!running) return false;
      paused = false; resume();
      return true;
    },
    setMode(mode) {
      if (!R.MODES?.includes(mode) || running) return false;
      selectedMode = mode;
      try { localStorage.setItem('platform-mode', selectedMode); } catch (_) {}
      refreshPreview();
      return true;
    },
    mode: () => selectedMode,
  };

  el('platform-start').disabled = true;
  // Initialize HUD immediately
  hud(); draw();
  // الواجهة تعرض المنجم المحفوظ فور جاهزية المتحكم، ومشهد الانتظار يُبنى بمعدات الحساب الفعلية بعد الاستعادة
  window.dispatchEvent(new CustomEvent('platform-config-change', { detail: { init: true } }));
  restore().catch(() => say('تعذّر استرجاع الجولة؛ يمكنك بدء رحلة جديدة.')).finally(() => {
    restoring = false; el('platform-start').disabled = Boolean(pending);
    refreshPreview();
    // إرشاد أول مرة بعد جاهزية المشهد فقط (لا يحجب زر البدء ولا يتكرر بعد التخطّي).
    maybeCoach();
    window.dispatchEvent(new CustomEvent('platform-config-change', { detail: { ready: true } }));
  });
})();
