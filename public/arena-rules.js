// ⚔️ قواعد الساحة المشتركة بين العميل والخادم.
// المباراة محاكاة حتمية: بذرة ومستوى الخصم يصدرهما الخادم في «تذكرة»، والعميل لا يرسل سوى قائمة
// حركاته؛ يعيد الخادم تشغيل المباراة بنفس المحرك ويختم نتيجتها بنفسه. أي اختلاف بين ما عرضه العميل
// وما أعاد الخادم حسابه = مباراة مرفوضة. لا عشوائية من المتصفح هنا: كل الأرقام من البذرة.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArenaRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONFIG = Object.freeze({
    maxHp: 100, maxEnergy: 10, regen: 2, winReward: 50, maxRounds: 30,
    enemyDelayMs: 750, // مهلة دور الروبوت في الواجهة — أدنى زمن حقيقي لكل دور للخصم
    costs: Object.freeze({ ATTACK: 3, DEFEND: 1, HEAL: 4, WAIT: 0 }),
  });
  const ACTIONS = Object.freeze(['ATTACK', 'DEFEND', 'HEAL', 'WAIT']);
  const enemyHpFor = (level) => 80 + level * 10;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = (rng, min, max) => Math.floor(min + rng() * (max - min + 1));
  const clampLevel = (level) => Math.max(1, Math.min(99, Math.floor(Number(level)) || 1));

  function newBattle({ level, seed }) {
    const lvl = clampLevel(level);
    const s = Number(seed) >>> 0;
    return {
      active: true, outcome: null, round: 1, level: lvl, seed: s, enemyTurns: 0, moves: [],
      rng: mulberry32(s),
      player: { hp: CONFIG.maxHp, maxHp: CONFIG.maxHp, energy: CONFIG.maxEnergy, defending: false },
      enemy: { hp: enemyHpFor(lvl), maxHp: enemyHpFor(lvl), energy: CONFIG.maxEnergy, defending: false, level: lvl },
    };
  }

  // حركة قانونية: طاقة كافية، ولا علاج بصحة مكتملة
  function canAct(fighter, action) {
    return ACTIONS.includes(action) && fighter.energy >= CONFIG.costs[action] && !(action === 'HEAL' && fighter.hp >= fighter.maxHp);
  }

  function applyMove(battle, actor, target, action) {
    switch (action) {
      case 'ATTACK': {
        actor.energy -= CONFIG.costs.ATTACK;
        let dmg = rand(battle.rng, 10, 15);
        if (target.defending) { dmg = Math.round(dmg / 2); target.defending = false; }
        target.hp -= dmg;
        return { action, dmg };
      }
      case 'DEFEND': actor.energy -= CONFIG.costs.DEFEND; actor.defending = true; return { action };
      case 'HEAL': {
        actor.energy -= CONFIG.costs.HEAL;
        const healed = Math.min(20, actor.maxHp - actor.hp);
        actor.hp += healed;
        return { action, healed };
      }
      default: actor.energy = Math.min(CONFIG.maxEnergy, actor.energy + 3); return { action: 'WAIT' };
    }
  }

  function settle(battle) {
    if (battle.active && (battle.enemy.hp <= 0 || battle.player.hp <= 0)) {
      battle.active = false;
      battle.outcome = battle.enemy.hp <= 0 ? 'win' : 'loss';
    }
    return battle.outcome;
  }

  // 🧠 قرارات الروبوت — المنطق التاريخي نفسه، لكن من البذرة؛ ولا يختار حركة لا يملك طاقتها
  function enemyDecide(battle) {
    const e = battle.enemy; const p = battle.player; const rng = battle.rng;
    if (e.hp <= e.maxHp * 0.35 && e.energy >= 4 && rng() < 0.7) return 'HEAL';           // أولوية البقاء
    if (e.energy < 3) { const r = rng(); return (r < 0.8 || e.energy < 1) ? 'WAIT' : 'DEFEND'; } // إدارة الطاقة
    if (p.hp <= 15) return 'ATTACK';                                                       // إنهاء الخصم الضعيف
    if (e.hp <= e.maxHp * 0.5 && p.energy >= 3 && e.energy >= 1 && rng() < 0.3) return 'DEFEND'; // توقّع هجومك
    return rng() < 0.75 ? 'ATTACK' : (e.energy >= 4 && e.hp < e.maxHp ? 'HEAL' : 'WAIT');
  }

  function playerMove(battle, action) {
    if (!battle.active) return { error: 'inactive' };
    if (!canAct(battle.player, action)) return { error: 'illegal', action };
    battle.moves.push(action);
    const ev = applyMove(battle, battle.player, battle.enemy, action);
    ev.actor = 'player';
    settle(battle);
    return ev;
  }

  function enemyMove(battle) {
    if (!battle.active) return { error: 'inactive' };
    const ev = applyMove(battle, battle.enemy, battle.player, enemyDecide(battle));
    ev.actor = 'enemy';
    battle.enemyTurns += 1;
    settle(battle);
    return ev;
  }

  // حسم عند انتهاء الجولات: الأعلى نسبة صحة يفوز، والتعادل بلا فائز
  function judge(battle) {
    const pRatio = battle.player.hp / battle.player.maxHp;
    const eRatio = battle.enemy.hp / battle.enemy.maxHp;
    battle.active = false;
    if (Math.abs(pRatio - eRatio) < 0.001) { battle.outcome = 'draw'; return { judged: true, draw: true, pRatio, eRatio }; }
    if (pRatio > eRatio) battle.enemy.hp = 0; else battle.player.hp = 0;
    battle.outcome = pRatio > eRatio ? 'win' : 'loss';
    return { judged: true, draw: false, pRatio, eRatio };
  }

  // بعد دور الروبوت: جولة جديدة بتجدد طاقة للطرفين، أو حسم إن انتهت الجولات
  function nextRound(battle) {
    if (!battle.active) return null;
    battle.round += 1;
    if (battle.round > CONFIG.maxRounds) return judge(battle);
    battle.player.energy = Math.min(CONFIG.maxEnergy, battle.player.energy + CONFIG.regen);
    battle.enemy.energy = Math.min(CONFIG.maxEnergy, battle.enemy.energy + CONFIG.regen);
    return { judged: false, round: battle.round };
  }

  // إعادة تشغيل مباراة كاملة من قائمة حركات اللاعب (يستخدمها الخادم للختم)
  function replay({ level, seed, moves }) {
    if (!Array.isArray(moves) || moves.length === 0 || moves.length > CONFIG.maxRounds || moves.some((m) => !ACTIONS.includes(m))) {
      return { ok: false, reason: 'invalid' };
    }
    const battle = newBattle({ level, seed });
    let used = 0;
    while (battle.active && used < moves.length) {
      if (playerMove(battle, moves[used++]).error) return { ok: false, reason: 'illegal_move', round: battle.round, battle };
      if (!battle.active) break;
      enemyMove(battle);
      if (!battle.active) break;
      nextRound(battle); // قد يحسم المباراة بعد الجولة الأخيرة
    }
    if (battle.active) return { ok: false, reason: 'unfinished', battle };
    if (used < moves.length) return { ok: false, reason: 'extra_moves', battle }; // حركات بعد النهاية
    return { ok: true, outcome: battle.outcome, rounds: battle.round, enemyTurns: battle.enemyTurns, battle };
  }

  // أدنى زمن حقيقي لمباراة: كل دور للروبوت يسبقه انتظار الواجهة
  const minDurationMs = (enemyTurns) => Math.max(0, Math.floor(enemyTurns)) * CONFIG.enemyDelayMs;

  return { CONFIG, ACTIONS, mulberry32, enemyHpFor, newBattle, canAct, playerMove, enemyMove, nextRound, replay, minDurationMs };
}));
