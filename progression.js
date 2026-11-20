'use strict';

function createProgression({ Quests, Prestige, dayStr, currentWeekKey, levelFromXp, grantXp }) {
  // ---------------------------------------------------------------------------
  const MISSION_POOL = [
    { key: 'mine_energy', icon: '⚡', title: 'أنفق {n} طاقة في التعدين', target: 600, gold: 150, xp: 40, mode: 'sum' },
    { key: 'mine_gold', icon: '⛏️', title: 'عدّن {n} ذهب بالنقر', target: 800, gold: 150, xp: 40, mode: 'sum' },
    { key: 'runs', icon: '🎮', title: 'أكمل {n} جولات مغامرة', target: 3, gold: 200, xp: 50, mode: 'sum' },
    { key: 'gems', icon: '💎', title: 'التقط {n} جوهرة في المغامرة', target: 60, gold: 200, xp: 50, mode: 'sum' },
    { key: 'score', icon: '🏅', title: 'حقق {n} نقطة في جولة واحدة', target: 400, gold: 250, xp: 60, mode: 'max' },
    { key: 'boss', icon: '👹', title: 'اهزم زعيماً (الكلاسيكي أو منجم الزعيم)', target: 1, gold: 300, xp: 80, mode: 'sum' },
    { key: 'boost', icon: '🚀', title: 'فعّل التعزيز {n} مرات', target: 2, gold: 100, xp: 30, mode: 'sum' },
    { key: 'buy', icon: '🛒', title: 'اشترِ {n} ترقيات', target: 2, gold: 150, xp: 40, mode: 'sum' },
    { key: 'play_time', icon: '⏱️', title: 'العب {n} ثانية في المغامرة', target: 180, gold: 200, xp: 50, mode: 'sum' },
    { key: 'survival', icon: '💀', title: 'حقق {n} نقطة في وضع البقاء الكلاسيكي', target: 250, gold: 250, xp: 60, mode: 'max' },
    { key: 'arena', icon: '⚔️', title: 'افُز بـ{n} مباريات في الساحة', target: 2, gold: 100, xp: 30, mode: 'sum' },
  ];
  const MISSION_BY_KEY = Object.fromEntries(MISSION_POOL.map((m) => [m.key, m]));
  // كل مهام المجموعتين قابلة للإنجاز من اللعب الظاهر: «اهزم زعيم المنجم» تغذّيها جولات المنصّات (زعيما منجمي الذهب والقلب) ووضع الزعيم
  // الكلاسيكي، و«نقاط في وضع البقاء» يغذّيها وضع البقاء الكلاسيكي. كانت المهمتان مستبعدتين من السحب ما دام الوضع الكلاسيكي مخفياً
  // (كانتا تظهران مستحيلتين في ~49% من الأيام وتضيع معهما مكافأة «أنجز الثلاث»)، وعادتا إليه حين ظهر في خريطة المناجم (الدفعة 3أ′).
  const MISSIONS_PER_DAY = 3;
  const MISSION_BONUS = { gold: 300, xp: 100 };

  function hash32(str) {
    let h = 2166136261;
    for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  // اختيار حتمي لمهام اليوم: نفس اللاعب ونفس اليوم ⇒ نفس المهام على أي خادم/جهاز
  function pickMissions(userId, day) {
    let seed = hash32(`${userId}:${day}`) || 1;
    const next = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    const pool = MISSION_POOL.map((_, i) => i);
    const chosen = [];
    while (chosen.length < MISSIONS_PER_DAY && pool.length) chosen.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
    return chosen.map((i) => ({ key: MISSION_POOL[i].key, progress: 0, claimed: false }));
  }
  function ensureMissions(user, now) {
    const day = dayStr(new Date(now));
    const m = user.sync.missions;
    const valid = m && m.day === day && Array.isArray(m.items) && m.items.every((it) => it && MISSION_BY_KEY[it.key]);
    if (!valid) user.sync.missions = { day, items: pickMissions(user.id, day), bonusClaimed: false };
    return user.sync.missions;
  }
  function trackMissionList(items, byKey, key, value) {
    const def = byKey[key];
    if (!def || value <= 0) return;
    for (const item of items) {
      if (item.key !== key || item.claimed) continue;
      item.progress = def.mode === 'max' ? Math.max(item.progress || 0, value) : Math.min(def.target, (item.progress || 0) + value);
    }
  }
  function trackMission(user, key, amount, now) {
    const value = Math.max(0, Number(amount) || 0);
    if (value <= 0) return;
    trackMissionList(ensureMissions(user, now).items, MISSION_BY_KEY, key, value);
    trackMissionList(ensureWeeklyMissions(user, now).items, WEEKLY_MISSION_BY_KEY, key, value);
  }
  function missionsView(user, now) {
    const m = ensureMissions(user, now);
    const items = m.items.map((item) => {
      const def = MISSION_BY_KEY[item.key];
      const progress = Math.min(def.target, Math.floor(item.progress || 0));
      return { key: def.key, icon: def.icon, title: def.title.replace('{n}', String(def.target)), target: def.target, progress, done: progress >= def.target, claimed: Boolean(item.claimed), gold: def.gold, xp: def.xp };
    });
    const d = new Date(now);
    const resetsIn = Math.max(0, Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000));
    const allClaimed = items.length > 0 && items.every((i) => i.claimed);
    return { day: m.day, resetsIn, items, bonus: { ...MISSION_BONUS, ready: allClaimed && !m.bonusClaimed, claimed: Boolean(m.bonusClaimed) } };
  }
  // استلام مكافأة مهمة (أو مكافأة إكمال اليوم) — داخل applyOps
  function claimMission(user, key, now) {
    const s = user.state; const m = ensureMissions(user, now);
    if (key === 'bonus') {
      if (m.bonusClaimed) return { status: 'rejected', reason: 'claimed' };
      if (!m.items.every((i) => i.claimed)) return { status: 'rejected', reason: 'incomplete' };
      m.bonusClaimed = true;
      s.gold += MISSION_BONUS.gold; s.totalEarned += MISSION_BONUS.gold;
      return { status: 'ok', key, gold: MISSION_BONUS.gold, xp: grantXp(s, MISSION_BONUS.xp), day: m.day };
    }
    const def = MISSION_BY_KEY[key]; const item = m.items.find((i) => i.key === key);
    if (!def || !item) return { status: 'invalid' };
    if (item.claimed) return { status: 'rejected', reason: 'claimed' };
    if ((item.progress || 0) < def.target) return { status: 'rejected', reason: 'incomplete', progress: Math.floor(item.progress || 0), target: def.target };
    item.claimed = true;
    user.sync.missionsClaimed = (Number(user.sync.missionsClaimed) || 0) + 1; // يغذّي إنجاز «مثابر»
    s.gold += def.gold; s.totalEarned += def.gold;
    return { status: 'ok', key, gold: def.gold, xp: grantXp(s, def.xp), day: m.day };
  }

  // ---------------------------------------------------------------------------
  // المهام الأسبوعية — يولّدها الخادم لكل لاعب/أسبوع ISO (UTC) من مجموعة ثابتة بنفس نمط
  // المهام اليومية، ويتقدّم عدّادها من العمليات الموثوقة نفسها، والاستلام عبر weekly_mission في الدفتر.
  // ---------------------------------------------------------------------------
  const WEEKLY_MISSION_POOL = [
    { key: 'mine_energy', icon: '⚡', title: 'أنفق {n} طاقة في التعدين هذا الأسبوع', target: 3000, gold: 500, xp: 120, mode: 'sum' },
    { key: 'mine_gold', icon: '⛏️', title: 'عدّن {n} ذهب بالنقر هذا الأسبوع', target: 4000, gold: 500, xp: 120, mode: 'sum' },
    { key: 'runs', icon: '🎮', title: 'أكمل {n} جولات مغامرة هذا الأسبوع', target: 15, gold: 600, xp: 150, mode: 'sum' },
    { key: 'gems', icon: '💎', title: 'التقط {n} جوهرة في المغامرة هذا الأسبوع', target: 300, gold: 600, xp: 150, mode: 'sum' },
    { key: 'score', icon: '🏅', title: 'حقق {n} نقطة في جولة واحدة هذا الأسبوع', target: 650, gold: 700, xp: 180, mode: 'max' },
    { key: 'boss', icon: '👹', title: 'اهزم زعيماً {n} مرات هذا الأسبوع (الكلاسيكي أو منجم الزعيم)', target: 3, gold: 900, xp: 220, mode: 'sum' },
    { key: 'boost', icon: '🚀', title: 'فعّل التعزيز {n} مرات هذا الأسبوع', target: 8, gold: 400, xp: 100, mode: 'sum' },
    { key: 'buy', icon: '🛒', title: 'اشترِ {n} ترقيات هذا الأسبوع', target: 6, gold: 500, xp: 120, mode: 'sum' },
    { key: 'play_time', icon: '⏱️', title: 'العب {n} ثانية في المغامرة هذا الأسبوع', target: 900, gold: 600, xp: 150, mode: 'sum' },
    { key: 'survival', icon: '💀', title: 'حقق {n} نقطة في وضع البقاء الكلاسيكي هذا الأسبوع', target: 400, gold: 700, xp: 180, mode: 'max' },
    { key: 'arena', icon: '⚔️', title: 'افُز بـ{n} مباريات في الساحة هذا الأسبوع', target: 8, gold: 500, xp: 120, mode: 'sum' },
  ];
  const WEEKLY_MISSION_BY_KEY = Object.fromEntries(WEEKLY_MISSION_POOL.map((m) => [m.key, m]));
  const WEEKLY_MISSIONS_PER_WEEK = 3;
  const WEEKLY_MISSION_BONUS = { gold: 1000, xp: 300 };

  function pickWeeklyMissions(userId, week) {
    let seed = hash32(`weekly:${userId}:${week}`) || 1;
    const next = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    const pool = WEEKLY_MISSION_POOL.map((_, i) => i);
    const chosen = [];
    while (chosen.length < WEEKLY_MISSIONS_PER_WEEK && pool.length) chosen.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
    return chosen.map((i) => ({ key: WEEKLY_MISSION_POOL[i].key, progress: 0, claimed: false }));
  }
  function ensureWeeklyMissions(user, now) {
    const week = currentWeekKey(new Date(now));
    const w = user.sync.weeklyMissions;
    const valid = w && w.week === week && Array.isArray(w.items) && w.items.length > 0 && w.items.every((it) => it && WEEKLY_MISSION_BY_KEY[it.key]);
    if (!valid) user.sync.weeklyMissions = { week, items: pickWeeklyMissions(user.id, week), bonusClaimed: false };
    return user.sync.weeklyMissions;
  }
  function weeklyMissionsView(user, now) {
    const w = ensureWeeklyMissions(user, now);
    const items = w.items.map((item) => {
      const def = WEEKLY_MISSION_BY_KEY[item.key];
      const progress = Math.min(def.target, Math.floor(item.progress || 0));
      return { key: def.key, icon: def.icon, title: def.title.replace('{n}', String(def.target)), target: def.target, progress, done: progress >= def.target, claimed: Boolean(item.claimed), gold: def.gold, xp: def.xp };
    });
    const d = new Date(now);
    const daysUntilMonday = 8 - (d.getUTCDay() || 7);
    const resetsIn = Math.max(0, Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilMonday) - now) / 1000));
    const allClaimed = items.length > 0 && items.every((i) => i.claimed);
    return { week: w.week, resetsIn, items, bonus: { ...WEEKLY_MISSION_BONUS, ready: allClaimed && !w.bonusClaimed, claimed: Boolean(w.bonusClaimed) } };
  }
  function claimWeeklyMission(user, key, now) {
    const s = user.state; const w = ensureWeeklyMissions(user, now);
    if (key === 'bonus') {
      if (w.bonusClaimed) return { status: 'rejected', reason: 'claimed' };
      if (!w.items.every((i) => i.claimed)) return { status: 'rejected', reason: 'incomplete' };
      w.bonusClaimed = true;
      s.gold += WEEKLY_MISSION_BONUS.gold; s.totalEarned += WEEKLY_MISSION_BONUS.gold;
      return { status: 'ok', key, gold: WEEKLY_MISSION_BONUS.gold, xp: grantXp(s, WEEKLY_MISSION_BONUS.xp), week: w.week };
    }
    const def = WEEKLY_MISSION_BY_KEY[key]; const item = w.items.find((i) => i.key === key);
    if (!def || !item) return { status: 'invalid' };
    if (item.claimed) return { status: 'rejected', reason: 'claimed' };
    if ((item.progress || 0) < def.target) return { status: 'rejected', reason: 'incomplete', progress: Math.floor(item.progress || 0), target: def.target };
    item.claimed = true;
    user.sync.weeklyClaimed = (Number(user.sync.weeklyClaimed) || 0) + 1;
    s.gold += def.gold; s.totalEarned += def.gold;
    return { status: 'ok', key, gold: def.gold, xp: grantXp(s, def.xp), week: w.week };
  }

  // ---------------------------------------------------------------------------
  // الإنجازات — تُحتسب من بيانات لا يملكها إلا الخادم (إحصاءات جولات تحقق منها، سباقات مختومة،
  // خبرة، مهام مستلمة، سلسلة يومية، دعوات، مشتريات). المعرّفات الثمانية الأولى مطابقة لواجهة اللعبة القديمة.
  // ---------------------------------------------------------------------------
  const advOf = (u) => (u.state.adventure && typeof u.state.adventure === 'object') ? u.state.adventure : {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const ACHIEVEMENTS = [
    // V19.3 (R3): العدّاد `runs` يحصي المحاولات المنتهية (فوزاً أو خسارة)، فالاسم والوصف صارا يطابقانه.
    // المكافأة (25 ذهباً) بقيت كما هي: ترحيب أوّلي، لا تتطلب فوزاً.
    { id: 'first_run', icon: '🎬', name: 'أول محاولة', desc: 'أنهِ محاولة واحدة في المنجم', target: 1, gold: 25, xp: 10, value: (u) => num(advOf(u).runs) },
    { id: 'score500', icon: '💎', name: 'نتيجة 500', desc: 'حقق أفضل نتيجة 500+', target: 500, gold: 75, xp: 20, value: (u) => num(advOf(u).bestScore) },
    { id: 'combo20', icon: '🔥', name: 'سلسلة 20', desc: 'حقق أعلى سلسلة ×20', target: 20, gold: 75, xp: 20, value: (u) => num(advOf(u).maxCombo) },
    { id: 'collector', icon: '🧲', name: 'جامع الكنوز', desc: 'التقط 300 جوهرة إجمالاً', target: 300, gold: 100, xp: 30, value: (u) => num(advOf(u).gems) },
    { id: 'survivor', icon: '💀', name: 'الناجي', desc: 'حقق 300 نقطة في وضع البقاء', target: 300, gold: 100, xp: 30, value: (u) => num(advOf(u).bestSurvival) },
    { id: 'boss', icon: '👹', name: 'قاتل الزعماء', desc: 'اهزم زعيم المنجم مرة واحدة', target: 1, gold: 100, xp: 30, value: (u) => num(advOf(u).bossWins) },
    { id: 'racer', icon: '⚔️', name: 'بطل السباقات', desc: 'افُز بسباق مباشر واحد', target: 1, gold: 50, xp: 20, value: (u, ctx) => num(ctx.raceWins) },
    { id: 'earner', icon: '🪙', name: 'صانع الذهب', desc: 'اكسب 500 ذهب من المغامرات', target: 500, gold: 100, xp: 30, value: (u) => num(advOf(u).rewardEarned) },
    { id: 'upgrades10', icon: '🛠️', name: 'مهندس المنجم', desc: 'اشترِ 10 ترقيات إجمالاً', target: 10, gold: 150, xp: 40, value: (u) => Object.values(u.state.owned || {}).reduce((a, v) => a + num(v), 0) + Object.values(u.state.adventureUpgrades || {}).reduce((a, v) => a + num(v), 0) + Prestige.spentBy(u.state.prestige) },
    { id: 'missions10', icon: '📅', name: 'مثابر', desc: 'استلم 10 مهام يومية', target: 10, gold: 200, xp: 50, value: (u) => num(u.sync.missionsClaimed) },
    { id: 'streak7', icon: '🗓️', name: 'أسبوع كامل', desc: 'سلسلة مكافأة يومية 7 أيام', target: 7, gold: 300, xp: 60, value: (u) => num(u.dailyStreak) },
    { id: 'inviter', icon: '👥', name: 'صاحب الدعوة', desc: 'ادعُ صديقاً واحداً', target: 1, gold: 100, xp: 30, value: (u) => num(u.referralCount) },
    { id: 'level5', icon: '⭐', name: 'معدّن متمرس', desc: 'ابلغ المستوى 5', target: 5, gold: 150, xp: 0, value: (u) => levelFromXp(u.state.xp) },
    { id: 'level10', icon: '🌟', name: 'معدّن أسطوري', desc: 'ابلغ المستوى 10', target: 10, gold: 400, xp: 0, value: (u) => levelFromXp(u.state.xp) },
    { id: 'tycoon', icon: '🏦', name: 'قطب الذهب', desc: 'اكسب 50,000 ذهب إجمالاً', target: 50_000, gold: 500, xp: 100, value: (u) => num(u.state.totalEarned) },
  ];
  const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
  function claimedAchievements(user) {
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (!isObj(user.sync.achievements)) user.sync.achievements = {};
    const rec = user.sync.achievements;
    if (!isObj(rec.claimed)) rec.claimed = {};
    return rec.claimed;
  }
  function achievementsView(user, ctx = {}) {
    const claimed = claimedAchievements(user);
    const items = ACHIEVEMENTS.map((a) => {
      const value = Math.min(a.target, Math.floor(a.value(user, ctx)));
      return { id: a.id, icon: a.icon, name: a.name, desc: a.desc, target: a.target, value, done: value >= a.target, claimed: Boolean(claimed[a.id]), gold: a.gold, xp: a.xp };
    });
    return { items, claimedCount: items.filter((i) => i.claimed).length, total: items.length };
  }
  // مهام المغامرة (quests.js): العدّادات في user.sync.quests تغذّيها جولات المنصّات المُعاد تشغيلها فقط، والانتصارات من state.mines.wins
  const questsView = (user) => Quests.view(user.sync.quests, user.state.mines?.wins);
  function claimQuest(user, id, now) {
    const r = Quests.claim(user.sync.quests, user.state.mines?.wins, id, now);
    if (r.status !== 'ok') return r;
    const s = user.state;
    s.gold += r.gold; s.totalEarned += r.gold;
    return { ...r, xp: grantXp(s, r.xp) };
  }
  function claimAchievement(user, id, ctx, now) {
    const a = ACHIEVEMENT_BY_ID[id];
    if (!a) return { status: 'invalid' };
    const claimed = claimedAchievements(user);
    if (claimed[a.id]) return { status: 'rejected', reason: 'claimed' };
    const value = Math.floor(a.value(user, ctx));
    if (value < a.target) return { status: 'rejected', reason: 'locked', value: Math.min(a.target, value), target: a.target };
    claimed[a.id] = now;
    const s = user.state;
    s.gold += a.gold; s.totalEarned += a.gold;
    return { status: 'ok', id: a.id, gold: a.gold, xp: a.xp ? grantXp(s, a.xp) : 0 };
  }

  // ---------------------------------------------------------------------------
  // ⚔️ الساحة: تذكرة مباراة (رقم، بذرة، مستوى الخصم) يصدرها الخادم، والعميل يعيد الحركات فقط

    return {
      trackMission, missionsView, weeklyMissionsView, achievementsView, questsView,
      claimMission, claimWeeklyMission, claimQuest, claimAchievement,
    };
}

module.exports = { createProgression };
