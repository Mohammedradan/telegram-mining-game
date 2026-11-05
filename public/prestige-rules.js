/* قواعد التبجيل (الدفعة 3ج) — مشتركة بين الخادم والواجهة كما platform-rules.js: مصدر واحد للأرقام فلا يختلف ما يراه اللاعب عمّا يحسبه الخادم.
   التبجيل «خفيف» كما اعتمده المستخدم: كل مستوى يرفع **الدخل السلبي فقط** 10% (حتى 10 مستويات = ×2)، ويكلّف تصفير العمال الآليين
   والمنصّات العملاقة وأسعارهم. الذهب والخامات والمعدات والمناجم والنقرات وترقيات المغامرة والخبرة لا تُمَسّ.
   الدخل السلبي = (عمال + 5 × منصّات) × (10 + مستوى) / 2: أعداد صحيحة ثم قسمة على 2 فالناتج من مضاعفات 0.5 ويُمثَّل بدقة في الفاصلة العائمة
   (لا 82.50000000000001 من ضرب 75 × 1.1). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrestigeRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_LEVEL = 10;
  const BONUS_PER_LEVEL = 10;          // نسبة مئوية من الدخل السلبي لكل مستوى
  const FIRST = Object.freeze({ bots: 15, rigs: 3 });   // ما يلزم للتبجيل الأول
  const STEP = Object.freeze({ bots: 2, rigs: 1 });     // ما يُضاف للمتطلب مع كل مستوى

  const whole = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const levelOf = (v) => Math.min(MAX_LEVEL, whole(v));

  // الدخل السلبي بالذهب/ثانية لهذا العدد من العمال والمنصّات في هذا المستوى
  const passiveFor = (owned, level) => (whole(owned && owned.bot) + 5 * whole(owned && owned.rig)) * (10 + levelOf(level)) / 2;
  // المضاعف المعروض (1 → 2)
  const multiplier = (level) => (100 + BONUS_PER_LEVEL * levelOf(level)) / 100;
  // المتطلب للانتقال من هذا المستوى إلى التالي، أو null عند المستوى الأقصى
  const requirement = (level) => {
    const L = levelOf(level);
    return L >= MAX_LEVEL ? null : { bots: FIRST.bots + STEP.bots * L, rigs: FIRST.rigs + STEP.rigs * L };
  };
  // هل يمكن التبجيل الآن؟ reason: 'max' (بلغ الأقصى) أو 'locked' (ينقصه عمال أو منصّات)
  function check(owned, level) {
    const L = levelOf(level), need = requirement(L);
    const have = { bots: whole(owned && owned.bot), rigs: whole(owned && owned.rig) };
    if (!need) return { ok: false, reason: 'max', level: L, have, need: null };
    const ok = have.bots >= need.bots && have.rigs >= need.rigs;
    return ok ? { ok: true, level: L, have, need } : { ok: false, reason: 'locked', level: L, have, need };
  }
  // ما تخلّى عنه اللاعب بعد هذا العدد من مرات التبجيل (عمال + منصّات): يحفظ تقدّم إنجاز «اشترِ 10 ترقيات» من أن يتراجع عند التصفير
  const spentBy = (level) => { let n = 0; for (let i = 0; i < levelOf(level); i++) { const r = requirement(i); n += r.bots + r.rigs; } return n; };
  // عرض للواجهة: المستوى والمضاعف والمتطلب التالي وتقدّم اللاعب نحوه
  function view(owned, level) {
    const c = check(owned, level);
    return {
      level: c.level, max: MAX_LEVEL, multiplier: multiplier(c.level), bonusPct: BONUS_PER_LEVEL * c.level,
      nextMultiplier: c.level >= MAX_LEVEL ? null : multiplier(c.level + 1), next: c.need, have: c.have, ready: c.ok, maxed: c.reason === 'max',
    };
  }

  return Object.freeze({ MAX_LEVEL, BONUS_PER_LEVEL, FIRST, STEP, levelOf, passiveFor, multiplier, requirement, check, spentBy, view });
});
