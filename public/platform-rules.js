/* Original deterministic platform physics, shared by browser and server. No assets/dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 4;
  // المرحلة 3: ستة مناجم حقيقية + ثماني معدات دائمة. «إعداد الجولة» (المنجم + مستويات المعدات) يُثبَّت في تذكرة الجولة
  // عند /api/platform/start ويُعاد التشغيل به خادمياً؛ شراء معدّة أثناء جولة لا يغيّر تلك الجولة (لقطة غير قابلة للتعديل).
  // منجم 0 + معدات صفرية ≡ سلوك V3 في الفيزياء والمواضع، فلا تنكسر الحلول المختبرة.
  const MAX_EQUIP_LEVEL = 5;
  // المرحلة 2: خامات تُجمع داخل الجولة + معالم تمنح أجزاءً من مكافأة الجولة نفسها.
  // الأسعار ثابتة خادمياً (server.js يقرأ Rules.ORES) ولا تُرسل من العميل.
  const ORES = Object.freeze({
    copper:  { name: 'نحاس',   price: 2 },
    iron:    { name: 'حديد',   price: 4 },
    gold:    { name: 'ذهب خام', price: 8 },
    crystal: { name: 'بلّور',  price: 12 },
    lava:    { name: 'حمم',    price: 20 },
  });
  const ORE_ORDER = Object.keys(ORES);
  const MILESTONE_GOLD = 12;
  // حزم الخامات تُعرَّف بخانات (common/mid/rare) وتُحلّ إلى خامات المنجم نفسه: المنجم الأعمق = خامات أغلى بالأعداد نفسها.
  const MILESTONES = Object.freeze([
    { id: 'first_rock', label: 'أول عِرق مكسور', slots: { common: 2, mid: 1 }, check: s => s.mined >= 1 },
    { id: 'three_gems', label: '3 بلورات',        slots: { common: 2, rare: 1 }, check: s => s.collected >= 3 },
    { id: 'checkpoint', label: 'راية الأمان',      slots: { mid: 2 }, check: s => s.checkpoint !== 64 },
    { id: 'guard',      label: 'حارس مهزوم',      slots: { rare: 1, mid: 1 }, check: s => s.defeated >= 1 },
    { id: 'chest',      label: 'صندوق الكنز',     slots: { rare: 2, mid: 1 }, check: s => s.chestFound === true },
  ]);
  const CHEST_SLOTS = Object.freeze({ common: 2, mid: 2, rare: 2 });
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
  // ستة مناجم حقيقية يختار اللاعب منها ما فُتح له (التحقق خادمي). كل منجم يغيّر: صلابة الصخور، جدول الخامات،
  // صحة الأعداء وسرعتهم، ومدة نشاط فتحة البخار. الفيزياء والمستوى ثابتان؛ كل شيء حتمي من (البذرة، المنجم، المعدات).
  // weights = نسب مئوية لخانات (common, mid, rare) عند اختيار خام كل صخرة. requires: الفوز في منجم سابق + حد أدنى للمعدات.
  const MINES = Object.freeze([
    { id: 'stone',   name: 'المنجم الحجري',   blurb: 'نحاس وحديد — بداية آمنة',        rockHp: 3,  enemyHp: 0, enemySpeed: 100, vent: 84,
      tier: { common: 'copper',  mid: 'iron',    rare: 'gold' },    weights: [72, 24, 4],  requires: null },
    { id: 'iron',    name: 'مناجم الحديد',    blurb: 'عروق حديد وصخور أصلب',            rockHp: 6,  enemyHp: 0, enemySpeed: 105, vent: 90,
      tier: { common: 'copper',  mid: 'iron',    rare: 'gold' },    weights: [35, 50, 15], requires: { win: 0 } },
    { id: 'gold',    name: 'الكهوف الذهبية',  blurb: 'ذهب خام وبلّور نادر',             rockHp: 9,  enemyHp: 1, enemySpeed: 110, vent: 96,
      tier: { common: 'iron',    mid: 'gold',    rare: 'crystal' }, weights: [35, 50, 15], requires: { win: 1, gear: { pickaxe: 1 } } },
    { id: 'crystal', name: 'أعماق البلّور',   blurb: 'بلّور وفير وبعض الحمم',           rockHp: 13, enemyHp: 1, enemySpeed: 115, vent: 102,
      tier: { common: 'gold',    mid: 'crystal', rare: 'lava' },    weights: [35, 50, 15], requires: { win: 2, gear: { pickaxe: 2, armor: 1 } } },
    { id: 'lava',    name: 'بحيرة الحمم',     blurb: 'حمم ملتهبة وأعداء أشدّ',          rockHp: 18, enemyHp: 2, enemySpeed: 120, vent: 108,
      tier: { common: 'crystal', mid: 'lava',    rare: 'lava' },    weights: [35, 50, 15], requires: { win: 3, gear: { pickaxe: 3, armor: 2 } } },
    { id: 'legend',  name: 'قلب الأسطورة',    blurb: 'أصلب الصخور وأغنى الحمم',         rockHp: 24, enemyHp: 3, enemySpeed: 125, vent: 114,
      tier: { common: 'crystal', mid: 'lava',    rare: 'lava' },    weights: [15, 50, 35], requires: { win: 4, gear: { pickaxe: 4, armor: 3 } } },
  ]);
  const PALETTES = {
    stone:   { sky: ['#0d0e10', '#16181b', '#1f2226', '#2a2e33', '#343a40'], far: '#14161a', mid: '#1c1f24', columns: '#272b31', glow: '#e8c07a', crystal: '#9fb3b8' },
    iron:    { sky: ['#0b0f14', '#121a22', '#1a252f', '#232f3b', '#2c3a48'], far: '#10171e', mid: '#17212b', columns: '#202c38', glow: '#b8c7d6', crystal: '#8fa5ba' },
    gold:    { sky: ['#120d05', '#1f1608', '#2d200c', '#3d2c10', '#4d3813'], far: '#1c1407', mid: '#2a1d0b', columns: '#38270f', glow: '#ffd166', crystal: '#e6b422' },
    crystal: { sky: ['#080e1a', '#0c1e2e', '#112838', '#1a3545', '#1e3a4a'], far: '#0a1a28', mid: '#0d2233', columns: '#143040', glow: '#3ee6b3', crystal: '#39a9a4' },
    lava:    { sky: ['#160a08', '#2a110c', '#3d1810', '#542318', '#6a2c1e'], far: '#2a120c', mid: '#3d1d14', columns: '#4a2116', glow: '#ff8a3d', crystal: '#ff7043' },
    legend:  { sky: ['#0e0718', '#1a0f2a', '#28163d', '#381f52', '#462862'], far: '#1a0f2b', mid: '#2a1a40', columns: '#331f4d', glow: '#d58bff', crystal: '#b06bea' },
  };
  // لوحات الألوان التجميلية صارت مرتبطة بالمنجم المختار لا ببذرة الجولة.
  const ZONES = Object.freeze(MINES.map(m => Object.freeze({ id: m.id, name: m.name, ...PALETTES[m.id] })));
  const mineOf = zone => MINES[Number.isInteger(zone) && zone >= 0 && zone < MINES.length ? zone : 0];

  // المعدات الثمانية (ترتيبها = ترتيب دوائر الورشة). السعر: ذهب + خام «سلّم» ثابت حسب المستوى الحالي:
  // نحاس ← حديد ← ذهب خام ← بلّور ← حمم، فيدفع التقدّم اللاعب إلى مناجم أعمق. كل الأرقام صحيحة (بلا فواصل عائمة).
  const EQUIPMENT_ORDER = Object.freeze(['pickaxe', 'boots', 'bag', 'magnet', 'drill', 'robot', 'luck', 'armor']);
  const EQUIPMENT = Object.freeze({
    pickaxe: { name: 'قوة المعول',    icon: 'i-pickaxe', blurb: 'تكسير الصخور بضربات أقل',        gold: 50,  scale: 10 },
    boots:   { name: 'حذاء المعدّن',  icon: 'i-boots',   blurb: 'حركة أسرع داخل المنجم',           gold: 60,  scale: 10 },
    bag:     { name: 'حقيبة الموارد', icon: 'i-bag',     blurb: 'خامات أكثر من كل صخرة',           gold: 70,  scale: 12 },
    magnet:  { name: 'المغناطيس',     icon: 'i-magnet',  blurb: 'جذب البلورات من مسافة أبعد',      gold: 80,  scale: 12 },
    drill:   { name: 'المثقاب',       icon: 'i-drill',   blurb: 'ضربات أسرع ومدى أطول',            gold: 90,  scale: 15 },
    robot:   { name: 'روبوت التعدين', icon: 'i-robot',   blurb: 'يضرب أقرب صخرة تلقائياً',         gold: 100, scale: 15 },
    luck:    { name: 'حظ المعدّن',    icon: 'i-luck',    blurb: 'فرصة أعلى للخامات النادرة',       gold: 110, scale: 13 },
    armor:   { name: 'معدات الحماية', icon: 'i-armor',   blurb: 'قلوب إضافية وحماية أطول',         gold: 120, scale: 13 },
  });
  const ORE_LADDER = Object.freeze(['copper', 'iron', 'gold', 'crystal', 'lava']);
  const ORE_QTY = Object.freeze([6, 6, 6, 5, 4]);
  const GOLD_STEP = Object.freeze([100, 160, 256, 410, 655]); // نسب مئوية: ≈ ×1.6 لكل مستوى
  const levelOf = v => Math.max(0, Math.min(MAX_EQUIP_LEVEL, Math.floor(Number(v)) || 0));
  function normalizeLoadout(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = {};
    for (const id of EQUIPMENT_ORDER) out[id] = levelOf(src[id]);
    return out;
  }
  function normalizeConfig(input) {
    const src = input && typeof input === 'object' ? input : {};
    const zone = Number.isInteger(src.zone) && src.zone >= 0 && src.zone < MINES.length ? src.zone : 0;
    return { zone, loadout: normalizeLoadout(src.loadout) };
  }
  // تكلفة الترقية من المستوى الحالي إلى التالي (null عند المستوى الأقصى أو معدّة غير معروفة).
  function equipCost(id, level) {
    const def = EQUIPMENT[id], lvl = levelOf(level);
    if (!def || lvl >= MAX_EQUIP_LEVEL) return null;
    return { gold: Math.round(def.gold * GOLD_STEP[lvl] / 100), ores: { [ORE_LADDER[lvl]]: Math.ceil(ORE_QTY[lvl] * def.scale / 10) } };
  }
  // الإحصاءات النهائية للبطل بعد المعدات. كلها صحيحة/ثابتة فتبقى حتمية ومتطابقة بين المتصفح والخادم.
  function loadoutStats(heroId, loadout) {
    const hero = CHARACTERS[heroId] || CHARACTERS.miner, L = normalizeLoadout(loadout);
    const armorHearts = Math.floor((L.armor + 1) / 2);
    return {
      speed: Math.round(hero.speed * (100 + 4 * L.boots) / 100),
      hearts: hero.hearts + armorHearts,
      maxHearts: hero.maxHearts + armorHearts,
      hurtInvulnerable: (hero.hurtInvulnerable || 90) + 8 * L.armor,
      miningPower: hero.miningPower + L.pickaxe,
      attackCooldown: Math.max(8, hero.attackCooldown - L.drill),
      miningReach: hero.miningReach + 5 * L.drill,
      magnet: 12 * L.magnet,
      yieldPercent: 100 + 15 * L.bag,
      luck: L.luck,
      robot: L.robot > 0 ? { period: 190 - 28 * L.robot, damage: 1 + L.robot, range: 170 } : null,
    };
  }
  const NO_BONUS = 'بلا إضافة';
  const EFFECT_TEXT = {
    pickaxe: L => (L ? `+${L} قوة تعدين لكل ضربة` : NO_BONUS),
    boots:   L => (L ? `+${4 * L}% سرعة حركة` : NO_BONUS),
    bag:     L => (L ? `+${15 * L}% خامات من كل صخرة` : NO_BONUS),
    magnet:  L => (L ? `مدى جذب البلورات +${12 * L} بكسل` : NO_BONUS),
    drill:   L => (L ? `زمن تبريد الضربة −${L} إطار · المدى +${5 * L} بكسل` : NO_BONUS),
    robot:   L => (L ? `ضربة آلية بقوة ${1 + L} كل ${((190 - 28 * L) / 60).toFixed(1)} ثانية` : 'غير مفعّل'),
    luck:    L => (L ? `+${4 * L}% فرصة للخام النادر` : NO_BONUS),
    armor:   L => (L ? `+${Math.floor((L + 1) / 2)} قلب · مهلة حماية بعد الإصابة +${(8 * L / 60).toFixed(1)} ثانية` : NO_BONUS),
  };
  const effectText = (id, level) => (EFFECT_TEXT[id] ? EFFECT_TEXT[id](levelOf(level)) : '');
  // عدد ضربات كسر صخرة المنجم للبطل والمعدات الحالية (يُعرض في الواجهة ولا يدخل في أي اقتصاد).
  const hitsToBreak = (heroId, zone, loadout) => Math.ceil(mineOf(zone).rockHp / loadoutStats(heroId, loadout).miningPower);

  // تقدّم المناجم الموثوق: عدد الانتصارات لكل منجم (يكتبه الخادم من جولات أعاد تشغيلها فقط).
  const normalizeProgress = input => {
    const wins = input && Array.isArray(input.wins) ? input.wins : [];
    return { wins: MINES.map((_, i) => Math.max(0, Math.floor(Number(wins[i])) || 0)) };
  };
  function mineStatus(zone, progress, loadout) {
    if (!Number.isInteger(zone) || zone < 0 || zone >= MINES.length) return null;
    const mine = MINES[zone], wins = normalizeProgress(progress).wins, L = normalizeLoadout(loadout);
    const needs = [];
    if (mine.requires) {
      const prev = mine.requires.win;
      needs.push({ kind: 'win', zone: prev, label: `الفوز في ${MINES[prev].name}`, ok: wins[prev] >= 1 });
      for (const [id, lvl] of Object.entries(mine.requires.gear || {})) {
        needs.push({ kind: 'gear', id, level: lvl, label: `${EQUIPMENT[id].name} مستوى ${lvl}`, ok: L[id] >= lvl });
      }
    }
    return { zone, id: mine.id, unlocked: needs.every(n => n.ok), needs, wins: wins[zone] };
  }
  const mineUnlocked = (zone, progress, loadout) => Boolean(mineStatus(zone, progress, loadout)?.unlocked);

  const emptyOres = () => Object.fromEntries(ORE_ORDER.map(k => [k, 0]));
  const addOres = (target, bundle) => {
    for (const [k, v] of Object.entries(bundle || {})) if (k in target) target[k] += v;
  };
  // يحلّ حزمة خانات إلى خامات المنجم (نفس الخام في خانتين يُجمع).
  const resolveSlots = (mine, slots) => {
    const out = {};
    for (const [slot, n] of Object.entries(slots)) { const ore = mine.tier[slot]; out[ore] = (out[ore] || 0) + n; }
    return out;
  };
  const milestoneOres = (zone, id) => {
    const m = MILESTONES.find(x => x.id === id);
    return m ? resolveSlots(mineOf(zone), m.slots) : {};
  };
  // الحظ ينقل نقاطاً مئوية من الخام الشائع إلى النادر (4 نقاط لكل مستوى) مع إبقاء 5% للشائع.
  function pickOre(mine, u, luck) {
    const [c, m, r] = mine.weights;
    const shift = Math.max(0, Math.min(c - 5, 4 * levelOf(luck)));
    const roll = u * 100;
    return mine.tier[roll < c - shift ? 'common' : roll < c - shift + m ? 'mid' : 'rare'];
  }

  function layoutFor(seed, zone = 0, luck = 0) {
    const mine = mineOf(zone);
    if (seed === undefined || seed === null) return {
      rocks: LEVEL.rocks.map((r, i) => ({ ...r, ore: mine.tier[['common', 'mid', 'rare'][i % 3]], yield: 2 + i % 3 })),
      gems: LEVEL.gems.map((g, i) => ({ ...g, chest: i === 4 })),
      enemies: LEVEL.enemies.map(e => ({ ...e, dir: 1 })),
    };
    const rnd = prng(Number(seed) >>> 0);
    const pick = ([a, b]) => Math.round(a + rnd() * (b - a));
    // IMPORTANT: مواضع الصخور/البلورات/الأعداء تُستهلك بنفس الترتيب القديم تماماً،
    // ثم تُسحب اختيارات الخامات والصندوق بعدها — فلا تتغير حلول الجولات المختبرة (ولا مواضع أي منجم).
    const rocks = LEVEL.rocks.map((r, i) => { const spans = ROCK_SPANS[i]; return { ...r, x: pick(spans[Math.floor(rnd() * spans.length)]) }; });
    const gems = LEVEL.gems.map((g, i) => ({ ...g, x: pick(GEM_SPANS[i]) }));
    const enemies = LEVEL.enemies.map(e => ({ ...e, x: pick([e.minX, e.maxX - e.w]), dir: rnd() < 0.5 ? -1 : 1 }));
    const chestAt = Math.floor(rnd() * gems.length);
    return {
      rocks: rocks.map(r => ({ ...r, ore: pickOre(mine, rnd(), luck), yield: 2 + Math.floor(rnd() * 3) })),
      gems: gems.map((g, i) => ({ ...g, chest: i === chestAt })),
      enemies,
    };
  }

  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const activeHazard = (h, tick) => tick % h.period < h.active;
  const canExit = s => s.mined >= 1 && s.collected >= 3;

  function create(heroId = 'miner', seed, config) {
    const hero = CHARACTERS[heroId] || CHARACTERS.miner;
    const cfg = normalizeConfig(config), mine = MINES[cfg.zone];
    const stats = loadoutStats(hero.id, cfg.loadout);
    const layout = layoutFor(seed, cfg.zone, cfg.loadout.luck);
    return {
      seed: seed === undefined || seed === null ? null : Number(seed) >>> 0,
      zone: cfg.zone,
      loadout: cfg.loadout,
      version: VERSION,
      tick: 0,
      status: 'playing',
      player: {
        hero: hero.id,
        x: 64, y: 262, w: 24, h: 38,
        vx: 0, vy: 0,
        speed: stats.speed,
        jumpSpeed: hero.jumpSpeed,
        grounded: true,
        facing: 1,
        hearts: stats.hearts,
        maxHearts: stats.maxHearts,
        invulnerable: 0,
        coyote: 6,
        jumpBuffer: 0,
        attack: 0,
        attackCooldown: stats.attackCooldown,
        damage: hero.damage,
        attackRange: hero.attackRange,
        miningPower: stats.miningPower,
        miningReach: stats.miningReach,
        hurtInvulnerable: stats.hurtInvulnerable,
        magnet: stats.magnet,
        yieldPercent: stats.yieldPercent,
        robot: stats.robot,
        skillCooldown: 0,
        skillMaxCooldown: hero.skillCooldown,
        pose: 'idle',
        landTimer: 0,
      },
      checkpoint: 64,
      rocks: layout.rocks.map(r => ({ ...r, hp: mine.rockHp, maxHp: mine.rockHp })),
      gems: layout.gems.map(g => ({ ...g, taken: false })),
      hazards: LEVEL.hazards.map((h, i) => (i === 0 ? { ...h, active: mine.vent } : { ...h })),
      enemies: layout.enemies.map(({ dir, ...e }) => {
        const maxHp = e.maxHp + mine.enemyHp;
        const patrolSpeed = Math.round((e.patrolSpeed || 40) * mine.enemySpeed / 100);
        const chaseSpeed = Math.round((e.chaseSpeed || 65) * mine.enemySpeed / 100);
        return {
          ...e,
          maxHp, patrolSpeed, chaseSpeed,
          hp: maxHp,
          vx: patrolSpeed * dir,
          vy: 0,
          facing: 1,
          attackCooldown: 0,
          hurtCooldown: 0,
          dead: false,
          alert: false,
        };
      }),
      projectiles: [],
      collected: 0,
      mined: 0,
      defeated: 0,
      damage: 0,
      milestones: [],
      chestFound: false,
      ores: emptyOres(),
      lastMask: 0,
      events: [],
    };
  }

  // ضربة على صخرة من اللاعب أو من الروبوت: عند الكسر تُضاف الخامات (مضروبة بنسبة الحقيبة، مقرّبة للأعلى).
  function hitRock(s, rock, damage, source) {
    const p = s.player;
    rock.hp = Math.max(0, rock.hp - damage);
    s.events.push({ type: source === 'robot' ? 'robot_mine' : 'mine', x: rock.x + rock.w / 2, y: rock.y + 15, damage });
    if (rock.hp) return;
    s.mined++; s.collected += 2;
    const ore = ORES[rock.ore] ? rock.ore : 'copper';
    const count = Math.ceil(Math.max(1, Math.floor(rock.yield) || 2) * (p.yieldPercent || 100) / 100);
    addOres(s.ores, { [ore]: count });
    s.events.push({ type: 'ore', ore, count, x: rock.x + rock.w / 2, y: rock.y + 8 });
    s.events.push({ type: 'collect', x: rock.x, y: rock.y });
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
      if (rock) hitRock(s, rock, p.miningPower, 'player');
      else s.events.push({ type: 'mine_miss', x: p.x + (p.facing > 0 ? p.w + 10 : -10), y: p.y + 15 });
    }

    // روبوت التعدين: نبضة آلية على أقرب صخرة ضمن مداه كل `period` إطاراً (حتمية: أول أقرب صخرة عند التعادل).
    if (p.robot && s.tick % p.robot.period === 0) {
      const cx = p.x + p.w / 2;
      let target = null, best = Infinity;
      for (const rock of s.rocks) {
        if (rock.hp <= 0) continue;
        const d = Math.abs(rock.x + rock.w / 2 - cx);
        if (d <= p.robot.range && d < best) { best = d; target = rock; }
      }
      if (target) hitRock(s, target, p.robot.damage, 'robot');
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
      // Enemy damage is handled by the ATTACK action above; no stray close-range
      // hitbox is in scope here (an undefined `hitbox` used to crash every skill).
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
    const pad = p.magnet || 0, mine = mineOf(s.zone);
    for (const gem of s.gems) if (!gem.taken && overlap(p, { x: gem.x - 9 - pad, y: gem.y - 10 - pad, w: 18 + 2 * pad, h: 20 + 2 * pad })) {
      gem.taken = true; s.collected++;
      if (gem.chest && !s.chestFound) {
        s.chestFound = true;
        const bundle = resolveSlots(mine, CHEST_SLOTS);
        addOres(s.ores, bundle);
        s.events.push({ type: 'chest', x: gem.x, y: gem.y, ores: bundle });
      } else addOres(s.ores, { [mine.tier.common]: 1 });
      s.events.push({ type: 'collect', x: gem.x, y: gem.y });
    }
    if (p.y > LEVEL.height + 50) {
      if (p.invulnerable) { p.x = s.checkpoint; p.y = 240; p.vx = p.vy = 0; }
      else hurt(s);
    }
    for (const hazard of s.hazards || LEVEL.hazards) if (activeHazard(hazard, s.tick) && overlap(p, hazard)) hurt(s);
    if (s.status === 'playing' && canExit(s) && overlap(p, LEVEL.exit)) {
      s.status = 'won'; s.events.push({ type: 'win', x: p.x, y: p.y });
    }
    if (s.tick >= MAX_TICKS && s.status === 'playing') {
      s.status = 'lost';
      p.pose = 'dead';
    }

    p.pose = s.status === 'won' ? 'victory' :
      s.status === 'lost' || p.hearts <= 0 ? 'dead' :
      p.invulnerable > (p.hurtInvulnerable || 90) - 30 ? 'hurt' : // المعدات تطيل الحماية لا وضعية الإصابة
      p.attack > 4 ? ((mask & INPUT.ATTACK) ? 'attack' : 'mine') :
      p.landTimer > 2 ? 'land' :
      !p.grounded ? (p.vy < 0 ? 'jump' : 'fall') :
      direction ? 'run' : 'idle';

    updateMilestones(s);
    s.lastMask = mask;
    return s;
  }

  function updateMilestones(s) {
    const mine = mineOf(s.zone);
    for (const m of MILESTONES) {
      if (s.milestones.includes(m.id) || !m.check(s)) continue;
      s.milestones.push(m.id);
      const ores = resolveSlots(mine, m.slots);
      addOres(s.ores, ores);
      s.events.push({ type: 'milestone', id: m.id, label: m.label, gold: MILESTONE_GOLD, ores,
        x: s.player.x + 12, y: s.player.y - 12 });
    }
  }

  function replay(inputs, hero = 'miner', seed, config) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1000) return { ok: false, reason: 'inputs' };
    let total = 0;
    for (const item of inputs) {
      if (!item || !Number.isInteger(item.mask) || item.mask < 0 || item.mask > MAX_MASK || !Number.isInteger(item.frames) || item.frames < 1 || (total += item.frames) > MAX_TICKS) return { ok: false, reason: 'inputs' };
    }
    const s = create(hero, seed, config);
    for (const item of inputs) for (let i = 0; i < item.frames; i++) {
      if (s.status !== 'playing') return { ok: false, reason: 'after_end' };
      step(s, item.mask);
    }
    return { ok: true, state: s };
  }

  const cameraFor = (s, width) => Math.max(0, Math.min(LEVEL.width - width, s.player.x + s.player.w / 2 - width * 0.35));
  // المكافأة الإجمالية لم تتغير عند الفوز: المعالم تفتح أجزاءً من نفس سقف الـ100،
  // والخسارة تحتفظ بما فتحته فعلاً فقط. لا توجد مكافأة إضافية فوق السقف.
  function rewardBreakdown(s) {
    const potential = Math.min(100, 40 + s.collected * 4 + s.mined * 6);
    const milestoneGold = Math.min(potential, (s.milestones?.length || 0) * MILESTONE_GOLD);
    const finalGold = s.status === 'won' ? Math.max(0, potential - milestoneGold) : 0;
    return { potential, milestoneGold, finalGold, total: milestoneGold + finalGold };
  }
  const rewardFor = s => rewardBreakdown(s).total;
  const oreSummary = s => {
    const out = emptyOres();
    for (const k of ORE_ORDER) out[k] = Math.max(0, Math.floor(s.ores?.[k] || 0));
    return out;
  };
  const milestoneList = (zone = 0) => MILESTONES.map(m => ({ id: m.id, label: m.label, gold: MILESTONE_GOLD, ores: milestoneOres(zone, m.id) }));

  return {
    VERSION, FPS, DT, MAX_TICKS, INPUT, CHARACTERS, LEVEL, seedFromId, layoutFor, create, step, replay, overlap, activeHazard, canExit, cameraFor,
    rewardFor, rewardBreakdown, oreSummary, milestoneList, milestoneOres, ORES, MILESTONES, MILESTONE_GOLD,
    // المرحلة 3
    MINES, ZONES, EQUIPMENT, EQUIPMENT_ORDER, MAX_EQUIP_LEVEL, ORE_LADDER,
    normalizeConfig, normalizeLoadout, normalizeProgress, loadoutStats, equipCost, effectText, hitsToBreak, mineStatus, mineUnlocked,
  };
});
