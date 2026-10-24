/* Professional cartoon 2D vector renderer — rich cave world, parallax, lighting, particles, animated characters */
(function (root) {
  'use strict';
  const R = root.PlatformRules;
  // Fallback for cached/legacy rule modules that predate cosmetic run zones.
  const DEFAULT_ZONE = {
    name: '', sky: ['#080e1a', '#0c1e2e', '#112838', '#1a3545', '#1e3a4a'],
    far: '#0a1a28', mid: '#0d2233', columns: '#143040', glow: '#3ee6b3', crystal: '#39a9a4',
  };

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

  // ---- Crystals with facets ----
  function crystal(c, x, y, scale, color, glow = true) {
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    if (glow) {
      // outer glow
      const g = c.createRadialGradient(0, 0, 2, 0, 0, 20);
      g.addColorStop(0, color + '44');
      g.addColorStop(1, color + '00');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, 20, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, -13);
    c.lineTo(10, -4);
    c.lineTo(8, 10);
    c.lineTo(0, 14);
    c.lineTo(-9, 7);
    c.lineTo(-9, -4);
    c.closePath();
    c.fill();
    // top facet highlight
    c.fillStyle = '#ffffff99';
    c.beginPath();
    c.moveTo(0, -13); c.lineTo(2.5, 5); c.lineTo(-9, -4); c.closePath(); c.fill();
    // sparkle
    c.fillStyle = '#ffffffee';
    c.beginPath(); c.arc(-1.5, -6.5, 1.8, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(1, 2, 1, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // Rare crystal variant — extra glow and particle
  function rareCrystal(c, x, y, bob) {
    crystal(c, x, y + bob, 0.92, '#a78bfa', true);
    // extra violet aura
    c.save();
    c.translate(x, y + bob);
    c.fillStyle = '#c4b5fd22';
    c.beginPath(); c.arc(0, 0, 24, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // Metal ore vein shimmer
  function oreVein(c, x, y, w, h, color) {
    round(c, x, y, w, h, 2, color);
    c.fillStyle = '#ffffff22';
    c.fillRect(x + 1, y + 1, w - 2, 2);
  }

  // ---- Projectile ----
  function drawProjectile(c, proj) {
    c.save();
    c.translate(proj.x, proj.y);
    c.rotate(Math.atan2(proj.vy, proj.vx));
    // trail
    c.fillStyle = '#ffffff22';
    c.beginPath(); c.ellipse(-10, 0, 8, 1.5, 0, 0, Math.PI * 2); c.fill();
    round(c, -8, -1.5, 16, 3, 1, '#9b7145');
    c.fillStyle = '#d5e2e8';
    c.beginPath(); c.moveTo(10, 0); c.lineTo(6, -4); c.lineTo(6, 4); c.closePath(); c.fill();
    c.fillStyle = '#e8f0f2';
    c.beginPath(); c.moveTo(-7, -4); c.lineTo(-4, 0); c.lineTo(-8, 0); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-7, 4); c.lineTo(-4, 0); c.lineTo(-8, 0); c.closePath(); c.fill();
    c.restore();
  }

  // ---- Enemies ----
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
  function drawHero(c, p, tick, reduced) {
    const heroId = p.hero || 'miner';
    const isRun = p.pose === 'run' && !reduced;
    const phase = isRun ? Math.sin(tick * 0.34) * 6 : 0;
    const breath = !reduced && p.pose === 'idle' ? Math.sin(tick * 0.07) * 0.8 : 0;
    c.save();
    c.translate(p.x + 12, p.y + 20);
    c.scale(p.facing, 1);

    // hurt flash
    if (p.invulnerable && Math.floor(tick / 4) % 2 === 0) c.globalAlpha = 0.35;
    // pose transforms
    if (p.pose === 'hurt') { c.rotate(-0.18); c.translate(0, -1); }
    if (p.pose === 'dead') { c.rotate(1.57); c.translate(0, 12); }
    if (p.pose === 'land') c.scale(1.14, 0.88);
    if (p.pose === 'jump') c.translate(0, -1);
    if (p.pose === 'fall') c.rotate(p.facing * 0.06);
    if (p.pose === 'victory') { c.translate(0, Math.sin(tick * 0.12) * 1.5); }

    // ground shadow
    if (p.grounded && p.pose !== 'dead') {
      const shadowScale = p.pose === 'jump' || p.pose === 'fall' ? 0.7 : 1;
      c.fillStyle = '#00000055';
      c.beginPath(); c.ellipse(0, 19, 18 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2); c.fill();
    }

    if (heroId === 'miner') {
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

    c.restore();
  }

  // ---- Main draw ----
  function draw(canvas, s, opts = {}) {
    const reduced = !!opts.reduced;
    const particles = opts.particles || [];
    const shake = opts.shake || 0;
    const c = canvas.getContext('2d');
    const cssW = canvas.clientWidth || 480, cssH = canvas.clientHeight || 300;
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    const pixelW = Math.round(cssW * dpr), pixelH = Math.round(cssH * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) { canvas.width = pixelW; canvas.height = pixelH; }
    const worldH = 360, w = Math.max(280, cssW * worldH / cssH);
    const scale = pixelW / w;
    c.setTransform(scale, 0, 0, pixelH / worldH, 0, 0);

    // subtle screen shake
    let shakeX = 0, shakeY = 0;
    if (shake > 0 && !reduced) {
      shakeX = (Math.random() - 0.5) * shake * 12;
      shakeY = (Math.random() - 0.5) * shake * 8;
      c.translate(shakeX, shakeY);
    }

    const camera = R.cameraFor(s, w);
    // Cosmetic cave theme chosen from the run seed; physics and rewards ignore it.
    const zone = (R.ZONES || [])[s.zone || 0] || DEFAULT_ZONE;

    // ===== Background =====
    // Deep cavern gradient with vignette
    const bg = c.createLinearGradient(0, 0, 0, 360);
    bg.addColorStop(0, zone.sky[0]);
    bg.addColorStop(0.18, zone.sky[1]);
    bg.addColorStop(0.5, zone.sky[2]);
    bg.addColorStop(0.78, zone.sky[3]);
    bg.addColorStop(1, zone.sky[4]);
    c.fillStyle = bg; c.fillRect(0, 0, w, 360);

    // Vignette darkening at edges
    const vignette = c.createRadialGradient(w / 2, 180, w * 0.4, w / 2, 180, w * 0.95);
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vignette; c.fillRect(0, 0, w, 360);

    // ---- Parallax layers ----

    // Layer -2: Far cavern wall silhouette with faint crystals
    const shiftFar = camera * 0.07;
    c.fillStyle = zone.far;
    for (let i = Math.floor(shiftFar / 260) - 1; i < Math.ceil((shiftFar + w) / 260) + 1; i++) {
      const x = i * 260 - shiftFar;
      c.beginPath();
      c.moveTo(x - 70, 0); c.lineTo(x + 20, 65 + (Math.abs(i * 7) % 30)); c.lineTo(x + 100, 0); c.fill();
      // distant crystal glimmer
      if (i % 3 === 0) {
        c.fillStyle = '#2a6b7a22';
        c.beginPath(); c.arc(x + 40, 45, 4, 0, Math.PI * 2); c.fill();
        c.fillStyle = zone.far;
      }
    }

    // Layer 0: Distant stalactites
    const shift0 = camera * 0.14;
    c.fillStyle = zone.mid;
    for (let i = Math.floor(shift0 / 200) - 1; i < Math.ceil((shift0 + w) / 200) + 1; i++) {
      const x = i * 200 - shift0;
      const hgt = 55 + (Math.abs(i * 13) % 35);
      c.beginPath(); c.moveTo(x - 45, 0); c.lineTo(x + 20, hgt); c.lineTo(x + 85, 0); c.fill();
      // tiny drips
      c.fillStyle = '#1a3a4a';
      c.fillRect(x + 18, hgt - 2, 2, 6);
      c.fillStyle = zone.mid;
    }

    // Layer 1: Mid rock columns & arches
    const shift1 = camera * 0.30;
    c.fillStyle = zone.columns;
    for (let i = Math.floor(shift1 / 180) - 1; i < Math.ceil((shift1 + w) / 180) + 1; i++) {
      const x = i * 180 - shift1;
      c.beginPath();
      c.moveTo(x - 60, 340); c.lineTo(x - 20, 105 + (Math.abs(i * 5) % 30)); c.lineTo(x + 35, 70 + (i % 2) * 30); c.lineTo(x + 90, 170); c.lineTo(x + 155, 340); c.fill();
      // arch highlights
      c.fillStyle = '#1e4458';
      c.fillRect(x + 10, 120, 2, 40);
      c.fillStyle = zone.columns;
    }

    // Layer 2: Near supports, rails, mushrooms
    const shift2 = camera * 0.54;
    for (let i = Math.floor(shift2 / 240) - 1; i < Math.ceil((shift2 + w) / 240) + 1; i++) {
      const x = i * 240 - shift2;
      // timber beam
      round(c, x + 15, 50, 12, 260, 3, '#2d241e');
      round(c, x + 17, 52, 8, 256, 2, '#4a3728');
      // wood grain
      c.strokeStyle = '#3d2b1a'; c.lineWidth = 0.8;
      for (let gy = 60; gy < 300; gy += 18) { c.beginPath(); c.moveTo(x + 17, gy); c.lineTo(x + 25, gy + 4); c.stroke(); }
      round(c, x - 30, 48, 180, 12, 3, '#3e4a52');
      round(c, x - 28, 50, 176, 8, 2, '#5a6570');
      // glowing mushrooms (varied)
      const mushColors = [zone.glow, '#7dd3c6', '#56cfe1'];
      c.fillStyle = mushColors[Math.abs(i) % 3];
      c.beginPath(); c.arc(x + 80, 295, 6, Math.PI, 0); c.fill();
      c.fillStyle = mushColors[Math.abs(i) % 3] + '88';
      c.beginPath(); c.ellipse(x + 80, 295, 7, 3, 0, 0, Math.PI * 2); c.fill();
      round(c, x + 79, 295, 2, 8, 1, '#8deed2');
      // small mushroom cluster
      c.fillStyle = mushColors[(Math.abs(i) + 1) % 3] + 'aa';
      c.beginPath(); c.arc(x + 55, 298, 3.5, Math.PI, 0); c.fill();
      round(c, x + 54, 298, 1.5, 5, 1, '#8deed2');
    }

    // ---- Atmospheric particles: dust motes ----
    if (!reduced) {
      const dustOff = (s.tick * 0.4) % 360;
      c.fillStyle = 'rgba(180,200,210,0.09)';
      for (let i = 0; i < 18; i++) {
        const dx = (i * 97 + dustOff * (0.3 + i * 0.02)) % w;
        const dy = 40 + (i * 61) % 260;
        const sz = 0.7 + (i % 3) * 0.5;
        c.beginPath(); c.arc((dx - (camera * 0.15) % w + w) % w, dy, sz, 0, Math.PI * 2); c.fill();
      }
    }

    // ---- Stars / cavern glints (upper cave ceiling) ----
    c.fillStyle = 'rgba(120,180,210,0.10)';
    for (let i = 0; i < 20; i++) {
      const x = (i * 73 + 25) % w;
      const y = 8 + (i * 41) % 50;
      const twinkle = reduced ? 1 : 0.6 + Math.sin(s.tick * 0.04 + i) * 0.4;
      c.globalAlpha = twinkle * 0.6;
      c.fillRect(x, y, 1.2, 1.2);
    }
    c.globalAlpha = 1;

    c.save();
    c.translate(-camera, 0);

    // ---- Cavern props: beams, lanterns, stalactites, ambient crystals ----
    for (let x = Math.floor(camera / 220) * 220; x < camera + w + 220; x += 220) {
      // vertical beam
      round(c, x + 20, 70, 12, 230, 3, '#4a3b30');
      round(c, x + 22, 72, 8, 226, 2, '#6b5438');
      // horizontal beam
      round(c, x - 20, 68, 170, 13, 3, '#624e3c');
      round(c, x - 18, 70, 166, 9, 2, '#7a6548');
      // diagonal brace
      c.strokeStyle = '#7f634b'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x + 30, 110); c.lineTo(x + 72, 80); c.stroke();
      // bolts
      c.fillStyle = '#2d241e';
      c.beginPath(); c.arc(x + 30, 110, 2, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(x + 72, 80, 2, 0, Math.PI * 2); c.fill();
      // hanging stalactite
      c.fillStyle = '#0f222f';
      c.beginPath(); c.moveTo(x + 96, 0); c.lineTo(x + 111, 48); c.lineTo(x + 125, 0); c.fill();
      // ambient crystal cluster
      const flicker = reduced ? 1 : 0.85 + Math.sin(s.tick * 0.07 + x * 0.02) * 0.2;
      c.globalAlpha = flicker;
      crystal(c, x + 155, 287, 0.65, zone.crystal, false);
      c.globalAlpha = 0.5 * flicker;
      crystal(c, x + 162, 291, 0.38, '#7dd3c6', false);
      c.globalAlpha = 1;
      // lantern with animated flame
      const pulse = reduced ? 1 : 0.82 + Math.sin(s.tick * 0.14 + x * 0.05) * 0.18;
      const flameFlicker = reduced ? 0 : Math.sin(s.tick * 0.35 + x) * 1.2;
      const glow = c.createRadialGradient(x + 35, 125, 4, x + 35, 125, 62);
      glow.addColorStop(0, `rgba(255,205,110,${0.50 * pulse})`);
      glow.addColorStop(0.4, `rgba(255,180,80,${0.18 * pulse})`);
      glow.addColorStop(1, 'rgba(255,150,40,0)');
      c.fillStyle = glow;
      c.beginPath(); c.arc(x + 35, 125, 62, 0, Math.PI * 2); c.fill();
      // lantern body
      round(c, x + 30, 119, 10, 25, 2, '#2c2320');
      round(c, x + 31, 120, 8, 23, 2, '#3d3028');
      // glass
      round(c, x + 29, 116, 12, 16, 5, `rgba(255,199,109,${0.95 * pulse})`);
      // flame
      c.fillStyle = `rgba(255,255,255,${0.9 * pulse})`;
      c.beginPath(); c.ellipse(x + 35 + flameFlicker * 0.3, 123, 2, 3.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = `rgba(255,220,100,${0.7 * pulse})`;
      c.beginPath(); c.ellipse(x + 35 + flameFlicker * 0.5, 124, 1, 2, 0, 0, Math.PI * 2); c.fill();
      // hanging chain
      c.strokeStyle = '#3d3028'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x + 35, 78); c.lineTo(x + 35, 116); c.stroke();
      for (let ly = 82; ly < 114; ly += 8) { c.beginPath(); c.ellipse(x + 35, ly, 1.5, 2.2, 0, 0, Math.PI * 2); c.stroke(); }
    }

    // ---- Environmental extras: mine carts, chests, barrels ----
    const extras = [
      { x: 530, type: 'cart' }, { x: 890, type: 'barrel' }, { x: 1260, type: 'cart' },
      { x: 1440, type: 'chest' }, { x: 1760, type: 'barrel' }, { x: 2040, type: 'cart' }, { x: 2320, type: 'chest' },
    ];
    for (const ex of extras) {
      if (ex.x < camera - 80 || ex.x > camera + w + 80) continue;
      if (ex.type === 'cart') {
        // mine cart
        round(c, ex.x, 284, 32, 14, 3, '#5a4632');
        round(c, ex.x + 2, 282, 28, 8, 2, '#7a5e3e');
        // ore inside
        round(c, ex.x + 6, 284, 20, 4, 1, '#6b8a7a');
        crystal(c, ex.x + 16, 283, 0.42, '#5cf3d2', false);
        // wheels
        c.fillStyle = '#2d241e';
        c.beginPath(); c.arc(ex.x + 8, 298, 4.5, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(ex.x + 24, 298, 4.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#4a3728'; c.beginPath(); c.arc(ex.x + 8, 298, 2, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(ex.x + 24, 298, 2, 0, Math.PI * 2); c.fill();
        // rail
        c.fillStyle = '#4a5560';
        c.fillRect(0, 300, R.LEVEL.width, 2);
      } else if (ex.type === 'chest') {
        // treasure chest
        round(c, ex.x, 283, 28, 16, 3, '#6b4a28');
        round(c, ex.x + 1, 285, 26, 6, 2, '#8a6238');
        // metal bands
        c.fillStyle = '#c9a84a'; c.fillRect(ex.x, 290, 28, 2); c.fillRect(ex.x + 12, 283, 2, 16);
        // lock
        round(c, ex.x + 11, 288, 6, 7, 1, '#e8c765');
        c.fillStyle = '#2d241e'; c.beginPath(); c.arc(ex.x + 14, 291, 1.5, 0, Math.PI * 2); c.fill();
        // glow
        if (!reduced) {
          c.fillStyle = '#ffd70011';
          c.beginPath(); c.arc(ex.x + 14, 289, 18, 0, Math.PI * 2); c.fill();
        }
      } else if (ex.type === 'barrel') {
        round(c, ex.x, 286, 18, 16, 8, '#6b5a3a');
        c.fillStyle = '#8a7050'; c.fillRect(ex.x + 2, 286, 14, 2); c.fillRect(ex.x + 1, 292, 16, 1.5); c.fillRect(ex.x + 2, 298, 14, 1.5);
        c.strokeStyle = '#3d3028'; c.lineWidth = 1;
        c.beginPath(); c.ellipse(ex.x + 9, 294, 8, 8, 0, 0, Math.PI * 2); c.stroke();
      }
    }

    // ---- Lava river with animated surface ----
    const lavaWave = reduced ? 0 : Math.sin(s.tick * 0.08) * 2;
    round(c, 0, 328, R.LEVEL.width, 32, 0, '#a33a1e');
    round(c, 0, 330 + lavaWave, R.LEVEL.width, 30, 0, '#cc472b');
    round(c, 0, 334 + lavaWave * 0.5, R.LEVEL.width, 26, 0, '#ea6231');
    round(c, 0, 342, R.LEVEL.width, 18, 0, '#ff9d42');
    round(c, 0, 346, R.LEVEL.width, 10, 0, '#ffd152');
    // lava bubbles
    if (!reduced) {
      const bubblePhase = s.tick * 0.18;
      for (let bx = Math.floor(camera / 140) * 140; bx < camera + w + 140; bx += 140) {
        const bxOff = bx + Math.sin(bubblePhase + bx * 0.01) * 6;
        const byOff = 347 + Math.sin(bubblePhase * 1.3 + bx) * 2;
        c.fillStyle = `rgba(255,220,120,${0.35 + Math.sin(bubblePhase + bx) * 0.15})`;
        c.beginPath(); c.arc(bxOff + 20, byOff, 3, 0, Math.PI * 2); c.fill();
        if (Math.abs(bx) % 280 < 10) {
          // popping bubble
          c.fillStyle = 'rgba(255,180,80,0.5)';
          c.beginPath(); c.arc(bxOff + 50, byOff - 4, 5, 0, Math.PI * 2); c.fill();
        }
      }
    }
    // heat haze above lava
    c.fillStyle = 'rgba(255,100,40,0.04)';
    c.fillRect(0, 318, R.LEVEL.width, 10);

    // ---- Platforms with detailed stone ----
    for (const box of R.LEVEL.platforms) {
      if (box.x + box.w < camera - 20 || box.x > camera + w + 20) continue;
      // base rock
      round(c, box.x, box.y, box.w, box.h, 4, '#4c443c');
      // inner shading
      round(c, box.x + 2, box.y + 2, box.w - 4, box.h - 4, 3, '#5a5048');
      // top grass/moss trim
      round(c, box.x, box.y, box.w, 9, 3, '#6b7c3f');
      round(c, box.x, box.y, box.w, 6, 2, '#a58253');
      round(c, box.x, box.y + 2, box.w, 3, 1, '#d8b27c');
      // moss patches
      c.fillStyle = '#5a6d35';
      for (let mx = box.x + 10; mx < box.x + box.w - 10; mx += 38) {
        c.beginPath(); c.ellipse(mx, box.y + 5, 6, 2.5, 0, 0, Math.PI * 2); c.fill();
      }
      // stone cracks & strata
      c.strokeStyle = '#3a342e'; c.lineWidth = 1.2;
      for (let x = Math.max(box.x + 8, Math.floor(camera / 36) * 36); x < Math.min(box.x + box.w - 8, camera + w); x += 36) {
        c.beginPath(); c.moveTo(x, box.y + 11); c.lineTo(x + 11, box.y + 22); c.lineTo(x + 3, box.y + 38); c.stroke();
        // small highlight
        c.strokeStyle = '#6b6358'; c.lineWidth = 0.6;
        c.beginPath(); c.moveTo(x + 1, box.y + 12); c.lineTo(x + 9, box.y + 12); c.stroke();
        c.strokeStyle = '#3a342e'; c.lineWidth = 1.2;
      }
      // side shadow
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(box.x, box.y + box.h - 6, box.w, 6);
      // pillars for floating platforms
      if (box.h < 25) {
        round(c, box.x + 8, box.y + 17, 8, 26, 2, '#7a5e3e');
        round(c, box.x + 8, box.y + 19, 5, 22, 1, '#9a7a52');
        round(c, box.x + box.w - 16, box.y + 17, 8, 26, 2, '#7a5e3e');
        round(c, box.x + box.w - 14, box.y + 19, 5, 22, 1, '#9a7a52');
      }
    }

    // ---- Rocks / Ores (with HP stages and ore veins) ----
    for (const rock of s.rocks) {
      if (rock.hp <= 0 || rock.x < camera - 60 || rock.x > camera + w) continue;
      const hpRatio = rock.hp / 3;
      const baseColor = rock.hp === 3 ? '#5b6e6c' : rock.hp === 2 ? '#4d5d5b' : '#3d4b49';
      const edgeColor = rock.hp === 3 ? '#8aa69b' : rock.hp === 2 ? '#7a9690' : '#6a8680';
      round(c, rock.x, rock.y, rock.w, rock.h, 10, baseColor);
      strokeRound(c, rock.x, rock.y, rock.w, rock.h, 10, edgeColor, 2);
      // inner bevel
      round(c, rock.x + 2, rock.y + 2, rock.w - 4, rock.h - 8, 8, '#6b807c');
      c.globalAlpha = 0.25; round(c, rock.x + 3, rock.y + 3, rock.w - 6, 10, 6, '#9ab8b0'); c.globalAlpha = 1;
      // embedded crystal with glow pulse when low HP
      const pulse = rock.hp === 1 && !reduced ? 0.7 + Math.sin(s.tick * 0.2) * 0.3 : 1;
      c.globalAlpha = pulse;
      crystal(c, rock.x + 22, rock.y + 25, 0.72, '#56ebd3', true);
      c.globalAlpha = 1;
      // ore vein shimmer
      if (rock.hp >= 2) oreVein(c, rock.x + 6, rock.y + 8, 8, 3, '#c49a6c');
      if (rock.hp === 3) oreVein(c, rock.x + 30, rock.y + 14, 6, 2, '#8ec5b0');
      // damage cracks with glow
      if (rock.hp < 3) {
        c.strokeStyle = hpRatio === 2/3 ? '#ffd875' : '#ff9955';
        c.lineWidth = 2; c.lineCap = 'round';
        if (!reduced && rock.hp === 1) { c.shadowColor = '#ff6b35'; c.shadowBlur = 4; }
        c.beginPath(); c.moveTo(rock.x + 24, rock.y + 4); c.lineTo(rock.x + 16, rock.y + 18); c.lineTo(rock.x + 28, rock.y + 30); c.stroke();
        c.shadowBlur = 0;
      }
      if (rock.hp === 1) {
        c.strokeStyle = '#ff5535'; c.lineWidth = 2;
        if (!reduced) { c.shadowColor = '#ff3333'; c.shadowBlur = 6; }
        c.beginPath(); c.moveTo(rock.x + 35, rock.y + 10); c.lineTo(rock.x + 26, rock.y + 25); c.lineTo(rock.x + 36, rock.y + 42); c.stroke();
        c.shadowBlur = 0;
        // debris falling
        if (!reduced) { c.fillStyle = '#6a7674'; c.fillRect(rock.x + 18, rock.y + rock.h - 2, 3, 4); c.fillRect(rock.x + 32, rock.y + rock.h - 1, 2, 3); }
      }
      // HP pips above rock
      for (let hi = 0; hi < rock.hp; hi++) {
        c.fillStyle = hi < rock.hp ? '#56ebd3' : '#2a3a38';
        c.beginPath(); c.arc(rock.x + 10 + hi * 8, rock.y - 5, 2.5, 0, Math.PI * 2); c.fill();
      }
    }

    // ---- Gems ----
    for (const gem of s.gems) {
      if (gem.taken || gem.x < camera - 20 || gem.x > camera + w + 20) continue;
      const bob = reduced ? 0 : Math.sin(s.tick * 0.08 + gem.x * 0.02) * 3;
      const idx = R.LEVEL.gems.indexOf ? R.LEVEL.gems.findIndex(g => g.x === gem.x || Math.abs(g.x - gem.x) < 2) : -1;
      // alternate colors for variety: every 3rd is rare purple
      const isRare = (gem.x % 400) < 80; // pseudo-rare based on position hash
      if (isRare && !reduced) {
        rareCrystal(c, gem.x, gem.y, bob);
        // sparkle particles around rare
        const sparklePhase = s.tick * 0.12 + gem.x;
        c.fillStyle = `rgba(200,180,255,${0.5 + Math.sin(sparklePhase) * 0.3})`;
        c.beginPath(); c.arc(gem.x + Math.cos(sparklePhase) * 12, gem.y + bob + Math.sin(sparklePhase * 1.5) * 4, 1.2, 0, Math.PI * 2); c.fill();
      } else {
        const gemColors = ['#5cf3d2', '#60e0ff', '#a78bfa'];
        const col = gemColors[Math.abs(Math.floor(gem.x)) % 3];
        crystal(c, gem.x, gem.y + bob, 0.78, col, true);
      }
      // shadow under gem
      c.fillStyle = 'rgba(0,0,0,0.15)';
      c.beginPath(); c.ellipse(gem.x, gem.y + 10, 8, 2, 0, 0, Math.PI * 2); c.fill();
    }

    // ---- Hazards ----
    for (const h of R.LEVEL.hazards) {
      if (h.x < camera - 70 || h.x > camera + w + 20) continue;
      const active = R.activeHazard(h, s.tick);
      // base plate
      round(c, h.x - 5, 294, h.w + 10, 6, 2, '#2e2420');
      round(c, h.x - 3, 295, h.w + 6, 3, 1, '#4a3530');
      // spikes
      c.fillStyle = active ? '#ff6f43' : '#697f82';
      if (active && !reduced) { c.shadowColor = '#ff6f43'; c.shadowBlur = 8; }
      for (let i = 0; i < h.w; i += 12) {
        c.beginPath(); c.moveTo(h.x + i, 297); c.lineTo(h.x + i + 6, active ? h.y : 291); c.lineTo(h.x + i + 12, 297); c.fill();
      }
      c.shadowBlur = 0;
      // warning stripes when inactive steam
      if (!active && h.period > 1) {
        c.fillStyle = '#ffd70033';
        for (let i = 0; i < h.w; i += 8) c.fillRect(h.x + i, 292, 4, 2);
      }
      // steam gauge
      if (h.period > 1) {
        round(c, h.x - 4, 252, 50, 5, 2, '#1a2e35');
        const prog = (s.tick % h.period) / h.period;
        round(c, h.x - 4, 252, 50 * prog, 5, 2, active ? '#ff784e' : '#67d3bd');
        // gauge ticks
        c.fillStyle = '#ffffff33'; for (let t = 0; t <= 50; t += 10) c.fillRect(h.x - 4 + t, 252, 0.7, 5);
        if (active && !reduced) {
          // steam plume with turbulence
          const steamAlpha = 0.30 + Math.sin(s.tick * 0.15) * 0.08;
          c.fillStyle = `rgba(255,240,220,${steamAlpha})`;
          c.beginPath(); c.arc(h.x + h.w / 2, h.y - 10, 16, 0, Math.PI * 2); c.fill();
          c.beginPath(); c.arc(h.x + h.w / 2 - 8, h.y - 24, 12, 0, Math.PI * 2); c.fill();
          c.beginPath(); c.arc(h.x + h.w / 2 + 8, h.y - 22, 14, 0, Math.PI * 2); c.fill();
          // wispy tendrils
          c.strokeStyle = `rgba(255,255,255,${steamAlpha * 0.4})`; c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(h.x + h.w / 2, h.y); c.quadraticCurveTo(h.x + h.w / 2 - 6, h.y - 18, h.x + h.w / 2 - 4, h.y - 32); c.stroke();
          c.beginPath(); c.moveTo(h.x + h.w / 2 + 5, h.y); c.quadraticCurveTo(h.x + h.w / 2 + 10, h.y - 16, h.x + h.w / 2 + 6, h.y - 30); c.stroke();
        }
      }
      // hazard warning icon when active
      if (active && h.period > 1) {
        c.fillStyle = '#ff6f43'; c.font = 'bold 9px sans-serif'; c.textAlign = 'center';
        c.fillText('⚠', h.x + h.w / 2, h.y - 2);
      }
    }

    // ---- Signposts & Checkpoints ----
    for (const x of [680, 1485, 2030]) {
      round(c, x, 267, 4, 33, 1, '#9b7e4e');
      round(c, x, 268, 2, 31, 1, '#b89a5a');
      round(c, x - 14, 253, 37, 20, 3, '#af8d55');
      round(c, x - 12, 255, 33, 16, 2, '#c9a96a');
      c.fillStyle = '#2f2726'; c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.fillText('↑', x + 4, 268);
      // arrow highlight
      c.fillStyle = '#ffe4a0'; c.font = 'bold 10px sans-serif'; c.fillText('▲', x + 4, 264);
    }
    for (const x of [920, 1710]) {
      round(c, x, 255, 3, 45, 1, '#9bbab2');
      round(c, x + 0.5, 256, 1.5, 43, 1, '#b5d1c9');
      const active = s.checkpoint === x;
      c.fillStyle = active ? '#55f0c4' : '#658588';
      if (active && !reduced) { c.shadowColor = '#55f0c4'; c.shadowBlur = 10; }
      c.beginPath(); c.moveTo(x + 3, 256); c.lineTo(x + 30, 263); c.lineTo(x + 3, 276); c.fill();
      c.shadowBlur = 0;
      // flag pole highlight
      c.fillStyle = active ? '#ffffff88' : '#ffffff22';
      c.fillRect(x + 3, 258, 8, 1);
      if (active) {
        c.fillStyle = '#1a3a2a'; c.font = 'bold 7px sans-serif'; c.textAlign = 'center'; c.fillText('✓', x + 16, 270);
      }
    }

    // ---- Exit portal ----
    const e = R.LEVEL.exit;
    // outer arch stone
    round(c, e.x - 10, e.y - 12, e.w + 20, e.h + 16, 26, '#8a6d3a');
    round(c, e.x - 8, e.y - 10, e.w + 16, e.h + 12, 24, '#a4814d');
    // inner arch depth
    round(c, e.x - 2, e.y - 4, e.w + 4, e.h + 4, 20, '#3d2810');
    round(c, e.x, e.y, e.w, e.h, 20, '#102a30');
    // portal energy
    const unlocked = R.canExit(s);
    if (unlocked && !reduced) {
      // pulsing glow around portal
      const pulse = 0.5 + Math.sin(s.tick * 0.06) * 0.25;
      const halo = c.createRadialGradient(e.x + e.w / 2, e.y + e.h / 2, 12, e.x + e.w / 2, e.y + e.h / 2, 48);
      halo.addColorStop(0, `rgba(100,255,220,${0.35 * pulse})`);
      halo.addColorStop(1, 'rgba(60,180,150,0)');
      c.fillStyle = halo; c.beginPath(); c.arc(e.x + e.w / 2, e.y + e.h / 2, 48, 0, Math.PI * 2); c.fill();
    }
    const portalGlow = c.createRadialGradient(e.x + e.w / 2, e.y + e.h / 2, 5, e.x + e.w / 2, e.y + e.h / 2, 36);
    if (unlocked) {
      portalGlow.addColorStop(0, '#c8ffef'); portalGlow.addColorStop(0.4, '#3dd3a0'); portalGlow.addColorStop(0.7, '#1a8a6a'); portalGlow.addColorStop(1, '#0e3835');
    } else {
      portalGlow.addColorStop(0, '#ffe8a8'); portalGlow.addColorStop(0.6, '#94713d'); portalGlow.addColorStop(1, '#3c3020');
    }
    c.fillStyle = portalGlow;
    c.beginPath(); c.roundRect(e.x + 8, e.y + 6, e.w - 16, e.h - 10, 16); c.fill();
    // sparkles inside open portal
    if (unlocked && !reduced) {
      c.fillStyle = `rgba(255,255,255,${0.7 + Math.sin(s.tick * 0.15) * 0.2})`;
      for (let pi = 0; pi < 3; pi++) {
        const px = e.x + 16 + (pi * 18 + s.tick * 0.5) % (e.w - 32);
        const py = e.y + 16 + Math.sin(s.tick * 0.08 + pi) * 8;
        c.beginPath(); c.arc(px, py, 1, 0, Math.PI * 2); c.fill();
      }
    }
    // lock icon when locked
    c.fillStyle = unlocked ? '#baffed' : '#ffe2a1';
    c.font = 'bold 9px sans-serif'; c.textAlign = 'center';
    if (unlocked && !reduced) c.fillText('✦ مفتوحة ✦', e.x + 35, e.y - 18, 132);
    else c.fillText(unlocked ? 'بوابة مفتوحة' : '🔒 3 بلورات + تعدين', e.x + 35, e.y - 18, 132);
    // keyhole when locked
    if (!unlocked) {
      c.fillStyle = '#2d2410'; c.beginPath(); c.arc(e.x + 35, e.y + 38, 5, 0, Math.PI * 2); c.fill();
      c.fillRect(e.x + 33, 42 + e.y, 4, 8);
    }

    // ---- Projectiles ----
    if (s.projectiles) for (const proj of s.projectiles) drawProjectile(c, proj);

    // ---- Enemies ----
    if (s.enemies) for (const enemy of s.enemies) drawEnemy(c, enemy, s.tick, reduced);

    // ---- Hero ----
    drawHero(c, s.player, s.tick, reduced);

    // ---- Particles with glow ----
    for (const p of particles) {
      const alpha = Math.max(0, p.life / 30);
      c.globalAlpha = alpha;
      if (p.glow && !reduced) {
        c.shadowColor = p.color; c.shadowBlur = 6;
        round(c, p.x, p.y, p.size || 4, p.size || 4, 1, p.color);
        c.shadowBlur = 0;
      } else {
        round(c, p.x, p.y, p.size || 4, p.size || 4, 1, p.color);
      }
      // trail for skill particles
      if (p.trail && !reduced) {
        c.globalAlpha = alpha * 0.3;
        round(c, p.x - p.vx * 2, p.y - p.vy * 2, (p.size || 4) * 0.6, (p.size || 4) * 0.6, 1, p.color);
      }
    }
    c.globalAlpha = 1;

    c.restore();

    // ---- Screen effects ----
    // hurt vignette
    if (s.player.pose === 'hurt' && !reduced) {
      const flashAlpha = 0.12 + Math.sin(s.tick * 0.8) * 0.06;
      c.fillStyle = `rgba(255,60,60,${flashAlpha})`;
      c.fillRect(0, 0, w, 360);
      // vignette
      const hurtVign = c.createRadialGradient(w / 2, 180, w * 0.3, w / 2, 180, w * 0.9);
      hurtVign.addColorStop(0, 'transparent');
      hurtVign.addColorStop(1, 'rgba(180,30,30,0.35)');
      c.fillStyle = hurtVign; c.fillRect(0, 0, w, 360);
    }

    // low health pulse
    if (s.player.hearts === 1 && s.player.pose !== 'hurt' && s.player.pose !== 'dead' && !reduced) {
      const pulse = 0.04 + Math.sin(s.tick * 0.18) * 0.03;
      c.fillStyle = `rgba(220,40,40,${pulse})`;
      c.fillRect(0, 0, w, 360);
    }

    // invulnerability shimmer on hero is handled in drawHero
  }

  root.PlatformRenderer = { draw, crystal, drawHero, drawEnemy };
})(typeof globalThis !== 'undefined' ? globalThis : this);
