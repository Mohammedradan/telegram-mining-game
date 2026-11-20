'use strict';
// تقليم البيانات القديمة (db.js pruneOldData): كانت الجداول تنمو بلا حد — صف لكل جولة ولكل
// عملية ولكل سباق — فتمتلئ قاعدة الطبقة المجانية ويتوقف الحفظ. هذه الاختبارات تثبت أن
// التقليم يحذف القديم المنتهي فقط، ويترك الجولات الحديثة والجارية.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-retention-'));
const file = path.join(dir, 'game.db');
let store = null;
let previous = null;

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

before(() => {
  previous = { url: process.env.DATABASE_URL, file: process.env.DATABASE_FILE };
  process.env.DATABASE_URL = '';
  process.env.DATABASE_FILE = file;
  store = require('../db').createStore();
});

after(async () => {
  await store?.close();
  if (previous.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.url;
  if (previous.file === undefined) delete process.env.DATABASE_FILE; else process.env.DATABASE_FILE = previous.file;
  fs.rmSync(dir, { recursive: true, force: true });
});

const platformRun = (id, status, at) => ({
  id, user_id: 'u1', version: 1, status, started_at: at, updated_at: at,
  result_json: status === 'finished' ? JSON.stringify({ ok: true }) : null,
  config_json: JSON.stringify({ zone: 0, goal: 0, mode: 'mine', loadout: {} }),
});
const deepRun = (id, status, at) => ({
  id, user_id: 'u1', version: 1, status, started_at: at, updated_at: at,
  result_json: null, config_json: JSON.stringify({ seed: 1, equipment: {} }),
});

test('pruneOldData يحذف الجولات المنتهية القديمة ويترك الحديثة والجارية', async () => {
  await store.savePlatformRun(platformRun('old-done', 'finished', now - 40 * DAY));
  await store.savePlatformRun(platformRun('old-playing', 'playing', now - 10 * DAY)); // مهجورة قطعاً (عمر التذكرة 30 دقيقة)
  await store.savePlatformRun(platformRun('new-done', 'finished', now - 1 * DAY));
  await store.savePlatformRun(platformRun('new-playing', 'playing', now - 60 * 1000));
  await store.saveDeepDigRun(deepRun('dig-old', 'finished', now - 40 * DAY));
  await store.saveDeepDigRun(deepRun('dig-new', 'finished', now - 1 * DAY));
  await store.appendLedger('u1', [
    { session: 's1', seq: 1, kind: 'buy', detail: {}, goldDelta: -50, at: now - 120 * DAY },
    { session: 's1', seq: 2, kind: 'buy', detail: {}, goldDelta: -50, at: now - 1 * DAY },
  ]);

  const removed = await store.pruneOldData({ now, runDays: 30, ledgerDays: 90, raceDays: 400 });

  assert.deepEqual(removed, { platformRuns: 2, deepDigRuns: 1, ledger: 1, raceStats: 0 }, JSON.stringify(removed));
  assert.equal(await store.getPlatformRun('old-done'), null, 'الجولة المنتهية القديمة حُذفت');
  assert.equal(await store.getPlatformRun('old-playing'), null, 'الجولة المهجورة حُذفت');
  assert.ok(await store.getPlatformRun('new-done'), 'جولة الأمس باقية');
  assert.ok(await store.getPlatformRun('new-playing'), 'الجولة الجارية باقية');
  assert.equal(await store.getDeepDigRun('dig-old'), null, 'جولة حفر قديمة حُذفت');
  assert.ok(await store.getDeepDigRun('dig-new'), 'جولة حفر حديثة باقية');

  const ledger = await store.ledgerFor('u1');
  assert.equal(ledger.length, 1, 'سجل العمليات القديم فقط حُذف');
  assert.equal(ledger[0].seq, 2, 'الحركة الحديثة باقية');
});

test('قيمة 0 تعطّل التقليم لذلك الجدول (لا حذف صامت)', async () => {
  await store.savePlatformRun(platformRun('keep-old', 'finished', now - 400 * DAY));
  await store.appendLedger('u2', [{ session: 's2', seq: 1, kind: 'buy', detail: {}, goldDelta: 0, at: now - 400 * DAY }]);

  const removed = await store.pruneOldData({ now, runDays: 0, ledgerDays: 0, raceDays: 0 });

  assert.deepEqual(removed, { platformRuns: 0, deepDigRuns: 0, ledger: 0, raceStats: 0 });
  assert.ok(await store.getPlatformRun('keep-old'), 'التقليم معطّل ⇒ لا حذف');
  assert.equal((await store.ledgerFor('u2')).length, 1);
});

test('pruneCutoffs يشتق حدوداً صحيحة ويترك المهجورة خارج أي تعطيل', () => {
  const { pruneCutoffs, ABANDONED_PLAYING_MS } = require('../db');
  const at = 1_000 * DAY;
  const cut = pruneCutoffs({ now: at, runDays: 30, ledgerDays: 90, raceDays: 400 });
  assert.equal(cut.runBefore, at - 30 * DAY);
  assert.equal(cut.ledgerBefore, at - 90 * DAY);
  assert.equal(cut.raceBefore, at - 400 * DAY);
  assert.equal(cut.playingBefore, at - ABANDONED_PLAYING_MS);
  assert.deepEqual(
    pruneCutoffs({ now: at, runDays: 0, ledgerDays: 0, raceDays: 0 }),
    { runBefore: null, ledgerBefore: null, raceBefore: null, playingBefore: at - ABANDONED_PLAYING_MS },
  );
});

test('التقليم التلقائي معطّل افتراضياً ويحافظ على كل السجلات القديمة', async () => {
  const { RETENTION_DEFAULTS, pruneCutoffs } = require('../db');
  assert.deepEqual(RETENTION_DEFAULTS, { runDays: 0, ledgerDays: 0, raceDays: 0 });
  const cut = pruneCutoffs({ now });
  assert.deepEqual(
    { runBefore: cut.runBefore, ledgerBefore: cut.ledgerBefore, raceBefore: cut.raceBefore },
    { runBefore: null, ledgerBefore: null, raceBefore: null },
  );

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(serverSource.includes("envDays('RETENTION_RUN_DAYS', 0)"));
  assert.ok(serverSource.includes("envDays('RETENTION_LEDGER_DAYS', 0)"));
  assert.ok(serverSource.includes("envDays('RETENTION_RACE_DAYS', 0)"));

  const old = now - 500 * DAY;
  await store.savePlatformRun(platformRun('default-old-platform', 'finished', old));
  await store.savePlatformRun(platformRun('default-old-playing', 'playing', old));
  await store.saveDeepDigRun(deepRun('default-old-deep-dig', 'finished', old));
  await store.appendLedger('default-retention-user', [
    { session: 'default-retention-session', seq: 1, kind: 'buy', detail: {}, goldDelta: -1, at: old },
  ]);

  const removed = await store.pruneOldData();
  assert.deepEqual(removed, { platformRuns: 0, deepDigRuns: 0, ledger: 0, raceStats: 0 });
  assert.ok(await store.getPlatformRun('default-old-platform'));
  assert.ok(await store.getPlatformRun('default-old-playing'));
  assert.ok(await store.getDeepDigRun('default-old-deep-dig'));
  assert.equal((await store.ledgerFor('default-retention-user')).length, 1);
});
