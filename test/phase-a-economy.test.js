// المرحلة A (V19.2) — اقتصاد الجولة: الفوز يجب أن يتفوّق على أي خسارة متعمّدة أو ترك للجولة.
//
// الثغرة المقيسة قبل الإصلاح (بنفس المحرك، بمحاكاة رأسية بلا متصفح): جولة فاشلة عمرها 12.2 ثانية
// بثلاثة معالم دفعت 36 ذهباً = 2.95 ذهب/ثانية، مقابل 0.65 ذهب/ثانية لجولة ناجحة كاملة (98/150).
// أي أن الاستراتيجية المثلى كانت «اجمع معلمين ثم مُت».
//
// هذا الملف يثبت، بالحساب لا بالرأي:
//   1) الخسارة السريعة تدفع صفراً الآن (لا ذهب معالم، لا إنقاذ).
//   2) الإنقاذ موجود لكنه محصور: نقطة حفظ + 90 ثانية لعب + سقف 10 ذهب، ولا يُدفع لجولة لم تنته.
//   3) لا توجد أي تركيبة (منجم، بلورات، صخور، معالم، حالة) تجعل الخسارة تتفوّق على الفوز — فحص شامل.
//   4) الفوز ينمو مع العمق وبسقف معلن، والمبارزة لم تُمسّ.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/platform-rules');

const FPS = R.FPS;
const SERVER_GAP_SEC = 20;   // الفاصل الأدنى بين مكافأتين على الخادم (platform-api.js)
const ROUND_SEC = R.MAX_TICKS / FPS; // 150 ثانية: أطول جولة ممكنة
const GOAL_GEMS = 3, GOAL_ROCKS = 1; // شرط فتح البوابة (canExit)

// صيغة ما قبل V19.2، منقولة حرفياً للمقارنة فقط (ليست مستخدمة في اللعبة).
function legacyTotal(s) {
  const potential = Math.min(100, 40 + (s.collected || 0) * 4 + (s.mined || 0) * 6);
  const milestoneGold = Math.min(potential, (s.milestones?.length || 0) * R.MILESTONE_GOLD);
  const finalGold = s.status === 'won' ? Math.max(0, potential - milestoneGold) : 0;
  return milestoneGold + finalGold;
}
function state(over = {}) {
  const s = R.create('miner', 2024, { zone: 0, goal: 0, mode: 'mine', loadout: {} });
  Object.assign(s, { collected: 0, mined: 0, milestones: [], checkpoint: 64, tick: 0, status: 'lost' }, over);
  return s;
}
const withMilestones = n => R.MILESTONES.slice(0, n).map(m => m.id);

test('economy: the exact pre-fix exploit is worth nothing now (12-second run, three milestones, lost)', () => {
  const exploit = state({ collected: 3, mined: 1, milestones: withMilestones(3), tick: Math.round(12.2 * FPS), status: 'lost' });
  assert.equal(legacyTotal(exploit), 36, 'the old formula paid 36 for that run — this is the bug we measured');
  const now = R.rewardBreakdown(exploit);
  assert.equal(now.total, 0, 'V19.2: no gold at all for a short deliberate loss');
  assert.equal(now.milestoneGold, 0);
  assert.equal(now.finalGold, 0);
  assert.equal(now.salvage, 0);
  assert.equal(R.rewardFor(exploit), 0);
});

test('economy: salvage is gated three ways and stays far below any win', () => {
  const base = { collected: 10, mined: 3, milestones: withMilestones(5), checkpoint: 920 };
  assert.equal(R.rewardBreakdown(state({ ...base, tick: 30 * FPS, status: 'lost' })).total, 0,
    'a long-enough checkpoint run that ends early still pays nothing (under 90 seconds)');
  assert.equal(R.rewardBreakdown(state({ ...base, checkpoint: 64, tick: 120 * FPS, status: 'lost' })).total, 0,
    'a 120-second run that never passed a checkpoint pays nothing');
  assert.equal(R.rewardBreakdown(state({ ...base, tick: 120 * FPS, status: 'playing' })).total, 0,
    'an abandoned (still playing) run pays nothing at all');
  const honest = R.rewardBreakdown(state({ ...base, tick: 120 * FPS, status: 'lost' }));
  assert.equal(honest.total, R.RUN_REWARD.salvageCap, 'the honest-attempt salvage is exactly its cap');
  assert.ok(honest.total <= 10, 'and the cap is ten gold');
  assert.equal(honest.milestoneGold, 0, 'milestones are still never paid on a loss');
});

test('economy: exhaustive check — no reachable loss beats any reachable win (gold, and gold per second)', () => {
  let bestLoss = { gold: 0, rate: 0 }, worstWin = { gold: Infinity, rate: Infinity };
  const zones = [0, 1, 2, 3, 4, 5];
  for (const zone of zones) {
    // الفوز ممكن فقط عند تحقّق هدف البوابة: 3 بلورات وصخرة واحدة على الأقل
    for (let gems = GOAL_GEMS; gems <= 10; gems++) for (let rocks = GOAL_ROCKS; rocks <= 3; rocks++) {
      for (let ms = 2; ms <= 5; ms++) { // معلمان مضمونان: أول صخرة + ثلاث بلورات
        const won = state({ zone, collected: gems, mined: rocks, milestones: withMilestones(ms), tick: R.MAX_TICKS, status: 'won' });
        const gold = R.rewardFor(won);
        const rate = gold / ROUND_SEC; // أبطأ فوز ممكن = 150 ثانية
        if (gold < worstWin.gold) worstWin = { gold, rate, zone, gems, rocks, ms };
      }
    }
    // الخسارة: كل ما يمكن أن يصل إليه لاعب في جولة فاشلة، بما فيه أقصى إنقاذ
    for (let gems = 0; gems <= 10; gems++) for (let rocks = 0; rocks <= 3; rocks++) {
      for (let ms = 0; ms <= 5; ms++) for (const tick of [0, 12 * FPS, 60 * FPS, 90 * FPS, 150 * FPS]) {
        for (const checkpoint of [64, 920]) {
          const lost = state({ zone, collected: gems, mined: rocks, milestones: withMilestones(ms), tick, checkpoint, status: 'lost' });
          const gold = R.rewardFor(lost);
          const seconds = Math.max(tick / FPS, SERVER_GAP_SEC); // الخادم يفرض 20 ثانية بين مكافأتين
          const rate = gold / seconds;
          if (rate > bestLoss.rate || gold > bestLoss.gold) bestLoss = { gold: Math.max(gold, bestLoss.gold), rate: Math.max(rate, bestLoss.rate), zone, gems, rocks, ms, tick };
        }
      }
    }
  }
  assert.equal(bestLoss.gold, R.RUN_REWARD.salvageCap, `the best possible loss is the salvage cap (${bestLoss.gold})`);
  assert.ok(worstWin.gold > bestLoss.gold * 3, `the worst win (${worstWin.gold}) dwarfs the best loss (${bestLoss.gold})`);
  assert.ok(worstWin.rate > bestLoss.rate * 3, `and per second: worst win ${worstWin.rate.toFixed(3)} vs best loss ${bestLoss.rate.toFixed(3)}`);
  // حدّ أدنى مطلق لا يعتمد على المسح: 78 ذهباً في 150 ثانية مقابل 10 في 90 ثانية
  assert.ok((58 + R.RUN_REWARD.completionBase) / ROUND_SEC > R.RUN_REWARD.salvageCap / R.RUN_REWARD.salvageMinSeconds * 4,
    'even the theoretical floor of a win is several times the ceiling of a loss');
});

test('economy: a win pays the content cap plus a completion bonus that grows with depth, under a declared cap', () => {
  const best = zone => state({ zone, collected: 10, mined: 3, milestones: withMilestones(5), tick: R.MAX_TICKS, status: 'won' });
  const bonuses = [0, 1, 2, 3, 4, 5].map(zone => R.completionBonus(zone));
  assert.deepEqual(bonuses, [20, 30, 40, 50, 60, 70], 'the deeper the mine, the bigger the completion bonus');
  for (const zone of [0, 1, 2, 3, 4, 5]) {
    const s = best(zone);
    const b = R.rewardBreakdown(s);
    // أقصى محتوى ممكن في جولة = 10 بلورات و3 صخور = 98 (لا يبلغ السقف الاسمي 100)
    assert.equal(b.total, 98 + R.completionBonus(zone), 'a perfect run pays the full content value + bonus');
    assert.ok(R.rewardFor(s) <= R.rewardCap(zone), 'and never above the declared cap (100 + bonus)');
    assert.equal(b.milestoneGold + b.finalGold + b.salvage, b.total, 'the receipt fields still add up');
    assert.ok(b.milestoneGold <= 5 * R.MILESTONE_GOLD, 'milestones are a fixed loot line, not a multiplier');
  }
  const poorWin = state({ zone: 0, collected: GOAL_GEMS, mined: GOAL_ROCKS, milestones: withMilestones(2), tick: R.MAX_TICKS, status: 'won' });
  assert.equal(R.rewardFor(poorWin), 40 + GOAL_GEMS * 4 + GOAL_ROCKS * 6 + R.completionBonus(0), 'a bare win still pays the bonus');
  assert.ok(R.rewardFor(poorWin) >= 78, 'and the floor for any win is 78 gold in mine 1');
});

test('economy: the duel path is untouched by the mining fix', () => {
  for (const zone of [0, 1, 2, 3, 4, 5]) {
    const won = R.create('miner', 5, { zone, mode: 'duel', loadout: {} }); won.status = 'won';
    const lost = R.create('miner', 5, { zone, mode: 'duel', loadout: {} }); lost.status = 'lost';
    assert.equal(R.rewardFor(won), R.duelReward(zone), `duel ${zone}: a win pays duelReward`);
    assert.equal(R.rewardFor(lost), 0, `duel ${zone}: a loss pays nothing`);
    const b = R.rewardBreakdown(won);
    assert.equal(b.salvage, 0); assert.equal(b.bonus, 0); assert.equal(b.milestoneGold, 0);
  }
});

test('economy: milestones keep their value and their meaning — loot sealed at the gate, not deleted', () => {
  const s = state({ zone: 1, collected: 6, mined: 2, milestones: withMilestones(3), tick: 60 * FPS, status: 'won' });
  const b = R.rewardBreakdown(s);
  assert.equal(b.milestoneGold, 3 * R.MILESTONE_GOLD, 'every earned milestone is still shown and still paid on a win');
  assert.equal(b.potential, Math.min(100, 40 + 6 * 4 + 2 * 6), 'the content formula itself did not move');
  assert.equal(R.MILESTONE_GOLD, 12, 'and the per-milestone value did not move either');
  // المعالم لا تفتح ذهباً إضافياً فوق سقف المحتوى: مجموعها يبقى داخل السقف + علاوة الإتمام
  const perfect = state({ zone: 0, collected: 10, mined: 3, milestones: withMilestones(5), tick: R.MAX_TICKS, status: 'won' });
  assert.equal(R.rewardFor(perfect), 98 + R.completionBonus(0), 'five milestones cannot push a win past the content value');
  assert.ok(R.rewardFor(perfect) <= R.rewardCap(0), 'and never past the declared cap');
});

test('economy: ore is loot too — a fast loss or an abandoned run puts nothing in the bag', () => {
  const rich = { collected: 10, mined: 3, milestones: withMilestones(5), ores: { copper: 40, iron: 20, gold: 10, crystal: 6, lava: 4 } };
  const fastLoss = state({ ...rich, tick: 12 * FPS, status: 'lost' });
  assert.deepEqual(R.oreAward(fastLoss), { copper: 0, iron: 0, gold: 0, crystal: 0, lava: 0 },
    'a 12-second loss banks no ore at all (selling it was a 124-gold back door)');
  const abandoned = state({ ...rich, tick: 120 * FPS, status: 'playing' });
  assert.equal(Object.values(R.oreAward(abandoned)).reduce((a, b) => a + b, 0), 0, 'an abandoned run banks nothing');
  const honest = state({ ...rich, tick: 120 * FPS, checkpoint: 920, status: 'lost' });
  assert.deepEqual(R.oreAward(honest), { copper: 20, iron: 10, gold: 5, crystal: 3, lava: 2 },
    'an honest attempt keeps exactly half its bag — the mining-game convention');
  const won = state({ ...rich, tick: R.MAX_TICKS, status: 'won' });
  assert.deepEqual(R.oreAward(won), R.oreSummary(won), 'a win keeps everything');
  // القيمة السوقية للغنيمة لا تقلب الترتيب: أفضل خسارة تبقى تحت أسوأ فوز
  const prices = { copper: 2, iron: 4, gold: 8, crystal: 12, lava: 20 };
  const value = o => Object.entries(o).reduce((a, [k, v]) => a + v * prices[k], 0);
  const bestLossValue = value(R.oreAward(state({ ...rich, tick: 90 * FPS, checkpoint: 920, status: 'lost' }))) + R.RUN_REWARD.salvageCap;
  const worstWin = state({ zone: 0, collected: GOAL_GEMS, mined: GOAL_ROCKS, milestones: withMilestones(2), tick: R.MAX_TICKS, status: 'won' });
  assert.ok(R.rewardFor(worstWin) > bestLossValue / 4, 'even measured in sellable value, a win stays far ahead');
});

test('economy: every payout the server would pay is a whole, non-negative number', () => {
  for (const zone of [0, 1, 2, 3, 4, 5]) for (const status of ['won', 'lost', 'playing']) {
    for (const tick of [0, 7, 90 * FPS, R.MAX_TICKS]) {
      for (const gems of [0, 3, 10]) for (const rocks of [0, 1, 3]) for (let ms = 0; ms <= 5; ms++) {
        const s = state({ zone, status, tick, collected: gems, mined: rocks, milestones: withMilestones(ms), checkpoint: 920 });
        const total = R.rewardFor(s);
        assert.ok(Number.isInteger(total) && total >= 0, `integer gold for ${status}/${tick}/${gems}/${rocks}/${ms} (${total})`);
      }
    }
  }
});
