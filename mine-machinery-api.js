const crypto = require('node:crypto');
const Rules = require('./public/platform-rules');

const JOB_LIFETIME_MS = 8 * 60 * 60 * 1000;
const PRODUCTION_INTERVAL_MS = 60 * 1000;
const DAILY_ORE_CAP = 120;
const MAX_CLAIM_MINUTES = 60;

function dayKey(at) { return new Date(at).toISOString().slice(0, 10); }

function view(job, at) {
  if (!job) return { active: false, dailyCap: DAILY_ORE_CAP };
  return {
    active: job.status === 'active',
    id: job.id,
    zone: job.zone,
    ore: job.ore,
    startedAt: job.startedAt,
    expiresAt: job.startedAt + JOB_LIFETIME_MS,
    nextOreInSeconds: job.status === 'active'
      ? Math.max(0, Math.ceil((PRODUCTION_INTERVAL_MS - (at - job.lastClaimAt)) / 1000))
      : 0,
    dailyCap: DAILY_ORE_CAP,
  };
}

function mountMineMachinery({ app, store, requireAuth, rateLimit, asyncRoute, prepare, now = Date.now }) {
  app.get('/api/mine-machinery/status', requireAuth, rateLimit('mine-machinery-status', 60), asyncRoute(async (req, res) => {
    const result = await store.withUsers([req.player.id], async () => {
      const user = await prepare(req.player);
      const job = user.sync.mineMachinery || null;
      return { job: view(job, now()), daily: { day: dayKey(now()), produced: user.sync.mineMachineryDay === dayKey(now()) ? Number(user.sync.mineMachineryProduced) || 0 : 0, cap: DAILY_ORE_CAP } };
    });
    res.json(result);
  }));

  app.post('/api/mine-machinery/start', requireAuth, rateLimit('mine-machinery-start', 10), asyncRoute(async (req, res) => {
    const zone = req.body?.zone;
    if (!Number.isInteger(zone) || zone < 0 || zone >= Rules.MINES.length) return res.status(400).json({ error: 'منجم غير معروف' });
    const result = await store.withUsers([req.player.id], async () => {
      const user = await prepare(req.player);
      const loadout = Rules.normalizeLoadout(user.state.equipment);
      const unlocked = Rules.mineStatus(zone, user.state.mines, loadout);
      if (!unlocked.unlocked) return { status: 403, error: 'المنجم غير مفتوح بعد' };
      const current = user.sync.mineMachinery;
      if (current?.status === 'active' && now() - current.startedAt < JOB_LIFETIME_MS) return { status: 409, error: 'هناك وردية تعدين نشطة بالفعل', job: view(current, now()) };
      const mine = Rules.MINES[zone];
      const job = { id: crypto.randomUUID(), status: 'active', zone, ore: mine.tier.common, startedAt: now(), lastClaimAt: now(), claimSeq: 0 };
      user.sync.mineMachinery = job;
      user.revision++; user.updatedAt = now();
      await store.putUser(user);
      return { job: view(job, now()) };
    });
    if (result.status) return res.status(result.status).json(result);
    res.json(result);
  }));

  app.post('/api/mine-machinery/claim', requireAuth, rateLimit('mine-machinery-claim', 30), asyncRoute(async (req, res) => {
    const result = await store.withUsers([req.player.id], async () => {
      const user = await prepare(req.player);
      const job = user.sync.mineMachinery;
      const at = now();
      if (!job || job.status !== 'active') return { status: 409, error: 'لا توجد وردية تعدين نشطة' };
      if (at - job.startedAt >= JOB_LIFETIME_MS) {
        job.status = 'expired';
        user.revision++; user.updatedAt = at;
        await store.putUser(user);
        return { status: 409, error: 'انتهت الوردية؛ ابدأ وردية جديدة', job: view(job, at) };
      }
      const elapsedMinutes = Math.min(MAX_CLAIM_MINUTES, Math.floor((at - job.lastClaimAt) / PRODUCTION_INTERVAL_MS));
      if (elapsedMinutes < 1) return { status: 409, error: 'لم يكتمل وقت إنتاج خام جديد', waitSeconds: Math.max(1, Math.ceil((PRODUCTION_INTERVAL_MS - (at - job.lastClaimAt)) / 1000)), job: view(job, at) };
      const day = dayKey(at);
      if (user.sync.mineMachineryDay !== day) {
        user.sync.mineMachineryDay = day;
        user.sync.mineMachineryProduced = 0;
      }
      const used = Math.max(0, Math.floor(Number(user.sync.mineMachineryProduced) || 0));
      const amount = Math.min(elapsedMinutes, DAILY_ORE_CAP - used);
      // استهلاك كل الدقائق المكتملة يمنع تخزين إنتاج غير محدود بعد بلوغ السقف اليومي.
      job.lastClaimAt += elapsedMinutes * PRODUCTION_INTERVAL_MS;
      let wallet = user.state.ores || (user.state.ores = {});
      if (amount > 0) {
        wallet[job.ore] = Math.max(0, Number(wallet[job.ore]) || 0) + amount;
        user.sync.mineMachineryProduced = used + amount;
        job.claimSeq = (Number(job.claimSeq) || 0) + 1;
        await store.appendLedger(user.id, [{
          session: `mine-machinery:${job.id}`, seq: job.claimSeq, kind: 'mine_machinery_production',
          goldDelta: 0, at, detail: { zone: job.zone, ore: job.ore, amount, minutes: elapsedMinutes, dailyProduced: used + amount },
        }]);
      }
      user.revision++; user.updatedAt = at;
      await store.putUser(user);
      return { produced: amount, ore: job.ore, daily: { day, produced: used + amount, cap: DAILY_ORE_CAP }, job: view(job, at) };
    });
    if (result.status) return res.status(result.status).json(result);
    res.json(result);
  }));

  app.post('/api/mine-machinery/stop', requireAuth, rateLimit('mine-machinery-stop', 10), asyncRoute(async (req, res) => {
    const result = await store.withUsers([req.player.id], async () => {
      const user = await prepare(req.player);
      const job = user.sync.mineMachinery;
      if (!job || job.status !== 'active') return { status: 409, error: 'لا توجد وردية نشطة' };
      job.status = 'stopped';
      job.stoppedAt = now();
      user.revision++; user.updatedAt = now();
      await store.putUser(user);
      return { job: view(job, now()), message: 'تم إيقاف الوردية' };
    });
    if (result.status) return res.status(result.status).json(result);
    res.json(result);
  }));
}

module.exports = { mountMineMachinery, DAILY_ORE_CAP, JOB_LIFETIME_MS, PRODUCTION_INTERVAL_MS };
