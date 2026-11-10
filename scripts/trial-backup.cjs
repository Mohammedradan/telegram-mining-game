#!/usr/bin/env node
// نسخ احتياطي واستعادة لقاعدة اللعبة — أداة تشغيلية لا تمسّ منطق اللعبة.
//
//   node scripts/trial-backup.cjs backup  [--out مجلد]   إنشاء نسخة (SQLite: نسخة متصلة آمنة)
//   node scripts/trial-backup.cjs verify  <ملف>          فحص سلامة النسخة وعدد الصفوف
//   node scripts/trial-backup.cjs restore <ملف> --yes    استعادة (SQLite: الخادم يجب أن يكون متوقفاً)
//
// • SQLite: نسخة كاملة من ملف القاعدة عبر واجهة better-sqlite3 (آمنة أثناء عمل الخادم) ⇒ ملف .db.
// • PostgreSQL: تصدير JSON فقط — لا يُستدعى pg_dump إطلاقًا. لكل جدول من TABLES يُصدَّر
//   { table, columns, rows } إلى ملف .json واحد.
//   الجداول تُقرأ **داخل معاملة واحدة**:
//     BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY  … COMMIT
//   فكل الصفوف من لقطة واحدة متّسقة (لا صفوف نصف مكتوبة، ولا فروق بين الجداول)، وROLLBACK
//   عند أي فشل، ويُغلق الاتصال في كل الحالات. كل جدول داخل SAVEPOINT: الجدول غير الموجود
//   (42P01) يُجهض المعاملة في PostgreSQL، فنتراجع إلى نقطة الحفظ (ROLLBACK TO SAVEPOINT)
//   ونحرّرها (RELEASE SAVEPOINT) لتعود المعاملة صالحة، يُصدَّر الجدول فارغًا، وتُقرأ بقية
//   الجداول في المعاملة نفسها ثم COMMIT.
//   TLS: التحقق من الشهادة **مفعّل افتراضيًا**. شهادة سلطة خاصة (Neon/Supabase/Render) عبر
//   PGSSLROOTCERT=/path/ca.pem، وقاعدة محلية بلا TLS، وPGSSL=disable للتجاهل الصريح فقط.
//   PGSSL=no-verify تعطيل صريح للتحقق (لا يُستخدم تلقائيًا أبدًا) ويطبع تحذيرًا.
//   الاستعادة تقبل ملف SQLite (.db) أو ملف JSON؛ وفي حالة JSON تحذف صفوف الجداول المستهدفة
//   ثم تُدخلها من جديد داخل معاملة واحدة.
//   **لم تُجرَّب الاستعادة على خادم PostgreSQL حقيقي** (لا يوجد خادم في بيئة التطوير).
// لا يُطبع أي سر. لا يُعدّل أي ملف شيفرة.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TABLES = ['users', 'platform_runs', 'op_ledger', 'race_stats', 'pending_referrals', 'week_claims'];
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const command = process.argv[2];
const fileArg = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;

function dbConfig() {
  const url = String(process.env.DATABASE_URL || '');
  if (/^postgres(ql)?:\/\//.test(url)) return { driver: 'postgres', url };
  const file = process.env.DATABASE_FILE || path.join(ROOT, 'data', 'game.db');
  return { driver: 'sqlite', file };
}

function outDir() {
  const dir = arg('--out', path.join(ROOT, 'data', 'backups'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function backupSqlite(file) {
  if (!fs.existsSync(file)) throw new Error(`قاعدة SQLite غير موجودة: ${file}`);
  const Database = require('better-sqlite3');
  const dest = path.join(outDir(), `game-${STAMP}.db`);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    // نسخة متّسقة حتى والخادم يعمل — لا نسخ ملف بأيدي مفتوحة.
    await db.backup(dest);
  } finally { db.close(); }
  // النسخة مكتملة ومفكوكة من WAL؛ إزالة ملحقاتها يمنع الالتباس عند الاستعادة.
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${dest}${suffix}`, { force: true });
  return dest;
}

// TLS الصحيح: التحقق من الشهادة مفعّل افتراضيًا (سلطة النظام)، وشهادة سلطة خاصة تُمرَّر ملفًا.
// لا نُعطّل التحقق تلقائيًا؛ التعطيل يحتاج PGSSL=no-verify صريحًا ويطبع تحذيرًا.
function pgSslConfig(url, env = process.env) {
  const mode = String(env.PGSSL || '').trim().toLowerCase();
  if (mode === 'disable') return { ssl: undefined, warning: null };
  const isLocal = /localhost|127\.0\.0\.1|::1|\.internal\b/.test(String(url || ''));
  if (isLocal) return { ssl: undefined, warning: null };
  const caPath = String(env.PGSSLROOTCERT || '').trim();
  if (mode === 'no-verify') {
    return { ssl: { rejectUnauthorized: false }, warning: '⚠️ PGSSL=no-verify: التحقق من شهادة PostgreSQL معطّل صراحةً — لا تستخدمه إلا مؤقتًا ومع سبب.' };
  }
  const ssl = { rejectUnauthorized: true };
  if (caPath) ssl.ca = fs.readFileSync(caPath, 'utf8');
  return { ssl, warning: null };
}

function pgClientOptions(url, env = process.env) {
  const { ssl, warning } = pgSslConfig(url, env);
  if (warning) console.warn(warning);
  return { connectionString: url, ssl };
}

// تصدير كل الجداول من لقطة واحدة: معاملة واحدة REPEATABLE READ READ ONLY ثم COMMIT،
// وROLLBACK عند أي فشل. لا تُغلق هذه الدالة الاتصال — مسؤولية المستدعي.
const PG_SNAPSHOT_BEGIN = 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';

// كل جدول يُقرأ داخل نقطة حفظ (SAVEPOINT) خاصة به.
// السبب: أي خطأ داخل معاملة PostgreSQL — ومنه 42P01 لجدول غير موجود — يُجهض المعاملة كلها،
// فيصير كل استعلام لاحق يفشل بالرمز 25P02 («current transaction is aborted») حتى نتراجع.
// التراجع إلى نقطة الحفظ يعيد المعاملة إلى حالة صالحة فنكمل بقية الجداول في **نفس** اللقطة
// (REPEATABLE READ) وفي **نفس** المعاملة، ولا يُفتح اتصال ولا معاملة جديدة.
const tableSavepoint = (index) => `trial_backup_table_${index}`;

async function exportPostgresSnapshot(client, tables = TABLES) {
  const dump = { createdAt: new Date().toISOString(), driver: 'postgres', tables: {} };
  await client.query(PG_SNAPSHOT_BEGIN);
  let finished = false;
  try {
    for (const [index, table] of tables.entries()) {
      const savepoint = tableSavepoint(index);
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const res = await client.query(`SELECT * FROM ${table}`);
        dump.tables[table] = res.rows;
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (err) {
        if (err.code !== '42P01') throw err; // فشل حقيقي ⇒ تُلغى المعاملة كلها في الخارج
        // جدول غير موجود في نسخة أقدم: تراجع إلى نقطة الحفظ لإنعاش المعاملة، ثم حرّرها،
        // فتبقى دورة كل جدول متناسقة (SAVEPOINT … ROLLBACK TO/RELEASE) بلا نقاط حفظ متراكمة.
        try {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (recoverErr) {
          const wrapped = new Error(`تعذّر تجاوز الجدول الغائب ${table}: ${recoverErr.message}`);
          wrapped.cause = recoverErr;
          throw wrapped;
        }
        dump.tables[table] = [];
      }
    }
    await client.query('COMMIT');
    finished = true;
    return dump;
  } catch (err) {
    if (!finished) { try { await client.query('ROLLBACK'); } catch (_) { /* الاتصال نفسه مقطوع */ } }
    throw err;
  }
}

async function backupPostgres(url, options = {}) {
  const dir = options.dir || outDir();
  const dest = path.join(dir, `game-${options.stamp || STAMP}.json`);
  const makeClient = options.createClient || (() => {
    const { Client } = require('pg');
    return new Client(pgClientOptions(url, options.env || process.env));
  });
  const client = makeClient(url);
  try {
    await client.connect();
    const dump = await exportPostgresSnapshot(client, options.tables || TABLES);
    fs.writeFileSync(dest, JSON.stringify(dump));
    return dest;
  } finally {
    // لا نُبقي اتصالاً مفتوحًا حتى لو فشل التصدير أو الاتصال نفسه.
    try { await client.end(); } catch (_) { /* already closed */ }
  }
}

async function verify(file) {
  if (!file || !fs.existsSync(file)) throw new Error('مرّر مسار نسخة موجودة');
  if (file.endsWith('.json')) {
    const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
    const counts = Object.fromEntries(Object.entries(dump.tables || {}).map(([k, v]) => [k, v.length]));
    console.log(`✅ نسخة JSON (${dump.createdAt}) — الصفوف:`, counts);
    return true;
  }
  const Database = require('better-sqlite3');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const ok = Object.values(integrity)[0] === 'ok';
    const counts = {};
    for (const table of TABLES) {
      try { counts[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c; } catch (_) { /* جدول غير موجود */ }
    }
    console.log(`${ok ? '✅' : '❌'} فحص السلامة: ${Object.values(integrity)[0]} — الصفوف:`, counts);
    return ok;
  } finally { db.close(); }
}

async function restoreSqlite(file) {
  const target = dbConfig().file;
  if (process.argv.includes('--yes') !== true) throw new Error('الاستعادة تكتب فوق قاعدة اللعبة — أضف --yes للتأكيد');
  if (!fs.existsSync(file)) throw new Error('ملف النسخة غير موجود');
  // لا نستعيد فوق قاعدة مفتوحة: عملية كتابة من الخادم أثناء النسخ تُفسد الملف.
  // (أوقف الخادم أولاً — هذه الأداة لا تتحقق من ذلك بنفسها.)
  for (const suffix of ['-wal', '-shm']) {
    const extra = `${target}${suffix}`;
    if (fs.existsSync(extra)) fs.rmSync(extra);
  }
  fs.copyFileSync(file, target);
  return target;
}

async function restorePostgres(file) {
  if (!process.argv.includes('--yes')) throw new Error('الاستعادة تحذف صفوف الجداول المستهدفة — أضف --yes للتأكيد');
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { Client } = require('pg');
  const url = dbConfig().url;
  const client = new Client(pgClientOptions(url));
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const table of TABLES) {
      const rows = dump.tables?.[table] || [];
      await client.query(`DELETE FROM ${table}`);
      for (const row of rows) {
        const cols = Object.keys(row);
        const values = cols.map((c) => (row[c] && typeof row[c] === 'object' && !(row[c] instanceof Date) ? JSON.stringify(row[c]) : row[c]));
        await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, values);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { await client.end(); }
  return url.replace(/:\/\/[^@]+@/, '://***@');
}

async function main() {
  const cfg = dbConfig();
  if (command === 'backup') {
    const dest = cfg.driver === 'postgres' ? await backupPostgres(cfg.url) : await backupSqlite(cfg.file);
    console.log(`✅ نُسخت قاعدة ${cfg.driver} إلى: ${dest}`);
    const ok = await verify(dest);
    // فحص السلامة نفسه يفتح الملف فيُنشئ ملحقات WAL؛ ننظّفها بعد الفحص لتبقى النسخة ملفاً واحداً.
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${dest}${suffix}`, { force: true });
    if (!ok) process.exitCode = 1;
    return;
  }
  if (command === 'verify') { const ok = await verify(fileArg); process.exitCode = ok ? 0 : 1; return; }
  if (command === 'restore') {
    if (cfg.driver === 'postgres') { const where = await restorePostgres(fileArg); console.log(`✅ استُعيدت قاعدة PostgreSQL على: ${where}`); }
    else { const where = await restoreSqlite(fileArg); console.log(`✅ استُعيدت قاعدة SQLite إلى: ${where}`); }
    return;
  }
  console.log('الاستخدام: backup [--out dir] | verify <file> | restore <file> --yes');
  process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => { console.error('❌', err.message); process.exitCode = 1; });
}

module.exports = {
  TABLES, PG_SNAPSHOT_BEGIN, tableSavepoint, exportPostgresSnapshot, backupPostgres, pgSslConfig, pgClientOptions,
};
