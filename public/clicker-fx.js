/* تبويب التعدين التفاعلي «مركز الكهف» — طبقة عرض فقط.
   لا تغيّر الذهب ولا الطاقة ولا أي عملية خادمية: منطق اللعبة في index.html (handleMine / buyUpgrade / activateBoost)
   يحسم النتيجة أولاً ثم يستدعي هذه الدوال لعرضها: صخرة خام تميل نحو اللمس وتتفتت شرراً ومعدّن يتفاعل، سلسلة نقرات وتوهّج حرارة،
   شريط طاقة بحالات، زر تعزيز حيّ، ميداليات ترقية بحلقات تقدّم مع نافذة ترقية، زر «إلى المنجم»، وصوت اختياري.
   موقع الحفر (public/dig-site.js) يستعمل burst/cue/touched هنا ليظهر تفتّت الصخرة وصوتها؛ كل ضربة منه تمرّ عبر handleMine → tap كأي نقرة.
   إن غاب هذا الملف أو تعطّل يبقى التعدين يعمل بالمسار القديم (أرقام طائرة فقط).
   النماذج الصافية (createHeat / energyView / boostView / nodeView / sheetView / …) تُختبر في Node بلا DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ClickerFX = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const REGEN_PER_SEC = 3;              // نفس معدل تجدد الطاقة في حلقة الـ100ms داخل الصفحة
  const BOOST_MS = 30_000;
  const BOOST_COOLDOWN_MS = 5 * 60_000;
  const LOW_ENERGY = 0.2;
  const MAX_PARTICLES = 150;
  const MAX_FLOATS = 24;
  const MUTE_KEY = 'mining-fx-muted';
  const TAPPED_KEY = 'mining-fx-tapped';
  const HINT_KEY = 'mining-fx-hint';
  const SCENE_CLASS = 'ck-cave';
  const ASSET_V = 1; // يطابق ?v= في clicker.css
  const SCENE_PORTRAIT = `/assets/cave/cave-portrait.jpg?v=${ASSET_V}`;
  const SCENE_WIDE = `/assets/cave/cave-wide.jpg?v=${ASSET_V}`;
  // ورقتا السبرايت (المعدّن 3×2 والصخرة 3×1) تُرسمان بـbackground في clicker.css بالرابط نفسه، فيُعاد استعمال التنزيل من الذاكرة
  const HERO_SHEET = `/assets/cave/hero-sheet.webp?v=${ASSET_V}`;
  const ORE_SHEET = `/assets/cave/ore-sheet.webp?v=${ASSET_V}`;
  const WIDE_QUERY = '(min-width: 1024px) and (min-aspect-ratio: 1/1), (orientation: landscape) and (max-height: 520px)';

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (n, d = 0) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
  const lerp = (range, t) => range[0] + (range[1] - range[0]) * t;
  const defaultFmt = (n) => Math.floor(num(n)).toLocaleString('en-US');

  // ======================= نماذج صافية =======================

  // سلسلة النقرات + حرارة تمتلئ مع النقر المتواصل وتخبو عند التوقف. للعرض فقط: لا مضاعف ولا مكافأة.
  function createHeat(options) {
    const o = Object.assign({ gap: 700, perTap: 0.045, holdMs: 450, decayPerSec: 0.45, frenzyOn: 1, frenzyOff: 0.4, milestoneEvery: 10 }, options);
    let heat = 0, streak = 0, lastTap = -Infinity, frenzy = false;
    const valueAt = (now) => {
      const idle = now - lastTap;
      return idle <= o.holdMs ? heat : Math.max(0, heat - (o.decayPerSec * (idle - o.holdMs)) / 1000);
    };
    return {
      tap(now) {
        const events = [];
        streak = now - lastTap <= o.gap ? streak + 1 : 1;
        heat = Math.min(1, valueAt(now) + o.perTap);
        lastTap = now;
        if (frenzy && heat < o.frenzyOff) { frenzy = false; events.push('frenzy:end'); }
        if (!frenzy && heat >= o.frenzyOn) { frenzy = true; events.push('frenzy:start'); }
        if (streak % o.milestoneEvery === 0) events.push('milestone');
        return { streak, heat, frenzy, events };
      },
      snapshot(now) {
        const events = [];
        const h = valueAt(now);
        if (frenzy && h < o.frenzyOff) { frenzy = false; events.push('frenzy:end'); }
        return { streak: now - lastTap <= o.gap ? streak : 0, heat: h, frenzy, events };
      },
      reset() { heat = 0; streak = 0; lastTap = -Infinity; frenzy = false; },
    };
  }

  function streakTier(n) { return n >= 25 ? 3 : n >= 10 ? 2 : n >= 3 ? 1 : 0; }

  // حالة الطاقة: ok / low (أقل من 20%) / empty (أقل من كلفة نقرة واحدة) مع عدد النقرات المتبقية وثواني الانتظار
  function energyView(energy, max, cost, regen) {
    const e = Math.max(0, num(energy)), m = Math.max(1, num(max, 1)), c = Math.max(1, num(cost, 1)), r = Math.max(0.01, num(regen, REGEN_PER_SEC));
    const pct = clamp(e / m, 0, 1);
    const level = e < c ? 'empty' : pct < LOW_ENERGY ? 'low' : pct >= 0.999 ? 'full' : 'ok';
    return { pct, level, taps: Math.floor(e / c), wait: e >= c ? 0 : Math.ceil((c - e) / r) };
  }

  // زر التعزيز: ready / active (يتناقص مع الوقت المتبقي) / cooldown (يمتلئ حتى الجاهزية)
  function boostView(now, until, cooldownUntil, duration, cooldown) {
    const dur = num(duration, BOOST_MS), cd = num(cooldown, BOOST_COOLDOWN_MS);
    const u = num(until), c = num(cooldownUntil);
    if (now < u) return { state: 'active', progress: clamp((u - now) / dur, 0, 1), secs: Math.ceil((u - now) / 1000) };
    if (now < c) return { state: 'cooldown', progress: clamp(1 - (c - now) / cd, 0, 1), secs: Math.ceil((c - now) / 1000) };
    return { state: 'ready', progress: 1, secs: 0 };
  }

  // الهدف التالي: أرخص ترقية بين المتاحة (يتعادل بترتيب القائمة) مع تقدّم الرصيد نحوها
  function nextGoal(costs, gold, order) {
    let best = null;
    for (const key of order || ['click', 'bot', 'rig']) {
      const cost = num(costs && costs[key], NaN);
      if (!(cost > 0)) continue;
      if (!best || cost < best.cost) best = { key, cost };
    }
    if (!best) return null;
    const g = Math.max(0, num(gold));
    return { key: best.key, cost: best.cost, progress: clamp(g / best.cost, 0, 1), affordable: g >= best.cost, missing: Math.max(0, Math.ceil(best.cost - g)) };
  }

  // أقواس الميداليات: ارتفاع نسبي (0..1) للميدالية رقم i من n على قوس ضحل (الوسطى أعلى) كأنها تحيط بمدخل المنجم
  function arcLift(i, n) {
    const count = Math.max(1, Math.floor(num(n, 1)));
    if (count < 3) return 0;
    return Math.sin((Math.PI * (clamp(num(i), 0, count - 1) + 0.5)) / count);
  }

  // عرض ميدالية ترقية: كم تملك، سعرها، وتقدّم الرصيد نحوها (حلقة التقدّم) وجاهزيتها (ready تُخضّر الحلقة وتُظهر السهم)
  function nodeView(key, v) {
    const cost = num(v && v.costs && v.costs[key], NaN);
    if (!(cost > 0)) return null;
    const gold = Math.max(0, num(v.gold));
    const affordable = gold >= cost;
    return {
      key, cost, owned: Math.max(0, Math.floor(num(v.owned && v.owned[key]))),
      progress: clamp(gold / cost, 0, 1), affordable, missing: Math.max(0, Math.ceil(cost - gold)),
      state: affordable ? 'ready' : 'poor',
    };
  }

  // نافذة الترقية: الأثر الحالي والتالي من (base + owned × gain) كما تطبّقه UPGRADES.apply فعلاً
  function sheetView(def, key, v) {
    const nv = nodeView(key, v);
    if (!nv) return null;
    const d = def || {};
    const base = num(d.base), gain = num(d.gain);
    return Object.assign({}, nv, { now: base + nv.owned * gain, next: base + (nv.owned + 1) * gain, unit: String(d.unit || '') });
  }

  // أي ميدالية يشير إليها الإرشاد الأخضر: أول ميدالية جاهزة ما لم تُفتح نافذة ترقية من قبل
  function hintTarget(views, hinted) {
    if (hinted) return '';
    for (const x of views || []) if (x && x.state === 'ready') return x.key;
    return '';
  }

  // عدّاد الذهب: قفزات كبيرة (مكافأة/بيع/شراء) تُتابَع بعدّ سلس؛ الفروق الصغيرة (نقرة/دخل) تُعرض فوراً
  function needsTween(shown, target) { return Math.abs(target - shown) > Math.max(30, 0.015 * Math.abs(target)); }
  function followValue(shown, target, dt, rate) {
    const d = target - shown;
    if (Math.abs(d) < 0.6) return target;
    return shown + d * (1 - Math.exp(-num(rate, 12) * Math.max(0, dt)));
  }

  // اتجاه الإمالة: اللمس على يمين القرص يضغط جانبه الأيمن للداخل، وهكذا
  function tiltFor(px, py, rect, max) {
    const w = Math.max(1, num(rect && rect.width, 1)), h = Math.max(1, num(rect && rect.height, 1));
    const nx = clamp((num(px) - (num(rect && rect.left) + w / 2)) / (w / 2), -1, 1);
    const ny = clamp((num(py) - (num(rect && rect.top) + h / 2)) / (h / 2), -1, 1);
    const m = num(max);
    return { rx: -ny * m, ry: nx * m };
  }

  const PALETTES = {
    gold: ['#fff3c4', '#fde68a', '#fbbf24', '#f59e0b'],
    gem: ['#e0f2fe', '#7dd3fc', '#38bdf8'],
    boost: ['#fae8ff', '#f0abfc', '#c084fc', '#fde68a'],
    hot: ['#ffedd5', '#fdba74', '#fb7185', '#fde047'],
    party: ['#fde047', '#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#c084fc'],
    rock: ['#e9d5ff', '#c4b5fd', '#a78bfa', '#d8c4a0'],
  };
  const KINDS = {
    tap: { count: 6, speed: [130, 360], g: 820, ttl: [0.42, 0.78], size: [2, 4.2], cone: 1.25, shapes: ['spark', 'spark', 'chip', 'dot'] },
    milestone: { count: 16, speed: [200, 470], g: 700, ttl: [0.55, 0.95], size: [2.4, 5], cone: 2.6, shapes: ['spark', 'chip', 'dot'] },
    frenzy: { count: 34, speed: [220, 560], g: 640, ttl: [0.6, 1.1], size: [2.5, 5.5], cone: Math.PI, shapes: ['spark', 'chip', 'dot'] },
    level: { count: 70, speed: [260, 680], g: 520, ttl: [1.0, 1.7], size: [3, 6.5], cone: 2.2, shapes: ['chip', 'chip', 'dot'] },
    buy: { count: 18, speed: [160, 420], g: 720, ttl: [0.5, 0.9], size: [2.5, 5], cone: 2.2, shapes: ['chip', 'spark', 'dot'] },
    rock: { count: 4, speed: [90, 280], g: 900, ttl: [0.4, 0.78], size: [2.6, 4.8], cone: 1.5, shapes: ['rock'] },
  };

  // مولّد عشوائي حتمي للاختبارات (LCG)
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  }

  function makeParticles(kind, x, y, o, rng) {
    const spec = KINDS[kind] || KINDS.tap;
    const opt = o || {};
    const rand = rng || Math.random;
    const palette = PALETTES[opt.palette || (kind === 'rock' ? 'rock' : opt.hot ? 'hot' : opt.boosted ? 'boost' : kind === 'level' ? 'party' : 'gold')] || PALETTES.gold;
    const n = Math.max(1, Math.round(spec.count * num(opt.scale, 1) * (opt.hot ? 1.4 : 1) * (opt.boosted ? 1.5 : 1)));
    const out = [];
    const make = (shape, pal, i) => {
      const a = -Math.PI / 2 + (rand() * 2 - 1) * spec.cone;
      const sp = lerp(spec.speed, rand());
      return {
        x: x + (rand() - 0.5) * 8, y: y + (rand() - 0.5) * 8,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: spec.g, age: 0, ttl: lerp(spec.ttl, rand()),
        size: lerp(spec.size, rand()), color: pal[Math.floor(rand() * pal.length)], shape: shape || spec.shapes[Math.floor(rand() * spec.shapes.length)],
        rot: rand() * Math.PI * 2, vr: (rand() * 2 - 1) * 12, i,
      };
    };
    for (let i = 0; i < n; i++) out.push(make(null, palette, i));
    if (kind === 'tap' && rand() < 0.2) out.push(make('shard', PALETTES.gem, n)); // شظية بلّورية من حين لآخر
    return out;
  }

  // خطوة فيزيائية واحدة؛ false عند انتهاء العمر
  function stepParticle(p, dt) {
    p.age += dt;
    if (p.age >= p.ttl) return false;
    p.vx *= Math.max(0, 1 - 2.2 * dt);
    p.vy = p.vy * Math.max(0, 1 - 0.8 * dt) + p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    return true;
  }

  // ======================= صوت اختياري (WebAudio مولَّد، بلا ملفات) =======================
  const SCALE = [523, 587, 659, 784, 880, 988, 1175, 1319];
  function createSound(storage, scope) {
    let ac = null, master = null, muted = false, lastTick = 0;
    try { muted = !!storage && storage.getItem(MUTE_KEY) === 'true'; } catch (e) { /* التخزين غير متاح */ }
    function ctx() {
      if (muted) return null;
      try {
        if (!ac) {
          const AC = scope.AudioContext || scope.webkitAudioContext;
          if (!AC) return null;
          ac = new AC();
          master = ac.createGain();
          master.gain.value = 0.55;
          master.connect(ac.destination);
        }
        if (ac.state === 'suspended' && ac.resume) ac.resume();
        return ac;
      } catch (e) { return null; }
    }
    function tone(freq, dur, o) {
      const c = ctx();
      if (!c) return;
      try {
        const opt = o || {};
        const t = (c.currentTime || 0) + num(opt.delay);
        const osc = c.createOscillator(), g = c.createGain();
        osc.type = opt.type || 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        if (opt.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + opt.slide), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(num(opt.vol, 0.05), t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(master);
        osc.start(t); osc.stop(t + dur + 0.03);
      } catch (e) { /* صوت اختياري */ }
    }
    const arpeggio = (notes, step, o) => notes.forEach((f, i) => tone(f, 0.16, Object.assign({ delay: i * step }, o)));
    return {
      get muted() { return muted; },
      setMuted(v) {
        muted = !!v;
        try { storage && storage.setItem(MUTE_KEY, String(muted)); } catch (e) { /* التخزين غير متاح */ }
        try { if (muted) { if (ac && ac.suspend) ac.suspend(); } else ctx(); } catch (e) { /* صوت اختياري */ }
      },
      unlock() { ctx(); },
      tap(streak, boosted) {
        const now = Date.now();
        if (now - lastTick < 40) return;
        lastTick = now;
        const f = SCALE[Math.min(SCALE.length - 1, Math.floor(num(streak) / 3))];
        tone(f, 0.07, { type: 'triangle', vol: 0.05 });
        tone(f * 2, 0.05, { type: 'sine', vol: 0.02 });
        if (boosted) tone(f * 1.5, 0.08, { type: 'sine', vol: 0.025 });
      },
      denied() { tone(170, 0.14, { type: 'square', vol: 0.03, slide: -70 }); },
      milestone(streak) { tone(SCALE[Math.min(SCALE.length - 1, Math.floor(num(streak) / 10) + 2)] * 2, 0.16, { type: 'sine', vol: 0.05 }); },
      frenzy() { arpeggio([659, 784, 988, 1319], 0.06, { type: 'triangle', vol: 0.055 }); },
      levelUp() { arpeggio([523, 659, 784, 1047, 1319], 0.09, { type: 'triangle', vol: 0.06 }); },
      boost() { tone(280, 0.38, { type: 'sawtooth', vol: 0.03, slide: 760 }); },
      buy() { tone(880, 0.09, { type: 'triangle', vol: 0.05 }); tone(1320, 0.16, { type: 'triangle', vol: 0.05, delay: 0.08 }); },
      open() { tone(660, 0.07, { type: 'triangle', vol: 0.045 }); tone(990, 0.1, { type: 'sine', vol: 0.03, delay: 0.05 }); },
      close() { tone(520, 0.07, { type: 'triangle', vol: 0.03 }); },
      go() { arpeggio([392, 523, 659], 0.07, { type: 'triangle', vol: 0.05 }); },
      // تفتّت الصخرة: ثقل هابط ثم فتات
      crumble() { tone(190, 0.2, { type: 'sawtooth', vol: 0.05, slide: -120 }); tone(330, 0.12, { type: 'triangle', vol: 0.035, slide: -200, delay: 0.03 }); tone(95, 0.26, { type: 'square', vol: 0.03, slide: -45, delay: 0.06 }); },
    };
  }

  // ======================= متحكم الواجهة =======================
  const api = { active: false };
  let els = null, opts = null, ctx2d = null, sound = null;
  let reduced = false;
  const heat = createHeat();
  let particles = [];
  let running = false, raf = 0, lastFrame = 0;
  let cw = 0, ch = 0, cdpr = 1;
  let releaseTimer = 0, bannerTimer = 0, hoverRaf = 0;
  let lastTapAt = 0, lastNudgeAt = 0, lastDenyAt = 0, lastBumpAt = 0, lastPassiveAt = 0, lastHeroAt = 0;
  let lastView = null, levelSeen = null, levelSource = null;
  let shownGold = null, goldTarget = 0, goldTween = false;
  let energyLevel = null, lastPct = -1, boostState = null, statusKey = '';
  let frenzyOn = false, tapped = false, hinted = false, lastHeatShown = -1;
  let nodeEls = new Map(), hintKey = '', pointerEl = null;
  let sheetKey = '', sheetOpener = null, sheetMedal = null, sheetSig = '';

  const clock = () => (opts && opts.now ? opts.now() : Date.now());
  const fmt = (n) => (opts && opts.fmt ? opts.fmt(n) : defaultFmt(n));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setVar = (el, k, v) => { if (!el || !el.style) return; if (el.style.setProperty) el.style.setProperty(k, v); else el.style[k] = v; };
  const isVisible = () => !!(els && els.tab && els.tab.classList && els.tab.classList.contains('active'));
  // مستطيل الصخرة (الغلاف الثابت لا المائل): مرجع الإمالة وموضع الأرقام والاحتفالات
  const oreRect = () => (els.bob || els.ore).getBoundingClientRect();
  const animate = (el, frames, timing) => {
    if (reduced || !el || typeof el.animate !== 'function') return null;
    try { return el.animate(frames, timing); } catch (e) { return null; }
  };

  function announce(text) { if (els && els.live) els.live.textContent = text; }

  // ---------- الطبقة الأمامية: أرقام طائرة وموجات ----------
  function spawn(el, frames, timing) {
    const layer = els.layer;
    if (!layer) return;
    layer.appendChild(el);
    while (layer.childElementCount > MAX_FLOATS && layer.firstElementChild) layer.firstElementChild.remove();
    const a = el.animate && !reduced ? animate(el, frames, timing) : null;
    if (a) { a.onfinish = () => el.remove(); a.oncancel = () => el.remove(); return; }
    // حركة أقل: يظهر ثابتاً ثم يتلاشى بالشفافية فقط
    const fade = el.animate ? el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: 700 }) : null;
    if (fade) { fade.onfinish = () => el.remove(); return; }
    setTimeout(() => el.remove(), 700);
  }

  function floatText(text, x, y, cls, dx, lift) {
    const rise = lift == null ? 112 : lift;
    const el = root.document.createElement('span');
    el.className = `ck-num ${cls || ''}`.trim();
    el.textContent = text;
    const base = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    if (reduced) el.style.transform = base;
    spawn(el, [
      { transform: `${base} scale(.55)`, opacity: 0 },
      { transform: `translate(${x + dx * 0.3}px,${y - rise * 0.27}px) translate(-50%,-50%) scale(1.2)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${x + dx}px,${y - rise}px) translate(-50%,-50%) scale(.92)`, opacity: 0 },
    ], { duration: 820, easing: 'cubic-bezier(.16,.8,.3,1)' });
  }

  function ripple(x, y, cls) {
    const el = root.document.createElement('span');
    el.className = `ck-ring ${cls || ''}`.trim();
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (reduced) { el.style.opacity = '0'; return; }
    spawn(el, [{ transform: 'scale(.25)', opacity: 0.9 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }

  // وميض الضربة: نجمة تتسع وتخبو عند نقطة الاصطدام
  function spark(x, y, cls) {
    if (reduced) return;
    const el = root.document.createElement('span');
    el.className = `ck-spark ${cls || ''}`.trim();
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    spawn(el, [
      { transform: 'scale(.3) rotate(0deg)', opacity: 1 },
      { transform: 'scale(1.15) rotate(35deg)', opacity: 1, offset: 0.35 },
      { transform: 'scale(.65) rotate(65deg)', opacity: 0 },
    ], { duration: 280, easing: 'ease-out' });
  }

  // ---------- جسيمات (Canvas واحد بحلقة تتوقف عند الخمول) ----------
  let sizeDirty = true;
  function ensureCanvasSize() {
    if (!ctx2d || !els.fx || !sizeDirty) return;
    sizeDirty = false;
    const w = Math.max(1, root.innerWidth || els.fx.clientWidth || 1);
    const h = Math.max(1, root.innerHeight || els.fx.clientHeight || 1);
    const dpr = 1; // جسيمات صغيرة سريعة: كثافة 1 تخفّف عمل كل إطار على الهواتف الضعيفة دون فرق ملحوظ
    if (w === cw && h === ch && dpr === cdpr) return;
    cw = w; ch = h; cdpr = dpr;
    els.fx.width = Math.round(w * dpr);
    els.fx.height = Math.round(h * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function emit(kind, x, y, o) {
    if (reduced || !ctx2d) return;
    const list = makeParticles(kind, x, y, o);
    particles.push(...list);
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    ensureLoop();
  }

  function drawParticle(c, p) {
    c.globalAlpha = clamp(1 - Math.pow(p.age / p.ttl, 3), 0, 1);
    c.fillStyle = p.color;
    c.strokeStyle = p.color;
    if (p.shape === 'spark') {
      c.lineWidth = Math.max(1, p.size * 0.7);
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); c.stroke();
    } else if (p.shape === 'dot') {
      c.beginPath(); c.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2); c.fill();
    } else if (p.shape === 'rock') { // شظية صخر زاويّة تدور
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
      c.beginPath(); c.moveTo(-p.size, -p.size * 0.3); c.lineTo(-p.size * 0.1, -p.size); c.lineTo(p.size, -p.size * 0.1); c.lineTo(p.size * 0.4, p.size * 0.9); c.lineTo(-p.size * 0.7, p.size * 0.6); c.closePath(); c.fill(); c.restore();
    } else if (p.shape === 'chip') { // قطعة نقد تدور فتبدو كأنها تنقلب
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1, Math.max(0.18, Math.abs(Math.cos(p.age * 14 + p.i))));
      c.beginPath(); c.ellipse(0, 0, p.size, p.size * 0.72, 0, 0, Math.PI * 2); c.fill(); c.restore();
    } else { // shard: معيّن بلّوري
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
      c.beginPath(); c.moveTo(0, -p.size * 1.6); c.lineTo(p.size, 0); c.lineTo(0, p.size * 1.6); c.lineTo(-p.size, 0); c.closePath(); c.fill(); c.restore();
    }
  }

  function applyHeat(snap) {
    const changed = snap.heat === 0 ? lastHeatShown !== 0 : Math.abs(snap.heat - lastHeatShown) > 0.004;
    if (changed) {
      lastHeatShown = snap.heat;
      setVar(els.glow || els.stage, '--heat', snap.heat.toFixed(3)); // على عنصر التوهّج وحده: متغير على المشهد كله يُعيد حساب أنماط كل أبنائه في كل إطار
    }
    for (const ev of snap.events) if (ev === 'frenzy:end') setFrenzy(false);
    if (snap.streak < 3 && els.streak && els.streak.classList) els.streak.classList.remove('is-on');
  }

  function stepGold(dt) {
    if (!goldTween || shownGold === null) return;
    shownGold = followValue(shownGold, goldTarget, dt, 11);
    if (shownGold === goldTarget) goldTween = false;
    paintGold();
  }

  function frame(ts) {
    raf = 0;
    const t = clock();
    const stamp = num(ts, lastFrame);
    const dt = clamp((stamp - (lastFrame || stamp)) / 1000, 0, 0.05);
    lastFrame = stamp;
    if (ctx2d) {
      ensureCanvasSize();
      ctx2d.clearRect(0, 0, cw, ch);
      ctx2d.globalCompositeOperation = 'lighter';
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!stepParticle(p, dt)) { particles.splice(i, 1); continue; }
        drawParticle(ctx2d, p);
      }
      ctx2d.globalAlpha = 1;
    }
    const snap = heat.snapshot(t);
    applyHeat(snap);
    stepGold(dt);
    if (particles.length || snap.heat > 0.002 || goldTween) raf = root.requestAnimationFrame(frame);
    else { running = false; lastFrame = 0; }
  }

  function ensureLoop() {
    if (running || typeof root.requestAnimationFrame !== 'function') return;
    running = true;
    lastFrame = 0;
    raf = root.requestAnimationFrame(frame);
  }

  // ---------- الصخرة والمعدّن: إمالة وضغط ولمعة وضربة ----------
  function release() {
    if (!els) return;
    els.ore.classList.remove('is-down');
    setVar(els.ore, '--rx', '0deg');
    setVar(els.ore, '--ry', '0deg');
    setVar(els.ore, '--sc', '1');
  }

  function press(info, strength) {
    const s = strength == null ? 1 : strength;
    const t = tiltFor(info.x, info.y, oreRect(), reduced ? 0 : 15 * s);
    els.ore.classList.add('is-down');
    setVar(els.ore, '--rx', `${t.rx.toFixed(1)}deg`);
    setVar(els.ore, '--ry', `${t.ry.toFixed(1)}deg`);
    setVar(els.ore, '--sc', String(reduced ? 0.97 : (1 - 0.065 * s).toFixed(3)));
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(release, 110);
  }

  // نبضة قصيرة للصخرة مع كل ضربة (transform فقط)
  function shine() {
    animate(els.oreImg, [{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 170, easing: 'ease-out' });
  }

  // المعدّن يميل نحو الصخرة مع كل ضربة (بخاصيتي rotate/translate المستقلتين فلا تتعارضان مع حركة التنفس)
  function heroHit() {
    if (!els.hero || reduced || (els.stage.dataset && els.stage.dataset.dig === '1')) return; // موقع الحفر يحرّك المعدّن بنفسه (إطارات ضربة حقيقية)
    const now = clock();
    if (now - lastHeroAt < 70) return;
    lastHeroAt = now;
    animate(els.hero, [{ rotate: '0deg', translate: '0 0' }, { rotate: '4.5deg', translate: '7px 0' }, { rotate: '0deg', translate: '0 0' }], { duration: 170, easing: 'ease-out' });
  }

  function bumpGold() {
    const now = clock();
    if (now - lastBumpAt < 90) return;
    lastBumpAt = now;
    animate(els.gold, [{ transform: 'scale(1.13)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
  }

  function shake() {
    animate(els.btn, [{ translate: '0 0' }, { translate: '-8px 0' }, { translate: '7px 0' }, { translate: '-5px 0' }, { translate: '3px 0' }, { translate: '0 0' }], { duration: 300, easing: 'ease-out' });
  }

  function nudge() {
    lastNudgeAt = clock();
    animate(els.bob, [{ rotate: '0deg' }, { rotate: '-3deg' }, { rotate: '2.5deg' }, { rotate: '-1deg' }, { rotate: '0deg' }], { duration: 750, easing: 'ease-in-out' });
  }

  function onHover(e) {
    if (reduced || !e || e.pointerType !== 'mouse' || hoverRaf) return;
    if (clock() - lastTapAt < 260) return; // لا تقاطع إمالة النقرة
    const px = e.clientX, py = e.clientY;
    hoverRaf = root.requestAnimationFrame(() => {
      hoverRaf = 0;
      const t = tiltFor(px, py, oreRect(), 9);
      els.ore.classList.remove('is-down');
      setVar(els.ore, '--rx', `${t.rx.toFixed(1)}deg`);
      setVar(els.ore, '--ry', `${t.ry.toFixed(1)}deg`);
    });
  }

  // ---------- لُصيقات ولافتات ----------
  function showStreak(h) {
    const el = els.streak;
    if (!el || !el.classList) return;
    const on = h.streak >= 3;
    el.classList.toggle('is-on', on);
    if (!on) return;
    if (els.streakN) els.streakN.textContent = String(h.streak);
    el.dataset.tier = String(streakTier(h.streak));
    animate(el, [{ transform: 'translate(-50%,0) scale(1.18)' }, { transform: 'translate(-50%,0) scale(1)' }], { duration: 150, easing: 'ease-out' });
  }

  function setFrenzy(on) {
    if (frenzyOn === on) return;
    frenzyOn = on;
    els.stage.dataset.frenzy = on ? '1' : '0';
    statusKey = '';
    if (lastView && isVisible()) renderStatus(energyView(lastView.energy, lastView.maxEnergy, lastView.clickPower));
  }

  function banner(text, kind, ms) {
    const el = els.banner;
    if (!el || !el.classList) return;
    el.textContent = text;
    el.dataset.kind = kind || '';
    el.classList.add('is-on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('is-on'), ms || 1500);
  }

  function setStatus(kind, text, icon) {
    const key = `${kind}|${text}`;
    if (key === statusKey) return;
    statusKey = key;
    const el = els.status;
    if (!el || !el.classList) return;
    if (!kind) { el.classList.remove('is-on'); return; }
    el.dataset.kind = kind;
    if (els.statusText) els.statusText.textContent = text;
    if (els.statusIcon && els.statusIcon.setAttribute) els.statusIcon.setAttribute('href', icon);
    el.classList.add('is-on');
  }

  function renderStatus(ev) {
    if (ev.level === 'empty') setStatus('empty', `الطاقة تتجدد · +${REGEN_PER_SEC} كل ثانية`, '#i-bolt');
    else if (ev.level === 'low') setStatus('low', `طاقة منخفضة · ${fmt(ev.taps)} نقرة متبقية`, '#i-bolt');
    else if (frenzyOn) setStatus('hot', 'حمّى التعدين', '#i-flame');
    else setStatus('', '', '');
  }

  // ---------- عدّاد الذهب ----------
  function paintGold() {
    if (els.gold && shownGold !== null) els.gold.textContent = fmt(shownGold);
  }
  function setGoldTarget(target) {
    if (!els.gold) return;
    goldTarget = num(target);
    if (shownGold === null || reduced || !needsTween(shownGold, goldTarget)) { shownGold = goldTarget; goldTween = false; paintGold(); return; }
    goldTween = true;
    ensureLoop();
  }

  // ---------- أحداث اللعب ----------
  function handleEvent(ev, info, h) {
    if (ev === 'frenzy:start') {
      setFrenzy(true);
      banner('حمّى التعدين!', 'hot', 1400);
      emit('frenzy', info.x, info.y, { hot: true });
      opts.haptic('heavy');
      sound.frenzy();
      announce('حمّى التعدين');
    } else if (ev === 'milestone') {
      emit('milestone', info.x, info.y, { hot: h.frenzy, boosted: info.boosted });
      opts.haptic('medium');
      sound.milestone(h.streak);
    } else if (ev === 'frenzy:end') {
      setFrenzy(false);
    }
  }

  function markTapped() {
    if (tapped) return;
    tapped = true;
    els.stage.dataset.fresh = '0';
    try { root.localStorage.setItem(TAPPED_KEY, '1'); } catch (e) { /* التخزين غير متاح */ }
  }

  // موقع الحفر يطلق جسيمات احتفالية في إحداثيات الشاشة (تفتّت الصخرة…) دون المرور بنقرة
  function burst(kind, x, y, o) {
    if (!api.active || !els) return;
    emit(KINDS[kind] ? kind : 'tap', num(x), num(y), o || {});
  }

  // أصوات مسمّاة يستدعيها موقع الحفر (قائمة بيضاء: لا يصل إلا إلى crumble)
  const CUES = ['crumble'];
  function cue(name) {
    if (!api.active || !sound || !CUES.includes(name) || typeof sound[name] !== 'function') return;
    sound[name]();
  }

  // نقرة مقبولة: يستدعيها handleMine بعد أن خصم الطاقة وأضاف الذهب
  function tap(info) {
    if (!api.active || !info) return;
    const t = clock();
    const h = heat.tap(t);
    lastTapAt = t;
    markTapped();
    const boosted = !!info.boosted;
    const cls = h.frenzy ? 'is-hot' : boosted ? 'is-boost' : '';
    press(info, 1);
    ripple(info.x, info.y, cls);
    spark(info.x, info.y, cls);
    floatText(`+${fmt(info.gain)}`, info.x, info.y - 18, cls, (Math.random() * 2 - 1) * 26);
    emit('tap', info.x, info.y, { boosted, hot: h.frenzy });
    emit('rock', info.x, info.y, {});
    shine();
    heroHit();
    bumpGold();
    showStreak(h);
    applyHeat(h); // التوهّج يتحرك في إطار النقرة نفسه لا بعده بإطار
    sound.tap(h.streak, boosted);
    for (const ev of h.events) handleEvent(ev, info, h);
    ensureLoop();
  }

  // نقرة بلا طاقة: اهتزاز خفيف وملصق أحمر (يمنع التكرار المزعج)
  function denied(info) {
    if (!api.active || !info) return;
    const t = clock();
    press(info, 0.45);
    shake();
    if (t - lastDenyAt > 650) {
      lastDenyAt = t;
      floatText('لا طاقة', info.x, info.y - 18, 'is-deny', 0);
    }
    sound.denied();
  }

  function celebrateLevel(level) {
    const r = oreRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    banner(`ارتقيت إلى المستوى ${level}`, 'level', 2200);
    emit('level', x, y, { palette: 'party' });
    opts.haptic('success');
    sound.levelUp();
    announce(`ارتقيت إلى المستوى ${level}`);
  }

  // ---------- ميداليات الترقية ----------
  function medal(o) {
    const art = root.CaveArt;
    if (art && art.medalHTML) return art.medalHTML(o);
    const lvl = o.level == null ? '' : `<span class="cv-lvl">${esc(o.level)}</span>`;
    return `<span class="cv-medal" data-state="${esc(o.state || 'poor')}" style="--p:${num(o.progress).toFixed(3)}"><span class="cv-plate"><svg class="ui-icon cv-fallback" aria-hidden="true"><use href="#${esc(o.icon || 'i-gem')}"/></svg></span>${lvl}</span>`;
  }

  function nodeDefs() {
    const out = [];
    const goals = (opts && opts.goals) || {};
    for (const key of Object.keys(goals)) {
      const d = goals[key] || {};
      out.push({ key, kind: 'upgrade', name: d.name || key, icon: d.icon || 'i-pickaxe', art: key });
    }
    if (opts && typeof opts.workshop === 'function') out.push({ key: 'workshop', kind: 'workshop', name: 'ورشة المعدّن', icon: 'i-gem', art: 'workshop' });
    return out;
  }

  function buildNodes() {
    nodeEls = new Map();
    if (!els.nodes) return;
    const doc = root.document;
    const defs = nodeDefs();
    els.nodes.textContent = '';
    defs.forEach((d, i) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'ck-node';
      b.dataset.ckItem = d.key;
      b.dataset.state = 'poor';
      setVar(b, '--lift', arcLift(i, defs.length).toFixed(3));
      b.setAttribute('aria-label', d.name);
      const tag = d.kind === 'workshop'
        ? '<span class="ck-node-tag is-label"><b>ورشة</b></span>'
        : '<span class="ck-node-tag"><svg aria-hidden="true" focusable="false"><use href="#a-coin"/></svg><b>0</b></span>';
      b.innerHTML = medal({ id: d.art, icon: d.icon, level: d.kind === 'workshop' ? null : 0, progress: d.kind === 'workshop' ? 1 : 0, state: d.kind === 'workshop' ? 'plain' : 'poor' }) + tag;
      b.addEventListener('click', () => openSheet(d.key));
      els.nodes.appendChild(b);
      const q = (sel) => (b.querySelector ? b.querySelector(sel) : null);
      nodeEls.set(d.key, { btn: b, def: d, medal: q('.cv-medal'), lvl: q('.cv-lvl'), cost: q('.ck-node-tag b'), sig: '' });
    });
  }

  function renderNodes(v) {
    if (!nodeEls.size) return;
    const views = [];
    for (const [key, n] of nodeEls) {
      if (n.def.kind === 'workshop') {
        const ready = !!(v.workshop && v.workshop.ready);
        const sig = `w|${ready ? 1 : 0}`;
        views.push({ key, state: ready ? 'ready' : 'poor' });
        if (sig === n.sig) continue;
        n.sig = sig;
        n.btn.dataset.state = ready ? 'ready' : 'poor';
        if (n.medal) n.medal.dataset.state = ready ? 'ready' : 'plain';
        n.btn.setAttribute('aria-label', ready ? `${n.def.name} — ترقية معدات متاحة` : n.def.name);
        continue;
      }
      const nv = nodeView(key, v);
      views.push(nv);
      if (!nv) continue;
      const sig = `${nv.state}|${Math.round(nv.progress * 200)}|${nv.owned}|${nv.cost}`;
      if (sig === n.sig) continue;
      n.sig = sig;
      n.btn.dataset.state = nv.state;
      if (n.medal) { n.medal.dataset.state = nv.state; setVar(n.medal, '--p', nv.progress.toFixed(3)); }
      if (n.lvl) n.lvl.textContent = String(nv.owned);
      if (n.cost) n.cost.textContent = fmt(nv.cost);
      n.btn.setAttribute('aria-label', `${n.def.name} — لديك ${nv.owned} — السعر ${fmt(nv.cost)} ذهب${nv.affordable ? ' — متاحة للشراء' : ''}`);
    }
    renderHint(views);
  }

  // ---------- إرشاد أول مرة ----------
  function renderHint(views) {
    const key = hintTarget(views, hinted || !!sheetKey);
    if (key === hintKey) return;
    hintKey = key;
    if (!pointerEl) {
      pointerEl = root.document.createElement('span');
      pointerEl.className = 'ck-pointer';
      pointerEl.setAttribute('aria-hidden', 'true');
      pointerEl.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 3 4 13h5v8h6v-8h5z"/></svg><span class="ck-pointer-text">اضغط على الأيقونة لفتح نافذة الترقية</span>';
    }
    const n = key ? nodeEls.get(key) : null;
    if (!n || !els.nodes) { pointerEl.hidden = true; return; }
    if (pointerEl.parentNode !== els.nodes) els.nodes.appendChild(pointerEl);
    placePointer();
    pointerEl.hidden = false;
  }

  // السهم تحت مركز الميدالية المقصودة، والنص يتوسّط الصف ولا يخرج عن الشاشة مهما كان موضع الميدالية
  function placePointer() {
    const n = hintKey ? nodeEls.get(hintKey) : null;
    if (!pointerEl || !n || !n.btn) return;
    const ax = num(n.btn.offsetLeft) + num(n.btn.offsetWidth) / 2;
    setVar(pointerEl, '--ax', `${ax.toFixed(1)}px`);
  }

  function markHinted() {
    if (hinted) return;
    hinted = true;
    try { root.localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* التخزين غير متاح */ }
    if (pointerEl) pointerEl.hidden = true;
    hintKey = '';
  }

  // ---------- نافذة الترقية ----------
  const defOf = (key) => (opts && opts.goals && opts.goals[key]) || null;

  function renderSheet() {
    if (!sheetKey || !lastView || !els.sheet) return;
    const def = defOf(sheetKey);
    const sv = def ? sheetView(def, sheetKey, lastView) : null;
    if (!sv) return;
    const sig = `${sheetKey}|${sv.cost}|${sv.owned}|${Math.floor(Math.min(num(lastView.gold), sv.cost))}|${sv.affordable ? 1 : 0}`;
    if (sig === sheetSig) return;
    sheetSig = sig;
    const set = (el, t) => { if (el) el.textContent = t; };
    set(els.sheetTitle, def.name || sheetKey);
    set(els.sheetDesc, def.desc || '');
    set(els.sheetOwned, String(sv.owned));
    set(els.sheetNow, `${fmt(sv.now)} ${sv.unit}`.trim());
    set(els.sheetNext, `${fmt(sv.next)} ${sv.unit}`.trim());
    set(els.sheetCost, fmt(sv.cost));
    set(els.sheetHave, sv.affordable ? `رصيدك ${fmt(num(lastView.gold))}` : `ينقصك ${fmt(sv.missing)}`);
    if (els.sheetCostBox && els.sheetCostBox.classList) els.sheetCostBox.classList.toggle('is-lack', !sv.affordable);
    if (els.sheetBuy) { els.sheetBuy.disabled = !sv.affordable; els.sheetBuy.textContent = sv.affordable ? 'ترقية' : 'الذهب غير كافٍ'; }
    if (sheetMedal) { sheetMedal.dataset.state = sv.state; setVar(sheetMedal, '--p', sv.progress.toFixed(3)); const l = sheetMedal.querySelector ? sheetMedal.querySelector('.cv-lvl') : null; if (l) l.textContent = String(sv.owned); }
  }

  function openSheet(key) {
    if (!api.active || !els || !els.sheet) return;
    if (key === 'workshop') { // الورشة شاشة كاملة مستقلة
      markHinted();
      sound.open();
      opts.haptic('selection');
      if (typeof opts.workshop === 'function') opts.workshop();
      return;
    }
    const def = defOf(key);
    if (!def || !lastView) return;
    sheetOpener = root.document.activeElement || null;
    sheetKey = key;
    sheetSig = '';
    if (els.sheetArt) {
      els.sheetArt.innerHTML = medal({ id: key, icon: def.icon, level: 0, progress: 0, state: 'poor' });
      sheetMedal = els.sheetArt.querySelector ? els.sheetArt.querySelector('.cv-medal') : null;
    }
    renderSheet();
    els.sheet.hidden = false;
    markHinted();
    sound.open();
    opts.haptic('selection');
    announce(`نافذة ترقية: ${def.name}`);
    const focusEl = els.sheetBuy && !els.sheetBuy.disabled ? els.sheetBuy : els.sheetClose;
    try { focusEl && focusEl.focus({ preventScroll: true }); } catch (e) { /* لا شيء */ }
  }

  function closeSheet(silent) {
    if (!els || !els.sheet || els.sheet.hidden) return;
    els.sheet.hidden = true;
    sheetKey = '';
    sheetSig = '';
    sheetMedal = null;
    if (silent !== true) {
      sound.close();
      try { sheetOpener && sheetOpener.focus && sheetOpener.focus({ preventScroll: true }); } catch (e) { /* لا شيء */ }
    }
    sheetOpener = null;
  }

  function onSheetBuy() {
    if (!api.active || !sheetKey || typeof opts.buy !== 'function') return;
    const key = sheetKey;
    const before = num(lastView && lastView.owned && lastView.owned[key]);
    const goldBefore = num(lastView && lastView.gold);
    opts.buy(key); // buyUpgrade: الشراء المتفائل ثم updateUI → sync
    const after = num(lastView && lastView.owned && lastView.owned[key]);
    if (after <= before) { sound.denied(); return; }
    const card = els.sheetCard || els.sheet;
    const r = card.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + 40;
    const spent = Math.max(0, goldBefore - num(lastView && lastView.gold));
    ripple(x, y, '');
    if (spent > 0) floatText(`-${fmt(spent)}`, x, y + 60, 'is-cost', 0);
    emit('buy', x, y, {});
    sound.buy();
    const def = defOf(key) || {};
    announce(`تمت الترقية: ${def.name || key}`);
    sheetSig = '';
    renderSheet();
  }

  function onSheetKey(e) {
    if (!sheetKey || !e) return;
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key !== 'Tab') return;
    // حبس التركيز بين زري النافذة (إغلاق/ترقية)
    const list = [els.sheetClose, els.sheetBuy].filter((b) => b && !b.disabled);
    if (!list.length) return;
    const i = list.indexOf(root.document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i === list.length - 1 ? 0 : i + 1);
    e.preventDefault();
    try { list[next].focus({ preventScroll: true }); } catch (err) { /* لا شيء */ }
  }

  // ---------- المزامنة الدورية (≈10Hz) مع حالة اللعبة ----------
  function sync(v) {
    if (!api.active || !v) return;
    lastView = v;
    setGoldTarget(v.gold);
    const body = root.document && root.document.body;
    const t = num(v.now, clock());
    const shown = isVisible();

    // علامات عامة تُرى في كل التبويبات فتتبع الحالة دائماً: نقطة «ترقية متاحة» وشارة ×2
    if (body && body.classList) {
      const cheapest = nextGoal(v.costs, v.gold);
      body.classList.toggle('ck-can-buy', !!(cheapest && cheapest.affordable));
    }
    const bv = boostView(t, v.boostUntil, v.boostCooldownUntil);
    if (boostState !== bv.state) {
      const prev = boostState;
      boostState = bv.state;
      els.stage.dataset.boost = bv.state === 'active' ? '1' : '0';
      if (body && body.classList) body.classList.toggle('ck-boost-on', bv.state === 'active');
      if (shown && prev !== null) { // التأثيرات المرئية/المسموعة فقط حين يكون التبويب أمام اللاعب
        if (bv.state === 'active') {
          announce('تم تفعيل التعزيز ×2');
          banner('تعزيز ×2', 'boost', 1300);
          const r = oreRect();
          emit('milestone', r.left + r.width / 2, r.top + r.height / 2, { boosted: true, scale: 1.3 });
          sound.boost();
        } else if (prev === 'active') announce('انتهى التعزيز');
        else if (bv.state === 'ready') announce('التعزيز جاهز');
      }
    }
    if (!shown) return;
    if (els.boost) setVar(els.boost, '--p', bv.progress.toFixed(3));

    // الطاقة
    const ev = energyView(v.energy, v.maxEnergy, v.clickPower);
    if (els.energy && energyLevel !== ev.level) {
      const prev = energyLevel;
      energyLevel = ev.level;
      els.energy.dataset.level = ev.level;
      if (prev !== null) {
        if (ev.level === 'empty') announce('نفدت الطاقة');
        else if (ev.level === 'low') announce('الطاقة منخفضة');
        else if (prev === 'empty' || prev === 'low') announce('عادت الطاقة');
      }
    }
    const pct = Math.round(ev.pct * 1000) / 10;
    if (pct !== lastPct) {
      lastPct = pct;
      if (els.ghost) els.ghost.style.width = `${pct}%`;
      if (els.track && els.track.setAttribute) els.track.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (els.regen && els.regen.classList) els.regen.classList.toggle('is-on', ev.pct < 0.999);
    }
    renderStatus(ev);

    // ميداليات الترقية ونافذتها
    renderNodes(v);
    if (sheetKey) renderSheet();

    // المستوى: الاحتفال فقط عند ارتفاعه ضمن المصدر نفسه (محلي/خادمي) كي لا يُحتفى بمزامنة أولى
    if (v.level != null) {
      if (levelSource !== v.levelSource || levelSeen === null) { levelSource = v.levelSource; levelSeen = v.level; }
      else if (v.level > levelSeen) { levelSeen = v.level; celebrateLevel(v.level); }
      else levelSeen = v.level;
    }

    // الدخل السلبي: رقم أخضر صغير كل ثانية على حافة الصخرة يُري أن العمال يشتغلون (يغيب أثناء النقر النشط)
    if (!reduced && num(v.passive) > 0 && t - lastPassiveAt >= 1000 && t - lastTapAt > 1200 && !sheetKey) {
      lastPassiveAt = t;
      const r = oreRect(), a = Math.random() * Math.PI * 2, rad = r.width * 0.36;
      floatText(`+${fmt(v.passive)}`, r.left + r.width / 2 + Math.cos(a) * rad, r.top + r.height / 2 + Math.sin(a) * rad, 'is-auto', 0, 64);
    }

    // دعوة خفيفة بعد خمول طويل
    if (!reduced && ev.level !== 'empty' && t - lastTapAt > 9000 && t - lastNudgeAt > 9000 && !sheetKey) nudge();
  }

  function clearTransient() {
    particles.length = 0;
    heat.reset();
    lastHeatShown = -1;
    setFrenzy(false);
    clearTimeout(releaseTimer);
    clearTimeout(bannerTimer);
    release();
    if (els.layer) els.layer.textContent = '';
    if (els.streak && els.streak.classList) els.streak.classList.remove('is-on');
    if (els.banner && els.banner.classList) els.banner.classList.remove('is-on');
    if (ctx2d) ctx2d.clearRect(0, 0, cw, ch);
    setVar(els.glow || els.stage, '--heat', '0');
  }

  // مشهد الكهف خلف الواجهة كلها ما دام تبويب التعدين مفتوحاً
  function setScene(on) {
    const body = root.document && root.document.body;
    if (body && body.classList) body.classList.toggle(SCENE_CLASS, !!on);
  }

  function onTab(tabId) {
    if (!api.active) return;
    if (tabId === 'mining') { setScene(true); clearTransient(); lastTapAt = clock(); statusKey = ''; if (lastView) sync(lastView); if (hintKey) placePointer(); /* القياس يحتاج تبويباً ظاهراً */ }
    else { setScene(false); closeSheet(true); clearTransient(); }
  }

  // تنزيل خلفية الكهف وورقتي السبرايت في وقت الخمول كي لا يرى اللاعب وميضاً عند أول فتح للتبويب.
  // المعدّن والصخرة صارا background لا <img>، فلا يصل حدث error إلا عبر هذه الصور: الفشل يفعّل رسوماً بديلة بسيطة (CSS) تُبقي الصخرة ظاهرة وقابلة للمس
  function preloadScene() {
    try {
      const wide = !!(root.matchMedia && root.matchMedia(WIDE_QUERY).matches);
      const url = wide ? SCENE_WIDE : SCENE_PORTRAIT;
      const idle = root.requestIdleCallback ? (fn) => root.requestIdleCallback(fn, { timeout: 4000 }) : (fn) => root.setTimeout(fn, 1500);
      idle(() => {
        const load = (src, onFail) => { try { const im = new root.Image(); if (onFail) im.onerror = onFail; im.src = src; } catch (e) { /* لا شيء */ } };
        const fail = (cls) => () => { if (els && els.stage && els.stage.classList) els.stage.classList.add(cls); };
        load(url);
        load(ORE_SHEET, fail('no-ore-art'));
        load(HERO_SHEET, fail('no-hero-art'));
      });
    } catch (e) { /* لا شيء */ }
  }

  function init(options) {
    if (api.active) return true;
    const doc = root.document;
    if (!doc || !doc.getElementById) return false;
    opts = Object.assign({ fmt: defaultFmt, haptic() {}, buy() {}, goals: {}, now: Date.now, mine: null, workshop: null }, options || {});
    const $ = (id) => doc.getElementById(id);
    const q = (sel) => (doc.querySelector ? doc.querySelector(sel) : null);
    els = {
      tab: $('tab-mining'), stage: $('ck-stage'), area: $('click-area'), btn: $('mine-btn'), ore: $('ck-ore'),
      bob: q('#mine-btn .ck-bob'), oreImg: q('#ck-ore .ck-ore-img'), glow: q('#ck-ore .ck-glow'), hero: $('ck-hero'),
      streak: $('ck-streak'), streakN: $('ck-streak-n'),
      status: $('ck-status'), statusText: $('ck-status-text'), statusIcon: $('ck-status-icon'), banner: $('ck-banner'), live: $('ck-live'),
      boost: $('boost-btn'), go: $('ck-go'), nodes: $('ck-nodes'),
      sheet: $('ck-sheet'), sheetCard: q('#ck-sheet .ck-sheet-card'), sheetClose: $('ck-sheet-close'), sheetArt: $('ck-sheet-art'),
      sheetTitle: $('ck-sheet-title'), sheetDesc: $('ck-sheet-desc'), sheetOwned: $('ck-sheet-owned'), sheetNow: $('ck-sheet-now'),
      sheetNext: $('ck-sheet-next'), sheetCostBox: $('ck-sheet-costbox'), sheetCost: $('ck-sheet-cost'), sheetHave: $('ck-sheet-have'), sheetBuy: $('ck-sheet-buy'),
      energy: $('energy-container'), ghost: $('energy-ghost'), track: $('energy-track'), regen: $('ck-regen'),
      gold: $('gold-counter'), soundBtn: $('ck-sound'), fx: $('ck-fx'), layer: $('ck-layer'),
    };
    if (!els.tab || !els.stage || !els.area || !els.btn || !els.ore || !els.fx || !els.layer) { els = null; return false; }
    els.bob = els.bob || els.ore.parentElement;
    ctx2d = els.fx.getContext ? els.fx.getContext('2d') : null;

    try {
      const mq = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)');
      reduced = !!(mq && mq.matches);
      if (mq && mq.addEventListener) mq.addEventListener('change', (e) => { reduced = !!e.matches; });
    } catch (e) { reduced = false; }

    sound = createSound(root.localStorage, root);
    const syncSoundUI = () => { if (els.soundBtn) els.soundBtn.setAttribute('aria-pressed', String(sound.muted)); };
    syncSoundUI();
    if (els.soundBtn) els.soundBtn.addEventListener('click', () => { sound.setMuted(!sound.muted); syncSoundUI(); if (!sound.muted) sound.tap(6, false); });
    // متصفحات iOS لا تفتح الصوت إلا من لمسة/نقرة مكتملة لا من pointerdown
    for (const ev of ['pointerup', 'click', 'touchend', 'keyup']) els.tab.addEventListener(ev, () => sound.unlock(), { passive: true });

    els.btn.addEventListener('pointermove', onHover);
    els.btn.addEventListener('pointerleave', () => { if (clock() - lastTapAt > 120) release(); });
    els.btn.addEventListener('keyup', release);
    if (els.go) els.go.addEventListener('click', () => {
      if (!api.active || typeof opts.mine !== 'function') return;
      opts.haptic('medium');
      sound.go();
      opts.mine();
    });
    if (els.sheetBuy) els.sheetBuy.addEventListener('click', onSheetBuy);
    if (els.sheetClose) els.sheetClose.addEventListener('click', () => closeSheet());
    if (els.sheet) els.sheet.addEventListener('click', (e) => { if (e && e.target === els.sheet) closeSheet(); });
    if (doc.addEventListener) {
      doc.addEventListener('keydown', onSheetKey);
      doc.addEventListener('visibilitychange', () => { if (doc.hidden) clearTransient(); });
    }
    if (root.CaveArt && root.CaveArt.guardImages) root.CaveArt.guardImages(doc);
    if (root.addEventListener) root.addEventListener('resize', () => { sizeDirty = true; if (hintKey) placePointer(); });

    try { tapped = root.localStorage.getItem(TAPPED_KEY) === '1'; } catch (e) { tapped = false; }
    try { hinted = root.localStorage.getItem(HINT_KEY) === '1'; } catch (e) { hinted = false; }
    els.stage.dataset.fresh = tapped ? '0' : '1';
    buildNodes();
    preloadScene();
    lastTapAt = clock();
    api.active = true;
    return true;
  }

  function inspect() {
    const snap = heat.snapshot(clock());
    const nodes = {};
    for (const [key, n] of nodeEls) nodes[key] = n.btn.dataset.state;
    return {
      active: api.active, heat: snap.heat, streak: snap.streak, frenzy: frenzyOn, particles: particles.length,
      floats: els && els.layer ? els.layer.childElementCount || 0 : 0, muted: sound ? sound.muted : null, reduced,
      level: levelSeen, gold: shownGold, energyLevel, boostState, nodes, hint: hintKey, hinted, sheet: sheetKey,
      scene: !!(root.document && root.document.body && root.document.body.classList && root.document.body.classList.contains && root.document.body.classList.contains(SCENE_CLASS)),
    };
  }

  // كل واجهة عامة محصّنة: تعطل مؤثر لا يجوز أن يوقف التعدين أو يمنع الحفظ
  const safe = (fn) => (...args) => {
    try { return fn(...args); } catch (e) { try { root.console.error('ClickerFX:', e && e.message); } catch (_) { /* لا شيء */ } }
  };

  Object.assign(api, {
    VERSION: 3, REGEN_PER_SEC,
    createHeat, streakTier, energyView, boostView, nextGoal, arcLift, nodeView, sheetView, hintTarget, needsTween, followValue, tiltFor, makeRng, makeParticles, stepParticle, createSound,
    init: safe(init), tap: safe(tap), denied: safe(denied), burst: safe(burst), cue: safe(cue), touched: safe(() => { if (api.active && els) markTapped(); }), sync: safe(sync), onTab: safe(onTab), openSheet: safe(openSheet), closeSheet: safe(closeSheet), buyOpen: safe(onSheetBuy), inspect,
  });
  return api;
});
