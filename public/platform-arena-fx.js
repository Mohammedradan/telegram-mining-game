(function (root) {
  'use strict';

  function create({ rules, el, reduced, beep }) {
    let arenaParticles = [], arenaFloaters = [], arenaShake = 0;
    let hintReminderShown = false;
    // V11: تلميح المرحلة الثانية — نصّ من المحرك نفسه، يظهر عند الاهتياج فقط ويختفي وحده
    let arenaHintTimer = 0;
    function arenaHint(text, ms = 5200, kind = 'main') {
      const box = el('arena-hint');
      if (!box || !text) return;
      box.textContent = text;
      // التذكير المختصر أصغر وأقل حجباً (CSS: .arena-hint.remind) — نفس الصندوق، نصّ أخفّ
      box.classList.toggle('remind', kind === 'reminder');
      box.classList.add('show');
      if (arenaHintTimer) { root.clearTimeout(arenaHintTimer); arenaHintTimer = 0; }
      // ms ≤ 0: تلميح ثابت (للالتقاط البصري) — يُمسح بـ arenaHintHide
      if (ms > 0) arenaHintTimer = root.setTimeout(() => { box.classList.remove('show'); arenaHintTimer = 0; }, ms);
    }
    function arenaHintHide() {
      const box = el('arena-hint');
      if (arenaHintTimer) { root.clearTimeout(arenaHintTimer); arenaHintTimer = 0; }
      if (box) { box.classList.remove('show', 'remind'); box.textContent = ''; }
    }
    const arenaHintVisible = () => Boolean(el('arena-hint')?.classList?.contains('show'));
    // V12.1: التذكير المختصر يُصرف مرة واحدة لكل مبارزة (يُعاد تصفيره مع كل مسرح/مبارزة جديدة)
    function arenaHintReset() { hintReminderShown = false; arenaHintHide(); }

    function collectFx(fromSim, withSound = false) {
      if (!fromSim) return;
      // أصوات الساحة: تُشغَّل من المبارزة الحيّة فقط، لا من المسرح الاستعراضي
      const sfx = (type) => { if (withSound) { try { beep(type); } catch (_) {} } };
      for (const ev of fromSim.events || []) {
        if (ev.type === 'hit') {
          const strong = (ev.damage || 0) > 0;
          if (!reduced) {
            for (let i = 0; i < (strong ? 11 : 4); i++) arenaParticles.push({
              x: ev.x, y: ev.y, vx: (Math.random() - 0.5) * 3.2, vy: -1 - Math.random() * 1.8,
              life: 16 + Math.random() * 10, color: strong ? (i % 2 ? '#ffd166' : '#fff3c9') : '#9fd8ff',
              size: 2 + Math.random() * 2.2, glow: true,
            });
          }
          arenaFloaters.push({ x: ev.x, y: ev.y - 10, text: strong ? `-${ev.damage}` : 'صدّ', color: strong ? '#ffd166' : '#9fd8ff', life: 36, maxLife: 36, size: strong ? 16 : 12, scale: 1 });
          if (strong) arenaShake = Math.max(arenaShake, 0.36);
          sfx(strong ? 'hit' : 'clang');
          sfx(ev.heavy ? 'heavy' : 'swing');
        } else if (ev.type === 'swing' && !reduced) {
          for (let i = 0; i < 5; i++) arenaParticles.push({
            x: ev.x + (ev.facing >= 0 ? 26 : -6), y: ev.y + 22, vx: ev.facing * (1.2 + i * 0.5) + (Math.random() - 0.5),
            vy: (Math.random() - 0.5) * 0.8, life: 14, color: '#e8f6ff', size: 2.6, glow: true, trail: true,
          });
        } else if (ev.type === 'boss_slam' || ev.type === 'boss_crash') {
          sfx(ev.type === 'boss_crash' ? 'boss_crash' : 'boss_slam');
          if (!reduced) for (let i = 0; i < 12; i++) arenaParticles.push({
            x: ev.x + (i - 6) * 9, y: 296, vx: (i - 6) * 0.35 + (Math.random() - 0.5), vy: -0.8 - Math.random() * 1.6,
            life: 22, color: i % 2 ? '#c9b8a0' : '#efe3cf', size: 3, glow: false,
          });
          arenaShake = Math.max(arenaShake, ev.type === 'boss_crash' ? 0.66 : 0.5);
        } else if (ev.type === 'skill') {
          sfx('skill_shadow');
          // ظل الساكورا: عاصفة بتلات + خيط ضوء خلف الاندفاع
          if (!reduced) {
            for (let i = 0; i < 16; i++) arenaParticles.push({
              x: ev.x + (Math.random() - 0.5) * 26, y: ev.y + (Math.random() - 0.5) * 26,
              vx: -ev.facing * (0.6 + Math.random() * 2.4), vy: -0.8 - Math.random() * 1.9,
              life: 20 + Math.random() * 12, color: i % 3 === 0 ? '#fff1f8' : i % 3 === 1 ? '#ffb3d9' : '#ff8fbf',
              size: 2.2 + Math.random() * 2.4, glow: true,
            });
            for (let i = 0; i < 8; i++) arenaParticles.push({
              x: ev.x - ev.facing * (10 + i * 9), y: ev.y + (Math.random() - 0.5) * 8,
              vx: -ev.facing * 1.2, vy: -0.2, life: 12, color: '#ffffff', size: 2, glow: true, trail: true,
            });
          }
          arenaShake = Math.max(arenaShake, 0.22);
          arenaFloaters.push({ x: ev.x, y: ev.y - 26, text: 'ظل الساكورا', color: '#ffb3d9', life: 48, maxLife: 48, size: 13, scale: 1 });
        } else if (ev.type === 'skill_hit') {
          if (ev.hits) sfx('skill_hit');
          if (reduced) continue;
          for (let i = 0; i < 14; i++) arenaParticles.push({
            x: ev.x + (Math.random() - 0.5) * 18, y: ev.y + (Math.random() - 0.5) * 22,
            vx: (Math.random() - 0.5) * 4.4, vy: -1 - Math.random() * 2.6,
            life: 15 + Math.random() * 8, color: i % 2 ? '#ffd7ee' : '#ffffff', size: 2 + Math.random() * 2, glow: true,
          });
          if (ev.hits) arenaShake = Math.max(arenaShake, 0.44);
        } else if (ev.type === 'guard') {
          sfx('guard');
        } else if (ev.type === 'evade') {
          sfx('evade');
        } else if (ev.type === 'dodge') {
          sfx('dodge');
        } else if (ev.type === 'enemy_stagger' || ev.type === 'boss_stun') {
          sfx('stagger');
        } else if (ev.type === 'boss_windup') {
          sfx('boss_windup');
        } else if (ev.type === 'boss_charge') {
          sfx('boss_charge');
        } else if (ev.type === 'boss_enrage') {
          sfx('boss_enrage');
          // المرحلة الثانية من مبارز الساحة: تلميح واحد عند الاهتياج (الحدث يقع مرة واحدة في الجولة).
          // V13: في المسرح الاستعراضي فقط (بلا مبارزة) لا تلميحات — البوت يهيّج الزعيم في الخلفية
          // فلا معنى لإرشاد لاعب غير موجود.
          const plan = !withSound ? null : rules.duelHintPlan?.(ev, { hintVisible: arenaHintVisible(), reminderShown: hintReminderShown });
          if (plan) arenaHint(plan.text, plan.ms, plan.kind);
        } else if (ev.type === 'boss_windup' && ev.attack === 'overhead') {
          sfx('boss_windup');
          // V12.1: أول صدمة كاسرة بعد خفوت التلميح تحصل على تذكير مختصر واحد — لا مع كل ضربة
          const plan = !withSound ? null : rules.duelHintPlan?.(ev, {
            phase: fromSim.enemies?.[0]?.phase, hintVisible: arenaHintVisible(), reminderShown: hintReminderShown,
          });
          if (plan && plan.kind === 'reminder') { hintReminderShown = true; arenaHint(plan.text, plan.ms, plan.kind); }
        } else if (ev.type === 'hurt') {
          sfx('hurt');
          arenaShake = Math.max(arenaShake, 0.7);
          if (!reduced) for (let i = 0; i < 8; i++) arenaParticles.push({
            x: ev.x + 12, y: ev.y + 18, vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 1.4,
            life: 18, color: i % 2 ? '#ff6b6b' : '#ffa94d', size: 2.6, glow: true,
          });
        }
      }
    }
    function arenaTick2() {
      if (!arenaParticles.length && !arenaFloaters.length && arenaShake <= 0) return;
      for (let i = arenaParticles.length - 1; i >= 0; i--) {
        const pt = arenaParticles[i];
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.11; pt.life--;
        if (pt.life <= 0) arenaParticles.splice(i, 1);
      }
      for (let i = arenaFloaters.length - 1; i >= 0; i--) {
        const f = arenaFloaters[i];
        f.y -= 0.5; f.life--;
        if (f.life <= 0) arenaFloaters.splice(i, 1);
      }
      if (arenaParticles.length > 160) arenaParticles.splice(0, arenaParticles.length - 160);
      arenaShake = Math.max(0, arenaShake - 0.05);
    }
    function addComboFloater(player, combo) {
      arenaFloaters.push({ x: player.x + player.w / 2, y: player.y - 6, text: `×${combo}`, color: combo >= 6 ? '#ffd166' : '#ffe9a8', life: 44, maxLife: 44, size: 18, scale: 1 });
    }

    return {
      effects: () => ({ particles: arenaParticles, floaters: arenaFloaters, shake: arenaShake }),
      clearEffects: () => { arenaParticles = []; arenaFloaters = []; arenaShake = 0; },
      collect: collectFx, tick: arenaTick2, resetHint: arenaHintReset,
      showHint: arenaHint, hideHint: arenaHintHide, addComboFloater,
    };
  }

  root.PlatformArenaFx = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
