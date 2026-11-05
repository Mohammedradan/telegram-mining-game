/* مُرسِم «الحفر العميق» على Canvas 2D: بئر بخامات صخر مرسومة، عتمة وشعلة، عروق تلمع، حمم متوهجة، غاز، صخور سائبة، جسيمات.
   عرض فقط: يقرأ حالة النموذج (deep-dig.js) ولا يغيّرها. إن لم تُحمَّل الصور يستعمل بدائل بسيطة فيبقى اللعب ممكناً.
   جودة 0..2 (يختارها المتحكم تلقائياً من زمن الإطار): أقل جودة = دقة أقل وبلا توهجات إضافية وجسيمات أقل. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.DeepDigRender = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (n, d = 0) => { const v = Number(n); return Number.isFinite(v) ? v : d; };

  const ATLAS_CELL = 384;                              // rock-atlas.webp: 5 خلايا مربعة (حجر، حديد، ذهب، بلّور، حمم)
  const HERO = { cols: 3, cw: 368, ch: 400 };          // hero-sheet.webp 1104×800: idle walk1 walk2 / raise strike cheer
  const CELL = { idle: 0, walk1: 1, walk2: 2, raise: 3, strike: 4, cheer: 5 };
  const LAYER_FALLBACK = ['#6b4a2e', '#4b5360', '#8f6a22', '#2b2a68', '#4a1c14'];

  const ORE_STYLE = {
    copper: { base: '#d98450', light: '#ffc490', dark: '#6e3112', glow: '255,170,90' },
    iron: { base: '#aab6c2', light: '#f2f7fb', dark: '#4c5966', glow: '200,225,255' },
    gold: { base: '#ffc42b', light: '#fff4a8', dark: '#8d5800', glow: '255,215,90' },
    crystal: { base: '#42e4cf', light: '#cbfff7', dark: '#0b6f6c', glow: '90,255,230' },
    lava: { base: '#ff5a1c', light: '#ffd27a', dark: '#7d1700', glow: '255,120,40' },
    relic: { base: '#ffe27a', light: '#ffffff', dark: '#9a6406', glow: '255,235,150' },
  };

  // تجزئة حتمية صغيرة: تنويع شكل كل بلاطة بلا تخزين
  function hash(c, r, k) {
    let h = (Math.imul(c + 11, 374761393) + Math.imul(r + 7, 668265263) + Math.imul((k | 0) + 3, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function create(options) {
    const o = Object.assign({ canvas: null, doc: root.document, DD: root.DeepDig, atlasUrl: '', heroUrl: '' }, options || {});
    const DD = o.DD, doc = o.doc;
    const canvas = o.canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const T_ = DD.TILE;

    let W = 0, H = 0, dpr = 1, quality = 2;
    let L = { tile: 48, ox: 0, viewRows: 12 };
    const img = { atlas: null, hero: null };
    const ready = { atlas: false, hero: false };
    const makeCanvas = (w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
    const sprites = {};                               // ستُبنى عند أول استعمال

    function load(url, key) {
      if (!url || typeof root.Image !== 'function') return;
      const im = new root.Image();
      im.onload = () => { ready[key] = true; };
      im.onerror = () => { ready[key] = false; };
      im.decoding = 'async';
      im.src = url;
      img[key] = im;
    }
    load(o.atlasUrl, 'atlas');
    load(o.heroUrl, 'hero');

    function resize(w, h, ratio, q) {
      W = Math.max(1, Math.floor(w)); H = Math.max(1, Math.floor(h));
      quality = q == null ? quality : q;
      dpr = clamp(num(ratio, 1), 1, [1, 1.5, 2][quality] || 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      const tile = clamp(Math.floor(Math.min(W / DD.COLS, H / 9.5)), 34, 76);
      L = { tile, ox: Math.floor((W - tile * DD.COLS) / 2), viewRows: H / tile };
      return L;
    }
    function setQuality(q) { quality = clamp(q | 0, 0, 2); if (W) resize(W, H, dpr, quality); }

    // ───────────────────────── رسم الأسبرايتات المسبقة ─────────────────────────
    function sprite(key, size, draw) {
      let s = sprites[key];
      if (!s) { s = makeCanvas(size, size); draw(s.getContext('2d'), size); sprites[key] = s; }
      return s;
    }

    function drawOreSprite(c, S, kind, variant) {
      const st = ORE_STYLE[kind];
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (kind === 'relic') {
        c.save(); c.translate(S / 2, S / 2);
        const R = S * 0.34;
        c.beginPath(); c.moveTo(0, -R); c.lineTo(R * 0.8, 0); c.lineTo(0, R); c.lineTo(-R * 0.8, 0); c.closePath();
        let g = c.createLinearGradient(-R, -R, R, R); g.addColorStop(0, st.light); g.addColorStop(0.45, st.base); g.addColorStop(1, st.dark);
        c.fillStyle = g; c.fill(); c.lineWidth = S * 0.035; c.strokeStyle = 'rgba(40,20,0,.9)'; c.stroke();
        c.beginPath(); c.arc(0, 0, R * 0.34, 0, TAU); c.fillStyle = '#7a1d8c'; c.fill(); c.lineWidth = S * 0.025; c.stroke();
        c.beginPath(); c.arc(-R * 0.1, -R * 0.12, R * 0.12, 0, TAU); c.fillStyle = 'rgba(255,255,255,.85)'; c.fill();
        c.restore();
        return;
      }
      let s = 1000 + variant * 77 + kind.length * 31;
      const rn = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      const n = kind === 'crystal' ? 3 : kind === 'iron' ? 4 : 4;
      for (let i = 0; i < n; i++) {
        const x = S * (0.24 + 0.52 * rn()), y = S * (0.26 + 0.5 * rn()), r = S * (0.1 + 0.07 * rn());
        c.save(); c.translate(x, y);
        if (kind === 'crystal') {
          const hgt = r * 2.1, w = r * 1.1;
          c.beginPath(); c.moveTo(0, -hgt); c.lineTo(w, -hgt * 0.2); c.lineTo(w * 0.8, hgt * 0.7); c.lineTo(-w * 0.8, hgt * 0.7); c.lineTo(-w, -hgt * 0.2); c.closePath();
          c.fillStyle = st.base; c.fill(); c.lineWidth = S * 0.025; c.strokeStyle = 'rgba(0,30,40,.9)'; c.stroke();
          c.beginPath(); c.moveTo(0, -hgt); c.lineTo(-w, -hgt * 0.2); c.lineTo(-w * 0.8, hgt * 0.7); c.lineTo(0, hgt * 0.4); c.closePath();
          c.fillStyle = st.light; c.globalAlpha = 0.8; c.fill(); c.globalAlpha = 1;
        } else if (kind === 'iron') {
          c.beginPath();
          for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + rn() * 0.5, rr = r * (0.8 + rn() * 0.45); const px = Math.cos(a) * rr, py = Math.sin(a) * rr; if (k) c.lineTo(px, py); else c.moveTo(px, py); }
          c.closePath();
          const g = c.createLinearGradient(-r, -r, r, r); g.addColorStop(0, st.light); g.addColorStop(0.5, st.base); g.addColorStop(1, st.dark);
          c.fillStyle = g; c.fill(); c.lineWidth = S * 0.028; c.strokeStyle = 'rgba(15,20,28,.9)'; c.stroke();
        } else {
          const g = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.15);
          g.addColorStop(0, st.light); g.addColorStop(0.5, st.base); g.addColorStop(1, st.dark);
          c.beginPath(); c.ellipse(0, 0, r * 1.1, r * 0.9, rn() * 3, 0, TAU);
          c.fillStyle = g; c.fill(); c.lineWidth = S * 0.028; c.strokeStyle = 'rgba(30,12,0,.9)'; c.stroke();
          c.beginPath(); c.arc(-r * 0.35, -r * 0.35, r * 0.2, 0, TAU); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill();
        }
        c.restore();
      }
    }
    const oreSprite = (kind, variant) => sprite(`ore:${kind}:${variant}`, 128, (c, S) => drawOreSprite(c, S, kind, variant));

    const boulderSprite = () => sprite('boulder', 128, (c, S) => {
      c.save(); c.translate(S / 2, S * 0.54);
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(0, S * 0.36, S * 0.34, S * 0.08, 0, 0, TAU); c.fill();
      const R = S * 0.4;
      c.beginPath(); c.moveTo(-R, S * 0.04); c.bezierCurveTo(-R * 1.05, -R * 0.9, -R * 0.2, -R * 1.15, R * 0.4, -R * 0.95);
      c.bezierCurveTo(R * 1.15, -R * 0.7, R * 1.1, R * 0.5, R * 0.5, R * 0.78); c.bezierCurveTo(0, R * 0.95, -R * 0.9, R * 0.8, -R, S * 0.04); c.closePath();
      const g = c.createRadialGradient(-R * 0.3, -R * 0.45, R * 0.1, 0, 0, R * 1.25);
      g.addColorStop(0, '#b7aca0'); g.addColorStop(0.55, '#7c7167'); g.addColorStop(1, '#40382f');
      c.fillStyle = g; c.fill(); c.lineWidth = S * 0.04; c.strokeStyle = 'rgba(18,12,8,.95)'; c.stroke();
      c.lineWidth = S * 0.022; c.strokeStyle = 'rgba(20,14,10,.75)'; c.beginPath();
      c.moveTo(-R * 0.1, -R * 0.8); c.lineTo(R * 0.05, -R * 0.2); c.lineTo(-R * 0.25, R * 0.25); c.moveTo(R * 0.05, -R * 0.2); c.lineTo(R * 0.5, 0); c.stroke();
      c.restore();
    });

    const gasSprite = () => sprite('gas', 128, (c, S) => {
      const bubbles = [[0.32, 0.62, 0.17], [0.58, 0.5, 0.2], [0.44, 0.3, 0.13], [0.72, 0.72, 0.11], [0.26, 0.36, 0.08]];
      for (const [x, y, r] of bubbles) {
        const g = c.createRadialGradient(S * (x - r * 0.3), S * (y - r * 0.35), S * r * 0.1, S * x, S * y, S * r);
        g.addColorStop(0, 'rgba(230,255,200,.95)'); g.addColorStop(0.55, 'rgba(120,230,90,.7)'); g.addColorStop(1, 'rgba(40,120,40,.55)');
        c.beginPath(); c.arc(S * x, S * y, S * r, 0, TAU); c.fillStyle = g; c.fill();
        c.lineWidth = S * 0.02; c.strokeStyle = 'rgba(10,60,10,.8)'; c.stroke();
      }
    });

    const chestSprite = () => sprite('chest', 128, (c, S) => {
      c.save(); c.translate(S / 2, S / 2);
      c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(0, S * 0.33, S * 0.36, S * 0.07, 0, 0, TAU); c.fill();
      const w = S * 0.74, h = S * 0.5;
      roundRect(c, -w / 2, -h * 0.1, w, h * 0.7, S * 0.04);
      let g = c.createLinearGradient(0, -h * 0.1, 0, h * 0.6); g.addColorStop(0, '#9a5a24'); g.addColorStop(1, '#5a3010');
      c.fillStyle = g; c.fill(); c.lineWidth = S * 0.035; c.strokeStyle = '#2a1204'; c.stroke();
      c.beginPath(); c.moveTo(-w / 2, -h * 0.1); c.quadraticCurveTo(-w / 2, -h * 0.62, 0, -h * 0.62); c.quadraticCurveTo(w / 2, -h * 0.62, w / 2, -h * 0.1); c.closePath();
      g = c.createLinearGradient(0, -h * 0.62, 0, -h * 0.1); g.addColorStop(0, '#b8702e'); g.addColorStop(1, '#7a4418');
      c.fillStyle = g; c.fill(); c.stroke();
      c.fillStyle = '#f4c43a'; c.strokeStyle = '#6b4300'; c.lineWidth = S * 0.02;
      for (const x of [-w * 0.3, w * 0.3]) { c.beginPath(); c.rect(x - S * 0.035, -h * 0.58, S * 0.07, h * 1.1); c.fill(); c.stroke(); }
      c.beginPath(); c.arc(0, h * 0.08, S * 0.07, 0, TAU); c.fillStyle = '#ffe38a'; c.fill(); c.stroke();
      c.restore();
    });

    // نسيج حمم متكرر (256×256) نحرّك نافذة مصدره فيبدو المنصهر يجري
    const lavaFlow = () => sprite('lavaflow', 256, (c, S) => {
      const id = c.createImageData(S, S), d = id.data, k = TAU / S;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const v = 0.5 + 0.25 * Math.sin(k * 2 * x + 2.1 * Math.sin(k * 3 * y)) + 0.25 * Math.sin(k * 3 * y + 1.7 * Math.sin(k * 2 * x + 1)) + 0.12 * Math.sin(k * 5 * (x + y));
        const t = clamp((v - 0.45) * 2.4, 0, 1), i = (y * S + x) * 4;
        d[i] = 120 + 135 * t; d[i + 1] = 20 + 150 * t * t; d[i + 2] = 4 + 40 * t * t * t; d[i + 3] = 255;
      }
      c.putImageData(id, 0, 0);
    });

    // ───────────────────────── البلاطات ─────────────────────────
    function rockFace(x, y, T, layer, c, r) {
      if (ready.atlas) {
        const S = 176, off = ATLAS_CELL - S;
        ctx.drawImage(img.atlas, layer * ATLAS_CELL + Math.floor(hash(c, r, 1) * off), Math.floor(hash(c, r, 2) * off), S, S, x, y, T + 1, T + 1);
      } else {
        ctx.fillStyle = LAYER_FALLBACK[layer] || '#555'; ctx.fillRect(x, y, T + 1, T + 1);
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        const k = hash(c, r, 3); ctx.fillRect(x + T * 0.1, y + T * (0.2 + k * 0.5), T * 0.8, T * 0.12);
      }
    }

    // حافة مشطوفة + ظل داخلي على الجهات المطلّة على نفق (يبدو الصخر محفوراً). المستطيلات تُجمَّع في ثلاث دفعات
    // وتُملأ مرة واحدة لكل دفعة بعد رسم البلاطات (لا تتراكب البلاطات فالنتيجة هي نفسها، لكن بدل ~600 أمر رسم نحصل على 3)
    const batch = { hi: [], lo: [], wall: [] };
    function bevel(x, y, T, g, c, r) {
      batch.hi.push(x, y, T, 1, x, y, 1, T);
      batch.lo.push(x, y + T - 1, T, 1, x + T - 1, y, 1, T);
      const t = Math.max(4, T * 0.1), w = batch.wall;
      if (DD.kindAt(g, c, r - 1) === T_.AIR && r - 1 >= 1) w.push(x, y, T, t);
      if (DD.kindAt(g, c, r + 1) === T_.AIR) w.push(x, y + T - t, T, t);
      if (DD.kindAt(g, c - 1, r) === T_.AIR) w.push(x, y, t, T);
      if (DD.kindAt(g, c + 1, r) === T_.AIR) w.push(x + T - t, y, t, T);
    }
    function flushRects(list, color) {
      if (!list.length) return;
      ctx.fillStyle = color; ctx.beginPath();
      for (let i = 0; i < list.length; i += 4) ctx.rect(list[i], list[i + 1], list[i + 2], list[i + 3]);
      ctx.fill(); list.length = 0;
    }

    function tunnel(x, y, T, layer, c, r) {
      ctx.fillStyle = '#140d0b'; ctx.fillRect(x, y, T + 1, T + 1);
      if (ready.atlas) {
        ctx.globalAlpha = 0.2;
        const S = 176, off = ATLAS_CELL - S;
        ctx.drawImage(img.atlas, layer * ATLAS_CELL + Math.floor(hash(c, r, 5) * off), Math.floor(hash(c, r, 6) * off), S, S, x, y, T + 1, T + 1);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x, y, T + 1, Math.max(3, T * 0.12));
    }

    function drawLava(x, y, T, t, c, r) {
      ctx.fillStyle = '#3a0a02'; ctx.fillRect(x, y, T + 1, T + 1);
      const f = lavaFlow(), sx = (t * 22 + hash(c, r, 8) * 120) % 120, sy = (t * 14 + hash(c, r, 9) * 120) % 120;
      ctx.globalAlpha = 0.95; ctx.drawImage(f, sx, sy, 128, 128, x, y, T + 1, T + 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(40,6,0,.28)'; ctx.fillRect(x, y, T + 1, 3);
      ctx.strokeStyle = 'rgba(20,3,0,.8)'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.75, y + 0.75, T - 1.5, T - 1.5);
    }

    function drawBedrock(x, y, T, c, r) {
      ctx.fillStyle = '#1b1a22'; ctx.fillRect(x, y, T + 1, T + 1);
      if (ready.atlas) { ctx.globalAlpha = 0.35; ctx.drawImage(img.atlas, 0, 0, 176, 176, x, y, T + 1, T + 1); ctx.globalAlpha = 1; }
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      ctx.beginPath(); for (let k = -T; k < T * 2; k += T * 0.34) { ctx.moveTo(x + k, y + T); ctx.lineTo(x + k + T, y); } ctx.stroke();
    }

    function drawCracks(x, y, T, progress, c, r) {
      const stage = progress < 0.34 ? 1 : progress < 0.67 ? 2 : 3;
      ctx.fillStyle = `rgba(0,0,0,${(0.14 + 0.2 * progress).toFixed(3)})`; ctx.fillRect(x, y, T, T);
      ctx.strokeStyle = 'rgba(12,6,2,.88)'; ctx.lineWidth = Math.max(1.4, T * 0.04); ctx.lineCap = 'round';
      const cx = x + T * (0.42 + hash(c, r, 11) * 0.16), cy = y + T * (0.42 + hash(c, r, 12) * 0.16);
      ctx.beginPath();
      for (let i = 0; i < 2 + stage * 2; i++) {
        const a = hash(c, r, 20 + i) * TAU, len = T * (0.2 + 0.1 * stage + hash(c, r, 40 + i) * 0.18);
        const mx = cx + Math.cos(a) * len * 0.55 + Math.sin(a) * T * 0.05, my = cy + Math.sin(a) * len * 0.55 - Math.cos(a) * T * 0.05;
        ctx.moveTo(cx, cy); ctx.lineTo(mx, my); ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      }
      ctx.stroke();
    }

    // ───────────────────────── السطح والسماء ─────────────────────────
    function drawSky(f) {
      const T = L.tile, ox = L.ox, surfaceY = (1 - f.cam) * T;      // أعلى صف الصخر الأول
      if (surfaceY <= 0) return;
      const sky = ctx.createLinearGradient(0, 0, 0, surfaceY);
      sky.addColorStop(0, '#0a0f2e'); sky.addColorStop(0.55, '#2b2354'); sky.addColorStop(1, '#c46a38');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, surfaceY);
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (let i = 0; i < 26; i++) {
        const x = hash(i, 1, 50) * W, y = hash(i, 2, 51) * surfaceY * 0.7, tw = 0.5 + 0.5 * Math.sin(f.t * 1.4 + i * 1.7);
        ctx.globalAlpha = 0.25 + 0.5 * tw; ctx.fillRect(x, y, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
      // تلال بعيدة
      ctx.fillStyle = '#1a1230';
      ctx.beginPath(); ctx.moveTo(0, surfaceY);
      for (let x = 0; x <= W; x += 14) ctx.lineTo(x, surfaceY - T * (0.42 + 0.22 * Math.sin(x * 0.011 + 1) + 0.12 * Math.sin(x * 0.031)));
      ctx.lineTo(W, surfaceY); ctx.closePath(); ctx.fill();
      // برج المنجم فوق البئر
      const cx = ox + DD.MID * T + T / 2, base = surfaceY, hgt = T * 2.1, wd = T * 1.5;
      ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = Math.max(3, T * 0.08); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.fillStyle = '#4a2f1a';
      ctx.beginPath(); ctx.moveTo(cx - wd / 2, base); ctx.lineTo(cx - wd * 0.12, base - hgt); ctx.lineTo(cx + wd * 0.12, base - hgt); ctx.lineTo(cx + wd / 2, base); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - wd * 0.36, base - hgt * 0.38); ctx.lineTo(cx + wd * 0.36, base - hgt * 0.38); ctx.moveTo(cx - wd * 0.24, base - hgt * 0.7); ctx.lineTo(cx + wd * 0.24, base - hgt * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, base - hgt - T * 0.1, T * 0.2, 0, TAU); ctx.fillStyle = '#7c5a2a'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, base - hgt - T * 0.1); ctx.lineTo(cx, base - T * 0.4); ctx.lineWidth = 2; ctx.strokeStyle = '#d8c9a0'; ctx.stroke();
      // أرض السطح
      ctx.fillStyle = '#2a1b12'; ctx.fillRect(0, surfaceY - 3, W, 3);
      ctx.fillStyle = '#4a7a30'; ctx.fillRect(0, surfaceY - 4, W, 2);
    }

    // ───────────────────────── المعدّن ─────────────────────────
    function poseOf(g, f) {
      const m = g.miner, t = f.t;
      switch (m.state) {
        case 'move': return Math.floor(t * 9) % 2 ? CELL.walk1 : CELL.walk2;
        case 'dig': { const ph = m.dig ? (m.dig.t % DD.CFG.hitPeriod) / DD.CFG.hitPeriod : 0; return ph < 0.45 ? CELL.raise : CELL.strike; }
        case 'hurt': return CELL.raise;
        case 'rope': case 'win': return CELL.cheer;
        case 'faint': return CELL.strike;
        default: return CELL.idle;
      }
    }

    function drawMiner(g, f, px, py) {
      const m = g.miner, T = L.tile;
      const hgt = T * 1.42, wid = hgt * (HERO.cw / HERO.ch);
      const footY = py + T * 0.5 + T * 0.06;
      const moving = m.state === 'move', bob = moving ? Math.abs(Math.sin(f.t * 15)) * T * 0.045 : Math.sin(f.t * 2.4) * T * 0.012;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(px, footY - T * 0.02, wid * 0.3, T * 0.07, 0, 0, TAU); ctx.fill();
      if (m.inv > 0 && m.state !== 'rope' && Math.floor(f.t * 16) % 2) ctx.globalAlpha = 0.45;
      ctx.translate(px, footY - bob);
      if (m.state === 'faint') { const p = clamp(1 - m.faintT / DD.CFG.faintTime, 0, 1); ctx.rotate(p * 1.35 * (m.face || 1)); ctx.globalAlpha *= 1 - p * 0.35; }
      if (m.state === 'dig' && m.dig) {                     // ينحني نحو اتجاه الحفر
        const dx = m.dig.col - m.col, dy = m.dig.row - m.row;
        ctx.rotate((dy > 0 ? 0.1 : dy < 0 ? -0.1 : 0) * (m.face || 1));
        ctx.translate(dx * T * 0.06, 0);
      }
      ctx.scale(m.face < 0 ? -1 : 1, 1);
      if (ready.hero) {
        const cell = poseOf(g, f), sx = (cell % HERO.cols) * HERO.cw, sy = Math.floor(cell / HERO.cols) * HERO.ch;
        ctx.drawImage(img.hero, sx, sy, HERO.cw, HERO.ch, -wid / 2, -hgt, wid, hgt);
      } else {
        ctx.fillStyle = '#f2a52a'; ctx.fillRect(-T * 0.22, -T * 1.0, T * 0.44, T * 0.7);
        ctx.beginPath(); ctx.arc(0, -T * 1.12, T * 0.24, 0, TAU); ctx.fillStyle = '#ffd25a'; ctx.fill();
        ctx.fillStyle = '#c93a2a'; ctx.fillRect(-T * 0.3, -T * 1.3, T * 0.6, T * 0.14);
      }
      ctx.restore();
    }

    function drawDrone(g, f, px, py) {
      const T = L.tile, face = g.miner.face || 1;
      const x = px - face * T * 0.62, y = py - T * 0.82 + Math.sin(f.t * 3.1) * T * 0.07, s = T * 0.2;
      ctx.save(); ctx.translate(x, y);
      ctx.globalAlpha = 0.55; ctx.fillStyle = '#cfe3f2';
      ctx.beginPath(); ctx.ellipse(0, -s * 1.05, s * 1.5 * (0.7 + 0.3 * Math.abs(Math.sin(f.t * 40))), s * 0.12, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      const gr = ctx.createLinearGradient(0, -s, 0, s); gr.addColorStop(0, '#b9c8d6'); gr.addColorStop(1, '#52667a');
      roundRect(ctx, -s, -s * 0.8, s * 2, s * 1.5, s * 0.5); ctx.fillStyle = gr; ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.16); ctx.strokeStyle = '#1c2630'; ctx.stroke();
      ctx.beginPath(); ctx.arc(face * s * 0.45, -s * 0.05, s * 0.34, 0, TAU); ctx.fillStyle = '#ffe27a'; ctx.fill();
      ctx.restore();
    }

    // ───────────────────────── الجسيمات ─────────────────────────
    function drawParticles(list, T, ox, cam, emissive) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const isEm = p.kind === 'spark' || p.kind === 'glint' || p.kind === 'worm' || p.kind === 'ember' || p.kind === 'label';   // فوق الضباب
        if (isEm !== emissive) continue;
        const a = clamp(p.life / p.max, 0, 1), x = ox + p.x * T, y = (p.y - cam) * T;
        if (y < -40 || y > H + 40) continue;
        switch (p.kind) {
          case 'dust': ctx.globalAlpha = a * 0.55; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, p.size * T * (1.4 - a * 0.5), 0, TAU); ctx.fill(); break;
          case 'chip': ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.globalAlpha = Math.min(1, a * 1.6); ctx.fillStyle = p.color; ctx.fillRect(-p.size * T * 0.5, -p.size * T * 0.5, p.size * T, p.size * T * 0.7); ctx.restore(); break;
          case 'bubble': ctx.globalAlpha = a * 0.6; ctx.strokeStyle = p.color; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, p.size * T, 0, TAU); ctx.stroke(); break;
          case 'spark': case 'ember': ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, p.size * T * (0.5 + a * 0.5), 0, TAU); ctx.fill(); break;
          case 'worm': { const tw = 0.4 + 0.6 * Math.abs(Math.sin(p.rot + p.life * 3)); ctx.globalAlpha = a * tw * 0.9; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, p.size * T, 0, TAU); ctx.fill(); break; }
          case 'glint': star(x, y, p.size * T * (0.6 + 0.4 * a), p.color, a); break;
          case 'label':
            ctx.globalAlpha = Math.min(1, a * 2); ctx.font = `800 ${Math.round(T * 0.26)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.direction = 'rtl';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,6,2,.85)'; ctx.strokeText(p.text, x, y); ctx.fillStyle = p.color; ctx.fillText(p.text, x, y);
            break;
          default: break;
        }
      }
      ctx.globalAlpha = 1;
    }

    function star(x, y, r, color, a) {
      ctx.globalAlpha = a; ctx.fillStyle = color; ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y); ctx.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
      ctx.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y); ctx.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r); ctx.fill();
    }

    // ───────────────────────── الإطار الكامل ─────────────────────────
    function draw(f) {
      const g = f.game;
      if (!g || !W) return;
      const m = g.miner, T = L.tile, ox = L.ox, cam = f.cam, t = f.t;
      const pos = DD.minerPos(g), px = ox + pos.x * T, py = (pos.y - cam) * T;
      const lightR = g.stats.light * T;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#07050d'; ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (f.shakeX || f.shakeY) ctx.translate(f.shakeX, f.shakeY);

      drawSky(f);

      const r0 = Math.max(1, Math.floor(cam)), r1 = Math.min(DD.ROWS - 1, Math.ceil(cam + L.viewRows));
      const near = lightR + T * 1.6;
      batch.hi.length = batch.lo.length = batch.wall.length = 0;
      for (let r = r0; r <= r1; r++) {
        const y = Math.round((r - cam) * T), layer = Math.max(0, DD.layerIndex(r));
        for (let c = 0; c < DD.COLS; c++) {
          const x = ox + c * T, kind = g.tiles[r * DD.COLS + c];
          if (kind === T_.AIR) { tunnel(x, y, T, layer, c, r); continue; }
          if (kind === T_.LAVA) { drawLava(x, y, T, t, c, r); continue; }
          if (kind === T_.BEDROCK) { drawBedrock(x, y, T, c, r); continue; }
          rockFace(x, y, T, layer, c, r);
          const close = Math.hypot(x + T / 2 - px, y + T / 2 - py) < near;
          if (close) {
            if (kind === T_.ORE) ctx.drawImage(oreSprite(DD.ORE_IDS[g.ore[r * DD.COLS + c] - 1] || 'copper', Math.floor(hash(c, r, 7) * 3)), x, y, T, T);
            else if (kind === T_.GAS) { ctx.globalAlpha = 0.9 + 0.1 * Math.sin(t * 3 + c); ctx.drawImage(gasSprite(), x, y + Math.sin(t * 2.2 + r) * T * 0.02, T, T); ctx.globalAlpha = 1; }
            else if (kind === T_.BOULDER) {
              const wob = g.loose.find((b) => !b.fall && b.c === c && b.r === r);
              const sh = wob ? Math.sin(t * 70) * T * 0.035 * (1 + (1 - wob.wobble / DD.CFG.wobble)) : 0;
              ctx.drawImage(boulderSprite(), x + sh, y, T, T);
            } else if (kind === T_.CHEST) ctx.drawImage(chestSprite(), x, y, T, T);
          }
          bevel(x, y, T, g, c, r);
        }
      }
      flushRects(batch.hi, 'rgba(255,255,255,.07)'); flushRects(batch.lo, 'rgba(0,0,0,.32)'); flushRects(batch.wall, 'rgba(0,0,0,.38)');
      // ثقب حفر
      if (m.dig) {
        const d = m.dig, x = ox + d.col * T + (f.digShake ? f.digShake * T * 0.03 : 0), y = Math.round((d.row - cam) * T);
        drawCracks(x, y, T, clamp(d.t / d.need, 0, 1), d.col, d.row);
      }
      // صخور تسقط
      for (const b of g.loose) {
        if (!b.fall) continue;
        ctx.drawImage(boulderSprite(), ox + b.c * T, (b.r + b.fall.step / DD.CFG.fallStep - cam) * T, T, T);
      }
      drawParticles(f.particles, T, ox, cam, false);
      drawMiner(g, f, px, py);
      if (f.droneOn) drawDrone(g, f, px, py);
      if (m.state === 'rope' && m.rope) {
        ctx.strokeStyle = 'rgba(216,196,150,.85)'; ctx.lineWidth = Math.max(2, T * 0.05);
        ctx.beginPath(); ctx.moveTo(px, py - T * 1.3); ctx.lineTo(px, -10); ctx.stroke();
      }
      ctx.restore();

      // ── العتمة والشعلة: تدرّج شعاعي واحد مباشرة على اللوحة (بلا لوحة وسيطة تُدمج بحجم الشاشة: كانت أغلى عملية في الإطار) ──
      const surfaceY = (1 - cam) * T;
      const flick = 1 + 0.025 * Math.sin(t * 9) + 0.015 * Math.sin(t * 23.7);
      const R = lightR * flick, ty = py - T * 0.15, top = Math.max(0, surfaceY);
      if (H - top > 0) {
        const tg = ctx.createRadialGradient(px, ty, R * 0.12, px, ty, R);
        tg.addColorStop(0, 'rgba(3,2,8,0)'); tg.addColorStop(0.6, 'rgba(3,2,8,.066)'); tg.addColorStop(0.86, 'rgba(3,2,8,.47)'); tg.addColorStop(1, 'rgba(3,2,8,.945)');
        ctx.fillStyle = tg; ctx.fillRect(0, top, W, H - top);                  // تحت خط السطح فقط: السماء تبقى مضيئة
      }
      if (quality >= 1) {                                                      // ذاكرة الأنفاق: ما حفرتَه يبقى خافتاً خارج الضوء
        const far = R * 0.95, list = [];
        for (let r = r0; r <= r1; r++) for (let c = 0; c < DD.COLS; c++) {
          if (g.tiles[r * DD.COLS + c] !== T_.AIR) continue;
          const x = ox + c * T, y = (r - cam) * T;
          if (Math.hypot(x + T / 2 - px, y + T / 2 - ty) > far) list.push(x, y, T, T);
        }
        flushRects(list, 'rgba(96,70,58,.36)');
      }

      // ── ما يُرسم فوق الضباب: عروق لامعة، توهج الحمم والصندوق، غاز، وهج الشعلة ──
      ctx.save();
      if (f.shakeX || f.shakeY) ctx.translate(f.shakeX, f.shakeY);
      const scan = g.stats.scan, relicScan = scan + 2.6;
      ctx.globalCompositeOperation = quality >= 1 ? 'lighter' : 'source-over';
      for (let r = r0; r <= r1; r++) {
        for (let c = 0; c < DD.COLS; c++) {
          const kind = g.tiles[r * DD.COLS + c];
          if (kind !== T_.ORE && kind !== T_.LAVA && kind !== T_.CHEST) continue;
          const cx = ox + c * T + T / 2, cy = (r - cam) * T + T / 2;
          if (kind === T_.LAVA) {
            if (quality < 1) continue;
            const rr = T * 1.7, gr = ctx.createRadialGradient(cx, cy, T * 0.2, cx, cy, rr);
            const pulse = 0.28 + 0.07 * Math.sin(t * 2.6 + c * 1.3 + r);
            gr.addColorStop(0, `rgba(255,120,30,${pulse})`); gr.addColorStop(1, 'rgba(255,60,0,0)');
            ctx.fillStyle = gr; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
            continue;
          }
          if (kind === T_.CHEST) {
            if (DD.CHEST_ROW - m.row > 14 || quality < 1) continue;
            const rr = T * 2.4, gr = ctx.createRadialGradient(cx, cy, T * 0.2, cx, cy, rr);
            gr.addColorStop(0, `rgba(255,214,90,${0.35 + 0.1 * Math.sin(t * 3)})`); gr.addColorStop(1, 'rgba(255,190,50,0)');
            ctx.fillStyle = gr; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
            continue;
          }
          const id = DD.ORE_IDS[g.ore[r * DD.COLS + c] - 1], isRelic = id === 'relic';
          const dist = Math.hypot(c + 0.5 - pos.x, r + 0.5 - pos.y);
          if (dist > (isRelic ? relicScan : scan)) continue;
          const st = ORE_STYLE[id] || ORE_STYLE.copper;
          const tw = 0.5 + 0.5 * Math.sin(t * (isRelic ? 4.2 : 3.1) + hash(c, r, 9) * 6.28);
          const fade = clamp(1 - Math.max(0, dist - (isRelic ? relicScan - 1.2 : scan - 1)) / 1.2, 0, 1);
          if (quality >= 1 || tw > 0.6) {
            if (isRelic) {
              const rr = T * 1.5, gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
              gr.addColorStop(0, `rgba(${st.glow},${(0.5 * fade * (0.6 + 0.4 * tw)).toFixed(3)})`); gr.addColorStop(1, `rgba(${st.glow},0)`);
              ctx.fillStyle = gr; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
            }
            star(cx + T * 0.18, cy - T * 0.2, T * (isRelic ? 0.34 : 0.22) * (0.55 + 0.45 * tw), `rgb(${st.glow})`, fade * (0.55 + 0.45 * tw));
            if (isRelic) star(cx - T * 0.2, cy + T * 0.12, T * 0.2 * (1 - 0.4 * tw), '#ffffff', fade * 0.8);
          }
        }
      }
      ctx.globalAlpha = 1;
      // سحب الغاز
      for (const cl of g.clouds) {
        const rad = DD.cloudRadius(cl) * T;
        if (rad < 2) continue;
        const cx = ox + (cl.c + 0.5) * T, cy = (cl.r + 0.5 - cam) * T, gr = ctx.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad);
        gr.addColorStop(0, 'rgba(150,255,120,.42)'); gr.addColorStop(0.65, 'rgba(90,210,80,.22)'); gr.addColorStop(1, 'rgba(60,160,60,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.fill();
      }
      // وهج الشعلة الدافئ
      if (quality >= 1) {
        const gr = ctx.createRadialGradient(px, py - T * 0.2, 0, px, py - T * 0.2, T * 2.1);
        gr.addColorStop(0, 'rgba(255,170,70,.16)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
        ctx.fillStyle = gr; ctx.fillRect(px - T * 2.1, py - T * 2.3, T * 4.2, T * 4.2);
      }
      ctx.globalCompositeOperation = 'source-over';
      drawParticles(f.particles, T, ox, cam, true);
      ctx.restore();

      // ── تنبيهات الحافة: حرارة، غاز، صحة منخفضة، وميض ضرر/ذهب ──
      const heat = clamp(m.heat / (DD.CFG.heatTick * (1 + 0.25 * g.stats.armor)), 0, 1);
      edge(heat > 0.05 ? `rgba(255,110,20,${(0.5 * heat).toFixed(3)})` : '', 0.34);
      if (m.gasT > 0) edge(`rgba(110,230,90,${clamp(0.18 + m.gasT * 0.5, 0, 0.45).toFixed(3)})`, 0.3);
      if (m.hp > 0 && m.hp <= 2 && m.state !== 'rope') edge(`rgba(255,30,30,${(0.22 + 0.16 * Math.sin(t * 5)).toFixed(3)})`, 0.32);
      if (f.flash > 0) { ctx.globalAlpha = clamp(f.flash, 0, 0.55); ctx.fillStyle = '#ff2a1a'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      if (f.gold > 0) { ctx.globalAlpha = clamp(f.gold, 0, 0.4); ctx.fillStyle = '#ffd96a'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    }

    function edge(color, size) {
      if (!color) return;
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.55 - size * 0.4), W / 2, H / 2, Math.max(W, H) * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, color);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }

    return {
      resize, draw, setQuality, hash,
      get layout() { return L; },
      get quality() { return quality; },
      get ready() { return { atlas: ready.atlas, hero: ready.hero }; },
    };
  }

  return { ATLAS_CELL, HERO, CELL, ORE_STYLE, LAYER_FALLBACK, hash, create };
});
