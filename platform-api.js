const crypto = require('node:crypto');
const Rules = require('./public/platform-rules');
// أسعار صرف الخامات ثابتة خادمياً، مشتقة من نفس ملف القواعد المشترك مع العميل.
const ORE_PRICES = Object.freeze(Object.fromEntries(Object.entries(Rules.ORES).map(([k, v]) => [k, v.price])));

// سقف يومي صريح للذهب المكتسب من المنصات (بتوقيت UTC) فوق سقف الجولة والمهلة،
// حتى لا يتحول التشغيل الآلي لجولات صحيحة إلى مزرعة ذهب لا نهائية.
const DAILY_GOLD_CAP = 10_000;
// العدّاد في دفتر المزامنة الخادمي (user.sync) لا في state.adventure:
// ensureSync يطبّع الحالة كل جولة، فحقول adventure غير المعروفة تُسقَط.
function dailyQuota(sync, potential, at = Date.now()) {
  const day = new Date(at).toISOString().slice(0, 10);
  if (sync.platformDay !== day) { sync.platformDay = day; sync.platformGold = 0; }
  const used = Math.max(0, Number(sync.platformGold) || 0);
  const allowed = Math.max(0, Math.min(Number(potential) || 0, DAILY_GOLD_CAP - used));
  return { day, gold: allowed, capped: allowed < potential, remaining: Math.max(0, DAILY_GOLD_CAP - used - allowed) };
}

// سقف يومي مستقل للمبارزات (منفصل تماماً عن سقف التعدين أعلاه): القتال مهارة لا مزرعة.
// 400 ذهباً/يوم ≈ خمس مبارزات ناجحة في أعمق منجم — كافٍ للتشجيع، وصغير جداً أمام اقتصاد التعدين.
const DAILY_DUEL_CAP = 400;
function duelQuota(sync, potential, at = Date.now()) {
  const day = new Date(at).toISOString().slice(0, 10);
  if (sync.duelDay !== day) { sync.duelDay = day; sync.duelGold = 0; }
  const used = Math.max(0, Number(sync.duelGold) || 0);
  const allowed = Math.max(0, Math.min(Number(potential) || 0, DAILY_DUEL_CAP - used));
  return { day, gold: allowed, capped: allowed < potential, remaining: Math.max(0, DAILY_DUEL_CAP - used - allowed), cap: DAILY_DUEL_CAP };
}
// عرض فقط (لا يعدّل الدفتر): كم استُهلك من سقف اليوم المشترك بين جولات المنصّات والوضع الكلاسيكي وبيع الخامات.
// عدّاد يوم قديم لا يُحتسب (يُصفَّر عند أول دفع في اليوم الجديد داخل dailyQuota).
function dailyGoldView(sync, at = Date.now()) {
  const day = new Date(at).toISOString().slice(0, 10);
  const used = sync && sync.platformDay === day ? Math.min(DAILY_GOLD_CAP, Math.max(0, Math.floor(Number(sync.platformGold) || 0))) : 0;
  return { day, used, cap: DAILY_GOLD_CAP, remaining: DAILY_GOLD_CAP - used };
}

// لقطة إعداد الجولة المخزّنة (المنجم + مستويات المعدات). جولات ما قبل المرحلة 3 بلا لقطة = الإعداد الافتراضي.
function configOfRun(run) {
  let raw = null;
  try { raw = run?.config_json ? JSON.parse(run.config_json) : null; } catch { raw = null; }
  return Rules.normalizeConfig(raw);
}
const sameLoadout = (a, b) => Rules.EQUIPMENT_ORDER.every((id) => (a[id] || 0) === (b[id] || 0));
// حالة تقدّم المناجم الموثوقة داخل حالة اللاعب (يطبّعها sanitizeState، وهذا حارس إضافي لحالات قديمة)
function mineProgress(user) {
  const mines = user.state.mines && typeof user.state.mines === 'object' ? user.state.mines : (user.state.mines = {});
  mines.wins = Rules.normalizeProgress(mines).wins;
  return mines;
}

// Only virtual gold, never a competitive/financial payout. Deterministic replay
// proves legal physics, not a human player: automation remains possible.
function mountPlatform({ app, store, requireAuth, rateLimit, asyncRoute, prepare, profileOf, grantXp, trackMission, trackQuests = () => {}, now = Date.now }) {
  const lifetime = 30 * 60 * 1000;
  // body اختياري: { zone?: 0..5, resume?: true }.
  //  - المنجم يُتحقَّق من فتحه خادمياً، والمعدات تُقرأ من حالة اللاعب الخادمية لا من العميل، وتُثبَّت لقطتها في الجولة.
  //  - resume:true (استعادة بعد إعادة تحميل الصفحة) يُرجع الجولة النشطة كما هي بلقطتها الأصلية.
  //  - جولة نشطة بمنجم آخر أو معدات تغيّرت منذ بدايتها تُستبدل بجولة جديدة (الشراء لا يغيّر جولة جارية أبداً).
  app.post('/api/platform/start', requireAuth, rateLimit('platform-start', 20), asyncRoute(async (req, res) => {
    const wanted = req.body?.zone;
    if (wanted !== undefined && !(Number.isInteger(wanted) && wanted >= 0 && wanted < Rules.MINES.length)) {
      return res.status(400).json({ error: 'منجم غير معروف' });
    }
    // V6: الهدف يُختار قبل الجولة ويُثبَّت في التذكرة مثل المنجم والمعدات (لا يمكن تبديله بعد البدء).
    const wantedGoal = req.body?.goal;
    if (wantedGoal !== undefined && !(Number.isInteger(wantedGoal) && wantedGoal >= 0 && wantedGoal < Rules.GOALS.length)) {
      return res.status(400).json({ error: 'هدف جولة غير معروف' });
    }
    // V7: وضع الجولة — منجم تعدين (mine) أو مبارزة قتال حيّة (duel). يُثبَّت في التذكرة مثل المنجم.
    const wantedMode = req.body?.mode;
    if (wantedMode !== undefined && !Rules.MODES.includes(wantedMode)) {
      return res.status(400).json({ error: 'وضع جولة غير معروف' });
    }
    const resume = req.body?.resume === true;
    const result = await store.withUsers([req.player.id], async () => {
      const user = await prepare(req.player);
      const loadout = Rules.normalizeLoadout(user.state.equipment);
      // جولة واحدة مفتوحة لكل وضع: مبارزة الساحة لا تُلغي جولة المنجم الجارية والعكس.
      const mode = wantedMode || 'mine';
      const openRuns = store.activePlatformRuns ? await store.activePlatformRuns(req.player.id) : [await store.activePlatformRun(req.player.id)].filter(Boolean);
      let run = openRuns.find((r) => (configOfRun(r)?.mode || 'mine') === mode) || null;
      if (run && (now() - Number(run.started_at) > lifetime || Number(run.version) !== Rules.VERSION)) {
        run.status = 'expired'; await store.savePlatformRun(run); run = null;
      }
      const current = run ? configOfRun(run) : null;
      const zone = wanted ?? current?.zone ?? 0;
      const goal = wantedGoal ?? current?.goal ?? 0;
      const stale = Boolean(run) && !resume && (zone !== current.zone || goal !== current.goal || mode !== current.mode || !sameLoadout(current.loadout, loadout));
      if (!run || stale) {
        // الفتح يُتحقَّق منه قبل أي استبدال: طلب منجم مقفل لا يُسقط جولة نشطة سليمة
        const status = Rules.mineStatus(zone, user.state.mines, loadout);
        if (!status.unlocked) {
          return { status: 403, error: `المنجم مقفل: ${status.needs.filter((n) => !n.ok).map((n) => n.label).join('، ')}`, needs: status.needs };
        }
        if (run) { run.status = 'expired'; await store.savePlatformRun(run); }
        run = { id: crypto.randomUUID(), user_id: req.player.id, version: Rules.VERSION, started_at: now(), status: 'playing', config_json: JSON.stringify({ zone, goal, mode, loadout }) };
        await store.savePlatformRun(run);
      }
      return { id: run.id, version: run.version, seed: Rules.seedFromId(run.id), config: configOfRun(run), startedAt: Number(run.started_at), expiresAt: Number(run.started_at) + lifetime };
    });
    if (result.error) return res.status(result.status).json({ error: result.error, ...(result.needs ? { needs: result.needs } : {}) });
    res.json(result);
  }));
  app.post('/api/platform/finish', requireAuth, rateLimit('platform-finish', 20), asyncRoute(async (req, res) => {
    const result = await store.withUsers([req.player.id], async () => {
      const run = typeof req.body?.id === 'string' ? await store.getPlatformRun(req.body.id) : null;
      if (!run || run.user_id !== req.player.id) return { status: 404, error: 'الجولة غير موجودة' };
      const user = await prepare(req.player);
      if (run.status === 'finished') return { ...JSON.parse(run.result_json), duplicate: true, profile: profileOf(user, false, { race: await store.raceTotals(user.id) }) };
      if (run.version !== Rules.VERSION || now() - Number(run.started_at) > lifetime || run.status !== 'playing') return { status: 409, error: 'انتهت صلاحية الجولة؛ ابدأ جولة جديدة' };
      // البذرة من معرّف الجولة المخزّن على الخادم فقط — مسار جولة أخرى لا يطابق هذا التخطيط
      // والمنجم/المعدات من لقطة الجولة المخزّنة عند البدء، فلا يمكن ادّعاء معدات أقوى ولا تبديل المنجم بعد الإنهاء
      const config = configOfRun(run);
      const replay = Rules.replay(req.body.inputs, req.body?.hero, Rules.seedFromId(run.id), config);
      if (!replay.ok) return { status: 400, error: 'حركات جولة غير صالحة' };
      const state = replay.state;
      if (state.status === 'playing') return { status: 400, error: 'المستوى لم ينتهِ بعد' };
      const duration = state.tick / Rules.FPS;
      if (now() - Number(run.started_at) + 1000 < duration * 1000) return { status: 409, error: 'الجولة أسرع من الزمن الحقيقي؛ أعد المحاولة بعد ثوانٍ' };
      const ores = Rules.oreSummary(state);      // ما جُمع في الجولة (للتدقيق والعرض)
      const awarded = Rules.oreAward(state);     // ما يدخل المخزن فعلاً (V19.2: لا غنيمة بلا إتمام أو محاولة صادقة)
      const breakdown = Rules.rewardBreakdown(state);
      const potential = breakdown.total; // نفس سقف الـ100: المعالم تفتح أجزاءً منه، والفوز يدفع الباقي
      const tooSoon = potential > 0 && now() - (Number(user.sync.lastRewardAt.adventure) || 0) < 20000;
      const a = user.state.adventure;
      // مكافآت المبارزة تُسحب من سقفها المستقل، ومكافآت التعدين من سقفه اليومي — لا يزاحم أحدهما الآخر.
      const duelMode = config.mode === 'duel';
      const quota = duelMode ? duelQuota(user.sync, tooSoon ? 0 : potential, now()) : dailyQuota(user.sync, tooSoon ? 0 : potential, now());
      const gold = tooSoon ? 0 : quota.gold;
      if (gold) {
        if (duelMode) user.sync.duelGold = (Number(user.sync.duelGold) || 0) + gold;
        else user.sync.platformGold = (Number(user.sync.platformGold) || 0) + gold;
        user.sync.lastRewardAt.adventure = now();
      }
      user.state.gold += gold; user.state.totalEarned += gold;
      // الخامات تُمنح من نتيجة إعادة التشغيل فقط — لا يُقبل أي رصيد خامات من العميل.
      const wallet = user.state.ores || (user.state.ores = {});
      for (const [k, v] of Object.entries(awarded)) wallet[k] = Math.max(0, (Number(wallet[k]) || 0) + v);
      const duelWon = config.mode === 'duel' && state.status === 'won';
      const xp = grantXp(user.state, state.status === 'won' ? 20 + state.collected : 0);
      const mines = mineProgress(user);
      // المبارزة ليست فوزاً في المنجم: لا تُفتح بها مناجم ولا تُحتسب في تقدّمها.
      if (state.status === 'won' && config.mode !== 'duel') mines.wins[config.zone] = Math.min(1_000_000, mines.wins[config.zone] + 1);
      // سجل الساحة الخادمي يتحرك من مبارزة أعاد الخادم تشغيلها فقط (لا من نتيجة يعلنها العميل).
      const arenaRec = user.sync.arena?.record;
      if (config.mode === 'duel' && arenaRec) {
        const key = state.status === 'won' ? 'wins' : state.status === 'lost' ? 'losses' : 'draws';
        arenaRec[key] = Math.min(1_000_000, (Number(arenaRec[key]) || 0) + 1);
        if (duelWon) trackMission(user, 'arena', 1, now());
      }
      a.runs++; a.gems += state.collected; a.playSec += Math.floor(duration);
      if (state.defeated) a.defeated = (a.defeated || 0) + state.defeated;
      // سقوط زعيم المنجم أعاد المحرك تشغيله بنفس المسار؛ يُحتسب حتى لو خسر اللاعب بعده في طريق الخروج. هذا ما يُحيي إنجاز «قاتل الزعماء».
      const bossKill = state.bossDefeated === true;
      if (bossKill) { a.bossWins = (Number(a.bossWins) || 0) + 1; trackMission(user, 'boss', 1, now()); }
      const score = state.collected * 25 + state.mined * 50 + (state.status === 'won' ? 200 : 0);
      a.bestScore = Math.max(a.bestScore, score); a.rewardEarned += gold;
      a.zones = a.gems >= 75 || a.bossWins >= 1 ? 3 : a.gems >= 25 || a.runs >= 3 ? 2 : 1;
      for (const [key, value] of [['runs', 1], ['gems', state.collected], ['score', score], ['play_time', Math.floor(duration)]]) trackMission(user, key, value, now());
      // مهام المغامرة: عدّادات من هذه الجولة المُعاد تشغيلها فقط (صخور، أعداء، خامات، سقوط زعيم بمفتاحه)
      trackQuests(user, { mined: state.mined, defeated: state.defeated, ores, boss: bossKill ? (Rules.levelFor(config.zone)?.boss?.kind || null) : null });
      user.revision++; user.updatedAt = now();
      // V6: نتيجة الهدف وقرار المخاطرة تُقرأ من إعادة التشغيل نفسها (لا من العميل) وتُعرض في شاشة الختام.
      const goal = config.mode === 'duel' ? Rules.duelStatus(state) : Rules.goalStatus(state);
      const choice = state.choice || state.fork?.choice || null;
      const receipt = { id: run.id, won: state.status === 'won', mode: config.mode, zone: config.zone, mineWins: mines.wins[config.zone], gold, xp, score, gems: state.collected, mined: state.mined, duration, boss: bossKill,
        ...(config.mode === 'duel' ? { duel: { rivalHp: goal.rivalHp, rivalMaxHp: goal.rivalMaxHp, hearts: goal.hearts, blocks: goal.blocks }, arena: { ...arenaRec } } : {}),
        goal: { id: goal.id, name: goal.name, done: goal.done, now: goal.now, target: goal.target },
        choice, veinBroken: state.veinBroken === true, oreWind: state.oreWind === true,
        ores: awarded, oresGathered: ores, milestones: state.milestones || [], milestoneGold: breakdown.milestoneGold, finalGold: breakdown.finalGold, salvage: breakdown.salvage,
        dailyRemaining: quota.remaining, ...(duelMode ? { duelCap: quota.cap } : {}), ...(tooSoon ? { reason: 'cooldown' } : quota.capped ? { reason: 'daily_cap' } : {}) };
      run.status = 'finished'; run.result_json = JSON.stringify(receipt);
      await store.savePlatformRun(run);
      // سجل تدقيق دائم داخل معاملة اللاعب نفسها؛ (user, session, seq) فريد فلا يتكرر القيد
      await store.appendLedger(user.id, [{ session: `platform:${run.id}`, seq: 1, kind: 'platform_finish', goldDelta: gold,
        detail: { won: receipt.won, zone: config.zone, goal: receipt.goal, choice, loadout: config.loadout, gems: receipt.gems, mined: receipt.mined, defeated: state.defeated || 0, boss: bossKill, ticks: state.tick, hero: state.player.hero,
          dailyRemaining: quota.remaining, ores: awarded, oresGathered: ores, milestones: state.milestones || [], salvage: breakdown.salvage,
          milestoneGold: breakdown.milestoneGold, finalGold: breakdown.finalGold,
          ...(tooSoon ? { reason: 'cooldown' } : quota.capped ? { reason: 'daily_cap' } : {}) }, at: now() }]);
      await store.putUser(user);
      await store.appendLedger(user.id, [{ session: `platform:${run.id}`, seq: 1, kind: 'platform', goldDelta: gold, at: now(), detail: receipt }]);
      return { ...receipt, profile: profileOf(user, false, { race: await store.raceTotals(user.id) }) };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }));
}
module.exports = { mountPlatform, dailyQuota, dailyGoldView, DAILY_GOLD_CAP, DAILY_DUEL_CAP, duelQuota, ORE_PRICES, configOfRun };
