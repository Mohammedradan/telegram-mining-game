(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformEquipment = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EQUIPMENT_ORDER = Object.freeze(['pickaxe', 'boots', 'bag', 'magnet', 'drill', 'robot', 'luck', 'armor']);
  const EQUIPMENT = Object.freeze({
    pickaxe: { name: 'قوة المعول', icon: 'i-pickaxe', blurb: 'تكسير الصخور بضربات أقل', gold: 50, scale: 10 },
    boots: { name: 'حذاء المعدّن', icon: 'i-boots', blurb: 'حركة أسرع داخل المنجم', gold: 60, scale: 10 },
    bag: { name: 'حقيبة الموارد', icon: 'i-bag', blurb: 'خامات أكثر من كل صخرة', gold: 70, scale: 12 },
    magnet: { name: 'المغناطيس', icon: 'i-magnet', blurb: 'جذب البلورات من مسافة أبعد', gold: 80, scale: 12 },
    drill: { name: 'المثقاب', icon: 'i-drill', blurb: 'ضربات أسرع ومدى أطول', gold: 90, scale: 15 },
    robot: { name: 'روبوت التعدين', icon: 'i-robot', blurb: 'يضرب أقرب صخرة تلقائياً', gold: 100, scale: 15 },
    luck: { name: 'حظ المعدّن', icon: 'i-luck', blurb: 'فرصة أعلى للخامات النادرة', gold: 110, scale: 13 },
    armor: { name: 'معدات الحماية', icon: 'i-armor', blurb: 'قلوب إضافية وحماية أطول', gold: 120, scale: 13 },
  });
  const ORE_LADDER = Object.freeze(['copper', 'iron', 'gold', 'crystal', 'lava']);
  const ORE_QTY = Object.freeze([6, 6, 6, 5, 4]);
  const GOLD_STEP = Object.freeze([100, 160, 256, 410, 655]);
  const NO_BONUS = 'بلا إضافة';
  const EFFECT_TEXT = {
    pickaxe: L => (L ? `+${L} قوة تعدين لكل ضربة` : NO_BONUS),
    boots: L => (L ? `+${4 * L}% سرعة حركة` : NO_BONUS),
    bag: L => (L ? `+${15 * L}% خامات من كل صخرة` : NO_BONUS),
    magnet: L => (L ? `مدى جذب البلورات +${12 * L} بكسل` : NO_BONUS),
    drill: L => (L ? `زمن تبريد الضربة −${L} إطار · المدى +${5 * L} بكسل` : NO_BONUS),
    robot: L => (L ? `ضربة آلية بقوة ${1 + L} كل ${((190 - 28 * L) / 60).toFixed(1)} ثانية` : 'غير مفعّل'),
    luck: L => (L ? `+${4 * L}% فرصة للخام النادر` : NO_BONUS),
    armor: L => (L ? `+${Math.floor((L + 1) / 2)} قلب · مهلة حماية بعد الإصابة +${(8 * L / 60).toFixed(1)} ثانية` : NO_BONUS),
  };

  function create({ maxLevel, mines, goals, modes, characters, combat, duel, guard, arenaAxeBonus, mineOf }) {
    const levelOf = value => Math.max(0, Math.min(maxLevel, Math.floor(Number(value)) || 0));

    function normalizeLoadout(input) {
      const source = input && typeof input === 'object' ? input : {};
      const out = {};
      for (const id of EQUIPMENT_ORDER) out[id] = levelOf(source[id]);
      return out;
    }

    function normalizeConfig(input) {
      const source = input && typeof input === 'object' ? input : {};
      const zone = Number.isInteger(source.zone) && source.zone >= 0 && source.zone < mines.length ? source.zone : 0;
      const goal = Number.isInteger(source.goal) && source.goal >= 0 && source.goal < goals.length ? source.goal : 0;
      const mode = modes.includes(source.mode) ? source.mode : 'mine';
      return { zone, goal, mode, loadout: normalizeLoadout(source.loadout) };
    }

    function equipCost(id, level) {
      const def = EQUIPMENT[id], currentLevel = levelOf(level);
      if (!def || currentLevel >= maxLevel) return null;
      return { gold: Math.round(def.gold * GOLD_STEP[currentLevel] / 100), ores: { [ORE_LADDER[currentLevel]]: Math.ceil(ORE_QTY[currentLevel] * def.scale / 10) } };
    }

    function loadoutStats(heroId, loadout) {
      const hero = characters[heroId] || characters.miner, levels = normalizeLoadout(loadout);
      const armorHearts = Math.floor((levels.armor + 1) / 2);
      return {
        speed: Math.round(hero.speed * (100 + 4 * levels.boots) / 100),
        hearts: hero.hearts + armorHearts,
        maxHearts: hero.maxHearts + armorHearts,
        hurtInvulnerable: (hero.hurtInvulnerable || 90) + 8 * levels.armor,
        miningPower: hero.miningPower + levels.pickaxe,
        attackCooldown: Math.max(8, hero.attackCooldown - levels.drill),
        miningReach: hero.miningReach + 5 * levels.drill,
        magnet: 12 * levels.magnet,
        yieldPercent: 100 + 15 * levels.bag,
        luck: levels.luck,
        robot: levels.robot > 0 ? { period: 190 - 28 * levels.robot, damage: 1 + levels.robot, range: 170 } : null,
        combat: {
          damage: Math.min(2, Math.floor(levels.pickaxe / 2)),
          guardBreak: Math.min(2, Math.floor(levels.pickaxe / 2)),
          guardStamina: 10 * levels.armor,
          breathRegen: Math.min(1, Math.floor(levels.armor / 2)),
          dodgeCooldown: Math.max(30, combat.dodge.cooldown - 3 * levels.drill),
          skillCooldown: Math.max(90, hero.skillCooldown - 8 * levels.drill),
          duelSkillCooldown: Math.max(100, duel.skill.cooldown - 10 * levels.drill),
        },
      };
    }

    const effectText = (id, level) => (EFFECT_TEXT[id] ? EFFECT_TEXT[id](levelOf(level)) : '');

    function combatGear(heroId, loadout) {
      const levels = normalizeLoadout(loadout), stats = loadoutStats(heroId, loadout).combat;
      const hero = characters[heroId] || characters.miner, bonus = arenaAxeBonus(levels.pickaxe);
      return [
        { id: 'pickaxe', name: 'الفأس', level: levels.pickaxe, max: maxLevel,
          effect: bonus ? `ضرر الساحة ${hero.damage + bonus} (‎+${bonus})` : `ضرر الساحة ${hero.damage} — يزيد عند المستوى 4`,
          detail: stats.guardBreak ? `كسر الدفاع +${4 * stats.guardBreak} إطار ترنّح` : 'بلا كسر دفاع إضافي' },
        { id: 'armor', name: 'الدرع', level: levels.armor, max: maxLevel,
          effect: `نَفَس الدرع ${guard.max + stats.guardStamina} · القلوب ثابتة في الساحة`,
          detail: stats.breathRegen ? `استعادة الأنفاس +${stats.breathRegen}/إطار` : 'بلا استعادة أنفاس إضافية' },
        { id: 'drill', name: 'المثقاب', level: levels.drill, max: maxLevel,
          effect: `مهلة ظل الساكورا ${stats.duelSkillCooldown} إطار`,
          detail: `مهلة المراوغة ${stats.dodgeCooldown} إطار` },
      ];
    }

    function combatAdvice(heroId, loadout) {
      const levels = normalizeLoadout(loadout), stats = loadoutStats(heroId, loadout), combatStats = stats.combat;
      const hero = characters[heroId] || characters.miner;
      const damage = hero.damage + arenaAxeBonus(levels.pickaxe);
      let priority;
      if (levels.armor < maxLevel) {
        priority = { id: 'armor', name: 'الدرع', from: levels.armor, to: levels.armor + 1,
          why: `نَفَس الدرع ${guard.max + combatStats.guardStamina} ← ${guard.max + 10 * (levels.armor + 1)}: صدّات أكثر قبل انكسار الدفاع` };
      } else if (levels.drill < maxLevel) {
        priority = { id: 'drill', name: 'المثقاب', from: levels.drill, to: levels.drill + 1,
          why: `مهلة المهارة ${combatStats.duelSkillCooldown} ← ${Math.max(100, duel.skill.cooldown - 10 * (levels.drill + 1))} إطاراً` };
      } else if (levels.pickaxe < 4) {
        priority = { id: 'pickaxe', name: 'الفأس', from: levels.pickaxe, to: 4,
          why: `المستوى 4 يرفع ضرر الساحة من ${damage} إلى ${hero.damage + 1}: أقصر طريق لإنهاء المبارزة` };
      } else if (levels.pickaxe < maxLevel) {
        priority = { id: 'pickaxe', name: 'الفأس', from: levels.pickaxe, to: maxLevel,
          why: `كسر دفاع أطول: ${4 * combatStats.guardBreak} ← ${4 * Math.min(2, Math.floor(maxLevel / 2))} إطار ترنّح` };
      } else {
        priority = null;
      }
      return {
        rows: combatGear(heroId, loadout),
        arena: { hearts: duel.heartsFor(hero), damage, breath: guard.max + combatStats.guardStamina,
          skillCd: combatStats.duelSkillCooldown, dodgeCd: combatStats.dodgeCooldown, guardBreak: 4 * combatStats.guardBreak },
        strength: damage >= hero.damage + 1 ? `ضرر ${damage} لكل ضربة — إنهاء أسرع للمبارزة`
          : combatStats.guardStamina >= 40 ? `نَفَس ${guard.max + combatStats.guardStamina} — يتحمّل صدّات متتالية`
          : combatStats.duelSkillCooldown <= 110 ? `ظل الساكورا كل ${combatStats.duelSkillCooldown} إطاراً`
          : combatStats.guardBreak >= 2 ? `كسر دفاع +${4 * combatStats.guardBreak} إطار ترنّح بعد ثلاث ضربات`
          : combatStats.guardStamina > 0 ? `نَفَس ${guard.max + combatStats.guardStamina}: صدّتان أو ثلاث قبل الانكسار`
          : 'معدات متوازنة بلا نقطة قوة بارزة',
        weakness: levels.armor === 0 ? 'لا نَفَس إضافي: الدرع ينكسر سريعاً أمام الموجات'
          : levels.drill === 0 ? 'مهلة المهارة كاملة (150 إطاراً)'
          : damage === hero.damage ? 'الضرر الأساسي فقط حتى مستوى الفأس 4'
          : 'لا ضعف حاسم',
        priority,
        optional: 'توصية اختيارية — لا مستوى مطلوباً لدخول أي منطقة',
      };
    }

    const hitsToBreak = (heroId, zone, loadout) => Math.ceil(mineOf(zone).rockHp / loadoutStats(heroId, loadout).miningPower);
    const normalizeProgress = input => {
      const wins = input && Array.isArray(input.wins) ? input.wins : [];
      return { wins: mines.map((_, i) => Math.max(0, Math.floor(Number(wins[i])) || 0)) };
    };

    function mineStatus(zone, progress, loadout) {
      if (!Number.isInteger(zone) || zone < 0 || zone >= mines.length) return null;
      const mine = mines[zone], wins = normalizeProgress(progress).wins, levels = normalizeLoadout(loadout);
      const needs = [];
      if (mine.requires) {
        const previous = mine.requires.win;
        needs.push({ kind: 'win', zone: previous, label: `الفوز في ${mines[previous].name}`, ok: wins[previous] >= 1 });
        for (const [id, level] of Object.entries(mine.requires.gear || {})) {
          needs.push({ kind: 'gear', id, level, label: `${EQUIPMENT[id].name} مستوى ${level}`, ok: levels[id] >= level });
        }
      }
      return { zone, id: mine.id, unlocked: needs.every(need => need.ok), needs, wins: wins[zone] };
    }

    const mineUnlocked = (zone, progress, loadout) => Boolean(mineStatus(zone, progress, loadout)?.unlocked);
    return {
      EQUIPMENT_ORDER, EQUIPMENT, ORE_LADDER, levelOf, normalizeLoadout, normalizeConfig,
      equipCost, loadoutStats, effectText, combatGear, combatAdvice, hitsToBreak,
      normalizeProgress, mineStatus, mineUnlocked,
    };
  }

  return { create };
});
