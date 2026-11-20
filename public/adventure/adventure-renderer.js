/* Canvas renderer for the Stone Mine.
 *
 * Draws in world coordinates through the camera; nothing here reads or writes gameplay
 * state. The only images used are the ones the project already ships
 * (public/assets/cave/*), so the art direction stays consistent with the rest of the
 * game and no new asset can fail to load silently.
 *
 * Performance rules honoured here:
 *  - no DOM creation per frame (a scratch canvas is created once, on resize);
 *  - everything is culled against the camera viewport before it is drawn;
 *  - parallax layers are pre-rendered once into offscreen canvases, then blitted;
 *  - `prefers-reduced-motion` removes ambient motion but never removes gameplay cues.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdventureRenderer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ASSET = Object.freeze({
    hero: '/assets/cave/hero-sheet.webp?v=1',
    ore: '/assets/cave/ore-sheet.webp?v=1',
    rock: '/assets/cave/deep/rock-atlas.webp?v=1',
    rig: '/assets/cave/crew/rig.webp?v=1',
    caveWide: '/assets/cave/cave-wide.jpg?v=1',
    cavePortrait: '/assets/cave/cave-portrait.jpg?v=1',
    robot: '/assets/cave/icons/robot.webp?v=1',
    drill: '/assets/cave/icons/drill.webp?v=1',
  });

  // Hero sheet: 3 columns x 2 rows of 6 poses.
  const HERO_POSE = Object.freeze({
    idle: [0, 0], walkA: [1, 0], walkB: [2, 0],
    raise: [0, 1], strike: [1, 1], cheer: [2, 1],
  });
  // Ore sheet: 4 ore sprites in a row (copper, iron, gold, crystal by convention).
  const ORE_COL = Object.freeze({ copper: 0, iron: 1, gold: 2, crystal: 3 });

  const PALETTE = Object.freeze({
    skyTop: '#1a1140',
    skyMid: '#2a1a5e',
    skyDeep: '#0e0a26',
    caveFar: '#2b1747',
    caveNear: '#1a0f2c',
    rockFace: '#3a2a44',
    rockEdge: '#54406a',
    rockLight: '#7d5f96',
    timber: '#6b4426',
    timberLight: '#a9713c',
    steel: '#48607f',
    steelLight: '#7fa3c6',
    gold: '#f4b52a',
    goldLight: '#ffe98a',
    crystal: '#5ee7ff',
    crystalDeep: '#1f7fa8',
    lamp: '#ffcf6b',
    text: '#f6e9c9',
  });

  function createAssets() {
    const images = {};
    let started = false;
    let ready = 0;
    let total = 0;
    return {
      load() {
        if (started || typeof Image === 'undefined') return;
        started = true;
        for (const [key, src] of Object.entries(ASSET)) {
          const img = new Image();
          img.decoding = 'async';
          total += 1;
          img.onload = () => { ready += 1; images[key] = img; };
          img.onerror = () => { ready += 1; };   // a missing image must never break the frame
          img.src = src;
        }
      },
      get(key) { return images[key] || null; },
      get progress() { return total ? ready / total : 0; },
      get ready() { return total > 0 && ready === total; },
    };
  }

  /** Pre-render a cave backdrop once per size change. */
  function makeBackdrop(width, height, seed) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Deterministic pseudo-random so a resize does not rearrange the cave.
    let s = seed || 1;
    const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, PALETTE.skyDeep);
    g.addColorStop(0.45, PALETTE.skyTop);
    g.addColorStop(1, PALETTE.skyMid);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    // Stalactites hanging from the ceiling.
    for (let i = 0; i < 26; i++) {
      const x = rand() * width;
      const w = 18 + rand() * 46;
      const h = 30 + rand() * 110;
      ctx.fillStyle = `rgba(24, 14, 40, ${0.62 + rand() * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + w, 0);
      ctx.lineTo(x + w / 2, h);
      ctx.closePath();
      ctx.fill();
    }
    // Distant crystals catching the blue light.
    for (let i = 0; i < 16; i++) {
      const x = rand() * width;
      const y = height * (0.25 + rand() * 0.55);
      const size = 10 + rand() * 26;
      const glow = ctx.createRadialGradient(x, y, 1, x, y, size * 3.2);
      glow.addColorStop(0, 'rgba(94, 231, 255, .34)');
      glow.addColorStop(1, 'rgba(94, 231, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - size * 3.2, y - size * 3.2, size * 6.4, size * 6.4);
      ctx.fillStyle = 'rgba(126, 220, 255, .5)';
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size * 0.42, y);
      ctx.lineTo(x, y + size * 0.3);
      ctx.lineTo(x - size * 0.42, y);
      ctx.closePath();
      ctx.fill();
    }
    return canvas;
  }

  function drawImage(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (!img) return;
    try { ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); } catch (_) { /* a broken image is not a crash */ }
  }

  /**
   * Draw one frame.
   * @param ctx    2d context of the visible canvas
   * @param frame  { state, camera, view, assets, backdrop, parallax, reduced, quality, time }
   */
  function draw(ctx, frame) {
    const { state, camera, view } = frame;
    const assets = frame.assets;
    const t = frame.time || 0;
    const reduced = Boolean(frame.reduced);
    const q = frame.quality || 'high';
    const w = view.w;
    const h = view.h;
    const P = frame.map || require_map();
    const cam = camera || { x: 0, y: 0 };

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // ---- background: pre-rendered cave, parallax by camera ----
    if (frame.backdrop) {
      const drift = reduced ? 0 : Math.sin(t / 5200) * 10;
      const px = -(cam.x % frame.backdrop.width) - drift;
      ctx.globalAlpha = 1;
      ctx.drawImage(frame.backdrop, px, 0);
      if (px + frame.backdrop.width < w) ctx.drawImage(frame.backdrop, px + frame.backdrop.width, 0);
    } else {
      ctx.fillStyle = PALETTE.skyDeep;
      ctx.fillRect(0, 0, w, h);
    }
    // Warm lamp glow anchored in the world, so it moves with the camera.
    drawLamps(ctx, P, cam, w, h, t, reduced, q);

    ctx.translate(-cam.x, -cam.y);
    // Without world data there is nothing to place; the cave still renders, which keeps a
    // broken script tag from becoming a black screen.
    if (!P) { ctx.restore(); return; }

    // ---- ground and rock faces ----
    for (const box of P.MAP.platforms) {
      if (!visible(box, cam, w, h)) continue;
      drawPlatform(ctx, box, t, reduced);
    }

    // ---- ladders ----
    for (const ladder of P.MAP.ladders) {
      if (!visible({ x: ladder.x, y: ladder.y, w: 28, h: ladder.bottom - ladder.y }, cam, w, h)) continue;
      drawLadder(ctx, ladder);
    }

    // ---- the lift shaft and cabin ----
    drawLift(ctx, P, state, cam, w, h, t, reduced);

    // ---- machines ----
    for (const spec of P.MAP.machines) {
      if (!visible({ x: spec.x, y: spec.y - spec.h, w: spec.w, h: spec.h }, cam, w, h)) continue;
      drawMachine(ctx, spec, state && state.machines ? state.machines[spec.id] : null, assets, t, reduced);
    }

    // ---- veins ----
    for (const vein of P.MAP.deposits) {
      const box = { x: vein.x - 22, y: vein.y - 46, w: 44, h: 46 };
      if (!visible(box, cam, w, h)) continue;
      const saved = state && state.deposits ? state.deposits[vein.id] : null;
      drawVein(ctx, vein, saved, assets, t, reduced);
    }

    // ---- gates ----
    for (const gate of P.MAP.gates) {
      const open = Boolean(state && state.openGates && state.openGates.includes(gate.id));
      if (!visible({ x: gate.x, y: gate.y, w: gate.w, h: gate.h }, cam, w, h)) continue;
      drawGate(ctx, gate, open, t, reduced);
    }

    // ---- secrets ----
    for (const secret of P.MAP.secrets) {
      if (!visible({ x: secret.x - 30, y: secret.y - 40, w: 60, h: 80 }, cam, w, h)) continue;
      const found = Boolean(state && state.secrets && state.secrets.includes(secret.id));
      drawSecret(ctx, secret, found, t, reduced);
    }

    // ---- crew ----
    if (state && state.crew) {
      for (const [id, worker] of Object.entries(state.crew)) {
        if (!visible({ x: worker.x - 20, y: worker.y - 56, w: 40, h: 56 }, cam, w, h)) continue;
        drawWorker(ctx, worker, id, assets, t, reduced);
      }
    }

    // ---- the miner ----
    if (state && state.player) drawMiner(ctx, state, assets, t, reduced);

    // ---- interaction prompts in world space ----
    if (frame.prompt) drawPrompt(ctx, frame.prompt, t, reduced);

    ctx.restore();

    // ---- mission / progress overlay drawn in screen space ----
    if (frame.hint) drawHint(ctx, frame.hint, w, h, reduced);
  }

  /** The world data. Passed in explicitly; the global is only a browser convenience. */
  function require_map() {
    return (typeof globalThis !== 'undefined' && globalThis.StoneMineMap) || null;
  }

  const visible = (box, cam, w, h) => box.x + box.w > cam.x - 80 && box.x < cam.x + w + 80 &&
    box.y + box.h > cam.y - 80 && box.y < cam.y + h + 80;

  function drawLamps(ctx, P, cam, w, h, t, reduced, q) {
    if (!P || q === 'low') return;
    for (const ladder of P.MAP.ladders) {
      const x = ladder.x + 14;
      const y = ladder.y - 40;
      if (x < cam.x - 120 || x > cam.x + w + 120) continue;
      const sway = reduced ? 0 : Math.sin(t / 900 + x) * 4;
      const glow = ctx.createRadialGradient(x - cam.x + sway, y - cam.y, 2, x - cam.x + sway, y - cam.y, 120);
      glow.addColorStop(0, 'rgba(255, 207, 107, .38)');
      glow.addColorStop(1, 'rgba(255, 207, 107, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - cam.x - 130, y - cam.y - 130, 260, 260);
      ctx.fillStyle = PALETTE.lamp;
      ctx.fillRect(x - cam.x + sway - 4, y - cam.y - 8, 8, 12);
      ctx.strokeStyle = 'rgba(90, 60, 20, .9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - cam.x, y - cam.y - 40);
      ctx.lineTo(x - cam.x + sway, y - cam.y - 8);
      ctx.stroke();
    }
  }

  function drawPlatform(ctx, box, t, reduced) {
    if (box.kind === 'ledge') {
      // Timber walkway with plank lines.
      ctx.fillStyle = PALETTE.timber;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = PALETTE.timberLight;
      ctx.fillRect(box.x, box.y, box.w, 3);
      ctx.strokeStyle = 'rgba(30, 18, 8, .55)';
      ctx.lineWidth = 1;
      for (let x = box.x + 12; x < box.x + box.w; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, box.y + 3);
        ctx.lineTo(x, box.y + box.h);
        ctx.stroke();
      }
      // Support brackets under the ends.
      ctx.fillStyle = 'rgba(40, 26, 14, .9)';
      ctx.fillRect(box.x + 4, box.y + box.h, 6, 12);
      ctx.fillRect(box.x + box.w - 10, box.y + box.h, 6, 12);
      return;
    }
    if (box.kind === 'wall') {
      ctx.fillStyle = PALETTE.rockNear;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = 'rgba(120, 96, 150, .35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x + 3, box.y + 3, box.w - 6, box.h - 6);
      return;
    }
    if (box.kind === 'pit') {
      // A shaft header: dark opening with a riveted steel edge.
      ctx.fillStyle = 'rgba(6, 3, 12, .92)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = PALETTE.steel;
      ctx.fillRect(box.x - 6, box.y - 6, box.w + 12, 8);
      ctx.fillStyle = PALETTE.steelLight;
      for (let x = box.x; x < box.x + box.w; x += 18) ctx.fillRect(x, box.y - 4, 4, 4);
      return;
    }
    // Floor: rock strata with a lit top edge.
    const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
    g.addColorStop(0, PALETTE.rockEdge);
    g.addColorStop(0.12, PALETTE.rockFace);
    g.addColorStop(1, PALETTE.caveNear);
    ctx.fillStyle = g;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = PALETTE.rockLight;
    ctx.fillRect(box.x, box.y, box.w, 3);
    // Strata lines, spaced deterministically by x so they do not crawl.
    ctx.strokeStyle = 'rgba(12, 6, 22, .45)';
    ctx.lineWidth = 1;
    for (let y = box.y + 16; y < box.y + box.h; y += 18) {
      ctx.beginPath();
      ctx.moveTo(box.x, y);
      ctx.lineTo(box.x + box.w, y + 2);
      ctx.stroke();
    }
    // Gold flecks in the rock, sparse and stable.
    ctx.fillStyle = 'rgba(244, 181, 42, .55)';
    for (let x = box.x + 20; x < box.x + box.w; x += 97) {
      const y = box.y + 22 + ((x * 7) % 26);
      ctx.fillRect(x, y, 3, 3);
      ctx.fillRect(x + 7, y + 6, 2, 2);
    }
  }

  function drawLadder(ctx, ladder) {
    const x = ladder.x + 14;
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 10, ladder.y);
    ctx.lineTo(x - 10, ladder.bottom);
    ctx.moveTo(x + 10, ladder.y);
    ctx.lineTo(x + 10, ladder.bottom);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#b07a3c';
    for (let y = ladder.y + 8; y < ladder.bottom; y += 16) {
      ctx.beginPath();
      ctx.moveTo(x - 10, y);
      ctx.lineTo(x + 10, y);
      ctx.stroke();
    }
  }

  function drawLift(ctx, P, state, cam, w, h, t, reduced) {
    const lift = P.MAP.lift;
    const cabinY = state && state.lift ? state.lift.y : lift.start;
    if (!visible({ x: lift.x - 10, y: 0, w: lift.w + 20, h: P.HEIGHT }, cam, w, h)) return;
    // Cables up to the header.
    ctx.strokeStyle = 'rgba(150, 190, 220, .45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lift.x + 16, 0);
    ctx.lineTo(lift.x + 16, cabinY);
    ctx.moveTo(lift.x + lift.w - 16, 0);
    ctx.lineTo(lift.x + lift.w - 16, cabinY);
    ctx.stroke();
    // Cabin.
    const g = ctx.createLinearGradient(lift.x, cabinY - 96, lift.x, cabinY);
    g.addColorStop(0, 'rgba(126, 196, 255, .30)');
    g.addColorStop(1, 'rgba(64, 132, 210, .22)');
    ctx.fillStyle = g;
    ctx.fillRect(lift.x + 6, cabinY - 96, lift.w - 12, 96);
    ctx.strokeStyle = PALETTE.steelLight;
    ctx.lineWidth = 3;
    ctx.strokeRect(lift.x + 6, cabinY - 96, lift.w - 12, 96);
    ctx.fillStyle = PALETTE.steel;
    ctx.fillRect(lift.x, cabinY, lift.w, lift.h);
    ctx.fillStyle = PALETTE.steelLight;
    ctx.fillRect(lift.x, cabinY, lift.w, 3);
    // A soft blue guide-light so the shaft reads as usable, never as a wall.
    if (!reduced) {
      const pulse = 0.22 + Math.sin(t / 700) * 0.06;
      ctx.fillStyle = `rgba(94, 231, 255, ${pulse})`;
      ctx.fillRect(lift.x + 6, cabinY - 96, 4, 96);
    }
  }

  function drawVein(ctx, vein, saved, assets, t, reduced) {
    const remaining = saved ? saved.remaining : vein.amount;
    const total = vein.amount || 1;
    const ratio = Math.max(0, Math.min(1, remaining / total));
    const cx = vein.x;
    const base = vein.y;
    const h = 40 * (0.45 + 0.55 * ratio);
    const w = 40 * (0.6 + 0.4 * ratio);
    // Rock body.
    ctx.fillStyle = ratio > 0 ? PALETTE.rockEdge : 'rgba(60, 52, 70, .55)';
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, base);
    ctx.lineTo(cx - w / 2 + 6, base - h * 0.55);
    ctx.lineTo(cx - w * 0.2, base - h);
    ctx.lineTo(cx + w * 0.24, base - h * 0.86);
    ctx.lineTo(cx + w / 2, base - h * 0.4);
    ctx.lineTo(cx + w / 2, base);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(140, 110, 170, .55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (ratio <= 0) {
      // Depleted: rubble only.
      ctx.fillStyle = 'rgba(90, 78, 104, .7)';
      for (let i = 0; i < 5; i++) ctx.fillRect(cx - 16 + i * 7, base - 5 - (i % 2) * 4, 6, 5);
      return;
    }
    // Ore crystals embedded in the rock, tinted per ore type.
    const tint = vein.ore === 'gold' ? '#ffd35c' : vein.ore === 'crystal' ? PALETTE.crystal
      : vein.ore === 'iron' ? '#c9d4e4' : '#f08a4b';
    const sprite = assets && assets.get ? assets.get('ore') : null;
    for (let i = 0; i < 3; i++) {
      const ox = cx - 10 + i * 9;
      const oy = base - h * (0.35 + i * 0.16);
      if (sprite && ORE_COL[vein.ore] !== undefined) {
        const col = ORE_COL[vein.ore];
        const sw = sprite.width / 4;
        drawImage(ctx, sprite, col * sw, 0, sw, sprite.height, ox - 7, oy - 9, 14, 14);
      } else {
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.moveTo(ox, oy - 8);
        ctx.lineTo(ox + 5, oy);
        ctx.lineTo(ox, oy + 6);
        ctx.lineTo(ox - 5, oy);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (!reduced) {
      const glow = 0.18 + Math.sin(t / 620 + vein.x) * 0.06;
      const g = ctx.createRadialGradient(cx, base - h * 0.6, 2, cx, base - h * 0.6, 52);
      g.addColorStop(0, `rgba(255, 220, 140, ${glow})`);
      g.addColorStop(1, 'rgba(255, 220, 140, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 54, base - h - 54, 108, 108);
    }
    // Remaining-ore pips above the vein: readable at a glance, no numbers needed.
    const pips = Math.min(8, remaining);
    ctx.fillStyle = 'rgba(255, 246, 201, .92)';
    for (let i = 0; i < pips; i++) ctx.fillRect(cx - pips * 3 + i * 6, base - h - 14, 4, 3);
  }

  function drawGate(ctx, gate, open, t, reduced) {
    const x = gate.x;
    const y = gate.y;
    if (open) {
      // Retracted into the frame: two stub posts and a lit floor strip.
      ctx.fillStyle = PALETTE.steel;
      ctx.fillRect(x, y, gate.w, 10);
      ctx.fillRect(x, y + gate.h - 10, gate.w, 10);
      ctx.fillStyle = 'rgba(94, 231, 255, .35)';
      ctx.fillRect(x, y + 10, gate.w, gate.h - 20);
      return;
    }
    ctx.fillStyle = '#3d4f66';
    ctx.fillRect(x, y, gate.w, gate.h);
    ctx.strokeStyle = PALETTE.steelLight;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, gate.w - 3, gate.h - 3);
    ctx.fillStyle = 'rgba(255, 207, 107, .85)';
    const pulse = reduced ? 0.8 : 0.55 + Math.sin(t / 480) * 0.3;
    ctx.globalAlpha = pulse;
    ctx.fillRect(x + gate.w / 2 - 4, y + gate.h / 2 - 4, 8, 8);
    ctx.globalAlpha = 1;
  }

  function drawSecret(ctx, secret, found, t, reduced) {
    ctx.fillStyle = found ? 'rgba(94, 231, 255, .28)' : 'rgba(18, 10, 30, .85)';
    ctx.beginPath();
    ctx.ellipse(secret.x, secret.y, 26, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = found ? PALETTE.crystal : 'rgba(120, 96, 150, .7)';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (!found && !reduced) {
      const a = 0.25 + Math.sin(t / 800) * 0.12;
      ctx.fillStyle = `rgba(255, 232, 160, ${a})`;
      ctx.beginPath();
      ctx.arc(secret.x, secret.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMachine(ctx, spec, machine, assets, t, reduced) {
    const status = machine ? machine.status : 'off';
    const x = spec.x;
    const y = spec.y;
    if (spec.kind === 'drill') {
      // Body, mast and spinning bit.
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(x, y - 52, spec.w, 52);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(x + 4, y - 48, spec.w - 8, 6);
      ctx.fillStyle = PALETTE.steel;
      ctx.fillRect(x + spec.w / 2 - 7, y - spec.h, 14, spec.h - 52);
      ctx.strokeStyle = PALETTE.steelLight;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + spec.w / 2 - 7, y - spec.h, 14, spec.h - 52);
      const spin = status === 'working' && !reduced ? Math.sin(t / 60) * 14 : 0;
      ctx.strokeStyle = '#c9d4e4';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + spec.w / 2 + spin, y - spec.h);
      ctx.lineTo(x + spec.w / 2 - spin, y - spec.h - 18);
      ctx.stroke();
      if (status === 'working' && !reduced) {
        ctx.fillStyle = 'rgba(255, 207, 107, .5)';
        ctx.fillRect(x + spec.w / 2 - 3 + (t % 20) / 4, y - spec.h - 24, 6, 6);
      }
    } else if (spec.kind === 'conveyor') {
      ctx.fillStyle = '#2f3b4c';
      ctx.fillRect(x, y - spec.h, spec.w, spec.h);
      ctx.fillStyle = PALETTE.steelLight;
      ctx.fillRect(x, y - spec.h, spec.w, 4);
      const offset = status === 'working' && !reduced ? (t / 12) % 24 : 0;
      ctx.strokeStyle = 'rgba(180, 210, 240, .55)';
      ctx.lineWidth = 2;
      for (let bx = x - 24 + offset; bx < x + spec.w; bx += 24) {
        ctx.beginPath();
        ctx.moveTo(bx, y - spec.h + 6);
        ctx.lineTo(bx + 10, y - 6);
        ctx.stroke();
      }
      // Cargo pips riding the belt.
      if (machine && machine.cargo > 0) {
        const n = Math.min(8, machine.cargo);
        for (let i = 0; i < n; i++) {
          const px = x + 20 + ((i * 74 + (status === 'working' && !reduced ? t / 8 : 0)) % Math.max(40, spec.w - 40));
          ctx.fillStyle = '#f08a4b';
          ctx.fillRect(px, y - spec.h - 8, 8, 8);
        }
      }
    } else if (spec.kind === 'cart') {
      ctx.fillStyle = '#4a3a2a';
      ctx.fillRect(x, y - spec.h, spec.w, spec.h - 10);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(x + 3, y - spec.h + 3, spec.w - 6, 4);
      ctx.fillStyle = '#22202a';
      ctx.beginPath();
      ctx.arc(x + 18, y - 4, 9, 0, Math.PI * 2);
      ctx.arc(x + spec.w - 18, y - 4, 9, 0, Math.PI * 2);
      ctx.fill();
      if (machine && machine.cargo > 0) {
        ctx.fillStyle = '#f08a4b';
        const n = Math.min(8, machine.cargo);
        for (let i = 0; i < n; i++) ctx.fillRect(x + 10 + i * 9, y - spec.h - 6, 7, 7);
      }
    } else if (spec.kind === 'warehouse') {
      ctx.fillStyle = '#3a2d44';
      ctx.fillRect(x, y - spec.h, spec.w, spec.h);
      ctx.fillStyle = PALETTE.timber;
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 6, y - spec.h + 8 + i * 24, spec.w - 12, 16);
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y - spec.h + 1.5, spec.w - 3, spec.h - 3);
      if (machine) {
        // Fill gauge on the side of the silo.
        const ratio = Math.max(0, Math.min(1, (machine.total || 0) / Math.max(1, machine.capacity || 1)));
        const gaugeH = spec.h - 24;
        ctx.fillStyle = 'rgba(8, 6, 14, .8)';
        ctx.fillRect(x + spec.w - 16, y - spec.h + 12, 8, gaugeH);
        ctx.fillStyle = PALETTE.crystal;
        ctx.fillRect(x + spec.w - 16, y - 12 - gaugeH * ratio, 8, gaugeH * ratio);
      }
    }
    if (status === 'blocked') {
      ctx.fillStyle = 'rgba(255, 96, 96, .9)';
      ctx.beginPath();
      ctx.arc(x + spec.w / 2, y - spec.h - 16, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + spec.w / 2 - 1, y - spec.h - 19, 2, 5);
    } else if (status === 'working') {
      ctx.fillStyle = 'rgba(120, 240, 170, .92)';
      ctx.beginPath();
      ctx.arc(x + spec.w / 2, y - spec.h - 16, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWorker(ctx, worker, id, assets, t, reduced) {
    const sprite = assets && assets.get ? assets.get('rig') : null;
    const x = worker.x;
    const y = worker.y;
    // Shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, .35)';
    ctx.beginPath();
    ctx.ellipse(x, y, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    const bob = worker.status === 'walking' && !reduced ? Math.abs(Math.sin(t / 160)) * 3 : 0;
    if (sprite) {
      drawImage(ctx, sprite, 0, 0, sprite.width, sprite.height, x - 17, y - 46 - bob, 34, 46);
    } else {
      ctx.fillStyle = '#4b7fb5';
      ctx.fillRect(x - 9, y - 38 - bob, 18, 30);
      ctx.fillStyle = '#f2c050';
      ctx.beginPath();
      ctx.arc(x, y - 44 - bob, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    // Status ring: colour-coded without text.
    const tone = worker.status === 'working' ? PALETTE.crystal
      : worker.status === 'walking' ? PALETTE.gold
        : worker.status === 'blocked' ? '#ff6b6b' : 'rgba(200, 210, 230, .7)';
    ctx.strokeStyle = tone;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y - 56 - bob, 6, 0, Math.PI * 2);
    ctx.stroke();
    if (worker.status === 'working' && !reduced) {
      const swing = Math.sin(t / 140) * 0.9;
      ctx.strokeStyle = '#c9d4e4';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + 8, y - 30);
      ctx.lineTo(x + 8 + Math.cos(-0.9 + swing) * 20, y - 30 + Math.sin(-0.9 + swing) * 20);
      ctx.stroke();
    }
    void id;
  }

  function drawMiner(ctx, state, assets, t, reduced) {
    const p = state.player;
    const sprite = assets && assets.get ? assets.get('hero') : null;
    const x = p.x + p.w / 2;
    const y = p.y + p.h;
    // Shadow shrinks while airborne.
    const air = p.grounded ? 1 : 0.6;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.38 * air})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 16 * air, 5 * air, 0, 0, Math.PI * 2);
    ctx.fill();

    const moving = p.pose === 'run';
    const pose = p.pose === 'mine'
      ? (p.mining && (p.mining.ticks % 10) < 5 ? 'raise' : 'strike')
      : p.pose === 'jump' || p.pose === 'fall' ? 'walkA'
        : moving ? (Math.floor(t / 130) % 2 ? 'walkA' : 'walkB')
          : 'idle';
    const [col, row] = HERO_POSE[pose] || HERO_POSE.idle;
    const dw = 62;
    const dh = 62;
    ctx.save();
    ctx.translate(x, y);
    if (p.facing === -1) ctx.scale(-1, 1);
    const bob = moving && !reduced ? -Math.abs(Math.sin(t / 150)) * 2 : 0;
    if (sprite) {
      const sw = sprite.width / 3;
      const sh = sprite.height / 2;
      drawImage(ctx, sprite, col * sw, row * sh, sw, sh, -dw / 2, -dh - bob, dw, dh);
    } else {
      // Vector fallback so the player is never invisible.
      ctx.fillStyle = '#2f6fb5';
      ctx.fillRect(-11, -40, 22, 34);
      ctx.fillStyle = '#f2c050';
      ctx.beginPath();
      ctx.arc(0, -48, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // The pickaxe arc during a swing: the clearest mining feedback.
    if (p.pose === 'mine' && p.mining) {
      const phase = (p.mining.ticks % 10) / 10;
      const angle = -1.4 + phase * 2.6;
      ctx.strokeStyle = 'rgba(255, 232, 160, .85)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x + p.facing * 14, y - 26, 20, angle - 0.5, angle + 0.5);
      ctx.stroke();
    }
  }

  function drawPrompt(ctx, prompt, t, reduced) {
    const pulse = reduced ? 1 : 0.85 + Math.sin(t / 320) * 0.15;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = 'rgba(12, 8, 22, .86)';
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 2;
    const w = 26;
    const h = 26;
    roundRect(ctx, prompt.x - w / 2, prompt.y - h, w, h, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.goldLight;
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(prompt.glyph || 'E', prompt.x, prompt.y - h / 2 + 1);
    ctx.restore();
  }

  function drawHint(ctx, hint, w, h, reduced) {
    if (!hint || !hint.text) return;
    ctx.save();
    const pad = 12;
    const maxW = Math.min(w - 24, 420);
    ctx.font = 'bold 13px system-ui, sans-serif';
    const textW = Math.min(maxW - pad * 2, ctx.measureText(hint.text).width);
    const boxW = textW + pad * 2;
    const boxH = hint.twoLine ? 46 : 32;
    const x = (w - boxW) / 2;
    const y = h - boxH - (hint.bottomInset || 12);
    ctx.globalAlpha = reduced ? 1 : 0.96;
    ctx.fillStyle = 'rgba(10, 7, 20, .88)';
    ctx.strokeStyle = hint.tone === 'warn' ? '#ff9b6b' : 'rgba(244, 181, 42, .75)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, boxW, boxH, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (hint.sub) {
      ctx.fillText(hint.text, w / 2, y + 17);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(246, 233, 201, .72)';
      ctx.fillText(hint.sub, w / 2, y + 33);
    } else {
      ctx.fillText(hint.text, w / 2, y + boxH / 2);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  return Object.freeze({
    ASSET, PALETTE, HERO_POSE, ORE_COL, createAssets, makeBackdrop, draw, roundRect,
  });
});
