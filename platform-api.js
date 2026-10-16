const crypto = require('node:crypto');
const Rules = require('./public/platform-rules');

// Only virtual gold, never a competitive/financial payout. Deterministic replay
// proves legal physics, not a human player: automation remains possible.
function mountPlatform({ app, store, requireAuth, rateLimit, asyncRoute, prepare, profileOf, grantXp, trackMission, now = Date.now }) {
  const lifetime = 30 * 60 * 1000;
  app.post('/api/platform/start', requireAuth, rateLimit('platform-start', 20), asyncRoute(async (req, res) => {
    const result = await store.withUsers([req.player.id], async () => {
      await prepare(req.player);
      let run = await store.activePlatformRun(req.player.id);
      if (run && now() - Number(run.started_at) > lifetime) {
        run.status = 'expired'; await store.savePlatformRun(run); run = null;
      }
      if (!run) {
        run = { id: crypto.randomUUID(), user_id: req.player.id, version: Rules.VERSION, started_at: now(), status: 'playing' };
        await store.savePlatformRun(run);
      }
      return { id: run.id, version: run.version, startedAt: Number(run.started_at), expiresAt: Number(run.started_at) + lifetime };
    });
    res.json(result);
  }));
  app.post('/api/platform/finish', requireAuth, rateLimit('platform-finish', 20), asyncRoute(async (req, res) => {
    const result = await store.withUsers([req.player.id], async () => {
      const run = typeof req.body?.id === 'string' ? await store.getPlatformRun(req.body.id) : null;
      if (!run || run.user_id !== req.player.id) return { status: 404, error: 'الجولة غير موجودة' };
      const user = await prepare(req.player);
      if (run.status === 'finished') return { ...JSON.parse(run.result_json), duplicate: true, profile: profileOf(user, false, { race: await store.raceTotals(user.id) }) };
      const rules = Rules.forVersion(run.version);
      if (!rules || now() - Number(run.started_at) > lifetime || run.status !== 'playing') return { status: 409, error: 'انتهت صلاحية الجولة؛ ابدأ جولة جديدة' };
      const replay = rules.replay(req.body.inputs);
      if (!replay.ok) return { status: 400, error: 'حركات جولة غير صالحة' };
      const state = replay.state;
      if (state.status === 'playing') return { status: 400, error: 'المستوى لم ينتهِ بعد' };
      const duration = state.tick / rules.FPS;
      if (now() - Number(run.started_at) + 1000 < duration * 1000) return { status: 409, error: 'الجولة أسرع من الزمن الحقيقي؛ أعد المحاولة بعد ثوانٍ' };
      const potential = rules.rewardFor(state);
      const tooSoon = potential > 0 && now() - (Number(user.sync.lastRewardAt.adventure) || 0) < 20000;
      const gold = tooSoon ? 0 : potential;
      if (gold) user.sync.lastRewardAt.adventure = now();
      user.state.gold += gold; user.state.totalEarned += gold;
      const xp = grantXp(user.state, state.status === 'won' ? 20 + state.collected + (state.bossDefeated ? 10 : 0) : 0);
      const a = user.state.adventure;
      if (state.bossDefeated) { a.bossWins++; trackMission(user, 'boss', 1, now()); }
      a.runs++; a.gems += state.collected; a.playSec += Math.floor(duration);
      const score = state.collected * 25 + state.mined * 50 + (state.status === 'won' ? 200 : 0) + (state.defeated || 0) * 75;
      a.bestScore = Math.max(a.bestScore, score); a.rewardEarned += gold;
      a.zones = a.gems >= 75 || a.bossWins >= 1 ? 3 : a.gems >= 25 || a.runs >= 3 ? 2 : 1;
      for (const [key, value] of [['runs', 1], ['gems', state.collected], ['score', score], ['play_time', Math.floor(duration)]]) trackMission(user, key, value, now());
      user.revision++; user.updatedAt = now();
      const receipt = { id: run.id, won: state.status === 'won', gold, xp, score, gems: state.collected, mined: state.mined, defeated: state.defeated || 0, boss: Boolean(state.bossDefeated), duration, ...(tooSoon ? { reason: 'cooldown' } : {}) };
      run.status = 'finished'; run.result_json = JSON.stringify(receipt);
      await store.savePlatformRun(run);
      await store.putUser(user);
      await store.appendLedger(user.id, [{ session: `platform:${run.id}`, seq: 1, kind: 'platform', goldDelta: gold, at: now(), detail: receipt }]);
      return { ...receipt, profile: profileOf(user, false, { race: await store.raceTotals(user.id) }) };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }));
}
module.exports = { mountPlatform };
