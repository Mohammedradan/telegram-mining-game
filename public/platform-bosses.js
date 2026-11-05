/* رسم الزعيمين (عملاق الذهب وحارس القلب) وموجات الصدم وتحذير الهجوم وشريط الصحة. عرض فقط: المحرك V5 يحدد كل شيء. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const R = root.PlatformRules;
  const round = (c, x, y, w, h, r, color) => { c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };
  const ease = t => t * t * (3 - 2 * t);
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // الجسم الفيزيائي أصغر من الرسم عمداً: ما يؤذيك هو مستطيل المحرك، والرسم أكبر منه ليبدو زعيماً (إصابات أكثر عدلاً لا أقل).
  const SCALE = { colossus: 1.55, warden: 1.5, rival: 1.15 }; // خصم المبارزة أصغر من زعيم المنجم وأسرع قراءةً

  // مؤشر الحالة المشترك: ما الذي يفعله الآن وكم بقي (0..1) من حالته؟
  function phase(e) {
    const ai = e.ai || {};
    const total = e.state === 'windup' ? (e.enraged ? ai.enragedWindup : ai.windup)
      : e.state === 'recover' ? ai.recover : e.state === 'walk' ? (e.enraged ? ai.enragedWalk : ai.walk) : e.state === 'charge' ? ai.chargeTicks : 1;
    return clamp01(1 - (e.timer || 0) / Math.max(1, total || 1));
  }

  function star(c, x, y, r, color) {
    c.fillStyle = color; c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    c.closePath(); c.fill();
  }
  function dizzy(c, cx, cy, tick, reduced) {
    for (let i = 0; i < 3; i++) {
      const a = (reduced ? 0 : tick * 0.12) + i * TAU / 3;
      star(c, cx + Math.cos(a) * 17, cy + Math.sin(a) * 5, 4.2, '#ffe28a');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // عملاق الذهب: ذراعان يرفعهما للصدم، نواة في الصدر تتوهج، وعروق ذهب
  // ---------------------------------------------------------------------------------------------
  function colossus(c, e, tick, reduced, dying) {
    const stunned = e.state === 'recover', wind = e.state === 'windup', walking = e.state === 'walk';
    const t = phase(e), stride = walking && !reduced ? Math.sin(tick * 0.16) : 0;
    const breath = reduced ? 0 : Math.sin(tick * 0.05) * 1.2;
    const lift = wind ? ease(t) : 0;                       // arms overhead as the wind-up ends
    const droop = stunned ? 1 : 0;
    const coreCol = stunned ? '#6fa8c9' : wind ? `hsl(${14 - 10 * lift}, 100%, ${52 + 16 * Math.sin(tick * 0.5)}%)` : e.enraged ? '#ff7a45' : '#ffd166';
    c.translate(0, droop * 5 + breath * 0.2 + (wind && !reduced ? Math.sin(tick * 1.1) * lift * 1.3 : 0));
    // legs
    const stone = stunned ? '#5f5446' : '#7a6a52', stoneDark = '#4a3f33', gold = '#e6b422', goldLight = '#ffe08a';
    round(c, -21, -23 + Math.max(0, stride) * 3, 17, 23 - Math.max(0, stride) * 3, 4, stoneDark);
    round(c, 4, -23 + Math.max(0, -stride) * 3, 17, 23 - Math.max(0, -stride) * 3, 4, stoneDark);
    round(c, -22, -6, 19, 7, 3, gold); round(c, 3, -6, 19, 7, 3, gold);
    // belt + torso
    round(c, -25, -33, 50, 12, 4, '#8a6a1f');
    round(c, -27, -64 + breath, 54, 36, 11, stone);
    round(c, -24, -61 + breath, 48, 14, 8, '#9a8870');
    c.strokeStyle = gold; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-18, -57); c.lineTo(-8, -48); c.lineTo(-15, -38); c.moveTo(19, -57); c.lineTo(9, -47); c.lineTo(15, -37); c.stroke();
    // core
    if (!reduced) { const halo = c.createRadialGradient(0, -47, 2, 0, -47, 20); halo.addColorStop(0, coreCol); halo.addColorStop(1, 'rgba(255,200,80,0)'); c.fillStyle = halo; c.globalAlpha = stunned ? 0.35 : 0.85; c.beginPath(); c.arc(0, -47, 20, 0, TAU); c.fill(); c.globalAlpha = 1; }
    c.fillStyle = coreCol; c.beginPath(); c.arc(0, -47, 7.5, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,.65)'; c.beginPath(); c.arc(-2, -49, 2.4, 0, TAU); c.fill();
    // arms hang from the shoulder pivots: rotate(0) = straight down, rotate(-side * a) lifts the arm outward and up (a = π is overhead)
    const raise = wind ? 2.75 * lift : 0;
    for (const side of [-1, 1]) {
      c.save(); c.translate(side * 31, -57 + breath);
      c.rotate(side * (-raise - (stunned ? 0.18 : 0) - (walking ? 0.28 * stride : 0)));
      round(c, -7, -2, 14, 24, 6, stone);
      round(c, -6, 17, 12, 8, 4, gold);
      round(c, -9, 22, 18, 17, 8, stunned ? '#6d6150' : '#857559');
      round(c, -9, 22, 18, 5, 4, goldLight);
      c.restore();
      round(c, side * 31 - 11, -69 + breath, 22, 20, 10, '#8f7e63'); round(c, side * 31 - 11, -69 + breath, 22, 6, 5, goldLight);
    }
    // head
    c.save(); c.translate(0, -72 + breath); c.rotate(stunned ? 0.32 : wind ? -0.12 : 0);
    round(c, -12, -10, 24, 19, 6, '#8d7c62'); round(c, -12, -10, 24, 6, 4, goldLight);
    round(c, -6, -17, 12, 9, 3, gold);
    c.fillStyle = stunned ? '#2c3946' : wind || e.enraged ? '#ff5533' : '#fff3b0';
    if (!reduced && !stunned) { c.shadowColor = c.fillStyle; c.shadowBlur = 8; }
    c.fillRect(-8, -3, 5, 4); c.fillRect(3, -3, 5, 4); c.shadowBlur = 0;
    c.fillStyle = '#2a2118'; c.fillRect(-7, 4, 14, 3);
    c.restore();
    if (stunned) dizzy(c, 0, -94, tick, reduced);
    if (dying) { c.globalAlpha = 1; }
  }

  // ---------------------------------------------------------------------------------------------
  // حارس القلب: كبش مدرّع بقرنين ومعرفة من نار؛ يحفر الأرض قبل الاندفاع ويتهاوى مذهولاً بعده
  // ---------------------------------------------------------------------------------------------
  function warden(c, e, tick, reduced) {
    const stunned = e.state === 'recover', wind = e.state === 'windup', charge = e.state === 'charge', walking = e.state === 'walk';
    const t = phase(e), gait = (walking || charge) && !reduced ? Math.sin(tick * (charge ? 0.55 : 0.2)) : 0;
    const charging = wind && e.attack === 'charge', slamming = wind && e.attack === 'slam';
    const lean = charge ? 0.1 : charging ? 0.07 * ease(t) : slamming ? -0.1 * ease(t) : stunned ? 0.06 : 0;
    const drop = stunned ? 9 : charging ? 3 * ease(t) : 0;
    const iron = stunned ? '#3a3350' : '#4b3f68', ironLight = '#6d5f93', rim = '#9d8cd0';
    const ember = stunned ? '#5b6a86' : wind ? '#ff4d2e' : e.enraged ? '#ff7a45' : '#ffb347';
    c.translate(0, drop); c.rotate(lean);
    // legs: front pair at +, hind pair at -
    const leg = (x, phaseOff, raised) => {
      const sw = gait * 6 * phaseOff, up = raised ? -10 : 0;
      c.fillStyle = '#2f2745'; c.beginPath(); c.roundRect(x - 3.5 + sw * (charge ? 1.4 : 0.5), -17 + up, 8, 17 - up * 0.2, 3); c.fill();
      round(c, x - 5 + sw * (charge ? 1.4 : 0.5), -4 + up * 0.6, 11, 5, 2, '#1d172e');
    };
    leg(-24, 1, false); leg(-13, -1, false);
    leg(14, -1, charging && Math.floor(tick / 6) % 2 === 0); leg(24, 1, false);
    // fire mane
    if (!reduced) for (let i = 0; i < 6; i++) {
      const fx = -22 + i * 9, fl = 8 + Math.sin(tick * 0.3 + i * 1.7) * 3 + (e.enraged ? 4 : 0) + (wind ? 4 * ease(t) : 0);
      c.fillStyle = i % 2 ? '#ff9d42' : '#ff5a36'; c.globalAlpha = stunned ? 0.25 : 0.9;
      c.beginPath(); c.moveTo(fx - 5, -33); c.quadraticCurveTo(fx - 2, -33 - fl, fx + 1, -33 - fl - 4); c.quadraticCurveTo(fx + 3, -33 - fl * 0.5, fx + 5, -33); c.fill();
    }
    c.globalAlpha = 1;
    // body + plates
    round(c, -34, -36, 66, 25, 11, iron);
    round(c, -32, -35, 62, 8, 6, ironLight);
    for (let i = 0; i < 4; i++) { round(c, -28 + i * 15, -37, 14, 17, 5, i % 2 ? '#574a7a' : '#5f5287'); c.strokeStyle = rim; c.lineWidth = 1; c.beginPath(); c.roundRect(-28 + i * 15, -37, 14, 17, 5); c.stroke(); }
    c.strokeStyle = ember; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-22, -24); c.lineTo(-14, -19); c.lineTo(-20, -14); c.moveTo(8, -26); c.lineTo(16, -20); c.lineTo(10, -15); c.stroke();
    // tail
    c.strokeStyle = iron; c.lineWidth = 4; c.beginPath(); c.moveTo(-34, -28); c.quadraticCurveTo(-46, -30 + gait * 3, -45, -38 + gait * 2); c.stroke();
    if (!reduced) { c.fillStyle = ember; c.beginPath(); c.arc(-45, -39 + gait * 2, 3.2, 0, TAU); c.fill(); }
    // head + horns (lowered when charging)
    c.save(); c.translate(32, -28); c.rotate(stunned ? 0.5 : charge || charging ? 0.38 : -0.05 + gait * 0.04);
    c.fillStyle = '#5a4d7f'; c.beginPath(); c.moveTo(-6, -10); c.lineTo(15, -6); c.lineTo(20, 4); c.lineTo(-4, 11); c.closePath(); c.fill();
    c.strokeStyle = rim; c.lineWidth = 1.2; c.stroke();
    c.strokeStyle = '#e8dcc0'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, -9); c.quadraticCurveTo(16, -26, 30, -16); c.stroke();
    c.strokeStyle = '#b9a98a'; c.lineWidth = 2; c.beginPath(); c.moveTo(1, -9); c.quadraticCurveTo(15, -23, 27, -16); c.stroke();
    c.fillStyle = ember; if (!reduced && !stunned) { c.shadowColor = ember; c.shadowBlur = 8; }
    c.beginPath(); c.arc(9, -2, 2.6, 0, TAU); c.fill(); c.shadowBlur = 0;
    if (!reduced && (wind || charge) && !stunned) { c.fillStyle = 'rgba(255,240,220,.5)'; c.beginPath(); c.arc(21 + Math.sin(tick * 0.5) * 2, 4 + (tick % 8), 3, 0, TAU); c.fill(); }
    c.restore();
    c.rotate(-lean);
    if (stunned) dizzy(c, 24, -52, tick, reduced);
  }

  function drawBoss(c, e, s, reduced) {
    const tick = s.tick;
    let alpha = 1, fall = 0;
    if (e.dead) {
      const age = tick - (e.deadTick || tick);
      if (age > 70) return;
      alpha = 1 - clamp01((age - 20) / 50); fall = ease(clamp01(age / 40)) * 10;
    }
    const k = SCALE[e.kind] || 1.5, cx = e.x + e.w / 2;
    c.save();
    c.globalAlpha = alpha;
    c.translate(cx, 300 + fall); c.scale((e.facing || 1) * k, k * (e.dead ? 1 - fall * 0.04 : 1));
    // ground shadow
    c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(0, -1, 36, 5, 0, 0, TAU); c.fill();
    // flashing outline while it can be hurt: a clear "now!" signal
    if (e.state === 'recover' && !reduced) { c.shadowColor = '#ffd166'; c.shadowBlur = 14 + Math.sin(tick * 0.4) * 5; }
    if (e.kind === 'warden') warden(c, e, tick, reduced); else colossus(c, e, tick, reduced, e.dead);
    c.shadowBlur = 0;
    // armour sheen while it is invulnerable
    // اللمعة تعني «مدرَّع الآن»؛ خصم المبارزة غير مدرَّع فلا تُعرض عليه أبدًا (لا إشارة مضلّلة).
    if (!e.dead && e.armored !== false && e.state !== 'recover' && e.state !== 'sleep' && !reduced) {
      c.globalAlpha = 0.14 + 0.1 * Math.max(0, Math.sin(tick * 0.09 + 1));
      c.fillStyle = '#dff6ff'; c.beginPath(); c.roundRect(-26, -62, 20, 6, 3); c.fill();
    }
    c.restore();
  }

  // تحذير الهجوم على الأرض: أين ستصل الموجتان أو الاندفاع، يشتد كلما اقترب التنفيذ
  function drawTelegraph(c, e, s, reduced) {
    if (e.dead || e.state !== 'windup') return;
    const t = ease(phase(e)), pulse = reduced ? 1 : 0.75 + Math.sin(s.tick * 0.5) * 0.25, ai = e.ai;
    c.save();
    if (e.attack === 'slam') {
      const reach = ai.wave.ttl * ai.wave.speed / 60;
      for (const dir of [-1, 1]) {
        const x0 = dir > 0 ? e.x + e.w : e.x - reach, grad = c.createLinearGradient(dir > 0 ? x0 : x0 + reach, 0, dir > 0 ? x0 + reach : x0, 0);
        grad.addColorStop(0, `rgba(255,90,60,${0.55 * t * pulse})`); grad.addColorStop(1, `rgba(255,90,60,${0.12 * t * pulse})`);
        c.fillStyle = grad; c.fillRect(x0, 300 - ai.wave.h, reach, ai.wave.h);
        c.fillStyle = `rgba(255,220,180,${0.7 * t})`;
        for (let i = 0; i < 4; i++) { const px = dir > 0 ? x0 + 14 + i * 34 : x0 + reach - 14 - i * 34; c.beginPath(); c.moveTo(px, 292); c.lineTo(px + dir * 9, 289); c.lineTo(px, 286); c.fill(); }
      }
    } else if (e.attack === 'charge') {
      const len = ai.chargeTicks * (e.chargeSpeed * (e.enraged ? 1.2 : 1)) / 60, dir = e.aim || 1;
      const x0 = dir > 0 ? e.x + e.w : Math.max(0, e.x - len), x1 = dir > 0 ? Math.min(R.levelFor(s.zone).width, e.x + e.w + len) : e.x;
      const grad = c.createLinearGradient(dir > 0 ? x0 : x1, 0, dir > 0 ? x1 : x0, 0);
      grad.addColorStop(0, `rgba(255,110,50,${0.55 * t * pulse})`); grad.addColorStop(1, `rgba(255,110,50,${0.2 * t * pulse})`);
      c.fillStyle = grad; c.fillRect(x0, 300 - e.h, x1 - x0, e.h);
      c.fillStyle = `rgba(255,230,190,${0.8 * t})`;
      for (let i = 0; i < 5; i++) { const px = dir > 0 ? x0 + 20 + i * 44 : x1 - 20 - i * 44; c.beginPath(); c.moveTo(px, 300 - e.h / 2 - 8); c.lineTo(px + dir * 12, 300 - e.h / 2); c.lineTo(px, 300 - e.h / 2 + 8); c.fill(); }
    }
    c.restore();
  }

  function drawWaves(c, waves, tick, reduced) {
    for (const w of waves) {
      const fade = clamp01(w.ttl / 10), dir = Math.sign(w.vx) || 1;
      c.save(); c.globalAlpha = fade;
      const glow = c.createLinearGradient(w.x, 0, w.x + w.w, 0);
      glow.addColorStop(dir > 0 ? 0 : 1, 'rgba(255,120,60,0.35)'); glow.addColorStop(dir > 0 ? 1 : 0, 'rgba(255,230,160,0.95)');
      c.fillStyle = glow; c.beginPath(); c.roundRect(w.x, w.y, w.w, w.h, 8); c.fill();
      c.strokeStyle = '#fff1c9'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(dir > 0 ? w.x + w.w : w.x, w.y + 2); c.lineTo(dir > 0 ? w.x + w.w - 9 : w.x + 9, w.y + w.h / 2); c.lineTo(dir > 0 ? w.x + w.w : w.x, w.y + w.h - 2); c.stroke();
      if (!reduced) { c.fillStyle = 'rgba(180,160,140,.55)'; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(w.x + w.w / 2 - dir * (i * 9 + (tick % 5)), w.y + w.h - 3 - (i % 2) * 5, 3 - i * 0.6, 0, TAU); c.fill(); } }
      c.restore();
    }
  }

  // الزعيم خارج الشاشة (الهواتف الضيقة): سهم عند الحافة يدل على جهته، وكلمة الهجوم إن كان يستعد له
  function edgeMarker(c, b, s, w, reduced, camera) {
    const bc = b.x + b.w / 2, half = (SCALE[b.kind] || 1.5) * b.w / 2;
    const left = bc + half < camera, right = bc - half > camera + w;
    if (!left && !right) return;
    const dir = right ? 1 : -1, x = right ? w - 14 : 14, y = 262, hot = b.state === 'windup' || b.state === 'charge';
    const pulse = reduced || !hot ? 1 : 0.6 + 0.4 * Math.sin(s.tick * 0.5);
    c.save(); c.globalAlpha = pulse;
    c.fillStyle = hot ? '#ff6b4d' : '#8fb0c4';
    c.beginPath(); c.moveTo(x + dir * 7, y); c.lineTo(x - dir * 5, y - 11); c.lineTo(x - dir * 5, y + 11); c.closePath(); c.fill();
    if (hot) {
      c.font = '900 10px system-ui, sans-serif'; c.textAlign = right ? 'right' : 'left'; c.textBaseline = 'middle';
      c.lineWidth = 3; c.strokeStyle = 'rgba(4,12,18,.85)';
      const label = b.attack === 'charge' ? 'اندفاع!' : 'صدمة!', lx = x - dir * 12;
      c.strokeText(label, lx, y); c.fillStyle = '#ffd0a8'; c.fillText(label, lx, y);
    }
    c.restore();
  }

  // شريط الصحة في أعلى الشاشة (فضاء الشاشة لا العالم). اللون يقول الحالة: مدرّع (أزرق رمادي) أو مذهول (ذهبي نابض)
  function drawBossBar(c, s, w, reduced, camera) {
    const b = s.bossId ? s.enemies.find(e => e.id === s.bossId) : null;
    if (!b || b.state === 'sleep' || (b.dead && s.tick - (b.deadTick || 0) > 90)) return;
    if (!b.dead && camera !== undefined) edgeMarker(c, b, s, w, reduced, camera);
    const bw = Math.min(250, w - 40), x = (w - bw) / 2, y = 30, ratio = clamp01(b.hp / b.maxHp), stunned = b.state === 'recover' && !b.dead;
    c.save();
    c.globalAlpha = b.dead ? clamp01(1 - (s.tick - b.deadTick) / 90) : 1;
    round(c, x - 3, y - 15, bw + 6, 28, 9, 'rgba(6,12,18,.78)');
    c.font = '900 10px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = stunned ? '#ffe28a' : '#d6e3ec'; c.fillText(b.name, w / 2, y - 7);
    round(c, x, y, bw, 8, 4, '#1a2833');
    const fill = stunned ? '#ffb347' : b.enraged ? '#ff6b4d' : '#7aa7c4';
    round(c, x, y, Math.max(3, bw * ratio), 8, 4, fill);
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x + 3, y + 1, Math.max(0, bw * ratio - 6), 2);
    c.fillStyle = 'rgba(0,0,0,.45)'; for (let i = 1; i < 8; i++) c.fillRect(x + bw * i / 8 - 0.5, y, 1, 8);
    if (stunned && !reduced) { c.strokeStyle = `rgba(255,214,102,${0.5 + Math.sin(s.tick * 0.35) * 0.4})`; c.lineWidth = 2; c.beginPath(); c.roundRect(x - 3, y - 15, bw + 6, 28, 9); c.stroke(); }
    c.font = '800 8px system-ui, sans-serif'; c.fillStyle = stunned ? '#ffd166' : '#8fb0c4';
    c.fillText(b.dead ? 'سقط!' : stunned ? 'مذهول — اضربه الآن' : 'مدرّع — تفادَ الهجوم', w / 2, y + 20);
    c.restore();
  }

  root.PlatformBosses = { drawBoss, drawTelegraph, drawWaves, drawBossBar, phase, SCALE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
