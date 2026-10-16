/* جسر منجم المنصّة: يربط مشهد اللعبة الجانبية بمحرك التطبيق الحالي — طلبات بنفس مصادقة
   الواجهة (X-Telegram-Init-Data / X-Guest-Id)، واعتماد ملف الخادم الموثوق، وإيقاف اللعبة
   الأصلية أثناء الجولة. لا يمنح أي ذهب محلياً: المكافأة قرار الخادم وحده. */
(() => {
  'use strict';
  if (window.PlatformBridge) return;
  window.PlatformBridge = {
    // جاهزية الهوية: bootstrap() يحسم مصير الاتصال بالخادم (نجاحاً أو فشلاً) قبل أي جولة
    ready() {
      const p = window.platformReady;
      return p && typeof p.then === 'function' ? p : Promise.resolve();
    },
    // معرّف المالك الحقيقي من ملف الخادم — بلا هوية خادمية تبقى الجولة تدريباً بلا مكافأة
    user() {
      try {
        if (typeof serverMode === 'boolean' && serverMode && profile && profile.user && profile.user.id != null) {
          return String(profile.user.id);
        }
      } catch (_) {}
      return null;
    },
    // نفس دالة api() التي تستخدمها بقية الواجهة: رؤوس المصادقة، JSON، ورسائل خطأ عربية من الخادم
    request(path, options = {}) {
      if (typeof api !== 'function') return Promise.reject(new Error('واجهة التطبيق غير جاهزة'));
      return api(path, options);
    },
    // إيقاف اللعبة الأصلية مؤقتاً أثناء جولة المنصّة (بلا أي تعديل على حالتها)
    pauseLegacy() {
      try {
        if (typeof adv !== 'undefined' && adv && adv.running && !adv.paused && typeof setAdventurePaused === 'function') {
          setAdventurePaused(true);
        }
      } catch (_) {}
    },
    // إنزال أي عمليات معلّقة قبل الطلب حتى يقرأ الخادم أحدث حالة ويرد بأحدث ملف
    flush() {
      try { return typeof flushOps === 'function' ? Promise.resolve(flushOps()) : Promise.resolve(); }
      catch (_) { return Promise.resolve(); }
    },
    // اعتماد ملف الخادم (حالة/مهمات/مناطق) كما تفعل بقية الواجهة بعد /api/me
    adopt(data) {
      try { if (data && typeof adoptServerState === 'function') adoptServerState(data); } catch (_) {}
    },
  };
})();
