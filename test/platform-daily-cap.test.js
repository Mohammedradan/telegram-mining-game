'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dailyQuota, DAILY_GOLD_CAP } = require('../platform-api');

const at = day => Date.UTC(2026, 9, day, 12, 0, 0); // أكتوبر 2026، منتصف اليوم بتوقيت UTC

test('daily cap: أول جولة في اليوم تمنح كامل المكافأة وتفتح عدّاد اليوم', () => {
  const adv = { platformGold: 0, platformDay: '2026-10-18' };
  const q = dailyQuota(adv, 100, at(19));
  assert.equal(q.gold, 100);
  assert.equal(q.capped, false);
  assert.equal(q.remaining, DAILY_GOLD_CAP - 100);
  assert.equal(adv.platformDay, '2026-10-19');
  assert.equal(adv.platformGold, 0); // التراكم يحدث في مسار finish بعد القبول
});

test('daily cap: الجولات المتتالية في اليوم نفسه تتراكم ولا تتجاوز 10,000', () => {
  const adv = { platformGold: 0, platformDay: '2026-10-19' };
  let granted = 0;
  for (let i = 0; i < 120; i++) {
    const q = dailyQuota(adv, 100, at(19));
    assert.ok(q.gold >= 0 && q.gold <= 100);
    granted += q.gold;
    adv.platformGold += q.gold;
  }
  assert.equal(granted, DAILY_GOLD_CAP);
  assert.equal(adv.platformGold, DAILY_GOLD_CAP);
  assert.equal(dailyQuota(adv, 100, at(19)).gold, 0);
  assert.equal(dailyQuota(adv, 100, at(19)).capped, true);
});

test('daily cap: يمنح المتبقي فقط عند اقتراب السقف', () => {
  const adv = { platformGold: 9_950, platformDay: '2026-10-19' };
  const q = dailyQuota(adv, 100, at(19));
  assert.equal(q.gold, 50);
  assert.equal(q.capped, true);
  assert.equal(q.remaining, 0);
});

test('daily cap: يوم UTC جديد يعيد ضبط العدّاد', () => {
  const adv = { platformGold: DAILY_GOLD_CAP, platformDay: '2026-10-19' };
  const q = dailyQuota(adv, 100, at(20));
  assert.equal(q.gold, 100);
  assert.equal(q.capped, false);
  assert.equal(adv.platformDay, '2026-10-20');
  assert.equal(adv.platformGold, 0);
});

test('daily cap: مكافأة صفرية أو سالبة لا تفتح عدّاد اليوم ولا تمنح ذهباً', () => {
  const adv = { platformGold: DAILY_GOLD_CAP, platformDay: '2026-10-19' };
  assert.equal(dailyQuota(adv, 0, at(19)).gold, 0);
  assert.equal(dailyQuota(adv, -50, at(19)).gold, 0);
  assert.equal(adv.platformGold, DAILY_GOLD_CAP);
});
