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
    // تبويب اللعب مخصّص لتجربة التعدين: وضع «المبارزة» القديم لم يعد يُستعاد هنا (المبارزة صارت في تبويب الساحة)
    if (localStorage.getItem('platform-mode') === 'duel') localStorage.setItem('platform-mode', 'mine');
  } catch (_) {}
  // أي طلب جولة من تبويب اللعب يبقى تعدينًا دائمًا حتى لو نادى أحدهم setMode('duel') قديمًا
  const playMode = () => 'mine';
  const liveLoadout = () => {
    try { return R.normalizeLoadout(typeof state !== 'undefined' && state ? state.equipment : null); } catch (_) { return R.normalizeLoadout(null); }
  };
  // لقطة الإعداد المحلية لتبويب اللعب تعدينٌ دائمًا: لا يمكن أن يولّد وضعُ «مبارزة» قديم جولة مبارزة هنا
  const configFor = (t) => (t?.config ? R.normalizeConfig(t.config) : R.normalizeConfig({ zone: selectedZone, goal: selectedGoal, mode: 'mine', loadout: liveLoadout() }));

  let sim = R.create(currentHero, undefined, configFor(null)), inputs = [], ticket = null, owner = null;
  const seedOf = (t) => (t?.id ? R.seedFromId(t.id) : undefined);
  let running = false, paused = false, starting = false, restoring = true, submitting = false, pending = null;
  let raf = 0, last = 0, accumulator = 0;
  let audio = null, muted = false, particles = [], shake = 0;
  // المرحلة 1: مؤثرات عرض فقط — لا تدخل في R.step ولا في مسار الحركات المرسل للخادم.
  let floaters = [], floatersSpawned = 0, combo = 0, comboUntil = 0, comboPeak = 0, beams = [];
  let frameTime = 0, hitStopUntil = 0, lastHitStop = -1e9;
  // B5: علامات الإنذار الأرضية (عرض فقط). الوحدة تُحمَّل قبل هذا السكربت، والاحتياط يمنع سقوط الرسم
  // إن جاء متصفح بنسخة قديمة من الكاش.
  const Telegraphs = (typeof window !== 'undefined' && window.PlatformTelegraphs) || null;
  const telegraphsFor = () => (Telegraphs ? Telegraphs.batMarkers(sim, R.BAT) : []);
  // آخر طور معروف لكل خفاش: لالتقاط لحظة الهبوط (dive ← stun) التي لا يُصدر لها المحرك حدثاً
  const batPhases = new Map();
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

  // V21: show the upper-route control only when the miner reaches its entrance.
  // This is UI-only and never changes the recorded input mask or simulation state.
  function updateRouteHint() {
    const hint = el('platform-route-hint');
    if (!hint) return;
    const p = sim.player, level = R.levelFor(sim.zone);
    const near = running && !paused && sim.status === 'playing' && sim.zone > 0 &&
      (level.platforms || []).some(box => box.route === 'upper' &&
        p.x + p.w > box.x - 48 && p.x < box.x + box.w + 48 &&
        p.y > box.y && p.y + p.h > box.y + box.h);
    hint.hidden = !near;
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
    KeyE: 8, KeyX: 8, KeyR: 1024,
    KeyF: 16, KeyJ: 16, KeyZ: 16,
    KeyQ: 32, KeyK: 32, KeyC: 32,
    KeyS: 64, ArrowDown: 64, ShiftLeft: 64, ShiftRight: 64,
    // V8: المراوغة والضربة الثقيلة — مفاتيح مستقلة لا تلمس اختصارات اللعبة القديمة
    KeyV: 128, KeyB: 128,
    KeyL: 256, KeyU: 256,
  };
  // أسماء المفاتيح للعرض في الإرشاد (تُبنى من keyMap نفسه فلا تتناقض معه)
  const KEY_HINTS = 'الأسهم/WASD حركة · Space قفز · ↑ للقفز، وR أو زر «تسلّق» لصعود السلالم · J ضرب خفيف (سلسلة) · L ضربة قوية · V مراوغة · S صدّ · Q مهارة · E حفر';

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
  const draw = () => renderer.draw(canvas, sim, { reduced, particles, shake, floaters, beams, telegraphs: telegraphsFor() });

  function clearInput() {
    keys.clear(); pointers.clear(); pulses.clear();
    document.querySelectorAll('[data-platform-input]').forEach(b => { b.dataset.down = 'false'; });
    // Reset analog input whenever the game pauses or resumes. A hidden tab can
    // miss pointerup, otherwise leaving the player walking after returning.
    joystickActive = false; joystickX = 0; joystickY = 0; joystickPointerId = null;
    const handle = el('virtual-joystick')?.querySelector('.joystick-handle');
    if (handle) handle.style.transform = 'translate(-50%, -50%)';
  }

  const platformAudio = window.PlatformAudio.create({ isMuted: () => muted, getVolume: () => volume });
  function audioUnlock() { platformAudio.unlock(); }
  function beep(type) { platformAudio.beep(type); }

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

  // ===== تخطيط بلا تمرير: حالة الاستعداد (Lobby) مقابل الجولة النشطة (Live) =====
  // عرض فقط: يبدّل صنف scene-live على المشهد وbody فتنطوي أشرطة الاستعداد ويتوسّع الكانفاس.
  // لا يمسّ running/paused ولا أي منطق لعب؛ يُستدعى من hud() وpause/resume/overlay دائمًا.
  function syncSceneState() {
    const live = Boolean(running && !paused);
    const scene = el('platform-scene');
    if (scene?.classList) {
      const has = scene.classList.contains('scene-live');
      if (live && !has) { scene.classList.add('scene-live'); scene.classList.remove('scene-lobby'); }
      else if (!live && has) { scene.classList.remove('scene-live'); scene.classList.add('scene-lobby'); }
    }
    const body = document.body;
    if (body?.classList) {
      const has = body.classList.contains('scene-live');
      if (live && !has) body.classList.add('scene-live');
      else if (!live && has) body.classList.remove('scene-live');
    }
    return live;
  }

  function hud() {
    syncSceneState();
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
    syncSceneState();
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
    const routeHint = el('platform-route-hint'); if (routeHint) routeHint.hidden = true;
    save(); audio?.suspend?.()?.catch(() => {});
    overlay('استراحة عند المصباح', 'الجولة متوقفة. لن تتقدم الفيزياء أو الوقت أثناء مغادرتك. تابع عندما تكون جاهزًا.', true);
    syncSceneState();
    draw();
  }

  function schedule() { if (!raf && running && !paused && visible()) raf = requestAnimationFrame(frame); }

  function resume() {
    if (!running) return;
    paused = false; clearInput(); accumulator = 0; last = 0; hitStopUntil = 0;
    // الغلاف يُخفى دائمًا عند الاستئناف: بدء المبارزة من الساحة قد يسبق ظهور المشهد بجزء من الثانية،
    // وكان هذا يترك اللاعب على «شاشة البداية» رغم أن الجولة بدأت على الخادم.
    el('platform-overlay').hidden = true; audioUnlock();
    syncSceneState();
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
  // B5: لحظة هبوط الخفاش لا يُصدر لها المحرك حدثاً (ينتقل dive ← stun بصمت). نلتقطها من الحالة
  // العامة نفسها التي يراها اللاعب: غبار على نقطة الهبوط + طرقة صوتية. عرض فقط — لا تغيير في التوقيت
  // ولا في الضرر ولا في الحالة، ولذلك تبقى البصمة الحتمية كما هي.
  function watchBatLandings() {
    for (const e of sim.enemies || []) {
      if (!e || !e.flying) continue;
      const prev = batPhases.get(e.id);
      batPhases.set(e.id, e.batState);
      if (prev !== 'dive' || e.batState !== 'stun') continue;
      beep('bat_land');
      if (reduced || particles.length >= 84) continue;
      for (let i = 0; i < 6; i++) {
        particles.push({ x: e.x + e.w / 2 + (Math.random() - 0.5) * 10, y: R.BAT.floor - 2,
          vx: (Math.random() - 0.5) * 1.6, vy: -0.5 - Math.random() * 0.7, life: 16 + (i % 4),
          color: i % 2 ? '#d8cdbb' : '#efe6d6', size: 2.6, glow: false });
      }
    }
  }

  function advance(mask) {
    const hpBefore = sim.rocks.map(r => r.hp);
    record(mask); R.step(sim, mask);
    updateRouteHint();
    const broken = sim.rocks.filter((r, i) => hpBefore[i] > 0 && r.hp === 0);
    consumeEvents(broken);
    watchBatLandings();
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
  const summaryUi = window.PlatformSummary.create({ document, ores: R.ORES });
  const oreLineOf = summaryUi.oreLineOf;
  const summaryRow = summaryUi.row;
  function nextStepHint(receipt, duelRun = false) {
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
    if (duelRun || receipt?.mode === 'duel') {
      const won = receipt ? receipt.won : null;
      if (won === true) return 'لماذا مبارزة أخرى؟ كل عمق يقدّم نمط خصم أسرع (المدرّع ثم سيّاف الريح) وذهبًا أكثر لكل انتصار.';
      if (won === false) return 'لماذا مبارزة أخرى؟ اقرأ إنذار الخصم: الكاسرة تُقفز أو تُراوغ، والضربة القريبة تُصدّ — والصدّ يستهلك درعك.';
      return 'المبارزة تُربح بالقراءة: الصدّ للضربة القريبة، والقفز أو المراوغة للكاسرة، وراقب درعك.';
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
      if (next) next.textContent = nextStepHint(receipt, true);
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
    const routeHint = el('platform-route-hint'); if (routeHint) routeHint.hidden = true;
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
        const issued = await request('/api/platform/start', { zone: selectedZone, goal: selectedGoal, mode: playMode() });
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
    // النافذة تنكمش للأعلى أثناء التحريك حتى تبقى اللوحة قابلة للسحب (لا تحجبها).
    const modal = el('ctl-modal');
    if (modal?.classList) {
      const has = modal.classList.contains('ctl-modal--editing');
      if (layoutEditing && !has) modal.classList.add('ctl-modal--editing');
      else if (!layoutEditing && has) modal.classList.remove('ctl-modal--editing');
    }
    if (layoutEditing) { clearInput(); pause(); say('وضع التحريك: اسحب العصا والأزرار إلى موضعها المريح.'); }
    else say('توقف التحريك؛ المواضع محفوظة على هذا الجهاز.');
  }
  el('ctl-edit')?.addEventListener('click', () => setLayoutEditing(!layoutEditing));

  // ===== نافذة إعدادات التحكم (Modal): فتح/إغلاق فقط، كل الأزرار داخلها كما هي =====
  // الفتح يوقف الجولة (كورشة/المرشد) حتى يضبط اللاعب بلا مخاطرة؛ الإغلاق يوقف التحريك.
  function openCtlSettings() {
    const modal = el('ctl-modal');
    if (!modal) return false;
    if (running && !paused) pause();
    modal.hidden = false;
    const details = el('ctl-settings');
    if (details) details.open = true;
    const close = el('ctl-modal-close');
    try { close?.focus?.({ preventScroll: true }); } catch (_) {}
    haptic('light');
    return true;
  }
  function closeCtlSettings() {
    const modal = el('ctl-modal');
    if (!modal || modal.hidden) return false;
    if (layoutEditing) setLayoutEditing(false);
    modal.hidden = true;
    const opener = el('open-ctl-settings');
    try { opener?.focus?.({ preventScroll: true }); } catch (_) {}
    return true;
  }
  el('open-ctl-settings')?.addEventListener('click', openCtlSettings);
  el('ctl-modal-close')?.addEventListener('click', closeCtlSettings);
  document.querySelector('.ctl-modal-backdrop')?.addEventListener('click', closeCtlSettings);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtlSettings(); });
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
  // V12.1: هل صُرف التذكير المختصر في هذه المبارزة؟ (تذكير واحد لكل مبارزة، لا مع كل ضربة)
  let hintReminderShown = false;
  const arenaShown = () => Boolean(arenaCanvas && typeof arenaCanvas.getContext === 'function'
    && el('tab-arena')?.classList?.contains('active') && !document.hidden);
  function buildArenaSim() {
    if (!R?.create) return;
    arenaSeed = (arenaSeed * 1103515245 + 12345) % 2147483647;
    arenaSim = R.create(currentHero, arenaSeed, { zone: arenaZone, mode: 'duel' });
    arenaHero = currentHero;
    arenaOver = 0;
    arenaHintReset();
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
  // مؤثرات المسرح: شرارات الضرب، أرقام الضرر، غبار الصدمة، واهتزاز خفيف — كلها عرض فقط
  let arenaParticles = [], arenaFloaters = [], arenaShake = 0;
  // V11: تلميح المرحلة الثانية — نصّ من المحرك نفسه، يظهر عند الاهتياج فقط ويختفي وحده
  let arenaHintTimer = 0;
  function arenaHint(text, ms = 5200, kind = 'main') {
    const box = el('arena-hint');
    if (!box || !text) return;
    box.textContent = text;
    // التذكير المختصر أصغر وأقل حجباً (CSS: .arena-hint.remind) — نفس الصندوق، نصّ أخفّ
    box.classList.toggle('remind', kind === 'reminder');
    box.classList.add('show');
    if (arenaHintTimer) { clearTimeout(arenaHintTimer); arenaHintTimer = 0; }
    // ms ≤ 0: تلميح ثابت (للالتقاط البصري) — يُمسح بـ arenaHintHide
    if (ms > 0) arenaHintTimer = setTimeout(() => { box.classList.remove('show'); arenaHintTimer = 0; }, ms);
  }
  function arenaHintHide() {
    const box = el('arena-hint');
    if (arenaHintTimer) { clearTimeout(arenaHintTimer); arenaHintTimer = 0; }
    if (box) { box.classList.remove('show', 'remind'); box.textContent = ''; }
  }
  const arenaHintVisible = () => Boolean(el('arena-hint')?.classList?.contains('show'));
  // V12.1: التذكير المختصر يُصرف مرة واحدة لكل مبارزة (يُعاد تصفيره مع كل مسرح/مبارزة جديدة)
  function arenaHintReset() { hintReminderShown = false; arenaHintHide(); }

  function collectFx(fromSim, withSound = false) {
    if (!fromSim) return;
    // أصوات الساحة: تُشغَّل من المبارزة الحيّة فقط، لا من المسرح الاستعراضي
    const sfx = (type) => { if (withSound) { try { beep(type); } catch (_) {} } };
    for (const ev of fromSim.events || []) {
      if (ev.type === 'hit') {
        const strong = (ev.damage || 0) > 0;
        if (!reduced) {
          for (let i = 0; i < (strong ? 11 : 4); i++) arenaParticles.push({
            x: ev.x, y: ev.y, vx: (Math.random() - 0.5) * 3.2, vy: -1 - Math.random() * 1.8,
            life: 16 + Math.random() * 10, color: strong ? (i % 2 ? '#ffd166' : '#fff3c9') : '#9fd8ff',
            size: 2 + Math.random() * 2.2, glow: true,
          });
        }
        arenaFloaters.push({ x: ev.x, y: ev.y - 10, text: strong ? `-${ev.damage}` : 'صدّ', color: strong ? '#ffd166' : '#9fd8ff', life: 36, maxLife: 36, size: strong ? 16 : 12, scale: 1 });
        if (strong) arenaShake = Math.max(arenaShake, 0.36);
        sfx(strong ? 'hit' : 'clang');
        sfx(ev.heavy ? 'heavy' : 'swing');
      } else if (ev.type === 'swing' && !reduced) {
        for (let i = 0; i < 5; i++) arenaParticles.push({
          x: ev.x + (ev.facing >= 0 ? 26 : -6), y: ev.y + 22, vx: ev.facing * (1.2 + i * 0.5) + (Math.random() - 0.5),
          vy: (Math.random() - 0.5) * 0.8, life: 14, color: '#e8f6ff', size: 2.6, glow: true, trail: true,
        });
      } else if (ev.type === 'boss_slam' || ev.type === 'boss_crash') {
        sfx(ev.type === 'boss_crash' ? 'boss_crash' : 'boss_slam');
        if (!reduced) for (let i = 0; i < 12; i++) arenaParticles.push({
          x: ev.x + (i - 6) * 9, y: 296, vx: (i - 6) * 0.35 + (Math.random() - 0.5), vy: -0.8 - Math.random() * 1.6,
          life: 22, color: i % 2 ? '#c9b8a0' : '#efe3cf', size: 3, glow: false,
        });
        arenaShake = Math.max(arenaShake, ev.type === 'boss_crash' ? 0.66 : 0.5);
      } else if (ev.type === 'skill') {
        sfx('skill_shadow');
        // ظل الساكورا: عاصفة بتلات + خيط ضوء خلف الاندفاع
        if (!reduced) {
          for (let i = 0; i < 16; i++) arenaParticles.push({
            x: ev.x + (Math.random() - 0.5) * 26, y: ev.y + (Math.random() - 0.5) * 26,
            vx: -ev.facing * (0.6 + Math.random() * 2.4), vy: -0.8 - Math.random() * 1.9,
            life: 20 + Math.random() * 12, color: i % 3 === 0 ? '#fff1f8' : i % 3 === 1 ? '#ffb3d9' : '#ff8fbf',
            size: 2.2 + Math.random() * 2.4, glow: true,
          });
          for (let i = 0; i < 8; i++) arenaParticles.push({
            x: ev.x - ev.facing * (10 + i * 9), y: ev.y + (Math.random() - 0.5) * 8,
            vx: -ev.facing * 1.2, vy: -0.2, life: 12, color: '#ffffff', size: 2, glow: true, trail: true,
          });
        }
        arenaShake = Math.max(arenaShake, 0.22);
        arenaFloaters.push({ x: ev.x, y: ev.y - 26, text: 'ظل الساكورا', color: '#ffb3d9', life: 48, maxLife: 48, size: 13, scale: 1 });
      } else if (ev.type === 'skill_hit') {
        if (ev.hits) sfx('skill_hit');
        if (reduced) continue;
        for (let i = 0; i < 14; i++) arenaParticles.push({
          x: ev.x + (Math.random() - 0.5) * 18, y: ev.y + (Math.random() - 0.5) * 22,
          vx: (Math.random() - 0.5) * 4.4, vy: -1 - Math.random() * 2.6,
          life: 15 + Math.random() * 8, color: i % 2 ? '#ffd7ee' : '#ffffff', size: 2 + Math.random() * 2, glow: true,
        });
        if (ev.hits) arenaShake = Math.max(arenaShake, 0.44);
      } else if (ev.type === 'guard') {
        sfx('guard');
      } else if (ev.type === 'evade') {
        sfx('evade');
      } else if (ev.type === 'dodge') {
        sfx('dodge');
      } else if (ev.type === 'enemy_stagger' || ev.type === 'boss_stun') {
        sfx('stagger');
      } else if (ev.type === 'boss_windup') {
        sfx('boss_windup');
      } else if (ev.type === 'boss_charge') {
        sfx('boss_charge');
      } else if (ev.type === 'boss_enrage') {
        sfx('boss_enrage');
        // المرحلة الثانية من مبارز الساحة: تلميح واحد عند الاهتياج (الحدث يقع مرة واحدة في الجولة).
        // V13: في المسرح الاستعراضي فقط (بلا مبارزة) لا تلميحات — البوت يهيّج الزعيم في الخلفية
        // فلا معنى لإرشاد لاعب غير موجود.
        const plan = !withSound ? null : R.duelHintPlan?.(ev, { hintVisible: arenaHintVisible(), reminderShown: hintReminderShown });
        if (plan) arenaHint(plan.text, plan.ms, plan.kind);
      } else if (ev.type === 'boss_windup' && ev.attack === 'overhead') {
        sfx('boss_windup');
        // V12.1: أول صدمة كاسرة بعد خفوت التلميح تحصل على تذكير مختصر واحد — لا مع كل ضربة
        const plan = !withSound ? null : R.duelHintPlan?.(ev, {
          phase: fromSim.enemies?.[0]?.phase, hintVisible: arenaHintVisible(), reminderShown: hintReminderShown,
        });
        if (plan && plan.kind === 'reminder') { hintReminderShown = true; arenaHint(plan.text, plan.ms, plan.kind); }
      } else if (ev.type === 'hurt') {
        sfx('hurt');
        arenaShake = Math.max(arenaShake, 0.7);
        if (!reduced) for (let i = 0; i < 8; i++) arenaParticles.push({
          x: ev.x + 12, y: ev.y + 18, vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 1.4,
          life: 18, color: i % 2 ? '#ff6b6b' : '#ffa94d', size: 2.6, glow: true,
        });
      }
    }
  }
  function arenaFx() { if (arenaSim) collectFx(arenaSim); }
  function arenaStep() {
    if (!arenaSim) return;
    // المرحلة B: أثناء شاشة الاستعداد لا تُخطى المحاكاة — المقاتلان في وقفة قتال لا في مبارزة تجريبية
    // (لا ضرر ولا تحرّك ولا مؤقّت). العرض يبقى حيّاً عبر سقف عرض متزايد، والمبارزة تبدأ من محاكاة جديدة.
    if (arenaReadyHold()) return;
    if (arenaSim.status !== 'playing') { if (++arenaOver > 90) buildArenaSim(); return; }
    R.step(arenaSim, arenaDemoMask(arenaSim));
    arenaFx();
  }
  function arenaTick2() {
    if (!arenaParticles.length && !arenaFloaters.length && arenaShake <= 0) return;
    for (let i = arenaParticles.length - 1; i >= 0; i--) {
      const pt = arenaParticles[i];
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.11; pt.life--;
      if (pt.life <= 0) arenaParticles.splice(i, 1);
    }
    for (let i = arenaFloaters.length - 1; i >= 0; i--) {
      const f = arenaFloaters[i];
      f.y -= 0.5; f.life--;
      if (f.life <= 0) arenaFloaters.splice(i, 1);
    }
    if (arenaParticles.length > 160) arenaParticles.splice(0, arenaParticles.length - 160);
    arenaShake = Math.max(0, arenaShake - 0.05);
  }
  // ===== المرحلة B: وقفة الاستعداد =====
  // شاشة الاستعداد تعرض المقاتلَين في وقفة قتال، لا مبارزة تجريبية تتحرك وتتلقّى ضرراً خلف اللوحة.
  // الحل: أثناء ظهورها لا تُخطى المحاكاة (لا خطوة، لا ضرر، لا تحرّك)، ويُعاد الرسم من نسخة عرض
  // «ساكنة» بسقف زمني متزايد كي يبقى التنفّس حيّاً. النسخة للعرض فقط: المحاكاة الحقيقية
  // (arenaSim) لا تُعدَّل، والمبارزة تبدأ من محاكاة جديدة كاملة عند الضغط على «ابدأ المبارزة».
  let arenaPoseTick = 0;
  function arenaReadyHold() {
    return !duelRunning && !arenaFrozen
      && document.body.classList.contains('arena-live')
      && !document.body.classList.contains('duel-live')
      && !document.body.classList.contains('arena-more');
  }
  function arenaPoseState() {
    if (!arenaSim) return arenaSim;
    arenaPoseTick += 1;
    const p = arenaSim.player;
    const list = Array.isArray(arenaSim.enemies) ? arenaSim.enemies : [];
    return Object.assign({}, arenaSim, {
      tick: arenaPoseTick,
      player: Object.assign({}, p, { state: 'idle', vx: 0, vy: 0, air: false, attack: 0, pose: null }),
      enemies: list.map((e) => Object.assign({}, e, { state: 'idle', vx: 0, vy: 0, air: false, attack: 0 })),
    });
  }
  function arenaDraw() {
    if (!arenaSim || !arenaCanvas) return;
    // arena: true ← مسرح الساحة يرسم حلبة النينجا (قمر ومعبد وساكورا) لا أنفاق المنجم
    // نسخة العرض (وقف/تنفّس) تُستخدم فقط في شاشة الاستعداد؛ المبارزة الحقيقية ترسم المحاكاة نفسها.
    const drawState = arenaReadyHold() ? arenaPoseState() : arenaSim;
    try {
      renderer.draw(arenaCanvas, drawState, {
        arena: true, reduced, particles: arenaParticles, floaters: arenaFloaters, shake: arenaShake, beams: [],
      });
    } catch (_) {}
  }
  // شريطا الصحة في كتلة المسرح: يُحدَّثان من حالة المحاكاة نفسها (لا رسم تخييلي)
  let arenaHudTick = 0;
  function arenaHud() {
    if (!arenaSim) return;
    const p = arenaSim.player, rival = arenaSim.enemies[0];
    const heroBar = el('arena-hp-hero'), rivalBar = el('arena-hp-rival');
    if (heroBar) heroBar.style.width = `${Math.max(0, Math.min(100, (p.hearts / Math.max(1, p.maxHearts)) * 100))}%`;
    if (rivalBar && rival) rivalBar.style.width = `${Math.max(0, Math.min(100, (rival.hp / Math.max(1, rival.maxHp)) * 100))}%`;
    // طاقة المهارة (من مهلة المهارة نفسها) — نفس ما يمنحه الزر في المبارزة الحقيقية
    const maxSkill = Math.max(1, p.skillMaxCooldown || 1);
    const heroEn = el('arena-en-hero');
    if (heroEn) heroEn.style.width = `${Math.max(0, Math.min(100, 100 - (p.skillCooldown || 0) / maxSkill * 100))}%`;
    const rivalEn = el('arena-en-rival');
    if (rivalEn && rival) rivalEn.style.width = `${Math.max(0, Math.min(100, 100 - (rival.timer || 0) / Math.max(1, rival.ai?.walk || 30) * 100))}%`;
    // المؤقّت والجولة
    const timerEl = el('arena-timer');
    if (timerEl) timerEl.textContent = String(Math.max(0, Math.ceil((R.MAX_TICKS - arenaSim.tick) / R.FPS)));
    const roundEl = el('arena-round');
    if (roundEl) roundEl.textContent = arenaSim.status === 'playing' ? 'مبارزة' : (arenaSim.status === 'won' ? 'انتصار' : 'خسارة');
  }
  function arenaFrame(now) {
    arenaRaf = 0;
    if (!arenaShown() || duelRunning) return;
    const stamp = Number(now) || 0;
    const dt = arenaStamp ? Math.min(60, stamp - arenaStamp) : 16;
    arenaStamp = stamp; arenaAcc += dt;
    let steps = 0;
    while (arenaAcc >= 1000 / (R.FPS || 60) && steps < 3) {
      if (!arenaFrozen) arenaStep();
      arenaAcc -= 1000 / (R.FPS || 60); steps++;
    }
    arenaTick2();
    arenaDraw();
    if (++arenaHudTick % 6 === 0) arenaHud();
    arenaRaf = requestAnimationFrame(arenaFrame);
  }
  // ===== V12: لقطتان مرجعيتان للمراجعة البصرية على الهاتف =====
  // نفس المحرك ونفس الرسم ونفس الواجهة، يُلعب المسرح بسياسة «متقن» (نفس سياسة القياس) حتى
  // يصل اللحظة المطلوبة طبيعياً ثم يُجمَّد عرضه فقط: لا خادم، ولا نتيجة، ولا تغيير في الصحة.
  let arenaFrozen = false, arenaSnapshotKind = null;
  function arenaSnapshot(kind) {
    if (duelRunning || !arenaCanvas || typeof arenaCanvas.getContext !== 'function' || !R?.create) return false;
    if (arenaFrozen && arenaSnapshotKind === kind) { arenaSnapshotOff(); return true; }
    hideArenaPreview();
    arenaParticles = []; arenaFloaters = []; arenaShake = 0;
    const zone = kind === 'boss' ? 3 : 2;
    // اللحظة تُصنع بالمحرك الحقيقي (R.capture) — نفس مصدر السكربت والتقرير.
    const sim = R.capture ? R.capture.sim(kind, currentHero, { loadout: liveLoadout() }) : null;
    if (!sim) return false;
    arenaSim = sim; arenaZone = zone; arenaHero = currentHero;
    arenaFrozen = true; arenaSnapshotKind = kind;
    const label = el('arena-preview-rival');
    if (label) label.textContent = `${sim.enemies[0]?.name || R.rivalFor?.(zone)?.name || 'المبارز'} · لقطة`;
    const heroLabel = el('arena-preview-hero');
    if (heroLabel) heroLabel.textContent = R.CHARACTERS?.[currentHero]?.name || 'المحارب';
    duelStatusLine(kind === 'boss' ? 'لقطة: الزعيم — المرحلة الثانية (مجموعة)' : 'لقطة: موجة الريح قريبة (مجموعة)');
    // في اللعب الحقيقي يظهر هذا النص من حدث boss_enrage ثم يخبو بعد 5.2 ثانية؛
    // هنا نثبّته فقط كي يبقى مرئياً أثناء التصوير.
    if (kind === 'boss') arenaHint(R.DUEL.phase2Hint, 0); else arenaHintHide();
    arenaDraw(); arenaHud();
    if (!arenaRaf) arenaRaf = requestAnimationFrame(arenaFrame);
    return true;
  }
  function arenaSnapshotOff() {
    arenaFrozen = false; arenaSnapshotKind = null;
    duelStatusLine('');
    arenaHintHide();
    const label = el('arena-preview-rival');
    if (label) label.textContent = `${R.rivalFor?.(arenaZone)?.name || 'المبارز'} · ${R.MINES?.[arenaZone]?.name || ''}`;
    if (!arenaRaf) arenaRaf = requestAnimationFrame(arenaFrame);
  }

  function showArenaPreview(zone) {
    if (duelRunning) return false;
    if (!arenaCanvas || typeof arenaCanvas.getContext !== 'function' || !R?.create) return false;
    const last = (R.MINES?.length || 1) - 1;
    const z = Math.max(0, Math.min(last, Number.isInteger(zone) ? zone : 0));
    if (arenaFrozen) arenaSnapshotOff();
    if (z !== arenaZone || arenaHero !== currentHero || !arenaSim) { arenaZone = z; buildArenaSim(); arenaParticles = []; arenaFloaters = []; arenaShake = 0; }
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

  // ===== مبارزة الساحة الحيّة: جولة كاملة على مسرح تبويب الساحة =====
  // نفس المحرك (R.create / R.step) ونفس تسجيل الإدخال الخادمي، لكن الحالة مستقلة تمامًا عن جولة المنجم:
  // لا تلمس sim/inputs/ticket الخاصة بتبويب اللعب، ولا تنقل المستخدم إلى تبويب آخر.
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

  function duelStatusLine(text) {
    const box = el('arena-duel-status');
    if (box) { box.textContent = text || ''; box.hidden = !text; }
  }
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
        particles: arenaParticles, floaters: arenaFloaters, shake: arenaShake, beams: [],
      });
    } catch (_) {}
  }
  let duelHeartsCache = '';
  // ===== المرحلة C: HUD القتال =====
  // كل ما هنا عرض فقط: يقرأ من duelSim ولا يكتب فيه ولا يرسل شيئاً للخادم.
  let duelSidePrev = null, duelSideSim = null, duelHudTick = 0;
  function duelSideDelta(side, amount) {
    if (!(amount > 0)) return;
    const panel = el(side === 'hero' ? 'cx-side-hero' : 'cx-side-rival');
    const box = el(side === 'hero' ? 'cx-delta-hero' : 'cx-delta-rival');
    if (panel) {
      panel.classList.add('hurt');
      clearTimeout(panel._hurtTimer);
      panel._hurtTimer = setTimeout(() => panel.classList.remove('hurt'), 220);
    }
    if (!box) return;
    box.textContent = `-${amount}`;
    box.hidden = false;
    box.style.animation = 'none';
    void box.offsetWidth;           // إعادة تشغيل الرمية من الصفر
    box.style.animation = '';
    clearTimeout(box._hideTimer);
    box._hideTimer = setTimeout(() => { box.hidden = true; }, 860);
  }
  function duelHeartsPips(box, hearts, max) {
    for (let i = 0; i < max; i++) {
      const pip = document.createElement('span');
      pip.className = 'as-pip';
      if (i < hearts) pip.classList.add('on');
      box.appendChild(pip);
    }
  }
  function duelHud() {
    if (!duelSim) return;
    const p = duelSim.player, rival = duelSim.enemies[0];
    // أسماء اللوحة: اسم المقاتل وحده (المعاينة قبل المبارزة تضيف اسم الساحة — لا مكان له في القتال)
    const heroNameEl = el('arena-preview-hero'), rivalNameEl = el('arena-preview-rival');
    if (heroNameEl) heroNameEl.textContent = (R.CHARACTERS && R.CHARACTERS[currentHero] && R.CHARACTERS[currentHero].name) || 'المحارب';
    if (rivalNameEl && rival) rivalNameEl.textContent = rival.name || 'المبارز';
    const heroPct = Math.max(0, Math.min(100, (p.hearts / Math.max(1, p.maxHearts)) * 100));
    const rivalPct = rival ? Math.max(0, Math.min(100, (rival.hp / Math.max(1, rival.maxHp)) * 100)) : 0;
    const heroBar = el('arena-hp-hero'), rivalBar = el('arena-hp-rival');
    // جاهزية ظل الساكورا: الزر يلمع فقط عندما يمكن استخدامها فعلًا (مهلة + نَفَس)
    const skillBtn = document.querySelector('#arena-pad [data-duel-input="32"]');
    if (skillBtn) {
      const ready = p.skillCooldown <= 0 && p.guard.broken <= 0 && p.guard.stamina >= R.DUEL.skill.cost && !p.skill;
      skillBtn.classList.toggle('ready', ready);
      skillBtn.classList.toggle('cool', !ready);
      skillBtn.setAttribute('aria-disabled', ready ? 'false' : 'true');
      // العدّاد بالثواني (عرض فقط): يُقرأ من مهلة المهارة نفسها
      skillBtn.dataset.cd = String(Math.max(0, Math.ceil(p.skillCooldown / (R.FPS || 60))));
    }
    if (heroBar) heroBar.style.width = `${heroPct}%`;
    if (rivalBar) rivalBar.style.width = `${rivalPct}%`;
    // شريط الظل يتأخّر خلف الشريط الحقيقي فيُظهر حجم الضربة
    const ghostHero = el('arena-ghost-hero'), ghostRival = el('arena-ghost-rival');
    if (ghostHero) ghostHero.style.width = `${heroPct}%`;
    if (ghostRival) ghostRival.style.width = `${rivalPct}%`;
    // قلوب المقاتل: نقاط حقيقية من المحاكاة (لا تُعاد بناؤها إلا عند تغيّرها)
    const heartsBox = el('arena-hearts-hero');
    if (heartsBox) {
      const max = Math.max(1, p.maxHearts), key = `${p.hearts}/${max}`;
      if (key !== duelHeartsCache) {
        duelHeartsCache = key;
        heartsBox.textContent = '';
        duelHeartsPips(heartsBox, p.hearts, max);
      }
    }
    const heroEn = el('arena-en-hero');
    if (heroEn) heroEn.style.width = `${Math.max(0, Math.min(100, 100 - (p.skillCooldown || 0) / Math.max(1, p.skillMaxCooldown || 1) * 100))}%`;
    // شريط الخصم = جاهزية هجومه القادم (من مؤقّت المحاكاة نفسه)، لا تكراراً لشريط صحته
    const rivalEn = el('arena-en-rival');
    if (rivalEn && rival) {
      const walk = Math.max(1, rival.ai?.walk || 30);
      rivalEn.style.width = `${Math.max(0, Math.min(100, 100 - (rival.timer || 0) / walk * 100))}%`;
    }
    const timerEl = el('arena-timer');
    if (timerEl) timerEl.textContent = String(Math.max(0, Math.ceil((R.MAX_TICKS - duelSim.tick) / R.FPS)));
    const roundEl = el('arena-round');
    if (roundEl) roundEl.textContent = duelSim.status === 'playing' ? 'مبارزة' : (duelSim.status === 'won' ? 'انتصار' : 'خسارة');
    // ===== المرحلة C: اللوحات (اسم/مستوى/صحة رقمية/درع/حالات/ضرر) =====
    const heroPanel = el('cx-side-hero'), rivalPanel = el('cx-side-rival');
    const zoneNow = Number.isInteger(duelSim.zone) ? duelSim.zone : duelZone;
    const lvlRival = el('cx-lvl-rival');
    if (lvlRival) lvlRival.textContent = `مستوى ${zoneNow + 1}`;
    const hpNum = el('cx-hpnum-rival');
    if (hpNum && rival) hpNum.textContent = `${Math.max(0, Math.round(rival.hp))}/${Math.round(rival.maxHp || rival.hp)}`;
    const guardBar = el('cx-guard-hero');
    if (guardBar) guardBar.style.width = `${Math.max(0, Math.min(100, (p.guard?.stamina || 0) / Math.max(1, p.guard?.maxStamina || 1) * 100))}%`;
    const skillReady = p.skillCooldown <= 0 && (p.guard?.broken || 0) <= 0
      && (p.guard?.stamina || 0) >= (R.DUEL?.skill?.cost || 0) && !p.skill;
    if (heroPanel) {
      heroPanel.classList.toggle('guard', Boolean(p.guard && p.guard.active));
      heroPanel.classList.toggle('dodge', (p.dodge?.ticks || 0) > 0);
      heroPanel.classList.toggle('skillready', skillReady);
      heroPanel.classList.toggle('low', p.hearts <= 1);
    }
    if (rivalPanel) rivalPanel.classList.toggle('low', Boolean(rival) && rival.hp / Math.max(1, rival.maxHp) <= 0.25);
    const danger = el('cx-danger');
    if (danger) danger.hidden = !(duelSim.status === 'playing' && p.hearts <= 1);
    const centerBox = timerEl ? timerEl.parentElement : null;
    if (centerBox) centerBox.classList.toggle('urgent', duelSim.status === 'playing' && (R.MAX_TICKS - duelSim.tick) / R.FPS <= 15);
    // رقم الضرر عند طرف اللوحة: يُشتق من تغيّر الحالة نفسها (لا حدث تخييلي ولا تغيير في الحساب)
    const heartsNow = p.hearts;
    const rivalNow = rival ? Math.max(0, Math.round(rival.hp)) : 0;
    if (duelSideSim !== duelSim) { duelSideSim = duelSim; duelSidePrev = null; }
    if (duelSidePrev && duelSim.status === 'playing') {
      if (heartsNow < duelSidePrev.hearts) duelSideDelta('hero', duelSidePrev.hearts - heartsNow);
      if (rivalNow < duelSidePrev.rival) duelSideDelta('rival', duelSidePrev.rival - rivalNow);
    }
    duelSidePrev = { hearts: heartsNow, rival: rivalNow };
    // شريط الحالة يطفو فوق اللوحة تماماً: ارتفاعها يتغيّر مع طريقة التحكم، فنقيسه مرة كل 30 إطاراً
    if (++duelHudTick % 30 === 1) {
      const pad = el('arena-pad');
      let shown = Boolean(pad) && !pad.hidden;
      if (shown && typeof window.getComputedStyle === 'function') {
        try { shown = window.getComputedStyle(pad).display !== 'none'; } catch (_) { shown = true; }
      }
      let padH = 0;
      if (shown && pad && typeof pad.getBoundingClientRect === 'function') {
        padH = Math.round(pad.getBoundingClientRect().height) || 0;
      }
      const rootStyle = document.documentElement && document.documentElement.style;
      if (rootStyle && typeof rootStyle.setProperty === 'function') {
        rootStyle.setProperty('--cx-pad-h', `${Math.max(0, padH)}px`);
      }
    }

    if (duelSim.status === 'playing') {
      const intent = rival && rival.state === 'windup' ? INTENT_LABEL[rival.attack] || 'هجوم' : '';
      const parts = [];
      if (p.combo >= 2) parts.push(`سلسلة ×${p.combo}`);
      if (p.guard) parts.push(`درع ${Math.round(100 * p.guard.stamina / Math.max(1, p.guard.maxStamina))}%`);
      if (intent) parts.push(intent);
      duelStatusLine(parts.join(' · '));
    }
  }

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
      collectFx(duelSim, true);
      for (const ev of duelSim.events || []) {
        if (ev.type === 'hit' && ev.damage > 0) duelFreeze = Math.max(duelFreeze, ev.damage >= 2 ? 4 : 2);
        else if (ev.type === 'hurt') duelFreeze = Math.max(duelFreeze, 3);
      }
      // لافتة السلسلة: تُعلن عند العتبات فقط (٣، ٥، …) فوق رأس البطل
      const combo = duelSim.player.combo || 0;
      if (combo >= 3 && combo !== duelLastCombo) {
        const pl = duelSim.player;
        arenaFloaters.push({ x: pl.x + pl.w / 2, y: pl.y - 6, text: `×${combo}`, color: combo >= 6 ? '#ffd166' : '#ffe9a8', life: 44, maxLife: 44, size: 18, scale: 1 });
      }
      duelLastCombo = combo;
      duelAcc -= R.DT;
    }
    arenaTick2();
    duelDraw();
    duelHud();
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
    const z = Math.max(0, Math.min((R.MINES?.length || 1) - 1, Number.isInteger(zone) ? zone : arenaZone));
    hideArenaPreview();
    duelZone = z;
    duelInputs = []; duelKeys.clear(); duelPointers.clear(); duelPulses.clear();
    arenaParticles = []; arenaFloaters = []; arenaShake = 0;
    duelAcc = 0; duelStamp = 0; duelOver = false; duelEndedTick = 0;
    duelFreeze = 0; duelLastCombo = 0; duelPendingMask = 0; duelHeartsCache = '';
    duelVerdictHide();
    arenaHintHide();
    duelStatusLine('جارٍ فتح المبارزة…');
    duelBanner('');
    let config = R.normalizeConfig({ zone: z, goal: selectedGoal, mode: 'duel', loadout: liveLoadout() });
    try {
      await bridge.ready(); owner = bridge.user();
      if (owner) {
        const issued = await request('/api/platform/start', { zone: z, goal: selectedGoal, mode: 'duel' });
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
    duelSim = R.create(currentHero, duelTicket?.id ? R.seedFromId(duelTicket.id) : undefined, config);
    hintReminderShown = false; // V12.1: كل مبارزة تبدأ بتلميحها الأساسي وتذكير واحد متاح
    duelRunning = true; duelPaused = false;
    document.body.classList.add('duel-live');
    const pad = el('arena-pad'); if (pad) pad.hidden = false;
    audioUnlock();
    duelStatusLine('اقرأ إنذار الخصم: الضربة القريبة تُصدّ، والكاسرة تُقفز أو تُراوغ.');
    duelDraw(); duelHud();
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
    const payload = { id: duelTicket?.id, inputs: duelInputs, hero: currentHero };
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
      pending = payload; save(true); el('platform-start').disabled = true;
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
    if (arenaDuelVisible()) { arenaSim = null; arenaZone = duelZone; showArenaPreview(duelZone); }
    window.dispatchEvent(new CustomEvent('platform-duel-done', { detail: { zone: duelZone } }));
  }
  // خطوة يدوية (للاختبار الآلي ولمُغذّي المتصفح): تُسجّل الإدخال وتُقدّم المحاكاة بلا rAF
  function duelAdvance(mask = 0, frames = 1) {
    if (!duelSim) return null;
    const n = Math.max(1, Math.min(900, Number(frames) || 1));
    for (let i = 0; i < n && duelSim.status === 'playing'; i++) {
      duelRecord(mask);
      R.step(duelSim, mask);
      collectFx(duelSim, true);
    }
    arenaTick2();
    duelDraw(); duelHud();
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

  // Expose for tests and cross-module coordination
  window.PlatformGame = {
    pause, onShow, showArenaPreview, hideArenaPreview,
    // مبارزة الساحة المستقلة (على مسرح تبويب الساحة نفسه)
    startArenaRun, duelBusy, pauseDuel, resumeDuel, duelAdvance, duelAbandon,
    padMode: () => padMode, setPadMode: applyPadMode, stickState: () => arenaStick.inspect(),
    duelInspect: () => ({ ...duelBusy(), rival: duelSim?.enemies?.[0]?.name || null, hearts: duelSim?.player?.hearts ?? null, inputs: duelInputs.length }),
    // حالة المسرح الاستعراضي (لاختبار بصري حقيقي: هل يتقدّم؟ من الخصم المعروض؟)
    arenaInspect: () => ({ zone: arenaZone, tick: arenaSim?.tick ?? 0, running: Boolean(arenaRaf), rival: arenaSim?.enemies?.[0]?.name || null,
      frozen: arenaFrozen, snapshot: arenaSnapshotKind, rivalState: arenaSim?.enemies?.[0]?.state || null,
      waves: (arenaSim?.waves || []).length }),
    arenaSnapshot, arenaSnapshotOff, setHero, setZone, setGoal, refresh: refreshPreview, getZone: () => selectedZone, getGoal: () => selectedGoal, getHero: () => currentHero, unlockedMines, coach: maybeCoach,
    // تخطيط بلا تمرير: حالة المشهد ونافذة الإعدادات (عرض فقط، للاختبارات والتنسيق)
    syncSceneState, openCtlSettings, closeCtlSettings, layoutEditing: () => layoutEditing,
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
      sceneLive: Boolean(running && !paused),
      ctlOpen: el('ctl-modal') ? !el('ctl-modal').hidden : false,
      layoutEditing: Boolean(layoutEditing),
    }),
    feed, resetFeed() { feedIndex = 0; feedFrame = 0; },
    // يبدأ مبارزة حيّة من شاشة الساحة: نفس محرك الحركة، وضع duel فقط.
    // مبارزة الساحة: تجري في تبويب الساحة نفسه بنفس المحرك، ولا تلمس جولة المنجم ولا وضعها
    startDuel(zone = 0) {
      if (duelRunning || duelSubmitting) return false;
      // لا شرط على جولة المنجم هنا: المبارزة تجري في تبويب الساحة، وجولة المنجم تبقى مجمّدة كما هي
      void startArenaRun(Number.isInteger(zone) ? zone : arenaZone);
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
