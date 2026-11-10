// اختبارات تصدير PostgreSQL في أداة النسخ: معاملة واحدة متّسقة، وتجاوز الجدول الغائب عبر
// SAVEPOINT (لأن 42P01 يُجهض المعاملة في PostgreSQL)، وROLLBACK عند الفشل، وإغلاق الاتصال،
// وسياسة TLS. العميل هنا **يحاكي حالة المعاملة** كما يفعل PostgreSQL فعلاً: بعد أي خطأ
// يصير الاستعلام التالي مرفوضًا بالرمز 25P02 حتى يُنفَّذ التراجع المناسب.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  TABLES, PG_SNAPSHOT_BEGIN, tableSavepoint, exportPostgresSnapshot, backupPostgres, pgSslConfig, pgClientOptions,
} = require('../scripts/trial-backup.cjs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-backup-pg-'));
const pgError = (code, message) => Object.assign(new Error(message), { code });

// عميل PostgreSQL وهمي بحالة معاملة حقيقية:
//   idle → BEGIN → ok → (خطأ) → aborted → ROLLBACK / ROLLBACK TO SAVEPOINT → ok
// في الحالة aborted يرفض كل استعلام بالرمز 25P02 كما يفعل الخادم، ويقبل التراجع فقط.
function postgresLike({ rows = {}, failOn = null, failCode = '57014', failConnect = false } = {}) {
  const queries = [];
  const state = { tx: 'idle', savepoints: [], outcome: null, ended: false };
  const usable = () => {
    if (state.tx === 'aborted') throw pgError('25P02', 'current transaction is aborted, commands ignored until end of transaction block');
    if (state.tx !== 'ok') throw pgError('25P01', 'no transaction in progress');
  };
  const client = {
    queries,
    state,
    async connect() { if (failConnect) throw new Error('اتصال مرفوض'); queries.push('<connect>'); },
    async end() { state.ended = true; queries.push('<end>'); },
    async query(sql) {
      queries.push(sql);
      if (sql === PG_SNAPSHOT_BEGIN) {
        if (state.tx !== 'idle') throw pgError('25001', 'معاملة مفتوحة بالفعل');
        state.tx = 'ok'; state.savepoints = []; state.outcome = null;
        return { rows: [], command: 'BEGIN' };
      }
      const savepoint = /^SAVEPOINT (\S+)$/.exec(sql);
      if (savepoint) { usable(); state.savepoints.push(savepoint[1]); return { rows: [], command: 'SAVEPOINT' }; }
      const release = /^RELEASE SAVEPOINT (\S+)$/.exec(sql);
      if (release) {
        usable();
        const at = state.savepoints.lastIndexOf(release[1]);
        if (at < 0) throw pgError('3B001', 'no such savepoint');
        state.savepoints = state.savepoints.slice(0, at);
        return { rows: [], command: 'RELEASE' };
      }
      const rollbackTo = /^ROLLBACK TO SAVEPOINT (\S+)$/.exec(sql);
      if (rollbackTo) {
        // مسموح حتى في المعاملة المجهضة — وهو ما يعيدها إلى حالة صالحة
        const at = state.savepoints.lastIndexOf(rollbackTo[1]);
        if (at < 0) throw pgError('3B001', 'no such savepoint');
        state.savepoints = state.savepoints.slice(0, at + 1);
        state.tx = 'ok';
        return { rows: [], command: 'ROLLBACK' };
      }
      if (sql === 'COMMIT') {
        // في معاملة مجهضة: COMMIT لا يرفع خطأً لكنه يتراجع فعليًا
        state.outcome = state.tx === 'aborted' ? 'rolled-back' : 'committed';
        state.tx = 'idle'; state.savepoints = [];
        return { rows: [], command: state.outcome === 'committed' ? 'COMMIT' : 'ROLLBACK' };
      }
      if (sql === 'ROLLBACK') {
        state.outcome = 'rolled-back'; state.tx = 'idle'; state.savepoints = [];
        return { rows: [], command: 'ROLLBACK' };
      }
      usable();
      const select = /^SELECT \* FROM (\S+)$/.exec(sql);
      if (select) {
        const table = select[1];
        if (table === failOn) { state.tx = 'aborted'; throw pgError(failCode, `فشل الاستعلام عن ${table}`); }
        if (!(table in rows)) { state.tx = 'aborted'; throw pgError('42P01', `relation "${table}" does not exist`); }
        return { rows: rows[table] };
      }
      return { rows: [] };
    },
  };
  return client;
}

const fullRows = Object.fromEntries(TABLES.map((t, i) => [t, [{ id: `${t}-1`, n: i }]]));
const selectsOf = (client) => client.queries.filter((q) => q.startsWith('SELECT * FROM '));

test('التصدير كله في معاملة واحدة، وكل جدول داخل نقطة حفظ: BEGIN → (SAVEPOINT/SELECT/RELEASE)×6 → COMMIT', async () => {
  const client = postgresLike({ rows: fullRows });
  const dump = await exportPostgresSnapshot(client);

  const expected = [PG_SNAPSHOT_BEGIN];
  TABLES.forEach((table, i) => {
    expected.push(`SAVEPOINT ${tableSavepoint(i)}`, `SELECT * FROM ${table}`, `RELEASE SAVEPOINT ${tableSavepoint(i)}`);
  });
  expected.push('COMMIT');
  assert.deepEqual(client.queries, expected, 'بروتوكول الاستعلامات بالترتيب، بلا معاملة أو اتصال إضافي');
  assert.equal(client.queries.filter((q) => q === PG_SNAPSHOT_BEGIN).length, 1, 'معاملة واحدة فقط');
  assert.equal(client.queries.filter((q) => q === 'COMMIT').length, 1);
  assert.equal(client.queries.filter((q) => q.startsWith('ROLLBACK')).length, 0, 'لا تراجع في مسار النجاح');
  assert.equal(client.state.outcome, 'committed', 'COMMIT فعلي لا تراجع مقنّع');

  assert.equal(dump.driver, 'postgres');
  assert.deepEqual(Object.keys(dump.tables), TABLES, 'بنية النسخة وترتيب الجداول كما هي');
  for (const table of TABLES) assert.deepEqual(dump.tables[table], fullRows[table]);
});

test('جدول غائب (42P01): التراجع إلى نقطة الحفظ ينعش المعاملة، فتُقرأ بقية الجداول ويُنجح COMMIT', async () => {
  const missing = 'op_ledger';
  const at = TABLES.indexOf(missing);
  const rows = { ...fullRows };
  delete rows[missing];
  const client = postgresLike({ rows });

  const dump = await exportPostgresSnapshot(client);

  assert.deepEqual(dump.tables[missing], [], 'الجدول الغائب يُصدَّر فارغًا');
  assert.deepEqual(selectsOf(client), TABLES.map((t) => `SELECT * FROM ${t}`), 'كل الجداول قُرئت بالترتيب');
  assert.ok(client.queries.includes(`ROLLBACK TO SAVEPOINT ${tableSavepoint(at)}`), 'التراجع إلى نقطة حفظ الجدول الغائب');
  assert.ok(client.queries.includes(`RELEASE SAVEPOINT ${tableSavepoint(at)}`), 'تحرير نقطة الحفظ بعد التراجع');
  assert.ok(
    client.queries.indexOf(`RELEASE SAVEPOINT ${tableSavepoint(at)}`) > client.queries.indexOf(`ROLLBACK TO SAVEPOINT ${tableSavepoint(at)}`),
    'التحرير يأتي بعد التراجع لا قبله',
  );

  // دورة كل جدول متناسقة: كل نقطة حفظ أُنشئت (للجداول الستة) حُرّرت، والغائب مثل الحاضر
  const created = client.queries.filter((q) => q.startsWith('SAVEPOINT ')).map((q) => q.slice('SAVEPOINT '.length));
  const released = client.queries.filter((q) => q.startsWith('RELEASE SAVEPOINT ')).map((q) => q.slice('RELEASE SAVEPOINT '.length));
  assert.deepEqual(created, TABLES.map((_, i) => tableSavepoint(i)), 'نقطة حفظ لكل جدول');
  assert.deepEqual([...released].sort(), [...created].sort(), 'لا نقطة حفظ متراكمة: كل نقطة حُرّرت');
  assert.equal(client.state.savepoints.length, 0, 'لا نقاط حفظ معلّقة عند نهاية المعاملة');
  assert.equal(client.queries.filter((q) => q === PG_SNAPSHOT_BEGIN).length, 1, 'لا معاملة ثانية');

  // الجداول التي تلي الغائب قُرئت فعلاً بعد إنعاش المعاملة (لو بقيت مجهضة لجاء 25P02)
  for (const table of TABLES.slice(at + 1)) assert.deepEqual(dump.tables[table], fullRows[table], `${table} بعد الجدول الغائب`);
  assert.equal(client.state.outcome, 'committed', 'COMMIT النهائي نجح فعليًا');
  assert.equal(client.queries.at(-1), 'COMMIT');
  assert.equal(client.queries.some((q) => q === 'ROLLBACK'), false, 'لم تُلغَ المعاملة كلها');
});

test('محاكاة PostgreSQL: 42P01 يجعل كل استعلام لاحق يفشل بـ25P02 حتى ROLLBACK TO SAVEPOINT', async () => {
  const client = postgresLike({ rows: fullRows });
  await client.query(PG_SNAPSHOT_BEGIN);
  await client.query('SAVEPOINT probe');

  await assert.rejects(() => client.query('SELECT * FROM ghost'), (err) => err.code === '42P01');
  await assert.rejects(() => client.query('SELECT * FROM users'), (err) => err.code === '25P02', 'المعاملة مجهضة بعد الخطأ');
  await assert.rejects(() => client.query('SAVEPOINT another'), (err) => err.code === '25P02');

  await client.query('ROLLBACK TO SAVEPOINT probe');
  const after = await client.query('SELECT * FROM users');
  assert.deepEqual(after.rows, fullRows.users, 'بعد التراجع إلى نقطة الحفظ تعود القراءة للعمل');
  await client.query('RELEASE SAVEPOINT probe');
  assert.equal(client.state.savepoints.length, 0, 'التحرير يزيل نقطة الحفظ من المكدّس');
});

test('المنطق القديم (تصدير بلا نقاط حفظ) كان سيفشل على عميل يحاكي PostgreSQL', async () => {
  const missing = 'op_ledger';
  const rows = { ...fullRows };
  delete rows[missing];
  const client = postgresLike({ rows });

  const oldWay = async () => {
    await client.query(PG_SNAPSHOT_BEGIN);
    for (const table of TABLES) {
      try { await client.query(`SELECT * FROM ${table}`); } catch (err) { if (err.code !== '42P01') throw err; }
    }
    await client.query('COMMIT');
  };
  await assert.rejects(oldWay, (err) => err.code === '25P02', 'بلا نقطة حفظ ينفجر التصدير عند أول جدول بعد الغائب');
});

test('فشل حقيقي في جدول (57014) ⇒ ROLLBACK عام وبلا COMMIT', async () => {
  const failing = 'platform_runs';
  const client = postgresLike({ rows: fullRows, failOn: failing });
  await assert.rejects(() => exportPostgresSnapshot(client), (err) => err.code === '57014');

  assert.equal(client.queries[0], PG_SNAPSHOT_BEGIN);
  assert.ok(client.queries.includes('ROLLBACK'), 'تراجع عام عند الفشل الحقيقي');
  assert.equal(client.queries.includes('COMMIT'), false, 'لا COMMIT بعد فشل');
  assert.equal(client.queries.at(-1), 'ROLLBACK');
  assert.equal(client.state.outcome, 'rolled-back');
  assert.deepEqual(selectsOf(client), TABLES.slice(0, TABLES.indexOf(failing) + 1).map((t) => `SELECT * FROM ${t}`));
});

test('backupPostgres يغلق الاتصال عند الفشل ولا يكتب ملف نسخة ناقصًا', async () => {
  const client = postgresLike({ rows: fullRows, failOn: 'users' });
  await assert.rejects(() => backupPostgres('postgres://u:p@db.example.com:5432/game', {
    dir: tmpDir, stamp: 'fail-case', createClient: () => client,
  }), /فشل الاستعلام عن users/);
  assert.equal(client.state.ended, true, 'الاتصال يجب أن يُغلق في finally');
  assert.equal(client.queries.includes('ROLLBACK'), true);
  assert.equal(fs.existsSync(path.join(tmpDir, 'game-fail-case.json')), false, 'لا ملف نسخة عند الفشل');
});

test('backupPostgres يغلق الاتصال حتى لو فشل الاتصال نفسه', async () => {
  const client = postgresLike({ failConnect: true });
  await assert.rejects(() => backupPostgres('postgres://u:p@db.example.com:5432/game', {
    dir: tmpDir, stamp: 'connect-fail', createClient: () => client,
  }), /اتصال مرفوض/);
  assert.equal(client.state.ended, true);
});

test('backupPostgres يكتب نسخة JSON متّسقة (بجدول غائب) ثم يغلق الاتصال', async () => {
  const rows = { ...fullRows };
  delete rows.week_claims;
  const client = postgresLike({ rows });
  const dest = await backupPostgres('postgres://u:p@db.example.com:5432/game', {
    dir: tmpDir, stamp: 'ok-case', createClient: () => client,
  });
  assert.equal(dest, path.join(tmpDir, 'game-ok-case.json'));
  const dump = JSON.parse(fs.readFileSync(dest, 'utf8'));
  assert.deepEqual(Object.keys(dump.tables), TABLES);
  assert.deepEqual(dump.tables.week_claims, []);
  assert.equal(dump.driver, 'postgres');
  assert.equal(client.state.ended, true);
  assert.equal(client.state.outcome, 'committed');
  assert.equal(client.queries[1], PG_SNAPSHOT_BEGIN, 'المعاملة تبدأ قبل أول قراءة');
});

test('TLS: التحقق من الشهادة مفعّل افتراضيًا، والتعطيل يحتاج طلبًا صريحًا', () => {
  const remote = 'postgres://u:p@db.example.com:5432/game';
  const local = 'postgres://u:p@localhost:5432/game';

  const byDefault = pgSslConfig(remote, {});
  assert.deepEqual(byDefault.ssl, { rejectUnauthorized: true }, 'الافتراضي: تحقق كامل بشهادة النظام');
  assert.notEqual(byDefault.ssl.rejectUnauthorized, false);
  assert.equal(byDefault.warning, null);

  assert.equal(pgSslConfig(local, {}).ssl, undefined, 'قاعدة محلية بلا TLS');
  assert.equal(pgSslConfig(remote, { PGSSL: 'disable' }).ssl, undefined, 'تعطيل TLS صريح');

  const caFile = path.join(tmpDir, 'ca.pem');
  fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
  const withCa = pgSslConfig(remote, { PGSSLROOTCERT: caFile });
  assert.equal(withCa.ssl.rejectUnauthorized, true, 'شهادة سلطة خاصة لا تُلغي التحقق');
  assert.match(withCa.ssl.ca, /BEGIN CERTIFICATE/);

  const noVerify = pgSslConfig(remote, { PGSSL: 'no-verify' });
  assert.equal(noVerify.ssl.rejectUnauthorized, false);
  assert.match(noVerify.warning, /معطّل/, 'التعطيل الصريح يُعلن نفسه بتحذير');
});

test('pgClientOptions يحمل سياسة TLS نفسها إلى عميل pg', () => {
  const options = pgClientOptions('postgres://u:p@db.example.com:5432/game', {});
  assert.equal(options.connectionString, 'postgres://u:p@db.example.com:5432/game');
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(pgClientOptions('postgres://u:p@localhost:5432/game', {}).ssl, undefined);
});
