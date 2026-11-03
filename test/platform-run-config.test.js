// المرحلة 3: عمود config_json (لقطة المنجم والمعدات) يُرقَّى في قواعد قديمة دون فقد جولاتها، ولا يتغير بعد الإنشاء.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createStore } = require('../db');

function openStore({ file = '', url = '' } = {}) {
  const old = { file: process.env.DATABASE_FILE, url: process.env.DATABASE_URL };
  process.env.DATABASE_FILE = file; process.env.DATABASE_URL = url;
  try { return createStore(); } finally {
    for (const [key, value] of [['DATABASE_FILE', old.file], ['DATABASE_URL', old.url]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
const configA = JSON.stringify({ zone: 2, loadout: { pickaxe: 1 } });
const configB = JSON.stringify({ zone: 5, loadout: { pickaxe: 5 } });

async function exerciseConfigColumn(store, prefix) {
  const user = `${prefix}_user`, id = `${prefix}-${crypto.randomUUID()}`, started = Date.now() - 5000;
  await store.withUsers([user], async () => {
    await store.savePlatformRun({ id, user_id: user, version: 4, status: 'playing', started_at: started, updated_at: started, config_json: configA });
  });
  const stored = await store.getPlatformRun(id);
  assert.equal(stored.config_json, configA);
  assert.deepEqual(JSON.parse((await store.activePlatformRun(user)).config_json), { zone: 2, loadout: { pickaxe: 1 } });
  // الحفظ التالي يحدّث الحالة والنتيجة فقط: لا الإعداد ولا زمن البدء
  await store.withUsers([user], async () => {
    await store.savePlatformRun({ ...stored, status: 'finished', result_json: '{"ok":true}', updated_at: Date.now(), started_at: started + 99, config_json: configB });
  });
  const after = await store.getPlatformRun(id);
  assert.equal(after.status, 'finished'); assert.equal(after.result_json, '{"ok":true}');
  assert.equal(after.config_json, configA, 'the snapshot is immutable once the run exists');
  assert.equal(after.started_at, started, 'and so is the start time');
  // جولة بلا إعداد (ما قبل المرحلة 3) تقرأ null
  const bare = `${prefix}-bare-${crypto.randomUUID()}`;
  await store.withUsers([user], () => store.savePlatformRun({ id: bare, user_id: user, version: 3, status: 'playing', started_at: started, updated_at: started }));
  assert.equal((await store.getPlatformRun(bare)).config_json, null);
}

test('sqlite: an old platform_runs table without config_json is upgraded in place and keeps its rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-runcfg-'));
  const file = path.join(dir, 'game.db');
  try {
    const Database = require('better-sqlite3');
    const old = new Database(file);
    old.exec(`CREATE TABLE platform_runs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, version INTEGER NOT NULL,
      status TEXT NOT NULL, result_json TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );`);
    old.prepare('INSERT INTO platform_runs VALUES (?,?,?,?,?,?,?)').run('legacy-run', 'old_user', 3, 'playing', null, 1000, 1000);
    old.close();

    const store = openStore({ file });
    const probe = new Database(file, { readonly: true });
    const columns = probe.prepare('PRAGMA table_info(platform_runs)').all().map(c => c.name);
    probe.close();
    assert.ok(columns.includes('config_json'), 'the column was added');
    const legacy = await store.getPlatformRun('legacy-run');
    assert.equal(legacy.id, 'legacy-run'); assert.equal(legacy.version, 3); assert.equal(legacy.config_json, null);
    assert.equal((await store.activePlatformRun('old_user')).id, 'legacy-run');
    await exerciseConfigColumn(store, 'sqlite');
    await store.close();

    const again = openStore({ file }); // الترقية قابلة للتكرار
    assert.equal((await again.getPlatformRun('legacy-run')).config_json, null);
    await again.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sqlite: a fresh database has the column from the start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-runcfg-fresh-'));
  try {
    const store = openStore({ file: path.join(dir, 'game.db') });
    await exerciseConfigColumn(store, 'fresh');
    await store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('postgres: config_json is stored, returned and immutable (runs only when TEST_DATABASE_URL is set)', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const store = openStore({ url: process.env.TEST_DATABASE_URL });
  try { await exerciseConfigColumn(store, `pg_${process.pid}_${Date.now()}`); } finally { await store.close(); }
});
