// ترويسات أمان بلا اعتماديات إضافية. السياسة مضبوطة على موارد اللعبة الفعلية:
// سكربت Telegram WebApp، وTailwind/خطوط Google (حتى تُنقل محلياً)، ومعالجات onclick المضمّنة في index.html.
// frame-ancestors يسمح بتضمين Telegram Web (web.telegram.org) للـ Mini App فقط.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://telegram.org https://cdn.tailwindcss.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://telegram.org",
].join('; ');

function securityHeaders({ production = false } = {}) {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}

module.exports = { securityHeaders, CSP };
