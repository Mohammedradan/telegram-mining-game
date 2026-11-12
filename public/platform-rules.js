/* Original deterministic platform physics, shared by browser and server. No assets/dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // V9: توازن المبارزة — قلب إضافي داخل الساحة، استشفاء الخصم 52 إطاراً، ارتداد بدل الانتقال
  // إلى نقطة الحفظ عند الإصابة، ونافذة مهارة النينجا. لا تغيير في جولات التعدين ولا في الاقتصاد.
  // V10: معدات الساحة (فأس/درع/مثقاب) بأثر مقروء ومحدود، أربعة أنماط خصوم (نمط لكل منطقة)،
  // وزعيم المنطقة الرابعة بمرحلتين. محاكاة التعدين بقيت حرفياً كما هي (بصمة اختبار مثبّتة).
  const VERSION = 14; // V21: real deterministic ladder climbing joins the upper mine branches; older run tickets are rejected
  // سقف مقاطع الإدخال في جولة واحدة (كل مقطع ≈ 23 بايت JSON). معارك الزعماء تبدّل الأزرار كثيراً، فصار 2400 بدل 1000؛ يطابقه حدّ جسم الطلب في الخادم.
  const MAX_SEGMENTS = 2400;
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
  // ===== V6: أهداف الجولة الثلاثة + مفترق المخاطرة + العرق النادر =====
  // الهدف يُختار قبل الجولة ويُثبَّت في تذكرة الخادم مثل المنجم والمعدات، فيُعاد التشغيل به ولا يمكن تبديله بعد البدء.
  // المكافأة الذهبية لم تُمسّ (نفس سقف الـ100 اليومي)؛ الجديد يُدفع من **الخامات** التي تُصرف على معدات الورشة،
  // لذلك لا تُخلق عملة ولا سقف جديد. كل الأرقام صحيحة وحتمية.
  const GOALS = Object.freeze([
    { id: 'ore', short: 'الخام', name: 'جمع الخام', blurb: 'حقيبة ممتلئة: كل بلّورة وصخرة تُحتسب قبل البوابة', hint: 'املأ الحقيبة ثم اعبر البوابة' },
    { id: 'vein', short: 'العرق', name: 'العرق النادر', blurb: 'ثلاث ضربات متتابعة تكسر العرق قبل أن يتصلّب', hint: 'اصعد إلى المنصة العالية واضرب العرق النادر بسرعة' },
    { id: 'speed', short: 'سباق', name: 'سباق البوابة', blurb: 'اعبر البوابة قبل 75 ثانية', hint: 'لا تتوقّف: الطريق والبوابة قبل 75 ثانية' },
  ]);
  // هدف الخام يتدرّج مع العمق لأن الخامات نفسها أغلى هناك (الكمية واحدة).
  const oreTarget = zone => 14 + 2 * (Number.isInteger(zone) && zone > 0 ? zone : 0);
  const SPEED_TICKS = 60 * 75;
  // «نسمة الخام»: فرصة موقوتة واحدة في منتصف الجولة على منصة المفترق (حتمية من رقم الإطار لا من العشوائية).
  const ORE_WIND_TICK = 60 * 40;
  const FPS = 60, DT = 1 / FPS, MAX_TICKS = 60 * 150;
  // DEFEND (64): صدّ الهجمات القادمة — يشغل الحركة والهجوم معاً، فأمام اللاعب قرار دائم: أهجم أم أصد؟
  // V8: DODGE (128) مراوغة بحرية، HEAVY (256) ضربة ثقيلة، SOFT (512) مشي تناظري بطيء من عصا التحكم.
  // كل هذه البتات تدخل في قناع الإدخال المسجّل، فيُعاد تشغيل المباراة على الخادم بنفس النتيجة تماماً.
  const INPUT = Object.freeze({ LEFT: 1, RIGHT: 2, JUMP: 4, MINE: 8, ATTACK: 16, SKILL: 32, DEFEND: 64, DODGE: 128, HEAVY: 256, SOFT: 512, UP: 1024 });
  const MAX_MASK = 2047;
  // أوضاع الجولة: mine = منجم التعدين (الافتراضي)، duel = مبارزة قتال حيّة على نفس محرك الحركة.
  const MODES = Object.freeze(['mine', 'duel']);
  // مبارزة: خصم واحد بذكاء الزعيم نفسه (مشي ← إنذار ← موجة أرضية أو اندفاع)، والفوز بإسقاطه.
  // الصدّ له «نَفَس» محدود: لا يمكن الثبات خلف الدرع إلى الأبد — وهذه هي المساحة للمراوغة بالقفز.
  const GUARD = Object.freeze({ max: 150, regen: 1, breakTicks: 48 });
  // ===== V8: قتال الأكشن =====
  // سلسلة ثلاث ضربات خفيفة تتغير فيها الحركة والمدى والدفع (الثالثة قاضية)، وضربة ثقيلة أبطأ وأقوى،
  // ومراوغة قصيرة بحرية (i-frames) لها مهلة. كل الأرقام صحيحة وحتمية، وكلها تُعاد على الخادم.
  const COMBAT = Object.freeze({
    // reachBonus يُضاف إلى مدى البطل، و mul يضرب ضرره: الضربة الأولى مطابقة تماماً لضربة V3 الواحدة
    // (نفس المدى ونفس الدفع ونفس الضرر) فلا تتغيّر فيزياء أي جولة قديمة، والثانية والثالثة تكبران تدريجياً.
    chain: Object.freeze([
      Object.freeze({ mul: 1, reachBonus: 0,  wind: 0, frames: 8,  knock: 100 }),
      Object.freeze({ mul: 1, reachBonus: 4,  wind: 0, frames: 9,  knock: 150 }),
      Object.freeze({ mul: 2, reachBonus: 10, wind: 0, frames: 12, knock: 260, finisher: true }),
    ]),
    heavy: Object.freeze({ damage: 3, reach: 72, wind: 9, frames: 13, knock: 320, cooldown: 40 }),
    chainWindow: 28,   // إطارات لإكمال السلسلة قبل أن تعود للضربة الأولى
    dodge: Object.freeze({ ticks: 14, cooldown: 46, speed: 430, iframes: 12 }),
    guardBlockCost: 16, // كل صدّ يستهلك نَفَساً إضافياً: الدرع ليس مجانياً
    softScale: 55,      // المشي التناظري: 55% من سرعة الجري
  });
  const DUEL = Object.freeze({
    // مكافأة أساسية ثابتة + خطوة صغيرة لكل عمق (تحدٍّ أصعب = عائد أعلى قليلاً)، بحد أقصى 80.
    reward: 60, rewardStep: 4, guardSlow: 55,
    // ساحة المبارزة داخل أول قطعة أرض صلبة في المستوى (0..560) — لا فجوات ولا أخطار بيئية حولها.
    rival: Object.freeze({ id: 80, w: 44, h: 64, hp: 34, hpPerZone: 6, patrol: 78, charge: 205, wake: 0, minX: 210, maxX: 470, windup: 38, recover: 52 }),
    // ضربة قريبة تُصدّ، وضربة كاسرة للدرع تُتفادى بالقفز أو المراوغة أو الابتعاد.
    // ===== V11: قلوب الساحة مستقلة عن المعدات =====
    // الساحة تمنح قلباً إضافياً فوق قلوب البطل الأساسية فقط، ولا يُضاف إليها قلب الدرع.
    // السبب المقيس في تقرير V10: قلوب المعدات وحدها كانت ترفع الفوز من 0% إلى 100% في z2/z3.
    // التعدين يبقى على قلوب المعدات تماماً (لا مساس بهذه المعادلة).
    extraHearts: 1,
    // سقف قلوب الساحة: البطل الأساسي + القلب الإضافي، مهما كان مستوى الدرع
    heartsFor: hero => hero.hearts + 1,
    // تلميح المرحلة الثانية: يظهر مرة واحدة عند الاهتياج (لا يحجب اللاعب ولا مؤشرات الخطر)
    phase2Hint: 'اقفز فوق الصدمة المزدوجة، ثم استغل نافذة استشفاء الزعيم للهجوم',
    // V12.1: تذكير مختصر واحد حين تأتي صدمة كاسرة ثانية بعد خفوت التلميح الأساسي.
    // السبب المقيس: 56 من 101 صدمة كاسرة في المرحلة الثانية (في 27 من 30 مبارزة) تقع بعد
    // انتهاء الـ5.2 ثانية، فيبقى اللاعب بلا إرشاد نصّي في أكثر من نصف الصدمات.
    phase2Reminder: 'انتبه للصدمة القادمة — اقفز أو ابتعد',
    // ارتداد الإصابة في المبارزة (بدل الانتقال إلى نقطة حفظ المنجم): قوة أفقية وإطارات تطبيق
    knock: Object.freeze({ vx: 165, tick: 9 }),
    // ===== مهارة الساحة: «ظل الساكورا» =====
    // اندفاع نينجا خلال الخصم بمناعة كاملة، بضربتين عند نقاط محدّدة من الاندفاع. تكلفتها من
    // نَفَس الدرع نفسه (المعروض في الواجهة) فلا تُكرَّر بلا حدود، ولها مهلة مستقلة.
    skill: Object.freeze({ cost: 45, cooldown: 150, ticks: 20, dashSpeed: 520, hitTicks: Object.freeze([6, 13]), damage: 3, reach: 46 }),
    slash: Object.freeze({ reach: 58, recover: 26 }),
    overhead: Object.freeze({ radius: 74, recover: 40 }),
  });
  // سلّم المبارزين: ثلاثة أنماط قتال مختلفة فعلاً (سرعة، إنذار، وترتيب الهجمات) تتبدّل مع عمق المنجم،
  // فلا يصبح الخصم اللاحق نسخة بصحة أكبر. الأرقام كلها ثابتة وتدخل في التذكرة الخادمية عبر zone.
  // ===== V10: أربعة أنماط قتال، نمط لكل منطقة، ولكل نمط شخصية تُقرأ =====
  // balanced: متوازن يعلّم التوقيت والصدّ · swift: سريع يقترب ويضرب ضربتين متتابعتين
  // wind: موجات مزدوجة وهجمات واسعة تُقفز أو تُراوغ · heavy: زعيم ثقيل مدرّع بمرحلتين.
  const RIVALS = Object.freeze([
    Object.freeze({ id: 0, style: 'balanced', name: 'مبارز الظلال', tag: 'متوازن — تعلّم التوقيت والصدّ',
      hpBonus: 0, patrol: 78, charge: 205, windup: 38, recover: 52, armored: false, boss: false,
      phases: Object.freeze([['slash', 'wave', 'slash', 'overhead'], ['overhead', 'wave', 'charge', 'slash'], ['charge', 'slash', 'overhead', 'wave']]) }),
    Object.freeze({ id: 1, style: 'swift', name: 'السيف السريع', tag: 'سريع — ضربتان متتابعتان، لا تترك فجوة',
      hpBonus: 2, patrol: 106, charge: 240, windup: 30, recover: 46, armored: false, boss: false, doubleSlash: true,
      phases: Object.freeze([['slash', 'slash', 'charge', 'wave'], ['slash', 'charge', 'slash', 'overhead'], ['charge', 'slash', 'overhead', 'slash']]) }),
    Object.freeze({ id: 2, style: 'wind', name: 'سيّاف الريح', tag: 'ريح — موجات مزدوجة وهجمات واسعة',
      hpBonus: 6, patrol: 96, charge: 232, windup: 28, recover: 50, armored: false, boss: false, doubleWave: true, wideSlam: true,
      // ===== V11: ضبط موجتي الريح =====
      // الهدف المقيس: توسيع نافذة القفز فوق الموجتين من ١٤ إلى ٢٠ إطاراً، بلا مساس بسرعة اللاعب
      // ولا بارتفاع قفزته ولا بسرعة الموجة. الحل: نصل السيف أضيق (١٠px بدل ٢٨) فيقصر زمن التلامس،
      // وإزاحة إطلاق ٢٠px أمام الخصم حتى لا تظهر الموجة داخل جسد اللاعب الملتصق به.
      // النتيجة: نافذة ١٩–٢٠ إطاراً، والقفزة الخاطئة ما زالت تُصاب (٢٠ من ٦١ توقيتاً فقط).
      waveTune: Object.freeze({ speed: 190, w: 10, gap: 10, lead: 20 }),
      phases: Object.freeze([['wave', 'overhead', 'slash', 'wave'], ['wave', 'wave', 'overhead', 'slash'], ['overhead', 'wave', 'charge', 'overhead']]) }),
    Object.freeze({ id: 3, style: 'heavy', name: 'حارس الساكورا', tag: 'زعيم ثقيل — إنذار طويل، درع لا يُخترق إلا في الاستشفاء',
      hpBonus: 6, patrol: 62, charge: 180, windup: 54, recover: 72, armored: true, boss: true,
      wideSlam: true, doubleSlam: true, phases: Object.freeze([['overhead', 'wave', 'overhead', 'charge'], ['overhead', 'wave', 'overhead', 'slash']]) }),
  ]);
  // المنطقة 0..3 ← نمطها؛ 4+ تدور على الأنماط الأربعة مع تعميق الصحة (hpPerZone) لا نسخاً متطابقة
  const rivalFor = zone => RIVALS[((Number(zone) || 0) % 4 + 4) % 4];
  // ===== V11: ضرر الفأس في الساحة وحدها =====
  // 1 + floor(المستوى/4): المستويات 0..3 = ضربة واحدة، والرابع يضاعفها. لا يتغيّر ضرر التعدين
  // (miningPower معادلة أخرى تماماً) ولا ضرر المنجم ولا أي اقتصاد.
  const arenaAxeBonus = level => Math.max(0, Math.floor(Math.max(0, Math.min(MAX_EQUIP_LEVEL, Number(level) || 0)) / 4));

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
    const goal = Number.isInteger(src.goal) && src.goal >= 0 && src.goal < GOALS.length ? src.goal : 0;
    const mode = MODES.includes(src.mode) ? src.mode : 'mine';
    return { zone, goal, mode, loadout: normalizeLoadout(src.loadout) };
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
      // ===== V8.2: أثر المعدات على القتال (محدود ومقروء) =====
      // الفأس: +1 ضرر لكل مستويين (بحد أقصى +2). الدرع: نَفَس درع أطول (+10 لكل مستوى).
      // المثقاب: مهلة مراوغة ومهارة أقصر (بحد أدنى آمن). الأحذية: سرعة الحركة (محسوبة أعلاه).
      // كل القيم أعداد صحيحة ومحسوبة من اللقطة المثبّتة في التذكرة، فإعادة تشغيل الخادم متطابقة.
      // ===== V10: معدات الساحة (بالحدود القصوى لمستويات المعدات القائمة 0..5) =====
      // الفأس: ضرر السلسلة + كسر دفاع الخصم (ترنّح أطول) — بحد أقصى +2 لكل منهما.
      // الدرع: نَفَس المهارة (+10 لكل مستوى، حده +50) واستعادته أسرع (+1 إطار/إطار عند المستوى 2+).
      // المثقاب: مهلة «ظل الساكورا» (٦ إطارات لكل مستوى، بحد أدنى ١٠٠) ومهلة المراوغة.
      // كل القيم أعداد صحيحة من لقطة التذكرة، فإعادة تشغيل الخادم متطابقة حرفياً.
      combat: {
        damage: Math.min(2, Math.floor(L.pickaxe / 2)),
        guardBreak: Math.min(2, Math.floor(L.pickaxe / 2)),
        guardStamina: 10 * L.armor,
        breathRegen: Math.min(1, Math.floor(L.armor / 2)),
        dodgeCooldown: Math.max(30, COMBAT.dodge.cooldown - 3 * L.drill),
        skillCooldown: Math.max(90, hero.skillCooldown - 8 * L.drill),
        duelSkillCooldown: Math.max(100, DUEL.skill.cooldown - 10 * L.drill),
      },
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
  // ===== بطاقة معدات الساحة: تُعرض قبل المبارزة وتُحسب من نفس دالة الإحصاءات =====
  // لا تُرسل للخادم ولا تُغيّر شيئاً: الخادم يبني اللقطة من حفظ اللاعب، وهذه للعرض فقط.
  function combatGear(heroId, loadout) {
    const L = normalizeLoadout(loadout), c = loadoutStats(heroId, loadout).combat;
    const hero = CHARACTERS[heroId] || CHARACTERS.miner, bonus = arenaAxeBonus(L.pickaxe);
    return [
      { id: 'pickaxe', name: 'الفأس', level: L.pickaxe, max: MAX_EQUIP_LEVEL,
        // V11: ضرر الساحة 1 + floor(المستوى/4) — فالزيادة الفعلية تحدث عند المستوى 4
        effect: bonus ? `ضرر الساحة ${hero.damage + bonus} (‎+${bonus})` : `ضرر الساحة ${hero.damage} — يزيد عند المستوى 4`,
        detail: c.guardBreak ? `كسر الدفاع +${4 * c.guardBreak} إطار ترنّح` : 'بلا كسر دفاع إضافي' },
      { id: 'armor', name: 'الدرع', level: L.armor, max: MAX_EQUIP_LEVEL,
        effect: `نَفَس الدرع ${GUARD.max + c.guardStamina} · القلوب ثابتة في الساحة`,
        detail: c.breathRegen ? `استعادة الأنفاس +${c.breathRegen}/إطار` : 'بلا استعادة أنفاس إضافية' },
      { id: 'drill', name: 'المثقاب', level: L.drill, max: MAX_EQUIP_LEVEL,
        effect: `مهلة ظل الساكورا ${c.duelSkillCooldown} إطار`,
        detail: `مهلة المراوغة ${c.dodgeCooldown} إطار` },
    ];
  }
  // ===== V11: توصية القتال =====
  // تُحسب من نفس معادلات المحرك على معدات اللاعب المحفوظة، ولا تُرسل للخادم ولا تمنع دخول منطقة.
  // الغرض: يعرف اللاعب أين يقف وماذا يربح من الترقية القادمة، دون أن تصبح الترقية شرطاً.
  function combatAdvice(heroId, loadout) {
    const L = normalizeLoadout(loadout), st = loadoutStats(heroId, loadout), c = st.combat;
    const hero = CHARACTERS[heroId] || CHARACTERS.miner;
    const damage = hero.damage + arenaAxeBonus(L.pickaxe);
    // أولوية التطوير: أقرب تحسين يغيّر إحساس القتال فعلاً الآن (لا انتظار أربعة مستويات)
    let priority;
    if (L.armor < MAX_EQUIP_LEVEL) {
      priority = { id: 'armor', name: 'الدرع', from: L.armor, to: L.armor + 1,
        why: `نَفَس الدرع ${GUARD.max + c.guardStamina} ← ${GUARD.max + 10 * (L.armor + 1)}: صدّات أكثر قبل انكسار الدفاع` };
    } else if (L.drill < MAX_EQUIP_LEVEL) {
      priority = { id: 'drill', name: 'المثقاب', from: L.drill, to: L.drill + 1,
        why: `مهلة المهارة ${c.duelSkillCooldown} ← ${Math.max(100, DUEL.skill.cooldown - 10 * (L.drill + 1))} إطاراً` };
    } else if (L.pickaxe < 4) {
      priority = { id: 'pickaxe', name: 'الفأس', from: L.pickaxe, to: 4,
        why: `المستوى 4 يرفع ضرر الساحة من ${damage} إلى ${hero.damage + 1}: أقصر طريق لإنهاء المبارزة` };
    } else if (L.pickaxe < MAX_EQUIP_LEVEL) {
      priority = { id: 'pickaxe', name: 'الفأس', from: L.pickaxe, to: MAX_EQUIP_LEVEL,
        why: `كسر دفاع أطول: ${4 * c.guardBreak} ← ${4 * Math.min(2, Math.floor(MAX_EQUIP_LEVEL / 2))} إطار ترنّح` };
    } else {
      priority = null;
    }
    return {
      rows: combatGear(heroId, loadout),
      arena: { hearts: DUEL.heartsFor(hero), damage, breath: GUARD.max + c.guardStamina,
        skillCd: c.duelSkillCooldown, dodgeCd: c.dodgeCooldown, guardBreak: 4 * c.guardBreak },
      // نقاط القوة/الضعف تُقرأ من الأرقام نفسها لا من تخمين: أقوى بند وأضعف بند في هذه اللقطة
      strength: damage >= hero.damage + 1 ? `ضرر ${damage} لكل ضربة — إنهاء أسرع للمبارزة`
        : c.guardStamina >= 40 ? `نَفَس ${GUARD.max + c.guardStamina} — يتحمّل صدّات متتالية`
        : c.duelSkillCooldown <= 110 ? `ظل الساكورا كل ${c.duelSkillCooldown} إطاراً`
        : c.guardBreak >= 2 ? `كسر دفاع +${4 * c.guardBreak} إطار ترنّح بعد ثلاث ضربات`
        : c.guardStamina > 0 ? `نَفَس ${GUARD.max + c.guardStamina}: صدّتان أو ثلاث قبل الانكسار`
        : 'معدات متوازنة بلا نقطة قوة بارزة',
      weakness: L.armor === 0 ? 'لا نَفَس إضافي: الدرع ينكسر سريعاً أمام الموجات'
        : L.drill === 0 ? 'مهلة المهارة كاملة (150 إطاراً)'
        : damage === hero.damage ? 'الضرر الأساسي فقط حتى مستوى الفأس 4'
        : 'لا ضعف حاسم',
      priority,
      optional: 'توصية اختيارية — لا مستوى مطلوباً لدخول أي منطقة',
    };
  }
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
    const mine = mineOf(zone), level = levelFor(zone);
    if (seed === undefined || seed === null) return {
      rocks: level.rocks.map((r, i) => ({ ...r, ore: mine.tier[['common', 'mid', 'rare'][i % 3]], yield: 2 + i % 3 })),
      gems: level.gems.map((g, i) => ({ ...g, chest: i === 4 })),
      enemies: level.enemies.map(e => ({ ...e, dir: 1 })),
    };
    const rnd = prng(Number(seed) >>> 0);
    const pick = ([a, b]) => Math.round(a + rnd() * (b - a));
    // IMPORTANT: مواضع الصخور/البلورات/الأعداء تُستهلك بنفس الترتيب القديم تماماً،
    // ثم تُسحب اختيارات الخامات والصندوق بعدها — فلا تتغير حلول الجولات المختبرة (ولا مواضع أي منجم).
    const rocks = level.rocks.map((r, i) => { const spans = level.rockSpans[i]; return { ...r, x: pick(spans[Math.floor(rnd() * spans.length)]) }; });
    const gems = level.gems.map((g, i) => ({ ...g, x: pick(level.gemSpans[i]) }));
    const enemies = level.enemies.map(e => (e.boss ? { ...e, dir: 1 } : { ...e, x: pick([e.minX, e.maxX - e.w]), dir: rnd() < 0.5 ? -1 : 1 }));
    const chestAt = Math.floor(rnd() * gems.length);
    return {
      rocks: rocks.map(r => ({ ...r, ore: pickOre(mine, rnd(), luck), yield: 2 + Math.floor(rnd() * 3) })),
      gems: gems.map((g, i) => ({ ...g, chest: i === chestAt })),
      enemies,
    };
  }

  // ===== المبارزة: خصم واحد على أرض المنجم نفسها =====
  // لا صخور ولا بلورات ولا حرّاس آخرين ولا بوابة: النصر بإسقاط الخصم، والخسارة بنفاد القلوب.
  // الدالة حتمية تماماً (لا عشوائية): نفس البذرة = نفس اتجاه الخصم وموقعه.
  function duelEnemy(zone, seed) {
    const r = DUEL.rival, lvl = Math.max(0, Math.min(99, Number(zone) || 0)), arch = rivalFor(lvl);
    const rnd = prng((Number(seed) >>> 0) || 1);
    const maxHp = r.hp + arch.hpBonus + r.hpPerZone * lvl;
    const startX = r.minX + Math.round(rnd() * 130);
    const walkJitter = Math.round(rnd() * 10);
    const cycleStart = Math.floor(rnd() * 2);
    return {
      id: r.id, type: 'rival', boss: arch.boss === true, armored: arch.armored === true, kind: 'rival',
      name: arch.name, tag: arch.tag, arch: arch.id, style: arch.style, cycleStart,
      x: startX, y: 300 - r.h, w: r.w, h: r.h,
      minX: r.minX, maxX: r.maxX, wake: r.wake, maxHp,
      patrolSpeed: arch.patrol, chaseSpeed: arch.patrol, chargeSpeed: arch.charge,
      damage: 1, flying: false,
      // ثلاث مراحل حسب صحته، ولكل مرحلة ترتيب هجمات مختلف — والبداية من البذرة، فلا مباراتان متطابقتان.
      ai: {
        walk: 30 + walkJitter, windup: arch.windup, recover: arch.recover || r.recover,
        enragedWalk: 24, enragedWindup: 22, chargeTicks: 26,
        phases: arch.phases.map(list => [...list]),
        // نمط المنطقة: ضربتان متتابعتان (سريع)، موجتان (ريح)، ضربة واسعة/مزدوجة (ثقيل)
        doubleSlash: arch.doubleSlash === true, doubleWave: arch.doubleWave === true,
        wideSlam: arch.wideSlam === true, doubleSlam: arch.doubleSlam === true,
        wave: { speed: 190, w: 28, h: 20, ttl: 52, gap: 10, ...(arch.waveTune || {}) },
        slamRadius: arch.id === 3 ? 96 : DUEL.overhead.radius,
      },
    };
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const activeHazard = (h, tick) => (tick + (h.phase || 0)) % h.period < h.active;
  const canExit = s => s.mined >= 1 && s.collected >= 3 && (!s.bossId || s.bossDefeated === true);

  // ===== ساحة المفترق: موضع مشتق من تضاريس المنجم نفسه (لا عشوائية ولا تعديل على الأرض) =====
  // قطعة أرض مستوية قرب راية المنتصف، بعيدة عن الأخطار والصخور والبوابة. فوقها شيئان غير صلبين
  // (لا يُغيّران فيزياء المستوى): **العرق النادر** يساراً و**صندوق المفترق** يميناً.
  function perchAt(level) {
    const cps = level.checkpoints || [];
    const cp = cps[cps.length - 1] || { at: Math.round(level.width * 0.5) };
    const ground = (level.platforms || []).filter(p => p.h >= 80);
    const spans = level.rockSpans || [];
    const groundAt = x => ground.some(g => x - 6 >= g.x && x + 92 <= g.x + g.w);
    const hazardClear = x => (level.hazards || []).every(h => x + 92 < h.x - 70 || x > h.x + h.w + 70);
    const rockClear = x => spans.every(list => list.every(([a, b]) => x + 92 < a - 8 || x > b + 8));
    const exitClear = x => x + 92 < level.exit.x - 100;
    const from = Math.max(8, cp.at - 40), to = cp.at + 160;
    for (let x = from; x <= to; x += 8) if (groundAt(x) && hazardClear(x) && rockClear(x) && exitClear(x)) return { x, y: 300, w: 92 };
    for (let x = from; x <= to; x += 8) if (groundAt(x) && hazardClear(x) && exitClear(x)) return { x, y: 300, w: 92 };
    return null;
  }
  const oreTotal = s => {
    let n = 0;
    for (const k of ORE_ORDER) n += Math.max(0, Math.floor((s.ores || {})[k] || 0));
    return n;
  };
  // حالة الهدف كما تُعرض في الواجهة وتُختم في الإيصال. تُحسب من حالة المحاكاة نفسها فقط.
  function goalStatus(s) {
    const goal = GOALS[s.goal || 0] || GOALS[0];
    if (goal.id === 'ore') {
      const target = oreTarget(s.zone || 0), now = oreTotal(s);
      return { id: goal.id, name: goal.name, now, target, done: now >= target };
    }
    if (goal.id === 'vein') {
      const v = s.vein || { hp: 3, maxHp: 3 };
      return { id: goal.id, name: goal.name, now: Math.max(0, v.maxHp - Math.max(0, v.hp)), target: v.maxHp, done: s.veinBroken === true };
    }
    return { id: goal.id, name: goal.name, now: Math.ceil((s.tick || 0) / FPS), target: Math.round(SPEED_TICKS / FPS), done: s.status === 'won' && s.tick <= SPEED_TICKS };
  }

  // ===== الزعيم =====
  // دورة حتمية بلا أي عشوائية: مشي نحو اللاعب ← إنذار يُرى ويُسمع ← هجوم ← استراحة. الهجمات: «صدمة» (موجتان أرضيتان تجريان من جانبيه
  // وتُتجنَّبان بالقفز) و«اندفاع» (يجري باتجاه يُثبَّت عند بدء الإنذار حتى الجدار). عند نصف صحته يهتاج: أسرع وإنذاره أقصر.
  // صحته لا تعود، والعودة بعد الإصابة إلى راية مدخل الساحة، فالمعركة تُحسم بالمثابرة لا بالحظ. غنيمته خامات فقط (لا ذهب).
  const BOSS_SLOTS = Object.freeze({ mid: 1, rare: 2 });
  // الزعيم مدرَّع خارج مرحلة الاستراحة (بعد هجومه): الضربة تُرَدّ بضرر 0 ويُعرض ذلك للاعب. غير الزعماء يتلقون الضرر كاملاً دائماً.
  const blow = (enemy, amount) => (enemy.boss && enemy.armored !== false && enemy.state !== 'recover' ? 0 : amount);
  // الاستراحة هي النافذة الوحيدة التي يُصاب فيها الزعيم؛ حدث boss_stun يُعلم العميل (صوت ونجوم) ولا يغيّر شيئاً في الحساب
  function stun(s, b, ticks) {
    b.vx = 0; b.state = 'recover'; b.timer = ticks;
    s.events.push({ type: 'boss_stun', ticks, x: b.x + b.w / 2, y: b.y, id: b.id });
  }
  // ===== V8: الزعماء على نموذج القتال الجديد، تدريجياً وبنفس عقد V5 =====
  // ثلاث مراحل لكل زعيم (هادئ ← مهتاج عند 50% ← أخير عند 33%)، ولكل مرحلة ترتيب هجماتها.
  // الهجمات القديمة كما هي (slam موجتان، charge اندفاع)، ويُضاف:
  //   pound: صدمة أرضية حول الزعيم لا يوقفها الدرع — تُقفز أو تُبتعد، وإنذارها أطول.
  //   sweep: ضربة قريبة سريعة تُصدّ بالدرع.
  // الدرع (لا ضرر إلا في مرحلة الاستراحة) لم يُمسّ، ولا تتغيّر أحداث الخادم ولا الغنائم.
  const bossList = (ai, b) => (b.final && ai.finalAttacks ? ai.finalAttacks
    : b.enraged && ai.enragedAttacks ? ai.enragedAttacks : ai.attacks);
  function startWindup(s, b) {
    const p = s.player, ai = b.ai, list = bossList(ai, b);
    b.aim = p.x + p.w / 2 >= b.x + b.w / 2 ? 1 : -1;
    b.facing = b.aim; b.vx = 0;
    b.attack = list[b.cycle % list.length]; b.cycle++;
    b.state = 'windup'; b.timer = b.enraged ? ai.enragedWindup : ai.windup;
    s.events.push({ type: 'boss_windup', attack: b.attack, ticks: b.timer, x: b.x + b.w / 2, y: b.y, id: b.id });
  }
  function fireAttack(s, b) {
    const ai = b.ai, fast = b.enraged ? 1.2 : 1;
    if (b.attack === 'charge') {
      b.state = 'charge'; b.timer = ai.chargeTicks; b.vx = b.aim * Math.round(b.chargeSpeed * fast);
      s.events.push({ type: 'boss_charge', x: b.x + b.w / 2, y: b.y, id: b.id });
      return;
    }
    if (b.attack === 'pound') {
      // «الصدمة الأرضية»: انفجار نصف قطري حول الزعيم لا يوقفه الدرع (تُقفز أو تُراوغ أو تُبتعد)،
      // ومعه موجة واحدة باتجاه اللاعب حتى لا يصبح البقاء بعيداً تماماً ملاذاً آمناً.
      const radius = (ai.pound && ai.pound.radius) || 96, cx = b.x + b.w / 2;
      const box = { x: cx - radius, y: 300 - 70, w: radius * 2, h: 70 };
      s.events.push({ type: 'boss_slam', attack: 'pound', unblockable: true, x: cx, y: 300, id: b.id });
      if (s.player.hearts > 0 && overlap(box, s.player)) hurt(s, cx, { unblockable: true });
      const wv = ai.wave;
      s.waves.push({ x: b.aim > 0 ? b.x + b.w : b.x - wv.w, y: 300 - wv.h, w: wv.w, h: wv.h,
        vx: b.aim * Math.round(wv.speed * fast), ttl: wv.ttl, kind: 'wave' });
      stun(s, b, ai.recover);
      return;
    }
    if (b.attack === 'sweep') {
      // ضربة قريبة سريعة: يُصدّها الدرع، ويُبتعد عنها
      const reach = (ai.sweep && ai.sweep.reach) || 82;
      const box = { x: b.aim > 0 ? b.x + b.w : b.x - reach, y: b.y + 4, w: reach, h: b.h };
      s.events.push({ type: 'boss_slam', attack: 'sweep', x: b.x + b.w / 2, y: 300 - b.h / 2, id: b.id });
      if (s.player.hearts > 0 && overlap(box, s.player)) hurt(s, b.x + b.w / 2);
      stun(s, b, Math.max(22, Math.round(ai.recover * 0.55)));
      return;
    }
    const wv = ai.wave, speed = Math.round(wv.speed * fast);
    for (const dir of [-1, 1]) s.waves.push({ x: dir > 0 ? b.x + b.w : b.x - wv.w, y: 300 - wv.h, w: wv.w, h: wv.h, vx: dir * speed, ttl: wv.ttl, kind: 'wave' });
    s.events.push({ type: 'boss_slam', x: b.x + b.w / 2, y: 300, id: b.id });
    stun(s, b, ai.recover);
  }
  function bossStep(s, b) {
    const p = s.player, ai = b.ai, cx = b.x + b.w / 2;
    if (b.state === 'sleep') {
      if (p.x < b.wake) { b.vx = 0; return; }
      b.state = 'walk'; b.timer = ai.walk;
      s.events.push({ type: 'boss_wake', x: cx, y: b.y, id: b.id });
    }
    if (!b.enraged && b.hp * 2 <= b.maxHp) { b.enraged = true; s.events.push({ type: 'boss_enrage', x: cx, y: b.y, id: b.id }); }
    // المرحلة الأخيرة (الثلث الأخير من الصحة): ترتيب هجمات أخطر واستراحة أقصر — يُعلَن للعميل بنفس حدث الاهتياج
    if (!b.final && b.hp * 3 <= b.maxHp) { b.final = true; s.events.push({ type: 'boss_enrage', final: true, x: cx, y: b.y, id: b.id }); }
    b.timer--;
    if (b.state === 'walk') {
      const dir = p.x + p.w / 2 >= cx ? 1 : -1;
      b.facing = dir; b.vx = dir * Math.round(b.patrolSpeed * (b.enraged ? 1.3 : 1));
      b.x = Math.max(b.minX, Math.min(b.maxX, b.x + b.vx * DT));
      if (b.timer <= 0) startWindup(s, b);
    } else if (b.state === 'windup') {
      b.vx = 0;
      if (b.timer <= 0) fireAttack(s, b);
    } else if (b.state === 'charge') {
      b.x += b.vx * DT;
      if (b.x <= b.minX || b.x >= b.maxX) {
        b.x = Math.max(b.minX, Math.min(b.maxX, b.x));
        s.events.push({ type: 'boss_crash', x: b.x + b.w / 2, y: b.y + b.h, id: b.id });
        stun(s, b, ai.recover + 20);
      } else if (b.timer <= 0) stun(s, b, ai.recover);
    } else if (b.state === 'recover') {
      b.vx = 0;
      if (b.timer <= 0) { b.state = 'walk'; b.timer = b.final ? Math.round(ai.enragedWalk * 0.8) : b.enraged ? ai.enragedWalk : ai.walk; }
    }
  }

  const s_mode_duel = (cfg) => cfg && cfg.mode === 'duel';
  function create(heroId = 'miner', seed, config) {
    const hero = CHARACTERS[heroId] || CHARACTERS.miner;
    const cfg = normalizeConfig(config), mine = MINES[cfg.zone];
    const stats = loadoutStats(hero.id, cfg.loadout);
    const layout = layoutFor(seed, cfg.zone, cfg.loadout.luck), level = levelFor(cfg.zone);
    const perch = perchAt(level);
    const s = {
      seed: seed === undefined || seed === null ? null : Number(seed) >>> 0,
      zone: cfg.zone,
      goal: cfg.goal,
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
        // المبارزة: قلوب ثابتة (البطل + 1) لا يزيدها الدرع — والتعدين يبقى على قلوب المعدات تماماً
        hearts: s_mode_duel(cfg) ? DUEL.heartsFor(hero) : stats.hearts,
        maxHearts: s_mode_duel(cfg) ? DUEL.heartsFor(hero) : stats.maxHearts,
        invulnerable: 0,
        coyote: 6,
        jumpBuffer: 0,
        attack: 0,
        attackCooldown: stats.attackCooldown,
        // ضرر الساحة من الفأس بمعادلة V11 (1 + floor(المستوى/4)) والمنجم على معادلته القديمة
        damage: s_mode_duel(cfg) ? hero.damage + arenaAxeBonus(cfg.loadout.pickaxe) : hero.damage + stats.combat.damage,
        attackRange: hero.attackRange,
        miningPower: stats.miningPower,
        miningReach: stats.miningReach,
        hurtInvulnerable: stats.hurtInvulnerable,
        magnet: stats.magnet,
        yieldPercent: stats.yieldPercent,
        robot: stats.robot,
        skillCooldown: 0,
        skillMaxCooldown: s_mode_duel(cfg) ? stats.combat.duelSkillCooldown : stats.combat.skillCooldown,
        dodgeCooldown: stats.combat.dodgeCooldown,
        pose: 'idle',
        landTimer: 0,
        guard: { active: false, blocks: 0, timer: 0,
          stamina: GUARD.max + stats.combat.guardStamina, maxStamina: GUARD.max + stats.combat.guardStamina,
          regen: GUARD.regen + (s_mode_duel(cfg) ? stats.combat.breathRegen : 0), broken: 0 },
        // كسر الدفاع (من الفأس): إطارات ترنّح إضافية على ضربات الساحة فقط
        guardBreakBonus: s_mode_duel(cfg) ? 4 * stats.combat.guardBreak : 0,
        // ارتداد الإصابة (يُستخدم في الساحة فقط): يُطبَّق في خطوة الحركة قبل التصادم
        knock: { vx: 0, ticks: 0 },
        // مهارة الساحة (ظل الساكورا). تبقى null في التعدين وغيره.
        skill: null,
        // V8: حالة القتال — سلسلة الضربات والضربة الجارية والضربة الثقيلة والمراوغة
        combo: 0, comboTimer: 0, swing: null, heavyCooldown: 0, attackBuffer: 0, attackBuffered: 'light',
        dodge: { ticks: 0, cooldown: 0, dir: 1 },
      },
      checkpoint: 64,
      rocks: layout.rocks.map(r => ({ ...r, hp: mine.rockHp, maxHp: mine.rockHp })),
      gems: layout.gems.map(g => ({ ...g, taken: false })),
      hazards: level.hazards.map(h => (h.vent ? { ...h, active: mine.vent } : { ...h })),
      enemies: layout.enemies.map(({ dir, ...e }) => {
        const maxHp = e.maxHp + mine.enemyHp;
        const patrolSpeed = Math.round((e.patrolSpeed || 40) * mine.enemySpeed / 100);
        const chaseSpeed = Math.round((e.chaseSpeed || 65) * mine.enemySpeed / 100);
        return {
          ...e,
          ...(e.boss ? { state: 'sleep', timer: 0, cycle: 0, enraged: false, final: false, aim: 1, attack: null, chargeSpeed: Math.round((e.chargeSpeed || 0) * mine.enemySpeed / 100) } : {}),
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
      waves: [],
      // منصة المفترق: العرق النادر (3 ضربات متتابعة) وصندوق المخاطرة (ضربة آمنة أو ثلاث ضربات جشعة).
      // غير صلبة عمداً: لا تُغيّر فيزياء الأرض ولا حلول الجولات المختبرة.
      perch,
      vein: perch ? { x: perch.x, y: perch.y - 34, w: 24, h: 34, hp: 3, maxHp: 3, timer: 0, broken: false } : null,
      veinBroken: false,
      fork: perch ? { x: perch.x + 60, y: perch.y - 30, w: 30, h: 30, hits: 0, timer: 0, choice: null, locked: false } : null,
      choice: null,
      oreWind: false,
      bossId: (layout.enemies.find(e => e.boss) || {}).id || 0,
      bossDefeated: false,
      collected: 0,
      mined: 0,
      defeated: 0,
      damage: 0,
      milestones: [],
      chestFound: false,
      ores: emptyOres(),
      lastMask: 0,
      events: [],
      mode: cfg.mode,
      // مبارزة: خصم واحد، لا تعدين ولا بوابة — النصر بإسقاطه
      duel: cfg.mode === 'duel' ? { rivalId: DUEL.rival.id, name: rivalFor(cfg.zone).name, arena: { x0: 24, x1: 540 } } : null,
    };
    if (cfg.mode === 'duel') {
      const rival = duelEnemy(cfg.zone, seed);
      s.rocks = [];
      s.gems = [];
      s.hazards = [];
      s.perch = null; s.vein = null; s.fork = null; s.veinBroken = false; s.choice = null;
      s.bossId = 0; s.milestones = [];
      s.enemies = [{ ...rival, state: 'approach', timer: rival.ai.walk, cycle: rival.cycleStart || 0, enraged: false, aim: -1, attack: null,
        phase: 1, stagger: 0, hp: rival.maxHp, vx: 0, vy: 0, facing: -1, attackCooldown: 0, hurtCooldown: 0, dead: false, alert: true }];
      s.player.x = 64;
      s.checkpoint = 64;
    }
    return s;
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

  // الصدّ: درعٌ أمامي يشغل الحركة والهجوم. يحمي من ضربات الخصم والموجات الأرضية،
  // ولا يحمي من الأخطار البيئية (بخار/حفرة/سقوط) — فهذه تعليم مستوى لا قتال.
  function hurt(s, fromX, opts = {}) {
    const p = s.player;
    if (p.invulnerable) {
      // المراوغة تعطي إطارات مناعة: الضربة تمرّ بلا ضرر ويُعلَن ذلك للاعب
      if (p.dodge?.ticks > 0) s.events.push({ type: 'evade', x: p.x + p.w / 2, y: p.y });
      return false;
    }
    // الصدّ يوقف الضربات العادية فقط؛ الضربة الكاسرة (overhead) تتجاوز الدرع عمداً
    if (p.guard?.active && opts.unblockable !== true && fromX !== undefined) {
      p.guard.blocks = (p.guard.blocks || 0) + 1;
      p.guard.timer = 8;
      p.guard.stamina = Math.max(0, p.guard.stamina - COMBAT.guardBlockCost);
      p.invulnerable = 12; // مهلة قصيرة تمنع تراكم الضرر في الإطار نفسه
      s.events.push({ type: 'guard', x: p.x + p.w / 2, y: p.y, fromX });
      return false;
    }
    p.hearts--; s.damage++; p.invulnerable = p.hurtInvulnerable || 90;
    s.events.push({ type: 'hurt', x: p.x, y: p.y });
    if (s.mode === 'duel') {
      // في الساحة لا يعود اللاعب إلى نقطة حفظ المنجم: يُدفع بعيداً عن مصدر الضربة ويحصل على
      // إطارات المناعة نفسها. الهدف أن يبقى القتال متصلاً ومرئياً، لا أن يقطع المشهد.
      const away = fromX !== undefined && fromX < p.x + p.w / 2 ? 1 : -1;
      p.knock.vx = away * DUEL.knock.vx;
      p.knock.ticks = DUEL.knock.tick;
      p.vy = Math.min(p.vy, -180);
    } else {
      p.x = s.checkpoint; p.y = 240; p.vx = 0; p.vy = 0;
    }
    if (p.hearts <= 0) {
      s.status = 'lost';
      p.pose = 'dead';
      s.events.push({ type: 'game_over', x: p.x, y: p.y });
    }
    return true;
  }

  // حالة المبارزة: صحة الخصم وتقدّم القتال (تُعرض في الواجهة وتُختم في الإيصال).
  function duelStatus(s) {
    const rival = (s.enemies || []).find(e => e.type === 'rival') || (s.enemies || [])[0] || null;
    return {
      id: 'duel', name: rival?.name || 'مبارزة',
      now: rival ? Math.max(0, rival.maxHp - Math.max(0, rival.hp)) : 0,
      target: rival ? rival.maxHp : 1,
      done: s.status === 'won',
      rivalHp: rival ? Math.max(0, rival.hp) : 0,
      rivalMaxHp: rival ? rival.maxHp : 0,
      hearts: Math.max(0, s.player?.hearts || 0),
      blocks: s.player?.guard?.blocks || 0,
      combo: s.player?.combo || 0,
      guard: Math.round(s.player?.guard?.stamina || 0),
      dodge: s.player?.dodge?.cooldown || 0,
      phase: rival?.phase || 1,
      intent: rival?.state === 'windup' ? rival.attack : null,
    };
  }

  // ===== العرق النادر =====
  // كل ضربة تنقص نقطة وتعيد مؤقّت التصلّب (90 إطاراً). إن انتهى المؤقّت قبل الكسر يعود العرق صلباً بالكامل،
  // فالمهارة هي الضرب المتتابع لا مجرد الوقوف والضغط. الكسر يمنح خاماً نادراً (وهو أغلى ما في المنجم).
  const VEIN_SLOTS = Object.freeze({ rare: 2 });
  function hitVein(s) {
    const v = s.vein, mine = mineOf(s.zone);
    if (!v || v.broken) return;
    v.hp = Math.max(0, v.hp - 1);
    v.timer = 90;
    if (v.hp > 0) {
      s.events.push({ type: 'vein_hit', x: v.x + v.w / 2, y: v.y + 8, hp: v.hp, maxHp: v.maxHp, ticks: v.timer });
      return;
    }
    v.broken = true; s.veinBroken = true;
    const ores = resolveSlots(mine, VEIN_SLOTS);
    addOres(s.ores, ores);
    s.events.push({ type: 'vein_break', x: v.x + v.w / 2, y: v.y + 8, ores });
  }
  // ===== صندوق المفترق: قرار المخاطرة =====
  // الضربة الأولى = فتح آمن (خام متوسط + قلب مستعاد). من يضرب ثلاث ضربات قبل انتهاء مؤقّت 120 إطاراً
  // يفتح الجيب الغني (خام نادر) لكنه يوقظ حارسين في مكانه: مكسب أكبر وثمن واضح. بعد المؤقّت يُقفل الصندوق على اختياره.
  const FORK_SAFE_SLOTS = Object.freeze({ mid: 2 });
  const FORK_RICH_SLOTS = Object.freeze({ rare: 2 });
  function spawnForkGuards(s) {
    const f = s.fork, mine = mineOf(s.zone), base = GUARDS.goblin;
    for (let i = 0; i < 2; i++) {
      const id = 70 + i, x = Math.max(20, Math.min(levelFor(s.zone).width - 60, f.x + (i ? 62 : -62)));
      const maxHp = base.maxHp + mine.enemyHp;
      const patrolSpeed = Math.round(base.patrolSpeed * mine.enemySpeed / 100);
      const chaseSpeed = Math.round(base.chaseSpeed * mine.enemySpeed / 100);
      s.enemies.push({ id, type: 'goblin', name: 'حارس الجيب', x, y: 300 - base.h, w: base.w, h: base.h,
        minX: Math.max(0, x - 70), maxX: Math.min(levelFor(s.zone).width - base.w, x + 70),
        maxHp, hp: maxHp, patrolSpeed, chaseSpeed, damage: 1, flying: false,
        vx: patrolSpeed, vy: 0, facing: 1, attackCooldown: 0, hurtCooldown: 0, dead: false, alert: false, greed: true });
    }
  }
  function hitFork(s) {
    const f = s.fork, mine = mineOf(s.zone);
    if (!f || f.locked) return;
    f.hits++; f.timer = 120;
    if (f.hits === 1) {
      const ores = resolveSlots(mine, FORK_SAFE_SLOTS);
      addOres(s.ores, ores);
      const p = s.player, healed = p.hearts < p.maxHearts;
      if (healed) p.hearts = Math.min(p.maxHearts, p.hearts + 1);
      f.choice = 'safe'; s.choice = 'safe';
      s.events.push({ type: 'fork_safe', x: f.x + f.w / 2, y: f.y, ores, healed });
      return;
    }
    if (f.hits >= 3 && f.choice !== 'rich') {
      const ores = resolveSlots(mine, FORK_RICH_SLOTS);
      addOres(s.ores, ores);
      f.choice = 'rich'; f.locked = true; s.choice = 'rich';
      spawnForkGuards(s);
      s.events.push({ type: 'fork_rich', x: f.x + f.w / 2, y: f.y, ores, guards: 2 });
    }
  }

  // ===== V8: ضربات اللاعب =====
  // كل ضربة جسم مادي لها ثلاث نوافذ: `wind` قبل الإصابة (تُقرأ كتحضير)، ثم لحظة إصابة واحدة فقط،
  // ثم `frames` للاسترداد. الضربة الواحدة لا تصيب العدو مرتين أبداً (`hit` قفل داخلي).
  function meleeBox(s, reach) {
    const p = s.player;
    return { x: p.facing > 0 ? p.x + p.w : p.x - reach, y: p.y - 8, w: reach, h: p.h + 16 };
  }
  // إصابة واحدة على كل من في الصندوق. تُرجع عدد المصابين.
  // غير الزعماء يُدفعون دائماً؛ المبارز (armored:false) يترنّح فعلاً فيُقطع إنذاره — تفاعل حقيقي مع الضربة.
  function strike(s, box, damage, opts = {}) {
    const p = s.player;
    let hits = 0;
    for (const enemy of s.enemies) {
      if (enemy.dead || !overlap(box, enemy)) continue;
      const dealt = blow(enemy, damage);
      enemy.hp -= dealt;
      enemy.hurtCooldown = opts.hurtTicks || 20;
      // الدفع كما في V3: يُطبَّق على كل من ليس مدرَّعاً، ويُتجاهَل على درع الزعيم أثناء هجومه
      if (enemy.armored !== false || dealt > 0 || !enemy.boss) enemy.vx = p.facing * (opts.knock || 100);
      // الترنّح لا يقطع إنذاراً بدأ فعلاً (وإلا صار الخصم قابلاً للحبس بالضرب المتواصل)،
      // لكنه يقطع اقترابه ويمنح اللاعب لحظة تنفّس حقيقية.
      const staggerTicks = (opts.stagger || 0) + (s.mode === 'duel' ? (p.guardBreakBonus || 0) : 0);
      if (dealt > 0 && enemy.armored === false && staggerTicks >= 12 && (enemy.staggerCd || 0) <= 0 && enemy.state === 'approach') {
        enemy.stagger = Math.max(enemy.stagger || 0, staggerTicks);
        enemy.staggerCd = 80; // ترنّح واحد كل ~1.3 ثانية: لا حبس للخصم بالضرب المتواصل
        enemy.state = 'stagger'; enemy.timer = staggerTicks;
        s.events.push({ type: 'enemy_stagger', x: enemy.x + enemy.w / 2, y: enemy.y, id: enemy.id });
      }
      s.events.push({ type: 'hit', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2, damage: dealt,
        heavy: Boolean(opts.heavy), stage: opts.stage || 0 });
      hits++;
      if (enemy.hp <= 0) {
        enemy.dead = true;
        s.defeated = (s.defeated || 0) + 1;
        s.events.push({ type: 'enemy_death', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2 });
      }
    }
    return hits;
  }
  // الضربة الخفيفة: تُكمل السلسلة (1 ← 2 ← 3) إن جاء الضغط داخل نافذة السلسلة. المرحلة تغيّر المدى والدفع لا الرقم فقط.
  function startLight(s) {
    const p = s.player;
    const stage = p.comboTimer > 0 ? (p.combo >= 3 ? 1 : p.combo + 1) : 1;
    const cfg = COMBAT.chain[stage - 1];
    p.swing = { kind: 'light', stage, wind: cfg.wind, ticks: cfg.wind + cfg.frames, damage: Math.max(1, p.damage * cfg.mul),
      reach: Math.max(1, p.attackRange + cfg.reachBonus), knock: cfg.knock, hit: false, finisher: Boolean(cfg.finisher) };
    p.attack = Math.max(p.attack, p.attackCooldown);
    s.events.push({ type: 'swing', stage, x: p.x, y: p.y, facing: p.facing });
  }
  // الضربة الثقيلة: تحضير أطول (9 إطارات) وضرر أعلى ودفع كبير، ولها مهلة تمنع تكرارها.
  function startHeavy(s) {
    const p = s.player, cfg = COMBAT.heavy;
    p.swing = { kind: 'heavy', stage: 3, wind: cfg.wind, ticks: cfg.wind + cfg.frames, damage: cfg.damage,
      reach: cfg.reach, knock: cfg.knock, hit: false, finisher: true };
    p.attack = Math.max(p.attack, cfg.cooldown);
    p.heavyCooldown = cfg.cooldown;
    s.events.push({ type: 'swing', heavy: true, stage: 0, x: p.x, y: p.y, facing: p.facing });
  }
  // ظل الساكورا: يتحرك اللاعب بسرعة ثابتة في اتجاه نظره ويضرب مرتين في إطارين محدّدين.
  // كل الأرقام من DUEL.skill، فإعادة تشغيل الخادم تعطي نفس الإصابات بنفس التوقيت.
  function updateDuelSkill(s) {
    const p = s.player, cfg = DUEL.skill;
    if (!p.skill) return;
    p.vx = p.facing > 0 ? cfg.dashSpeed : -cfg.dashSpeed;
    for (; p.skill.hitIdx < cfg.hitTicks.length && cfg.hitTicks[p.skill.hitIdx] >= p.skill.ticks; p.skill.hitIdx++) {
      const cx = p.x + p.w / 2;
      const box = { x: cx - cfg.reach, y: p.y - 12, w: cfg.reach * 2, h: p.h + 24 };
      const hits = strike(s, box, cfg.damage, { knock: 150, stage: 0, heavy: true, stagger: 10 });
      s.events.push({ type: 'skill_hit', x: cx, y: p.y + p.h / 2, hits, idx: p.skill.hitIdx });
    }
    p.skill.ticks--;
    if (p.skill.ticks <= 0) { p.skill = null; p.vx = 0; }
  }

  function updateSwing(s) {
    const p = s.player, sw = p.swing;
    if (!sw) return;
    if (!sw.hit) {
      if (sw.wind > 0) sw.wind--;
      else {
        sw.hit = true;
        const box = meleeBox(s, sw.reach);
        const hits = strike(s, box, sw.damage, {
          knock: sw.knock, stage: sw.stage, heavy: sw.kind === 'heavy',
          stagger: sw.kind === 'heavy' ? 16 : sw.finisher ? 12 : 6,
        });
        if (hits && sw.kind === 'light') { p.combo = sw.stage; p.comboTimer = COMBAT.chainWindow; }
        else if (hits) { p.combo = 0; p.comboTimer = 0; }
        s.events.push({ type: hits ? 'swing_hit' : 'swing_miss', stage: sw.stage, heavy: sw.kind === 'heavy',
          x: box.x + box.w / 2, y: p.y, hits });
      }
    }
    sw.ticks--;
    if (sw.ticks <= 0) p.swing = null;
  }

  // ===== V8: ذكاء المبارز =====
  // approach (يقترب ويحافظ على مسافة قتال) ← windup (إنذار مرئي) ← هجوم ← recover ← approach، و stagger عند تلقّي ضربة.
  // الهجمات: slash (قريبة تُصدّ)، wave (موجة أرضية تُقفز أو تُصدّ)، overhead (كاسرة للدرع تُقفز أو تُراوغ)، charge (اندفاع).
  // الترتيب من البذرة (cycleStart) والمرحلة من نسبة الصحة — لا عشوائية داخل الجولة، فإعادة التشغيل متطابقة.
  function rivalPhase(b) {
    if (b.hp * 4 <= b.maxHp) return 3;
    if (b.hp * 2 <= b.maxHp) return 2;
    return 1;
  }
  // اختيار الهجوم: ترتيب المرحلة يحفظ التنوّع، ثم تُعدّله قراءة حالة اللاعب — لكن بلا غشّ:
  // كل بديل مشروط بحالة مرئية للاعب (درع مرفوع، سيف فارغ، مراوغة في المهلة، مسافة بعيدة)،
  // ولا يتكرر العقاب مرتين متتاليتين (b.cycle % 2) حتى لا يتحوّل الخصم إلى آلة.
  function pickDuelAttack(s, b) {
    const p = s.player, ai = b.ai;
    const phase = rivalPhase(b), list = ai.phases[Math.min(phase, ai.phases.length) - 1];
    const fallback = list[b.cycle % list.length];
    const dist = Math.abs(p.x + p.w / 2 - (b.x + b.w / 2));
    const cycle = b.cycle;
    // 1) درع مرفوع: الكاسرة تتجاوزه — لكن ليس في كل دورة
    if (p.guard.active && cycle % 2 === 0 && dist < 110) return 'overhead';
    // 2) سيف اللاعب فارغ للتوّ (نهاية ضربته) — نافذة العقاب الأساسية
    if (!p.swing && p.attack > 4 && dist <= 78) return 'slash';
    // 3) اللاعب يضرب بسلسلة متواصلة قريباً: موجة أرضية تقطع السلسلة (تُقفز أو تُصدّ)
    if (p.combo >= 2 && dist < 120 && cycle % 2 === 1) return 'wave';
    // 4) المراوغة في المهلة: لا مفرّ من الكاسرة
    if (p.dodge.cooldown > 18 && dist < 88) return 'overhead';
    // 4) ابتعاد اللاعب: موجات واندفاع بدل المطاردة
    if (dist > 165) return cycle % 2 === 0 ? 'charge' : 'wave';
    // 5) لا يقترب: يبني مسافة القتال ثم يضرب
    if (dist > 96 && cycle % 3 === 0) return 'wave';
    return fallback;
  }
  function startDuelWindup(s, b) {
    const p = s.player, ai = b.ai;
    const phase = rivalPhase(b), list = ai.phases[Math.min(phase, ai.phases.length) - 1];
    if (phase !== b.phase) {
      b.phase = phase;
      s.events.push({ type: 'boss_enrage', phase, x: b.x + b.w / 2, y: b.y, id: b.id });
    }
    b.attack = pickDuelAttack(s, b);
    b.cycle++;
    b.aim = p.x + p.w / 2 >= b.x + b.w / 2 ? 1 : -1;
    b.facing = b.aim; b.vx = 0;
    // «ردّ الفعل»: إن كان سيف اللاعب فارغاً للتوّ فالخصم يهجم أسرع (0.62×) — عقاب حقيقي
    // للضرب العشوائي، لكنه يبقى إنذاراً مرئياً (≥ 23 إطاراً) يمكن قراءته والصدّ.
    const counter = b.attack === 'slash' && !p.swing && p.attack > 4;
    const fast = (phase === 3 ? 0.72 : phase === 2 ? 0.86 : 1) * (counter ? 0.62 : 1);
    b.state = 'windup';
    b.timer = Math.max(12, Math.round(ai.windup * fast));
    s.events.push({ type: 'boss_windup', attack: b.attack, ticks: b.timer, unblockable: b.attack === 'overhead',
      counter, x: b.x + b.w / 2, y: b.y, id: b.id });
  }
  function fireDuelAttack(s, b) {
    const p = s.player, ai = b.ai, cx = b.x + b.w / 2;
    if (b.attack === 'charge') {
      b.state = 'charge'; b.timer = ai.chargeTicks; b.vx = b.aim * b.chargeSpeed;
      s.events.push({ type: 'boss_charge', x: cx, y: b.y, id: b.id });
      return;
    }
    if (b.attack === 'slash') {
      const reach = DUEL.slash.reach;
      const box = { x: b.aim > 0 ? b.x + b.w : b.x - reach, y: b.y + 8, w: reach, h: b.h - 8 };
      s.events.push({ type: 'enemy_slash', x: cx, y: b.y, dir: b.aim, id: b.id });
      if (p.hearts > 0 && overlap(box, p)) hurt(s, cx);
      b.state = 'recover'; b.timer = DUEL.slash.recover;
      // السريع: ضربة ثانية بعد ٦ إطارات — مرئية (وميض ثانٍ) وقابلة للصدّ أيضاً
      if (ai.doubleSlash) b.follow = { tick: s.tick + 6, kind: 'slash' };
      return;
    }
    if (b.attack === 'overhead') {
      // كاسرة للدرع: إنذارها مختلف، والنجاة منها بالقفز فوقها أو المراوغة أو الخروج من نصف قطرها.
      const radius = ai.slamRadius || DUEL.overhead.radius;
      // صدمة الزعيم الواسعة تسري على الأرض وحدها (h=44): القفز فوقها جواب صحيح ومقروء،
      // وضربة الكاسرة العادية تبقى بكامل الطول فلا تُنجى منها إلا المراوغة أو الخروج من نصف القطر.
      const box = ai.wideSlam
        ? { x: cx - radius, y: 300 - 44, w: radius * 2, h: 44 }
        : { x: cx - radius, y: 300 - 96, w: radius * 2, h: 96 };
      s.events.push({ type: 'boss_slam', x: cx, y: 300, unblockable: true, id: b.id, radius,
        wide: radius > DUEL.overhead.radius, phase: b.phase || 1 });
      if (p.hearts > 0 && overlap(box, p)) hurt(s, cx, { unblockable: true });
      b.state = 'recover'; b.timer = DUEL.overhead.recover;
      // الزعيم في مرحلته الثانية: صدمة ثانية بعد ١٤ إطاراً — تُعلن بصوت ووميض قبل وقوعها
      if (ai.doubleSlam && rivalPhase(b) >= 2) b.follow = { tick: s.tick + 14, kind: 'slam' };
      return;
    }
    // wave: موجة أرضية واحدة باتجاه اللاعب — تُقفز أو تُصدّ
    // V11: تُطلق من مسافة «lead» أمام الخصم حتى لا تظهر داخل جسد اللاعب الملتصق به
    // (كانت الضربة القريبة تُصيب حتماً بلا هامش ردّ فعل، وهو أسوأ من كونها صعبة).
    const wv = ai.wave, lead = wv.lead || 0;
    // اللاعب قد يعبر خلف الخصم أثناء إنذار الضربة؛ حدّث اتجاه الموجة لحظة إطلاقها
    // بدلاً من استعمال اتجاه الإنذار القديم الذي قد يرسلها بعيداً عنه أو خلفه.
    const waveDir = p.x + p.w / 2 >= b.x + b.w / 2 ? 1 : -1;
    // الإزاحة لا تتجاوز جسد اللاعب: لو كان ملتصقاً تُطلق من الحافة كالسابق (خطأ تمركز يُعاقب)
    const spawnX = (dir) => {
      const gapToBody = dir > 0 ? p.x - (b.x + b.w) : b.x - (p.x + p.w);
      const off = Math.max(0, Math.min(lead, gapToBody - 6));
      return dir > 0 ? b.x + b.w + off : b.x - wv.w - off;
    };
    s.waves.push({ x: spawnX(waveDir), y: 300 - wv.h, w: wv.w, h: wv.h,
      vx: waveDir * wv.speed, ttl: wv.ttl, kind: 'wave' });
    // سيّاف الريح: موجة ثانية بعد فجوة قصيرة تُلزم اللاعب بالبقاء في الهواء أو المراوغة
    if (ai.doubleWave) {
      s.waves.push({ x: spawnX(waveDir), y: 300 - wv.h, w: wv.w, h: wv.h,
        vx: waveDir * wv.speed, ttl: wv.ttl, kind: 'wave', delay: wv.gap || 10 });
    }
    s.events.push({ type: 'boss_slam', x: cx, y: 300, id: b.id });
    b.state = 'recover'; b.timer = ai.recover;
  }
  // الضربة التابعة (سريع/زعيم): تُنفَّذ في إطارها المحدَّد وتُعلَن كحدث مرئي مستقل
  function duelFollowUp(s, b) {
    const p = s.player, ai = b.ai, cx = b.x + b.w / 2;
    if (!b.follow || s.tick < b.follow.tick) return;
    const kind = b.follow.kind; b.follow = null;
    if (kind === 'slash') {
      const reach = DUEL.slash.reach;
      const box = { x: b.aim > 0 ? b.x + b.w : b.x - reach, y: b.y + 8, w: reach, h: b.h - 8 };
      s.events.push({ type: 'enemy_slash', x: cx, y: b.y, dir: b.aim, id: b.id, follow: true });
      if (p.hearts > 0 && overlap(box, p)) hurt(s, cx);
    } else {
      const radius = Math.round((ai.slamRadius || DUEL.overhead.radius) * 0.75);
      const box = ai.wideSlam
        ? { x: cx - radius, y: 300 - 44, w: radius * 2, h: 44 }
        : { x: cx - radius, y: 300 - 96, w: radius * 2, h: 96 };
      s.events.push({ type: 'boss_slam', x: cx, y: 300, unblockable: true, id: b.id, radius, follow: true, phase: b.phase || 1 });
      if (p.hearts > 0 && overlap(box, p)) hurt(s, cx, { unblockable: true });
    }
  }
  // ===== V19.2 (المرحلة A): الخفاش عدوّ جوّي حقيقي =====
  // قبل الإصلاح كان ارتفاعه يهتزّ حول baseY فقط: لا يلاحق، ولا يلمس اللاعب، ولا يُصاب من الأرض
  // (قياس موثّق: 1200 إطار من القفز والضرب تحته = صفر إصابة وصفر ضرر، فأربع مناطق كانت حرّاسها الخفافيش ديكوراً).
  // السلوك الجديد آلة حالات معلنة: رصد ← تأهّب صاعد (إنذار مرئي) ← انقضاض على مكان اللاعب لحظة الانطلاق
  // ← دوار على الأرض (نافذة عقاب بلا ضرر تلامسي) ← صعود. كل شيء دال على الإطار وموضع اللاعب: حتمي ويُعاد على الخادم.
  const BAT = Object.freeze({
    detectX: 170,        // مدى الرصد أفقياً
    detectY: 230,        // ومداه رأسياً (اللاعب أسفله)
    windup: 26,          // إطارات التأهّب: يصعد ≈24 بكسل ويلتفت إلى اللاعب — الإنذار المرئي
    riseSpeed: 55,
    windupDrift: 70,     // انحراف أفقياً نحو اللاعب أثناء التحذير فقط (≈30 بكسل في 0.43 ثانية)
    diveSpeedY: 240,     // سرعة الانقضاض العمودية (≈0.75 ثانية من ارتفاعه إلى الأرض)
    // الانقضاض عمودي لا يلاحق: نقطة السقوط تُقرأ بالعين طوال التحذير. من يستمر في الحركة ينجو،
    // ومن يقف ليحفر (وهو ما تفعله اللعبة) يُصاب. هذا هو القرار الذي يطلبه هذا العدو.
    stun: 42,            // إطارات الدوار على الأرض — نافذة الضرب. 0.70 ثانية تكفي للوصول والضرب
    climb: 95,           // سرعة العودة إلى ارتفاع الدوريّة (≈1.6 بكسل/إطار: يُضرب في الصعود أيضاً)
    cooldown: 84,        // مهلة بين انقضاضين (دورة كاملة ≈ 4.5 ثانية)
    floor: 292,          // سقف الأرض (أعلى الأرض 300 ناقص هامش)
    leash: 40,           // أقصى تجاوز لحدود دوريّته أثناء الانقضاض
    // منطقة الإقلاع: أول 140 بكسل من المستوى لا يُهاجَم فيها اللاعب. بدونها يبدأ اللاعب في المناجم
    // التي يوجد فيها خفاش قريب من نقطة البداية (المنجم الثالث: خفاش عند 100) بخسارة قلوب وهو يقرأ الشاشة.
    safeStart: 140,
  });
  function batStep(s, b) {
    const p = s.player;
    const bc = b.x + b.w / 2, pc = p.x + p.w / 2;
    const drop = p.y - b.y;
    const sees = s.status === 'playing' && p.hearts > 0 && s.mode !== 'duel'
      && pc > BAT.safeStart
      && Math.abs(pc - bc) < BAT.detectX && drop > 8 && drop < BAT.detectY;
    if (!b.batState) { b.batState = 'patrol'; b.batTimer = 0; }
    if (b.batState === 'patrol') {
      b.x += b.vx * DT;
      b.y = b.baseY + Math.sin(s.tick * 0.08 + b.id) * 10;
      if (b.x <= b.minX) { b.vx = Math.abs(b.patrolSpeed || 55); b.facing = 1; }
      else if (b.x >= b.maxX) { b.vx = -Math.abs(b.patrolSpeed || 55); b.facing = -1; }
      if (sees && b.attackCooldown <= 0) { b.batState = 'windup'; b.batTimer = BAT.windup; b.alert = true; }
    } else if (b.batState === 'windup') {
      // صعود بطيء + انحراف بطيء نحو اللاعب: هذا هو الإنذار. ضربة تصل الخفاش في هذه اللحظة تُلغي الهجوم.
      b.facing = pc >= bc ? 1 : -1;
      b.y -= BAT.riseSpeed * DT;
      const drift = Math.max(-BAT.windupDrift, Math.min(BAT.windupDrift, (pc - bc) * 2));
      b.x += drift * DT;
      b.alert = true;
      if (b.hurtCooldown > 0) { b.batState = 'patrol'; b.alert = false; b.attackCooldown = BAT.cooldown; return; }
      if (--b.batTimer <= 0) {
        b.dive = { vy: BAT.diveSpeedY };
        b.batState = 'dive';
        s.events.push({ type: 'bat_dive', x: b.x + b.w / 2, y: b.y, id: b.id });
      }
    } else if (b.batState === 'dive') {
      // سقوط عمودي: نقطة الهبوط ثابتة ومقروءة طوال التحذير — لا مطاردة تكسر العدالة.
      b.y += b.dive.vy * DT;
      const floorY = BAT.floor - b.h;
      if (b.y >= floorY) { b.y = floorY; b.vx = 0; b.batState = 'stun'; b.batTimer = BAT.stun; b.alert = false; }
    } else if (b.batState === 'stun') {
      if (--b.batTimer <= 0) b.batState = 'climb';
    } else { // climb
      b.y = Math.max(b.baseY, b.y - BAT.climb * DT);
      const home = (b.minX + b.maxX) / 2;
      b.x += Math.max(-60, Math.min(60, (home - bc) * 2)) * DT;
      if (b.y <= b.baseY + 0.5) {
        b.y = b.baseY;
        b.vx = (bc >= home ? -1 : 1) * Math.abs(b.patrolSpeed || 55);
        b.batState = 'patrol';
        b.attackCooldown = BAT.cooldown;
      }
    }
    b.x = Math.max(0, Math.max(b.minX - BAT.leash, Math.min(b.maxX + BAT.leash, b.x)));
  }
  function duelStep(s, b) {
    const p = s.player, ai = b.ai;
    const cx = b.x + b.w / 2;
    duelFollowUp(s, b);
    const dx = (p.x + p.w / 2) - cx, dist = Math.abs(dx), dir = dx >= 0 ? 1 : -1;
    const clampX = x => Math.max(b.minX, Math.min(b.maxX, x));
    b.timer--;
    if (b.staggerCd > 0) b.staggerCd--;
    if (b.state === 'sleep') { b.state = 'approach'; b.timer = ai.walk; }
    if (b.state === 'approach') {
      b.facing = dir;
      // مسافة القتال تتغيّر بحالة اللاعب: إن رفع درعه صبر على حدّ السيف، وإن كان بعيداً يشتدّ الضغط.
      const hold = p.guard.active ? 70 : 54;
      if (dist > hold) {
        b.vx = dir * Math.round(b.patrolSpeed * (b.phase >= 3 ? 1.35 : 1));
        b.x = clampX(b.x + b.vx * DT);
      } else b.vx = 0;
      // لا ينتظر الخصم دوره ببرود: إن كان اللاعب يضرب في وجهه متتابعاً هجم قبل انتهاء وقفته
      if (dist <= 72 && p.combo >= 1 && b.timer > 6) b.timer = 6;
      if (b.timer <= 0) startDuelWindup(s, b);
    } else if (b.state === 'retreat') {
      // تباعد قصير بعد الهجوم: يفتح للمهاجم فرصة مطاردة، ويقلّل تكرار النمط نفسه
      b.facing = -dir;
      b.vx = -dir * Math.round(b.patrolSpeed * 0.8);
      b.x = clampX(b.x + b.vx * DT);
      if (b.timer <= 0) { b.state = 'approach'; b.timer = ai.walk; }
    } else if (b.state === 'windup') {
      b.vx = 0;
      if (b.timer <= 0) fireDuelAttack(s, b);
    } else if (b.state === 'charge') {
      b.x = clampX(b.x + b.vx * DT);
      if (b.x <= b.minX || b.x >= b.maxX) {
        s.events.push({ type: 'boss_crash', x: cx, y: b.y + b.h, id: b.id });
        b.vx = 0; b.state = 'recover'; b.timer = ai.recover + 16;
        s.events.push({ type: 'boss_stun', ticks: ai.recover + 16, x: cx, y: b.y, id: b.id });
      } else if (b.timer <= 0) { b.vx = 0; b.state = 'recover'; b.timer = Math.round(ai.recover * 0.7); }
    } else if (b.state === 'stagger') {
      b.vx *= 0.8;
      b.x = clampX(b.x + b.vx * DT);
      if (b.timer <= 0) { b.state = 'approach'; b.timer = Math.round(ai.walk * 0.6); }
    } else { // recover
      b.vx = 0;
      if (b.timer <= 0) {
        // كل ثالث هجوم يتبعه تباعد قصير (إيقاع متغيّر يُقرأ ولا يُحفظ)
        if (b.cycle % 3 === 0 && dist < 90) { b.state = 'retreat'; b.timer = 16; }
        else { b.state = 'approach'; b.timer = b.phase >= 2 ? ai.enragedWalk : ai.walk; }
      }
    }
  }

  function step(s, mask) {
    if (s.status !== 'playing') return s;
    s.events = []; s.tick++;
    const p = s.player, level = levelFor(s.zone);
    // مؤقّتات محتوى V6: تصلّب العرق، إغلاق المفترق، ونسمة الخام الموقوتة.
    if (s.vein && !s.vein.broken && s.vein.timer > 0) {
      s.vein.timer--;
      if (s.vein.timer === 0 && s.vein.hp < s.vein.maxHp) {
        s.vein.hp = s.vein.maxHp;
        s.events.push({ type: 'vein_harden', x: s.vein.x + s.vein.w / 2, y: s.vein.y + 8 });
      }
    }
    if (s.fork && !s.fork.locked && s.fork.timer > 0) {
      s.fork.timer--;
      if (s.fork.timer === 0) {
        s.fork.locked = true;
        s.events.push({ type: 'fork_lock', x: s.fork.x + s.fork.w / 2, y: s.fork.y, choice: s.fork.choice });
      }
    }
    if (!s.oreWind && s.perch && s.tick >= ORE_WIND_TICK) {
      const mine = mineOf(s.zone), top = s.perch.y - 62, span = Math.max(12, (s.perch.w - 24) / 2);
      for (let i = 0; i < 3; i++) s.gems.push({ x: s.perch.x + 12 + i * span, y: top, taken: false, bonus: true, ore: mine.tier.mid });
      s.oreWind = true;
      s.events.push({ type: 'ore_wind', x: s.perch.x + s.perch.w / 2, y: s.perch.y - 40, gems: 3, ore: mine.tier.mid });
    }
    if (p.invulnerable > 0) p.invulnerable--;
    if (p.attack > 0) p.attack--;
    if (p.skillCooldown > 0) p.skillCooldown--;
    if (p.heavyCooldown > 0) p.heavyCooldown--;
    if (p.dodge.cooldown > 0) p.dodge.cooldown--;
    if (p.comboTimer > 0 && --p.comboTimer === 0) p.combo = 0;
    p.coyote = p.grounded ? 6 : Math.max(0, p.coyote - 1);
    p.jumpBuffer = (mask & INPUT.JUMP) && !(s.lastMask & INPUT.JUMP) ? 6 : Math.max(0, p.jumpBuffer - 1);
    const direction = ((mask & INPUT.RIGHT) ? 1 : 0) - ((mask & INPUT.LEFT) ? 1 : 0);
    // الصدّ: فعّال على الأرض وبلا ضربة جارية، ويستهلك «نَفَساً» محدوداً؛ عند نفاده ينكسر الدرع
    // لثوانٍ قصيرة فيصير القفز والمراوغة بديلاً حقيقياً. يبطئ الحركة إلى 45%.
    // المراوغة: اندفاع أرضي قصير بمناعة (12 إطاراً) ومهلة 46 إطاراً — لا حصانة دائمة، بل نافذة توقيت.
    if ((mask & INPUT.DODGE) && p.dodge.cooldown <= 0 && p.dodge.ticks <= 0 && !p.swing && !p.guard.active && p.guard.broken <= 0) {
      p.dodge.ticks = COMBAT.dodge.ticks;
      p.dodge.cooldown = p.dodgeCooldown || COMBAT.dodge.cooldown;
      p.dodge.dir = direction || p.facing;
      p.facing = p.dodge.dir;
      p.invulnerable = Math.max(p.invulnerable, COMBAT.dodge.iframes);
      s.events.push({ type: 'dodge', x: p.x + p.w / 2, y: p.y, dir: p.dodge.dir });
    }
    const dodging = p.dodge.ticks > 0;
    const wantGuard = Boolean(mask & INPUT.DEFEND) && p.grounded && !p.attack && !dodging;
    const guarding = wantGuard && p.guard.broken <= 0 && p.guard.stamina > 0;
    p.guard.active = guarding;
    if (p.guard.broken > 0) p.guard.broken--;
    if (guarding) {
      p.guard.stamina = Math.max(0, p.guard.stamina - 1);
      if (!p.guard.stamina) {
        p.guard.broken = GUARD.breakTicks;
        p.guard.active = false;
        s.events.push({ type: 'guard_break', x: p.x + p.w / 2, y: p.y });
      }
    } else {
      p.guard.stamina = Math.min(p.guard.maxStamina, p.guard.stamina + (p.guard.regen || GUARD.regen));
    }
    if (p.guard.timer > 0) p.guard.timer--;
    // SOFT (512) = دفع جزئي للعصا ← مشي 55% من السرعة؛ الدفع الكامل جري. المراوغة تتجاوز الاثنين.
    const soft = Boolean(mask & INPUT.SOFT) && !p.guard.active;
    p.vx = direction * p.speed * (p.guard.active ? (100 - DUEL.guardSlow) / 100 : soft ? COMBAT.softScale / 100 : 1);
    if (dodging) p.vx = p.dodge.dir * COMBAT.dodge.speed;
    if (direction && !dodging) p.facing = direction;
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
      // أولوية الضربة: صخرة الخام ثم العرق النادر ثم صندوق المفترق (كلها في المدى نفسه).
      if (rock) hitRock(s, rock, p.miningPower, 'player');
      else if (s.vein && !s.vein.broken && overlap(hitbox, s.vein)) hitVein(s);
      else if (s.fork && !s.fork.locked && overlap(hitbox, s.fork)) hitFork(s);
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

    // ===== V8.1: لا تضيع ضغطة =====
    // ضغطة تصل قبل انتهاء التبريد أو أثناء ضربة جارية تُخزَّن حتى 6 إطارات وتُنفَّذ في أول لحظة ممكنة.
    // الحساب هنا داخل المحاكاة نفسها، فيُعاد على الخادم بنفس النتيجة تماماً (الإدخال المسجّل لا يتغيّر).
    // يعمل في وضع المبارزة وحده: جولات التعدين القديمة تُعيد إنتاج فيزياء V3 حرفياً حتى مع مدخلات عشوائية.
    if (s.mode === 'duel') {
      if (p.attack > 0 || p.swing) {
        if (mask & INPUT.HEAVY) { p.attackBuffer = 6; p.attackBuffered = 'heavy'; }
        else if (mask & INPUT.ATTACK) { p.attackBuffer = 6; p.attackBuffered = 'light'; }
      }
      if (p.attackBuffer > 0) {
        if (p.attack <= 0 && !p.swing && !dodging && !p.guard.active) {
          if (p.attackBuffered === 'heavy' && p.heavyCooldown <= 0) { mask |= INPUT.HEAVY; p.attackBuffer = 0; }
          else if (p.attackBuffered === 'light') { mask |= INPUT.ATTACK; p.attackBuffer = 0; }
        } else p.attackBuffer--;
      }
    }

    const chainHero = !CHARACTERS[p.hero].ranged;
    // HEAVY (256): ضربة ثقيلة بطيئة عالية الضرر ولها مهلة تمنع تكرارها. البطل القريب يضرب بها، والرامي يطلق سهماً ثقيلاً.
    if ((mask & INPUT.HEAVY) && !p.attack && !p.swing && !dodging && !p.guard.active && p.heavyCooldown <= 0) {
      if (chainHero) startHeavy(s);
      else {
        p.attack = p.attackCooldown;
        p.heavyCooldown = COMBAT.heavy.cooldown;
        s.projectiles.push({
          x: p.facing > 0 ? p.x + p.w : p.x - 14, y: p.y + 14,
          vx: p.facing * 450, vy: 0, w: 14, h: 4,
          life: Math.ceil(p.attackRange / (450 / FPS)), damage: p.damage + 1, owner: 'player',
        });
        s.events.push({ type: 'attack', heavy: true, x: p.x, y: p.y, facing: p.facing, hero: p.hero });
      }
    }

    // ATTACK Action: البطل القريب يبدأ/يكمل سلسلة الضربات (كل ضربة تصيب مرة واحدة فقط)،
    // والرامي يطلق سهماً كما كان. الضغط داخل النافذة يرفع مرحلة السلسلة، فتتغير الحركة والمدى والدفع.
    if ((mask & INPUT.ATTACK) && !p.attack && !p.swing && !dodging && !p.guard.active) {
      if (chainHero) startLight(s);
      else {
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
            const dealt = blow(enemy, p.damage);
            enemy.hp -= dealt;
            enemy.hurtCooldown = 20;
            enemy.vx = p.facing * 100;
            s.events.push({ type: 'hit', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2, damage: dealt });
            if (enemy.hp <= 0) {
              enemy.dead = true;
              s.defeated = (s.defeated || 0) + 1;
              s.events.push({ type: 'enemy_death', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2 });
            }
          }
        }
      }
      }
    }

    // ===== ظل الساكورا: مهارة الساحة وحدها =====
    // تكلفة من نَفَس الدرع + مهلة 150 إطاراً + لا تعمل والدرع مكسور. تُنفّذ بدل مهارة البطل
    // العامة داخل المبارزة فقط، فتبقى مهارات التعدين كما هي حرفياً.
    if (s.mode === 'duel') {
      if ((mask & INPUT.SKILL) && p.skillCooldown <= 0 && !p.skill && p.guard.broken <= 0
        && p.guard.stamina >= DUEL.skill.cost && !dodging) {
        p.skill = { ticks: DUEL.skill.ticks, hitIdx: 0 };
        p.guard.stamina -= DUEL.skill.cost;
        p.skillCooldown = Math.max(1, p.skillMaxCooldown || DUEL.skill.cooldown);
        p.attack = 0; p.attackBuffer = 0;
        p.dodge.ticks = 0;
        p.invulnerable = Math.max(p.invulnerable, DUEL.skill.ticks);
        p.vx = p.facing * DUEL.skill.dashSpeed;
        const cx0 = p.x + p.w / 2;
        s.events.push({ type: 'skill', hero: p.hero, kind: 'shadow', x: cx0, y: p.y + p.h / 2, facing: p.facing, cost: DUEL.skill.cost });
      }
    } else if ((mask & INPUT.SKILL) && p.skillCooldown <= 0) {
      p.skillCooldown = p.skillMaxCooldown;
      s.events.push({ type: 'skill', x: p.x, y: p.y, hero: p.hero });
      if (p.hero === 'miner') {
        const slamBox = { x: p.x - 80, y: p.y - 10, w: p.w + 160, h: p.h + 20 };
        for (const enemy of s.enemies) {
          if (!enemy.dead && overlap(slamBox, enemy)) {
            const dealt = blow(enemy, 2);
            enemy.hp -= dealt;
            enemy.hurtCooldown = 28;
            s.events.push({ type: 'hit', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2, damage: dealt });
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
            const dealt = blow(enemy, 2);
            enemy.hp -= dealt;
            enemy.hurtCooldown = 25;
            enemy.vx = p.facing * 140;
            s.events.push({ type: 'hit', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2, damage: dealt });
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

    if (dodging) p.dodge.ticks--;
    updateSwing(s);
    if (s.mode === 'duel') updateDuelSkill(s);

    // الارتداد يغلب الإدخال أثناء إطارات تطبيقه (9 إطارات) ثم يعود التحكم كاملاً
    if (p.knock && p.knock.ticks > 0) { p.knock.ticks--; p.vx = p.knock.vx; }
    const routePlatforms = level.platforms.filter(box => box.route === 'upper');
    const solids = level.platforms.filter(box => box.route !== 'upper').concat(s.rocks.filter(r => r.hp > 0));
    // Each upper branch has a deterministic ladder at x + 14, running from the floor (y=300)
    // to the branch platform. UP now climbs when the miner is aligned with those rails.
    const ladder = routePlatforms.find(box => {
      const ladderCenter = box.x + 14;
      // Keep the ladder target active until the miner's feet reach the ledge.
      return Math.abs((p.x + p.w / 2) - ladderCenter) <= 28 &&
        p.y < 300 && p.y + p.h > box.y - 3;
    });
    let climbing = Boolean((mask & INPUT.UP) && ladder && !dodging && !p.guard.active && p.hearts > 0);
    // Axis-separated fixed 60 Hz collision: max displacement < the thinnest solid.
    // Upper branches remain one-way ledges; their ladders are the only way to climb from below.
    if (climbing) {
      p.x = ladder.x + 14 - p.w / 2;
      p.vx = 0;
    } else {
      p.x += p.vx * DT;
      for (const box of solids) if (overlap(p, box)) {
        if (p.vx > 0) p.x = box.x - p.w;
        else if (p.vx < 0) p.x = box.x + box.w;
      }
    }
    p.x = Math.max(0, Math.min(level.width - p.w, p.x));
    // جدران الساحة: في المبارزة لا يخرج اللاعب من بقعة القتال (ولا يسقط في فجوة المنجم)
    if (s.duel?.arena) p.x = Math.max(s.duel.arena.x0, Math.min(s.duel.arena.x1 - p.w, p.x));
    const wasGrounded = p.grounded;
    const previousBottom = p.y + p.h;
    if (climbing && p.y + p.h <= ladder.y + 0.5) {
      // Stop exactly on the upper platform instead of passing through it.
      p.y = ladder.y - p.h;
      p.vy = 0;
      p.grounded = true;
      p.upperRouteY = ladder.y;
      climbing = false;
    } else {
      if (climbing) p.vy = -145;
      else p.vy = Math.min(680, p.vy + 1200 * DT);
      const wasFalling = !climbing && p.vy >= 0;
      p.y += p.vy * DT;
      p.grounded = false;
      if (climbing && p.y + p.h <= ladder.y) {
        p.y = ladder.y - p.h;
        p.vy = 0;
        p.grounded = true;
        p.upperRouteY = ladder.y;
        climbing = false;
      }
      for (const box of solids) if (overlap(p, box)) {
        // At a ladder's top, a neighboring lower ledge may share the same y-coordinate
        // and slightly overlap the miner's width. Do not let that side edge block climbing.
        if (climbing && box.y === ladder.y) continue;
        if (p.vy > 0) { p.y = box.y - p.h; p.grounded = true; }
        else if (p.vy < 0) p.y = box.y + box.h;
        p.vy = 0;
      }
      for (const box of routePlatforms) {
        const overlapsLedge = p.x < box.x + box.w && p.x + p.w > box.x;
        const climbedLedge = p.upperRouteY === box.y;
        // A ladder-qualified ledge is persistent support, not a one-frame landing test.
        // This also handles adjacent same-height solids that overlap the miner at the ladder top.
        // Treat the climbed ledge as a one-way collision plane on every frame.
        // Use the previous feet position as well as the current one so a fast fall,
        // knockback, or gravity step cannot tunnel through the platform after release.
        const persistentLanding = climbedLedge && overlapsLedge &&
          previousBottom <= box.y + 8 && p.y + p.h >= box.y;
        const newlyLanded = wasFalling && previousBottom <= box.y &&
          p.y + p.h >= box.y && overlapsLedge && (mask & INPUT.UP);
        if (persistentLanding || newlyLanded) {
          p.y = box.y - p.h;
          p.grounded = true;
          p.vy = 0;
          if (climbedLedge) p.upperRouteY = box.y;
        }
      }
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
            const dealt = blow(enemy, proj.damage);
            enemy.hp -= dealt;
            enemy.hurtCooldown = 20;
            enemy.vx = (proj.vx > 0 ? 1 : -1) * 90;
            s.events.push({ type: 'hit', x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2, damage: dealt });
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

      // المبارز يُدار بذكاء الساحة أياً كان نمطه (زعيم المنطقة الرابعة أم لا)؛
      // زعماء المنجم لهم مسارهم المستقل.
      if (enemy.type === 'rival') duelStep(s, enemy);
      else if (enemy.boss) bossStep(s, enemy);
      else if (enemy.flying) batStep(s, enemy);
      else {
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

      // Enemy attacking player. المبارز لا يؤذي بالتلاصق العشوائي: ضرره من هجماته المُعلَنة فقط
      // (والاندفاع هو الحالة التي يصطدم فيها بجسمه)، فلا خسارة قلوب بلا سبب مفهوم.
      // الخفاش مثله: ضرره من الانقضاض وحده. في الدوار على الأرض (نافذة الضرب) لا يؤذي إطلاقاً،
      // وإلا لأصبحت مكافأة الضربة عقاباً (الخفاش يهبط على جسد اللاعب نفسه).
      const contact = enemy.type === 'rival' ? enemy.state === 'charge'
        : enemy.flying ? enemy.batState === 'dive' : true;
      if (contact && p.hearts > 0 && overlap(p, enemy)) {
        if (!p.invulnerable && enemy.attackCooldown <= 0) {
          hurt(s, enemy.x + enemy.w / 2);
          enemy.attackCooldown = enemy.armored === false ? 66 : 60;
          s.events.push({ type: 'enemy_attack', x: enemy.x, y: enemy.y, enemyId: enemy.id });
        }
      }
    }

    for (let i = s.waves.length - 1; i >= 0; i--) {
      const wave = s.waves[i];
      if (wave.delay > 0) { wave.delay--; continue; } // الموجة الثانية تنتظر فجوتها المعلنة
      wave.x += wave.vx * DT; wave.ttl--;
      if (wave.ttl <= 0) s.waves.splice(i, 1);
    }
    if (s.bossId && !s.bossDefeated) {
      const boss = s.enemies.find(e => e.id === s.bossId);
      if (boss && boss.dead) {
        s.bossDefeated = true; boss.state = 'dead'; boss.vx = 0; boss.deadTick = s.tick;
        const loot = resolveSlots(mineOf(s.zone), BOSS_SLOTS);
        addOres(s.ores, loot);
        s.events.push({ type: 'boss_death', x: boss.x + boss.w / 2, y: boss.y + boss.h / 2, id: boss.id, ores: loot });
      }
    }
    for (const cp of level.checkpoints) if (p.x > cp.from && p.x < cp.to && p.grounded) s.checkpoint = cp.at;
    const pad = p.magnet || 0, mine = mineOf(s.zone);
    for (const gem of s.gems) if (!gem.taken && overlap(p, { x: gem.x - 9 - pad, y: gem.y - 10 - pad, w: 18 + 2 * pad, h: 20 + 2 * pad })) {
      gem.taken = true; s.collected++;
      if (gem.chest && !s.chestFound) {
        s.chestFound = true;
        const bundle = resolveSlots(mine, CHEST_SLOTS);
        addOres(s.ores, bundle);
        s.events.push({ type: 'chest', x: gem.x, y: gem.y, ores: bundle });
      } else addOres(s.ores, { [gem.ore || mine.tier.common]: 1 });
      s.events.push({ type: 'collect', x: gem.x, y: gem.y, bonus: Boolean(gem.bonus) });
    }
    if (p.y > level.height + 50) {
      if (p.invulnerable) { p.x = s.checkpoint; p.y = 240; p.vx = p.vy = 0; }
      else hurt(s);
    }
    for (const hazard of s.hazards || level.hazards) if (activeHazard(hazard, s.tick) && overlap(p, hazard)) hurt(s);
    for (const wave of s.waves) if (!(wave.delay > 0) && overlap(p, wave)) hurt(s, wave.x + wave.w / 2);
    if (s.status === 'playing' && s.mode !== 'duel' && canExit(s) && overlap(p, level.exit)) {
      s.status = 'won'; s.events.push({ type: 'win', x: p.x, y: p.y });
    }
    // المبارزة تُحسم بإسقاط الخصم فقط (لا بوابة ولا أهداف تعدين)
    if (s.mode === 'duel' && s.status === 'playing' && s.enemies.length && s.enemies.every(e => e.dead)) {
      s.status = 'won';
      s.events.push({ type: 'duel_win', x: p.x + p.w / 2, y: p.y });
    }
    if (s.tick >= MAX_TICKS && s.status === 'playing') {
      s.status = s.mode === 'duel' ? 'lost' : 'lost';
      p.pose = 'dead';
    }

    p.pose = s.status === 'won' ? 'victory' :
      s.status === 'lost' || p.hearts <= 0 ? 'dead' :
      p.invulnerable > (p.hurtInvulnerable || 90) - 30 ? 'hurt' : // المعدات تطيل الحماية لا وضعية الإصابة
      p.dodge.ticks > 0 ? 'dodge' :
      p.guard.active ? 'guard' :
      p.swing && p.swing.kind === 'heavy' ? 'heavy' :
      p.attack > 4 ? ((mask & INPUT.ATTACK) ? 'attack' : 'mine') :
      p.landTimer > 2 ? 'land' :
      !p.grounded ? (p.vy < 0 ? 'jump' : 'fall') :
      direction ? 'run' : 'idle';

    if (s.mode !== 'duel') updateMilestones(s);
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
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_SEGMENTS) return { ok: false, reason: 'inputs' };
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

  // الكاميرا للعرض فقط (لا تدخل في المحاكاة ولا في التحقق). تتبع اللاعب عند 35% من العرض؛ وأثناء معركة الزعيم تنزاح بالقدر اللازم
  // فقط ليبقى الزعيم كاملاً في الشاشة واللاعب بهامش 12% من الحافتين، إن كان ذلك ممكناً (شاشات الهاتف الضيقة تحتاجه).
  const BOSS_VIEW_HALF = 58;
  function cameraFor(s, width) {
    const p = s.player, pc = p.x + p.w / 2;
    let left = pc - width * 0.35;
    const boss = s.mode === 'duel' ? (s.enemies.find(e => !e.dead) || null)
      : s.bossId && !s.bossDefeated ? s.enemies.find(e => e.id === s.bossId) : null;
    if (boss && !boss.dead && boss.state !== 'sleep') {
      const bc = boss.x + boss.w / 2;
      const lo = Math.max(bc + BOSS_VIEW_HALF + 8 - width, pc - width * 0.88), hi = Math.min(bc - BOSS_VIEW_HALF - 8, pc - width * 0.12);
      if (lo <= hi) left = Math.max(lo, Math.min(hi, left));
    }
    return Math.max(0, Math.min(levelFor(s.zone).width - width, left));
  }
  // ===== V19.2 (المرحلة A): المعالم «غنيمة» تُختم عند البوابة =====
  // المشكلة المقيسة قبل الإصلاح: جولة فاشلة سريعة (12 ثانية، 3 معالم) كانت تدفع 36 ذهباً،
  // أي 2.95 ذهب/ثانية مقابل 0.65 لجولة ناجحة كاملة — فالاستراتيجية المثلى كانت «اجمع معلمين ثم مُت».
  // الإصلاح: قيمة الجهد تُدفع عند إتمام الجولة فقط، ويُضاف إليها علاوة إتمام تنمو مع العمق
  // (المحتوى الأصعب يدفع أكثر). الخسارة لا تدفع المعالم؛ يبقى «إنقاذ» صغير ومحدود لا يتجاوز سقفه
  // عائد أي فوز، ولا يظهر قبل عبور أول نقطة حفظ. لا مساس بمعدل النقر ولا بالطاقة ولا بأسعار الترقيات.
  const RUN_REWARD = Object.freeze({
    base: 100,                 // سقف المحتوى (كما كان): 40 + بلورات×4 + صخور×6
    completionBase: 20,        // علاوة إتمام الجولة في أول منجم
    completionStep: 10,        // +10 لكل منجم أعمق (20..70)
    salvageDivisor: 4,         // ربع قيمة المعالم عند الخسارة
    salvageCap: 10,            // سقف الإنقاذ المطلق — 0.11 ذهب/ث كحد أقصى
    // الإنقاذ لا يُدفع إلا لمحاولة صادقة: تجاوز أول نقطة حفظ + 90 ثانية لعب فعلية.
    // (بلا هذا الشرط يصبح «امشِ إلى نقطة الحفظ ثم مُت» مصدر دخل: 10 ذهب/25 ثانية = 0.40 ذهب/ث.)
    salvageMinSeconds: 90,
    startCheckpoint: 64,       // نقطة البداية: لا إنقاذ قبل تجاوزها
  });
  const completionBonus = zone => RUN_REWARD.completionBase
    + RUN_REWARD.completionStep * Math.max(0, Math.min(MINES.length - 1, Number(zone) || 0));
  const rewardCap = zone => RUN_REWARD.base + completionBonus(zone);
  function rewardBreakdown(s) {
    if (s.mode === 'duel') {
      const potential = s.status === 'won' ? duelReward(s.zone) : 0;
      return { potential, milestoneGold: 0, finalGold: potential, salvage: 0, bonus: 0, total: potential };
    }
    const potential = Math.min(RUN_REWARD.base, 40 + s.collected * 4 + s.mined * 6);
    const milestoneEarned = Math.min(potential, (s.milestones?.length || 0) * MILESTONE_GOLD);
    const bonus = completionBonus(s.zone);
    if (s.status === 'won') {
      const total = Math.min(rewardCap(s.zone), potential + bonus);
      const milestoneGold = Math.min(milestoneEarned, total);
      return { potential, milestoneGold, finalGold: total - milestoneGold, salvage: 0, bonus: total - potential, total };
    }
    // خسارة أو توقّف: المعالم لا تُصرف. الإنقاذ تعويض عن محاولة صادقة فقط (نقطة حفظ + 90 ثانية)،
    // ومقيّد بسقف ثابت أقل بفارق كبير من أدنى فوز — فلا توجد استراتيجية خسارة تنافس الفوز.
    const passedCheckpoint = Number(s.checkpoint) > RUN_REWARD.startCheckpoint;
    const honestAttempt = (Number(s.tick) || 0) >= RUN_REWARD.salvageMinSeconds * FPS;
    // جولة لم تنته بعد (تركها اللاعب) لا تُصرف لها أي مكافأة إطلاقاً: الشرط `status === 'lost'` صريح.
    const endedInLoss = s.status === 'lost';
    const salvage = endedInLoss && passedCheckpoint && honestAttempt && milestoneEarned > 0
      ? Math.min(RUN_REWARD.salvageCap, Math.floor(milestoneEarned / RUN_REWARD.salvageDivisor)) : 0;
    return { potential, milestoneGold: 0, finalGold: 0, salvage, bonus: 0, total: salvage };
  }
  // مكافأة المبارزة: 60 + 4 لكل مستوى عمق (60..80). لا تتضخم مع التكرار، والسقف اليومي المستقل خادمي.
  const duelReward = zone => DUEL.reward + DUEL.rewardStep * Math.max(0, Math.min(MINES.length - 1, Number(zone) || 0));
  const rewardFor = s => rewardBreakdown(s).total;
  const oreSummary = s => {
    const out = emptyOres();
    for (const k of ORE_ORDER) out[k] = Math.max(0, Math.floor(s.ores?.[k] || 0));
    return out;
  };
  // ===== V19.2: ما يدخل المخزن فعلاً =====
  // الخامات كانت تُمنح كاملةً حتى في جولة فاشلة عمرها 6 ثوانٍ (قياس: 124 ذهباً عند بيعها في المنجم الثالث)،
  // وهذا باب خلفي على نفس الثغرة: «مُت بسرعة واجمع الخام» يصبح أرخص طريق للذهب ولو كان الذهب المباشر صفراً.
  // القاعدة الآن: الفوز يأخذ كل الغنيمة، والخسارة الصادقة (نقطة حفظ + 90 ثانية) تُسقط نصف الحقيبة كما في
  // ألعاب التعدين، والجولة المتروكة أو الخسارة السريعة لا تُدخل شيئاً.
  function oreAward(s) {
    const full = oreSummary(s);
    if (s.status === 'won') return full;
    const passed = Number(s.checkpoint) > RUN_REWARD.startCheckpoint;
    const honest = (Number(s.tick) || 0) >= RUN_REWARD.salvageMinSeconds * FPS;
    if (s.status !== 'lost' || !passed || !honest) return emptyOres();
    const half = emptyOres();
    for (const k of ORE_ORDER) half[k] = Math.floor((full[k] || 0) / 2);
    return half;
  }
  // ===== V12: لقطات مرجعية للمراجعة البصرية =====
  // سياسة «متقن» نفسها المستخدمة في القياس، تُلعب على المحرك الحقيقي حتى تصل اللحظة
  // المطلوبة (مرحلة الزعيم الثانية، أو موجة على وشك التلامس)، ثم تُجمَّد العرض فقط.
  // مصدر واحد: زر اللقطة في الواجهة وسكربت الرسم كلاهما يقرأ من هنا.
  // ===== V13: لوحة تحكم الهاتف — سحب أفقي للحركة بدل زرّي ◀ ▶ =====
  // الحركة في المحرك ثنائية (LEFT/RIGHT) لا تناظرية، فعصا دائرية تعطي إحساساً كاذباً؛
  // «السحب الأفقي» بمنطقة ميتة صغيرة يعطي نفس الدقة بلا هدف تُخطئه.
  const PAD = Object.freeze({
    deadzone: 8,      // بكسل CSS قبل أن تُحسب الحركة (يمنع المشي أثناء راحة الإبهام)
    knobMax: 26,      // أقصى انزياح للمقبض المرئي عن مركزه
    heavyHoldMs: 260, // ضغط مطوّل على «ضرب» = ضربة قوية واحدة (بدل زر «قوي»)
  });
  const stickDir = (dx, deadzone = PAD.deadzone) => (dx > deadzone ? 1 : dx < -deadzone ? -1 : 0);
  // دمج أقنعة اللمس: أزرار + اتجاه السحب، بلا أن يُنتج يسار+يمين معاً أبداً.
  // إن ضغط زرُ جهة أثناء سحب السحب في الجهة المعاكسة، يفوز الزر (لا إلغاء صامت يوقف الحركة).
  const padMask = ({ stick = 0, bits = [] } = {}) => {
    let mask = 0;
    for (const b of bits) mask |= Number(b) || 0;
    // جهتان معاً = إلغاء (كما في معظم الألعاب)، ثم يأتي دور السحب وحده
    if ((mask & INPUT.LEFT) && (mask & INPUT.RIGHT)) mask &= ~(INPUT.LEFT | INPUT.RIGHT);
    if (!(mask & (INPUT.LEFT | INPUT.RIGHT)) && stick) mask |= stick < 0 ? INPUT.LEFT : INPUT.RIGHT;
    return mask;
  };

  // ===== V12.1: خطة التلميح (دالة نقية — بلا مؤقّتات ولا DOM، فتُختبَر مباشرة) =====
  // الأساسي مرة واحدة عند التحوّل إلى المرحلة الثانية، ثم تذكير واحد فقط عند أول صدمة
  // كاسرة يبدأ تحذيرها والتلميح مختفٍ. لا تكرار مع كل ضربة، ولا تذكير فوق تلميح ظاهر.
  const HINT_TIMING = Object.freeze({ main: 5200, reminder: 2600 });
  const duelHintPlan = (ev, state = {}) => {
    if (!ev) return null;
    if (ev.type === 'boss_enrage' && ev.phase === 2 && DUEL.phase2Hint)
      return { kind: 'main', text: DUEL.phase2Hint, ms: HINT_TIMING.main };
    if (ev.type !== 'boss_windup' || ev.attack !== 'overhead') return null;
    if ((Number(state.phase) || 1) < 2) return null;         // الكاسرة في المرحلة الأولى ليست موضوع التلميح
    if (state.reminderShown) return null;                    // تذكير واحد لكل مبارزة
    if (state.hintVisible) return null;                      // الأساسي ما زال على الشاشة
    if (!DUEL.phase2Reminder) return null;
    return { kind: 'reminder', text: DUEL.phase2Reminder, ms: HINT_TIMING.reminder };
  };

  const captureMask = (sim) => {
    const r = (sim.enemies || []).find(e => !e.dead);
    if (!r) return 0;
    const me = sim.player, dx = r.x + r.w / 2 - (me.x + me.w / 2), ad = Math.abs(dx);
    const skillCost = DUEL.skill ? DUEL.skill.cost : Infinity;
    if (r.state === 'windup') {
      const close = ad < 118, late = r.timer <= 9;
      if (close && late) {
        if (r.attack !== 'overhead') return INPUT.DEFEND;
        return (r.ai && r.ai.wideSlam) ? INPUT.JUMP : INPUT.DODGE;
      }
      if (close) return 0;
      return dx > 0 ? INPUT.RIGHT : INPUT.LEFT;
    }
    if (r.state === 'charge' && ad < 130) return INPUT.JUMP;
    const wave = (sim.waves || []).find(w => !(w.delay > 0) && Math.abs((w.x + w.w / 2) - (me.x + me.w / 2)) < 90);
    if (wave && me.grounded) return INPUT.JUMP;
    const safe = r.state === 'recover' || r.state === 'retreat' || r.state === 'stagger';
    if (safe) {
      if (ad > 68) return dx > 0 ? INPUT.RIGHT : INPUT.LEFT;
      if (Number.isFinite(skillCost) && me.skillCooldown <= 0 && me.guard.stamina >= skillCost + 10) return INPUT.SKILL;
      if (me.heavyCooldown <= 0) return INPUT.HEAVY;
      return INPUT.ATTACK;
    }
    if (ad > 70) return dx > 0 ? INPUT.RIGHT : INPUT.LEFT;
    return 0;
  };
  // لحظة اللقطة: تحذير الصدمة الكاسرة في المرحلة الثانية (الإنذار مرسوم كاملاً)،
  // أو موجة ريح قريبة واللاعب في الهواء فوقها.
  const captureHit = (kind, sim, view = {}) => {
    if (kind === 'boss') {
      const r = (sim.enemies || [])[0];
      if (!r || r.state !== 'windup' || r.attack !== 'overhead' || (r.phase || 1) < 2) return false;
      const warn = (r.ai && r.ai.windup) || 46;
      return r.timer <= warn - 12 && r.timer >= 16;
    }
    // موجة الريح: اللاعب في أول إطارات القفز (قريب من الأرض) والموجة على وشك ملامسة قدميه —
    // أفضل لحظة للحكم على حجم الموجة وتباينها مقابل أرض الحلبة.
    const p = sim.player;
    if (!p || p.grounded || p.vy >= 0) return false;
    if (Number.isFinite(view.groundY) && view.groundY - p.y > 40) return false;
    const w = (sim.waves || []).find(x => !(x.delay > 0));
    if (!w) return false;
    const gap = Math.abs((w.x + w.w / 2) - (p.x + p.w / 2));
    return gap >= 45 && gap <= 95;
  };
  // يعيد حالة مجمّدة عند اللحظة المطلوبة، أو null إن لم تصل أي بذرة إليها.
  const captureSim = (kind, hero = 'miner', { zone = kind === 'boss' ? 3 : 2, loadout = null, attempts = 10, maxTicks = 6000 } = {}) => {
    for (let a = 0; a < attempts; a++) {
      const s = create(hero, 2024 + a * 137, { zone, mode: 'duel', loadout });
      // أرض الحلبة = أدنى مستوى وقف عليه اللاعب (أكبر y)، لا الصخور المرتفعة
      let groundY = NaN;
      for (let t = 0; t < maxTicks && s.status === 'playing'; t++) {
        if (s.player.grounded) groundY = Number.isFinite(groundY) ? Math.max(groundY, s.player.y) : s.player.y;
        step(s, captureMask(s));
        if (captureHit(kind, s, { groundY })) return s;
      }
    }
    return null;
  };
  const capture = Object.freeze({ mask: captureMask, hit: captureHit, sim: captureSim });

  const milestoneList = (zone = 0) => MILESTONES.map(m => ({ id: m.id, label: m.label, gold: MILESTONE_GOLD, ores: milestoneOres(zone, m.id) }));

  return {
    BOSS_SLOTS, MAX_SEGMENTS, combatGear, combatAdvice, arenaAxeBonus, RIVALS, rivalFor,
    VERSION, FPS, DT, MAX_TICKS, INPUT, CHARACTERS, capture, duelHintPlan, HINT_TIMING, PAD, stickDir, padMask, LEVEL, LEVELS, levelFor, seedFromId, layoutFor, create, step, replay, overlap, activeHazard, canExit, cameraFor,
    rewardFor, rewardBreakdown, rewardCap, completionBonus, RUN_REWARD, BAT, oreSummary, oreAward, milestoneList, milestoneOres, ORES, MILESTONES, MILESTONE_GOLD,
    // V6: أهداف الجولة والمفترق والعرق النادر
    GOALS, goalStatus, oreTarget, oreTotal, perchAt, SPEED_TICKS, ORE_WIND_TICK,
    // V7: وضع المبارزة الحيّة + الصدّ
    MODES, DUEL, GUARD, COMBAT, MAX_MASK, RIVALS, rivalFor, duelStatus, duelEnemy, duelReward,
    // المرحلة 3
    MINES, ZONES, EQUIPMENT, EQUIPMENT_ORDER, MAX_EQUIP_LEVEL, ORE_LADDER,
    normalizeConfig, normalizeLoadout, normalizeProgress, loadoutStats, equipCost, effectText, hitsToBreak, mineStatus, mineUnlocked,
  };
});
