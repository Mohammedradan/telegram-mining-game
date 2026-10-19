/* Original deterministic platform physics, shared by browser and server. No assets/dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 2; // إصدار جديد مع الشخصيات
  const FPS = 60, DT = 1 / FPS, MAX_TICKS = 60 * 150;
  const INPUT = Object.freeze({ LEFT: 1, RIGHT: 2, JUMP: 4, MINE: 8 });
  
  // تعريفات الشخصيات
  const CHARACTERS = Object.freeze({
    miner: {
      name: 'عامل المنجم',
      description: 'تعدين أسرع',
      speed: 210,
      jumpForce: 450,
      mineSpeed: 14, // أسرع في التعدين
      damage: 1,
      color: '#f0c064',
      weapon: 'pickaxe'
    },
    warrior: {
      name: 'المحارب',
      description: 'هجوم أقوى',
      speed: 180,
      jumpForce: 420,
      mineSpeed: 18, // أبطأ في التعدين
      damage: 2,
      color: '#ef4444',
      weapon: 'sword'
    },
    ranger: {
      name: 'الرامي',
      description: 'مدى هجوم أطول',
      speed: 220,
      jumpForce: 470,
      mineSpeed: 16,
      damage: 1,
      color: '#3b82f6',
      weapon: 'bow'
    }
  });
  
  // تعريفات المهارات
  const SKILLS = Object.freeze({
    miner: { name: 'تعدين سريع', duration: 180, cooldown: 600, effect: 'mineSpeed' },
    warrior: { name: 'هجوم قوي', duration: 120, cooldown: 500, effect: 'damage' },
    ranger: { name: 'سرعة عالية', duration: 150, cooldown: 550, effect: 'speed' }
  });
  
  // تعريفات الأسلحة
  const WEAPONS = Object.freeze({
    pickaxe: { name: 'المعول', range: 54, color: '#bce2dc' },
    sword: { name: 'السيف', range: 70, color: '#ffd700' },
    bow: { name: 'القوس', range: 90, color: '#8b5cf6' }
  });
  const LEVEL = Object.freeze({
    width: 2680, height: 360, exit: { x: 2540, y: 222, w: 70, h: 78 },
    platforms: [
      { x: 0, y: 300, w: 720, h: 80 }, { x: 810, y: 300, w: 720, h: 80 },
      { x: 1640, y: 300, w: 1040, h: 80 },
      { x: 260, y: 230, w: 115, h: 20 }, { x: 560, y: 222, w: 105, h: 20 },
      { x: 900, y: 228, w: 100, h: 20 }, { x: 1320, y: 224, w: 112, h: 20 },
      { x: 1780, y: 230, w: 110, h: 20 }, { x: 2180, y: 230, w: 135, h: 20 },
    ],
    rocks: [{ x: 440, y: 252, w: 46, h: 48 }, { x: 1040, y: 252, w: 46, h: 48 }, { x: 1940, y: 252, w: 46, h: 48 }],
    gems: [{ x: 196, y: 276 }, { x: 309, y: 207 }, { x: 603, y: 199 }, { x: 860, y: 276 }, { x: 948, y: 205 }, { x: 1370, y: 201 }, { x: 1730, y: 276 }, { x: 1828, y: 207 }, { x: 2240, y: 207 }, { x: 2450, y: 276 }],
    hazards: [{ x: 1190, y: 265, w: 42, h: 35, period: 180, active: 84 }, { x: 2080, y: 279, w: 48, h: 21, period: 1, active: 1 }],
    enemies: [
      { x: 800, y: 272, w: 32, h: 36, type: 'patrol', range: { min: 700, max: 900 }, speed: 60, hp: 2, damage: 1 },
      { x: 1500, y: 272, w: 32, h: 36, type: 'chase', range: 200, speed: 90, hp: 2, damage: 1 }
    ]
  });
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const activeHazard = (h, tick) => tick % h.period < h.active;
  function create(characterType = 'miner') {
    const char = CHARACTERS[characterType] || CHARACTERS.miner;
    return { 
      version: VERSION, 
      characterType,
      tick: 0, 
      status: 'playing', 
      player: { 
        x: 64, 
        y: 262, 
        w: 24, 
        h: 38, 
        vx: 0, 
        vy: 0, 
        grounded: true, 
        facing: 1, 
        hearts: 3, 
        invulnerable: 0, 
        coyote: 6, 
        jumpBuffer: 0, 
        attack: 0, 
        pose: 'idle',
        // خصائص الشخصية
        speed: char.speed,
        jumpForce: char.jumpForce,
        mineSpeed: char.mineSpeed,
        damage: char.damage
      },
      checkpoint: 64, 
      rocks: LEVEL.rocks.map(r => ({ ...r, hp: 3 })), 
      gems: LEVEL.gems.map(g => ({ ...g, taken: false })), 
      enemies: LEVEL.enemies.map(e => ({ ...e, currentHp: e.hp, direction: 1, vx: 0 })),
      collected: 0, 
      mined: 0, 
      damage: 0, 
      lastMask: 0, 
      events: [],
      weapon: WEAPONS[char.weapon],
      skillCooldown: 0,
      skillActive: 0
    };
  }
  function hurt(s) {
    const p = s.player;
    if (p.invulnerable) return;
    p.hearts--; s.damage++; p.invulnerable = 90;
    s.events.push({ type: 'hurt', x: p.x, y: p.y });
    p.x = s.checkpoint; p.y = 240; p.vx = 0; p.vy = 0;
    if (p.hearts <= 0) s.status = 'lost';
  }
  function step(s, mask) {
    if (s.status !== 'playing') return s;
    s.events = []; s.tick++;
    const p = s.player;
    if (p.invulnerable > 0) p.invulnerable--;
    if (p.attack > 0) p.attack--;
    if (s.skillCooldown > 0) s.skillCooldown--;
    if (s.skillActive > 0) {
      s.skillActive--;
      // تطبيق تأثير المهارة
      const skill = SKILLS[s.characterType];
      if (skill && skill.effect === 'mineSpeed') p.mineSpeed = 10;
      if (skill && skill.effect === 'damage') p.damage = 3;
      if (skill && skill.effect === 'speed') p.speed = 280;
    } else {
      // إعادة القيم الأصلية
      const char = CHARACTERS[s.characterType];
      if (char) {
        p.mineSpeed = char.mineSpeed;
        p.damage = char.damage;
        p.speed = char.speed;
      }
    }
    p.coyote = p.grounded ? 6 : Math.max(0, p.coyote - 1);
    p.jumpBuffer = (mask & INPUT.JUMP) && !(s.lastMask & INPUT.JUMP) ? 6 : Math.max(0, p.jumpBuffer - 1);
    const direction = ((mask & INPUT.RIGHT) ? 1 : 0) - ((mask & INPUT.LEFT) ? 1 : 0);
    p.vx = direction * p.speed;
    if (direction) p.facing = direction;
    if (p.jumpBuffer && p.coyote) {
      p.vy = -p.jumpForce; p.grounded = false; p.coyote = 0; p.jumpBuffer = 0;
      s.events.push({ type: 'jump', x: p.x, y: p.y + p.h });
    }
    if ((mask & INPUT.MINE) && !p.attack) {
      p.attack = p.mineSpeed;
      const weaponRange = s.weapon ? s.weapon.range : 54;
      const hitbox = { x: p.facing > 0 ? p.x + p.w : p.x - weaponRange, y: p.y - 8, w: weaponRange, h: p.h + 16 };
      const rock = s.rocks.find(r => r.hp > 0 && overlap(hitbox, r));
      if (rock) {
        rock.hp -= p.damage; s.events.push({ type: 'mine', x: rock.x + rock.w / 2, y: rock.y + 15 });
        if (!rock.hp) { s.mined++; s.collected += 2; s.events.push({ type: 'collect', x: rock.x, y: rock.y }); }
      }
    }
    const solids = LEVEL.platforms.concat(s.rocks.filter(r => r.hp > 0));
    // Axis-separated fixed 60 Hz collision: max displacement < the thinnest solid.
    p.x += p.vx * DT;
    for (const box of solids) if (overlap(p, box)) {
      if (p.vx > 0) p.x = box.x - p.w;
      else if (p.vx < 0) p.x = box.x + box.w;
    }
    p.x = Math.max(0, Math.min(LEVEL.width - p.w, p.x));
    p.vy = Math.min(680, p.vy + 1200 * DT);
    p.y += p.vy * DT;
    const wasGrounded = p.grounded; p.grounded = false;
    for (const box of solids) if (overlap(p, box)) {
      if (p.vy > 0) { p.y = box.y - p.h; p.grounded = true; }
      else if (p.vy < 0) p.y = box.y + box.h;
      p.vy = 0;
    }
    if (!wasGrounded && p.grounded) s.events.push({ type: 'land', x: p.x, y: p.y + p.h });
    if (p.x > 910 && p.x < 1000 && p.grounded) s.checkpoint = 920;
    if (p.x > 1700 && p.x < 1780 && p.grounded) s.checkpoint = 1710;
    for (const gem of s.gems) if (!gem.taken && overlap(p, { x: gem.x - 9, y: gem.y - 10, w: 18, h: 20 })) {
      gem.taken = true; s.collected++; s.events.push({ type: 'collect', x: gem.x, y: gem.y });
    }
    if (p.y > LEVEL.height + 50) {
      // A fall must respawn even during invulnerability, without repeatedly losing hearts.
      if (p.invulnerable) { p.x = s.checkpoint; p.y = 240; p.vx = p.vy = 0; }
      else hurt(s);
    }
    for (const hazard of LEVEL.hazards) if (activeHazard(hazard, s.tick) && overlap(p, hazard)) hurt(s);
    
    // منطق الأعداء AI
    for (const enemy of s.enemies) {
      if (enemy.currentHp <= 0) continue;
      
      // سلوك AI حسب النوع
      if (enemy.type === 'patrol') {
        // التجول في منطقة محددة
        enemy.x += enemy.direction * enemy.speed * DT;
        if (enemy.x <= enemy.range.min || enemy.x >= enemy.range.max) {
          enemy.direction *= -1;
        }
      } else if (enemy.type === 'chase') {
        // ملاحقة اللاعب إذا كان قريباً
        const dist = Math.abs(p.x - enemy.x);
        if (dist < enemy.range) {
          enemy.direction = p.x > enemy.x ? 1 : -1;
          enemy.x += enemy.direction * enemy.speed * DT;
        }
      }
      
      // الاصطدام باللاعب
      if (overlap(p, enemy) && !p.invulnerable) {
        hurt(s);
      }
      
      // الاصطدام بهجوم اللاعب
      if (p.attack > 10) {
        const weaponRange = s.weapon ? s.weapon.range : 54;
        const hitbox = { x: p.facing > 0 ? p.x + p.w : p.x - weaponRange, y: p.y - 8, w: weaponRange, h: p.h + 16 };
        if (overlap(hitbox, enemy)) {
          enemy.currentHp -= p.damage;
          s.events.push({ type: 'mine', x: enemy.x + enemy.w / 2, y: enemy.y + 15 });
          if (enemy.currentHp <= 0) {
            s.collected += 3;
            s.events.push({ type: 'collect', x: enemy.x, y: enemy.y });
          }
        }
      }
    }
    
    if (s.status === 'playing' && s.mined >= 1 && s.collected >= 3 && overlap(p, LEVEL.exit)) {
      s.status = 'won'; s.events.push({ type: 'win', x: p.x, y: p.y });
    }
    if (s.tick >= MAX_TICKS && s.status === 'playing') s.status = 'lost';
    p.pose = s.status === 'won' ? 'victory' : p.invulnerable > 60 ? 'hurt' : p.attack > 4 ? 'mine' : !p.grounded ? (p.vy < 0 ? 'jump' : 'fall') : direction ? 'run' : 'idle';
    s.lastMask = mask;
    return s;
  }
  function replay(inputs, characterType = 'miner') {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1000) return { ok: false, reason: 'inputs' };
    let total = 0;
    for (const item of inputs) {
      if (!item || !Number.isInteger(item.mask) || item.mask < 0 || item.mask > 15 || !Number.isInteger(item.frames) || item.frames < 1 || (total += item.frames) > MAX_TICKS) return { ok: false, reason: 'inputs' };
    }
    const s = create(characterType);
    for (const item of inputs) for (let i = 0; i < item.frames; i++) {
      if (s.status !== 'playing') return { ok: false, reason: 'after_end' };
      step(s, item.mask);
    }
    return { ok: true, state: s };
  }
  const cameraFor = (s, width) => Math.max(0, Math.min(LEVEL.width - width, s.player.x + s.player.w / 2 - width * 0.35));
  const rewardFor = s => s.status === 'won' ? Math.min(100, 40 + s.collected * 4 + s.mined * 6) : 0;
  return { VERSION, FPS, DT, MAX_TICKS, INPUT, LEVEL, CHARACTERS, WEAPONS, SKILLS, create, step, replay, overlap, activeHazard, cameraFor, rewardFor };
});
