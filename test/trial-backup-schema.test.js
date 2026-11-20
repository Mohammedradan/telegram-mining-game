'use strict';
// حراسة جودة النسخ الاحتياطي: كانت TABLES في scripts/trial-backup.cjs تحتوي جدولاً غير موجود
// (week_claims) وتغفل جدولاً حقيقياً (deep_dig_runs)، فكانت النسخة تُسقط جولات الحفر العميق
// بصمت. هذا الاختبار يقارن القائمة بما ينشئه db.js فعلاً، فأي جدول جديد يظهر هنا فوراً.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TABLES } = require('../scripts/trial-backup.cjs');

test('TABLES يطابق جداول المخطط في db.js تماماً (لا جدول وهمي، لا جدول ناقص)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-schema-'));
  const file = path.join(dir, 'game.db');
  const previous = { url: process.env.DATABASE_URL, file: process.env.DATABASE_FILE };
  process.env.DATABASE_URL = '';
  process.env.DATABASE_FILE = file;
  let created = [];
  try {
    const { createStore } = require('../db');
    const store = createStore();
    await store.countUsers(); // الانتظار حتى يُنشأ المخطط بالكامل
    await store.close();
    const Database = require('better-sqlite3');
    const conn = new Database(file, { readonly: true });
    created = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    conn.close();
  } finally {
    if (previous.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.url;
    if (previous.file === undefined) delete process.env.DATABASE_FILE; else process.env.DATABASE_FILE = previous.file;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.ok(created.length >= 6, `المخطط أنشأ ${created.length} جدولاً فقط`);
  assert.deepEqual(
    [...TABLES].sort(),
    [...created].sort(),
    'قائمة النسخ الاحتياطي وسيعة: كل جدول في المخطط يجب أن يُنسخ، ولا يُنسخ جدول غير موجود',
  );
  assert.ok(TABLES.includes('deep_dig_runs'), 'جولات الحفر العميق يجب أن تكون في النسخة');
  assert.ok(!TABLES.includes('week_claims'), 'week_claims جدول غير موجود في المخطط');
});
