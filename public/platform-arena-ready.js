/* شاشة الاستعداد (المرحلة B) — نموذج البيانات وحده، بلا DOM وبلا رسم.
   كل رقم هنا مقروء من `platform-rules.js` أو من سجل اللاعب؛ لا رقم مكتوب يدوياً في الواجهة.
   مؤشر «توازن القوة» رقم مشتق للعرض فقط (لا يدخل في أي حساب قتالي ولا يُرسل للخادم). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformArenaReady = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // أسماء الساحات الأربع كما يرسمها المشهد (PlatformArenaScene.ARENAS) — تُمرَّر عند البناء إن توفّرت
  const ARENA_NAMES = [
    'معبد الساكورا تحت القمر',
    'غابة البامبو المظلمة',
    'دوجو الجبل القديم',
    'حصن الظلال',
  ];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // مؤشرات مقارنة للعرض فقط: القلوب والضرر والنَفَس للبطل، والصحة لخصم الساحة.
  // الغرض أن يرى اللاعب «أين يقف» قبل المبارزة، وليس تعديل أي رقم في المحرك.
  const heroPower = (h) => Math.round(num(h.hearts) * 20 + num(h.damage) * 15 + num(h.breath) / 12);
  const rivalPower = (hp) => Math.round(num(hp) * 2) + 20;

  function rivalHp(rules, zone) {
    const base = rules.DUEL && rules.DUEL.rival ? num(rules.DUEL.rival.hp, 34) : 34;
    const step = rules.DUEL && rules.DUEL.rival ? num(rules.DUEL.rival.hpPerZone, 6) : 6;
    return base + step * num(zone);
  }

  function fighterOf(rules, heroId, equipment) {
    const hero = (rules.CHARACTERS && rules.CHARACTERS[heroId]) || {};
    const adv = rules.combatAdvice ? rules.combatAdvice(heroId, equipment || {}).arena : {};
    const gear = rules.combatGear ? rules.combatGear(heroId, equipment || {}) : [];
    const hearts = num(adv.hearts, num(hero.hearts, 3));
    const damage = num(adv.damage, num(hero.damage, 1));
    const breath = num(adv.breath, 150);
    return {
      id: heroId,
      name: hero.name || 'المحارب',
      role: hero.role || '',
      hearts,
      maxHearts: num(hero.maxHearts, hearts),
      damage,
      breath,
      skill: hero.skillName || 'مهارة',
      skillCd: Math.round((num(adv.skillCd, num(hero.skillCooldown, 180)) / 60) * 10) / 10,
      dodgeCd: Math.round((num(adv.dodgeCd, 46) / 60) * 10) / 10,
      gear: gear.map((g) => ({ id: g.id, name: g.name, level: g.level, max: g.max })),
      power: heroPower({ hearts, damage, breath }),
    };
  }

  function zoneInfo(rules, zone, mines, equipment, names) {
    const rival = (rules.rivalFor && rules.rivalFor(zone)) || (rules.RIVALS && rules.RIVALS[zone]) || {};
    const status = (rules.mineStatus ? rules.mineStatus(zone, mines || {}, equipment || {}) : null) || { unlocked: true, needs: [] };
    const hp = rivalHp(rules, zone);
    const phases = Array.isArray(rival.phases) && rival.phases.length ? rival.phases[0] : null;
    return {
      zone: num(zone),
      level: num(zone) + 1,
      name: names[num(zone) % names.length] || ARENA_NAMES[num(zone) % ARENA_NAMES.length],
      rival: {
        level: num(zone) + 1,
        name: rival.name || 'مبارز',
        tag: rival.tag || rival.style || '',
        role: rival.style || '',
        hp,
        moves: phases ? phases.length : 4,
        reward: rules.duelReward ? num(rules.duelReward(zone)) : 0,
        locked: status.unlocked === false,
        needs: (status.needs || []).filter((n) => !n.ok).map((n) => n.label),
        power: rivalPower(hp),
      },
    };
  }

  // النموذج الكامل لشاشة الاستعداد
  function build(opts) {
    const o = opts || {};
    const rules = o.rules;
    if (!rules) throw new Error('arena-ready: rules required');
    const names = Array.isArray(o.arenaNames) && o.arenaNames.length ? o.arenaNames : ARENA_NAMES;
    const zones = Array.isArray(o.zones) && o.zones.length ? o.zones : (rules.ARENA_TIER_ZONES || [0, 1, 2, 3]);
    const zone = zones.includes(num(o.zone)) ? num(o.zone) : zones[0];
    const here = zoneInfo(rules, zone, o.mines, o.equipment, names);
    const hero = fighterOf(rules, o.heroId || 'miner', o.equipment);
    hero.level = Math.max(1, num(o.heroLevel, 1));

    const rec = o.record || {};
    const wins = num(rec.wins), losses = num(rec.losses), draws = num(rec.draws);
    const total = wins + losses + draws;
    const best = zones.reduce((m, z) => Math.max(m, rules.duelReward ? num(rules.duelReward(z)) : 0), 0);

    const rail = zones.map((z) => {
      const info = zoneInfo(rules, z, o.mines, o.equipment, names);
      return {
        zone: info.zone,
        name: info.name,
        short: info.name.split(' ').slice(0, 2).join(' '),
        rival: info.rival.name,
        reward: info.rival.reward,
        locked: info.rival.locked,
        selected: info.zone === zone,
      };
    });

    const balance = clamp(hero.power / (hero.power + here.rival.power || 1), 0.05, 0.95);
    return {
      zone,
      arena: { id: zone % names.length, name: here.name },
      hero,
      rival: here.rival,
      record: {
        wins, losses, draws, total,
        winRate: total ? wins / total : null,
        best,
      },
      rail,
      balance,
      cta: {
        label: here.rival.locked ? 'مبارز مقفل' : 'ابدأ المبارزة',
        disabled: here.rival.locked,
      },
    };
  }

  return { build, ARENA_NAMES, heroPower, rivalPower };
});
