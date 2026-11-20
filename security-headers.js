// ترويسات أمان بلا اعتماديات إضافية. السياسة مضبوطة على موارد اللعبة الفعلية فقط:
// سكربت Telegram WebApp ومعالجات onclick المضمّنة في index.html.
// Tailwind وخطوط Google نُقلا محلياً منذ زمن (لا يوجد في public/ أي رابط خارجي غير telegram.org)،
// فإبقاء أصولهما في السياسة كان يسمح بتنفيذ سكربت من CDN خارجي بلا أي حاجة — أُزيلا.
// frame-ancestors يسمح بتضمين Telegram Web (web.telegram.org) للـ Mini App فقط.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://telegram.org",
].join('; ');

function securityHeaders({ production = false } = {}) {
  // في التطوير تُفتح اللعبة داخل معاينات iframe (Arena/أنفاق محلية). أضف مضيف
  // المعاينة إلى frame-ancestors مع الإبقاء على مضيفي تيليجرام؛ الإنتاج يبقى بالسياسة الأصلية.
  const previewAncestors = process.env.PREVIEW_FRAME_ANCESTORS || 'https://*.e2b.app';
  const csp = production ? CSP : CSP.replace(/frame-ancestors [^;]+/, match => `${match} ${previewAncestors}`);
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}

module.exports = { securityHeaders, CSP };
