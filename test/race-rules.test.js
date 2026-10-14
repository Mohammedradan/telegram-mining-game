// قواعد السباق (دوال نقية): سقف الزمن، سقف التقدّم، المهلة، الانسحاب، حسم الفائز.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { raceRulesFromEnv, raceCap, raceDeadline, forfeitAllowed, decideWinner } = require('../race-rules');

const rules = raceRulesFromEnv({});
const T0 = 1_000_000;

test('defaults: 60 s classic race, 8 s grace, forfeit after 3 s; env overrides are clamped to sane bounds', () => {
  assert.deepEqual([rules.durationSec, rules.graceSec, rules.forfeitAfterSec, rules.scoreRate, rules.scoreBase, rules.scoreBurst], [60, 8, 3, 45, 100, 400]);
  const fast = raceRulesFromEnv({ RACE_DURATION_SEC: '2', RACE_GRACE_SEC: '1' });
  assert.deepEqual([fast.durationSec, fast.graceSec, fast.forfeitAfterSec], [2, 1, 1]);
  const silly = raceRulesFromEnv({ RACE_DURATION_SEC: '99999', RACE_GRACE_SEC: '0' });
  assert.deepEqual([silly.durationSec, silly.graceSec], [300, 1]);
  assert.equal(raceDeadline(rules, T0), T0 + 68_000);
});

test('time cap: a finish right at the start is worth at most 100, the cap grows 45/s and stops growing at the race duration', () => {
  assert.deepEqual(raceCap(rules, { startAt: T0, last: null }, 9_999, T0), { score: 100, flagged: true, timeCap: 100, streamCap: Infinity });
  assert.equal(raceCap(rules, { startAt: T0, last: null }, 9_999, T0 + 10_000).score, 550);
  assert.equal(raceCap(rules, { startAt: T0, last: null }, 9_999, T0 + 60_000).score, 2_800);
  assert.equal(raceCap(rules, { startAt: T0, last: null }, 9_999, T0 + 67_000).score, 2_800, 'the grace period adds time to report, not points');
  assert.deepEqual(raceCap(rules, { startAt: T0, last: null }, 90, T0 + 500).score, 90, 'an honest early score passes untouched');
  assert.equal(raceCap(rules, { startAt: T0, last: null }, -5, T0 + 500).score, 0);
  assert.equal(raceCap(rules, { startAt: T0, last: null }, 'Infinity', T0 + 500).score, 0);
});

test('stream cap: the final score cannot jump above the last progress the player reported (+45/s +400 burst)', () => {
  // 30 ثانية من اللعب بتقدّم صادق عند 500 قبل ثانية — ثم «إنهاء» بـ 2800 (سقف الزمن 1450) ⇒ 500 + 45 + 400 = 945
  const last = { score: 500, at: T0 + 29_000 };
  const r = raceCap(rules, { startAt: T0, last }, 2_800, T0 + 30_000);
  assert.deepEqual([r.score, r.flagged, r.timeCap, r.streamCap], [945, true, 1_450, 945]);
  // قفزة شرعية كبيرة (جوهرة ذهبية ×6 + مهمة = 350) بين بلاغين متقاربين تمرّ
  assert.equal(raceCap(rules, { startAt: T0, last: { score: 500, at: T0 + 29_900 } }, 850, T0 + 30_000).score, 850);
  // انخفاض النقاط (قنبلة) مقبول دائماً
  assert.equal(raceCap(rules, { startAt: T0, last: { score: 500, at: T0 + 29_900 } }, 485, T0 + 30_000).score, 485);
});

test('forfeit window and winner decision', () => {
  assert.equal(forfeitAllowed(rules, T0, T0 + 2_999), false);
  assert.equal(forfeitAllowed(rules, T0, T0 + 3_000), true);
  assert.equal(forfeitAllowed(rules, Infinity, T0 + 3_000), false, 'a room that never started cannot be forfeited');
  const a = { id: 'a', score: 900 }; const b = { id: 'b', score: 100 };
  assert.equal(decideWinner([a, b]), 'a');
  assert.equal(decideWinner([b, a]), 'a');
  assert.equal(decideWinner([a, { id: 'b', score: 900 }]), null, 'tie ⇒ no winner');
  assert.equal(decideWinner([a, b], 'a'), 'b', 'the leaver loses even when ahead');
  assert.equal(decideWinner([a], null), null);
});
