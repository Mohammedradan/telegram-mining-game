'use strict';
// ترويسات الأمان (security-headers.js): سياسة الإنتاج هي السياسة الأصلية حرفياً ولا يغيّرها شيء من البيئة؛
// وفي التطوير فقط يُضاف مضيف معاينة الـ iframe إلى frame-ancestors دون أي توجيه آخر.
const test = require('node:test');
const assert = require('node:assert/strict');
const { securityHeaders, CSP } = require('../security-headers');

const ENV = 'PREVIEW_FRAME_ANCESTORS';

// يشغّل الـ middleware على res وهمي ويعيد الترويسات التي وضعها؛ البيئة تُضبط ثم تُستعاد مهما حدث
function headersWith(env, options) {
  const had = Object.prototype.hasOwnProperty.call(process.env, ENV);
  const before = process.env[ENV];
  if (env === undefined) delete process.env[ENV]; else process.env[ENV] = env;
  try {
    const headers = {};
    let called = 0;
    securityHeaders(options)({}, { setHeader: (name, value) => { headers[name] = value; } }, () => { called++; });
    assert.equal(called, 1, 'the middleware must hand over to the next handler exactly once');
    return headers;
  } finally {
    if (had) process.env[ENV] = before; else delete process.env[ENV];
  }
}

const directives = (csp) => csp.split('; ');
const directive = (csp, name) => directives(csp).find((d) => d.startsWith(`${name} `));
const withoutDirective = (csp, name) => directives(csp).filter((d) => !d.startsWith(`${name} `)).join('; ');

test('production serves exactly the original policy: Telegram only, and no preview host', () => {
  const csp = headersWith(undefined, { production: true })['Content-Security-Policy'];
  assert.equal(csp, CSP, 'the production header is the exported policy, untouched');
  assert.ok(!csp.includes('e2b.app'), 'the preview host must never reach production');
  const sources = directive(csp, 'frame-ancestors').split(' ').slice(1);
  assert.deepEqual(sources, ["'self'", 'https://web.telegram.org', 'https://*.telegram.org', 'https://telegram.org'],
    'only the game itself and Telegram may embed the Mini App');
  assert.ok(!CSP.includes('e2b.app'), 'and the base policy itself stays free of it');
});

test('no environment variable can widen the production policy', () => {
  for (const value of ['https://preview.example', 'https://*.e2b.app', '*', '']) {
    const csp = headersWith(value, { production: true })['Content-Security-Policy'];
    assert.equal(csp, CSP, `PREVIEW_FRAME_ANCESTORS=${JSON.stringify(value)} changed the production policy`);
  }
});

test('development adds the preview host to frame-ancestors only, keeping Telegram first', () => {
  const csp = headersWith(undefined, { production: false })['Content-Security-Policy'];
  const base = directive(CSP, 'frame-ancestors');
  assert.equal(directive(csp, 'frame-ancestors'), `${base} https://*.e2b.app`, 'the default preview host is appended after Telegram');
  assert.equal(withoutDirective(csp, 'frame-ancestors'), withoutDirective(CSP, 'frame-ancestors'), 'every other directive is identical to production');
  assert.equal(directives(csp).length, directives(CSP).length, 'no directive is added or dropped');
  // الاستدعاء بلا خيارات (كما في الاستخدام الافتراضي) هو التطوير أيضاً
  assert.equal(headersWith(undefined, undefined)['Content-Security-Policy'], csp);
});

test('PREVIEW_FRAME_ANCESTORS replaces the default preview host in development', () => {
  const csp = headersWith('https://preview.example', { production: false })['Content-Security-Policy'];
  assert.equal(directive(csp, 'frame-ancestors'), `${directive(CSP, 'frame-ancestors')} https://preview.example`);
  assert.ok(!csp.includes('e2b.app'), 'the override replaces the default, it does not add to it');
  assert.equal(withoutDirective(csp, 'frame-ancestors'), withoutDirective(CSP, 'frame-ancestors'));
});

test('the other security headers are untouched, and HSTS is sent only in production', () => {
  const prod = headersWith(undefined, { production: true });
  const dev = headersWith(undefined, { production: false });
  for (const headers of [prod, dev]) {
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin-allow-popups');
    assert.equal(headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=(), payment=()');
  }
  assert.equal(prod['Strict-Transport-Security'], 'max-age=15552000');
  assert.equal(dev['Strict-Transport-Security'], undefined);
});
