// شاشة الاستعداد (المرحلة B): اختبار النموذج النقي — أرقام من القواعد فقط، بلا DOM وبلا رسم.
// الغرض: تثبيت أن كل رقم معروض للاعب قبل المبارزة مشتق من `platform-rules.js` ومن سجله،
// وأن النموذج حتمي (نفس المدخل ⇒ نفس المخرج) ولا يقرأ عشوائية ولا شبكة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/platform-rules');
const Ready = require('../public/platform-arena-ready');

const ROOT = path.join(__dirname, '..');
const base = (extra = {}) => Ready.build({ rules: R, heroId: 'miner', zone: 0, heroLevel: 1, equipment: {}, mines: {}, record: {}, ...extra });
const hpFor = (zone) => R.DUEL.rival.hp + R.DUEL.rival.hpPerZone * zone;

test('المرحلة B: كل رقم في شاشة الاستعداد مشتق من القواعد نفسها لا مكتوب يدوياً', () => {
  for (const zone of [0, 1, 2, 3]) {
    const m = base({ zone });
    assert.equal(m.rival.hp, hpFor(zone), `صحة الخصم في الساحة ${zone} تأتي من DUEL.rival`);
    assert.equal(m.rival.reward, R.duelReward(zone), `مكافأة الساحة ${zone} تأتي من duelReward`);
    assert.equal(m.hero.skillCd, Math.round((R.combatAdvice('miner', {}).arena.skillCd / 60) * 10) / 10, 'مهلة المهارة من combatAdvice');
    assert.equal(m.hero.hearts, R.combatAdvice('miner', {}).arena.hearts, 'القلوب من combatAdvice (معدات اللاعب)');
  }
});

test('المرحلة B: مستوى الخصم = رقم الساحة + 1 (كان يظهر «مستوى undefined» قبل الإصلاح)', () => {
  for (const zone of [0, 1, 2, 3]) {
    const m = base({ zone });
    assert.equal(m.rival.level, zone + 1, `مستوى الخصم في ${zone}`);
    assert.equal(m.rail.find((r) => r.zone === zone).selected, true, 'الساحة المختارة محددة في القرص');
  }
});

test('المرحلة B: قرص الساحات يعرض كل الساحات المفتوحة، والمقفلة تمنع البدء', () => {
  const m = base({ mines: {}, equipment: {} });
  const zones = R.ARENA_TIER_ZONES || [0, 1, 2, 3];
  assert.equal(m.rail.length, zones.length, 'قرص واحد لكل ساحة متاحة');
  assert.equal(m.rail.filter((r) => r.selected).length, 1, 'ساحة واحدة مختارة فقط');
  for (const r of m.rail) {
    assert.equal(r.locked, !R.mineStatus(r.zone, {}, {}).unlocked, `حالة قفل الساحة ${r.zone} من mineStatus`);
    assert.equal(r.short, r.name.split(' ').slice(0, 2).join(' '), 'الاسم المختصر = أول كلمتين (يُقرأ في القرص بلا قصّ)');
  }
  const locked = m.rail.find((r) => r.locked);
  if (locked) {
    const m2 = base({ zone: locked.zone });
    assert.equal(m2.cta.disabled, true, 'ساحة مقفلة ⇒ زر البدء معطّل');
    assert.equal(m2.cta.label, 'مبارز مقفل');
  } else {
    assert.equal(m.cta.disabled, false, 'ساحة مفتوحة ⇒ زر البدء فعّال');
    assert.equal(m.cta.label, 'ابدأ المبارزة');
  }
});

test('المرحلة B: السجل (فوز/خسارة/نسبة/أعلى مكافأة) يُحسب من سجل اللاعب فقط', () => {
  const empty = base();
  assert.equal(empty.record.total, 0);
  assert.equal(empty.record.winRate, null, 'بلا مباريات ⇒ لا نسبة مضلّلة');
  const played = base({ record: { wins: 3, losses: 1, draws: 0 } });
  assert.equal(played.record.total, 4);
  assert.equal(played.record.winRate, 0.75);
  const zones = R.ARENA_TIER_ZONES || [0, 1, 2, 3];
  assert.equal(played.record.best, Math.max(...zones.map((z) => R.duelReward(z))), 'أعلى مكافأة متاحة من الساحات المتاحة');
});

test('المرحلة B: المؤشرات للعرض فقط — التوازن محصور ولا يمسّ أي حساب قتالي', () => {
  const m = base();
  assert.ok(m.balance >= 0.05 && m.balance <= 0.95, 'التوازن محصور بين 5% و95%');
  assert.equal(m.rival.power, Ready.rivalPower(m.rival.hp), 'قوة الخصم دالة عرض صريحة');
  assert.equal(m.hero.power, Ready.heroPower(m.hero), 'قوة البطل دالة عرض صريحة');
  assert.ok(Ready.rivalPower(999) > Ready.rivalPower(1), 'الرسم رتيب مع الصحة');
});

test('المرحلة B: النموذج حتمي وبلا شبكة وبلا عشوائية', () => {
  const a = base({ zone: 1 });
  const b = base({ zone: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), 'نفس المدخل ⇒ نفس المخرج');
  const src = fs.readFileSync(path.join(ROOT, 'public', 'platform-arena-ready.js'), 'utf8');
  assert.doesNotMatch(src, /Math\.random|Date\.now|fetch\(|XMLHttpRequest/, 'لا عشوائية ولا شبكة في نموذج العرض');
});

test('المرحلة B: ساحة غير معروفة تعود إلى أول ساحة متاحة بدل قيمة فارغة', () => {
  const zones = R.ARENA_TIER_ZONES || [0, 1, 2, 3];
  const m = base({ zone: 99 });
  assert.equal(m.zone, zones[0], 'الساحة الاحتياطية = أول ساحة متاحة');
  assert.equal(m.arena.name, m.rail[0].name, 'الاسم يطابق القرص');
});
