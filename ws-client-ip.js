// عنوان العميل الحقيقي لاتصالات WebSocket — وحدة مستقلة قابلة للاختبار بلا خادم.
//
// القاعدة: لا يُؤخذ أول عنصر في X-Forwarded-For أبدًا. العميل يستطيع أن يرسل الترويسة بنفسه،
// والوكيل الموثوق يُلحق عنوانه في نهاية السلسلة، لذلك العنوان الصحيح يُقرأ **من اليمين** بعدد
// القفزات الموثوقة (TRUST_PROXY_HOPS):
//     hops = 0  → لا ثقة بالترويسة إطلاقًا، عنوان المقبس فقط.
//     hops = 1  → آخر عنصر (ما أضافه الوكيل الموثوق أمامنا مباشرة).
//     hops = 2  → العنصر قبل الأخير، وهكذا.
// مثال: الترويسة "6.6.6.6, 203.0.113.7" مع hops=1 ⇒ 203.0.113.7 (العميل المزوَّر 6.6.6.6 يُهمَل).
//
// ضوابط إضافية:
//   • سلسلة أقصر من عدد القفزات الموثوقة = ترويسة غير متسقة ⇒ تجاهلها والعودة إلى عنوان المقبس.
//   • العنصر المختار يجب أن يكون IP صالحًا (IPv4/IPv6) بعد إزالة المنفذ/الأقواس، وإلا عنوان المقبس.
//   • لا نختار "أقرب عنصر صالح" من اليمين: قد يكون عنصرًا أدخله العميل. الفشل هنا يعود إلى عنوان
//     المقبس، وهو عنوان الوكيل خلف Render، أي يسقط الجميع في دلو واحد (تشدّد لا تجاوز).
const net = require('node:net');

const MAX_HOPS = 5;

// يطبّع قيمة عنوان واحدة: "1.2.3.4" · "1.2.3.4:5678" · "[::1]" · "[::1]:443" · "::ffff:1.2.3.4"
function normalizeAddress(value) {
  if (value === null || value === undefined) return '';
  let text = String(value).trim();
  if (!text) return '';
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    const inner = end > 0 ? text.slice(1, end) : '';
    return net.isIP(inner) ? inner : '';
  }
  if (net.isIP(text)) return text;
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(text);
  if (withPort && net.isIP(withPort[1])) return withPort[1];
  return '';
}

function forwardedChain(headerValue) {
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
  if (!raw) return [];
  return String(raw).split(',').map((part) => part.trim()).filter((part) => part !== '');
}

function clampHops(trustProxyHops) {
  return Math.max(0, Math.min(MAX_HOPS, Math.floor(Number(trustProxyHops)) || 0));
}

// نفس القرار أعلاه، لكن مع وصف قابل للتشخيص **بلا كشف العنوان**:
//   source: 'forwarded' (قيمة من الترويسة) أو 'socket' (عنوان المقبس)
//   reason: سبب اختيار المقبس ('hops-disabled' | 'chain-shorter-than-hops' | 'entry-not-an-ip')
//   chainLength / hops: عدد عناصر الترويسة كما رآها الخادم، وعدد القفزات المضبوط
// هذه الحقول تكفي لتشخيص ضبط الوكيل دون تسجيل عنوان أي لاعب.
function clientIpDetails({ headerValue, remoteAddress, trustProxyHops } = {}) {
  const socketAddress = normalizeAddress(remoteAddress) || String(remoteAddress || '') || 'unknown';
  const hops = clampHops(trustProxyHops);
  const chain = forwardedChain(headerValue);
  const base = { hops, chainLength: chain.length };
  if (hops <= 0) return { ...base, ip: socketAddress, source: 'socket', socketFallback: false, reason: 'hops-disabled' };
  if (chain.length < hops) return { ...base, ip: socketAddress, source: 'socket', socketFallback: true, reason: 'chain-shorter-than-hops' };
  const picked = normalizeAddress(chain[chain.length - hops]);
  if (!picked) return { ...base, ip: socketAddress, source: 'socket', socketFallback: true, reason: 'entry-not-an-ip' };
  return { ...base, ip: picked, source: 'forwarded', socketFallback: false, reason: 'forwarded' };
}

function clientIpFrom(options = {}) {
  return clientIpDetails(options).ip;
}

// الغلاف الذي يستخدمه الخادم: يقرأ رأس الطلب ومقبسه ويطبّق عدد القفزات من الإعداد.
function clientIpDetailsFromRequest(req, trustProxyHops) {
  const headers = (req && req.headers) || {};
  const headerValue = headers['x-forwarded-for'] ?? headers['X-Forwarded-For'] ?? '';
  const remoteAddress = req && req.socket ? req.socket.remoteAddress : '';
  return clientIpDetails({ headerValue, remoteAddress, trustProxyHops });
}

function clientIp(req, trustProxyHops) {
  return clientIpDetailsFromRequest(req, trustProxyHops).ip;
}

module.exports = { clientIp, clientIpFrom, clientIpDetails, clientIpDetailsFromRequest, normalizeAddress, MAX_HOPS };
