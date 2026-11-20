'use strict';
// سياسة TLS لاتصال PostgreSQL في db.js — يجب أن تطابق سياسة scripts/trial-backup.cjs:
// التحقق مفعّل افتراضياً، والتعطيل يحتاج طلباً صريحاً، وشهادة سلطة خاصة لا تُلغيه.
// قبل الإصلاح كان db.js يفتح كل اتصالات السحابة بـ rejectUnauthorized:false بينما الوثائق
// تَعِد بـ PGSSLROOTCERT — وهو خيار لم يكن مطبّقاً في الخادم إطلاقاً.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pgSslConfig } = require('../db');

const REMOTE = 'postgres://u:p@db.example.com:5432/game';

test('TLS: التحقق من شهادة PostgreSQL مفعّل افتراضياً', () => {
  const byDefault = pgSslConfig(REMOTE, {});
  assert.deepEqual(byDefault.ssl, { rejectUnauthorized: true }, 'الافتراضي: تحقق كامل بشهادة النظام');
  assert.equal(byDefault.warning, null);
});

test('TLS: القواعد المحلية والداخلية بلا TLS، والبيئة تستطيع تعطيله صراحةً', () => {
  for (const url of [
    'postgres://u:p@localhost:5432/game',
    'postgres://u:p@127.0.0.1:5432/game',
    'postgres://u:p@db.internal:5432/game',
  ]) {
    assert.equal(pgSslConfig(url, {}).ssl, undefined, `${url} بلا TLS`);
  }
  assert.equal(pgSslConfig(REMOTE, { PGSSL: 'disable' }).ssl, undefined, 'تعطيل TLS صريح');
});

test('TLS: شهادة سلطة خاصة تُقرأ من PGSSLROOTCERT ولا تُلغي التحقق', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-ssl-'));
  const caFile = path.join(dir, 'ca.pem');
  fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
  try {
    const withCa = pgSslConfig(REMOTE, { PGSSLROOTCERT: caFile });
    assert.equal(withCa.ssl.rejectUnauthorized, true, 'شهادة سلطة خاصة لا تُلغي التحقق');
    assert.match(withCa.ssl.ca, /BEGIN CERTIFICATE/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TLS: مسار شهادة غير موجود يُفشل التشغيل بدل الاتصال بلا تحقق', () => {
  assert.throws(
    () => pgSslConfig(REMOTE, { PGSSLROOTCERT: '/nonexistent/ca.pem' }),
    (err) => err.code === 'ENOENT',
    'التراجع الصامت إلى بلا تحقق هو ما نُصلحه — الخطأ الصريح مطلوب',
  );
});

test('TLS: PGSSL=no-verify تعطيل صريح يُعلن نفسه بتحذير', () => {
  const noVerify = pgSslConfig(REMOTE, { PGSSL: 'no-verify' });
  assert.equal(noVerify.ssl.rejectUnauthorized, false);
  assert.match(noVerify.warning, /معطّل/, 'التعطيل الصريح يُطبع في السجل');
});
