/* واجهة عميل لورديات آلات المنجم. الخادم وحده يحسب الإنتاج ويضيف الخام للمحفظة. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.MineMachineryClient = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function create(options = {}) {
    const bridge = options.bridge || root.PlatformBridge;
    const setTimer = options.setTimeout || (root.setTimeout && root.setTimeout.bind(root));
    const clearTimer = options.clearTimeout || (root.clearTimeout && root.clearTimeout.bind(root));
    let active = false, busy = false, timer = null, disposed = false, job = null;

    const status = (message) => { try { options.onStatus && options.onStatus(String(message || '')); } catch (_) {} };
    const state = (value, record) => {
      active = !!value;
      job = record || null;
      try { options.onState && options.onState(active, job); } catch (_) {}
    };
    const cancel = () => {
      if (timer !== null && clearTimer) clearTimer(timer);
      timer = null;
    };
    const schedule = (ms) => {
      cancel();
      if (!active || disposed || !setTimer) return;
      timer = setTimer(() => { timer = null; claim(); }, Math.max(1000, Number(ms) || 60000));
    };
    async function request(path, method, body) {
      if (!bridge) throw new Error('جسر الاتصال بالخادم غير جاهز');
      await bridge.ready();
      if (!bridge.user()) throw new Error('سجّل الدخول بحسابك لتشغيل إنتاج المنجم');
      await bridge.flush();
      return bridge.request(path, method ? { method, body: JSON.stringify(body || {}) } : {});
    }
    async function sync() {
      if (busy || disposed) return null;
      busy = true;
      try {
        const result = await request('/api/mine-machinery/status');
        const record = result && result.job;
        state(!!(record && record.active), record);
        if (active) {
          status('وردية التعدين مستمرة على الخادم');
          schedule(Math.max(1000, Number(record.nextOreInSeconds) * 1000 || 60000));
        } else {
          status('لا توجد وردية إنتاج نشطة');
          cancel();
        }
        return result;
      } catch (error) {
        status(error && error.message || 'تعذر الاتصال بخدمة إنتاج المنجم');
        return null;
      } finally { busy = false; }
    }
    async function start(zone) {
      if (busy || disposed) return { ok: false, error: 'هناك طلب قيد التنفيذ' };
      busy = true;
      cancel();
      try {
        const started = await request('/api/mine-machinery/start', 'POST', { zone: Number(zone) || 0 });
        state(true, started.job);
        status('بدأت الوردية؛ سيضيف الخادم خاماً بعد اكتمال أول دقيقة');
        schedule(60000);
        return { ok: true, result: started };
      } catch (error) {
        status(error && error.message || 'تعذر بدء وردية التعدين');
        return { ok: false, error };
      } finally { busy = false; }
    }
    async function stop() {
      if (busy) return { ok: false, error: 'هناك طلب قيد التنفيذ' };
      cancel();
      if (!active || disposed) { if (!active) status('تم إيقاف المنشآت'); return { ok: true, inactive: true }; }
      busy = true;
      try {
        const result = await request('/api/mine-machinery/stop', 'POST');
        state(false, result && result.job);
        status('تم إيقاف وردية الإنتاج');
        return { ok: true, result };
      } catch (error) {
        status(error && error.message || 'تعذر إيقاف الوردية؛ تحقق من الاتصال');
        schedule(60000);
        return { ok: false, error };
      } finally { busy = false; }
    }
    async function claim() {
      if (!active || busy || disposed) return null;
      busy = true;
      try {
        const result = await request('/api/mine-machinery/claim', 'POST');
        const amount = Math.max(0, Math.floor(Number(result && result.produced) || 0));
        if (amount > 0) {
          status('أنتج الخادم ' + amount + ' من ' + String(result.ore || 'الخام') + '؛ تم حفظها في المحفظة');
          try { if (options.onProduction) await options.onProduction(result); } catch (_) {}
        } else status('الوردية تعمل؛ لم يكتمل إنتاج خام جديد بعد');
        state(true, result && result.job || job);
        schedule(Math.max(1000, Number(result && result.job && result.job.nextOreInSeconds) * 1000 || 60000));
        return result;
      } catch (error) {
        status(error && error.message || 'تعذر استلام إنتاج الوردية');
        schedule(60000);
        return null;
      } finally { busy = false; }
    }
    function dispose() { disposed = true; cancel(); }
    return {
      sync, start, stop, claim, dispose,
      inspect() { return { active, busy, job }; },
    };
  }

  return { create };
});
