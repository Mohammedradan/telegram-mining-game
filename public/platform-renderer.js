/* Professional cartoon 2D vector renderer. Shared canvas, zero external image/font dependencies. */
(function (root) {
  'use strict';
  const R = root.PlatformRules;

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

  function crystal(c, x, y, scale, color, glow = true) {
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    if (glow) {
      c.fillStyle = color + '22';
      c.beginPath();
      c.arc(0, 0, 18, 0, Math.PI * 2);
      c.fill();
    }
    // Main faceted crystal body
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, -12);
    c.lineTo(9, -4);
    c.lineTo(7, 9);
    c.lineTo(0, 13);
    c.lineTo(-8, 6);
    c.lineTo(-8, -4);
    c.closePath();
    c.fill();
    // Inner facet highlights
    c.fillStyle = '#ffffff88';
    c.beginPath();
    c.moveTo(0, -12);
    c.lineTo(2, 6);
    c.lineTo(-8, -4);
    c.closePath();
    c.fill();
    c.fillStyle = '#ffffffdd';
    c.beginPath();
    c.arc(-1, -6, 2, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  // Draw Arrow Projectile (Archer)
  function drawProjectile(c, proj) {
    c.save();
    c.translate(proj.x, proj.y);
    const angle = Math.atan2(proj.vy, proj.vx);
    c.rotate(angle);
    // Shaft
    round(c, -8, -1.5, 16, 3, 1, '#9b7145');
    // Arrowhead
    c.fillStyle = '#d5e2e8';
    c.beginPath();
    c.moveTo(10, 0);
    c.lineTo(6, -4);
    c.lineTo(6, 4);
    c.closePath();
    c.fill();
    // Fletching
    c.fillStyle = '#e8f0f2';
    c.beginPath();
    c.moveTo(-7, -4);
    c.lineTo(-4, 0);
    c.lineTo(-8, 0);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(-7, 4);
    c.lineTo(-4, 0);
    c.lineTo(-8, 0);
    c.closePath();
    c.fill();
    c.restore();
  }

  // Draw Enemies (Cave Goblin, Armored Beetle, Flying Bat)
  function drawEnemy(c, enemy, tick, reduced) {
    if (enemy.dead) return;
    c.save();
    c.translate(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2);
    c.scale(enemy.facing, 1);

    if (enemy.hurtCooldown > 0 && Math.floor(tick / 3) % 2 === 0) {
      c.globalAlpha = 0.55;
    }

    if (enemy.type === 'goblin') {
      // Cave Goblin / الغول الكهفي
      const walk = !reduced && Math.abs(enemy.vx) > 5 ? Math.sin(tick * 0.3) * 4 : 0;
      // Shadow
      c.fillStyle = '#00000044';
      c.beginPath();
      c.ellipse(0, 15, 14, 4, 0, 0, Math.PI * 2);
      c.fill();
      // Legs
      round(c, -8, 7 + walk, 6, 9, 2, '#483526');
      round(c, 2, 7 - walk, 6, 9, 2, '#483526');
      // Body (ragged green/slate tunic)
      round(c, -9, -5, 18, 14, 4, '#5b7553');
      round(c, -4, 3, 8, 4, 1, '#866442'); // belt
      // Head
      round(c, -11, -19, 22, 16, 7, '#6f9264');
      // Pointed ears
      c.fillStyle = '#6f9264';
      c.beginPath();
      c.moveTo(-11, -13); c.lineTo(-19, -16); c.lineTo(-11, -8); c.closePath(); c.fill();
      c.beginPath();
      c.moveTo(11, -13); c.lineTo(19, -16); c.lineTo(11, -8); c.closePath(); c.fill();
      // Horned cap / leather helmet
      round(c, -11, -21, 22, 6, 3, '#74563a');
      c.fillStyle = '#dfcf98';
      c.beginPath(); c.moveTo(-7, -21); c.lineTo(-9, -27); c.lineTo(-3, -21); c.fill();
      c.beginPath(); c.moveTo(7, -21); c.lineTo(9, -27); c.lineTo(3, -21); c.fill();
      // Eyes (Glowing yellow with alert pupil)
      c.fillStyle = enemy.alert ? '#ff3b30' : '#ffe14a';
      c.beginPath(); c.arc(3, -13, 3, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1e241c';
      c.beginPath(); c.arc(4, -13, 1.2, 0, Math.PI * 2); c.fill();
      // Spiked club / weapon
      c.save();
      c.translate(8, 0);
      c.rotate(enemy.alert ? -0.5 : 0.3 + walk * 0.05);
      round(c, -2, -14, 5, 20, 2, '#5d4128');
      round(c, -4, -18, 9, 8, 3, '#433120');
      c.fillStyle = '#b6bec2';
      c.beginPath(); c.moveTo(-4, -15); c.lineTo(-8, -15); c.lineTo(-4, -12); c.fill();
      c.beginPath(); c.moveTo(5, -15); c.lineTo(9, -15); c.lineTo(5, -12); c.fill();
      c.restore();

      // Alert exclamation icon
      if (enemy.alert) {
        c.fillStyle = '#ff3b30';
        c.font = 'bold 12px sans-serif';
        c.textAlign = 'center';
        c.fillText('!', 0, -26);
      }
    } else if (enemy.type === 'beetle') {
      // Armored Beetle / الخنفساء المدرعة
      const scurry = !reduced ? Math.sin(tick * 0.4) * 3 : 0;
      // Shadow
      c.fillStyle = '#00000044';
      c.beginPath();
      c.ellipse(0, 11, 16, 4, 0, 0, Math.PI * 2);
      c.fill();
      // Legs (3 pairs)
      c.strokeStyle = '#2b2118';
      c.lineWidth = 2;
      for (const lx of [-9, 0, 9]) {
        c.beginPath();
        c.moveTo(lx, 4);
        c.lineTo(lx - 4, 11 + (lx === 0 ? scurry : -scurry));
        c.stroke();
      }
      // Carapace (armored shell)
      round(c, -13, -8, 26, 17, 8, '#6a4731');
      round(c, -11, -6, 22, 13, 6, '#8e5e3f');
      // Shell dorsal line
      c.strokeStyle = '#432c1b';
      c.beginPath(); c.moveTo(-11, 0); c.lineTo(11, 0); c.stroke();
      // Spikes on shell
      c.fillStyle = '#2d1e13';
      c.beginPath(); c.moveTo(-4, -8); c.lineTo(-2, -13); c.lineTo(0, -8); c.fill();
      c.beginPath(); c.moveTo(4, -8); c.lineTo(6, -13); c.lineTo(8, -8); c.fill();
      // Head & Mandibles
      round(c, 8, -4, 8, 10, 3, '#432c1b');
      c.fillStyle = '#e5ab52';
      c.beginPath(); c.arc(12, -2, 2, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#2d1e13';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(15, -2); c.lineTo(19, -5); c.stroke();
      c.beginPath(); c.moveTo(15, 2); c.lineTo(19, 5); c.stroke();
    } else if (enemy.type === 'bat') {
      // Cave Bat / الخفاش الكهفي
      const flap = !reduced ? Math.sin(tick * 0.28) : 0;
      // Body
      round(c, -6, -6, 12, 14, 5, '#3b2f4a');
      // Big pointed ears
      c.fillStyle = '#544369';
      c.beginPath(); c.moveTo(-5, -6); c.lineTo(-8, -14); c.lineTo(-2, -6); c.fill();
      c.beginPath(); c.moveTo(5, -6); c.lineTo(8, -14); c.lineTo(2, -6); c.fill();
      // Red glowing eyes & fangs
      c.fillStyle = '#ff3344';
      c.beginPath(); c.arc(-2, -2, 2, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(2, -2, 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath(); c.moveTo(-2, 3); c.lineTo(-1, 6); c.lineTo(0, 3); c.fill();
      c.beginPath(); c.moveTo(1, 3); c.lineTo(2, 6); c.lineTo(3, 3); c.fill();
      // Leathery wings
      c.fillStyle = '#4f3e63';
      // Left wing
      c.beginPath();
      c.moveTo(-5, -2);
      c.lineTo(-20, -10 + flap * 8);
      c.lineTo(-14, 4 + flap * 4);
      c.lineTo(-6, 2);
      c.closePath();
      c.fill();
      // Right wing
      c.beginPath();
      c.moveTo(5, -2);
      c.lineTo(20, -10 + flap * 8);
      c.lineTo(14, 4 + flap * 4);
      c.lineTo(6, 2);
      c.closePath();
      c.fill();
    }

    // Overhead Health Bar
    if (enemy.hp < enemy.maxHp) {
      const barW = 24, barH = 4;
      round(c, -barW / 2, -enemy.h / 2 - 8, barW, barH, 2, '#202428');
      const healthW = Math.max(0, (enemy.hp / enemy.maxHp) * barW);
      round(c, -barW / 2, -enemy.h / 2 - 8, healthW, barH, 2, enemy.hp === 1 ? '#ff4d4d' : '#55dd66');
    }
    c.restore();
  }

  // Draw Heroes (Miner Fighter, Warrior, Archer)
  function drawHero(c, p, tick, reduced) {
    const heroId = p.hero || 'miner';
    const phase = p.pose === 'run' && !reduced ? Math.sin(tick * 0.28) * 6 : 0;
    c.save();
    c.translate(p.x + 12, p.y + 20);
    c.scale(p.facing, 1);

    if (p.invulnerable && Math.floor(tick / 4) % 2 === 0) {
      c.globalAlpha = 0.45;
    }
    if (p.pose === 'hurt') c.rotate(-0.15);
    if (p.pose === 'dead') {
      c.rotate(1.57); // knock down
      c.translate(0, 10);
    }
    if (p.pose === 'land') {
      c.scale(1.15, 0.85); // landing squash
    }

    // Shadow on ground
    if (p.grounded && p.pose !== 'dead') {
      c.fillStyle = '#00000044';
      c.beginPath();
      c.ellipse(0, 19, 18, 5, 0, 0, Math.PI * 2);
      c.fill();
    }

    if (heroId === 'miner') {
      // ⛏️ Miner Fighter
      // Boots & Legs
      round(c, -11, 4 + phase / 3, 9, 15, 3, '#2a3c4f');
      round(c, 3, 4 - phase / 3, 9, 15, 3, '#2a3c4f');
      round(c, -13 + phase / 3, 15, 13, 6, 3, '#3b2f2d');
      round(c, 2 - phase / 3, 15, 14, 6, 3, '#3b2f2d');
      // Overalls & Shirt
      round(c, -13, -7, 26, 19, 6, '#3e7f9e');
      round(c, -10, -8, 5, 19, 2, '#7ec2ce');
      round(c, 5, -8, 5, 19, 2, '#7ec2ce');
      round(c, -4, 1, 8, 6, 2, '#d69e45'); // belt buckle
      // Head & Face
      round(c, -14, -27, 28, 25, 9, '#f2be94');
      round(c, -13, -8, 26, 8, 3, '#c96839');
      // Thick beard
      round(c, -6, -9, 20, 9, 4, '#8a4e28');
      round(c, 4, -8, 7, 3, 1, '#ffdcb0');
      // Helmet with brim
      round(c, -17, -34, 34, 14, 7, '#e8b248');
      round(c, -19, -23, 40, 5, 2, '#ffd785');
      // Brass headlamp
      round(c, -4, -34, 10, 11, 3, '#9d682b');
      round(c, 1, -31, 9, 9, 4, '#fff7c7');
      // Dynamic light cone from headlamp
      if (!reduced && p.pose !== 'dead') {
        const beam = c.createRadialGradient(8, -27, 2, 110, -27, 120);
        beam.addColorStop(0, 'rgba(255, 245, 190, 0.45)');
        beam.addColorStop(1, 'rgba(255, 245, 190, 0.0)');
        c.fillStyle = beam;
        c.beginPath();
        c.moveTo(8, -27);
        c.lineTo(130, -70);
        c.lineTo(130, 25);
        c.closePath();
        c.fill();
      }
      // Eyes & Expression
      c.fillStyle = '#222831';
      c.beginPath(); c.arc(4, -17, 2, 0, Math.PI * 2); c.fill();
      round(c, 11, -15, 6, 6, 3, '#f9d2aa'); // nose

      // Pickaxe / Weapon Arm
      c.save();
      c.translate(12, -4);
      let swingAngle = 0.3;
      if (p.pose === 'mine') swingAngle = -1.7 + (14 - p.attack) * 0.22;
      else if (p.pose === 'attack') swingAngle = -1.3 + (14 - p.attack) * 0.25;
      else if (p.pose === 'victory') swingAngle = -2.1;
      c.rotate(swingAngle);
      round(c, -2, -3, 7, 17, 3, '#f2be94'); // arm
      round(c, 1, -17, 4, 30, 1, '#a6723f'); // handle
      // Pickaxe blade
      c.strokeStyle = '#c6ede5';
      c.lineWidth = 6;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-9, -15);
      c.quadraticCurveTo(2, -24, 17, -16);
      c.stroke();
      // Attack slash visual arc
      if (p.pose === 'attack' && p.attack > 6 && !reduced) {
        c.strokeStyle = '#ffeaa7cc';
        c.lineWidth = 4;
        c.beginPath();
        c.arc(2, -17, 24, -1.2, 0.8);
        c.stroke();
      }
      c.restore();

      // Back arm
      round(c, -17, -5 - phase / 3, 7, 13, 3, '#f2be94');
    } else if (heroId === 'warrior') {
      // ⚔️ Warrior
      // Boots & Greaves
      round(c, -11, 4 + phase / 3, 9, 15, 3, '#34495e');
      round(c, 3, 4 - phase / 3, 9, 15, 3, '#34495e');
      round(c, -13 + phase / 3, 15, 13, 6, 3, '#1c2833');
      round(c, 2 - phase / 3, 15, 14, 6, 3, '#1c2833');
      // Breastplate & Tunic
      round(c, -13, -7, 26, 19, 6, '#5dade2');
      round(c, -11, -8, 22, 16, 5, '#a6acaf'); // steel plate
      round(c, -4, 1, 8, 6, 2, '#f4d03f'); // gold clasp
      // Knight Helmet
      round(c, -14, -27, 28, 25, 9, '#f2be94');
      round(c, -16, -34, 32, 18, 7, '#95a5a6');
      round(c, -17, -22, 34, 5, 2, '#7f8c8d');
      // Red Feather Crest / Plume
      c.fillStyle = '#e74c3c';
      c.beginPath();
      c.moveTo(-8, -34);
      c.quadraticCurveTo(-14, -46, -4, -44);
      c.quadraticCurveTo(8, -42, 6, -34);
      c.closePath();
      c.fill();
      // Visor slit
      round(c, 0, -21, 9, 4, 1, '#1b2631');

      // Broadsword / Weapon Arm
      c.save();
      c.translate(12, -4);
      let swingAngle = 0.2;
      if (p.pose === 'attack') swingAngle = -1.5 + (14 - p.attack) * 0.26;
      else if (p.pose === 'victory') swingAngle = -2.2;
      c.rotate(swingAngle);
      round(c, -2, -3, 7, 17, 3, '#f2be94'); // arm
      round(c, 1, -10, 4, 14, 1, '#784212'); // hilt
      round(c, -5, -11, 16, 4, 1, '#f1c40f'); // crossguard
      // Sword blade
      c.fillStyle = '#ecf0f1';
      c.beginPath();
      c.moveTo(1, -11);
      c.lineTo(1, -38);
      c.lineTo(3, -42);
      c.lineTo(5, -38);
      c.lineTo(5, -11);
      c.closePath();
      c.fill();
      // Blue slash arc
      if (p.pose === 'attack' && p.attack > 6 && !reduced) {
        c.strokeStyle = '#5dade2cc';
        c.lineWidth = 5;
        c.beginPath();
        c.arc(3, -25, 32, -1.4, 0.9);
        c.stroke();
      }
      c.restore();

      // Shield on back arm
      round(c, -16, -5 - phase / 3, 10, 16, 5, '#2980b9');
      strokeRound(c, -16, -5 - phase / 3, 10, 16, 5, '#f4d03f', 2);
    } else if (heroId === 'archer') {
      // 🏹 Archer / Ranger
      // Boots
      round(c, -11, 4 + phase / 3, 9, 15, 3, '#27ae60');
      round(c, 3, 4 - phase / 3, 9, 15, 3, '#27ae60');
      round(c, -13 + phase / 3, 15, 13, 6, 3, '#4a235a');
      round(c, 2 - phase / 3, 15, 14, 6, 3, '#4a235a');
      // Ranger Tunic
      round(c, -13, -7, 26, 19, 6, '#2ecc71');
      round(c, -11, -8, 22, 16, 5, '#27ae60');
      round(c, -4, 1, 8, 6, 2, '#d4ac0d');
      // Green Hood & Face
      round(c, -14, -27, 28, 25, 9, '#f2be94');
      round(c, -16, -34, 32, 18, 9, '#1e8449');
      round(c, -17, -22, 34, 6, 3, '#196f3d');
      // Eye & Brow
      c.fillStyle = '#1e241c';
      c.beginPath(); c.arc(4, -18, 2, 0, Math.PI * 2); c.fill();

      // Bow in hand
      c.save();
      c.translate(14, -2);
      let bowAngle = p.pose === 'attack' ? -0.2 : 0.3;
      c.rotate(bowAngle);
      round(c, -2, -3, 6, 15, 2, '#f2be94'); // arm
      // Wooden Bow curve
      c.strokeStyle = '#784212';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(5, 0, 18, -1.3, 1.3);
      c.stroke();
      // Bowstring
      c.strokeStyle = '#ecf0f1';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(5 + 18 * Math.cos(-1.3), 18 * Math.sin(-1.3));
      c.lineTo(p.pose === 'attack' ? -2 : 5 + 18 * Math.cos(0), 0);
      c.lineTo(5 + 18 * Math.cos(1.3), 18 * Math.sin(1.3));
      c.stroke();
      c.restore();

      // Quiver on back
      round(c, -17, -15, 6, 18, 2, '#784212');
      c.fillStyle = '#ecf0f1';
      c.fillRect(-17, -19, 2, 4);
      c.fillRect(-14, -20, 2, 5);
    }

    c.restore();
  }

  function draw(canvas, s, { reduced = false, particles = [] } = {}) {
    const c = canvas.getContext('2d');
    const cssW = canvas.clientWidth || 480, cssH = canvas.clientHeight || 300;
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    const pixelW = Math.round(cssW * dpr), pixelH = Math.round(cssH * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) { canvas.width = pixelW; canvas.height = pixelH; }
    const worldH = 360, w = Math.max(280, cssW * worldH / cssH);
    const scale = pixelW / w;
    c.setTransform(scale, 0, 0, pixelH / worldH, 0, 0);

    const camera = R.cameraFor(s, w);

    // Deep Cavern Background Gradient
    const zone = R.ZONES[s.zone || 0] || R.ZONES[0];
    const bg = c.createLinearGradient(0, 0, 0, 360);
    bg.addColorStop(0, zone.sky[0]);
    bg.addColorStop(0.5, zone.sky[1]);
    bg.addColorStop(1, zone.sky[2]);
    c.fillStyle = bg;
    c.fillRect(0, 0, w, 360);

    // 3 Parallax Cavern Layers
    // Layer 0: Distant stalactites and cavern silhouettes
    const shift0 = camera * 0.12;
    c.fillStyle = zone.far;
    for (let i = Math.floor(shift0 / 200) - 1; i < Math.ceil((shift0 + w) / 200) + 1; i++) {
      const x = i * 200 - shift0;
      c.beginPath();
      c.moveTo(x - 50, 0);
      c.lineTo(x + 20, 70 + (i % 4) * 20);
      c.lineTo(x + 90, 0);
      c.fill();
    }

    // Layer 1: Mid-distance cavern rock columns & arches
    const shift1 = camera * 0.32;
    c.fillStyle = zone.mid;
    for (let i = Math.floor(shift1 / 180) - 1; i < Math.ceil((shift1 + w) / 180) + 1; i++) {
      const x = i * 180 - shift1;
      c.beginPath();
      c.moveTo(x - 60, 340);
      c.lineTo(x - 20, 110 + (i % 3) * 25);
      c.lineTo(x + 35, 75 + (i % 2) * 35);
      c.lineTo(x + 90, 175);
      c.lineTo(x + 155, 340);
      c.fill();
    }

    // Layer 2: Near cavern supports, rails, and glowing mushrooms
    const shift2 = camera * 0.55;
    for (let i = Math.floor(shift2 / 240) - 1; i < Math.ceil((shift2 + w) / 240) + 1; i++) {
      const x = i * 240 - shift2;
      round(c, x + 15, 50, 12, 260, 3, '#2a353d');
      round(c, x - 30, 48, 180, 12, 3, '#3e4952');
      // Glowing green/cyan cave mushroom
      c.fillStyle = zone.glow;
      c.beginPath();
      c.arc(x + 80, 295, 6, Math.PI, 0);
      c.fill();
      round(c, x + 79, 295, 2, 8, 1, '#8deed2');
    }

    c.save();
    c.translate(-camera, 0);

    // Cavern props: Wooden support beams & lanterns
    for (let x = Math.floor(camera / 220) * 220; x < camera + w + 220; x += 220) {
      round(c, x + 20, 70, 12, 230, 3, '#4a3b30');
      round(c, x - 20, 68, 170, 13, 3, '#624e3c');
      c.strokeStyle = '#7f634b';
      c.lineWidth = 6;
      c.beginPath(); c.moveTo(x + 30, 110); c.lineTo(x + 72, 80); c.stroke();
      // Stalactite
      c.fillStyle = '#10222f';
      c.beginPath(); c.moveTo(x + 96, 0); c.lineTo(x + 111, 48); c.lineTo(x + 125, 0); c.fill();
      // Ambient crystal
      crystal(c, x + 155, 287, 0.65, '#39a9a4', false);
      // Warm oil lantern with glowing radial halo
      const pulse = reduced ? 1 : 0.85 + Math.sin(s.tick * 0.12 + x) * 0.15;
      const lanternGlow = c.createRadialGradient(x + 35, 125, 4, x + 35, 125, 60);
      lanternGlow.addColorStop(0, `rgba(255, 205, 110, ${0.45 * pulse})`);
      lanternGlow.addColorStop(1, 'rgba(255, 190, 80, 0)');
      c.fillStyle = lanternGlow;
      c.beginPath(); c.arc(x + 35, 125, 60, 0, Math.PI * 2); c.fill();
      round(c, x + 30, 119, 10, 25, 2, '#312726');
      round(c, x + 29, 116, 12, 16, 5, '#ffc76d');
    }

    // Hot underground lava river with glowing bubbles
    round(c, 0, 328, R.LEVEL.width, 32, 0, '#cc472b');
    round(c, 0, 332, R.LEVEL.width, 28, 0, '#ea6231');
    round(c, 0, 342, R.LEVEL.width, 18, 0, '#ffd152');

    // Stone platforms
    for (const box of R.LEVEL.platforms) {
      if (box.x + box.w < camera || box.x > camera + w) continue;
      // Main rock body
      round(c, box.x, box.y, box.w, box.h, 4, '#4c443c');
      // Mossy/crystal trim on top
      round(c, box.x, box.y, box.w, 9, 3, '#a58253');
      round(c, box.x, box.y + 2, box.w, 3, 1, '#d8b27c');
      // Stone strata texture cracks
      c.strokeStyle = '#322c27';
      c.lineWidth = 2;
      for (let x = Math.max(box.x, Math.floor(camera / 36) * 36); x < Math.min(box.x + box.w, camera + w); x += 36) {
        c.beginPath(); c.moveTo(x, box.y + 11); c.lineTo(x + 13, box.y + 28); c.lineTo(x + 4, box.y + 44); c.stroke();
      }
      // Structural pillars for elevated platforms
      if (box.h < 25) {
        round(c, box.x + 8, box.y + 17, 8, 26, 2, '#7a5e3e');
        round(c, box.x + box.w - 16, box.y + 17, 8, 26, 2, '#7a5e3e');
      }
    }

    // Rocks / Mining nodes (3 HP stages)
    for (const rock of s.rocks) {
      if (rock.hp > 0 && rock.x > camera - 60 && rock.x < camera + w) {
        const rockColor = rock.hp === 3 ? '#5b6e6c' : rock.hp === 2 ? '#4d5d5b' : '#3d4b49';
        round(c, rock.x, rock.y, rock.w, rock.h, 10, rockColor);
        strokeRound(c, rock.x, rock.y, rock.w, rock.h, 10, '#8aa69b', 2);
        // Embedded crystal
        crystal(c, rock.x + 22, rock.y + 25, 0.75, '#56ebd3', true);
        // Stage cracks
        if (rock.hp < 3) {
          c.strokeStyle = '#ffd875';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(rock.x + 24, rock.y + 4);
          c.lineTo(rock.x + 16, rock.y + 18);
          c.lineTo(rock.x + 28, rock.y + 30);
          c.stroke();
        }
        if (rock.hp === 1) {
          c.strokeStyle = '#ff9955';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(rock.x + 35, rock.y + 10);
          c.lineTo(rock.x + 26, rock.y + 25);
          c.lineTo(rock.x + 36, rock.y + 42);
          c.stroke();
        }
      }
    }

    // Collectible Gems
    for (const gem of s.gems) {
      if (!gem.taken && gem.x > camera - 20 && gem.x < camera + w) {
        const bob = reduced ? 0 : Math.sin(s.tick * 0.08 + gem.x) * 3;
        crystal(c, gem.x, gem.y + bob, 0.78, '#5cf3d2', true);
      }
    }

    // Hazards (Steam vents & Spikes)
    for (const h of R.LEVEL.hazards) {
      if (h.x < camera - 70 || h.x > camera + w) continue;
      const active = R.activeHazard(h, s.tick);
      round(c, h.x - 5, 294, h.w + 10, 6, 2, '#382a2a');
      c.fillStyle = active ? '#ff6f43' : '#697f82';
      for (let i = 0; i < h.w; i += 12) {
        c.beginPath();
        c.moveTo(h.x + i, 297);
        c.lineTo(h.x + i + 6, active ? h.y : 291);
        c.lineTo(h.x + i + 12, 297);
        c.fill();
      }
      // Steam Vent gauge & plume
      if (h.period > 1) {
        round(c, h.x - 4, 252, 50, 5, 2, '#21333a');
        round(c, h.x - 4, 252, 50 * ((s.tick % h.period) / h.period), 5, 2, active ? '#ff784e' : '#67d3bd');
        // Steam cloud when active
        if (active && !reduced) {
          c.fillStyle = 'rgba(255, 235, 220, 0.35)';
          c.beginPath();
          c.arc(h.x + h.w / 2, h.y - 10, 16, 0, Math.PI * 2);
          c.arc(h.x + h.w / 2 - 8, h.y - 24, 12, 0, Math.PI * 2);
          c.arc(h.x + h.w / 2 + 8, h.y - 22, 14, 0, Math.PI * 2);
          c.fill();
        }
      }
    }

    // Signposts and Checkpoint Pennants
    for (const x of [680, 1485, 2030]) {
      round(c, x, 267, 4, 33, 1, '#9b7e4e');
      round(c, x - 14, 253, 37, 20, 3, '#af8d55');
      c.fillStyle = '#2f2726';
      c.font = 'bold 14px sans-serif';
      c.textAlign = 'center';
      c.fillText('↑', x + 4, 269);
    }
    for (const x of [920, 1710]) {
      round(c, x, 255, 3, 45, 1, '#9bbab2');
      const active = s.checkpoint === x;
      c.fillStyle = active ? '#55f0c4' : '#658588';
      c.beginPath();
      c.moveTo(x + 3, 256);
      c.lineTo(x + 30, 263);
      c.lineTo(x + 3, 276);
      c.fill();
    }

    // Grand Mine Exit Archway
    const e = R.LEVEL.exit;
    round(c, e.x - 10, e.y - 12, e.w + 20, e.h + 16, 26, '#a4814d');
    round(c, e.x, e.y, e.w, e.h, 20, '#10343a');
    // Portal communicates its locked/open state in the world, not only in the HUD.
    const unlocked = R.canExit(s);
    const portalGlow = c.createRadialGradient(e.x + e.w / 2, e.y + e.h / 2, 5, e.x + e.w / 2, e.y + e.h / 2, 35);
    portalGlow.addColorStop(0, unlocked ? '#a5ffe9' : '#ffd989');
    portalGlow.addColorStop(0.7, unlocked ? '#249080' : '#94713d');
    portalGlow.addColorStop(1, unlocked ? '#0e3835' : '#3c3020');
    c.fillStyle = portalGlow;
    c.beginPath();
    c.roundRect(e.x + 8, e.y + 6, e.w - 16, e.h - 10, 16);
    c.fill();
    c.fillStyle = unlocked ? '#baffed' : '#ffe2a1';
    c.font = 'bold 11px sans-serif';
    c.textAlign = 'center';
    c.fillText(unlocked ? 'بوابة مفتوحة' : 'مقفلة · 3 بلورات + تعدين', e.x + 35, e.y - 18, 132);

    // Draw Projectiles (Arrows)
    if (s.projectiles) {
      for (const proj of s.projectiles) drawProjectile(c, proj);
    }

    // Draw Enemies
    if (s.enemies) {
      for (const enemy of s.enemies) drawEnemy(c, enemy, s.tick, reduced);
    }

    // Draw Hero (Main Character)
    drawHero(c, s.player, s.tick, reduced);

    // Draw Particles
    for (const p of particles) {
      c.globalAlpha = Math.max(0, p.life / 30);
      round(c, p.x, p.y, p.size || 4, p.size || 4, 1, p.color);
    }
    c.globalAlpha = 1;

    c.restore();

    // Hurt screen flash
    if (s.player.pose === 'hurt' && !reduced) {
      c.fillStyle = '#e74c3c33';
      c.fillRect(0, 0, w, 360);
    }
  }

  root.PlatformRenderer = { draw, crystal, drawHero, drawEnemy };
})(typeof globalThis !== 'undefined' ? globalThis : this);
