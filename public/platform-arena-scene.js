/* حلبة النينجا: خلفية يابانية متعدّدة الطبقات (قمر ضخم، معبد، ساكورا، بوابة، مشاعل، شلال، ضباب)
   ومقاتلان إجرائيان (نينجا الظل) يُرسمان من حالة المحاكاة نفسها — لا صور ثابتة ولا رسوم مزيّفة.
   كل الدوال حتمية من رقم الإطار والكاميرا: نفس اللقطة تعطي نفس البكسل. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformArenaScene = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const ring = (c, x, y, r, color, a = 1) => {
    c.globalAlpha = a; c.fillStyle = color;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.globalAlpha = 1;
  };
  const round = (c, x, y, w, h, r, color) => {
    c.fillStyle = color; c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
    c.fill();
  };

  // ===== أربع ساحات: الأولى مكتملة التفاصيل، والباقي بنفس البنية بألوان وعناصر مختلفة =====
  const ARENAS = [
    {
      id: 'sakura', name: 'معبد الساكورا تحت القمر',
      sky: ['#05070f', '#0b1026', '#171235', '#2b1533', '#3d1c33'],
      moon: '#fff3d0', moonGlow: 'rgba(255,226,170,0.30)', moonR: 50, moonX: 0.66, moonY: 150,
      far: '#161a34', mid: '#101426', near: '#0a0d19',
      temple: '#0d1020', templeLit: '#ffcf7a', accent: '#f472b6', foliage: '#f9a8d4',
      lantern: '#ffb457', petal: '#ffc2dd', snow: false, fireflies: false, waterfall: true,
      fog: 'rgba(180,160,220,0.055)', redLight: 'rgba(244,63,94,0.10)', blueLight: 'rgba(56,189,248,0.10)',
    },
    {
      id: 'bamboo', name: 'غابة البامبو المظلمة',
      sky: ['#04090a', '#07171a', '#0b2426', '#123028', '#1b3a2c'],
      moon: '#d8ffe8', moonGlow: 'rgba(160,255,210,0.24)', moonR: 40, moonX: 0.24, moonY: 140,
      far: '#0d2226', mid: '#0a1a1c', near: '#06100f',
      temple: '#081512', templeLit: '#9affc9', accent: '#34d399', foliage: '#6ee7b7',
      lantern: '#8df0c0', petal: '#a7f3d0', snow: false, fireflies: true, waterfall: false,
      fog: 'rgba(120,220,190,0.06)', redLight: 'rgba(244,63,94,0.08)', blueLight: 'rgba(52,211,153,0.10)',
    },
    {
      id: 'mountain', name: 'دوجو الجبل القديم',
      sky: ['#050a14', '#0a1526', '#122236', '#1c3148', '#2b4257'],
      moon: '#e8f4ff', moonGlow: 'rgba(190,225,255,0.26)', moonR: 46, moonX: 0.78, moonY: 144,
      far: '#132033', mid: '#0e1826', near: '#080e18',
      temple: '#0b1420', templeLit: '#a8d8ff', accent: '#60a5fa', foliage: '#bfdbfe',
      lantern: '#ffd08a', petal: '#ffffff', snow: true, fireflies: false, waterfall: true,
      fog: 'rgba(170,200,230,0.06)', redLight: 'rgba(239,68,68,0.09)', blueLight: 'rgba(96,165,250,0.10)',
    },
    {
      id: 'fortress', name: 'حصن الظلال',
      sky: ['#0a0508', '#150709', '#220a0c', '#33100f', '#451414'],
      moon: '#ffd9b0', moonGlow: 'rgba(255,150,90,0.22)', moonR: 44, moonX: 0.30, moonY: 148,
      far: '#24090c', mid: '#1a070a', near: '#0f0406',
      temple: '#140407', templeLit: '#ff8a4c', accent: '#f97316', foliage: '#fb923c',
      lantern: '#ff7a33', petal: '#ffaa66', snow: false, fireflies: true, waterfall: false,
      fog: 'rgba(255,150,120,0.05)', redLight: 'rgba(239,68,68,0.12)', blueLight: 'rgba(59,130,246,0.08)',
    },
  ];
  const arenaFor = id => {
    const i = Math.max(0, Math.min(ARENAS.length - 1, Number.isInteger(id) ? id : 0));
    return ARENAS[i];
  };

  // ===== القمر: قرص ضخم بهالة وثراء سطحي =====
  function drawMoon(c, th, w, camera, tick, reduced) {
    const x = w * th.moonX - camera * 0.02;
    const y = th.moonY;
    const r = th.moonR;
    const glow = c.createRadialGradient(x, y, r * 0.7, x, y, r * 3.1);
    glow.addColorStop(0, th.moonGlow); glow.addColorStop(0.55, 'rgba(255,220,160,0.06)'); glow.addColorStop(1, 'rgba(255,220,160,0)');
    c.fillStyle = glow; c.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
    const disc = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.2, x, y, r);
    disc.addColorStop(0, '#ffffff'); disc.addColorStop(0.55, th.moon); disc.addColorStop(1, '#e6c9a0');
    c.fillStyle = disc; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    // فوهات خفيفة (حتمية)
    for (let i = 0; i < 7; i++) {
      const a = hash(i, 3) * TAU, d = hash(i, 7) * r * 0.72;
      c.fillStyle = `rgba(214,190,150,${0.12 + hash(i, 5) * 0.12})`;
      c.beginPath(); c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 3 + hash(i, 9) * 7, 0, TAU); c.fill();
    }
    // سحاب رقيق شفّاف يعبر القمر (ثلاث طبقات ناعمة بدل شكل صلب)
    if (!reduced) {
      const drift = (tick * 0.1) % (w + 320) - 160;
      for (let k = 0; k < 3; k++) {
        c.globalAlpha = 0.05 - k * 0.012;
        c.fillStyle = '#cdd8ff';
        c.beginPath(); c.ellipse(drift * 0.6 + w * 0.28 + k * 26, y + r * 0.45 + k * 6, 120 - k * 18, 9 - k * 2, 0, 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  // ===== جبال بعيدة متعدّدة الطبقات =====
  function drawMountains(c, w, camera, th, tick) {
    const layers = [
      { k: 0.04, color: th.far, base: 236, hgt: 96, step: 260, alpha: 1 },
      { k: 0.09, color: th.mid, base: 262, hgt: 74, step: 200, alpha: 1 },
    ];
    for (const L of layers) {
      const shift = camera * L.k;
      c.fillStyle = L.color;
      for (let i = Math.floor(shift / L.step) - 1; i < Math.ceil((shift + w) / L.step) + 1; i++) {
        const x = i * L.step - shift;
        const peak = L.hgt * (0.62 + hash(i, 11) * 0.5);
        c.beginPath();
        c.moveTo(x - L.step * 0.6, L.base);
        c.lineTo(x, L.base - peak);
        c.lineTo(x + L.step * 0.32, L.base - peak * 0.55);
        c.lineTo(x + L.step * 0.62, L.base);
        c.closePath(); c.fill();
        // ثلج على القمة
        c.fillStyle = 'rgba(226,240,255,0.16)';
        c.beginPath();
        c.moveTo(x, L.base - peak);
        c.lineTo(x + L.step * 0.1, L.base - peak * 0.82);
        c.lineTo(x - L.step * 0.09, L.base - peak * 0.78);
        c.closePath(); c.fill();
        c.fillStyle = L.color;
      }
    }
  }

  // ===== معبد/باغودا في العمق بطبقات أسقف ونوافذ مضاءة =====
  function drawTemple(c, x, baseY, s, th, tick, reduced) {
    c.save(); c.translate(x, baseY); c.scale(s, s);
    // القاعدة الحجرية
    round(c, -86, -10, 172, 12, 3, th.temple);
    for (let i = 0; i < 3; i++) {
      const y = -20 - i * 34, wdt = 104 - i * 26;
      // جسم الطابق
      round(c, -wdt / 2, y - 24, wdt, 26, 2, th.temple);
      // نوافذ مضاءة دافئة
      for (let k = -1; k <= 1; k++) {
        const lit = reduced ? 0.75 : 0.55 + Math.sin(tick * 0.03 + i + k * 1.7) * 0.25;
        c.globalAlpha = lit * 0.7; c.fillStyle = th.templeLit;
        c.fillRect(k * (wdt / 3.4) - 3, y - 18, 6, 9);
        c.globalAlpha = 1;
      }
      // سقف منحنٍ بأطراف مرفوعة (ستايل باغودا)
      const ew = wdt / 2 + 20;
      c.fillStyle = th.temple;
      c.beginPath();
      c.moveTo(-ew, y - 22);
      c.quadraticCurveTo(-ew * 0.45, y - 40, 0, y - 42);
      c.quadraticCurveTo(ew * 0.45, y - 40, ew, y - 22);
      c.quadraticCurveTo(ew * 0.6, y - 26, 0, y - 27);
      c.quadraticCurveTo(-ew * 0.6, y - 26, -ew, y - 22);
      c.closePath(); c.fill();
      // طرفا السقف المرفوعان
      c.beginPath(); c.moveTo(-ew, y - 22); c.lineTo(-ew - 9, y - 30); c.lineTo(-ew + 6, y - 26); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(ew, y - 22); c.lineTo(ew + 9, y - 30); c.lineTo(ew - 6, y - 26); c.closePath(); c.fill();
      // لمعة حافة السقف
      c.strokeStyle = 'rgba(255,214,150,0.22)'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(-ew + 4, y - 23); c.quadraticCurveTo(0, y - 39, ew - 4, y - 23); c.stroke();
    }
    // صارية وجرس
    round(c, -1.5, -134, 3, 16, 1, th.temple);
    ring(c, 0, -120, 4.5, th.accent, 0.55);
    c.restore();
  }

  // ===== شجرة ساكورا: جذع وأغصان وتجمعات زهور =====
  function drawSakura(c, x, baseY, s, th, tick, reduced, seed) {
    c.save(); c.translate(x, baseY); c.scale(s, s);
    const trunk = '#160f1c', trunkLight = '#241a2a';
    c.lineCap = 'round';
    c.strokeStyle = trunk; c.lineWidth = 13;
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-9, -50, 10, -92); c.stroke();
    c.strokeStyle = trunkLight; c.lineWidth = 4;
    c.beginPath(); c.moveTo(-3, -6); c.quadraticCurveTo(-10, -50, 9, -90); c.stroke();
    c.strokeStyle = trunk; c.lineWidth = 6;
    for (const [ax, ay, bx, by] of [[6, -58, -40, -92], [8, -72, 46, -104], [9, -86, -22, -124], [9, -92, 34, -132]]) {
      c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo((ax + bx) / 2 - 10, (ay + by) / 2 - 6, bx, by); c.stroke();
    }
    // تجمعات زهور بثلاث درجات
    const sway = reduced ? 0 : Math.sin(tick * 0.02 + seed) * 1.8;
    const tones = [th.foliage, th.accent, '#ffe3f0'];
    for (let cl = 0; cl < 5; cl++) {
      const cxp = [10, -38, 44, -20, 32][cl], cyp = [-96, -94, -106, -126, -134][cl];
      for (let i = 0; i < 9; i++) {
        const a = hash(i, seed + cl) * TAU, d = hash(i, seed + cl + 7) * 17;
        c.globalAlpha = 0.5 + hash(i, seed + cl + 3) * 0.42;
        c.fillStyle = tones[(i + cl) % 3];
        c.beginPath();
        c.arc(cxp + Math.cos(a) * d + sway, cyp + Math.sin(a) * d * 0.7, 3 + hash(i, seed + cl + 9) * 3.6, 0, TAU);
        c.fill();
      }
    }
    c.globalAlpha = 1;
    c.restore();
  }

  // ===== بوابة توري =====
  function drawTorii(c, x, baseY, s, th) {
    c.save(); c.translate(x, baseY); c.scale(s, s);
    const wood = '#7c1d22', dark = '#4a0f14';
    round(c, -34, -70, 7, 70, 1, dark);
    round(c, 27, -70, 7, 70, 1, dark);
    round(c, -44, -76, 88, 8, 2, wood);
    round(c, -40, -58, 80, 5, 2, wood);
    round(c, -52, -88, 104, 7, 3, dark);
    round(c, -46, -84, 92, 4, 2, wood);
    c.restore();
  }

  // ===== فانوس حجري/ورقي متوهّج =====
  function drawLantern(c, x, y, s, th, tick, reduced) {
    c.save(); c.translate(x, y); c.scale(s, s);
    const fl = reduced ? 1 : 0.84 + Math.sin(tick * 0.09 + x * 0.05) * 0.16;
    const glow = c.createRadialGradient(0, 0, 2, 0, 0, 42 * fl);
    glow.addColorStop(0, 'rgba(255,196,120,0.30)'); glow.addColorStop(1, 'rgba(255,150,80,0)');
    c.fillStyle = glow; c.fillRect(-44, -44, 88, 88);
    round(c, -1.5, -26, 3, 26, 1, '#241826');
    round(c, -7, -14, 14, 14, 3, th.lantern);
    round(c, -9, -16, 18, 4, 2, '#2b1c14');
    c.fillStyle = 'rgba(255,244,205,0.85)';
    c.beginPath(); c.arc(0, -7, 4.4 * fl, 0, TAU); c.fill();
    c.restore();
  }

  // ===== شلال في العمق =====
  function drawWaterfall(c, x, top, h, wid, th, tick, reduced) {
    // ماء متدرّج أعرض عند القاعدة
    const grad = c.createLinearGradient(0, top, 0, top + h);
    grad.addColorStop(0, 'rgba(200,230,255,0.22)');
    grad.addColorStop(0.5, 'rgba(150,205,245,0.15)');
    grad.addColorStop(1, 'rgba(120,190,230,0.06)');
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(x + wid * 0.18, top); c.lineTo(x + wid * 0.82, top);
    c.lineTo(x + wid, top + h); c.lineTo(x, top + h);
    c.closePath(); c.fill();
    // صخور محيطة
    c.fillStyle = 'rgba(20,26,40,0.85)';
    c.beginPath(); c.moveTo(x - 6, top + h); c.lineTo(x + 4, top + 12); c.lineTo(x + 2, top + h); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(x + wid + 6, top + h); c.lineTo(x + wid - 4, top + 8); c.lineTo(x + wid - 2, top + h); c.closePath(); c.fill();
    if (reduced) return;
    c.strokeStyle = 'rgba(235,248,255,0.26)'; c.lineWidth = 1.6;
    for (let i = 0; i < 7; i++) {
      const f = i / 6, sx = x + wid * (0.22 + f * 0.56);
      const off = (tick * (1.7 + i * 0.3)) % 70;
      c.globalAlpha = 0.5 + (i % 3) * 0.16;
      c.beginPath(); c.moveTo(sx, top + 8 + off); c.lineTo(sx, top + 8 + off + 30); c.stroke();
    }
    c.globalAlpha = 1;
    // رذاذ القاعدة
    const mist = c.createRadialGradient(x + wid / 2, top + h - 6, 4, x + wid / 2, top + h - 6, wid * 1.4);
    mist.addColorStop(0, 'rgba(220,240,255,0.16)'); mist.addColorStop(1, 'rgba(220,240,255,0)');
    c.fillStyle = mist; c.fillRect(x - wid, top + h - 40, wid * 3, 60);
  }

  // ===== أسراب ضباب أفقية =====
  function drawFog(c, w, camera, th, tick, reduced, y, h, k, speed) {
    const shift = (camera * k + (reduced ? 0 : tick * speed)) % (w + 320) - 160;
    const grad = c.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, th.fog);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grad;
    for (let i = -1; i < 3; i++) c.fillRect(shift + i * (w + 120) - 200, y, w + 240, h);
  }

  // ===== بتلات/ثلج/يراعات متطايرة (حتمية من الإطار) =====
  function drawPetals(c, w, tick, th, reduced) {
    if (reduced) return;
    const count = th.snow ? 34 : 30;
    for (let i = 0; i < count; i++) {
      const seed = i * 37.7;
      const speed = 0.35 + hash(i, 1) * 0.5;
      const y = ((tick * speed + hash(i, 2) * 420) % 340);
      const sway = Math.sin(tick * 0.02 + i) * (12 + hash(i, 3) * 18);
      const x = (hash(i, 4) * (w + 120) + sway + tick*(th.snow?0.12:0.25)) % (w + 120) - 60;
      const size = 1.6 + hash(i, 5) * 2.2;
      c.save(); c.translate(x, y); c.rotate(tick * 0.02 * (1 + hash(i, 6)) + i);
      c.globalAlpha = 0.35 + hash(i, 7) * 0.5;
      c.fillStyle = th.petal;
      if (th.snow) { c.beginPath(); c.arc(0, 0, size * 0.8, 0, TAU); c.fill(); }
      else { c.beginPath(); c.ellipse(0, 0, size * 1.5, size * 0.72, 0, 0, TAU); c.fill(); }
      c.restore();
    }
    c.globalAlpha = 1;
    if (th.fireflies) {
      for (let i = 0; i < 12; i++) {
        const x = (hash(i, 21) * w + Math.sin(tick * 0.03 + i * 2) * 40);
        const y = 150 + hash(i, 22) * 140 + Math.cos(tick * 0.025 + i) * 18;
        const a = 0.25 + Math.abs(Math.sin(tick * 0.04 + i)) * 0.55;
        ring(c, x, y, 1.6, th.accent, a);
      }
      c.globalAlpha = 1;
    }
  }

  // ===== أرضية القتال: منصّة حجرية بحافة مزخرفة وحبال وفوانيس معلّقة =====
  // أرضية القتال بمنظور ثلاثي الأبعاد (عرض بصري فقط — لا يمسّ الفيزياء ولا مواضع المقاتلين):
  // خط الأفق عند top، والبلاط يتباعد ويتّسع كلما اقترب من المشاهد، والخطوط الطولية تتلاقى
  // عند نقطة تلاشٍ أبعد، فيقرأ المشهد كساحة لها عمق لا كشريط مسطّح.
  function drawDais(c, w, camera, th, tick, reduced) {
    const top = 300, bottom = 384;              // نمتد تحت 360 كي لا تظهر حافة عند التكبير
    const depth = bottom - top;
    const VPX = w / 2, K = 0.42;                // تقارب الخطوط الطولية عند الأفق
    const ROWS = 7;

    // قاعدة الأرضية: أفتح عند الأفق (ضوء المشاعل) وأغمق نحو المشاهد
    const g = c.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, '#302642'); g.addColorStop(0.35, '#241c33'); g.addColorStop(1, '#110d1d');
    c.fillStyle = g; c.fillRect(0, top, w, depth + 24);

    // صفوف بلاط بتباعد هندسي: الصفوف القريبة أعلى وأوسع (منظور)
    for (let r = 0; r < ROWS; r++) {
      const t0 = Math.pow(r / ROWS, 2.1), t1 = Math.pow((r + 1) / ROWS, 2.1);
      const y0 = top + depth * t0, y1 = top + depth * t1;
      c.fillStyle = `rgba(150,132,196,${0.05 + 0.09 * (1 - t0)})`;
      c.fillRect(0, y0, w, Math.max(1, y1 - y0 - 1));
      c.fillStyle = 'rgba(0,0,0,0.26)';
      c.fillRect(0, y1 - 1, w, 1);
    }

    // خطوط طولية تتلاقى عند نقطة التلاشي
    const step = 96;
    for (let x = Math.floor(camera / step) * step - step; x < camera + w + step; x += step) {
      const sx = x - camera, farX = VPX + (sx - VPX) * K;
      c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(sx, bottom); c.lineTo(farX, top); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.05)';
      c.beginPath(); c.moveTo(sx + 1.4, bottom); c.lineTo(farX + 1.4, top); c.stroke();
    }

    // حافة مضيئة تُظهر أرض القتال بوضوح (حدّها البعيد حيث يقف المقاتلون)
    c.fillStyle = 'rgba(255,226,180,0.30)'; c.fillRect(0, top, w, 1.5);
    c.fillStyle = 'rgba(255,214,150,0.12)'; c.fillRect(0, top + 1.5, w, 2.5);
    const spill = c.createLinearGradient(0, top, 0, top + 26);
    spill.addColorStop(0, 'rgba(255,200,140,0.09)'); spill.addColorStop(1, 'rgba(255,200,140,0)');
    c.fillStyle = spill; c.fillRect(0, top, w, 26);

    // حبال وفوانيس على الحافة
    for (let x = Math.floor(camera / 160) * 160 - 160; x < camera + w + 160; x += 160) {
      const sx = x - camera;
      c.strokeStyle = 'rgba(120,90,70,0.5)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(sx, top); c.quadraticCurveTo(sx + 24, top + 18, sx + 48, top); c.stroke();
      const fl = reduced ? 1 : 0.8 + Math.sin(tick * 0.1 + x) * 0.2;
      c.fillStyle = th.lantern; c.globalAlpha = 0.85;
      c.beginPath(); c.arc(sx + 24, top + 14, 3.2 * fl, 0, TAU); c.fill();
      c.globalAlpha = 1;
    }
    // برك ضوء الفوانيس على الحجر: أوسع وأقوى في المقدمة وأضيق في العمق (منظور + دفء)
    for (let x = Math.floor(camera / 160) * 160 - 160; x < camera + w + 160; x += 160) {
      const sx = x - camera + 24;
      for (let r = 0; r < 3; r++) {
        const t = (r + 1) / 3;
        const py = top + depth * Math.pow(t, 2.1);
        const rad = 26 + 52 * t;
        const pool = c.createRadialGradient(sx, py, 2, sx, py, rad);
        const a = 0.10 + 0.07 * t;
        pool.addColorStop(0, `rgba(255,196,120,${a})`);
        pool.addColorStop(1, 'rgba(255,196,120,0)');
        c.fillStyle = pool;
        c.fillRect(sx - rad, py - rad * 0.34, rad * 2, rad * 0.68);
      }
    }

    // ظلمة المقدمة: تنعيم الحافة السفلية كما تفعل الكاميرا القريبة
    const fg = c.createLinearGradient(0, bottom - 46, 0, bottom + 20);
    fg.addColorStop(0, 'rgba(6,4,12,0)');
    fg.addColorStop(1, 'rgba(6,4,12,0.55)');
    c.fillStyle = fg; c.fillRect(0, bottom - 46, w, 66);

    // ورود ساقطة على الحجر (تظهر الأبعد أصغر: إحساس بالعمق)
    for (let i = 0; i < 26; i++) {
      const x = (hash(i, 31) * (w + 200) + camera * 0.9) % (w + 40) - 20;
      const t = hash(i, 32);
      const y = top + 6 + Math.pow(t, 1.7) * 62;
      const near = 0.7 + t * 0.75;
      c.fillStyle = th.petal; c.globalAlpha = 0.16 + hash(i, 33) * 0.18;
      c.beginPath(); c.ellipse(x, y, 3.2 * near, 1.6 * near, hash(i, 34) * 3, 0, TAU); c.fill();
      c.globalAlpha = 1;
    }
  }

  // ===== الخلفية الكاملة =====
  function backdrop(c, w, tick, reduced, camera, arenaId, heat = 0) {
    const th = arenaFor(arenaId);
    // V19: الشاشة الطويلة (هاتف عمودي بمسرح مِلء الشاشة) تعرض سماءً فوق y=0، فنملأها بالسماء
    // والنجوم بدل شريط أسود. الإطار يبقى مثبّتاً على الأرض عند y=360.
    const SKY_TOP = -420;
    // سديم مسطّح فوق أعلى نقطة في التدرّج: على شاشة عمودية شديدة الطول قد يُعرض أعلى من -420
    // فلا يظهر شريط أسود ولا حدّ حاد — لون سماء المنطقة العليا نفسه.
    c.fillStyle = th.sky[0];
    c.fillRect(0, -4000, w, 4000 + 360);
    const sky = c.createLinearGradient(0, SKY_TOP, 0, 360);
    sky.addColorStop(0, th.sky[0]); sky.addColorStop(0.14, th.sky[0]); sky.addColorStop(0.32, th.sky[1]);
    sky.addColorStop(0.53, th.sky[2]); sky.addColorStop(0.74, th.sky[3]); sky.addColorStop(1, th.sky[4]);
    c.fillStyle = sky; c.fillRect(0, SKY_TOP, w, 360 - SKY_TOP);

    // نجوم
    for (let i = 0; i < 50; i++) {
      const x = (hash(i, 41) * (w + 200) - camera * 0.01 + w) % (w + 200) - 100;
      const y = 96 + hash(i, 42) * 120;
      const tw = reduced ? 0.6 : 0.35 + Math.abs(Math.sin(tick * 0.03 + i)) * 0.6;
      ring(c, x, y, 0.7 + hash(i, 43) * 0.9, '#ffffff', tw * 0.5);
    }
    // نجوم السماء العالية (تُرى فقط عندما يكون المسرح أطول من 16:9)
    for (let i = 0; i < 42; i++) {
      const x = (hash(i, 71) * (w + 160) - camera * 0.004 + w) % (w + 160) - 80;
      const y = -820 + hash(i, 72) * 900;
      const tw = reduced ? 0.5 : 0.25 + Math.abs(Math.sin(tick * 0.024 + i * 1.7)) * 0.5;
      ring(c, x, y, 0.5 + hash(i, 73) * 0.8, '#ffffff', tw * 0.42);
    }

    drawMoon(c, th, w, camera, tick, reduced);
    drawMountains(c, w, camera, th, tick);

    // شلال بعيد
    if (th.waterfall) drawWaterfall(c, w * 0.3 - camera * 0.06, 128, 168, 34, th, tick, reduced);

    // المعبد في العمق
    drawTemple(c, w * 0.52 - camera * 0.14, 292, 1.12, th, tick, reduced);

    // صف أشجار الساكورا (متوسط)
    for (let i = Math.floor((camera * 0.3) / 300) - 1; i < Math.ceil((camera * 0.3 + w) / 300) + 1; i++) {
      drawSakura(c, i * 300 - camera * 0.3 + 60, 292, 0.95 + hash(i, 51) * 0.25, th, tick, reduced, i * 3.3);
    }

    // ضباب متوسط
    drawFog(c, w, camera, th, tick, reduced, 210, 90, 0.42, 0.06);

    // بوابة توري وفوانيس (قريب)
    for (let i = Math.floor((camera * 0.55) / 420) - 1; i < Math.ceil((camera * 0.55 + w) / 420) + 1; i++) {
      const bx = i * 420 - camera * 0.55 + 150;
      drawTorii(c, bx, 296, 1.05, th);
      drawLantern(c, bx - 96, 264, 1.05, th, tick, reduced);
      drawLantern(c, bx + 96, 264, 1.05, th, tick, reduced);
    }

    // ضباب قريب أمام الأشجار
    drawFog(c, w, camera, th, tick, reduced, 246, 70, 0.75, 0.1);

    // ضباب الأفق: يدفع المعبد والساكورا والتوري إلى الخلف ويجعل حلبة القتال في المقدمة (عمق)
    const haze = c.createLinearGradient(0, 232, 0, 300);
    haze.addColorStop(0, 'rgba(52,40,80,0)');
    haze.addColorStop(0.62, 'rgba(46,34,72,0.18)');
    haze.addColorStop(1, 'rgba(20,14,34,0.46)');
    c.fillStyle = haze; c.fillRect(0, 232, w, 68 + 12);

    drawDais(c, w, camera, th, tick, reduced);
    drawPetals(c, w, tick, th, reduced);

    // إضاءة ملوّنة: زرقاء من جهة البطل وحمراء من جهة الخصم (تُكمل من المشهد)
    // وكلما اقترب الخصم من السقوط (heat) يشتدّ الأحمر ونبض الأطراف — توتر المبارزة
    const t = (reduced ? 0.5 : 0.7) + heat * 0.6;
    if (heat > 0.02) {
      const pulse = reduced ? 0.5 : 0.45 + 0.55 * Math.abs(Math.sin(tick * 0.05));
      const edge = c.createRadialGradient(w / 2, 250, w * 0.2, w / 2, 250, w * 0.8);
      edge.addColorStop(0, 'rgba(0,0,0,0)');
      edge.addColorStop(1, `rgba(190,30,40,${0.28 * heat * pulse})`);
      c.fillStyle = edge; c.fillRect(0, -4000, w, 4360);
    }
    const blue = c.createRadialGradient(w * 0.3, 300, 10, w * 0.3, 300, w * 0.42);
    blue.addColorStop(0, th.blueLight); blue.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = blue; c.fillRect(0, 150, w, 210);
    const red = c.createRadialGradient(w * 0.72, 300, 10, w * 0.72, 300, w * 0.42);
    red.addColorStop(0, th.redLight); red.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = red; c.fillRect(0, 150, w, 210);
    c.globalAlpha = t;

    // تعتيم الأطراف
    const vig = c.createRadialGradient(w / 2, 210, w * 0.34, w / 2, 210, w * 1.0);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = vig; c.fillRect(0, -4000, w, 4360); // V19: يمتد للتعتيم فوق y=0 على الشاشات الطويلة
    c.globalAlpha = 1;
  }

  // ===== مقاتل النينجا (إجرائي بالكامل) =====
  const SKINS = {
    player: {
      robe: '#141c2f', robeLight: '#243350', plate: '#2e4166', mask: '#1b2233',
      trim: '#e11d48', scarf: '#ef2d56', scarf2: '#ff6b8a', eye: '#ff5d73',
      blade: '#e8f6ff', bladeEdge: '#7dd3fc', aura: '#38bdf8', hilt: '#c8a06a', twin: false, horns: false,
    },
    rival: {
      robe: '#1d1229', robeLight: '#33204a', plate: '#432a5e', mask: '#0f0a18',
      trim: '#f59e0b', scarf: '#7c3aed', scarf2: '#a78bfa', eye: '#c084fc',
      blade: '#ffd7ee', bladeEdge: '#f472b6', aura: '#ef4444', hilt: '#8b6b3f', twin: true, horns: true,
    },
  };

  // يقرأ الحالة (لاعب أو مبارز) ويحوّلها إلى وضعية جسم
  function poseOf(ent, isPlayer, tick) {
    const p = {
      crouch: 0, lean: 0, stride: 0, armAngle: -0.35, bladeOut: 0, guard: false,
      glow: 0, dead: false, victory: false, air: false, twist: 0,
    };
    if (isPlayer) {
      const pose = ent.pose || 'idle';
      if (pose === 'run') { p.stride = Math.sin(tick * 0.42); p.lean = 0.1; }
      if (pose === 'jump' || pose === 'fall') { p.air = true; p.crouch = 4; }
      if (pose === 'land') p.crouch = 5;
      if (pose === 'guard') { p.guard = true; p.armAngle = -0.9; p.lean = -0.05; }
      if (pose === 'dodge') { p.lean = 0.4; p.twist = 0.3; }
      if (pose === 'heavy') { p.lean = -0.18; p.armAngle = -1.5; }
      if (pose === 'hurt') p.lean = -0.34;
      if (pose === 'dead') p.dead = true;
      if (pose === 'victory') p.victory = true;
      const sw = ent.swing;
      if (sw) {
        p.glow = sw.hit ? 0.35 : 1;
        p.armAngle = sw.hit ? 0.55 : -1.35;
        p.bladeOut = sw.hit ? 1 : 0.2;
        p.lean = sw.hit ? 0.16 : -0.14;
        if (sw.kind === 'heavy') { p.glow = 1; p.bladeOut = sw.hit ? 1.2 : 0.35; }
      }
      if (ent.guard && ent.guard.active) { p.guard = true; p.armAngle = -1.0; }
    } else {
      const st = ent.state || 'approach';
      const wind = st === 'windup', charging = st === 'charge';
      const t = ent.ai && ent.state === 'windup' ? 1 - ent.timer / Math.max(1, ent.ai.windup) : 0;
      if (st === 'approach' || st === 'walk') p.stride = Math.sin(tick * 0.36);
      if (wind) { p.crouch = 2; p.armAngle = -1.7; p.lean = -0.12; p.glow = 0.5 + t * 0.5; }
      if (charging) { p.lean = 0.42; p.armAngle = 0.7; p.bladeOut = 1; p.glow = 1; }
      if (st === 'recover') { p.lean = 0.16; p.armAngle = 0.2; }
      if (st === 'stagger') { p.lean = -0.4; p.armAngle = 0.9; }
      if (st === 'sleep') { p.armAngle = -0.5; }
      if (ent.dead) p.dead = true;
    }
    return p;
  }

  // ===== وضع النصلة: يتبع الذراع ويتقدّم مع إطارات الضربة المسجّلة في المحاكاة =====
  // المصدر الوحيد: ent.swing (kind, stage, finisher, hit, wind, ticks) أو ent.state للمبارز.
  // لا عدّادات عرض مستقلة، فالحركة تُعاد بنفس الإطارات في كل مرة.
  function bladePose(ent, p, isPlayer) {
    const base = { ang: p.bladeOut > 0.5 ? 0.08 : -1.25, len: 34 + p.bladeOut * 14, glow: 0, trail: 0, heavy: false, finisher: false };
    const sw = isPlayer ? ent.swing : null;
    if (sw) {
      const frames = sw.kind === 'heavy' ? 13 : sw.finisher ? 12 : sw.stage === 2 ? 9 : 8;
      const heavy = sw.kind === 'heavy';
      const finisher = !heavy && Boolean(sw.finisher);
      base.heavy = heavy; base.finisher = finisher;
      base.len = heavy ? 52 : finisher ? 50 : 44;
      if (!sw.hit) {
        // تحضير: النصلة ترتفع وتلمع قليلاً قبل الإصابة
        const rise = 1 - Math.min(1, Math.max(0, sw.wind) / (heavy ? 9 : 4));
        base.ang = -1.5 + rise * 0.22;
        base.glow = 0.35 + rise * 0.4;
      } else {
        // إصابة: قوس واحد سريع من أعلى إلى أسفل (اتساعه وحرارته بحسب نوع الضربة)
        const k = 1 - Math.min(1, Math.max(0, sw.ticks) / Math.max(1, frames));
        base.ang = -1.15 + 2.05 * k;
        base.glow = 1;
        base.trail = Math.max(0, 1 - k) * (heavy ? 0.62 : finisher ? 0.55 : 0.4);
      }
    } else if (!isPlayer && ent.state === 'charge') {
      base.ang = 0.7; base.len = 46; base.glow = 1; base.trail = 0.45;
    }
    return base;
  }

  function drawNinja(c, ent, isPlayer, tick, reduced, arenaId) {
    const skin = isPlayer ? SKINS.player : SKINS.rival;
    const p = poseOf(ent, isPlayer, tick);
    const w = ent.w || 24, h = ent.h || 38;
    const cx = ent.x + w / 2, feet = ent.y + h;
    // ===== ظل الساكورا: صور خلفية بتلات تتبع الاندفاع (من ent.skill الحقيقي) =====
    if (isPlayer && ent.skill) {
      const dir = ent.facing >= 0 ? 1 : -1;
      for (let i = 3; i >= 1; i--) {
        c.save();
        c.translate(cx - dir * i * 10, feet);
        c.globalAlpha = 0.30 - i * 0.07;
        c.fillStyle = i % 2 ? '#ffb3d9' : '#ffd7ee';
        c.beginPath(); c.ellipse(0, -34, 9, 26, 0, 0, TAU); c.fill();
        c.restore();
      }
      c.save();
      c.globalAlpha = 0.35;
      c.strokeStyle = '#ffe9f4'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx - dir * 46, feet - 30); c.lineTo(cx + dir * 14, feet - 52); c.stroke();
      c.restore();
    }
    const facing = ent.facing >= 0 ? 1 : -1;
    // الرسم منمّذ على 92 وحدة ثم يُقاس: البطل أصغر قليلاً من المبارز لكنه مقروء
    const sc = (isPlayer ? 68 : 82) / 92;

    c.save();
    c.translate(cx, feet);
    // ظل أرضي بعمق: هالة بيضاوية ناعمة + نواة داكنة. الظل مسطّح على الأرض (scale رأسية)
    // فيقرأ الجسم كمجسّم واقف على أرضية بمنظور، ولونه ثابت كي يبقى الرسم حتمياً.
    const shR = 27 * (p.air ? 0.7 : 1), shA = p.air ? 0.2 : 0.54;
    const sh = c.createRadialGradient(0, 0, 1, 0, 0, shR);
    sh.addColorStop(0, `rgba(0,0,0,${shA})`);
    sh.addColorStop(0.5, `rgba(0,0,0,${shA * 0.55})`);
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    c.save();
    c.scale(1, 0.28);
    c.fillStyle = sh;
    c.beginPath(); c.arc(0, 0, shR, 0, TAU); c.fill();
    c.restore();
    // ظل مرمي في اتجاه واحد (الضوء من القمر خلفهم) + ظل تلامس ضيّق: يقرأ الحجم والاتجاه
    c.save();
    c.scale(1, 0.24);
    c.fillStyle = 'rgba(0,0,0,0.30)';
    c.beginPath(); c.ellipse(11, 2, shR * 0.78, shR * 0.62, 0, 0, TAU); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.beginPath(); c.ellipse(0, 1, 11, 5, 0, 0, TAU); c.fill();
    c.restore();
    c.scale(facing, 1);
    c.scale(sc, sc);
    if (p.lean) c.rotate(-p.lean * 0.55);
    if (p.twist) c.rotate(p.twist * 0.5);
    if (p.dead) { c.rotate(-1.35); c.translate(-16, -6); }

    const stride = p.stride || 0;
    const hipY = -44 + p.crouch, shoulderY = -72 + p.crouch * 0.7, headY = -84 + p.crouch * 0.85;

    // ===== هالة الطاقة (إنذار/اندفاع/ضربة ثقيلة) =====
    if (p.glow > 0.05 && !reduced) {
      const aura = c.createRadialGradient(0, -46, 6, 0, -46, 54);
      aura.addColorStop(0, isPlayer ? `rgba(56,189,248,${0.20 * p.glow})` : `rgba(244,63,94,${0.22 * p.glow})`);
      aura.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = aura; c.fillRect(-54, -100, 108, 108);
    }

    // ===== الوشاح الطويل خلف الجسم =====
    const flow = reduced ? 0 : Math.sin(tick * 0.13) * 5;
    const scarfTail = 30 + Math.abs(stride) * 6;
    c.strokeStyle = skin.scarf; c.lineCap = 'round';
    c.lineWidth = 7;
    c.beginPath(); c.moveTo(-4, shoulderY + 2);
    c.quadraticCurveTo(-16, shoulderY - 2 + flow, -scarfTail, shoulderY + 12 + flow * 1.6);
    c.stroke();
    c.strokeStyle = skin.scarf2; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-6, shoulderY + 5);
    c.quadraticCurveTo(-20, shoulderY + 8 - flow, -scarfTail - 6, shoulderY + 24 - flow * 1.4);
    c.stroke();

    // ===== الساقان =====
    const kneeSwing = p.air ? 10 : stride * 10;
    c.strokeStyle = skin.robe; c.lineWidth = 9;
    c.beginPath(); c.moveTo(-5, hipY); c.lineTo(-5 + kneeSwing * 0.5, -22); c.lineTo(-5 + kneeSwing, -2); c.stroke();
    c.beginPath(); c.moveTo(5, hipY); c.lineTo(5 - kneeSwing * 0.5, -22); c.lineTo(5 - kneeSwing, -2); c.stroke();
    // خفّان مدبّبان
    c.fillStyle = skin.mask;
    c.beginPath(); c.moveTo(-5 + kneeSwing, -1); c.lineTo(-5 + kneeSwing + 13, 1); c.lineTo(-5 + kneeSwing, 3.5); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(5 - kneeSwing, -1); c.lineTo(5 - kneeSwing + 13, 1); c.lineTo(5 - kneeSwing, 3.5); c.closePath(); c.fill();
    // لفّات الساق
    c.strokeStyle = skin.trim; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-9, -20); c.lineTo(-1, -20); c.moveTo(1, -20); c.lineTo(9, -20); c.stroke();

    // ===== الجذع =====
    c.fillStyle = skin.robe;
    c.beginPath();
    c.moveTo(-12, shoulderY + 3); c.lineTo(13, shoulderY + 3);
    c.lineTo(10, hipY + 6); c.lineTo(-10, hipY + 6); c.closePath(); c.fill();
    // درع الصدر
    c.fillStyle = skin.plate;
    c.beginPath();
    c.moveTo(-9, shoulderY + 7); c.lineTo(11, shoulderY + 7); c.lineTo(8, hipY - 2); c.lineTo(-7, hipY - 2); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.beginPath(); c.moveTo(-8, shoulderY + 9); c.lineTo(2, shoulderY + 9); c.lineTo(0, hipY - 4); c.lineTo(-6, hipY - 4); c.closePath(); c.fill();
    // حزام
    round(c, -11, hipY - 2, 22, 6, 3, skin.trim);
    // ذيل السترة
    c.fillStyle = skin.robe;
    c.beginPath(); c.moveTo(-10, hipY + 4); c.lineTo(2, hipY + 4); c.lineTo(-6, hipY + 20); c.closePath(); c.fill();

    // ===== الكتفان =====
    c.fillStyle = skin.plate;
    c.beginPath(); c.ellipse(-9, shoulderY + 6, 7, 5.4, -0.35, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(10, shoulderY + 6, 7.4, 5.6, 0.35, 0, TAU); c.fill();

    // ===== الرأس =====
    c.fillStyle = skin.mask;
    c.beginPath(); c.ellipse(2, headY, 9.4, 10.4, 0, 0, TAU); c.fill();
    // قناع الفم
    c.fillStyle = skin.robe;
    c.beginPath(); c.ellipse(5, headY + 5, 7.4, 5, 0, 0, TAU); c.fill();
    // عين متوهّجة
    c.fillStyle = skin.eye;
    c.beginPath(); c.ellipse(6.4, headY - 0.5, 3, 1.9, -0.12, 0, TAU); c.fill();
    c.globalAlpha = 0.42;
    c.beginPath(); c.ellipse(6.4, headY - 0.5, 6.2, 4, 0, 0, TAU); c.fill();
    c.globalAlpha = 1;
    if (skin.horns) {
      c.fillStyle = skin.trim;
      c.beginPath(); c.moveTo(-3, headY - 8); c.lineTo(-6, headY - 20); c.lineTo(2, headY - 10); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(8, headY - 8); c.lineTo(11, headY - 19); c.lineTo(4, headY - 10); c.closePath(); c.fill();
    } else {
      // عصابة الرأس وذيلاها
      round(c, -7, headY - 9, 18, 3.6, 2, skin.trim);
      c.strokeStyle = skin.trim; c.lineWidth = 3;
      c.beginPath(); c.moveTo(-6, headY - 7.5); c.quadraticCurveTo(-16, headY - 6 + flow, -24, headY + 4 + flow); c.stroke();
    }

    // ===== الذراعان والسيف =====
    const armAng = p.armAngle;
    const handX = 8 + Math.cos(armAng) * 15, handY = shoulderY + 16 + Math.sin(armAng) * 15;
    // الذراع الخلفية
    c.strokeStyle = skin.robe; c.lineWidth = 6.5;
    c.beginPath(); c.moveTo(-6, shoulderY + 10); c.lineTo(handX - 7, handY + 4); c.stroke();
    // الذراع الأمامية
    c.strokeStyle = skin.robeLight; c.lineWidth = 7;
    c.beginPath(); c.moveTo(6, shoulderY + 10); c.lineTo(handX, handY); c.stroke();
    ring(c, handX, handY, 3, skin.mask, 1);

    const blade = bladePose(ent, p, isPlayer);
    const bladeAng = blade.ang;
    const bladeLen = blade.len;
    const bx = Math.cos(bladeAng) * bladeLen, by = Math.sin(bladeAng) * bladeLen;
    // مقبض
    c.strokeStyle = skin.hilt; c.lineWidth = 4;
    c.beginPath(); c.moveTo(handX - Math.cos(bladeAng) * 7, handY - Math.sin(bladeAng) * 7); c.lineTo(handX, handY); c.stroke();
    // نصلة
    const grad = c.createLinearGradient(handX, handY, handX + bx, handY + by);
    grad.addColorStop(0, skin.blade); grad.addColorStop(1, skin.bladeEdge);
    c.strokeStyle = grad; c.lineWidth = 3.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(handX, handY); c.lineTo(handX + bx, handY + by); c.stroke();
    if (!reduced) {
      c.strokeStyle = blade.heavy ? '#ffe6a8' : blade.finisher ? '#ffc0e8' : skin.bladeEdge;
      c.globalAlpha = 0.35 + blade.glow * 0.3; c.lineWidth = blade.heavy ? 10 : 7.5;
      c.beginPath(); c.moveTo(handX, handY); c.lineTo(handX + bx * 0.8, handY + by * 0.8); c.stroke();
      c.globalAlpha = 1;
    }
    if (skin.twin) {
      c.strokeStyle = skin.blade; c.lineWidth = 2.8;
      c.beginPath(); c.moveTo(-8, hipY - 6); c.lineTo(-20, hipY + 10); c.stroke();
    }

    // ===== أثر القوس: مسار مرئي يتبع طرف النصلة الحقيقي =====
    if (blade.trail > 0.01 && !reduced) {
      const r = bladeLen * 0.92;
      const tipA = bladeAng;
      const span = blade.heavy ? 1.5 : blade.finisher ? 1.35 : 1.05;
      c.save();
      c.translate(handX, handY);
      c.globalCompositeOperation = 'lighter';
      const col = blade.heavy ? '255,224,150' : blade.finisher ? '255,190,235' : '170,230,255';
      for (let i = 0; i < 3; i++) {
        c.globalAlpha = blade.trail * (0.55 - i * 0.15);
        c.strokeStyle = `rgba(${col},1)`;
        c.lineWidth = (blade.heavy ? 9 : 6) - i * 2;
        c.lineCap = 'round';
        c.beginPath(); c.arc(0, 0, r - i * 3, tipA - span, tipA); c.stroke();
      }
      // شفرة لامعة في اللحظة الأولى بعد الإصابة
      c.globalAlpha = blade.glow * (blade.trail + 0.35);
      c.strokeStyle = `rgba(255,255,255,0.85)`;
      c.lineWidth = blade.heavy ? 3.5 : 2.4;
      c.beginPath(); c.arc(0, 0, r, tipA - span * 0.45, tipA); c.stroke();
      c.restore();
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
    }

    // ===== درع الصدّ =====
    if (p.guard) {
      c.strokeStyle = skin.aura; c.globalAlpha = 0.55; c.lineWidth = 3;
      c.beginPath(); c.arc(10, -46, 26, -1.2, 1.2); c.stroke();
      c.globalAlpha = 0.13; c.fillStyle = skin.aura;
      c.beginPath(); c.arc(10, -46, 26, -1.2, 1.2); c.lineTo(10, -46); c.fill();
      c.globalAlpha = 1;
    }

    // ===== وميض الإصابة: يوضّح أن الضربة وقعت فعلًا (من حالة المحاكاة) =====
    const hurtFlash = isPlayer ? (ent.invulnerable > 0 && ent.hearts > 0) : (ent.hurtCooldown > 0);
    if (hurtFlash) {
      // وميض خفيف يتبع الصورة الظلية بدل كتلة لونية: يُقرأ كإصابة لا كفقاعة
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = (reduced ? 0.16 : 0.10 + Math.abs(Math.sin(tick * 0.7)) * 0.14);
      c.fillStyle = isPlayer ? '#ff6b81' : '#ffd08a';
      c.beginPath(); c.ellipse(2, -40, 12, 34, 0, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(6, -78, 9, 10, 0, 0, TAU); c.fill();
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }

    // ===== إضاءة حافة على جهة النظر (تفصل النينجا عن الخلفية) =====
    c.globalAlpha = 0.5;
    c.strokeStyle = isPlayer ? '#9fd8ff' : '#ffc9a8'; c.lineWidth = 1.6;
    c.beginPath(); c.arc(2, headY, 9.4, -1.25, 0.65); c.stroke();
    c.beginPath(); c.moveTo(13, shoulderY + 3); c.lineTo(10, hipY + 6); c.stroke();
    c.globalAlpha = 1;

    c.restore();

    // ===== حلقة الخطر للضربة الواسعة =====
    // نصف القطر الحقيقي من المحرك (ai.slamRadius) وتُملأ مع انقضاء الإنذار: الخطوة الآمنة معروفة.
    if (!isPlayer && ent.state === 'windup' && ent.attack === 'overhead' && !ent.dead) {
      const radius = (ent.ai && ent.ai.slamRadius) || 74;
      const t = 1 - ent.timer / Math.max(1, ent.ai ? ent.ai.windup : 38);
      c.save();
      c.globalAlpha = 0.16 + t * 0.22;
      c.fillStyle = '#ff5d73';
      c.beginPath(); c.ellipse(cx, 300, radius * t, 12 * t + 4, 0, 0, TAU); c.fill();
      c.globalAlpha = 0.5;
      c.strokeStyle = '#ff8f9e'; c.lineWidth = 1.6;
      c.beginPath(); c.ellipse(cx, 300, radius, 13, 0, 0, TAU); c.stroke();
      c.restore();
    }

    // ===== نافذة العقاب على الخصم المدرّع =====
    // المحرك لا يقبل الضرر على المبارز المدرّع إلا في حالة recover (blow() في القواعد)،
    // فالإنذار مربوط بالحالة نفسها ولا يظهر لخصم غير مدرّع حيث الضرر يقع في أي وقت.
    if (!isPlayer && ent.armored !== false && ent.state === 'recover' && !ent.dead) {
      const puls = reduced ? 0.7 : 0.55 + 0.45 * Math.sin(tick * 0.35);
      c.save();
      c.translate(cx, ent.y - 36 - (reduced ? 0 : Math.abs(Math.sin(tick * 0.12)) * 3));
      c.globalCompositeOperation = 'lighter';
      const glow = c.createRadialGradient(0, 6, 2, 0, 6, 28);
      glow.addColorStop(0, `rgba(124,231,255,${0.3 + puls * 0.26})`);
      glow.addColorStop(1, 'rgba(124,231,255,0)');
      c.fillStyle = glow; c.beginPath(); c.arc(0, 6, 28, 0, TAU); c.fill();
      c.globalAlpha = 0.7 + puls * 0.3;
      c.fillStyle = '#9ff0ff';
      c.beginPath(); c.moveTo(-13, 0); c.lineTo(13, 0); c.lineTo(0, 15); c.closePath(); c.fill();
      c.restore();
    }

    // ===== إنذار هجوم الخصم: العدّاد يقفل قبل وصول الضربة =====
    // اللون والمعنى مأخوذان من نفس الحقل الذي يبنيه المحرك (attack === 'overhead' ⇒ كاسرة
    // لا تُصدّ) ونفس المؤقّت (timer / ai.windup) — فلا يخبر الإنذار اللاعب بشيء غير حقيقي.
    if (!isPlayer && ent.state === 'windup' && !ent.dead) {
      const t = 1 - ent.timer / Math.max(1, ent.ai ? ent.ai.windup : 38); // 0 = بداية الإنذار، 1 = لحظة الضربة
      const unblockable = ent.attack === 'overhead';
      const col = unblockable ? '#ff6b6b' : '#7ce7ff';
      const bob = reduced ? 0 : Math.sin(tick * 0.25) * 2;
      c.save();
      c.translate(cx, ent.y - 36 + bob);
      // قرص العدّاد: حلقة تُغلق باتجاه عقارب الساعة مع اقتراب الضربة
      c.globalAlpha = 0.9;
      c.fillStyle = 'rgba(8,10,18,.72)';
      c.beginPath(); c.arc(0, 0, 12, 0, TAU); c.fill();
      c.strokeStyle = col; c.lineWidth = 2.6;
      c.beginPath(); c.arc(0, 0, 12, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, t)); c.stroke();
      if (unblockable) {
        // الكاسرة: مثلث خطر أحمر (لا يعتمد على خطوط النظام)
        c.fillStyle = col;
        c.beginPath(); c.moveTo(0, -7); c.lineTo(7.5, 6); c.lineTo(-7.5, 6); c.closePath(); c.fill();
        c.fillStyle = '#1a0d10';
        c.beginPath(); c.moveTo(0, -3); c.lineTo(2.2, 2.6); c.lineTo(-2.2, 2.6); c.closePath(); c.fill();
      } else {
        c.fillStyle = col; c.font = '900 15px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('!', 0, 0.5);
      }
      c.restore();
    }
  }

  return { ARENAS, arenaFor, backdrop, drawDais, fighter: drawNinja };
});
