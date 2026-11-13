/* موقع الحفر: المعدّن في مركز الكهف يمشي بعصا تحكم (أو أسهم لوحة المفاتيح) ويحفر الصخرة بالمعول.
   الصخرة لها «صحة» تظهر شقوقها ثم تتفتت وتظهر صخرة جديدة في مكان آخر فيمشي إليها المعدّن.

   ما يلمس الاقتصاد: ضربة واحدة تصيب الصخرة = استدعاء واحد لـopts.swing(x, y) وهو handleMine الأصلي في الصفحة
   (طاقة واحدة + ذهب القوة الحالية + عملية mine تُجمَّع كأي نقرة). هذا الملف لا يقرأ الذهب ولا الطاقة ولا يكتبهما ولا يتصل بالخادم؛
   إيقاع الضربات التلقائية ≤ 4 في الثانية فلا يتجاوز ما تسمح به النقرات اليدوية أصلاً (الخادم يقصّ فوق 20/ث ويراقب الطاقة).
   المس الصخرة مباشرة ما زال يعدّن فوراً كما كان؛ والمعدّن يمشي إليها ويلوّح بالمعول عرضاً.

   النماذج الصافية (stickVector / stepMiner / separate / createSwing / createRock / pickRockSpot / poseFor …) تُختبر في Node بلا DOM.
   إن غاب هذا الملف يبقى المعدّن والصخرة في مكانيهما الافتراضيين من CSS وتبقى النقرة على الصخرة تعدّن. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.DigSite = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const MineWorld = root.MineWorld || (typeof require === 'function' ? require('./mine-world.js') : null);

  const CFG = Object.freeze({
    SPEED: 0.6,            // عرض الساحة في الثانية عند دفع العصا كاملاً
    DEPTH_SPEED: 0.55,     // سرعة الحركة نحو الأعماق/الأمام نسبةً إلى الأفقية
    MINER_R: 0.05,         // أنصاف أقطار التصادم بوحدات عرض الساحة
    ROCK_R: 0.08,
    REACH_GAP: 0.05,       // مسافة إضافية يبقى معها المعدّن «قادراً على الوصول»
    DEAD: 0.16,            // منطقة ميتة في مركز العصا
    TOWARD: 0.4,           // اتجاه العصا مع اتجاه الصخرة (جيب التمام) الذي يبدأ الحفر التلقائي
    BAND: Object.freeze({ x0: 0.08, x1: 0.92, y0: 0.34, y1: 0.88 }),       // أين تقف قدما المعدّن (نسبة من الساحة)
    ROCK_BAND: Object.freeze({ x0: 0.2, x1: 0.8, y0: 0.38, y1: 0.8 }),     // أين تظهر الصخرة الجديدة
    RESPAWN_MIN: 0.3,      // أدنى مسافة بين المعدّن والصخرة الجديدة (عرض الساحة)
    SWING: Object.freeze({ windup: 0.09, strike: 0.1, recover: 0.07 }),     // ثوانٍ: رفع ثم ضربة (تقع عند نهاية الرفع) ثم عودة
    ROCK_HP: 12,
    STEP_LEN: 0.085,       // طول الخطوة: يبدّل إطار المشي كلما قطع المعدّن هذه المسافة
    DRY_MS: 700,           // بعد رفض الضربة (بلا طاقة) تتوقف المحاولات التلقائية هذه المدة
    CHEER_MS: 750,
    APPROACH_MS: 1600,     // بعد لمس الصخرة من بعيد يتجه المعدّن إليها هذه المدة
  });

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (n, d = 0) => { const v = Number(n); return Number.isFinite(v) ? v : d; };

  // ======================= نماذج صافية =======================

  // العصا: إزاحة الإصبع عن مركز القاعدة → متجه في الدائرة الواحدية. المنطقة الميتة تُعاد قياسها
  // فيبدأ الخرج من 0 عند حافتها ويبلغ 1 عند الحافة الخارجية (حركة ناعمة لا قفزة).
  function stickVector(dx, dy, radius, dead = CFG.DEAD) {
    const r = Math.max(1, num(radius, 1));
    const x = num(dx) / r, y = num(dy) / r;
    const len = Math.hypot(x, y);
    const d = clamp(num(dead, CFG.DEAD), 0, 0.9);
    if (!(len > d)) return { x: 0, y: 0, mag: 0 };
    const m = Math.min(1, len);
    const mag = (m - d) / (1 - d);
    const k = mag / len;
    return { x: x * k, y: y * k, mag };
  }

  // المسافة بوحدات عرض الساحة (الأفقي والعمودي كلٌّ بنسبة من بعده، فيُصحَّح الاستطالة بـaspect = عرض/ارتفاع)
  const dist = (a, b, aspect) => Math.hypot(a.x - b.x, (a.y - b.y) / Math.max(0.2, num(aspect, 1)));

  // خطوة حركة واحدة؛ تعيد المسافة المقطوعة (بوحدات العرض). الأقطار لا تُسرّع (المتجه يُقصّ إلى 1).
  function stepMiner(m, input, dt, aspect, band = CFG.BAND) {
    const ix = num(input && input.x), iy = num(input && input.y);
    const len = Math.hypot(ix, iy);
    if (!(len > 0) || !(num(dt) > 0)) return 0;
    const k = len > 1 ? 1 / len : 1;
    const a = Math.max(0.2, num(aspect, 1));
    const ox = m.x, oy = m.y;
    m.x = clamp(m.x + ix * k * CFG.SPEED * dt, band.x0, band.x1);
    m.y = clamp(m.y + iy * k * CFG.SPEED * CFG.DEPTH_SPEED * dt * a, band.y0, band.y1);
    if (Math.abs(ix) > 0.2) m.face = ix > 0 ? 1 : -1;
    return Math.hypot(m.x - ox, (m.y - oy) / a);
  }

  // المعدّن لا يخترق الصخرة: إن تداخلا يُدفع المعدّن إلى حافتها. يعيد true إن دُفع.
  function separate(m, rock, aspect, minDist = CFG.MINER_R + CFG.ROCK_R) {
    const a = Math.max(0.2, num(aspect, 1));
    let dx = m.x - rock.x, dy = (m.y - rock.y) / a;
    let d = Math.hypot(dx, dy);
    if (d >= minDist) return false;
    if (d < 1e-6) { dx = 1; dy = 0; d = 1; }          // فوقها تماماً: ادفعه يميناً
    const k = minDist / d;
    m.x = rock.x + dx * k;
    m.y = rock.y + dy * k * a;
    return true;
  }

  const reachDistance = () => CFG.MINER_R + CFG.ROCK_R + CFG.REACH_GAP;
  const inReach = (m, rock, aspect, reach = reachDistance()) => dist(m, rock, aspect) <= reach + 1e-9;

  // مدخل العصا الذي يُمشي المعدّن مباشرة نحو الهدف (يُستعمل في الاقتراب التلقائي)
  function dirTo(m, target, aspect) {
    const a = Math.max(0.2, num(aspect, 1));
    const dx = target.x - m.x, dy = (target.y - m.y) / a / CFG.DEPTH_SPEED;
    const len = Math.hypot(dx, dy);
    return len > 1e-9 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
  }

  // جيب تمام الزاوية بين اتجاه الحركة الفعلي (مدخل العصا) واتجاه الصخرة: 1 = نحوها تماماً
  function alignment(input, m, rock, aspect) {
    const a = Math.max(0.2, num(aspect, 1));
    const vx = num(input && input.x), vy = num(input && input.y) * CFG.DEPTH_SPEED;
    const tx = rock.x - m.x, ty = (rock.y - m.y) / a;
    const lv = Math.hypot(vx, vy), lt = Math.hypot(tx, ty);
    return lv > 1e-9 && lt > 1e-9 ? (vx * tx + vy * ty) / (lv * lt) : 0;
  }

  // الضربة: رفع ← ضربة (الحدث «hit» عند بدايتها) ← عودة. تعيد أحداثاً 'hit' و'done'. دورة كاملة ≈ 0.26 ث (≈ 3.8 ضربة/ث)
  function createSwing(t = CFG.SWING) {
    let phase = 'idle', clock = 0;
    return {
      get phase() { return phase; },
      start() { if (phase !== 'idle') return false; phase = 'windup'; clock = 0; return true; },
      cancel() { phase = 'idle'; clock = 0; },
      update(dt) {
        const ev = [];
        if (phase === 'idle') return ev;
        clock += Math.max(0, num(dt));
        if (phase === 'windup' && clock >= t.windup) { phase = 'strike'; clock -= t.windup; ev.push('hit'); }
        if (phase === 'strike' && clock >= t.strike) { phase = 'recover'; clock -= t.strike; }
        if (phase === 'recover' && clock >= t.recover) { phase = 'idle'; clock = 0; ev.push('done'); }
        return ev;
      },
    };
  }

  // الصخرة: صحة بصرية فقط (لا علاقة لها بالاقتصاد)؛ مرحلة الشقوق من نسبتها: 0 سليمة، 1 متشققة، 2 توشك على التفتت
  const rockStage = (hp, max) => { const f = max > 0 ? hp / max : 0; return f > 2 / 3 ? 0 : f > 1 / 3 ? 1 : 2; };
  function createRock(spot, hp = CFG.ROCK_HP) { const max = Math.max(1, Math.floor(num(hp, CFG.ROCK_HP))); return { x: num(spot && spot.x, 0.7), y: num(spot && spot.y, 0.78), hp: max, max }; }
  function hitRock(rock, power = 1) {
    rock.hp = Math.max(0, rock.hp - Math.max(0, num(power, 1)));
    return { hp: rock.hp, stage: rockStage(rock.hp, rock.max), broken: rock.hp <= 0 };
  }

  // مكان الصخرة الجديدة: داخل نطاقها، بعيداً عن المعدّن وعن أزرار التحكم (avoid = مستطيلات بنسب الساحة)؛ وإلا فأبعد مرشح، وإلا مرآة المعدّن
  // hardMin: أقل مسافة مقبولة مطلقاً (متناول المعدّن)؛ minDist: المفضّلة. إن تعذّرت المفضّلة يُختار أبعد مرشح مقبول.
  function pickRockSpot(rng, miner, aspect, avoid = [], band = CFG.ROCK_BAND, minDist = CFG.RESPAWN_MIN, hardMin = 0) {
    const r = typeof rng === 'function' ? rng : Math.random;
    const at = { x: num(miner && miner.x, 0.5), y: num(miner && miner.y, 0.75) };
    let best = null;
    for (let i = 0; i < 40; i++) {
      const p = { x: band.x0 + r() * (band.x1 - band.x0), y: band.y0 + r() * (band.y1 - band.y0) };
      const blocked = (avoid || []).some((z) => p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1);
      if (blocked) continue;
      const d = dist(p, at, aspect);
      if (d >= minDist) return p;
      if (d >= hardMin && (!best || d > best.d)) best = { p, d };
    }
    return best ? best.p : { x: clamp(1 - at.x, band.x0, band.x1), y: clamp(at.y, band.y0, band.y1) };
  }

  // الحجم بحسب العمق: الأقرب إلى الشاشة (y أكبر) أكبر قليلاً
  const depthScale = (y, band = CFG.BAND) => 0.84 + 0.26 * clamp((num(y) - band.y0) / Math.max(1e-6, band.y1 - band.y0), 0, 1);

  // إطار المعدّن المعروض: ورقة السبرايت فيها idle/walk1/walk2/raise/strike/cheer
  const WALK_CYCLE = Object.freeze(['walk1', 'idle', 'walk2', 'idle']);
  function poseFor(s) {
    if (s && s.cheer) return 'cheer';
    const phase = s && s.phase;
    if (phase === 'windup') return 'raise';
    if (phase === 'strike') return 'strike';
    if (phase === 'recover') return 'idle';
    if (s && s.moving) { const i = Math.floor(num(s.step)); return WALK_CYCLE[((i % 4) + 4) % 4]; }
    return 'idle';
  }

  // ======================= متحكم الواجهة =======================
  const api = { active: false };
  let els = null, opts = null, fx = null;
  let W = 1, H = 1, aspect = 1, rockW = 120, rockH = 108, measured = false;
  // مقاسات تصادم من حجم الرسم الفعلي: تُحسب في measure()؛ القيم الافتراضية هي ثوابت CFG
  let band = CFG.BAND, rockBand = CFG.ROCK_BAND, R = { sep: CFG.MINER_R + CFG.ROCK_R, reach: CFG.MINER_R + CFG.ROCK_R + CFG.REACH_GAP };
  const MAX_DT = 0.1;                              // أبطأ من 10 إطارات/ث لا يُعوَّض بقفزات أكبر (يبقى إيقاع الضربات ≤ ما يسمح به الزمن الحقيقي)
  let clock = 0;                                   // ملّي ثانية متراكمة (حقيقية في الحلقة، افتراضية في step للاختبار)
  const miner = { x: 0.26, y: 0.8, face: 1, step: 0, moving: false };
  let mineWorld = MineWorld ? MineWorld.create() : null;
  const machinery = { drill: false, conveyor: false, worker: false };
  let rock = null;
  const swing = createSwing();
  let swingMode = 'none';                          // 'econ' ضربة تعدّن، 'show' ضربة استعراضية بعد لمس الصخرة (اقتصادها حُسم باللمس)
  let stick = { x: 0, y: 0, mag: 0 };
  const keys = { l: false, r: false, u: false, d: false };
  let digHeld = false, digKey = false;
  let padPointer = null, digPointer = null;
  let approachUntil = 0, dryUntil = 0, cheerUntil = 0, pendingShow = 0;
  let raf = 0, lastTs = 0, reduced = false;
  const stats = { swings: 0, taps: 0, breaks: 0, refused: 0 };
  let last = { miner: '', rock: '', pose: '', act: '', stage: -1, hp: -1 };

  const setVar = (el, k, v) => { if (!el || !el.style) return; if (el.style.setProperty) el.style.setProperty(k, v); else el.style[k] = v; };
  const rngOf = () => (opts && typeof opts.rng === 'function' ? opts.rng : Math.random);
  const haptic = (t) => { try { opts && opts.haptic && opts.haptic(t); } catch (e) { /* لا شيء */ } };
  const stickMag = () => Math.hypot(stick.x + (keys.r ? 1 : 0) - (keys.l ? 1 : 0), stick.y + (keys.d ? 1 : 0) - (keys.u ? 1 : 0));
  const wantsDig = () => digHeld || digKey;

  function tabVisible() { return !!(els && els.tab && els.tab.classList && els.tab.classList.contains('active')); }
  function overlayOpen() {
    const doc = root.document;
    if (!doc || !doc.getElementById) return false;
    const sheet = els.sheet, ws = doc.getElementById('ws-overlay'), mines = doc.getElementById('mines-overlay'), dive = doc.getElementById('dd-overlay');
    return !!((sheet && sheet.hidden === false) || (ws && ws.hidden === false) || (mines && mines.hidden === false) || (dive && dive.hidden === false));
  }
  const paused = () => !api.active || !tabVisible() || overlayOpen() || !!(root.document && root.document.hidden);

  function measure() {
    if (!els) return;
    W = Math.max(1, num(els.world.clientWidth, 1));
    H = Math.max(1, num(els.world.clientHeight, 1));
    measured = num(els.world.clientWidth) > 0 && num(els.world.clientHeight) > 0;   // التبويب المخفي يقيس صفراً: لا نضع شيئاً حتى يظهر
    aspect = W / H;
    rockW = Math.max(1, num(els.rockBtn.offsetWidth, rockW));
    rockH = Math.max(1, num(els.rockBtn.offsetHeight, rockH));
    // الجسم أضيق من إطار الرسم (والمعول يبرز جانباً): نصف قطر الجسم ≈ 46% من نصف عرض الإطار، والصخرة ≈ 80%
    const minerHalf = 0.5 * Math.max(1, num(els.miner.offsetWidth, W * 0.35)) / W, rockHalf = 0.5 * rockW / W;
    const rm = clamp(minerHalf * 0.46, 0.05, 0.14), rr = clamp(rockHalf * 0.8, 0.07, 0.2);
    R = { sep: rm + rr, reach: rm + rr + CFG.REACH_GAP };
    const mx = clamp(minerHalf * 0.8, CFG.BAND.x0, 0.2);                    // يبقى معظم الجسم داخل الإطار عند الحواف
    band = { x0: mx, x1: 1 - mx, y0: CFG.BAND.y0, y1: CFG.BAND.y1 };
    // موضع الصخرة مرساة لمركزها، لكن transform يضخّم صندوقها حتى 1.10× عند أقصى عمق؛ احسب هذا التضخيم مع هامش بكسلات نسبي كي يبقى كامل الزر داخل الساحة.
    const rx = clamp(rockHalf * 1.1 + 0.025, CFG.ROCK_BAND.x0, 0.45);
    // الصخرة تُرسم من مرساة أسفلها؛ لذلك يجب ألا يكون مركزها قريباً من أعلى الساحة
    // بأقل من ارتفاعها المرئي بعد تحجيم العمق. احسب الحد الأدنى من المقاس الفعلي
    // بدلاً من نسبة ثابتة كانت تسمح للصخرة بالخروج من أعلى الحقل على الهاتف.
    let ry0 = CFG.ROCK_BAND.y0;
    for (let i = 0; i < 4; i++) ry0 = Math.max(ry0, (rockH * depthScale(ry0) + 2) / H);
    rockBand = { x0: rx, x1: 1 - rx, y0: Math.min(ry0, CFG.ROCK_BAND.y1), y1: CFG.ROCK_BAND.y1 };
  }

  function avoidZones() {
    // الزاويتان السفليتان تغطيهما العصا وزر الحفر. مرساة الصخرة عند منتصف قاعدتها، فيُمنع كل موضع يتداخل فيه صندوقها مع التحكم
    // بأكثر من ~10% من عرضه وارتفاعه (الرسم أضيق من صندوقه، فلا يُرى التداخل الصغير ولا يسرق لمسة من مركز الصخرة).
    if (!els || !els.pad || !els.dig) return [];
    const margin = 0.03, halfW = 0.4 * rockW / W, lift = 0.1 * rockH / H;
    const zone = (el, left) => {
      const w = num(el.offsetWidth) / W + margin, h = num(el.offsetHeight) / H + margin;
      return left ? { x0: 0, x1: w + halfW, y0: 1 - h + lift, y1: 2 } : { x0: 1 - w - halfW, x1: 1, y0: 1 - h + lift, y1: 2 };
    };
    return [zone(els.pad, true), zone(els.dig, false)];
  }

  // ---------- العرض ----------
  const px = (v) => v.toFixed(1);
  function place(el, x, y, key, lift = 0) {
    const t = `translate3d(${px(x * W)}px, ${px(y * H)}px, 0) translate(-50%, -100%) scale(${depthScale(y).toFixed(3)})`;
    const sig = `${t}|${lift}`;
    if (last[key] === sig) return;
    last[key] = sig;
    el.style.left = '0';
    el.style.top = '0';
    el.style.transform = t;
    el.style.zIndex = String(Math.round(y * 100) + lift);
  }

  function render(pose) {
    if (!els) return;
    if (measured) {
      // عند الوصول يُرسم المعدّن أمام الصخرة كي لا يختفي نصفه خلفها وهو يضربها
      place(els.miner, miner.x, miner.y, 'miner', rock && inReach(miner, rock, aspect, R.reach) ? 8 : 0);
      if (rock) place(els.rockBtn, rock.x, rock.y, 'rock');
    }
    const act = swing.phase !== 'idle' ? 'swing' : miner.moving ? 'walk' : 'idle';
    if (els.miner.dataset) {
      if (last.pose !== pose) { last.pose = pose; els.miner.dataset.pose = pose; }
      if (last.act !== act) { last.act = act; els.miner.dataset.act = act; }
      const face = miner.face > 0 ? '1' : '-1';
      if (els.miner.dataset.face !== face) els.miner.dataset.face = face;
    }
  }

  function paintRock() {
    if (!els || !rock) return;
    const stage = rockStage(rock.hp, rock.max);
    if (last.stage !== stage) { last.stage = stage; if (els.ore && els.ore.dataset) els.ore.dataset.stage = String(stage); }
    if (last.hp !== rock.hp) {
      last.hp = rock.hp;
      if (els.hpFill) els.hpFill.style.width = `${(100 * rock.hp / rock.max).toFixed(1)}%`;
      if (els.hp && els.hp.classList) els.hp.classList.toggle('is-on', rock.hp < rock.max);
    }
  }

  const rockPoint = () => {
    const r = els.world.getBoundingClientRect();
    return { x: num(r.left) + rock.x * W, y: num(r.top) + rock.y * H };
  };
  // نقطة الضربة: جانب الصخرة المواجه للمعدّن (إحداثيات الشاشة، كما تصل إلى handleMine)
  function hitPoint() {
    const p = rockPoint(), s = depthScale(rock.y), side = miner.x <= rock.x ? -1 : 1;
    return { x: p.x + side * rockW * s * 0.2, y: p.y - rockH * s * 0.45 };
  }

  // ---------- منطق الصخرة ----------
  function spawnGhost() {
    const doc = root.document;
    if (!doc || !doc.createElement || !els.world) return;
    try {
      const g = doc.createElement('span');
      g.className = 'ck-ghost';
      g.setAttribute('aria-hidden', 'true');
      g.style.left = '0'; g.style.top = '0';
      g.style.transform = els.rockBtn.style.transform || '';
      g.style.zIndex = els.rockBtn.style.zIndex || '';
      els.world.appendChild(g);
      const a = !reduced && typeof g.animate === 'function' ? g.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '1.28' }], { duration: 380, easing: 'ease-out' }) : null;
      // إخفاء التبويب يُلغي الحركة (cancel لا finish): كلاهما يزيل الشبح، ومؤقّت احتياطي يضمن عدم بقائه
      if (a) a.onfinish = a.oncancel = () => g.remove();
      setTimeout(() => g.remove(), 700);
    } catch (e) { /* زينة */ }
  }

  function popRock() {
    if (reduced || !els.bob || typeof els.bob.animate !== 'function') return;
    try { els.bob.animate([{ scale: '.4', opacity: 0 }, { scale: '1.1', opacity: 1, offset: 0.6 }, { scale: '1', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2,.9,.3,1.2)' }); } catch (e) { /* زينة */ }
  }

  function updateMineScene() {
    if (!els || !mineWorld || !MineWorld) return;
    const mine = MineWorld.MINES[mineWorld.index];
    if (els.world.dataset) {
      els.world.dataset.mine = mine.id;
      els.world.dataset.floor = mineWorld.floor;
    }
    const mineSet = els.world.querySelector ? els.world.querySelector('.ck-mine-set') : null;
    if (mineSet && mineSet.dataset) {
      mineSet.dataset.mine = mine.id;
      mineSet.dataset.floor = mineWorld.floor;
      mineSet.dataset.progress = String(Math.min(3, mineWorld.breaks));
    }
    const sign = els.world.querySelector ? els.world.querySelector('.ck-depth-sign') : null;
    if (sign) {
      const title = sign.querySelector('b'), meta = sign.querySelector('small');
      if (title) title.textContent = mine.name;
      if (meta) meta.textContent = mine.depth + ' · ' + mine.ore + ' · ' + mineWorld.breaks + '/3';
    }
    const gate = els.world.querySelector ? els.world.querySelector('.ck-exit-gate') : null;
    if (gate) {
      gate.dataset.open = mineWorld.breaks >= 3 ? 'true' : 'false';
      gate.textContent = mineWorld.breaks >= 3 ? 'ممر المنجم التالي ←' : 'اكسر ' + (3 - mineWorld.breaks) + ' صخور لفتح الممر';
    }
    const elevator = els.world.querySelector ? els.world.querySelector('.ck-lift-shaft') : null;
    if (elevator) elevator.dataset.floor = mineWorld.floor;
  }

  function breakRock() {
    stats.breaks++;
    if (mineWorld && MineWorld) { MineWorld.recordBreak(mineWorld); updateMineScene(); }
    const p = rockPoint();
    if (!reduced) spawnGhost();           // بلا حركة مخفّضة: لا شبح ثابت يبقى أمام الصخرة الجديدة
    if (fx) {
      fx.burst('rock', p.x, p.y - rockH * 0.35, { scale: 6 });
      fx.burst('milestone', p.x, p.y - rockH * 0.35, { scale: 1.1 });
      fx.cue('crumble');
    }
    haptic('medium');
    cheerUntil = clock + CFG.CHEER_MS;
    let spot = pickRockSpot(rngOf(), miner, aspect, avoidZones(), rockBand, Math.max(CFG.RESPAWN_MIN, R.reach + 0.12), R.reach + 0.02);
    // لا مرشح صالحاً (شاشة ضيقة جداً): الطرف الأبعد من النطاق، كي يضطر المعدّن إلى المشي دائماً
    if (inReach(miner, spot, aspect, R.reach)) spot = { x: miner.x < 0.5 ? rockBand.x1 : rockBand.x0, y: clamp(spot.y, rockBand.y0, rockBand.y1) };
    rock = createRock(spot);
    last.stage = -1; last.hp = -1;
    paintRock();
    render(last.pose || 'idle');          // الصخرة الجديدة في مكانها قبل أن يبدأ ظهورها (لا إطار بالموضع القديم)
    popRock();
    wake();
  }

  function damageRock(n) {
    if (!rock) return;
    const r = hitRock(rock, n);
    paintRock();
    if (r.broken) breakRock();
  }

  // ضربة تعدّن فعلاً: handleMine الأصلي يحسم الطاقة والذهب؛ نصيب الصخرة فقط إن قُبلت
  function economicHit() {
    const pt = hitPoint();
    let ok = false;
    try { ok = !!opts.swing(pt.x, pt.y); } catch (e) { ok = false; }
    if (!ok) { dryUntil = clock + CFG.DRY_MS; stats.refused++; return; }
    stats.swings++;
    damageRock(1);
  }

  // ---------- الحلقة ----------
  function resetInput() {
    stick = { x: 0, y: 0, mag: 0 };
    keys.l = keys.r = keys.u = keys.d = false;
    digHeld = false; digKey = false; padPointer = null; digPointer = null;
    pendingShow = 0;
    if (els) {
      setVar(els.stick, '--sx', '0px'); setVar(els.stick, '--sy', '0px');
      if (els.dig && els.dig.classList) els.dig.classList.remove('is-down');
      if (els.pad && els.pad.classList) els.pad.classList.remove('is-on');
    }
  }

  // توقف كامل (مغادرة التبويب، نافذة مفتوحة، فقدان التركيز): لا مدخلات عالقة ولا ضربة معلّقة تقع لاحقاً
  function halt() {
    resetInput();
    swing.cancel();
    swingMode = 'none';
    miner.moving = false;
    if (els) render('idle');
  }

  function tick(dt) {
    const rk = rock;
    let ix = clamp(stick.x + (keys.r ? 1 : 0) - (keys.l ? 1 : 0), -1, 1);
    let iy = clamp(stick.y + (keys.d ? 1 : 0) - (keys.u ? 1 : 0), -1, 1);
    const manual = Math.hypot(ix, iy) > 0.05;
    const dig = wantsDig();
    let steer = { x: ix, y: iy };
    // اقتراب تلقائي: زر الحفر مضغوط (أو لُمست الصخرة من بعيد) والعصا في المنتصف
    if (!manual && rk && !inReach(miner, rk, aspect, R.reach) && (dig || clock < approachUntil)) steer = dirTo(miner, rk, aspect);

    let moved = 0;
    if (swing.phase === 'idle') {
      const ox = miner.x, oy = miner.y;
      const traversal = mineWorld && MineWorld
        ? MineWorld.step(mineWorld, miner, steer, dt, aspect, band, CFG.SPEED, CFG.DEPTH_SPEED)
        : (stepMiner(miner, steer, dt, aspect, band), { moved: Math.hypot(miner.x - ox, (miner.y - oy) / aspect), transition: null, climbing: false });
      if (rk && !traversal.transition) separate(miner, rk, aspect, R.sep);
      if (traversal.transition) {
        rock = createRock({ x: traversal.transition === 'next' ? 0.72 : 0.28, y: 0.8 });
        last.stage = -1; last.hp = -1; paintRock(); updateMineScene();
        if (fx) fx.cue('milestone');
        haptic('success');
      }
      if (els && els.miner && els.miner.dataset) els.miner.dataset.climbing = traversal.climbing ? 'true' : 'false';
      // احسب الحركة بعد فصل التصادم؛ MineWorld.step يحسب الإزاحة قبل أن يمنع
      // الصخرة المعدّن من التقدم، وإلا تظهر دورة مشي وهو عالق مكانه.
      // الانتقال بين المناجم نقل فوري وليس خطوة مشي أيضاً.
      moved = traversal.transition ? 0 : Math.hypot(miner.x - ox, (miner.y - oy) / Math.max(0.2, aspect));
    }
    miner.moving = moved > 1e-5;
    miner.step += moved / CFG.STEP_LEN;

    const reach = !!rk && inReach(miner, rk, aspect, R.reach);
    if (!reach && clock >= approachUntil) pendingShow = 0;          // لمسة قديمة لا تُنتج ضربة استعراضية متأخرة
    const toward = manual && !!rk && alignment({ x: ix, y: iy }, miner, rk, aspect) > CFG.TOWARD;
    const econ = reach && (dig || toward) && clock >= dryUntil;
    if (swing.phase === 'idle') {
      if (econ) { miner.face = rk.x >= miner.x ? 1 : -1; swingMode = 'econ'; pendingShow = 0; swing.start(); }
      else if (reach && pendingShow > 0) { miner.face = rk.x >= miner.x ? 1 : -1; swingMode = 'show'; pendingShow = 0; swing.start(); }
    }
    for (const e of swing.update(dt)) {
      if (e === 'hit' && swingMode === 'econ') economicHit();
      if (e === 'done') swingMode = 'none';
    }

    const pose = poseFor({ cheer: clock < cheerUntil, phase: swing.phase, moving: miner.moving, step: miner.step });
    render(pose);
  }

  const needsFrame = () => api.active && !paused() && (stickMag() > 0.05 || wantsDig() || clock < approachUntil || swing.phase !== 'idle' || pendingShow > 0 || clock < cheerUntil || miner.moving);

  function frame(ts) {
    raf = 0;
    if (paused()) { halt(); lastTs = 0; return; }
    const real = lastTs ? ts - lastTs : 0;
    lastTs = ts;
    clock += real;
    tick(clamp(real / 1000, 0, MAX_DT));
    if (needsFrame()) raf = root.requestAnimationFrame(onFrame); else lastTs = 0;
  }

  function wake() {
    if (raf || !api.active || typeof root.requestAnimationFrame !== 'function') return;
    if (paused()) return;
    raf = root.requestAnimationFrame(onFrame);
  }

  // ---------- المدخلات ----------
  // كل واجهة ومعالج حدث محصّن: تعطل هذا الملف لا يجوز أن يوقف التعدين أو يمنع الحفظ
  const safe = (fn) => (...args) => {
    try { return fn(...args); } catch (e) { try { root.console.error('DigSite:', e && e.message); } catch (_) { /* لا شيء */ } }
  };
  const onFrame = safe((ts) => frame(ts));
  const hPadMove = safe((e) => onPadMove(e)), hPadUp = safe((e) => onPadUp(e)), hDigUp = safe((e) => onDigUp(e));

  function padCenter() {
    const r = els.pad.getBoundingClientRect();
    return { cx: num(r.left) + num(r.width) / 2, cy: num(r.top) + num(r.height) / 2, radius: (num(r.width) / 2) * 0.62 };
  }
  function moveStick(e) {
    const { cx, cy, radius } = padCenter();
    stick = stickVector(num(e.clientX) - cx, num(e.clientY) - cy, radius);
    setVar(els.stick, '--sx', `${(stick.x * radius).toFixed(1)}px`);
    setVar(els.stick, '--sy', `${(stick.y * radius).toFixed(1)}px`);
  }
  function touched() { if (fx && fx.touched) fx.touched(); }

  function onPadDown(e) {
    if (!e || padPointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    padPointer = e.pointerId == null ? 0 : e.pointerId;
    try { if (els.pad.setPointerCapture && e.pointerId != null) els.pad.setPointerCapture(e.pointerId); } catch (err) { /* اختياري */ }
    if (els.pad.classList) els.pad.classList.add('is-on');
    moveStick(e);
    touched();
    root.addEventListener('pointermove', hPadMove);
    root.addEventListener('pointerup', hPadUp);
    root.addEventListener('pointercancel', hPadUp);
    if (e.preventDefault) e.preventDefault();
    wake();
  }
  function onPadMove(e) { if (e && padPointer !== null && (e.pointerId == null ? 0 : e.pointerId) === padPointer) { moveStick(e); wake(); } }
  function onPadUp(e) {
    if (!e || padPointer === null || (e.pointerId == null ? 0 : e.pointerId) !== padPointer) return;
    padPointer = null;
    stick = { x: 0, y: 0, mag: 0 };
    setVar(els.stick, '--sx', '0px'); setVar(els.stick, '--sy', '0px');
    if (els.pad.classList) els.pad.classList.remove('is-on');
    root.removeEventListener('pointermove', hPadMove);
    root.removeEventListener('pointerup', hPadUp);
    root.removeEventListener('pointercancel', hPadUp);
  }

  function onDigDown(e) {
    if (!e || digPointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    digPointer = e.pointerId == null ? 0 : e.pointerId;
    try { if (els.dig.setPointerCapture && e.pointerId != null) els.dig.setPointerCapture(e.pointerId); } catch (err) { /* اختياري */ }
    digHeld = true;
    if (els.dig.classList) els.dig.classList.add('is-down');
    touched();
    root.addEventListener('pointerup', hDigUp);
    root.addEventListener('pointercancel', hDigUp);
    if (e.preventDefault) e.preventDefault();
    wake();
  }
  function onDigUp(e) {
    if (!e || digPointer === null || (e.pointerId == null ? 0 : e.pointerId) !== digPointer) return;
    digPointer = null;
    digHeld = false;
    if (els.dig.classList) els.dig.classList.remove('is-down');
    root.removeEventListener('pointerup', hDigUp);
    root.removeEventListener('pointercancel', hDigUp);
  }
  // ضغطة لوحة مفاتيح على الزر (Enter/Space) = ضربة واحدة: يقترب المعدّن إن كان بعيداً
  function onDigClick(e) {
    if (e && e.detail !== 0) return;       // النقرات بالمؤشر تعالجها pointerdown
    touched();
    if (rock && inReach(miner, rock, aspect, R.reach)) pendingShow = 0;
    approachUntil = clock + CFG.APPROACH_MS;
    digKey = true;
    setTimeout(() => { digKey = false; }, 260);
    wake();
  }

  const KEYMAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };
  const interactive = (t) => !!(t && t.tagName && /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  function onKey(e, down) {
    if (!e || e.ctrlKey || e.metaKey || e.altKey || paused() || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || ''))) return;
    const k = KEYMAP[e.code];
    if (k) {
      if (down && !keys[k]) touched();
      keys[k] = down;
      if (e.preventDefault) e.preventDefault();
      if (down) wake();
      return;
    }
    if (e.code === 'KeyE' || (e.code === 'Space' && !interactive(e.target))) {
      digKey = down;
      if (e.preventDefault && e.code === 'Space') e.preventDefault();
      if (down) { touched(); wake(); }
    }
  }

  // نقرة مقبولة على الصخرة نفسها (handleMine أضاف الذهب): تُصيب الصخرة ويتجه إليها المعدّن ويلوّح بالمعول إن وصل
  function onTap(info) {
    if (!api.active || !rock) return;
    stats.taps++;
    approachUntil = clock + CFG.APPROACH_MS;
    if (!wantsDig()) pendingShow = 1;
    damageRock(1);
    wake();
  }

  function onTab(tabId) {
    if (!api.active) return;
    halt();
    if (raf && root.cancelAnimationFrame) root.cancelAnimationFrame(raf);
    raf = 0; lastTs = 0;
    try { if (els.world.querySelectorAll) els.world.querySelectorAll('.ck-ghost').forEach((g) => g.remove()); } catch (e) { /* زينة */ }
    if (tabId === 'mining') { measure(); render('idle'); }
  }

  let machineryClient = null;
  let machineStateSynced = false;
  const machineLabels = { drill: ['تشغيل الحفّار', 'إيقاف الحفّار'], conveyor: ['تشغيل سير الخام', 'إيقاف سير الخام'], worker: ['تعيين عامل النقل', 'إرجاع العامل'] };
  function renderMachineryControls(set, consoleEl, message) {
    if (!set || !consoleEl) return;
    set.dataset.drill = machinery.drill ? 'on' : 'off';
    set.dataset.conveyor = machinery.conveyor ? 'on' : 'off';
    set.dataset.worker = machinery.worker ? 'assigned' : 'idle';
    Object.keys(machineLabels).forEach((key) => {
      const button = consoleEl.querySelector('[data-machine-action="' + key + '"]');
      if (!button) return;
      button.setAttribute('aria-pressed', machinery[key] ? 'true' : 'false');
      button.textContent = machineLabels[key][machinery[key] ? 1 : 0];
    });
    const status = consoleEl.querySelector('.ck-machine-status');
    if (status && message) status.textContent = message;
    else if (status) status.textContent = [
      machinery.drill ? 'الحفّار يعمل' : 'الحفّار متوقف',
      machinery.conveyor ? 'السير يعمل' : 'السير متوقف',
      machinery.worker ? 'العامل مكلّف بالنقل' : 'العامل غير مكلّف',
    ].join(' · ');
  }
  function getMachineryClient(set, consoleEl) {
    if (machineryClient || !root.MineMachineryClient || typeof root.MineMachineryClient.create !== 'function') return machineryClient;
    machineryClient = root.MineMachineryClient.create({
      getZone: () => mineWorld ? mineWorld.index : 0,
      onStatus: (message) => { const status = consoleEl && consoleEl.querySelector('.ck-machine-status'); if (status) status.textContent = message; },
      onState: (active) => {
        machinery.drill = active; machinery.conveyor = active; machinery.worker = active;
        renderMachineryControls(set, consoleEl);
      },
      onProduction: async () => { if (opts && typeof opts.refresh === 'function') await opts.refresh(); },
    });
    return machineryClient;
  }
  function syncMachinery() {
    const set = els && els.world && els.world.querySelector ? els.world.querySelector('.ck-mine-set') : null;
    const consoleEl = set && set.querySelector ? set.querySelector('.ck-machine-console') : null;
    const client = getMachineryClient(set, consoleEl);
    if (!client) return Promise.resolve(null);
    machineStateSynced = true;
    return client.sync();
  }

  // المشهد الصناعي الحي: عناصر بيئية مستقلة عن اقتصاد النقر، لكنها تتحرك فعلياً داخل موقع التعدين.
  // تُبنى مرة واحدة داخل العالم حتى لا تتكرر عند إعادة تفعيل التبويب.
  function buildMineSet() {
    if (!els || typeof els.world.insertBefore !== 'function' || (els.world.querySelector && els.world.querySelector('.ck-mine-set'))) return;
    const set = root.document.createElement('div');
    set.className = 'ck-mine-set';
    set.setAttribute('data-drill', 'off'); set.setAttribute('data-conveyor', 'off'); set.setAttribute('data-worker', 'idle');
    set.dataset.drill = 'off'; set.dataset.conveyor = 'off'; set.dataset.worker = 'idle';
    set.setAttribute('aria-label', 'منشآت المنجم وأدوات التحكم بها');
    set.innerHTML = `
      <div class="ck-tunnel ck-tunnel-back"><i></i><b></b></div>
      <div class="ck-tunnel ck-tunnel-side"><i></i><b></b></div>
      <div class="ck-ladder"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><span>ممر علوي</span></div>
      <div class="ck-rail"><i></i><i></i></div>
      <div class="ck-drill-cart"><span class="ck-cart-wheel"></span><span class="ck-cart-body"></span><span class="ck-cart-arm"></span><span class="ck-cart-bit"></span><b>حفّار آلي</b></div>
      <div class="ck-lift-shaft"><i class="ck-lift-cable"></i><span class="ck-lift-cage"><i></i><i></i><b>مصعد</b></span></div>
      <div class="ck-rover"><i></i><b>روبوت نقل</b></div>
      <div class="ck-cave-atmosphere" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><b></b></div>
      <div class="ck-support-beam ck-support-beam-a" aria-hidden="true"></div>
      <div class="ck-support-beam ck-support-beam-b" aria-hidden="true"></div>
      <div class="ck-steam-vent ck-steam-vent-a" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="ck-steam-vent ck-steam-vent-b" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="ck-gallery ck-gallery-upper"><i></i><b></b><span>الممر العلوي</span></div>
      <div class="ck-gallery ck-gallery-lower"><i></i><b></b><span>منطقة الاستخراج</span></div>
      <div class="ck-crystal-seam ck-crystal-seam-a"><i></i><i></i><i></i></div>
      <div class="ck-crystal-seam ck-crystal-seam-b"><i></i><i></i></div>
      <div class="ck-conveyor"><i class="ck-belt"></i><span></span><span></span><span></span><b>نقل الخام</b></div>
      <div class="ck-ore-loader"><i></i><b></b><span></span></div>
      <div class="ck-crew-worker ck-crew-hauler"><i class="ck-worker-pack"></i><b></b><span>عامل نقل</span></div>
      <div class="ck-crew-worker ck-crew-technician"><i class="ck-worker-pack"></i><b></b><span>فني صيانة</span></div>
      <div class="ck-work-lamp"></div>
      <div class="ck-depth-sign"><b>المنجم الحجري</b><small>120 م · حجر ونحاس · 0/3</small></div>
      <div class="ck-exit-gate" data-open="false">اكسر 3 صخور لفتح الممر</div>
      <section class="ck-machine-console" aria-label="لوحة تشغيل المنشآت">
        <b class="ck-machine-console-title">تحكم المنشآت</b>
        <button type="button" data-machine-action="drill" aria-pressed="false">تشغيل الحفّار</button>
        <button type="button" data-machine-action="conveyor" aria-pressed="false">تشغيل سير الخام</button>
        <button type="button" data-machine-action="worker" aria-pressed="false">تعيين عامل النقل</button>
        <small class="ck-machine-status" aria-live="polite">المنشآت متوقفة</small>
      </section>
    `;
    els.world.insertBefore(set, els.world.firstChild);
    const consoleEl = set.querySelector && set.querySelector('.ck-machine-console');
    if (consoleEl) consoleEl.addEventListener('click', safe(async (event) => {
      const button = event.target && event.target.closest ? event.target.closest('[data-machine-action]') : null;
      if (!button || !consoleEl.contains(button)) return;
      const action = button.dataset.machineAction;
      if (!Object.prototype.hasOwnProperty.call(machinery, action)) return;
      const client = getMachineryClient(set, consoleEl);
      if (client && !machineStateSynced) {
        machineStateSynced = true;
        await client.sync();
      }
      if (action === 'worker' && !machinery.conveyor) {
        const status = consoleEl.querySelector('.ck-machine-status');
        if (status) status.textContent = 'شغّل سير الخام أولاً لتعيين عامل النقل';
        return;
      }
      const before = { ...machinery };
      const wasRunning = machinery.drill && machinery.conveyor && machinery.worker;
      machinery[action] = !machinery[action];
      if (action === 'conveyor' && !machinery.conveyor) machinery.worker = false;
      renderMachineryControls(set, consoleEl);
      const shouldRun = machinery.drill && machinery.conveyor && machinery.worker;
      if (client && shouldRun && !wasRunning) {
        const result = await client.start(mineWorld ? mineWorld.index : 0);
        if (!result.ok) { Object.assign(machinery, before); renderMachineryControls(set, consoleEl); }
      } else if (client && wasRunning && !shouldRun) {
        const result = await client.stop();
        if (!result.ok) { Object.assign(machinery, before); renderMachineryControls(set, consoleEl); }
      } else if (!shouldRun) {
        const status = consoleEl.querySelector('.ck-machine-status');
        if (status) status.textContent = 'شغّل الحفّار والسير وعيّن العامل لبدء وردية الإنتاج';
      }
      haptic('light');
    }));
  }

  function init(options) {
    if (api.active) return true;
    const doc = root.document;
    if (!doc || !doc.getElementById) return false;
    opts = Object.assign({ swing() { return false; }, haptic() {}, rng: Math.random }, options || {});
    const $ = (id) => doc.getElementById(id);
    els = {
      tab: $('tab-mining'), root: $('ck-stage'), world: $('ck-world'), miner: $('ck-miner'), rockBtn: $('mine-btn'), ore: $('ck-ore'),
      bob: doc.querySelector ? doc.querySelector('#mine-btn .ck-bob') : null, hp: $('ck-rockhp'), hpFill: doc.querySelector ? doc.querySelector('#ck-rockhp i') : null,
      pad: $('ck-pad'), stick: $('ck-stick'), dig: $('ck-dig'), sheet: $('ck-sheet'),
    };
    if (!els.tab || !els.root || !els.world || !els.miner || !els.rockBtn || !els.ore || !els.pad || !els.dig) { els = null; return false; }
    buildMineSet();
    mineWorld = MineWorld ? MineWorld.create() : null;
    updateMineScene();
    try { const mq = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)'); reduced = !!(mq && mq.matches); if (mq && mq.addEventListener) mq.addEventListener('change', (e) => { reduced = !!e.matches; }); } catch (e) { reduced = false; }
    fx = root.ClickerFX && root.ClickerFX.active ? root.ClickerFX : null;
    rock = createRock({ x: 0.6, y: 0.8 });
    const relayout = safe(() => { measure(); render(last.pose || 'idle'); });
    els.pad.addEventListener('pointerdown', safe(onPadDown));
    els.dig.addEventListener('pointerdown', safe(onDigDown));
    els.dig.addEventListener('click', safe(onDigClick));
    const noMenu = (e) => { if (e && e.preventDefault) e.preventDefault(); };      // الضغط المطوّل على اللمس لا يفتح قائمة السياق فوق التحكم
    els.dig.addEventListener('contextmenu', noMenu);
    els.pad.addEventListener('contextmenu', noMenu);
    if (doc.addEventListener) {
      doc.addEventListener('keydown', safe((e) => onKey(e, true)));
      doc.addEventListener('keyup', safe((e) => onKey(e, false)));
      doc.addEventListener('visibilitychange', safe(() => { if (doc.hidden) halt(); }));
    }
    if (root.addEventListener) root.addEventListener('blur', safe(halt));
    try { if (typeof root.ResizeObserver === 'function') new root.ResizeObserver(relayout).observe(els.world); } catch (e) { /* احتياط: resize */ }
    if (root.addEventListener) root.addEventListener('resize', relayout);
    els.root.dataset.dig = '1';           // يُظهر العصا وزر الحفر (clicker.css) ويُسكت وثبة المعدّن القديمة في ClickerFX
    paintRock();
    measure();
    render('idle');
    api.active = true;
    return true;
  }

  function inspect() {
    return {
      active: api.active, paused: api.active ? paused() : true, clock,
      mine: mineWorld && MineWorld ? { ...mineWorld, definition: MineWorld.MINES[mineWorld.index] } : null,
      machinery: { ...machinery },
      miner: { x: +miner.x.toFixed(4), y: +miner.y.toFixed(4), face: miner.face, moving: miner.moving, pose: last.pose || 'idle' },
      rock: rock ? { x: +rock.x.toFixed(4), y: +rock.y.toFixed(4), hp: rock.hp, max: rock.max, stage: rockStage(rock.hp, rock.max) } : null,
      swing: swing.phase, mode: swingMode, digHeld: wantsDig(), stick: { x: +stick.x.toFixed(3), y: +stick.y.toFixed(3) }, keys: { ...keys }, approaching: clock < approachUntil, cheering: clock < cheerUntil,
      inReach: !!rock && inReach(miner, rock, aspect, R.reach), stats: { ...stats }, size: { W, H }, reach: +R.reach.toFixed(4), band: { x0: +band.x0.toFixed(3), x1: +band.x1.toFixed(3) },
    };
  }

  // خطافات للاختبار: خطوة زمنية حتمية بلا requestAnimationFrame، ومدخلات مباشرة، ووضع المعدّن والصخرة
  const debug = {
    step(dt, n = 1) { for (let i = 0; i < n; i++) { clock += dt * 1000; tick(clamp(dt, 0, MAX_DT)); } },
    setStick(x, y) { stick = { x: clamp(num(x), -1, 1), y: clamp(num(y), -1, 1), mag: Math.hypot(num(x), num(y)) }; },
    setDig(on) { digHeld = !!on; },
    setKey(k, on) { if (k in keys) keys[k] = !!on; },
    place(m, r) { if (m) { miner.x = m.x; miner.y = m.y; if (m.face) miner.face = m.face; } if (r && rock) { rock.x = r.x; rock.y = r.y; } render(last.pose || 'idle'); },
    setRock(spot, hp) { rock = createRock(spot, hp); last.stage = -1; last.hp = -1; paintRock(); render(last.pose || 'idle'); },
    size(w, h) { W = w; H = h; aspect = w / h; },
  };

  Object.assign(api, {
    VERSION: 2, CFG, stickVector, MineWorld, dist, stepMiner, separate, inReach, dirTo, alignment, createSwing, rockStage, createRock, hitRock, pickRockSpot, depthScale, poseFor,
    init: safe(init), onTab: safe(onTab), onTap: safe(onTap), inspect, debug,
  });
  return api;
});
