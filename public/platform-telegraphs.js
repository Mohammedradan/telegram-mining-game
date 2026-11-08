/* B5 — علامات أرضية للإنذارات: موضع هبوط الخفاش ومسار هجوم الزعيم.
   عرض فقط، بلا أي أثر على المحرك: يقرأ حالة الأعداء العامة (batState/batTimer/x) التي يراها اللاعب،
   ويُنتج علامات تُرسم **تحت** الشخصيات (قبلها في ترتيب الرسم) فلا تحجب لاعباً ولا عدواً ولا توقيت هجوم.

   قواعد التباين (مقيسة، لا مُقدَّرة): كل علامة تحمل نغمتين — قلب أبيض وحافة سوداء — لأن
   max(تباين الأبيض, تباين الأسود) ≥ 4.5:1 على **أي** خلفية ممكنة (انظر contrastGuarantee أدناه).
   الأبيض يغلب على الأرضيات الداكنة، والأسود يغلب على الفاتحة، فتبقى العلامة مقروءة في كل منجم. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformTelegraphs = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // عرض العلامة = عرض الخفاش + 8px بالضبط (معيار قبول B5).
  const MARKER_EXTRA_W = 8;
  // ارتفاع العلامة على الأرض: 9px فقط، أقل من ربع طول اللاعب (38px) فلا تغطي جسمه أبداً.
  const MARKER_H = 9;
  // أقصى شفافية للتعبئة: العلامة تُرى ولا تحجب ما تحتها.
  const FILL_ALPHA_MAX = 0.4;
  const RIM_ALPHA = 0.9;
  const INK = Object.freeze({ core: '#ffffff', edge: '#000000', danger: '#ff5535' });
  // الحد الأدنى المعتمد لزمن الإنذار المرئي (ميلي ثانية).
  const MIN_WARN_MS = Object.freeze({ bat: 400, boss: 350 });
  const TAU = Math.PI * 2;
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

  const markerWidth = (enemy) => (Number(enemy && enemy.w) || 0) + MARKER_EXTRA_W;

  // زمن التحذير المرئي للخفاش = مدة طور الإنذار في المحرك نفسه (لا نُطيل ولا نُقصّر سلوكاً).
  function batWarnMs(rules) {
    const bat = (rules && rules.BAT) || {};
    const fps = (rules && rules.FPS) || 60;
    return bat.windup ? Math.round((bat.windup / fps) * 1000) : 0;
  }
  // أقصر تحذير مرئي لأي هجوم منطقة عند عدوّ: الطور العادي أو طور الغضب (الأقصر هو ما يراه اللاعب).
  function bossWarnMs(ai, fps = 60) {
    if (!ai) return 0;
    const frames = [ai.windup, ai.enragedWindup].filter((v) => Number.isFinite(v) && v > 0);
    return frames.length ? Math.round((Math.min(...frames) / fps) * 1000) : 0;
  }

  // علامات هبوط الخفاش: تظهر من أول إطار في طور الإنذار، وتتبع انزياحه البطيء،
  // ثم تثبت على نقطة الهبوط أثناء الانقضاض (الانقضاض عمودي فلا يتحرك أفقياً).
  function batMarkers(s, rules) {
    const bat = (rules && rules.BAT) || {};
    const floor = Number.isFinite(bat.floor) ? bat.floor : 292;
    const windup = Number(bat.windup) || 26;
    const out = [];
    for (const e of (s && s.enemies) || []) {
      if (!e || e.dead || !e.flying) continue;
      const phase = e.batState;
      if (phase !== 'windup' && phase !== 'dive') continue;
      const progress = phase === 'dive' ? 1 : clamp01(1 - (Number(e.batTimer) || 0) / windup);
      out.push(Object.freeze({
        kind: 'bat', id: e.id, phase, progress,
        x: e.x + e.w / 2, y: floor, w: markerWidth(e), h: MARKER_H,
      }));
    }
    return out;
  }

  // ---- تباين قابل للحساب (WCAG 2.1) ----
  const hexToRgb = (hex) => {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const luminance = (hex) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const l1 = luminance(a), l2 = luminance(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  // العلامة تحمل النغمتين معاً، فالمعيار هو أفضلهما على الخلفية المعطاة.
  const legibility = (bg) => Math.max(contrast(INK.core, bg), contrast(INK.edge, bg));
  // الأبيض يكفي حتى سطوع 0.183، والأسود يكفي من 0.175 صعوداً ⇒ التغطية كاملة بلا فجوة.
  const CONTRAST_FLOOR = 4.5;

  return Object.freeze({
    MARKER_EXTRA_W, MARKER_H, FILL_ALPHA_MAX, RIM_ALPHA, INK, MIN_WARN_MS, TAU, CONTRAST_FLOOR,
    markerWidth, batWarnMs, bossWarnMs, batMarkers, contrast, luminance, legibility, clamp01,
  });
});
