(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const heroSheet = typeof root.Image === 'function' ? new root.Image() : null;
  if (heroSheet) heroSheet.src = '/assets/cave/hero-sheet.webp?v=1';
  const round = (c, x, y, w, h, r, color) => {
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fill();
  };
  const strokeRound = (c, x, y, w, h, r, color, lineWidth = 2) => {
    c.strokeStyle = color;
    c.lineWidth = lineWidth;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.stroke();
  };

  // ---- Enemies ----
  // دورية المساعد الآلي: يحوم خلف البطل ولا يدخل في أي حساب فيزيائي (رسم فقط)
  function dronePos(p, tick, reduced) {
    const bob = reduced ? 0 : Math.sin(tick * 0.09) * 3;
    return { x: p.x + p.w / 2 - (p.facing || 1) * 24, y: p.y - 8 + bob };
  }
  function drawDrone(c, p, tick, reduced) {
    const d = dronePos(p, tick, reduced);
    c.save(); c.translate(d.x, d.y);
    round(c, -8, -5, 16, 10, 4, '#9fb3b8');
    round(c, -6, -3, 12, 4, 2, '#cfe0e3');
    c.fillStyle = '#56ebd3'; c.beginPath(); c.arc((p.facing || 1) * 3, 1, 2.2, 0, Math.PI * 2); c.fill();
    // rotor
    c.strokeStyle = '#6b7a80'; c.lineWidth = 2; c.lineCap = 'round';
    const spin = reduced ? 0 : Math.sin(tick * 1.4) * 7;
    c.beginPath(); c.moveTo(-spin, -8); c.lineTo(spin, -8); c.stroke();
    c.beginPath(); c.moveTo(0, -8); c.lineTo(0, -5); c.stroke();
    c.restore();
  }

  function drawEnemy(c, enemy, tick, reduced) {
    if (enemy.dead) return;
    c.save();
    c.translate(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2);
    c.scale(enemy.facing, 1);
    if (enemy.hurtCooldown > 0 && Math.floor(tick / 3) % 2 === 0) c.globalAlpha = 0.45;

    if (enemy.type === 'goblin') {
      const walk = !reduced && Math.abs(enemy.vx) > 5 ? Math.sin(tick * 0.32) * 4 : 0;
      const breath = !reduced ? Math.sin(tick * 0.09) * 0.5 : 0;
      c.fillStyle = '#00000044';
      c.beginPath(); c.ellipse(0, 15, 14, 4, 0, 0, Math.PI * 2); c.fill();
      // legs with walk cycle
      round(c, -8, 7 + walk, 6, 9, 2, '#483526');
      round(c, 2, 7 - walk, 6, 9, 2, '#483526');
      // ragged tunic
      round(c, -9, -5 + breath, 18, 14, 4, '#5b7553');
      round(c, -9, -2 + breath, 18, 3, 1, '#4a6644'); // seam
      round(c, -4, 3, 8, 4, 1, '#866442');
      // head
      round(c, -11, -19, 22, 16, 7, '#6f9264');
      c.fillStyle = '#6f9264';
      c.beginPath(); c.moveTo(-11, -13); c.lineTo(-19, -16); c.lineTo(-11, -8); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(11, -13); c.lineTo(19, -16); c.lineTo(11, -8); c.closePath(); c.fill();
      // horned helmet
      round(c, -11, -21, 22, 6, 3, '#74563a');
      c.fillStyle = '#dfcf98';
      c.beginPath(); c.moveTo(-7, -21); c.lineTo(-9, -27); c.lineTo(-3, -21); c.fill();
      c.beginPath(); c.moveTo(7, -21); c.lineTo(9, -27); c.lineTo(3, -21); c.fill();
      // eyes glow when alert
      c.fillStyle = enemy.alert ? '#ff3b30' : '#ffe14a';
      if (!reduced && enemy.alert) { c.shadowColor = '#ff3b30'; c.shadowBlur = 6; }
      c.beginPath(); c.arc(3, -13, 3, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#1e241c';
      c.beginPath(); c.arc(4, -13, 1.2, 0, Math.PI * 2); c.fill();
      // spiked club
      c.save();
      c.translate(8, -1);
      c.rotate(enemy.alert ? -0.55 : 0.28 + walk * 0.06);
      round(c, -2, -14, 5, 20, 2, '#5d4128');
      round(c, -4, -18, 9, 8, 3, '#433120');
      c.fillStyle = '#b6bec2';
      c.beginPath(); c.moveTo(-4, -15); c.lineTo(-8, -15); c.lineTo(-4, -12); c.fill();
      c.beginPath(); c.moveTo(5, -15); c.lineTo(9, -15); c.lineTo(5, -12); c.fill();
      c.restore();
      if (enemy.alert) {
        c.fillStyle = '#ff3b30';
        c.font = 'bold 12px sans-serif'; c.textAlign = 'center';
        c.fillText('!', 0, -27);
      }
    } else if (enemy.type === 'beetle') {
      const scurry = !reduced ? Math.sin(tick * 0.45) * 3 : 0;
      c.fillStyle = '#00000044';
      c.beginPath(); c.ellipse(0, 11, 16, 4, 0, 0, Math.PI * 2); c.fill();
      // legs
      c.strokeStyle = '#2b2118'; c.lineWidth = 2;
      for (const lx of [-9, 0, 9]) {
        c.beginPath(); c.moveTo(lx, 4); c.lineTo(lx - 4, 11 + (lx === 0 ? scurry : -scurry)); c.stroke();
      }
      // iridescent carapace
      round(c, -13, -8, 26, 17, 8, '#3d281e');
      round(c, -12, -7, 24, 15, 7, '#6a4731');
      round(c, -11, -6, 22, 13, 6, '#8e5e3f');
      // highlight stripe
      c.fillStyle = '#c49a6c55';
      c.beginPath(); c.ellipse(0, -2, 9, 3, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#432c1b'; c.beginPath(); c.moveTo(-11, 0); c.lineTo(11, 0); c.stroke();
      c.fillStyle = '#2d1e13';
      c.beginPath(); c.moveTo(-4, -8); c.lineTo(-2, -13); c.lineTo(0, -8); c.fill();
      c.beginPath(); c.moveTo(4, -8); c.lineTo(6, -13); c.lineTo(8, -8); c.fill();
      round(c, 8, -4, 8, 10, 3, '#432c1b');
      c.fillStyle = '#e5ab52';
      c.beginPath(); c.arc(12, -2, 2, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#2d1e13'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(15, -2); c.lineTo(19, -5); c.stroke();
      c.beginPath(); c.moveTo(15, 2); c.lineTo(19, 5); c.stroke();
    } else if (enemy.type === 'bat') {
      const flap = !reduced ? Math.sin(tick * 0.30) : 0;
      const hover = !reduced ? Math.sin(tick * 0.12) * 1.5 : 0;
      c.translate(0, hover);
      round(c, -6, -6, 12, 14, 5, '#3b2f4a');
      // ears
      c.fillStyle = '#544369';
      c.beginPath(); c.moveTo(-5, -6); c.lineTo(-8, -14); c.lineTo(-2, -6); c.fill();
      c.beginPath(); c.moveTo(5, -6); c.lineTo(8, -14); c.lineTo(2, -6); c.fill();
      // inner ear pink
      c.fillStyle = '#7a5a8a';
      c.beginPath(); c.moveTo(-5, -7); c.lineTo(-6, -11); c.lineTo(-3, -7); c.fill();
      c.beginPath(); c.moveTo(5, -7); c.lineTo(6, -11); c.lineTo(3, -7); c.fill();
      c.fillStyle = '#ff3344';
      if (!reduced) { c.shadowColor = '#ff3344'; c.shadowBlur = 8; }
      c.beginPath(); c.arc(-2, -2, 2, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(2, -2, 2, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#ffffff';
      c.beginPath(); c.moveTo(-2, 3); c.lineTo(-1, 6); c.lineTo(0, 3); c.fill();
      c.beginPath(); c.moveTo(1, 3); c.lineTo(2, 6); c.lineTo(3, 3); c.fill();
      // wings with membrane detail
      c.fillStyle = '#4f3e63';
      c.beginPath(); c.moveTo(-5, -2); c.lineTo(-20, -10 + flap * 8); c.lineTo(-14, 4 + flap * 4); c.lineTo(-6, 2); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(5, -2); c.lineTo(20, -10 + flap * 8); c.lineTo(14, 4 + flap * 4); c.lineTo(6, 2); c.closePath(); c.fill();
      // wing veins
      c.strokeStyle = '#6b5a80'; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(-5, -2); c.lineTo(-16, -6 + flap * 4); c.stroke();
      c.beginPath(); c.moveTo(5, -2); c.lineTo(16, -6 + flap * 4); c.stroke();
    }

    // HP bar
    if (enemy.hp < enemy.maxHp) {
      const barW = 26, barH = 4;
      round(c, -barW / 2, -enemy.h / 2 - 9, barW, barH, 2, '#1a1f24');
      const hw = Math.max(0, (enemy.hp / enemy.maxHp) * barW);
      const col = enemy.hp === 1 ? '#ff4d4d' : enemy.hp / enemy.maxHp < 0.5 ? '#f5a623' : '#55dd66';
      round(c, -barW / 2, -enemy.h / 2 - 9, hw, barH, 2, col);
    }
    c.restore();
  }

  // ---- Heroes with detailed animation states ----
  // أثر المراوغة: نسختان شفافتان خلف اللاعب. عرض فقط، ولا يُدخل شيئاً في المحاكاة.
  function drawHeroGhost(c, p, tick, reduced) {
    if (reduced || !p.dodge || p.dodge.ticks <= 0) return;
    for (let i = 2; i >= 1; i--) {
      c.save();
      c.globalAlpha = 0.16 / i;
      c.translate(-(p.dodge.dir || 1) * i * 11, i * 2);
      drawHero(c, { ...p, invulnerable: 0, dodge: { ...p.dodge, ticks: 0 } }, tick, true);
      c.restore();
    }
  }

  function drawMinerSprite(c, p, tick, reduced) {
    if (!heroSheet || !heroSheet.complete || !heroSheet.naturalWidth || !heroSheet.naturalHeight || p.pose === 'dead' || p.pose === 'hurt') return false;
    let col = 0, row = 0;
    if (p.pose === 'run') col = reduced ? 1 : 1 + Math.floor(tick / 8) % 2;
    else if (p.pose === 'mine' || p.pose === 'attack' || p.pose === 'heavy') { row = 1; col = 1; }
    else if (p.pose === 'victory') { row = 1; col = 2; }
    else if (p.pose === 'guard') row = 1;
    else if (p.pose === 'jump' || p.pose === 'fall') col = 2;
    const frameW = heroSheet.naturalWidth / 3, frameH = heroSheet.naturalHeight / 2;
    const idleBob = !reduced && p.pose === 'idle' ? Math.sin(tick * 0.07) * 0.8 : 0;
    c.drawImage(heroSheet, col * frameW, row * frameH, frameW, frameH, -27, -37 + idleBob, 54, 58);
    return true;
  }

  function drawMineLift(c, x, tick, reduced) {
    const bob = reduced ? 0 : Math.sin(tick * 0.025) * 3;
    const carY = 154 + bob;
    c.save();
    c.fillStyle = 'rgba(5,12,17,.72)';
    c.fillRect(x - 38, 48, 76, 254);
    round(c, x - 47, 44, 10, 260, 3, '#343c43');
    round(c, x + 37, 44, 10, 260, 3, '#343c43');
    round(c, x - 44, 46, 3, 256, 1, '#c3914e');
    round(c, x + 39, 46, 3, 256, 1, '#c3914e');
    round(c, x - 51, 42, 102, 9, 3, '#29333b');
    round(c, x - 44, 43, 88, 3, 1, '#e1b458');
    c.strokeStyle = '#b19b75';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(x - 16, 50); c.lineTo(x - 16, carY); c.moveTo(x + 16, 50); c.lineTo(x + 16, carY); c.stroke();
    round(c, x - 22, 47, 44, 7, 3, '#424950');
    c.fillStyle = '#f5c55e';
    c.beginPath(); c.arc(x, 50, 4, 0, TAU); c.fill();
    for (let y = 76; y < 298; y += 32) {
      round(c, x - 37, y, 74, 5, 2, '#3c4448');
      round(c, x - 34, y + 1, 68, 1.5, 1, '#b18a52');
      c.fillStyle = '#e7b650';
      c.fillRect(x - 46, y + 1, 4, 3);
      c.fillRect(x + 42, y + 1, 4, 3);
    }
    round(c, x - 31, carY, 62, 58, 5, '#39444b');
    round(c, x - 27, carY + 4, 54, 46, 3, '#1a252c');
    round(c, x - 23, carY + 8, 46, 35, 2, '#70431f');
    const cabinGlow = c.createLinearGradient(0, carY + 8, 0, carY + 43);
    cabinGlow.addColorStop(0, '#ffdc82');
    cabinGlow.addColorStop(0.55, '#f49732');
    cabinGlow.addColorStop(1, '#8e3d1e');
    c.fillStyle = cabinGlow;
    c.fillRect(x - 21, carY + 10, 42, 31);
    c.fillStyle = 'rgba(255,244,197,.48)';
    c.fillRect(x - 17, carY + 12, 3, 25);
    c.fillRect(x + 13, carY + 12, 3, 25);
    round(c, x - 35, carY + 48, 70, 9, 3, '#b78643');
    c.fillStyle = '#f3cc68';
    c.fillRect(x - 29, carY + 50, 58, 2);
    c.save();
    c.beginPath(); c.rect(x - 36, carY + 48, 72, 9); c.clip();
    for (let sx = x - 36; sx < x + 38; sx += 16) {
      c.fillStyle = '#202a30';
      c.beginPath(); c.moveTo(sx, carY + 57); c.lineTo(sx + 8, carY + 57); c.lineTo(sx + 16, carY + 48); c.lineTo(sx + 8, carY + 48); c.fill();
    }
    c.restore();
    c.fillStyle = '#fff0b0';
    c.beginPath(); c.arc(x - 18, carY + 19, 2.5, 0, TAU); c.arc(x + 18, carY + 19, 2.5, 0, TAU); c.fill();
    c.restore();
  }

  function drawHero(c, p, tick, reduced, showcaseScale = 1) {
    const heroId = p.hero || 'miner';
    const isRun = p.pose === 'run' && !reduced;
    const phase = isRun ? Math.sin(tick * 0.34) * 6 : 0;
    const breath = !reduced && p.pose === 'idle' ? Math.sin(tick * 0.07) * 0.8 : 0;
    const visualScale = Number.isFinite(showcaseScale) ? Math.max(1, Math.min(2.8, showcaseScale)) : 1;
    c.save();
    c.translate(p.x + 12, p.y + 20);
    c.scale(p.facing, 1);
    c.scale(visualScale, visualScale);
    c.translate(0, 21 * (1 / visualScale - 1));

    // hurt flash
    if (p.invulnerable && Math.floor(tick / 4) % 2 === 0) c.globalAlpha = 0.35;
    // pose transforms
    if (p.pose === 'hurt') { c.rotate(-0.18); c.translate(0, -1); }
    if (p.pose === 'dead') { c.rotate(1.57); c.translate(0, 12); }
    if (p.pose === 'land') c.scale(1.14, 0.88);
    if (p.pose === 'jump') c.translate(0, -1);
    if (p.pose === 'fall') c.rotate(p.facing * 0.06);
    if (p.pose === 'victory') { c.translate(0, Math.sin(tick * 0.12) * 1.5); }
    // V8: أوضاع القتال الجديدة — انخفاض الضربة الثقيلة، ميل المراوغة، وثبات الصدّ
    if (p.pose === 'heavy') { c.rotate(0.16); c.translate(1, 2); }
    if (p.pose === 'dodge') { c.rotate(0.42); c.scale(0.94, 0.9); }
    if (p.pose === 'guard') { c.translate(-1, 0); c.rotate(-0.05); }

    // ground shadow
    if (p.grounded && p.pose !== 'dead') {
      const shadowScale = p.pose === 'jump' || p.pose === 'fall' ? 0.7 : 1;
      c.fillStyle = '#00000055';
      c.beginPath(); c.ellipse(0, 19, 18 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2); c.fill();
    }

    if (heroId === 'miner' && !drawMinerSprite(c, p, tick, reduced)) {
      // legs / boots with run animation
      const legSwing = phase;
      round(c, -11, 4 + legSwing / 3, 9, 15, 3, '#2a3c4f');
      round(c, 3, 4 - legSwing / 3, 9, 15, 3, '#2a3c4f');
      // boots
      round(c, -13 + legSwing / 3, 15, 13, 6, 3, '#3b2f2d');
      round(c, 2 - legSwing / 3, 15, 14, 6, 3, '#3b2f2d');
      // highlight on boots
      c.fillStyle = '#5a4a42'; c.fillRect(-12 + legSwing / 3, 15, 6, 1.5); c.fillRect(3 - legSwing / 3, 15, 6, 1.5);
      // overalls
      round(c, -13, -7 + breath, 26, 19, 6, '#3e7f9e');
      round(c, -10, -8 + breath, 5, 19, 2, '#7ec2ce');
      round(c, 5, -8 + breath, 5, 19, 2, '#7ec2ce');
      // stitching
      c.fillStyle = '#5a9ab0'; c.fillRect(-10, -4 + breath, 5, 0.7); c.fillRect(5, -4 + breath, 5, 0.7);
      // belt
      round(c, -5, 1, 10, 6, 2, '#c9a44a');
      round(c, -3, 2, 6, 4, 1, '#e8c765');
      // head
      round(c, -14, -27, 28, 25, 9, '#f2be94');
      // cheek blush when victorious
      if (p.pose === 'victory') { c.fillStyle = '#ff8a80aa'; c.beginPath(); c.arc(-6, -12, 3, 0, Math.PI * 2); c.fill(); }
      round(c, -13, -8, 26, 8, 3, '#c96839');
      // beard with texture
      round(c, -6, -9, 20, 9, 4, '#8a4e28');
      c.fillStyle = '#a66a3a'; c.fillRect(-4, -7, 7, 1); c.fillRect(6, -6, 4, 1);
      round(c, 4, -8, 7, 3, 1, '#ffdcb0');
      // helmet
      round(c, -17, -34, 34, 14, 7, '#e8b248');
      round(c, -19, -23, 40, 5, 2, '#ffd785');
      // helmet highlight
      c.fillStyle = '#ffe9a8'; c.fillRect(-14, -32, 12, 2);
      // headlamp housing
      round(c, -4, -34, 10, 11, 3, '#9d682b');
      round(c, 1, -31, 9, 9, 4, '#fff7c7');
      // lens reflection
      c.fillStyle = '#ffffffcc'; c.beginPath(); c.arc(5, -28, 2, 0, Math.PI * 2); c.fill();
      // headlamp beam
      if (!reduced && p.pose !== 'dead') {
        const pulse = 0.85 + Math.sin(tick * 0.13) * 0.12;
        const beam = c.createRadialGradient(8, -27, 2, 110, -27, 125);
        beam.addColorStop(0, `rgba(255,245,190,${0.42 * pulse})`);
        beam.addColorStop(0.5, `rgba(255,228,120,${0.12 * pulse})`);
        beam.addColorStop(1, 'rgba(255,210,80,0)');
        c.fillStyle = beam;
        c.beginPath(); c.moveTo(8, -27); c.lineTo(130, -68); c.lineTo(130, 24); c.closePath(); c.fill();
        // beam dust motes
        if (!reduced) {
          c.fillStyle = `rgba(255,255,210,${0.18 * pulse})`;
          for (const dx of [30, 65, 95]) c.beginPath(), c.arc(8 + dx, -18 + Math.sin(tick * 0.2 + dx) * 3, 1, 0, Math.PI * 2), c.fill();
        }
      }
      // eyes
      let eyeY = -17, eyeOpen = 3;
      if (p.pose === 'hurt') eyeY = -16, eyeOpen = 1.5;
      c.fillStyle = '#1e2328';
      if (p.pose === 'dead') { c.strokeStyle = '#1e2328'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(1, -18); c.lineTo(7, -16); c.stroke(); c.beginPath(); c.moveTo(7, -18); c.lineTo(1, -16); c.stroke(); }
      else { c.beginPath(); c.arc(4, eyeY, 1.9, 0, Math.PI * 2); c.fill(); }
      // eyebrow when attacking
      if (p.pose === 'attack' || p.pose === 'mine') { c.fillStyle = '#5a3520'; c.fillRect(1, -20, 7, 1.2); }
      round(c, 11, -15, 6, 6, 3, '#f9d2aa');

      // arm + pickaxe
      c.save();
      c.translate(12, -4);
      let swingAngle = 0.32;
      if (p.pose === 'mine') swingAngle = -1.75 + (14 - p.attack) * 0.23;
      else if (p.pose === 'attack') swingAngle = -1.35 + (14 - p.attack) * 0.26;
      else if (p.pose === 'victory') swingAngle = -2.05 + Math.sin(tick * 0.14) * 0.12;
      else if (p.pose === 'run') swingAngle = 0.32 + phase * 0.04;
      else if (p.pose === 'jump') swingAngle = -0.4;
      else if (p.pose === 'hurt') swingAngle = 0.6;
      c.rotate(swingAngle);
      round(c, -2, -3, 7, 17, 3, '#f2be94');
      round(c, 1, -17, 4, 30, 1, '#a6723f');
      // handle wood grain
      c.fillStyle = '#c49a5a'; c.fillRect(2, -10, 1.5, 18);
      c.strokeStyle = '#c6ede5'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-9, -15); c.quadraticCurveTo(2, -24, 17, -16); c.stroke();
      // blade shine
      c.strokeStyle = '#e0ffffaa'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-6, -14); c.quadraticCurveTo(2, -22, 12, -16); c.stroke();
      // attack arc
      if (p.pose === 'attack' && p.attack > 5 && !reduced) {
        c.strokeStyle = '#ffeaa7cc'; c.lineWidth = 3.5;
        c.beginPath(); c.arc(2, -17, 26, -1.25, 0.85); c.stroke();
        c.strokeStyle = '#ffffff44'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(2, -17, 22, -1.1, 0.7); c.stroke();
      }
      // mine sparks will be particles in game.js
      c.restore();
      // off-hand
      round(c, -17, -5 - phase / 3, 7, 13, 3, '#f2be94');
      if (p.pose === 'run') { c.save(); c.translate(-17, -5); c.rotate(phase * 0.02); round(c, 0, 0, 7, 13, 3, '#f2be94'); c.restore(); }
    } else if (heroId === 'warrior') {
      round(c, -11, 4 + phase / 3, 9, 15, 3, '#34495e');
      round(c, 3, 4 - phase / 3, 9, 15, 3, '#34495e');
      round(c, -13 + phase / 3, 15, 13, 6, 3, '#1c2833');
      round(c, 2 - phase / 3, 15, 14, 6, 3, '#1c2833');
      // greave shine
      c.fillStyle = '#4a6278'; c.fillRect(-10 + phase / 3, 6, 3, 8); c.fillRect(4 - phase / 3, 6, 3, 8);
      round(c, -13, -7 + breath, 26, 19, 6, '#5dade2');
      round(c, -11, -8 + breath, 22, 16, 5, '#a6acaf');
      // plate detail: rivets
      c.fillStyle = '#7f8c8d';
      for (const rx of [-7, 7]) for (const ry of [-5, 0]) { c.beginPath(); c.arc(rx, ry + breath, 1, 0, Math.PI * 2); c.fill(); }
      round(c, -4, 1, 8, 6, 2, '#f4d03f');
      round(c, -14, -27, 28, 25, 9, '#f2be94');
      // face visible through visor when idle, fierce when attacking
      round(c, -16, -34, 32, 18, 7, '#95a5a6');
      round(c, -17, -22, 34, 5, 2, '#7f8c8d');
      // crest / plume
      c.fillStyle = '#e74c3c';
      c.beginPath();
      c.moveTo(-8, -34); c.quadraticCurveTo(-14, -46, -4, -44); c.quadraticCurveTo(8, -42, 6, -34); c.closePath(); c.fill();
      c.fillStyle = '#c0392b';
      c.beginPath(); c.moveTo(-6, -34); c.quadraticCurveTo(-10, -42, -2, -41); c.lineTo(4, -34); c.closePath(); c.fill();
      // visor slit
      round(c, 0, -21, 9, 4, 1, '#1b2631');
      // eye glint
      if (p.pose !== 'hurt' && p.pose !== 'dead') { c.fillStyle = '#85c1e9'; c.beginPath(); c.arc(2, -20, 0.8, 0, Math.PI * 2); c.fill(); }

      // broadsword arm
      c.save();
      c.translate(12, -4);
      let swingAngle = 0.22;
      if (p.pose === 'attack') swingAngle = -1.55 + (14 - p.attack) * 0.27;
      else if (p.pose === 'victory') swingAngle = -2.2;
      else if (p.pose === 'run') swingAngle = 0.22 + phase * 0.04;
      c.rotate(swingAngle);
      round(c, -2, -3, 7, 17, 3, '#f2be94');
      round(c, 1, -10, 4, 14, 1, '#784212');
      round(c, -5, -11, 16, 4, 1, '#f1c40f');
      // crossguard shine
      c.fillStyle = '#f9e79f'; c.fillRect(-3, -11, 12, 1);
      c.fillStyle = '#ecf0f1';
      c.beginPath(); c.moveTo(1, -11); c.lineTo(1, -38); c.lineTo(3, -42); c.lineTo(5, -38); c.lineTo(5, -11); c.closePath(); c.fill();
      // fuller line
      c.strokeStyle = '#bdc3c7'; c.lineWidth = 0.7;
      c.beginPath(); c.moveTo(3, -12); c.lineTo(3, -40); c.stroke();
      if (p.pose === 'attack' && p.attack > 5 && !reduced) {
        c.strokeStyle = '#5dade2cc'; c.lineWidth = 5; c.beginPath(); c.arc(3, -25, 32, -1.4, 0.9); c.stroke();
        c.strokeStyle = '#aed6f1aa'; c.lineWidth = 2; c.beginPath(); c.arc(3, -25, 28, -1.3, 0.8); c.stroke();
      }
      c.restore();
      // shield arm
      c.save();
      c.translate(-13, -4);
      if (p.pose === 'run') c.rotate(phase * 0.02);
      round(c, -3, -1, 10, 16, 5, '#2980b9');
      strokeRound(c, -3, -1, 10, 16, 5, '#f4d03f', 1.5);
      // shield emblem
      c.fillStyle = '#f1c40f'; c.beginPath(); c.arc(2, 7, 2.5, 0, Math.PI * 2); c.fill();
      c.restore();

    } else if (heroId === 'archer') {
      round(c, -11, 4 + phase / 3, 9, 15, 3, '#1e8449');
      round(c, 3, 4 - phase / 3, 9, 15, 3, '#1e8449');
      round(c, -13 + phase / 3, 15, 13, 6, 3, '#4a235a');
      round(c, 2 - phase / 3, 15, 14, 6, 3, '#4a235a');
      round(c, -13, -7 + breath, 26, 19, 6, '#2ecc71');
      round(c, -11, -8 + breath, 22, 16, 5, '#27ae60');
      round(c, -4, 1, 8, 6, 2, '#d4ac0d');
      // lacing detail
      c.strokeStyle = '#1a7431'; c.lineWidth = 0.7;
      c.beginPath(); c.moveTo(-6, -6 + breath); c.lineTo(-6, 2 + breath); c.stroke();
      c.beginPath(); c.moveTo(6, -6 + breath); c.lineTo(6, 2 + breath); c.stroke();
      round(c, -14, -27, 28, 25, 9, '#f2be94');
      round(c, -16, -34, 32, 18, 9, '#1e8449');
      round(c, -17, -22, 34, 6, 3, '#196f3d');
      // ear visible
      c.fillStyle = '#e8b090'; c.beginPath(); c.ellipse(-11, -16, 2, 3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1e241c'; c.beginPath(); c.arc(4, -18, 1.9, 0, Math.PI * 2); c.fill();
      if (p.pose === 'attack') { c.fillStyle = '#5a3520'; c.fillRect(1, -21, 6, 1); }
      // wind in hood
      if (isRun) { c.fillStyle = '#ffffff15'; c.beginPath(); c.ellipse(-12, -30, 6, 2, -0.3, 0, Math.PI * 2); c.fill(); }

      c.save();
      c.translate(14, -2);
      let bowAngle = p.pose === 'attack' ? -0.18 : 0.32;
      if (p.pose === 'run') bowAngle += phase * 0.03;
      c.rotate(bowAngle);
      round(c, -2, -3, 6, 15, 2, '#f2be94');
      c.strokeStyle = '#784212'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.arc(5, 0, 18, -1.3, 1.3); c.stroke();
      c.strokeStyle = '#a0522d'; c.lineWidth = 1;
      c.beginPath(); c.arc(5, 0, 18, -1.3, 1.3); c.stroke();
      c.strokeStyle = '#ecf0f1'; c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(5 + 18 * Math.cos(-1.3), 18 * Math.sin(-1.3));
      c.lineTo(p.pose === 'attack' ? -2 : 5 + 18 * Math.cos(0), 0);
      c.lineTo(5 + 18 * Math.cos(1.3), 18 * Math.sin(1.3));
      c.stroke();
      // nocked arrow when attacking
      if (p.pose === 'attack' && p.attack > 8) {
        round(c, -2, -1, 10, 1.5, 0.5, '#c49a6c');
        c.fillStyle = '#d5e2e8'; c.beginPath(); c.moveTo(8, -1); c.lineTo(11, 0); c.lineTo(8, 1); c.fill();
      }
      c.restore();
      // quiver
      round(c, -17, -15, 6, 18, 2, '#784212');
      c.fillStyle = '#a67c52'; c.fillRect(-16, -13, 1, 14);
      c.fillStyle = '#ecf0f1'; c.fillRect(-17, -19, 2, 4); c.fillRect(-14, -20, 2, 5);
    }

    // ===== V8: قراءة الحالة من الرسم نفسه =====
    // الدرع أمام الجسم عند الصدّ (ويتوهج عند نجاح صدّ حديث)، وسيف منحنٍ ذهبي عند الضربة الثقيلة.
    if (p.pose === 'guard') {
      const hot = (p.guard?.timer || 0) > 0;
      c.save();
      c.translate(15, -6);
      c.rotate(-0.12);
      const grad = c.createLinearGradient(-6, -16, 8, 16);
      grad.addColorStop(0, hot ? '#dbeafe' : '#93a7bb'); grad.addColorStop(1, hot ? '#60a5fa' : '#4b5f74');
      c.fillStyle = grad;
      c.beginPath(); c.moveTo(0, -17); c.quadraticCurveTo(11, -13, 10, 2); c.quadraticCurveTo(8, 14, 0, 18); c.quadraticCurveTo(-8, 14, -10, 2); c.quadraticCurveTo(-11, -13, 0, -17); c.closePath(); c.fill();
      c.strokeStyle = hot ? '#f8fafc' : '#cbd5e1'; c.lineWidth = 1.6; c.stroke();
      c.fillStyle = hot ? '#fef3c7' : '#7c8da0';
      c.beginPath(); c.arc(0, 0, 3.4, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    if (p.pose === 'heavy') {
      c.strokeStyle = '#ffd166ee'; c.lineWidth = 5.5; c.lineCap = 'round';
      c.beginPath(); c.arc(4, -14, 30, -1.5, 0.5); c.stroke();
      c.strokeStyle = '#fff8dccc'; c.lineWidth = 2;
      c.beginPath(); c.arc(4, -14, 25, -1.35, 0.35); c.stroke();
    }

    c.restore();
  }


  const characters = { drawHero, drawHeroGhost, drawEnemy, drawDrone, dronePos, drawMineLift };
  root.PlatformCharacters = characters;
  if (typeof module === 'object' && module.exports) module.exports = characters;
})(typeof globalThis !== 'undefined' ? globalThis : this);
