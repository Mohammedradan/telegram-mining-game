/* Original deterministic platform physics, shared by browser and server. No assets/dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 2;
  const FPS = 60, DT = 1 / FPS, MAX_TICKS = 60 * 150;
  const INPUT = Object.freeze({ LEFT: 1, RIGHT: 2, JUMP: 4, MINE: 8, ATTACK: 16, SKILL: 32 });
  const MAX_MASK = 63;

  const CHARACTERS = Object.freeze({
    miner: {
      id: 'miner',
      name: 'عامل المنجم',
      nameEn: 'Miner Fighter',
      role: 'يحطم الصخور بضربة واحدة ومدى تعدين أطول',
      speed: 210,
      jumpSpeed: -450,
      hearts: 3,
      maxHearts: 3,
      damage: 1,
      attackRange: 54,
      attackCooldown: 14,
      miningPower: 3,
      miningReach: 66,
      skillCooldown: 180,
      skillName: 'صدمة أرضية',
      color: '#eab85a',
      ranged: false,
    },
    warrior: {
      id: 'warrior',
      name: 'المحارب',
      nameEn: 'Warrior',
      role: 'صحة أعلى وضربة مزدوجة وحماية أطول بعد الإصابة، لكنه أبطأ',
      speed: 195,
      jumpSpeed: -450,
      hearts: 4,
      maxHearts: 4,
      damage: 2,
      attackRange: 60,
      attackCooldown: 18,
      miningPower: 1,
      miningReach: 54,
      hurtInvulnerable: 120,
      skillCooldown: 150,
      skillName: 'اندفاع هجومي',
      color: '#4f8bc4',
      ranged: false,
    },
    archer: {
      id: 'archer',
      name: 'رامي السهام',
      nameEn: 'Archer',
      role: 'سهام بعيدة المدى وأسرع حركة، لكن صحته أقل',
      speed: 228,
      jumpSpeed: -450,
      hearts: 3,
      maxHearts: 3,
      damage: 1,
      attackRange: 240,
      attackCooldown: 16,
      miningPower: 1,
      miningReach: 54,
      skillCooldown: 160,
      skillName: 'رمية ثلاثية',
      color: '#55b376',
      ranged: true,
    },
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
      { id: 1, type: 'goblin', name: 'غول الكهف', x: 290, y: 198, w: 26, h: 32, minX: 270, maxX: 365, maxHp: 2, patrolSpeed: 40, chaseSpeed: 70, damage: 1, flying: false },
      { id: 2, type: 'bat', name: 'خفاش الظلام', x: 620, y: 110, w: 24, h: 22, minX: 580, maxX: 680, baseY: 110, maxHp: 1, patrolSpeed: 55, chaseSpeed: 80, damage: 1, flying: true },
      { id: 3, type: 'goblin', name: 'غول الكهف', x: 930, y: 196, w: 26, h: 32, minX: 910, maxX: 990, maxHp: 2, patrolSpeed: 40, chaseSpeed: 70, damage: 1, flying: false },
      { id: 4, type: 'beetle', name: 'خنفساء الصخور', x: 1350, y: 200, w: 28, h: 24, minX: 1330, maxX: 1420, maxHp: 3, patrolSpeed: 30, chaseSpeed: 50, damage: 1, flying: false },
      { id: 5, type: 'goblin', name: 'غول الكهف', x: 1810, y: 198, w: 26, h: 32, minX: 1790, maxX: 1880, maxHp: 2, patrolSpeed: 40, chaseSpeed: 70, damage: 1, flying: false },
      { id: 6, type: 'bat', name: 'خفاش الظلام', x: 2220, y: 110, w: 24, h: 22, minX: 2170, maxX: 2300, baseY: 110, maxHp: 1, patrolSpeed: 55, chaseSpeed: 80, damage: 1, flying: true },
    ],
  });

  // تنويع المرحلة من بذرة الجولة: مواقع الصخور والبلورات وبداية دوريات الأعداء تتغير داخل نطاقات
  // مدروسة (التضاريس والفجوات والفخاخ ثابتة)، فلا يصلح تسجيل حركات جولة لإعادة استخدامه في أخرى.
  // البذرة تُشتق من معرّف الجولة الذي يصدره الخادم؛ الخادم يعيد التشغيل بالبذرة نفسها ولا يقبلها من العميل.
  // كل صخرة تختار مقطعاً ثم موقعاً داخله (بعيداً عن الفجوات والفخاخ ومنطقة البداية)
  // (لا صخرة بعد قفزة فوق فجوة/فخ مباشرة ولا تحت منصة منخفضة: الوقوف عليها يحبس اللاعب)
  const ROCK_SPANS = [[[250, 600]], [[915, 1095]], [[1790, 1980], [2330, 2420]]];
  const GEM_SPANS = [[156, 236], [270, 355], [570, 645], [820, 900], [910, 985], [1330, 1415], [1700, 1760], [1790, 1875], [2190, 2300], [2440, 2510]];
  function seedFromId(id) {
    let h = 0x811c9dc5;
    for (const ch of String(id || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function prng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function layoutFor(seed) {
    if (seed === undefined || seed === null) return { rocks: LEVEL.rocks, gems: LEVEL.gems, enemies: LEVEL.enemies.map(e => ({ ...e, dir: 1 })) };
    const rnd = prng(Number(seed) >>> 0);
    const pick = ([a, b]) => Math.round(a + rnd() * (b - a));
    return {
      rocks: LEVEL.rocks.map((r, i) => { const spans = ROCK_SPANS[i]; return { ...r, x: pick(spans[Math.floor(rnd() * spans.length)]) }; }),
      gems: LEVEL.gems.map((g, i) => ({ ...g, x: pick(GEM_SPANS[i]) })),
      enemies: LEVEL.enemies.map(e => ({ ...e, x: pick([e.minX, e.maxX - e.w]), dir: rnd() < 0.5 ? -1 : 1 })),
    };
  }

  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const activeHazard = (h, tick) => tick % h.period < h.active;
  const canExit = s => s.mined >= 1 && s.collected >= 3;

  function create(heroId = 'miner', seed) {
    const hero = CHARACTERS[heroId] || CHARACTERS.miner;
    const layout = layoutFor(seed);
    return {
      seed: seed === undefined || seed === null ? null : Number(seed) >>> 0,
      version: VERSION,
      tick: 0,
      status: 'playing',
      player: {
        hero: hero.id,
        x: 64, y: 262, w: 24, h: 38,
        vx: 0, vy: 0,
        speed: hero.speed,
        jumpSpeed: hero.jumpSpeed,
        grounded: true,
        facing: 1,
        hearts: hero.hearts,
        maxHearts: hero.maxHearts,
        invulnerable: 0,
        coyote: 6,
        jumpBuffer: 0,
        attack: 0,
        attackCooldown: hero.attackCooldown,
        damage: hero.damage,
        attackRange: hero.attackRange,
        miningPower: hero.miningPower,
        miningReach: hero.miningReach,
        hurtInvulnerable: hero.hurtInvulnerable || 90,
        skillCooldown: 0,
        skillMaxCooldown: hero.skillCooldown,
        pose: 'idle',
        landTimer: 0,
      },
      checkpoint: 64,
      rocks: layout.rocks.map(r => ({ ...r, hp: 3 })),
      gems: layout.gems.map(g => ({ ...g, taken: false })),
      enemies: layout.enemies.map(({ dir, ...e }) => ({
        ...e,
        hp: e.maxHp,
        vx: (e.patrolSpeed || 40) * dir,
        vy: 0,
        facing: 1,
        attackCooldown: 0,
        hurtCooldown: 0,
        dead: false,
        alert: false,
      })),
      projectiles: [],
      collected: 0,
      mined: 0,
      defeated: 0,
      damage: 0,
      lastMask: 0,
      events: [],
    };
  }

  function hurt(s) {
    const p = s.player;
    if (p.invulnerable) return;
    p.hearts--; s.damage++; p.invulnerable = p.hurtInvulnerable || 90;
    s.events.push({ type: 'hurt', x: p.x, y: p.y });
    p.x = s.checkpoint; p.y = 240; p.vx = 0; p.vy = 0;
    if (p.hearts <= 0) {
      s.status = 'lost';
      p.pose = 'dead';
      s.events.push({ type: 'game_over', x: p.x, y: p.y });
    }
  }

  function step(s, mask) {
    if (s.status !== 'playing') return s;
    s.events = []; s.tick++;
    const p = s.player;
    if (p.invulnerable > 0) p.invulnerable--;
    if (p.attack > 0) p.attack--;
    if (p.skillCooldown > 0) p.skillCooldown--;
    p.coyote = p.grounded ? 6 : Math.max(0, p.coyote - 1);
    p.jumpBuffer = (mask & INPUT.JUMP) && !(s.lastMask & INPUT.JUMP) ? 6 : Math.max(0, p.jumpBuffer - 1);
    const direction = ((mask & INPUT.RIGHT) ? 1 : 0) - ((mask & INPUT.LEFT) ? 1 : 0);
    p.vx = direction * p.speed;
    if (direction) p.facing = direction;
    if (p.jumpBuffer && p.coyote) {
      p.vy = p.jumpSpeed; p.grounded = false; p.coyote = 0; p.jumpBuffer = 0;
      s.events.push({ type: 'jump', x: p.x, y: p.y + p.h });
    }

    // MINE Action: targets rocks/ores only
    if ((mask & INPUT.MINE) && !p.attack) {
      p.attack = p.attackCooldown;
      const reach = p.miningReach || 54;
      const hitbox = { x: p.facing > 0 ? p.x + p.w : p.x - reach, y: p.y - 8, w: reach, h: p.h + 16 };
      const rock = s.rocks.find(r => r.hp > 0 && overlap(hitbox, r));
      if (rock) {
        rock.hp = Math.max(0, rock.hp - p.miningPower);
        s.events.push({ type: 'mine', x: rock.x + rock.w / 2, y: rock.y + 15 });
        if (!rock.hp) { s.mined++; s.collected += 2; s.events.push({ type: 'collect', x: rock.x, y: rock.y }); }
      } else {
        s.events.push({ type: 'mine_miss', x: p.x + (p.facing > 0 ? p.w + 10 : -10), y: p.y + 15 });
      }
    }

    // ATTACK Action: targets enemies only
    if ((mask & INPUT.ATTACK) && !p.attack) {
      p.attack = p.attackCooldown;
      s.events.push({ type: 'attack', x: p.x, y: p.y, facing: p.facing, hero: p.hero });
      if (p.hero === 'archer') {
        s.projectiles.push({
          x: p.facing > 0 ? p.x + p.w : p.x - 14,
          y: p.y + 14,
          vx: p.facing * 450,
          vy: 0,
          w: 14, h: 4,
          life: Math.ceil(p.attackRange / (450 / FPS)),
          damage: p.damage,
          owner: 'player',
        });
      } else {
        const hitbox = { x: p.facing > 0 ? p.x + p.w : p.x - p.attackRange, y: p.y - 8, w: p.attackRange, h: p.h + 16 };
        for (const enemy of s.enemies) {
          if (!enemy.dead && overlap(hitbox, enemy)) {
            enemy.hp -= p.damage;
            enemy.hurtCooldown = 20;
            enemy.vx = p.facing * 100;
            s.events.push({ type: 'hit', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2, damage: p.damage });
            if (enemy.hp <= 0) {
              enemy.dead = true;
              s.defeated = (s.defeated || 0) + 1;
              s.events.push({ type: 'enemy_death', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2 });
            }
          }
        }
      }
    }

    // SKILL Action: character special ability
    if ((mask & INPUT.SKILL) && p.skillCooldown <= 0) {
      p.skillCooldown = p.skillMaxCooldown;
      s.events.push({ type: 'skill', x: p.x, y: p.y, hero: p.hero });
      if (p.hero === 'miner') {
        const slamBox = { x: p.x - 80, y: p.y - 10, w: p.w + 160, h: p.h + 20 };
        for (const enemy of s.enemies) {
          if (!enemy.dead && overlap(slamBox, enemy)) {
            enemy.hp -= 2;
            enemy.hurtCooldown = 28;
            s.events.push({ type: 'hit', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2, damage: 2 });
            if (enemy.hp <= 0) {
              enemy.dead = true;
              s.defeated = (s.defeated || 0) + 1;
              s.events.push({ type: 'enemy_death', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2 });
            }
          }
        }
      } else if (p.hero === 'warrior') {
        p.vx = p.facing * 440;
        p.invulnerable = Math.max(p.invulnerable, 22);
        const dashBox = { x: p.facing > 0 ? p.x : p.x - 85, y: p.y - 6, w: p.w + 85, h: p.h + 12 };
        for (const enemy of s.enemies) {
          if (!enemy.dead && overlap(dashBox, enemy)) {
            enemy.hp -= 2;
            enemy.hurtCooldown = 25;
            enemy.vx = p.facing * 140;
            s.events.push({ type: 'hit', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2, damage: 2 });
            if (enemy.hp <= 0) {
              enemy.dead = true;
              s.defeated = (s.defeated || 0) + 1;
              s.events.push({ type: 'enemy_death', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2 });
            }
          }
        }
      } else if (p.hero === 'archer') {
        for (const vy of [-90, 0, 90]) {
          s.projectiles.push({
            x: p.facing > 0 ? p.x + p.w : p.x - 14,
            y: p.y + 14,
            vx: p.facing * 450,
            vy,
            w: 14, h: 4,
            life: 55,
            damage: 1,
            owner: 'player',
          });
        }
      }
      // The same pickaxe is a close-range attack. Each swing hits once.
      for (const enemy of s.enemies) if (enemy.hp > 0 && overlap(hitbox, enemy)) {
        enemy.hp--; s.events.push({ type: 'mine', x: enemy.x + enemy.w / 2, y: enemy.y });
        if (!enemy.hp) { s.defeated++; if (enemy.kind === 'boss') s.bossDefeated = true; s.events.push({ type: 'defeat', x: enemy.x, y: enemy.y }); }
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
    if (!wasGrounded && p.grounded) {
      p.landTimer = 6;
      s.events.push({ type: 'land', x: p.x, y: p.y + p.h });
    }
    if (p.landTimer > 0) p.landTimer--;

    // Projectile physics and collisions
    for (let i = s.projectiles.length - 1; i >= 0; i--) {
      const proj = s.projectiles[i];
      proj.x += proj.vx * DT;
      proj.y += proj.vy * DT;
      proj.life--;
      let hit = false;
      for (const box of solids) {
        if (overlap(proj, box)) { hit = true; break; }
      }
      if (!hit) {
        for (const enemy of s.enemies) {
          if (!enemy.dead && overlap(proj, enemy)) {
            hit = true;
            enemy.hp -= proj.damage;
            enemy.hurtCooldown = 20;
            enemy.vx = (proj.vx > 0 ? 1 : -1) * 90;
            s.events.push({ type: 'hit', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2, damage: proj.damage });
            if (enemy.hp <= 0) {
              enemy.dead = true;
              s.defeated = (s.defeated || 0) + 1;
              s.events.push({ type: 'enemy_death', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2 });
            }
            break;
          }
        }
      }
      if (hit || proj.life <= 0) s.projectiles.splice(i, 1);
    }

    // Enemy AI and movement
    for (const enemy of s.enemies) {
      if (enemy.dead) continue;
      if (enemy.hurtCooldown > 0) enemy.hurtCooldown--;
      if (enemy.attackCooldown > 0) enemy.attackCooldown--;

      if (enemy.flying) {
        enemy.x += enemy.vx * DT;
        enemy.y = enemy.baseY + Math.sin(s.tick * 0.08 + enemy.id) * 10;
        if (enemy.x <= enemy.minX) { enemy.vx = Math.abs(enemy.patrolSpeed || 55); enemy.facing = 1; }
        else if (enemy.x >= enemy.maxX) { enemy.vx = -Math.abs(enemy.patrolSpeed || 55); enemy.facing = -1; }
      } else {
        const dx = p.x - enemy.x;
        const dy = p.y - enemy.y;
        const dist = Math.hypot(dx, dy);
        const inSight = dist < 140 && Math.abs(dy) < 40 && p.hearts > 0;
        enemy.alert = inSight;
        if (inSight && enemy.hurtCooldown <= 0) {
          const chaseDir = dx > 0 ? 1 : -1;
          enemy.facing = chaseDir;
          const targetVx = chaseDir * (enemy.chaseSpeed || 65);
          enemy.vx = targetVx;
          const nextX = enemy.x + enemy.vx * DT;
          if (nextX >= enemy.minX && nextX <= enemy.maxX) enemy.x = nextX;
        } else {
          enemy.x += enemy.vx * DT;
          if (enemy.x <= enemy.minX) { enemy.vx = Math.abs(enemy.patrolSpeed || 40); enemy.facing = 1; }
          else if (enemy.x >= enemy.maxX) { enemy.vx = -Math.abs(enemy.patrolSpeed || 40); enemy.facing = -1; }
        }
      }

      // Enemy attacking player
      if (p.hearts > 0 && overlap(p, enemy)) {
        if (!p.invulnerable && enemy.attackCooldown <= 0) {
          hurt(s);
          enemy.attackCooldown = 60;
          s.events.push({ type: 'enemy_attack', x: enemy.x, y: enemy.y, enemyId: enemy.id });
        }
      }
    }

    if (p.x > 910 && p.x < 1000 && p.grounded) s.checkpoint = 920;
    if (p.x > 1700 && p.x < 1780 && p.grounded) s.checkpoint = 1710;
    for (const gem of s.gems) if (!gem.taken && overlap(p, { x: gem.x - 9, y: gem.y - 10, w: 18, h: 20 })) {
      gem.taken = true; s.collected++; s.events.push({ type: 'collect', x: gem.x, y: gem.y });
    }
    if (p.y > LEVEL.height + 50) {
      if (p.invulnerable) { p.x = s.checkpoint; p.y = 240; p.vx = p.vy = 0; }
      else hurt(s);
    }
    for (const hazard of LEVEL.hazards) if (activeHazard(hazard, s.tick) && overlap(p, hazard)) hurt(s);
    if (s.status === 'playing' && canExit(s) && overlap(p, LEVEL.exit)) {
      s.status = 'won'; s.events.push({ type: 'win', x: p.x, y: p.y });
    }
    if (s.tick >= MAX_TICKS && s.status === 'playing') {
      s.status = 'lost';
      p.pose = 'dead';
    }

    p.pose = s.status === 'won' ? 'victory' :
      s.status === 'lost' || p.hearts <= 0 ? 'dead' :
      p.invulnerable > 60 ? 'hurt' :
      p.attack > 4 ? ((mask & INPUT.ATTACK) ? 'attack' : 'mine') :
      p.landTimer > 2 ? 'land' :
      !p.grounded ? (p.vy < 0 ? 'jump' : 'fall') :
      direction ? 'run' : 'idle';

    s.lastMask = mask;
    return s;
  }

  function replay(inputs, hero = 'miner', seed) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1000) return { ok: false, reason: 'inputs' };
    let total = 0;
    for (const item of inputs) {
      if (!item || !Number.isInteger(item.mask) || item.mask < 0 || item.mask > MAX_MASK || !Number.isInteger(item.frames) || item.frames < 1 || (total += item.frames) > MAX_TICKS) return { ok: false, reason: 'inputs' };
    }
    const s = create(hero, seed);
    for (const item of inputs) for (let i = 0; i < item.frames; i++) {
      if (s.status !== 'playing') return { ok: false, reason: 'after_end' };
      step(s, item.mask);
    }
    return { ok: true, state: s };
  }

  const cameraFor = (s, width) => Math.max(0, Math.min(LEVEL.width - width, s.player.x + s.player.w / 2 - width * 0.35));
  const rewardFor = s => s.status === 'won' ? Math.min(100, 40 + s.collected * 4 + s.mined * 6) : 0;

  return { VERSION, FPS, DT, MAX_TICKS, INPUT, CHARACTERS, LEVEL, seedFromId, layoutFor, create, step, replay, overlap, activeHazard, canExit, cameraFor, rewardFor };
});
