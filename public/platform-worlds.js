'use strict';
(function (root, factory) {
  const worlds = factory();
  if (typeof module === 'object' && module.exports) module.exports = worlds;
  else root.PlatformWorlds = worlds;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STONE = {
    id: 'stone', width: 2680, height: 360, exit: { x: 2540, y: 222, w: 70, h: 78 },
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
  };

  // تنويع المرحلة من بذرة الجولة: مواقع الصخور والبلورات وبداية دوريات الأعداء تتغير داخل نطاقات
  // مدروسة (التضاريس والفجوات والفخاخ ثابتة)، فلا يصلح تسجيل حركات جولة لإعادة استخدامه في أخرى.
  // البذرة تُشتق من معرّف الجولة الذي يصدره الخادم؛ الخادم يعيد التشغيل بالبذرة نفسها ولا يقبلها من العميل.
  // كل صخرة تختار مقطعاً ثم موقعاً داخله (بعيداً عن الفجوات والفخاخ ومنطقة البداية)
  // (لا صخرة بعد قفزة فوق فجوة/فخ مباشرة ولا تحت منصة منخفضة: الوقوف عليها يحبس اللاعب)
  const ROCK_SPANS = [[[250, 600]], [[915, 1095]], [[1790, 1980], [2330, 2420]]];
  const GEM_SPANS = [[156, 236], [270, 355], [570, 645], [820, 900], [910, 985], [1330, 1415], [1700, 1760], [1790, 1875], [2190, 2300], [2440, 2510]];
  // كل ما يخص مستوىً واحداً يعيش معه: نطاقات التوزيع العشوائي، رايات الحفظ (من/إلى = منطقة اللمس، at = موضع العودة)،
  // لافتات الاتجاه. فتحة البخار الأولى (vent) هي «خطر المنجم الموقوت»: تتبع مدة نشاطها صعوبة المنجم المختار.
  Object.assign(STONE, {
    rockSpans: ROCK_SPANS, gemSpans: GEM_SPANS, boss: null,
    checkpoints: [{ from: 910, to: 1000, at: 920 }, { from: 1700, to: 1780, at: 1710 }],
    signs: [680, 1485, 2030],
  });
  STONE.hazards[0].vent = true; STONE.hazards[0].kind = 'vent'; STONE.hazards[1].kind = 'pit';
  // ===== عوالم المناجم 1-5 =====
  // لكل منجم مستوىً كاملاً (أرض وفجوات وحواف وصخور وبلّورات وأخطار وحرّاس وراياتٌ، وزعيم في الثالث والسادس). المنجم 0 يبقى حرفياً كما كان
  // (تطابق V3 مُختبَر). makeLevel يبني نفس بنية STONE من وصف مختصر: ground = مقاطع الأرض (الفراغ بينها فجوة)، ledges = [x,y,عرض]،
  // rocks/gems = نطاقات التوزيع العشوائي (الصخرة x فقط، البلّورة x وارتفاعها)، guards = حارس على حافة أو خفاش بين x0..x1.
  // قواعد الفسحة (تتحقق منها الاختبارات): لا صخرة ولا حافة ضمن منطقة قفز، وبعد كل خطر مساحة هبوط، والعدد دائماً 3 صخور و10 بلّورات و6 حرّاس
  // فلا تتغير أرقام المكافأة بين المناجم.
  const ROCK_BOX = { y: 252, w: 46, h: 48 };
  const GUARDS = {
    goblin: { name: 'غول الكهف', w: 26, h: 32, maxHp: 2, patrolSpeed: 40, chaseSpeed: 70, flying: false },
    beetle: { name: 'خنفساء الصخور', w: 28, h: 24, maxHp: 3, patrolSpeed: 30, chaseSpeed: 50, flying: false },
    bat: { name: 'خفاش الظلام', w: 24, h: 22, maxHp: 1, patrolSpeed: 55, chaseSpeed: 80, flying: true },
  };
  function makeLevel(o) {
    const mid = (a, b) => Math.round((a + b) / 2);
    const platforms = [...o.ground.map(([a, b]) => ({ x: a, y: 300, w: b - a, h: 80 })), ...o.ledges.map(([x, y, w]) => ({ x, y, w, h: 20 })), ...(o.branchLedges || []).map(([x, y, w]) => ({ x, y, w, h: 20, route: 'upper' }))];
    const enemies = o.guards.map((g, i) => {
      const base = GUARDS[g[0]], id = i + 1;
      if (g[0] === 'bat') {
        const [, a, b, y] = g;
        return { id, type: 'bat', name: base.name, x: mid(a, b), y, w: base.w, h: base.h, minX: a, maxX: b, baseY: y, maxHp: base.maxHp, patrolSpeed: base.patrolSpeed, chaseSpeed: base.chaseSpeed, damage: 1, flying: true };
      }
      const [lx, ly, lw] = o.ledges[g[1]];
      return { id, type: g[0], name: base.name, x: lx + 12, y: ly - base.h, w: base.w, h: base.h, minX: lx + 6, maxX: lx + lw - base.w - 6, maxHp: base.maxHp, patrolSpeed: base.patrolSpeed, chaseSpeed: base.chaseSpeed, damage: 1, flying: false };
    });
    let boss = null;
    if (o.boss) {
      const b = o.boss;
      enemies.push({ id: 90, type: 'boss', boss: true, kind: b.kind, name: b.name, x: b.maxX, y: 300 - b.h, w: b.w, h: b.h, minX: b.minX, maxX: b.maxX, wake: b.wake, maxHp: b.maxHp,
        patrolSpeed: b.patrolSpeed, chaseSpeed: b.patrolSpeed, chargeSpeed: b.chargeSpeed, damage: 1, flying: false, ai: b.ai });
      boss = { id: 90, kind: b.kind, name: b.name, maxHp: b.maxHp };
    }
    return {
      id: o.id, width: 2680, height: 360, exit: { x: o.exit.x, y: 222, w: 70, h: 78 }, platforms,
      rocks: o.rocks.map(spans => ({ x: mid(spans[0][0], spans[0][1]), ...ROCK_BOX })),
      gems: o.gems.map(([a, b, y]) => ({ x: mid(a, b), y })),
      hazards: o.hazards, enemies,
      rockSpans: o.rocks, gemSpans: o.gems.map(([a, b]) => [a, b]),
      checkpoints: o.checkpoints, signs: o.signs, boss,
    };
  }
  // الفخ الموقوت المعلَّم vent: true لا يكتب هنا مدة نشاطه (active) عمداً: تأتي من المنجم (MINES[i].vent) عند إنشاء الجولة، فمصدرها واحد.
  const WORLD_SPECS = [
    // المنجم 1 — الحديد: ثلاث فجوات، مكبس سحق عالٍ موقوت (انتظر نافذته) وحفرة أشواك.
    {
      id: 'iron', exit: { x: 2540 },
      // مسار علوي اختياري يعبر حفرة الأشواك، ثم يعود إلى الأرض الآمنة.
      branchLedges: [[1545, 230, 100], [1655, 230, 100]],
      ground: [[0, 560], [655, 1235], [1340, 1960], [2055, 2680]],
      ledges: [[390, 232, 100], [1090, 226, 70], [2150, 230, 110], [2310, 224, 120]],
      rocks: [[[170, 310]], [[740, 860]], [[1440, 1500]]],
      gems: [[120, 150, 276], [410, 460, 209], [1105, 1130, 203], [690, 715, 276], [1560, 1600, 276], [2170, 2200, 207], [2330, 2400, 201], [2450, 2500, 276], [1860, 1880, 276], [2225, 2245, 207]],
      hazards: [
        { x: 1010, y: 160, w: 46, h: 140, period: 220, vent: true, kind: 'crusher' },
        { x: 1620, y: 279, w: 48, h: 21, period: 1, active: 1, kind: 'pit' },
      ],
      guards: [['goblin', 0], ['beetle', 1], ['goblin', 2], ['beetle', 3], ['bat', 300, 460, 112], ['bat', 2200, 2400, 110]],
      checkpoints: [{ from: 700, to: 780, at: 710 }, { from: 1400, to: 1480, at: 1410 }],
      signs: [520, 1195, 1920],
    },
    // المنجم 2 — الذهب: فجوتان، فتحة غبار ذهبي، حفرة، وعملاق الذهب في الساحة الأخيرة.
    {
      id: 'gold', exit: { x: 2540 },
      // ممر مرتفع يتجاوز حفرة المدخل؛ يمكن للاعب اختيار القفز فوقها أو المخاطرة بالعبور أرضاً.
      branchLedges: [[420, 230, 100], [530, 230, 100]],
      ground: [[0, 720], [820, 1470], [1570, 2680]],
      // Keep the ordinary ledge clear of the upper-route ladder platform; overlapping
      // same-height solids created an ambiguous collision edge at the ladder exit.
      ledges: [[320, 230, 90], [1210, 224, 90]],
      rocks: [[[110, 190]], [[900, 960]], [[1650, 1700]]],
      gems: [[150, 180, 276], [350, 400, 207], [1230, 1280, 201], [1010, 1030, 276], [640, 660, 276], [1330, 1350, 276], [1780, 1820, 276], [2100, 2200, 276], [2300, 2400, 276], [840, 880, 276]],
      hazards: [
        { x: 1090, y: 265, w: 42, h: 35, period: 180, vent: true, kind: 'vent' },
        { x: 520, y: 279, w: 48, h: 21, period: 1, active: 1, kind: 'pit' },
      ],
      guards: [['goblin', 0], ['beetle', 1], ['bat', 250, 420, 112], ['bat', 900, 1100, 108], ['bat', 1250, 1420, 112], ['bat', 100, 300, 110]],
      checkpoints: [{ from: 1000, to: 1040, at: 1010 }, { from: 1600, to: 1640, at: 1610 }],
      signs: [680, 1430],
      boss: { kind: 'colossus', name: 'عملاق الذهب', w: 58, h: 66, minX: 1800, maxX: 2440, wake: 1750, maxHp: 17, patrolSpeed: 42, chargeSpeed: 0,
        ai: { walk: 90, windup: 40, recover: 80, enragedWalk: 60, enragedWindup: 30,
          attacks: ['slam'], enragedAttacks: ['slam', 'pound'], finalAttacks: ['sweep', 'pound', 'slam'],
          pound: { radius: 96 }, sweep: { reach: 84 }, wave: { speed: 230, w: 30, h: 22, ttl: 64 } } },
    },
    // المنجم 3 — البلّور: ثلاث فجوات وثلاثة أخطار قصيرة (فتحة بلّور، أشواك موقوتة بطور مختلف، حفرة).
    {
      id: 'crystal', exit: { x: 2540 },
      // شرفة بلورية علوية تتيح تجاوز حفرة المسار الرئيسي.
      branchLedges: [[2090, 230, 100], [2200, 230, 100]],
      ground: [[0, 560], [650, 1250], [1340, 1960], [2050, 2680]],
      ledges: [[380, 230, 90], [1590, 226, 80], [2330, 222, 100], [2440, 230, 80]],
      rocks: [[[160, 300]], [[720, 820]], [[1420, 1500]]],
      gems: [[110, 140, 276], [395, 450, 207], [1000, 1030, 276], [1600, 1650, 203], [1200, 1230, 276], [2350, 2400, 199], [2460, 2500, 207], [2290, 2310, 276], [1880, 1900, 276], [870, 900, 276]],
      hazards: [
        { x: 1000, y: 265, w: 42, h: 35, period: 180, vent: true, kind: 'crystal' },
        { x: 1760, y: 265, w: 42, h: 35, period: 150, active: 60, phase: 40, kind: 'crystal' },
        { x: 2190, y: 279, w: 48, h: 21, period: 1, active: 1, kind: 'pit' },
      ],
      guards: [['bat', 380, 520, 112], ['goblin', 0], ['bat', 1560, 1700, 110], ['goblin', 2], ['beetle', 3], ['bat', 2150, 2330, 108]],
      checkpoints: [{ from: 700, to: 780, at: 710 }, { from: 1400, to: 1480, at: 1410 }],
      signs: [520, 1210, 1920],
    },
    // المنجم 4 — الحمم: نوافير حمم تنطلق من الفجوات (اعبر في لحظة هدوئها) مع حفرة وشعلة موقوتة.
    {
      id: 'lava', exit: { x: 2540 },
      // ممر علوي فوق حفرة الحمم، بعيد عن فوهات النوافير.
      branchLedges: [[1590, 230, 100], [1700, 230, 100]],
      ground: [[0, 560], [665, 1240], [1350, 1960], [2065, 2680]],
      ledges: [[360, 230, 100], [2340, 228, 100], [2450, 224, 70]],
      rocks: [[[170, 300]], [[780, 900]], [[1420, 1500]]],
      gems: [[120, 150, 276], [380, 440, 207], [1000, 1040, 276], [1190, 1210, 276], [1560, 1600, 276], [2360, 2420, 205], [2460, 2500, 201], [1100, 1130, 276], [1880, 1900, 276], [2100, 2150, 276]],
      hazards: [
        { x: 595, y: 185, w: 34, h: 145, period: 240, vent: true, kind: 'geyser' },
        { x: 1278, y: 185, w: 34, h: 145, period: 210, active: 70, phase: 60, kind: 'geyser' },
        { x: 1680, y: 279, w: 48, h: 21, period: 1, active: 1, kind: 'pit' },
        { x: 2210, y: 265, w: 42, h: 35, period: 170, active: 70, phase: 20, kind: 'flare' },
      ],
      guards: [['beetle', 0], ['bat', 700, 900, 110], ['beetle', 1], ['goblin', 2], ['bat', 1400, 1600, 110], ['bat', 2250, 2400, 108]],
      checkpoints: [{ from: 700, to: 780, at: 710 }, { from: 1400, to: 1480, at: 1410 }],
      signs: [520, 1200, 1920],
    },
    // المنجم 5 — الأسطورة: مكبس وحفرة ثم حارس القلب (اندفاع وموجة صدم) في ساحة طويلة.
    {
      id: 'legend', exit: { x: 2540 },
      // طريق علوي اختياري يتجاوز حفرة قلب الأسطورة.
      branchLedges: [[1470, 230, 100], [1580, 230, 100]],
      ground: [[0, 540], [640, 1180], [1280, 2680]],
      ledges: [[340, 230, 100], [1020, 226, 80]],
      rocks: [[[130, 230]], [[720, 790]], [[1350, 1400]]],
      gems: [[110, 130, 276], [360, 420, 207], [1035, 1065, 203], [1130, 1160, 276], [1500, 1540, 276], [2100, 2200, 276], [2300, 2400, 276], [480, 510, 276], [880, 900, 276], [660, 690, 276]],
      hazards: [
        { x: 930, y: 160, w: 46, h: 140, period: 240, vent: true, kind: 'crusher' },
        { x: 1560, y: 279, w: 48, h: 21, period: 1, active: 1, kind: 'pit' },
      ],
      guards: [['goblin', 0], ['beetle', 1], ['bat', 300, 500, 112], ['bat', 700, 900, 108], ['bat', 1300, 1450, 110], ['bat', 1500, 1700, 112]],
      checkpoints: [{ from: 700, to: 760, at: 710 }, { from: 1680, to: 1720, at: 1690 }],
      signs: [500, 1140],
      boss: { kind: 'warden', name: 'حارس القلب', w: 56, h: 46, minX: 1840, maxX: 2450, wake: 1800, maxHp: 29, patrolSpeed: 50, chargeSpeed: 215,
        ai: { walk: 60, windup: 44, recover: 70, enragedWalk: 40, enragedWindup: 32, chargeTicks: 70,
          attacks: ['charge', 'slam'], enragedAttacks: ['charge', 'slam', 'charge'],
          finalAttacks: ['sweep', 'pound', 'charge', 'slam'], pound: { radius: 104 }, sweep: { reach: 88 },
          wave: { speed: 250, w: 30, h: 22, ttl: 64 } } },
    },
  ];
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  const LEVELS = Object.freeze([STONE, ...WORLD_SPECS.map(makeLevel)].map(deepFreeze));
  // رقم المنجم ← مستواه (خارج النطاق = الأول، كما يفعل mineOf)
  const levelFor = zone => LEVELS[Number.isInteger(zone) && zone >= 0 && zone < LEVELS.length ? zone : 0];
  const LEVEL = LEVELS[0]; // الاسم القديم: مستوى المنجم الأول
  return Object.freeze({ LEVEL, LEVELS, levelFor, goblinGuard: GUARDS.goblin });
});
