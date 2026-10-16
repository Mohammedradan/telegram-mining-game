// The browser never grants a paid item. openInvoice callbacks are only hints to
// re-fetch server state; ownership comes from committed Telegram receipts.
(() => {
  let owned = new Set();
  let config = null;
  let busy = false;
  const byId = id => document.getElementById(id);
  const status = message => { const el = byId('shop-status'); if (el) el.textContent = message; };
  window.MiningShop = { owns: id => owned.has(id) };

  async function request(path, options = {}) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) options.signal = AbortSignal.timeout(15000);
    return api(path, options);
  }
  async function loadConfig() {
    config = await request('/api/config');
    if (/^[A-Za-z0-9_]{5,32}$/.test(config.botUsername || '')) {
      BOT_USERNAME = config.botUsername;
      byId('ref-link-preview').innerText = referralUrl();
    }
    for (const [id, url] of [['shop-terms', config.termsUrl], ['shop-privacy', config.privacyUrl], ['shop-support', config.supportUsername ? `https://t.me/${config.supportUsername}` : '']]) {
      const el = byId(id);
      if (el && /^https:\/\//.test(url || '')) { el.href = url; el.hidden = false; }
    }
  }
  async function refresh() {
    try {
      if (!config) await loadConfig();
      const data = await request('/api/shop');
      owned = new Set(data.owned || []); // not persisted in localStorage
      updateAdvSettingsUI();
      const list = byId('shop-products');
      if (!list) return;
      list.innerHTML = '';
      status(data.enabled ? `${config.shopTestMode ? 'بيئة دفع اختبارية — ' : ''}الدفع عبر Telegram فقط؛ تأكيد الخادم هو المرجع. شراء مرة واحدة للحساب.` : 'الشراء مغلق حاليًا. يمكنك تحديث ملكية مشترياتك السابقة.');
      for (const p of data.products || []) {
        const order = (data.orders || []).find(o => o.productId === p.id);
        const row = document.createElement('div');
        const description = document.createElement('p');
        description.className = 'text-xs my-2';
        description.textContent = `${p.title} — ${p.amount} Stars. ${p.description}${order ? ` | الطلب ${order.id} — ${order.status}` : ''}`;
        const button = document.createElement('button');
        button.className = 'btn-press border border-cyan-500 rounded-lg px-3 py-2 text-xs';
        button.textContent = owned.has(p.id) ? 'مملوك — اختره من أشكال العربة' : order?.status === 'refunded' ? 'تم الاسترداد — راجع الدعم' : `شراء مقابل ${p.amount} Stars`;
        button.disabled = busy || owned.has(p.id) || !data.enabled || !tg?.openInvoice || order?.status === 'refunded' || order?.status === 'checkout';
        button.onclick = () => buy(p);
        row.append(description, button); list.appendChild(row);
      }
    } catch (e) {
      owned = new Set(); // fail closed; no offline paid entitlement
      updateAdvSettingsUI();
      status('تعذّر التحقق من المتجر. أعد المحاولة؛ لا يُمنح أي عنصر اعتمادًا على حالة محلية.');
    }
  }
  async function buy(product) {
    if (busy || !config?.shopEnabled || !tg?.openInvoice) return;
    if (!confirm(`شراء ${product.title} مقابل ${product.amount} Telegram Stars؟ مظهر دائم فقط لحسابك، دون قوة إضافية. بالمتابعة توافق على شروط الشراء المرتبطة أعلاه.`)) return;
    busy = true;
    let opened = false;
    try {
      status('جارٍ إنشاء الفاتورة… لا تغلق اللعبة.');
      const order = await request('/api/shop/orders', { method: 'POST', body: JSON.stringify({ productId: product.id, acceptTerms: true }) });
      status(`الطلب ${order.id} — ${order.status}`);
      if (order.invoiceUrl) {
        opened = true;
        tg.openInvoice(order.invoiceUrl, () => {
          // Even a callback saying "paid" MUST NOT grant ownership.
          busy = false; refresh();
        });
      } else { await refresh(); }
    } catch (e) { opened = false; status('تعذّر فتح الفاتورة. استخدم تحديث الحالة قبل إعادة المحاولة أو تواصل مع الدعم.'); }
    finally { if (!opened) busy = false; }
  }
  byId('shop-refresh')?.addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
})();
