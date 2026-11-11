'use strict';

const crypto = require('crypto');
const { replayDeepDig } = require('./lib/deep-dig-replay');
const DeepDig = require('./public/deep-dig');

const VERSION = 1;
const LIFETIME_MS = 30 * 60 * 1000;
const AWARD_ORES = Object.freeze(['copper', 'iron', 'gold', 'crystal', 'lava']);

function configOf(run) {
  try {
    const value = JSON.parse(run?.config_json || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch (_) { return {}; }
}

function mountDeepDig({ app, store, requireAuth, rateLimit, asyncRoute, prepare, profileOf, now = Date.now }) {
  app.post('/api/deep-dig/start', requireAuth, rateLimit('deep-dig-start', 12), asyncRoute(async (req, res) => {
    const result = await store.withUsers([req.player.id], async () => {
      const user = await prepare(req.player);
      let run = await store.activeDeepDigRun(req.player.id);
      if (run && (Number(run.version) !== VERSION || now() - Number(run.started_at) > LIFETIME_MS)) {
        run.status = 'expired';
        run.updated_at = now();
        await store.saveDeepDigRun(run);
        run = null;
      }
      if (!run) {
        const id = crypto.randomUUID();
        const seed = crypto.randomInt(1, 0xffffffff);
        const equipment = DeepDig.normalizeEquipment(user.state.equipment);
        run = {
          id, user_id: req.player.id, version: VERSION, status: 'playing',
          started_at: now(), updated_at: now(),
          config_json: JSON.stringify({ seed, equipment }),
        };
        await store.saveDeepDigRun(run);
      }
      const config = configOf(run);
      return {
        id: run.id, seed: config.seed, equipment: DeepDig.normalizeEquipment(config.equipment),
        startedAt: Number(run.started_at), expiresAt: Number(run.started_at) + LIFETIME_MS,
        profile: profileOf(user, false),
      };
    });
    res.json(result);
  }));

  app.post('/api/deep-dig/finish', requireAuth, rateLimit('deep-dig-finish', 12), asyncRoute(async (req, res) => {
    const result = await store.withUsers([req.player.id], async () => {
      const run = typeof req.body?.id === 'string' ? await store.getDeepDigRun(req.body.id) : null;
      if (!run || run.user_id !== req.player.id) return { status: 404, error: 'جولة الحفر غير موجودة' };
      const user = await prepare(req.player);
      if (run.status === 'finished') {
        const receipt = JSON.parse(run.result_json || '{}');
        return { ...receipt, duplicate: true, profile: profileOf(user, false) };
      }
      if (run.status !== 'playing' || Number(run.version) !== VERSION ||
          now() - Number(run.started_at) > LIFETIME_MS) {
        return { status: 409, error: 'انتهت صلاحية جولة الحفر؛ ابدأ جولة جديدة' };
      }
      const config = configOf(run);
      const replay = replayDeepDig({ frames: req.body?.frames }, config);
      if (!replay.ok || replay.status !== 'done' || !replay.result) {
        // A malformed or mismatched replay is terminal for this ticket; the player can start a fresh run.
        run.status = 'rejected';
        run.updated_at = now();
        await store.saveDeepDigRun(run);
        return { status: 400, error: 'تعذر التحقق من حركات الحفر؛ ابدأ جولة جديدة' };
      }
      if (now() - Number(run.started_at) + 1000 < replay.duration * 1000) {
        return { status: 409, error: 'مدة الجولة لا تطابق الزمن المنقضي؛ أعد المحاولة' };
      }

      const kept = {};
      const wallet = user.state.ores || (user.state.ores = {});
      for (const key of AWARD_ORES) {
        const amount = Math.max(0, Math.floor(Number(replay.result.kept?.[key]) || 0));
        kept[key] = amount;
        if (amount) wallet[key] = Math.max(0, Math.floor(Number(wallet[key]) || 0)) + amount;
      }
      // relic خامة أثرية خاصة بالحفر العميق وليست ضمن سلّم خامات البيع الحالي.
      // نُظهرها في إيصال الجولة ولا نحوّلها إلى ذهب أو خامة أخرى.
      const receipt = {
        id: run.id, ok: true, reason: replay.result.reason,
        depthM: replay.result.depthM, value: replay.result.value,
        kept, relics: Math.max(0, Math.floor(Number(replay.result.kept?.relic) || 0)),
        lost: replay.result.lost, keptCount: replay.result.keptCount,
        profile: null,
      };
      run.status = 'finished';
      run.result_json = JSON.stringify(receipt);
      run.updated_at = now();
      user.revision = (Number(user.revision) || 0) + 1;
      user.updatedAt = now();
      await store.saveDeepDigRun(run);
      await store.appendLedger(user.id, [{
        session: `deep-dig:${run.id}`, seq: 1, kind: 'deep_dig_finish', goldDelta: 0,
        detail: { reason: receipt.reason, depthM: receipt.depthM, ores: kept, relics: receipt.relics },
        at: now(),
      }]);
      await store.putUser(user);
      receipt.profile = profileOf(user, false);
      return receipt;
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }));
}

module.exports = { mountDeepDig, VERSION, LIFETIME_MS, AWARD_ORES, configOf };
