/* مظهر العوالم: جلد الصخر والسائل لكل منجم، ديكورات الأرض، وأنواع الأخطار (مكبس، نافورة حمم، شعلة، بلّور). عرض فقط. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const round = (c, x, y, w, h, r, color) => { c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // مظهر كل عالم. «stone» يطابق حرفياً الألوان القديمة المكتوبة في المُصيِّر (المنجم الأول لا يتغير شكله).
  const LAVA = ['#a33a1e', '#cc472b', '#ea6231', '#ff9d42', '#ffd152'];
  const SKINS = {
    stone: { rock: ['#4c443c', '#5a5048'], top: ['#6b7c3f', '#a58253', '#d8b27c'], moss: '#5a6d35', crack: '#3a342e', hi: '#6b6358', liquid: LAVA, haze: 'rgba(255,100,40,0.04)' },
    iron: { rock: ['#3f4852', '#4f5b68'], top: ['#566673', '#8794a3', '#c4cfdb'], moss: '#4b5a68', crack: '#2b3239', hi: '#7a8794', liquid: LAVA, haze: 'rgba(255,110,50,0.05)' },
    gold: { rock: ['#4f3f27', '#64512f'], top: ['#8a6d1f', '#d4a73a', '#ffe08a'], moss: '#9a8326', crack: '#33270f', hi: '#a78d52', liquid: ['#7a4a0c', '#b57a18', '#e0a82c', '#ffd45a', '#fff0a8'], haze: 'rgba(255,200,80,0.05)' },
    crystal: { rock: ['#363251', '#47416b'], top: ['#4a5c9c', '#7d8bdd', '#c0c8ff'], moss: '#3e4d88', crack: '#221f3d', hi: '#8a86c0', liquid: ['#16335f', '#245c9f', '#3a85d8', '#66c0ff', '#c8f0ff'], haze: 'rgba(100,170,255,0.05)' },
    lava: { rock: ['#372a28', '#493733'], top: ['#7a3a22', '#c2562d', '#ff9a55'], moss: '#8a3a1c', crack: '#1b1110', hi: '#8a6a5e', liquid: ['#7d1608', '#c02e0e', '#ff561b', '#ffa22e', '#ffe272'], haze: 'rgba(255,90,40,0.07)' },
    legend: { rock: ['#2a2237', '#3a2f50'], top: ['#68398a', '#b068d6', '#f0b6ff'], moss: '#552b78', crack: '#150f20', hi: '#8c7ab0', liquid: ['#28094a', '#58188a', '#a02ad8', '#ff58d0', '#ffb0f0'], haze: 'rgba(200,90,255,0.06)' },
  };
  const skinFor = id => SKINS[id] || SKINS.stone;

  // ---- ديكور الأرض -------------------------------------------------------------------------------
  // المنجم الأول: القائمة الأصلية حرفياً. غيره: تُشتق من بيانات المستوى فلا يقع ديكور فوق صخرة أو خطر أو راية أو ساحة الزعيم.
  const STONE_PROPS = [
    { x: 530, type: 'cart' }, { x: 890, type: 'barrel' }, { x: 1260, type: 'cart' },
    { x: 1440, type: 'chest' }, { x: 1760, type: 'barrel' }, { x: 2040, type: 'cart' }, { x: 2320, type: 'chest' },
  ];
  const THEME = {
    iron: ['cart', 'barrel', 'cart', 'barrel', 'chest'], gold: ['chest', 'cart', 'chest', 'barrel'], crystal: ['cluster', 'cluster', 'cart', 'cluster', 'chest'],
    lava: ['barrel', 'skull', 'barrel', 'cart'], legend: ['cluster', 'skull', 'chest', 'cluster'],
  };
  const propCache = new Map();
  function propsFor(level) {
    if (!level || level.id === 'stone') return STONE_PROPS;
    if (propCache.has(level.id)) return propCache.get(level.id);
    const types = THEME[level.id] || THEME.iron, out = [];
    const keepOut = [];
    level.rockSpans.forEach(spans => keepOut.push([Math.min(...spans.map(sp => sp[0])) - 34, Math.max(...spans.map(sp => sp[1])) + 46 + 14]));
    level.hazards.forEach(h => keepOut.push([h.x - 40, h.x + h.w + 40]));
    level.checkpoints.forEach(cp => keepOut.push([cp.at - 36, cp.at + 36]));
    level.signs.forEach(x => keepOut.push([x - 40, x + 30]));
    keepOut.push([level.exit.x - 110, level.exit.x + level.exit.w + 40]);
    const arena = level.boss ? level.enemies.find(e => e.boss).wake - 60 : Infinity;
    let n = 0, last = -1e9;
    for (const g of level.platforms.filter(p => p.y === 300 && p.h === 80)) {
      for (let x = g.x + 44; x < g.x + g.w - 44; x += 20) {
        if (x > arena || x - last < 110 || keepOut.some(([a, b]) => x + 34 > a && x < b)) continue;
        out.push({ x, type: types[n++ % types.length] }); last = x;
      }
    }
    propCache.set(level.id, out);
    return out;
  }
  function drawProp(c, p, tick, reduced) {
    if (p.type === 'cluster') {
      const k = [['#7df2ff', 0.7], ['#b69bff', 0.55], ['#5cf3d2', 0.45]];
      for (const [i, [col, sc]] of k.entries()) {
        const x = p.x + 6 + i * 11, h = 24 * sc * 1.5;
        c.fillStyle = col; if (!reduced) { c.shadowColor = col; c.shadowBlur = 6; }
        c.beginPath(); c.moveTo(x - 5 * sc * 1.4, 300); c.lineTo(x - 2, 300 - h); c.lineTo(x + 3, 300 - h * 0.86); c.lineTo(x + 6 * sc * 1.4, 300); c.closePath(); c.fill();
        c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.moveTo(x - 2, 300 - h); c.lineTo(x, 300 - h * 0.5); c.lineTo(x - 3, 300 - h * 0.5); c.closePath(); c.fill();
      }
    } else if (p.type === 'skull') {
      round(c, p.x, 284, 22, 16, 9, '#cfc6b0'); round(c, p.x + 4, 295, 14, 7, 3, '#b9af98');
      c.fillStyle = '#231a14'; c.beginPath(); c.arc(p.x + 7, 291, 3, 0, TAU); c.arc(p.x + 15, 291, 3, 0, TAU); c.fill();
      c.fillRect(p.x + 10, 295, 2, 4);
    }
  }

  // ---- توقيت الأخطار: كم بقي حتى تنشط؟ (للإنذار البصري فقط؛ الحتمية في المحرك) ----------------------
  function timing(h, tick, soonTicks = 26) {
    const phaseNow = (tick + (h.phase || 0)) % h.period, active = phaseNow < h.active;
    const until = active ? 0 : h.period - phaseNow;
    return { active, until, soon: !active && h.period > 1 && until <= soonTicks, soonT: !active && until <= soonTicks ? 1 - until / soonTicks : 0 };
  }

  // ---- أنواع الأخطار -----------------------------------------------------------------------------
  function crusher(c, h, o) {
    const cx = h.x + h.w / 2, down = o.active;
    const bottom = down ? 300 : 124 + o.soonT * 22;
    const shake = o.reduced ? 0 : down ? Math.sin(o.tick * 2.3) * 0.5 : Math.sin(o.tick * 2.9) * 1.6 * o.soonT;
    // ground marker under the block (always visible so the danger zone can be learned)
    c.fillStyle = '#e8c33a'; for (let i = 0; i < h.w + 8; i += 10) { c.beginPath(); c.moveTo(h.x - 4 + i, 300); c.lineTo(h.x - 4 + i + 5, 300); c.lineTo(h.x - 4 + i + 2, 296); c.lineTo(h.x - 4 + i - 3, 296); c.fill(); }
    // ceiling housing + lamp
    round(c, h.x - 14, 30, h.w + 28, 28, 6, '#363d47'); round(c, h.x - 12, 32, h.w + 24, 8, 4, '#59636f');
    c.fillStyle = '#20262d'; for (const bx of [h.x - 8, h.x + h.w + 4]) { c.beginPath(); c.arc(bx + 2, 50, 2, 0, TAU); c.fill(); }
    const blink = o.soon && Math.floor(o.tick / 5) % 2 === 0;
    const lamp = down ? '#ff3b2f' : o.soon ? (blink ? '#ffb020' : '#5a3a0a') : '#2fe39a';
    c.fillStyle = lamp; if (!o.reduced) { c.shadowColor = lamp; c.shadowBlur = 10; }
    c.beginPath(); c.arc(cx, 44, 5, 0, TAU); c.fill(); c.shadowBlur = 0;
    // rod and head
    round(c, cx - 5 + shake, 58, 10, Math.max(4, bottom - 46 - 58), 3, '#6c7783'); round(c, cx - 2.5 + shake, 58, 3, Math.max(4, bottom - 46 - 58), 1, '#a7b2bd');
    round(c, h.x - 5 + shake, bottom - 46, h.w + 10, 46, 7, '#4a525e'); round(c, h.x - 3 + shake, bottom - 44, h.w + 6, 9, 4, '#6b7684');
    c.save(); c.beginPath(); c.roundRect(h.x - 5 + shake, bottom - 14, h.w + 10, 14, 5); c.clip();
    for (let i = -20; i < h.w + 30; i += 14) { c.fillStyle = '#e8c33a'; c.beginPath(); c.moveTo(h.x + i + shake, bottom); c.lineTo(h.x + i + 7 + shake, bottom); c.lineTo(h.x + i + 14 + shake, bottom - 14); c.lineTo(h.x + i + 7 + shake, bottom - 14); c.fill(); }
    c.restore();
    if (down && !o.reduced) { c.fillStyle = 'rgba(190,180,165,.35)'; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(h.x - 6 + i * 26, 297 - (o.tick % 9), 5 - i, 0, TAU); c.fill(); } }
  }

  function geyser(c, h, o) {
    const cx = h.x + h.w / 2, base = 332, full = base - h.y;
    const rise = o.active ? 1 : o.soon ? 0.16 + 0.5 * o.soonT : 0.1;
    const topY = base - full * rise;
    // rim of the vent (sits just under the gap, visible above the lava)
    round(c, h.x - 9, base - 9, h.w + 18, 14, 6, '#2c1816'); round(c, h.x - 6, base - 7, h.w + 12, 5, 3, o.active || o.soon ? '#ff8a3a' : '#5a2a1a');
    const wob = o.reduced ? 0 : o.tick * 0.45;
    const grad = c.createLinearGradient(0, base, 0, topY);
    grad.addColorStop(0, '#fff2a8'); grad.addColorStop(0.35, '#ffb02e'); grad.addColorStop(0.75, '#ff5a1c'); grad.addColorStop(1, 'rgba(210,50,14,0.55)');
    c.fillStyle = grad; if (!o.reduced && o.active) { c.shadowColor = '#ff6a2a'; c.shadowBlur = 14; }
    c.beginPath(); c.moveTo(h.x + 2, base);
    for (let y = base; y > topY + 6; y -= 8) c.lineTo(h.x + 1 + Math.sin(wob + y * 0.09) * (o.active ? 2.4 : 1.2), y);
    c.quadraticCurveTo(cx, topY - (o.active ? 12 : 4), h.x + h.w - 1, topY + 6);
    for (let y = topY + 6; y < base; y += 8) c.lineTo(h.x + h.w - 1 + Math.sin(wob + y * 0.09 + 2) * (o.active ? 2.4 : 1.2), y);
    c.lineTo(h.x + h.w - 2, base); c.closePath(); c.fill(); c.shadowBlur = 0;
    if (o.active) {
      c.fillStyle = 'rgba(255,250,215,.75)'; c.beginPath(); c.roundRect(cx - 4, topY + 8, 8, base - topY - 14, 4); c.fill();
      if (!o.reduced) for (let i = 0; i < 5; i++) { const a = o.tick * 0.2 + i * 1.3; c.fillStyle = i % 2 ? '#ffd152' : '#ff7a35'; c.beginPath(); c.arc(cx + Math.cos(a) * (h.w * 0.9), topY - 6 + Math.sin(a * 1.4) * 14 + ((o.tick * 2 + i * 9) % 18), 2.4, 0, TAU); c.fill(); }
    } else if (!o.reduced) {
      c.fillStyle = `rgba(255,190,90,${0.35 + 0.3 * o.soonT})`;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(cx + Math.sin(o.tick * 0.2 + i * 2) * 6, base - 6 - ((o.tick * (1 + o.soonT) + i * 7) % 16), 2 + o.soonT, 0, TAU); c.fill(); }
    }
  }

  function flare(c, h, o) {
    round(c, h.x - 4, 292, h.w + 8, 8, 3, '#2a1c18'); round(c, h.x - 2, 293, h.w + 4, 3, 2, o.active ? '#ff7a35' : '#5a3224');
    const n = 3, flick = o.reduced ? 0 : o.tick * 0.5;
    for (let i = 0; i < n; i++) {
      const x = h.x + 7 + i * (h.w - 14) / (n - 1), len = o.active ? 30 + Math.sin(flick + i * 2) * 4 : o.soon ? 6 + 10 * o.soonT : 4;
      const grad = c.createLinearGradient(0, 296, 0, 296 - len); grad.addColorStop(0, '#ffe58a'); grad.addColorStop(0.5, '#ff8a2e'); grad.addColorStop(1, 'rgba(255,60,20,0)');
      c.fillStyle = grad; if (!o.reduced && o.active) { c.shadowColor = '#ff7a35'; c.shadowBlur = 8; }
      c.beginPath(); c.moveTo(x - 6, 296); c.quadraticCurveTo(x - 4, 296 - len * 0.6, x + Math.sin(flick + i) * 2, 296 - len); c.quadraticCurveTo(x + 4, 296 - len * 0.6, x + 6, 296); c.fill(); c.shadowBlur = 0;
    }
  }

  function crystalSpikes(c, h, o) {
    round(c, h.x - 4, 292, h.w + 8, 8, 3, '#241f3c'); round(c, h.x - 2, 293, h.w + 4, 3, 2, '#3b3566');
    const n = 3, len = o.active ? 36 : o.soon ? 8 + 14 * o.soonT : 7;
    const shiver = o.reduced ? 0 : (o.soon ? Math.sin(o.tick * 2.4) * 1.1 : 0);
    for (let i = 0; i < n; i++) {
      const x = h.x + 8 + i * (h.w - 16) / (n - 1) + shiver, l = len * (i === 1 ? 1 : 0.8), col = o.active ? (i % 2 ? '#d9a8ff' : '#8fe8ff') : '#6d6aa8';
      c.fillStyle = col; if (!o.reduced && o.active) { c.shadowColor = col; c.shadowBlur = 10; }
      c.beginPath(); c.moveTo(x - 7, 296); c.lineTo(x - 2, 296 - l); c.lineTo(x + 1, 296 - l - 5); c.lineTo(x + 7, 296); c.closePath(); c.fill(); c.shadowBlur = 0;
      c.fillStyle = 'rgba(255,255,255,.45)'; c.beginPath(); c.moveTo(x - 2, 296 - l); c.lineTo(x, 296 - l * 0.45); c.lineTo(x - 4, 296 - l * 0.45); c.closePath(); c.fill();
    }
  }

  const KINDS = { crusher, geyser, flare, crystal: crystalSpikes };
  // يعيد true إن رسم النوع؛ غير ذلك (vent / pit) يبقى للمُصيِّر القديم حرفياً
  function drawHazard(c, h, tick, reduced) {
    const draw = KINDS[h.kind];
    if (!draw) return false;
    const t = timing(h, tick);
    draw(c, h, { tick, reduced, active: t.active, soon: t.soon, soonT: t.soonT, until: t.until });
    return true;
  }

  // بوابة ساحة الزعيم: لافتتان معلّقتان وخط خطر أحمر على الأرض عند خط الاستيقاظ، فيعرف اللاعب أن ما بعدها معركة
  function drawBossGate(c, level, tick, reduced) {
    const boss = level.boss && level.enemies.find(e => e.boss);
    if (!boss) return;
    const x = boss.wake, sway = reduced ? 0 : Math.sin(tick * 0.045) * 2.2;
    c.fillStyle = 'rgba(255,70,50,.5)';
    for (let i = 0; i < 6; i++) c.fillRect(x - 1, 291 + i * 1.5, 3, 1);
    c.fillRect(x - 1, 290, 3, 10);
    for (const bx of [x - 46, x + 46]) {
      c.fillStyle = '#2b2118'; c.fillRect(bx - 1, 0, 3, 74);
      c.save(); c.translate(bx, 8); c.transform(1, 0, sway / 60, 1, 0, 0);
      c.fillStyle = '#7d1f24'; c.beginPath(); c.moveTo(-15, 0); c.lineTo(15, 0); c.lineTo(15, 78); c.lineTo(0, 66); c.lineTo(-15, 78); c.closePath(); c.fill();
      c.strokeStyle = '#e6b422'; c.lineWidth = 2; c.stroke();
      c.strokeStyle = '#ffd166'; c.lineWidth = 2.4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-9, 22); c.quadraticCurveTo(-11, 12, -4, 10); c.moveTo(9, 22); c.quadraticCurveTo(11, 12, 4, 10); c.stroke();
      c.fillStyle = '#ffd166'; c.beginPath(); c.roundRect(-6, 20, 12, 14, 4); c.fill();
      c.fillStyle = '#7d1f24'; c.fillRect(-3, 25, 2, 3); c.fillRect(1, 25, 2, 3); c.fillRect(-1, 30, 2, 2);
      c.restore();
    }
  }

  root.PlatformScenery = { SKINS, skinFor, propsFor, drawProp, timing, drawHazard, drawBossGate, KINDS: Object.keys(KINDS) };
})(typeof globalThis !== 'undefined' ? globalThis : this);
