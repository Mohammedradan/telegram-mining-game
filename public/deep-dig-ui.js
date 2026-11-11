/* الحفر العميق — الواجهة والتحكم: نافذة كاملة فيها بئر عمودي تنزل فيه بعصا التحكم (أو الأسهم/WASD)، تجمع العروق وتتفادى الأخطار،
   وتقرّر متى تصعد بالحبل. نموذج اللعب في deep-dig.js (حتمي، بلا DOM) والرسم في deep-dig-render.js والصوت في cave-sound.js.
   عميل فقط في هذه النسخة: لا ذهب ولا خادم ولا حالة لعبة تُكتب؛ لا يُسجَّل إلا أفضل عمق وأفضل غنيمة في التخزين المحلي.
   المعدات (state.equipment) تُقرأ فقط: المعول/المثقاب سرعة الحفر، الأحذية السرعة، الحقيبة السعة، المغناطيس مدى لمعان العروق...
   كل معالج حدث محصَّن (safe): تعطل هذا الملف لا يجوز أن يوقف التعدين أو يمنع الحفظ في بقية التطبيق. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.DeepDigUI = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DD = root.DeepDig || (typeof require === 'function' ? require('./deep-dig.js') : null);
  const api = { active: false };

  const CFG = Object.freeze({
    PAD_DEAD: 0.14,            // منطقة العصا الميتة (من نصف القطر)
    DIR_DEAD: 0.22,            // أقل إزاحة (بعد إعادة القياس) تُعدّ اتجاهاً
    HYST: 1.2,                 // لا يتبدّل المحور إلا إذا تفوّق الآخر بهذه النسبة (يمنع الارتجاف قرب القطر)
    CAM_FOLLOW: 7,             // نعومة تتبّع الكاميرا (1/ث)
    CAM_LEAD: 0.4,             // موضع المعدّن من أعلى الشاشة
    SKY_ROWS: 6,               // صفوف السماء المرئية فوق السطح (المعدّن يبدأ تحت الشريط العلوي لا خلفه)
    MAX_DT: 0.1,
    HOLD: 0.06,                // توقف لحظي عند الأحداث الثقيلة
    PARTICLES: Object.freeze([26, 70, 140]),
    WORMS: 7,
    RECORD_KEY: 'mining-deep-dig',
    HINT_MS: 3600,
  });

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (n, d = 0) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
  const DEPTH_MAX_M = DD ? DD.CHEST_ROW * DD.METERS_PER_ROW : 122;

  // ======================= نماذج صافية (تُختبر بلا DOM) =======================

  // العصا: إزاحة الإصبع عن مركز القاعدة → متجه في الدائرة الواحدية، مع إعادة قياس المنطقة الميتة (حركة ناعمة لا قفزة)
  function stickVector(dx, dy, radius, dead = CFG.PAD_DEAD) {
    const r = Math.max(1, num(radius, 1));
    const x = num(dx) / r, y = num(dy) / r, len = Math.hypot(x, y), d = clamp(num(dead, CFG.PAD_DEAD), 0, 0.9);
    if (!(len > d)) return { x: 0, y: 0, mag: 0 };
    const m = Math.min(1, len), mag = (m - d) / (1 - d), k = mag / len;
    return { x: x * k, y: y * k, mag };
  }

  // اتجاه واحد من متجه العصا: المحور الأقوى يفوز، ويثبت المحور الحالي ما لم يتفوق الآخر بنسبة HYST
  function pickDir(sx, sy, prevAxis, dead = CFG.DIR_DEAD, hyst = CFG.HYST) {
    const ax = Math.abs(num(sx)), ay = Math.abs(num(sy));
    if (Math.max(ax, ay) < dead) return { dx: 0, dy: 0, axis: prevAxis || 'v' };
    let axis;
    if (prevAxis === 'h') axis = ay > ax * hyst ? 'v' : 'h';
    else if (prevAxis === 'v') axis = ax > ay * hyst ? 'h' : 'v';
    else axis = ax > ay ? 'h' : 'v';
    return axis === 'h' ? { dx: Math.sign(sx), dy: 0, axis } : { dx: 0, dy: Math.sign(sy), axis };
  }

  // الكاميرا: المعدّن عند CAM_LEAD من أعلى الشاشة، محصورة بين السماء والأرضية
  function cameraTarget(minerY, viewRows, rows) {
    const bottom = Math.max(-CFG.SKY_ROWS, rows - viewRows);
    return clamp(minerY - viewRows * CFG.CAM_LEAD, -CFG.SKY_ROWS, bottom);
  }
  const cameraStep = (cam, target, dt) => cam + (target - cam) * (1 - Math.exp(-CFG.CAM_FOLLOW * clamp(num(dt), 0, 0.25)));

  function createParticles(cap) {
    const list = [];
    return {
      list,
      cap,
      add(p) {
        if (list.length >= this.cap) { if (p.kind !== 'label') return false; list.shift(); }
        list.push(Object.assign({ vx: 0, vy: 0, g: 0, rot: 0, vr: 0, size: 0.1, color: '#fff', life: 0.5, max: 0.5 }, p, { max: p.max || p.life || 0.5 }));
        return true;
      },
      step(dt) {
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          p.life -= dt;
          if (p.life <= 0) { list[i] = list[list.length - 1]; list.pop(); continue; }
          p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        }
      },
      clear() { list.length = 0; },
    };
  }

  // جودة الرسم التلقائية: إن بقيت الإطارات بطيئة تنزل درجة (لا ترتفع ثانية داخل نفس الجلسة فلا تتأرجح)
  function createQuality(options) {
    const c = Object.assign({ max: 2, slowMs: 38, slowN: 40 }, options);
    let level = c.max, slow = 0, ema = 16.7;
    return {
      get level() { return level; },
      get ema() { return ema; },
      set(l) { level = clamp(Math.floor(num(l, c.max)), 0, c.max); slow = 0; },
      sample(ms) {
        if (!(ms > 0) || ms > 250) return level;       // إيقاف أو تبديل تبويب ليس بطئاً
        ema += (ms - ema) * 0.1;
        if (ms > c.slowMs) slow++; else slow = Math.max(0, slow - 1);
        if (slow >= c.slowN && level > 0) { level--; slow = 0; ema = 16.7; }
        return level;
      },
    };
  }

  // ---- الأرقام القياسية المحلية (لا شيء منها يُرسل للخادم) ----
  const emptyRecord = () => ({ depthM: 0, value: 0, legend: false, runs: 0, wins: 0, hinted: false });
  function loadRecords(storage) {
    try {
      const raw = JSON.parse(storage.getItem(CFG.RECORD_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return emptyRecord();
      return {
        depthM: clamp(Math.floor(num(raw.depthM)), 0, DEPTH_MAX_M), value: clamp(Math.floor(num(raw.value)), 0, 1e6),
        legend: raw.legend === true, runs: clamp(Math.floor(num(raw.runs)), 0, 1e6), wins: clamp(Math.floor(num(raw.wins)), 0, 1e6), hinted: raw.hinted === true,
      };
    } catch (e) { return emptyRecord(); }
  }
  function saveRecords(storage, rec) { try { storage.setItem(CFG.RECORD_KEY, JSON.stringify(rec)); } catch (e) { /* التخزين غير متاح */ } }
  function applyResult(rec, result) {
    const r = Object.assign(emptyRecord(), rec);
    const newDepth = result.depthM > r.depthM, newValue = result.value > r.value;
    r.depthM = Math.max(r.depthM, clamp(Math.floor(num(result.depthM)), 0, DEPTH_MAX_M));
    r.value = Math.max(r.value, Math.floor(num(result.value)));
    r.runs++;
    if (result.reason === 'won') { r.wins++; r.legend = true; }
    return { rec: r, newDepth, newValue };
  }

  // نصوص نتيجة الجولة
  function resultCopy(res, newDepth) {
    if (res.reason === 'won') return { title: 'قلب الأسطورة!', sub: 'فتحتَ الصندوق ونجوتَ بكنزك', tone: 'win' };
    if (res.reason === 'faint') return { title: 'أُغمي عليك!', sub: res.lostCount ? `فقدتَ ${res.lostCount} من غنيمتك (الأرخص أولاً)` : 'نجوتَ بغنيمتك', tone: 'faint' };
    return { title: newDepth ? 'رقم قياسي جديد!' : 'عدتَ سالماً!', sub: 'صعدتَ بكل غنيمتك', tone: newDepth ? 'best' : 'safe' };
  }

  const depthText = (m) => `${Math.max(0, Math.floor(num(m)))} م`;

  // ======================= الوحدة التفاعلية =======================
  let opts = null, els = null, game = null, rend = null, sound = null, rec = emptyRecord();
  let phase = 'closed', paused = false, raf = 0, lastTs = 0, clock = 0, cam = 0, holdUntil = 0;
  let deepSession = null, replayFrames = [], pendingAscend = false, replayOverflow = false, starting = false, settling = false;
  let stick = { x: 0, y: 0, mag: 0 }, keys = { l: false, r: false, u: false, d: false }, axis = 'v', padPointer = null;
  const particles = createParticles(CFG.PARTICLES[2]);
  const meter = createQuality();
  let lockQ = false, reduced = false, droneOn = false, opener = null, seedUsed = 0, frozen = false;
  const fxs = { shakeAmp: 0, shakeUntil: 0, shakeX: 0, shakeY: 0, flash: 0, gold: 0, digShake: 0 };
  const bannerAt = {};
  let hudSig = '', worms = 0, bannerTimer = 0;
  const stats = { frames: 0, runs: 0 };

  // مستوى الجودة يضبط الرسم (دقة وتوهجات) وسقف الجسيمات معاً؛ الجسيمات الزائدة عن السقف الجديد تُقصّ فوراً
  function applyQuality(level) {
    const q = clamp(Math.floor(num(level, 2)), 0, 2);
    if (rend) rend.setQuality(q);
    particles.cap = CFG.PARTICLES[q];
    if (particles.list.length > particles.cap) particles.list.length = particles.cap;
    return q;
  }
  const rngOf = () => (opts && typeof opts.rng === 'function' ? opts.rng : Math.random);
  const haptic = (t) => { try { opts && opts.haptic && opts.haptic(t); } catch (e) { /* لا شيء */ } };
  const sfx = (name, a) => { try { if (sound) sound.sfx(name, a); } catch (e) { /* لا شيء */ } };
  const safe = (fn) => (...args) => {
    try { return fn(...args); } catch (e) { try { root.console.error('DeepDigUI:', e && e.message); } catch (_) { /* لا شيء */ } }
  };
  const setAttr = (el, k, v) => { if (el && el.setAttribute) el.setAttribute(k, v); };
  const setVar = (el, k, v) => { if (el && el.style) { if (el.style.setProperty) el.style.setProperty(k, v); else el.style[k] = v; } };

  const LAYER_DUST = ['#8a6a46', '#7b8794', '#b58a3a', '#5a4fa8', '#7a3a2a'];
  const layerColor = (r) => LAYER_DUST[Math.max(0, DD.layerIndex(r))] || '#8a6a46';
  const minerPos = () => DD.minerPos(game);

  // ---------- المؤثرات البصرية ----------
  function spawn(kind, x, y, o) { return particles.add(Object.assign({ kind, x, y }, o)); }
  function dust(x, y, n, color, spread = 0.5) {
    for (let i = 0; i < n; i++) spawn('dust', x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.3) * spread * 0.6, { vx: (Math.random() - 0.5) * 0.9, vy: -0.25 - Math.random() * 0.5, life: 0.45 + Math.random() * 0.35, size: 0.08 + Math.random() * 0.07, color });
  }
  function chips(x, y, n, color) {
    for (let i = 0; i < n; i++) spawn('chip', x, y, { vx: (Math.random() - 0.5) * 4, vy: -2 - Math.random() * 3, g: 12, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, life: 0.6 + Math.random() * 0.3, size: 0.07 + Math.random() * 0.07, color });
  }
  function sparks(x, y, n, color, power = 3) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = power * (0.4 + Math.random() * 0.8); spawn('spark', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, g: 5, life: 0.4 + Math.random() * 0.4, size: 0.05 + Math.random() * 0.04, color }); }
  }
  function label(x, y, text, color) { spawn('label', x, y, { vy: -1.1, life: 1.1, text, color, size: 0.3 }); }
  function shake(amp, dur) {
    if (reduced) return;
    fxs.shakeAmp = Math.max(fxs.shakeAmp, amp); fxs.shakeUntil = Math.max(fxs.shakeUntil, clock + dur);
  }
  const holdFor = (sec) => { if (!reduced) holdUntil = Math.max(holdUntil, clock + sec); };

  function banner(text, kind, ms) {
    if (!els || !els.banner) return;
    const key = `${kind}|${text}`;
    if (clock - num(bannerAt[key], -99) < 3) return;       // لا تكرار سريع لنفس الرسالة
    bannerAt[key] = clock;
    els.banner.textContent = text;
    els.banner.dataset.kind = kind || '';
    els.banner.classList.remove('is-on');
    void els.banner.offsetWidth;                            // إعادة تشغيل حركة الظهور
    els.banner.classList.add('is-on');
    if (els.live) els.live.textContent = text;
    if (bannerTimer && root.clearTimeout) root.clearTimeout(bannerTimer);
    bannerTimer = root.setTimeout ? root.setTimeout(() => { if (els && els.banner) els.banner.classList.remove('is-on'); }, num(ms, 1800)) : 0;
  }

  // ---------- أحداث النموذج → صوت وجسيمات ولمس ----------
  function handleEvents(events) {
    if (!game) return;
    for (const e of events) {
      const cx = num(e.c) + 0.5, cy = num(e.r) + 0.5;
      switch (e.type) {
        case 'dig_hit': {
          sfx('dig', { hard: DD.hardnessAt(e.r) });
          dust(cx, cy - 0.05, 2, layerColor(e.r), 0.5);
          fxs.digShake = 1;
          if (e.tile === DD.TILE.BOULDER) shake(1.2, 0.08);
          break;
        }
        case 'dug': sfx('crumble'); chips(cx, cy, 6, layerColor(e.r)); dust(cx, cy, 5, layerColor(e.r), 0.8); break;
        case 'ore': {
          const rel = e.kind === 'relic';
          sfx(rel ? 'relic' : 'ore', { kind: e.kind });
          sparks(cx, cy, rel ? 18 : 8, rel ? '#fff2a8' : '#ffe9a0', rel ? 4.5 : 3);
          label(cx, cy - 0.3, `+${DD.ORES[e.kind].name}`, rel ? '#fff2a8' : '#ffffff');
          haptic(rel ? 'success' : 'light');
          if (rel) { fxs.gold = 0.38; holdFor(CFG.HOLD * 2); banner('أثر قديم!', 'relic', 2200); shake(2, 0.25); }
          break;
        }
        case 'ore_swap': sfx('swap', { kind: e.kind }); sparks(cx, cy, 6, '#ffe9a0', 2.5); label(cx, cy - 0.3, `${DD.ORES[e.kind].name} ⇄ ${DD.ORES[e.dropped].name}`, '#ffd9a0'); banner('الحقيبة ممتلئة: حلّت الأغلى محل الأرخص', 'swap', 1800); haptic('light'); break;
        case 'bag_full': sfx('full'); label(cx, cy - 0.3, 'ممتلئة', '#ff9d8a'); banner('الحقيبة ممتلئة — اصعد أو ابحث عن أغلى', 'full', 1800); haptic('warning'); break;
        case 'gas': sfx('gas'); haptic('warning'); for (let i = 0; i < 12; i++) spawn('bubble', cx + (Math.random() - 0.5) * 1.2, cy + (Math.random() - 0.5) * 1.2, { vx: (Math.random() - 0.5) * 0.4, vy: -0.5 - Math.random() * 0.5, life: 1.2 + Math.random(), size: 0.06 + Math.random() * 0.07, color: '#9cff8c' }); banner('غاز! ابتعد عن السحابة', 'gas', 1800); break;
        case 'rumble': sfx('rumble'); shake(1.6, 0.35); haptic('light'); banner('حذار: صخرة سائبة فوقك!', 'boulder', 1800); break;
        case 'boulder_fall': sfx('fall'); break;
        case 'boulder_land': sfx('land'); shake(3, 0.2); dust(cx, cy + 0.3, 9, '#9a8b7a', 1.1); chips(cx, cy, 5, '#7c7167'); haptic('medium'); break;
        case 'boulder_hit': sfx('land'); shake(6, 0.35); dust(cx, cy, 12, '#9a8b7a', 1.2); chips(cx, cy, 8, '#7c7167'); holdFor(CFG.HOLD * 1.5); break;
        case 'hurt': sfx('hurt'); if (e.kind === 'heat') sfx('heat'); fxs.flash = e.kind === 'boulder' ? 0.5 : 0.3; haptic(e.kind === 'boulder' ? 'heavy' : 'warning'); shake(e.kind === 'boulder' ? 5 : 2, 0.25); break;
        case 'faint': sfx('faint'); haptic('error'); banner('أُغمي عليك!', 'faint', 2000); shake(4, 0.5); break;
        case 'rope_start': sfx('rope'); haptic('medium'); banner('يُسحب الحبل…', 'rope', 1600); break;
        case 'chest': sfx('chest'); haptic('success'); fxs.gold = 0.45; banner('قلب الأسطورة!', 'relic', 2600); holdFor(CFG.HOLD * 2); shake(3, 0.4); sparks(cx, cy, 30, '#ffe38a', 5); break;
        case 'layer': {
          sfx('layer'); haptic('selection');
          if (sound) sound.setLayer(e.index);
          banner(`طبقة ${DD.LAYERS[e.index].name}`, 'layer', 2000);
          break;
        }
        case 'bump': sfx('bump'); break;
        default: break;
      }
    }
  }

  // أجواء حيّة: يراعات حول المعدّن، غبار من الصخور السائبة، جمر قرب الحمم
  function ambientFx(dt) {
    if (!game || reduced || meter.level < 1) return;
    const p = minerPos(), m = game.miner;
    let count = 0;
    for (const q of particles.list) if (q.kind === 'worm') count++;
    worms = count;
    if (count < CFG.WORMS && DD.layerIndex(m.row) >= 0 && Math.random() < dt * 2) {
      const a = Math.random() * 6.28, r = 1 + Math.random() * (game.stats.light - 0.8);
      spawn('worm', p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.8, { vx: 0, vy: 0, life: 7 + Math.random() * 6, size: 0.035, color: Math.random() < 0.5 ? '#9cffd0' : '#c8ff8f', rot: Math.random() * 6.28 });
    }
    for (const q of particles.list) {
      if (q.kind !== 'worm') continue;
      q.vx += (Math.random() - 0.5) * 3 * dt; q.vy += (Math.random() - 0.5) * 3 * dt;
      q.vx *= 0.97; q.vy *= 0.97;
      const dx = q.x - p.x, dy = q.y - p.y;
      if (dx * dx + dy * dy > game.stats.light * game.stats.light) { q.vx -= dx * 0.8 * dt; q.vy -= dy * 0.8 * dt; }
    }
    for (const b of game.loose) if (!b.fall && Math.random() < dt * 16) spawn('dust', b.c + 0.3 + Math.random() * 0.4, b.r + 0.95, { vx: (Math.random() - 0.5) * 0.2, vy: 0.9, life: 0.5, size: 0.05, color: '#9a8b7a' });
    if (m.heat > 0.15 && Math.random() < dt * 14) spawn('ember', p.x + (Math.random() - 0.5) * 0.8, p.y, { vx: (Math.random() - 0.5) * 0.6, vy: -1.2, life: 0.7, size: 0.045, color: '#ff9a3c' });
  }

  // ---------- المدخلات ----------
  function currentDir() {
    const kx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0), ky = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
    const d = pickDir(stick.x + kx, stick.y + ky, axis);
    axis = d.axis;
    return { dx: d.dx, dy: d.dy };
  }
  function resetInput() {
    stick = { x: 0, y: 0, mag: 0 };
    keys.l = keys.r = keys.u = keys.d = false;
    padPointer = null;
    if (els) { setVar(els.stick, '--sx', '0px'); setVar(els.stick, '--sy', '0px'); if (els.pad && els.pad.classList) els.pad.classList.remove('is-on'); }
  }
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
  const onPadMove = safe((e) => { if (e && padPointer !== null && (e.pointerId == null ? 0 : e.pointerId) === padPointer) { moveStick(e); wake(); } });
  const onPadUp = safe((e) => {
    if (!e || padPointer === null || (e.pointerId == null ? 0 : e.pointerId) !== padPointer) return;
    padPointer = null; stick = { x: 0, y: 0, mag: 0 };
    setVar(els.stick, '--sx', '0px'); setVar(els.stick, '--sy', '0px');
    if (els.pad.classList) els.pad.classList.remove('is-on');
    root.removeEventListener('pointermove', onPadMove); root.removeEventListener('pointerup', onPadUp); root.removeEventListener('pointercancel', onPadUp);
  });
  function onPadDown(e) {
    if (!e || phase !== 'run' || padPointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    padPointer = e.pointerId == null ? 0 : e.pointerId;
    try { if (els.pad.setPointerCapture && e.pointerId != null) els.pad.setPointerCapture(e.pointerId); } catch (err) { /* اختياري */ }
    if (els.pad.classList) els.pad.classList.add('is-on');
    moveStick(e);
    root.addEventListener('pointermove', onPadMove); root.addEventListener('pointerup', onPadUp); root.addEventListener('pointercancel', onPadUp);
    if (e.preventDefault) e.preventDefault();
    wake();
  }
  const KEYMAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };
  function onKey(e, down) {
    if (!e || phase === 'closed' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape' || e.key === 'Escape') {
      if (!down) return;
      if (phase === 'run') pause('escape'); else if (phase === 'paused') resume(); else close();
      if (e.preventDefault) e.preventDefault();
      return;
    }
    if (phase !== 'run') return;
    const k = KEYMAP[e.code];
    if (k) {
      keys[k] = down;
      if (down) axis = (k === 'l' || k === 'r') ? 'h' : 'v';     // آخر مفتاح يحسم الاتجاه القطري
      if (e.preventDefault) e.preventDefault();
      if (down) wake();
      return;
    }
    if (e.code === 'KeyR' && down) { ropeNow(); if (e.preventDefault) e.preventDefault(); }
  }

  // ---------- الواجهة (HUD) ----------
  function buildHearts(n) {
    els.hearts.textContent = '';
    for (let i = 0; i < n; i++) {
      const s = root.document.createElement('span');
      s.className = 'dd-heart';
      s.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#i-heart"/></svg>';
      els.hearts.appendChild(s);
    }
  }
  function buildChips() {
    els.chips.textContent = '';
    for (const id of DD.ORE_IDS) {
      const s = root.document.createElement('span');
      s.className = 'dd-chip'; s.dataset.ore = id; s.hidden = true;
      s.innerHTML = `<i class="ore-dot ore-${id}"></i><b>0</b>`;
      els.chips.appendChild(s);
    }
  }
  function renderHud(force) {
    if (!els || !game) return;
    const s = DD.summary(game);
    const sig = [s.depthM, s.layer, s.hp, s.maxHp, s.bagCount, s.bagCap, s.value, s.state === 'rope' ? 1 : 0, phase].concat(DD.ORE_IDS.map((k) => s.bag[k])).join('|');
    if (!force && sig === hudSig) return;
    hudSig = sig;
    els.depth.textContent = depthText(s.depthM);
    els.layer.textContent = s.layer < 0 ? 'السطح' : DD.LAYERS[s.layer].name;
    els.layerBox.dataset.layer = String(s.layer);
    if (els.hearts.childElementCount !== s.maxHp) buildHearts(s.maxHp);
    const hearts = els.hearts.children;
    for (let i = 0; i < hearts.length; i++) hearts[i].classList.toggle('is-empty', i >= s.hp);
    setAttr(els.hearts, 'aria-label', `الصحة ${s.hp} من ${s.maxHp}`);
    els.overlay.dataset.danger = s.hp > 0 && s.hp <= 2 ? '1' : '';
    els.bagCount.textContent = `${s.bagCount}/${s.bagCap}`;
    setVar(els.bagFill, '--fill', `${Math.round((s.bagCount / Math.max(1, s.bagCap)) * 100)}%`);
    els.bagBox.dataset.full = s.bagCount >= s.bagCap ? '1' : '';
    els.value.textContent = String(s.value);
    let anyChip = false;
    for (const chip of els.chips.children) {
      const n = s.bag[chip.dataset.ore] || 0;
      chip.hidden = n === 0;
      if (n) anyChip = true;
      const b = chip.querySelector ? chip.querySelector('b') : null;
      if (b) b.textContent = String(n);
    }
    els.chips.hidden = !anyChip;                          // الصف الثاني يظهر فقط حين توجد غنيمة (يوفر مساحة)
    const canRope = phase === 'run' && s.row >= 1 && s.state !== 'rope' && s.state !== 'faint' && s.state !== 'win';
    els.rope.disabled = !canRope;
    els.rope.dataset.loot = s.bagCount > 0 ? '1' : '';
    setAttr(els.rope, 'aria-label', s.bagCount > 0 ? `الحبل: اصعد بغنيمتك (${s.bagCount} قطعة، قيمتها ${s.value})` : 'الحبل: اصعد إلى السطح');
  }

  // ---------- البطاقات ----------
  function setPhase(p) {
    phase = p;
    if (!els) return;
    els.overlay.dataset.phase = p;
    els.intro.hidden = p !== 'intro';
    els.pause.hidden = p !== 'paused';
    els.summary.hidden = p !== 'summary';
  }
  function gearText() {
    const st = game ? game.stats : DD.loadoutStats({});
    const parts = [`الحقيبة ${st.bagCap}`, `الصحة ${st.maxHp}`];
    if (st.digSpeed > 1) parts.push(`الحفر ×${st.digSpeed.toFixed(1)}`);
    if (st.moveSpeed > DD.CFG.moveSpeed) parts.push(`المشي ×${(st.moveSpeed / DD.CFG.moveSpeed).toFixed(2)}`);
    if (st.light > 3.4) parts.push('مسيّرة مضيئة');
    return parts.join(' • ');
  }
  function renderIntro() {
    els.introBest.textContent = rec.depthM > 0 ? `أعمق نزول: ${depthText(rec.depthM)}${rec.legend ? ' — حاصل على كنز الأسطورة' : ''}` : 'لم تنزل بعد — أول نزول لك!';
    els.introGear.textContent = gearText();
    const eq = opts.getEquipment() || {};
    const any = DD.EQUIPMENT_KEYS.some((k) => num(eq[k]) > 0);
    els.introNote.textContent = any ? 'معدات الورشة تجعل النزول أسهل: حفر أسرع، حقيبة أكبر، صحة أكثر.' : 'ترقيات الورشة تجعل النزول أسهل: حفر أسرع، حقيبة أكبر، صحة أكثر.';
  }
  function renderSummary(res, applied) {
    const copy = resultCopy(res, applied.newDepth);
    els.summary.dataset.tone = copy.tone;
    els.sumTitle.textContent = copy.title;
    els.sumSub.textContent = copy.sub;
    els.sumDepth.textContent = depthText(res.depthM);
    els.sumBest.hidden = !applied.newDepth;
    els.sumLoot.textContent = '';
    for (const id of DD.ORE_IDS) {
      const n = res.kept[id] || 0, lost = res.lost[id] || 0;
      if (!n && !lost) continue;
      const s = root.document.createElement('span');
      s.className = `dd-chip${n ? '' : ' is-lost'}`;
      s.innerHTML = `<i class="ore-dot ore-${id}"></i><b>${n}</b>${lost ? `<small>−${lost}</small>` : ''}`;
      s.title = DD.ORES[id].name;
      els.sumLoot.appendChild(s);
    }
    if (!els.sumLoot.childElementCount) { const s = root.document.createElement('span'); s.className = 'dd-empty'; s.textContent = 'لا غنيمة هذه المرة'; els.sumLoot.appendChild(s); }
    els.sumValue.textContent = String(res.value);
    els.sumNewValue.hidden = !applied.newValue || res.value <= 0;
    els.sumLegend.hidden = !res.legend;
    const heading = els.sumTitle;
    if (heading && heading.focus) { try { els.again.focus({ preventScroll: true }); } catch (e) { /* لا شيء */ } }
  }

  // ---------- دورة اللعب ----------
  function newGame(seed, equipment) {
    const eq = equipment || (opts.getEquipment && opts.getEquipment()) || {};
    replayFrames = []; pendingAscend = false; replayOverflow = false;
    seedUsed = seed != null ? seed >>> 0 : (opts.seed != null ? opts.seed >>> 0 : Math.floor(rngOf()() * 4294967296) >>> 0);
    game = DD.create({ seed: seedUsed || 1, equipment: eq });
    droneOn = DD.normalizeEquipment(eq).robot >= 1;
    particles.clear();
    worms = 0; holdUntil = 0; clock = 0; hudSig = '';
    fxs.shakeAmp = fxs.flash = fxs.gold = fxs.digShake = 0;
    resetInput(); axis = 'v';
    cam = cameraTarget(minerPos().y, rend.layout.viewRows, DD.ROWS);
    renderHud(true);
  }

  function resize() {
    if (!els || !rend) return;
    const r = els.overlay.getBoundingClientRect();
    rend.resize(num(r.width, root.innerWidth || 390), num(r.height, root.innerHeight || 700), root.devicePixelRatio || 1, lockQ ? rend.quality : meter.level);
    if (game) cam = cameraTarget(minerPos().y, rend.layout.viewRows, DD.ROWS);
    draw();
  }

  function draw() {
    if (!rend || !game) return;
    rend.draw({ game, cam, t: clock, particles: particles.list, quality: rend.quality, shakeX: fxs.shakeX, shakeY: fxs.shakeY, flash: fxs.flash, gold: fxs.gold, digShake: fxs.digShake, droneOn });
  }

  function decayFx(dt) {
    if (fxs.shakeAmp > 0 && clock < fxs.shakeUntil) {
      const k = Math.min(1, (fxs.shakeUntil - clock) / 0.3);
      fxs.shakeX = (Math.random() * 2 - 1) * fxs.shakeAmp * k; fxs.shakeY = (Math.random() * 2 - 1) * fxs.shakeAmp * k;
    } else { fxs.shakeX = fxs.shakeY = 0; fxs.shakeAmp = 0; }
    fxs.flash = Math.max(0, fxs.flash - dt * 1.8);
    fxs.gold = Math.max(0, fxs.gold - dt * 1.1);
    fxs.digShake = Math.max(0, fxs.digShake - dt * 9);
  }

  function tick(dt) {
    stats.frames++;
    clock += dt;
    if (!lockQ) {
      const before = meter.level;
      if (meter.sample(dt * 1000) !== before) applyQuality(meter.level);
    }
    if (phase === 'run' && !paused && game) {
      if (clock >= holdUntil) {
        const input = currentDir();
        const beforeTick = game.tick;
        DD.advance(game, dt, input);
        const advanced = game.tick - beforeTick;
        if (deepSession && advanced > 0 && !replayOverflow) {
          for (let i = 0; i < advanced; i++) {
            replayFrames.push({ dx: input.dx, dy: input.dy, ...(i === 0 && pendingAscend ? { ascend: true } : {}) });
            if (replayFrames.length > 108000) { replayOverflow = true; replayFrames.length = 0; break; }
          }
          if (advanced > 0) pendingAscend = false;
        }
        handleEvents(DD.drainEvents(game));
        if (game.status === 'done') finishRun();
      }
    }
    if (game) cam = cameraStep(cam, cameraTarget(minerPos().y, rend.layout.viewRows, DD.ROWS), dt);
    ambientFx(dt);
    particles.step(dt);
    decayFx(dt);
    draw();
    renderHud(false);
  }

  const onFrame = safe((ts) => {
    raf = 0;
    const dt = lastTs ? clamp((ts - lastTs) / 1000, 0, CFG.MAX_DT) : 0;
    lastTs = ts;
    tick(dt);
    if (phase === 'run' && !paused) wake();
  });
  function wake() {
    if (raf || !root.requestAnimationFrame) return;
    if (phase !== 'run' || paused || frozen) return;
    raf = root.requestAnimationFrame(onFrame);
  }
  function stopLoop() {
    if (raf && root.cancelAnimationFrame) root.cancelAnimationFrame(raf);
    raf = 0; lastTs = 0;
  }

  function activateRun(session) {
    deepSession = session && typeof session.id === 'string' ? session : null;
    if (deepSession) newGame(deepSession.seed, deepSession.equipment);
    else if (phase === 'summary') newGame();
    paused = false;
    setPhase('run');
    stats.runs++;
    if (sound) { sound.unlock(); sound.start(-1); }
    renderHud(true);
    if (!rec.hinted) { banner('اسحب العصا نحو الأسفل لتحفر — الحبل يرفعك بكل غنيمتك', 'hint', CFG.HINT_MS); rec.hinted = true; saveRecords(opts.storage, rec); }
    lastTs = 0;
    wake();
    return true;
  }

  function startRun() {
    if (!game || starting || (phase !== 'intro' && phase !== 'summary')) return false;
    if (typeof opts.onStart !== 'function') return activateRun(null);
    starting = true;
    let request;
    try { request = opts.onStart(); }
    catch (error) {
      starting = false;
      banner(error?.message || 'تعذر بدء جولة موثوقة؛ تحقق من الاتصال', 'warning', 4200);
      return false;
    }
    if (!request || typeof request.then !== 'function') {
      starting = false;
      return activateRun(request);
    }
    return Promise.resolve(request).then((session) => activateRun(session)).catch((error) => {
      banner(error?.message || 'تعذر بدء جولة موثوقة؛ تحقق من الاتصال', 'warning', 4200);
      return false;
    }).finally(() => { starting = false; });
  }

  function compactReplay(frames) {
    const out = [];
    for (const frame of frames) {
      const last = out[out.length - 1];
      if (!frame.ascend && last && !last.ascend && last.dx === frame.dx && last.dy === frame.dy) last.ticks++;
      else out.push({ dx: frame.dx, dy: frame.dy, ...(frame.ascend ? { ascend: true } : {}), ticks: 1 });
      if (out.length > 12000) return null;
    }
    return out;
  }

  function finishRun() {
    const res = game.result;
    if (!res || settling) return;
    settling = true;
    const applied = applyResult(rec, res);
    rec = applied.rec;
    saveRecords(opts.storage, rec);
    resetInput();
    if (sound) sound.stop(1.4);
    renderSummary(res, applied);
    setPhase('summary');
    haptic(res.reason === 'faint' ? 'warning' : 'success');
    renderHud(true);
    draw();
    stopLoop();
    if (deepSession && typeof opts.onFinish === 'function') {
      const frames = replayOverflow ? null : compactReplay(replayFrames);
      if (!frames) {
        banner('تعذر إرسال سجل الجولة كاملاً؛ لم تُمنح خامات هذه الجولة', 'warning', 5000);
        deepSession = null; settling = false; return;
      }
      Promise.resolve(opts.onFinish(deepSession, frames)).then((receipt) => {
        if (!receipt || receipt.ok !== true) throw new Error('لم يؤكد الخادم حفظ غنيمة الحفر');
        banner(`تم حفظ خامات الجولة في مخزونك — ${receipt.keptCount || 0} خامة`, 'success', 4200);
        deepSession = null; replayFrames = [];
      }).catch((error) => {
        banner(error?.message || 'تعذر حفظ خامات الجولة؛ لم تُضف إلى المخزون', 'warning', 5000);
      }).finally(() => { settling = false; });
    } else settling = false;
  }

  function ropeNow() {
    if (phase !== 'run' || paused || !game) return false;
    const ok = DD.ascend(game);
    if (ok) { if (deepSession) pendingAscend = true; handleEvents(DD.drainEvents(game)); renderHud(true); wake(); }
    return ok;
  }

  function pause(reason) {
    if (phase !== 'run') return false;
    paused = true;
    resetInput(); stopLoop();
    if (sound) sound.stop(0.3);
    els.pause.dataset.reason = reason || '';
    setPhase('paused');
    renderHud(true);
    try { els.resume.focus({ preventScroll: true }); } catch (e) { /* لا شيء */ }
    return true;
  }
  function resume() {
    if (phase !== 'paused') return false;
    paused = false;
    setPhase('run');
    if (sound && game) sound.start(DD.layerIndex(game.miner.row));
    lastTs = 0;
    wake();
    return true;
  }

  function open() {
    if (!api.active || phase !== 'closed') return false;
    opener = root.document.activeElement || null;
    try { opts.onOpen && opts.onOpen(); } catch (e) { /* لا شيء */ }
    els.overlay.hidden = false;
    root.document.body.classList.add('dd-open');
    if (sound) { sound.unlock(); sound.syncMuted(); }
    syncSoundButton();
    rec = loadRecords(opts.storage);
    setPhase('intro');
    resize();
    newGame();
    renderIntro();
    draw();
    try { els.start.focus({ preventScroll: true }); } catch (e) { /* لا شيء */ }
    return true;
  }

  function close() {
    if (phase === 'closed') return false;
    stopLoop(); resetInput();
    if (sound) sound.stop(0.4);
    els.overlay.hidden = true;
    root.document.body.classList.remove('dd-open');
    paused = false;
    setPhase('closed');
    try { opts.onClose && opts.onClose({ record: rec }); } catch (e) { /* لا شيء */ }
    try { if (opener && opener.focus) opener.focus({ preventScroll: true }); } catch (e) { /* لا شيء */ }
    return true;
  }

  function syncSoundButton() {
    if (!els || !els.sound) return;
    const muted = !!(sound && sound.muted);
    setAttr(els.sound, 'aria-pressed', String(!muted));
    const use = els.sound.querySelector ? els.sound.querySelector('use') : null;
    if (use) use.setAttribute('href', muted ? '#i-muted' : '#i-sound');
  }

  const halt = safe(() => { if (phase === 'run') pause('blur'); else resetInput(); });

  function init(options) {
    if (api.active) return true;
    const doc = root.document;
    if (!doc || !doc.getElementById || !DD || !root.DeepDigRender) return false;
    opts = Object.assign({ getEquipment: () => ({}), haptic() {}, storage: root.localStorage, sound: null, seed: null, rng: Math.random, onOpen() {}, onClose() {}, onMute() {} }, options || {});
    const $ = (id) => doc.getElementById(id);
    els = {
      overlay: $('dd-overlay'), canvas: $('dd-canvas'), close: $('dd-close'), sound: $('dd-sound'), depth: $('dd-depth'), layer: $('dd-layer'), layerBox: $('dd-layerbox'),
      hearts: $('dd-hearts'), bagBox: $('dd-bag'), bagCount: $('dd-bag-count'), bagFill: $('dd-bag-fill'), value: $('dd-value'), chips: $('dd-chips'),
      banner: $('dd-banner'), live: $('dd-live'), pad: $('dd-pad'), stick: $('dd-stick'), rope: $('dd-rope'),
      intro: $('dd-intro'), introBest: $('dd-intro-best'), introGear: $('dd-intro-gear'), introNote: $('dd-intro-note'), start: $('dd-start'), introBack: $('dd-intro-back'),
      pause: $('dd-pause'), resume: $('dd-resume'), quit: $('dd-quit'),
      summary: $('dd-summary'), sumTitle: $('dd-sum-title'), sumSub: $('dd-sum-sub'), sumDepth: $('dd-sum-depth'), sumBest: $('dd-sum-best'), sumLoot: $('dd-sum-loot'),
      sumValue: $('dd-sum-value'), sumNewValue: $('dd-sum-newvalue'), sumLegend: $('dd-sum-legend'), again: $('dd-again'), back: $('dd-back'),
    };
    for (const k of Object.keys(els)) if (!els[k]) { els = null; return false; }
    sound = opts.sound || (root.CaveSound ? root.CaveSound.create({ storage: opts.storage }) : null);
    rend = root.DeepDigRender.create({ canvas: els.canvas, doc, DD, atlasUrl: '/assets/cave/deep/rock-atlas.webp?v=1', heroUrl: '/assets/cave/hero-sheet.webp?v=1' });
    try { const mq = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)'); reduced = !!(mq && mq.matches); if (mq && mq.addEventListener) mq.addEventListener('change', (e) => { reduced = !!e.matches; }); } catch (e) { /* لا شيء */ }
    buildChips();
    els.pad.addEventListener('pointerdown', safe(onPadDown));
    const noMenu = (e) => { if (e && e.preventDefault) e.preventDefault(); };
    els.pad.addEventListener('contextmenu', noMenu); els.rope.addEventListener('contextmenu', noMenu); els.canvas.addEventListener('contextmenu', noMenu);
    els.rope.addEventListener('click', safe(() => ropeNow()));
    els.start.addEventListener('click', safe(() => startRun()));
    els.introBack.addEventListener('click', safe(() => close()));     // على اللمس لا يوجد Escape: للبطاقة الأولى طريق خروج ظاهر
    els.again.addEventListener('click', safe(() => startRun()));
    els.back.addEventListener('click', safe(() => close()));
    els.quit.addEventListener('click', safe(() => close()));
    els.resume.addEventListener('click', safe(() => resume()));
    els.close.addEventListener('click', safe(() => { if (phase === 'run') pause('close'); else close(); }));
    els.sound.addEventListener('click', safe(() => {
      if (!sound) return;
      sound.setMuted(!sound.muted); syncSoundButton();
      if (!sound.muted) { sound.unlock(); sound.sfx('tick'); if (phase === 'run' && game) sound.start(DD.layerIndex(game.miner.row)); }
      try { opts.onMute(sound.muted); } catch (e) { /* لا شيء */ }
    }));
    if (doc.addEventListener) {
      doc.addEventListener('keydown', safe((e) => onKey(e, true)));
      doc.addEventListener('keyup', safe((e) => onKey(e, false)));
      doc.addEventListener('visibilitychange', safe(() => { if (doc.hidden) halt(); }));
    }
    if (root.addEventListener) { root.addEventListener('blur', halt); root.addEventListener('pagehide', halt); root.addEventListener('resize', safe(() => { if (phase !== 'closed') resize(); })); }
    try { if (typeof root.ResizeObserver === 'function') new root.ResizeObserver(safe(() => { if (phase !== 'closed') resize(); })).observe(els.overlay); } catch (e) { /* احتياط: resize */ }
    api.active = true;
    return true;
  }

  function inspect() {
    const s = game ? DD.summary(game) : null;
    return {
      active: api.active, phase, paused, frozen, seed: seedUsed, particleCap: particles.cap, clock: +clock.toFixed(3), cam: +cam.toFixed(3), frames: stats.frames,
      quality: rend ? rend.quality : null, lockedQuality: lockQ, layout: rend ? { ...rend.layout } : null, ready: rend ? rend.ready : null,
      game: s, particles: particles.list.length, worms, record: { ...rec }, sound: sound ? sound.inspect() : null,
      stick: { x: +stick.x.toFixed(3), y: +stick.y.toFixed(3) }, keys: { ...keys }, axis, reduced, shake: +Math.hypot(fxs.shakeX, fxs.shakeY).toFixed(3),
      banner: els && els.banner ? { text: els.banner.textContent, kind: els.banner.dataset.kind || '', on: els.banner.classList.contains('is-on') } : null,
    };
  }

  // خطافات للاختبار: خطوة زمنية حتمية بلا requestAnimationFrame، ومدخلات مباشرة، ووضع المعدّن والبلاطات
  const debug = {
    game: () => game,
    step(dt, n = 1) { for (let i = 0; i < n; i++) tick(clamp(num(dt, 1 / 60), 0, CFG.MAX_DT)); },
    setStick(x, y) { stick = { x: clamp(num(x), -1, 1), y: clamp(num(y), -1, 1), mag: Math.hypot(num(x), num(y)) }; },
    setKey(k, on) { if (k in keys) keys[k] = !!on; },
    reseed(seed, equipment) { if (equipment) { const old = opts.getEquipment; opts.getEquipment = () => equipment; newGame(seed); opts.getEquipment = old; } else newGame(seed); draw(); },
    teleport(c, r) { if (!game) return; game.miner.col = clamp(c | 0, 0, DD.COLS - 1); game.miner.row = clamp(r | 0, 0, DD.ROWS - 1); game.miner.move = null; game.miner.dig = null; game.miner.maxRow = Math.max(game.miner.maxRow, game.miner.row); cam = cameraTarget(minerPos().y, rend.layout.viewRows, DD.ROWS); draw(); renderHud(true); },
    setTile(c, r, kind, ore) { if (!game) return; game.tiles[DD.idx(c, r)] = kind; game.ore[DD.idx(c, r)] = ore || 0; draw(); },
    setQuality(q) { meter.set(q); applyQuality(meter.level); draw(); },           // تغيير الحجم يمسح اللوحة: نعيد الرسم فوراً
    lockQuality(on) { lockQ = !!on; },
    // يوقف حلقة الرسم مع بقاء الجولة نشطة: التقدّم بعدها بـ step فقط (اختبارات حتمية بلا سباقات توقيت)
    freeze(on) { frozen = !!on; if (frozen) stopLoop(); else wake(); },
    setHp(hp) { if (game) { game.miner.hp = clamp(hp | 0, 0, game.stats.maxHp); renderHud(true); } },
    fillBag(id, n) { if (game && DD.ORES[id]) { game.bag[id] = n | 0; game.bagCount = DD.bagTotal(game.bag); renderHud(true); } },
    draw, resize, handleEvents, banner,
    reduced(on) { reduced = !!on; },
  };

  Object.assign(api, {
    VERSION: 1, CFG, DEPTH_MAX_M, stickVector, pickDir, cameraTarget, cameraStep, createParticles, createQuality,
    loadRecords, saveRecords, applyResult, resultCopy, depthText, emptyRecord,
    init: safe(init), open: safe(open), close: safe(close), startRun: safe(startRun), pause: safe(pause), resume: safe(resume), rope: safe(ropeNow),
    // نسبة أفضل عمق من قاع البئر (لحلقة ميدالية الأعماق في شاشة التعدين)
    progress: () => clamp(loadRecords(opts ? opts.storage : root.localStorage).depthM / DEPTH_MAX_M, 0, 1),
    bestDepth: () => loadRecords(opts ? opts.storage : root.localStorage).depthM,
    inspect, debug,
  });
  return api;
});
