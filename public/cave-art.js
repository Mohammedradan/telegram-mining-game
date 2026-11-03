/* سجلّ فنّ «الكهف»: أيقونات الميداليات المرسومة (WebP) وبدائلها المتجهية، وبُناة HTML مشتركة بين شاشة التعدين والورشة.
   عرض فقط: لا يلمس حالة اللعبة. إن لم يُحمَّل الملف تبقى الشاشتان تعملان بالأيقونات الخطية الموحّدة (#i-…).
   لإضافة أيقونة مرسومة جديدة: ضع ملف WebP بمقاس 192×192 في public/assets/cave/icons/ وأضف اسمه إلى PAINTED. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CaveArt = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BASE = '/assets/cave/icons/';
  const VERSION = 1;
  // الفن المرسوم الموجود كملفات (المعرّف = اسم الملف)
  const PAINTED = Object.freeze(['pickaxe', 'boots', 'bag', 'magnet', 'drill', 'armor', 'miner', 'robot', 'luck']);
  // رسومات متجهية في سبرايت #art-sprite لما لا يتوفر له ملف مرسوم بعد (فارغ الآن: كل الميداليات مرسومة)
  const VECTOR = Object.freeze({});
  // ترقيات النقر تستعير فنّ المعدات المقابلة؛ وميدالية الورشة تعرض وجه المعدّن
  const ALIAS = Object.freeze({ click: 'pickaxe', bot: 'robot', rig: 'drill', workshop: 'miner' });

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp01 = (n) => { const v = Number(n); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; };

  function resolve(id) {
    const key = ALIAS[id] || id;
    if (PAINTED.includes(key)) return { kind: 'painted', key, src: `${BASE}${key}.webp?v=${VERSION}` };
    if (VECTOR[key]) return { kind: 'vector', key, symbol: VECTOR[key] };
    return { kind: 'none', key };
  }

  // وجه الميدالية: أيقونة خطية احتياطية تحت الصورة؛ إن تعذّر تحميل الصورة تُزال فتظهر الأيقونة الخطية
  function faceHTML(id, fallbackIcon) {
    const art = resolve(id);
    const line = `<svg class="ui-icon cv-fallback" aria-hidden="true"><use href="#${esc(fallbackIcon || 'i-gem')}"/></svg>`;
    if (art.kind === 'painted') return `${line}<img class="cv-art" src="${art.src}" alt="" width="192" height="192" draggable="false" decoding="async">`;
    if (art.kind === 'vector') return `<svg class="cv-vec" aria-hidden="true" focusable="false"><use href="#${art.symbol}"/></svg>`;
    return line;
  }

  // حلقة التقدّم: pathLength=100 فتُضبط عبر المتغير --p (0..1) من CSS دون حساب محيط
  const RING = '<svg class="cv-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><circle class="cv-ring-track" cx="22" cy="22" r="20" pathLength="100"/><circle class="cv-ring-bar" cx="22" cy="22" r="20" pathLength="100"/></svg>';

  // ميدالية كاملة: حلقة تقدّم + إطار ذهبي + لوحة داكنة بالرسم + شارة المستوى + سهم «ترقية متاحة»
  function medalHTML(o) {
    const opt = o || {};
    const state = opt.state === 'ready' || opt.state === 'max' || opt.state === 'plain' ? opt.state : 'poor';
    const lvl = opt.level == null ? '' : `<span class="cv-lvl">${esc(opt.level)}</span>`;
    const up = '<span class="cv-up" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 4 5 12h4.2v7h5.6v-7H19z"/></svg></span>';
    return `<span class="cv-medal" data-state="${state}" style="--p:${clamp01(opt.progress).toFixed(3)}">${RING}<span class="cv-plate">${faceHTML(opt.id, opt.icon)}</span>${lvl}${up}</span>`;
  }

  // صورة تعذّر تحميلها (WebP قديم/انقطاع): نزيلها فتبقى الأيقونة الخطية الاحتياطية ظاهرة
  function guardImages(scope) {
    if (!scope || !scope.addEventListener) return;
    scope.addEventListener('error', (e) => {
      const t = e && e.target;
      if (t && t.tagName === 'IMG' && t.classList && t.classList.contains('cv-art')) t.remove();
    }, true);
  }

  return { VERSION, PAINTED, VECTOR, ALIAS, resolve, faceHTML, medalHTML, guardImages, esc };
});
