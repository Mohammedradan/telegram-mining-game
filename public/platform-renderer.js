/* Original vector art, drawn locally. Rendering is not part of authoritative physics. */
(function (root) {
  'use strict';
  const defaultRules = root.PlatformRules;
  const round = (c, x, y, w, h, r, color) => { c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };
  function crystal(c, x, y, scale, color) {
    c.save(); c.translate(x, y); c.scale(scale, scale); c.fillStyle = color;
    c.beginPath(); c.moveTo(0, -11); c.lineTo(8, -3); c.lineTo(6, 8); c.lineTo(0, 12); c.lineTo(-7, 5); c.lineTo(-7, -4); c.closePath(); c.fill();
    c.fillStyle = '#d6fff3'; c.beginPath(); c.moveTo(0, -11); c.lineTo(1, 6); c.lineTo(-7, -4); c.closePath(); c.fill(); c.restore();
  }
  function miner(c, p, tick, reduced) {
    const phase = p.pose === 'run' && !reduced ? Math.sin(tick * .27) * 6 : 0;
    const airborne = p.pose === 'jump' || p.pose === 'fall';
    c.save(); c.translate(p.x + 12, p.y + 20 + (p.pose === 'idle' && !reduced ? Math.sin(tick * .06) * .7 : 0)); c.scale(p.facing, 1);
    if (!reduced && p.invulnerable && tick % 10 < 4) c.globalAlpha = .45;
    if (p.pose === 'hurt') c.rotate(-.12);
    c.fillStyle = '#0005'; c.beginPath(); c.ellipse(0, 19, 18, 5, 0, 0, Math.PI * 2); c.fill();
    round(c, -11, (airborne ? 0 : 3) + phase / 3, 9, 15, 3, '#253b51'); round(c, 3, (airborne ? -3 : 3) - phase / 3, 9, 15, 3, '#253b51');
    round(c, -13 + phase / 3, 14, 13, 6, 3, '#392d2e'); round(c, 2 - phase / 3, 14, 14, 6, 3, '#392d2e');
    round(c, -13, -7, 26, 19, 7, '#4c93b5'); round(c, -10, -8, 5, 19, 2, '#90c7d0'); round(c, 5, -8, 5, 19, 2, '#90c7d0');
    round(c, -4, 1, 8, 6, 2, '#f0c064');
    round(c, -14, -27, 29, 26, 10, '#efb888'); round(c, -13, -8, 27, 7, 3, '#d97843');
    // Helmet, headlamp, face, nose and beard are geometry, not an emoji/single image.
    round(c, -17, -34, 33, 14, 7, '#eab85a'); round(c, -19, -23, 39, 5, 2, '#ffe3a0');
    round(c, -5, -34, 9, 12, 3, '#aa743b'); round(c, 0, -31, 9, 9, 4, '#fff3c1');
    round(c, 3, -17, 3, 4, 1, '#28343b'); round(c, 12, -15, 6, 6, 3, '#f7cca0');
    round(c, -5, -8, 19, 7, 4, '#7f513a'); round(c, 4, -7, 7, 2, 1, '#ffe0b3');
    c.save(); c.translate(12, -4);
    c.rotate(p.pose === 'mine' ? -1.6 + (14 - p.attack) * .18 : p.pose === 'victory' ? -2 : p.pose === 'jump' ? -.7 : p.pose === 'fall' ? .8 : .3);
    round(c, -2, -3, 7, 17, 3, '#f1ba87');
    round(c, 1, -15, 4, 28, 1, '#bb8853');
    c.strokeStyle = '#bce2dc'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(-8, -13); c.quadraticCurveTo(2, -22, 16, -14); c.stroke(); c.restore();
    round(c, -17, -5 - phase / 3, 7, 13, 3, '#f1ba87'); c.restore();
  }
  function guardian(c, e, tick, reduced) {
    const boss = e.kind === 'boss', color = boss ? '#af8a70' : '#73968f';
    const warning = e.phase === 'windup', strike = e.phase === 'strike';
    c.save(); c.translate(e.x, e.y);
    const bob = reduced ? 0 : Math.sin(tick * .09) * 1.3;
    c.strokeStyle = '#364f54'; c.lineWidth = boss ? 6 : 4; c.lineCap = 'round';
    for (const x of [4, e.w - 5]) for (const y of [e.h - 10, e.h - 4]) {
      c.beginPath(); c.moveTo(x, y); c.lineTo(x < 10 ? -8 : e.w + 8, y + 8 + bob); c.stroke();
    }
    round(c, 0, bob + 3, e.w, e.h - 5, boss ? 14 : 9, color);
    round(c, 5, bob + 6, e.w - 10, 8, 4, boss ? '#d9b080' : '#aac4b5');
    crystal(c, e.w / 2, bob + 5, boss ? .9 : .55, boss ? '#ffd578' : '#95f3d2');
    for (const x of [e.w * .3, e.w * .7]) { round(c, x - 3, e.h * .55, 7, 8, 3, '#213d48'); round(c, x - 1, e.h * .55, 3, 3, 1, '#fff5ce'); }
    const arm = e.facing < 0 ? -12 : e.w + 7;
    round(c, arm - (strike ? 8 : 0), warning ? 2 : 15, strike ? 25 : 14, 12, 5, warning || strike ? '#ffbd78' : color);
    round(c, 0, -14, e.w, 4, 2, '#25353f'); round(c, 0, -14, e.w * e.hp / (boss ? 6 : 3), 4, 2, '#8de0bc');
    c.fillStyle = '#ffe5a7'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center';
    if (warning) c.fillText('!', e.w / 2, -23);
    else if (boss) { c.font = 'bold 10px sans-serif'; c.fillText('حارس العقيق · اختياري', e.w / 2, -23); }
    c.restore();
  }
  function draw(canvas, s, { reduced = false, particles = [], rules = defaultRules } = {}) {
    const R = rules;
    const c = canvas.getContext('2d');
    const cssW = canvas.clientWidth || 480, cssH = canvas.clientHeight || 300;
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    const pixelW = Math.round(cssW * dpr), pixelH = Math.round(cssH * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) { canvas.width = pixelW; canvas.height = pixelH; }
    // Keep the miner readable on short/landscape screens instead of shrinking the
    // whole 360px cave to a miniature. Vertical follow keeps raised ledges visible.
    const viewH = cssH < 210 ? 220 : 360;
    const w = cssW * viewH / cssH, scale = pixelW / w;
    const cameraY = Math.max(0, Math.min(360 - viewH, s.player.y + s.player.h / 2 - viewH * .30));
    c.setTransform(scale, 0, 0, pixelH / viewH, 0, -cameraY * pixelH / viewH);
    const camera = R.cameraFor(s, w);
    const bg = c.createLinearGradient(0, 0, 0, 360); bg.addColorStop(0, '#0d1b28'); bg.addColorStop(1, '#214049'); c.fillStyle = bg; c.fillRect(0, 0, w, 360);
    // Two parallax cavern layers; draw only the visible part of each layer.
    for (let layer = 0; layer < 2; layer++) {
      const factor = reduced ? 0 : layer ? .45 : .18;
      const shift = camera * factor;
      c.fillStyle = layer ? '#254550' : '#182f3d';
      for (let i = Math.floor(shift / 180) - 1; i < Math.ceil((shift + w) / 180) + 1; i++) {
        const x = i * 180 - shift;
        c.beginPath(); c.moveTo(x - 60, 325); c.lineTo(x - 25, 115 + (i % 3) * 30); c.lineTo(x + 30, 70 + (i % 2) * 40); c.lineTo(x + 85, 180); c.lineTo(x + 155, 325); c.fill();
      }
    }
    c.save(); c.translate(-camera, 0);
    for (let x = Math.floor(camera / 220) * 220; x < camera + w + 220; x += 220) {
      round(c, x + 20, 70, 12, 230, 3, '#473c35'); round(c, x - 20, 68, 170, 13, 3, '#64513d');
      c.strokeStyle = '#806346'; c.lineWidth = 6; c.beginPath(); c.moveTo(x + 30, 110); c.lineTo(x + 72, 80); c.stroke();
      c.fillStyle = '#0b1824'; c.beginPath(); c.moveTo(x + 96, 0); c.lineTo(x + 111, 48); c.lineTo(x + 125, 0); c.fill();
      crystal(c, x + 155, 287, .6, '#4b9299');
      const pulse = reduced ? 1 : .85 + Math.sin(s.tick * .12 + x) * .15;
      c.fillStyle = `rgba(255,191,92,${.09 * pulse})`; c.beginPath(); c.arc(x + 35, 125, 55, 0, Math.PI * 2); c.fill();
      round(c, x + 30, 119, 10, 25, 2, '#302a2c'); round(c, x + 29, 116, 12, 16, 5, '#ffbf68');
    }
    // Hot underground river reveals gaps; never a hidden collision rectangle.
    round(c, 0, 330, R.LEVEL.width, 30, 0, '#ba4f32');
    for (const box of R.LEVEL.platforms) {
      if (box.x + box.w < camera || box.x > camera + w) continue;
      round(c, box.x, box.y, box.w, box.h, 3, '#534d46');
      round(c, box.x, box.y, box.w, 9, 3, '#b18d5d');
      c.strokeStyle = '#373e3d'; c.lineWidth = 2;
      for (let x = Math.max(box.x, Math.floor(camera / 36) * 36); x < Math.min(box.x + box.w, camera + w); x += 36) {
        c.beginPath(); c.moveTo(x, box.y + 10); c.lineTo(x + 12, box.y + 28); c.lineTo(x + 3, box.y + 43); c.stroke();
      }
      if (box.h < 25) { round(c, box.x + 8, box.y + 17, 8, 26, 2, '#7d6446'); round(c, box.x + box.w - 16, box.y + 17, 8, 26, 2, '#7d6446'); }
    }
    for (const rock of s.rocks) if (rock.hp > 0 && rock.x > camera - 60 && rock.x < camera + w) {
      round(c, rock.x, rock.y, rock.w, rock.h, 10, '#687d7b');
      c.strokeStyle = '#adc4b1'; c.lineWidth = 2; c.beginPath(); c.moveTo(rock.x + 6, rock.y + 15); c.lineTo(rock.x + 23, rock.y + 6); c.lineTo(rock.x + 35, rock.y + 25); c.stroke();
      for (let i = 0; i < 3; i++) round(c, rock.x + 8 + i * 11, rock.y - 9, 7, 4, 2, i < rock.hp ? '#b3f5cf' : '#405b5b');
      crystal(c, rock.x + 20, rock.y + 26, .7, '#66dbcb');
      if (rock.hp < 3) { c.strokeStyle = '#26383f'; c.beginPath(); c.moveTo(rock.x + 24, rock.y); c.lineTo(rock.x + 18, rock.y + 15); c.lineTo(rock.x + 28, rock.y + 32); c.lineTo(rock.x + 17, rock.y + 48); c.stroke(); }
    }
    for (const gem of s.gems) if (!gem.taken && gem.x > camera - 20 && gem.x < camera + w) crystal(c, gem.x, gem.y + (reduced ? 0 : Math.sin(s.tick * .07 + gem.x) * 2), .7, '#66f1cf');
    for (const h of R.LEVEL.hazards) {
      if (h.x < camera - 70 || h.x > camera + w) continue;
      const active = R.activeHazard(h, s.tick);
      round(c, h.x - 5, 294, h.w + 10, 6, 2, '#352b2d');
      c.fillStyle = active ? '#ff936c' : '#71898b';
      for (let i = 0; i < h.w; i += 12) {
        c.beginPath(); c.moveTo(h.x + i, 297); c.lineTo(h.x + i + 6, active ? h.y : 291); c.lineTo(h.x + i + 12, 297); c.fill();
      }
      if (h.period > 1) {
        round(c, h.x - 4, 252, 50, 5, 2, '#263c43'); round(c, h.x - 4, 252, 50 * ((s.tick % h.period) / h.period), 5, 2, active ? '#ed885c' : '#74cdbb');
      }
    }
    for (const enemy of s.enemies || []) {
      if (enemy.hp <= 0 || enemy.x < camera - 130 || enemy.x > camera + w + 130) continue;
      if (enemy.phase === 'windup' || enemy.phase === 'strike') {
        const area = R.enemyHitbox(enemy);
        round(c, area.x, area.y, area.w, area.h, 4, enemy.phase === 'strike' ? '#ffba7670' : '#ffba7625');
        c.strokeStyle = '#ffcb86'; c.lineWidth = 1; c.strokeRect(area.x, area.y, area.w, area.h);
      }
      guardian(c, enemy, s.tick, reduced);
    }
    // Visible signposts and checkpoint pennants.
    for (const x of [680, 1485, 2030]) { round(c, x, 267, 4, 33, 1, '#a18458'); round(c, x - 14, 253, 37, 20, 3, '#b2915e'); c.fillStyle = '#312d2d'; c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.fillText('↑', x + 4, 269); }
    for (const x of [920, 1710]) { round(c, x, 255, 3, 45, 1, '#a8c2b4'); c.fillStyle = s.checkpoint === x ? '#71e2bf' : '#719094'; c.beginPath(); c.moveTo(x + 3, 256); c.lineTo(x + 29, 262); c.lineTo(x + 3, 274); c.fill(); }
    const e = R.LEVEL.exit;
    round(c, e.x - 8, e.y - 9, e.w + 16, e.h + 12, 25, '#aa8755'); round(c, e.x, e.y, e.w, e.h, 20, '#153e43'); round(c, e.x + 9, e.y + 7, e.w - 18, e.h - 10, 16, '#498a7e');
    c.fillStyle = '#e7e9b7'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.fillText(s.mined >= 1 && s.collected >= 3 ? 'الخروج مفتوح' : '١ صخرة + ٣ بلورات', e.x + 35, e.y - 17);
    miner(c, s.player, s.tick, reduced);
    for (const p of particles) { c.globalAlpha = Math.max(0, p.life / 30); round(c, p.x, p.y, 4, 4, 1, p.color); } c.globalAlpha = 1;
    c.restore();
    if (s.player.pose === 'hurt' && !reduced) { c.fillStyle = '#f5796330'; c.fillRect(0, cameraY, w, viewH); }
  }
  root.PlatformRenderer = { draw };
})(typeof globalThis !== 'undefined' ? globalThis : this);
