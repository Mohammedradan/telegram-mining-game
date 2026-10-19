// طبقة تخزين اللعبة: SQLite افتراضياً (ملف data/game.db)، أو PostgreSQL عند
// ضبط DATABASE_URL (postgres://...) — نفس الواجهة غير المتزامنة للحالتين.
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');

const USER_COLUMNS = `id, name, state_json, referral_count, referral_earnings,
  referred_by, daily_last_claim, daily_streak, unacked_credits, violations,
  last_save_at, created_at, updated_at, revision, sync_json`;

const parseJson = (value, fallback) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

// جولات منجم المنصّة: نفس الشكل من السائقَين — result_json نصّ دائماً حتى يقرأه الخادم بـ JSON.parse
const runFromRow = (row) => {
  if (!row) return null;
  const raw = row.result_json;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    version: Number(row.version),
    status: String(row.status),
    result_json: raw == null || typeof raw === 'string' ? raw : JSON.stringify(raw),
    started_at: Number(row.started_at),
  };
};

function rowToUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    state: typeof row.state_json === 'string' ? JSON.parse(row.state_json) : row.state_json,
    referralCount: Number(row.referral_count) || 0,
    referralEarnings: Number(row.referral_earnings) || 0,
    referredBy: row.referred_by || null,
    dailyLastClaim: row.daily_last_claim || null,
    dailyStreak: Number(row.daily_streak) || 0,
    unackedCredits: Number(row.unacked_credits) || 0,
    violations: Number(row.violations) || 0,
    lastSaveAt: Number(row.last_save_at) || Date.now(),
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
    // رقم إصدار شامل لحالة اللاعب + دفتر مزامنة خادمي (تسوية الدخل/الطاقة وتسلسل عمليات كل جلسة)
    revision: Number(row.revision) || 0,
    sync: parseJson(row.sync_json, {}),
  };
}

function userParams(u) {
  return [
    u.id, u.name, JSON.stringify(u.state), u.referralCount || 0, u.referralEarnings || 0,
    u.referredBy || null, u.dailyLastClaim || null, u.dailyStreak || 0, u.unackedCredits || 0,
    u.violations || 0, u.lastSaveAt || Date.now(), u.createdAt || Date.now(), u.updatedAt || Date.now(),
    u.revision || 0, JSON.stringify(u.sync || {}),
  ];
}

// ترقية مخطط موجود دون لمس بيانات اللاعبين: أعمدة جديدة بقيم افتراضية فقط
const USER_SCHEMA_UPGRADES = [
  { column: 'revision', sqlite: 'INTEGER NOT NULL DEFAULT 0', pg: 'INTEGER NOT NULL DEFAULT 0' },
  { column: 'sync_json', sqlite: "TEXT NOT NULL DEFAULT '{}'", pg: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
];

const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, state_json TEXT NOT NULL,
  referral_count INTEGER NOT NULL DEFAULT 0, referral_earnings REAL NOT NULL DEFAULT 0,
  referred_by TEXT, daily_last_claim TEXT, daily_streak INTEGER NOT NULL DEFAULT 0,
  unacked_credits REAL NOT NULL DEFAULT 0, violations INTEGER NOT NULL DEFAULT 0,
  last_save_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, sync_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS pending_referrals (id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS race_stats (
  week TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
  races INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0, total_score INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL, PRIMARY KEY (week, user_id)
);
CREATE TABLE IF NOT EXISTS op_ledger (
  user_id TEXT NOT NULL, session TEXT NOT NULL, seq INTEGER NOT NULL,
  kind TEXT NOT NULL, detail_json TEXT NOT NULL, gold_delta REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, PRIMARY KEY (user_id, session, seq)
);
CREATE TABLE IF NOT EXISTS platform_runs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, version INTEGER NOT NULL,
  status TEXT NOT NULL, result_json TEXT, started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, character_type TEXT DEFAULT 'miner'
);
CREATE TABLE IF NOT EXISTS platform_daily_rewards (
  user_id TEXT NOT NULL, date TEXT NOT NULL, reward_earned REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_users_total ON users ((CAST(json_extract(state_json, '$.totalEarned') AS REAL)) DESC);
CREATE INDEX IF NOT EXISTS idx_race_stats_user ON race_stats (user_id);
CREATE INDEX IF NOT EXISTS idx_platform_runs_user ON platform_runs (user_id, status);
`;

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, state_json JSONB NOT NULL,
  referral_count INTEGER NOT NULL DEFAULT 0, referral_earnings DOUBLE PRECISION NOT NULL DEFAULT 0,
  referred_by TEXT, daily_last_claim TEXT, daily_streak INTEGER NOT NULL DEFAULT 0,
  unacked_credits DOUBLE PRECISION NOT NULL DEFAULT 0, violations INTEGER NOT NULL DEFAULT 0,
  last_save_at BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, sync_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sync_json JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS pending_referrals (id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS race_stats (
  week TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
  races INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0, total_score INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL, PRIMARY KEY (week, user_id)
);
CREATE TABLE IF NOT EXISTS op_ledger (
  user_id TEXT NOT NULL, session TEXT NOT NULL, seq BIGINT NOT NULL,
  kind TEXT NOT NULL, detail_json JSONB NOT NULL, gold_delta DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL, PRIMARY KEY (user_id, session, seq)
);
CREATE TABLE IF NOT EXISTS platform_runs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, version INTEGER NOT NULL,
  status TEXT NOT NULL, result_json TEXT, started_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL, character_type TEXT DEFAULT 'miner'
);
CREATE TABLE IF NOT EXISTS platform_daily_rewards (
  user_id TEXT NOT NULL, date TEXT NOT NULL, reward_earned DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_race_stats_user ON race_stats (user_id);
CREATE INDEX IF NOT EXISTS idx_platform_runs_user ON platform_runs (user_id, status);
`;

function createSqliteStore(file) {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('busy_timeout = 5000');
  const transactionContext = new AsyncLocalStorage();
  let transactionTail = Promise.resolve();
  conn.exec(SCHEMA_SQLITE);
  // قاعدة قديمة أُنشئت قبل أعمدة الإصدار/المزامنة: أضفها بقيمها الافتراضية (SQLite لا يدعم IF NOT EXISTS للأعمدة)
  const existing = new Set(conn.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  for (const { column, sqlite } of USER_SCHEMA_UPGRADES) {
    if (!existing.has(column)) conn.exec(`ALTER TABLE users ADD COLUMN ${column} ${sqlite}`);
  }
  const upsert = conn.prepare(`
    INSERT INTO users (${USER_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, state_json=excluded.state_json,
      referral_count=excluded.referral_count, referral_earnings=excluded.referral_earnings,
      referred_by=excluded.referred_by, daily_last_claim=excluded.daily_last_claim,
      daily_streak=excluded.daily_streak, unacked_credits=excluded.unacked_credits,
      violations=excluded.violations, last_save_at=excluded.last_save_at,
      created_at=excluded.created_at, updated_at=excluded.updated_at,
      revision=excluded.revision, sync_json=excluded.sync_json`);
  const insertLedger = conn.prepare(`INSERT OR IGNORE INTO op_ledger (user_id, session, seq, kind, detail_json, gold_delta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  return {
    driver: 'sqlite',
    // Serialize writes on this connection; BEGIN IMMEDIATE also excludes other processes.
    async withUsers(ids, work) {
      if (transactionContext.getStore()) throw new Error('Nested user transactions are not supported');
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      let begun = false;
      try {
        conn.exec('BEGIN IMMEDIATE');
        begun = true;
        const result = await transactionContext.run(true, work);
        conn.exec('COMMIT');
        begun = false;
        return result;
      } catch (error) {
        if (begun) conn.exec('ROLLBACK');
        throw error;
      } finally { release(); }
    },
    async getUser(id) { return rowToUser(conn.prepare('SELECT * FROM users WHERE id = ?').get(String(id))); },
    async putUser(u) { upsert.run(...userParams(u)); },
    // سجل دائم للعمليات المنفصلة (شراء/تعزيز/مكافأة) — يُكتب داخل معاملة اللاعب نفسها
    async appendLedger(userId, entries) {
      for (const e of entries) {
        insertLedger.run(String(userId), String(e.session), e.seq, e.kind, JSON.stringify(e.detail || {}), Number(e.goldDelta) || 0, e.at || Date.now());
      }
    },
    async ledgerFor(userId, limit = 50) {
      return conn.prepare('SELECT session, seq, kind, detail_json, gold_delta, created_at FROM op_ledger WHERE user_id = ? ORDER BY created_at DESC, seq DESC LIMIT ?')
        .all(String(userId), limit)
        .map((r) => ({ session: r.session, seq: r.seq, kind: r.kind, detail: parseJson(r.detail_json, {}), goldDelta: r.gold_delta, at: r.created_at }));
    },
    async countUsers() { return conn.prepare('SELECT COUNT(*) AS c FROM users').get().c; },
    async topUsers(limit) {
      return conn.prepare('SELECT * FROM users ORDER BY CAST(json_extract(state_json, \'$.totalEarned\') AS REAL) DESC LIMIT ?')
        .all(limit).map(rowToUser);
    },
    async recordRaceResult(week, { id, name, score, won }) {
      conn.prepare(`INSERT INTO race_stats (week, user_id, name, races, wins, best_score, total_score, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(week, user_id) DO UPDATE SET name = excluded.name,
          races = race_stats.races + 1, wins = race_stats.wins + excluded.wins,
          best_score = MAX(race_stats.best_score, excluded.best_score),
          total_score = race_stats.total_score + excluded.total_score,
          updated_at = excluded.updated_at`)
        .run(week, String(id), name || 'لاعب', won ? 1 : 0, Math.floor(score) || 0, Math.floor(score) || 0, Date.now());
    },
    // نتيجة سباق كاملة (الطرفان) في معاملة واحدة: إما يُسجَّل الفوز والخسارة معاً أو لا شيء
    async recordRaceResults(week, results) {
      return this.withUsers(results.map((r) => r.id), async () => { for (const r of results) await this.recordRaceResult(week, r); });
    },
    async raceLeaderboard(week, limit) {
      return conn.prepare(`SELECT user_id, name, races, wins, best_score, total_score FROM race_stats
        WHERE week = ? ORDER BY wins DESC, best_score DESC, total_score DESC LIMIT ?`).all(week, limit)
        .map((r) => ({ id: r.user_id, name: r.name, races: r.races, wins: r.wins, bestScore: r.best_score, totalScore: r.total_score }));
    },
    // إجمالي سباقات اللاعب عبر كل الأسابيع (نتائج ختمها الخادم — تُستخدم كإحصاء موثوق)
    async raceTotals(userId) {
      const r = conn.prepare('SELECT COALESCE(SUM(races), 0) AS races, COALESCE(SUM(wins), 0) AS wins, COALESCE(MAX(best_score), 0) AS best FROM race_stats WHERE user_id = ?').get(String(userId));
      return { races: Number(r?.races) || 0, wins: Number(r?.wins) || 0, bestScore: Number(r?.best) || 0 };
    },
    // جولة منجم المنصّة النشطة للاعب (حالة playing واحدة كحد أقصى يضمنها مسار البدء)
    async activePlatformRun(userId) {
      return runFromRow(conn.prepare(`SELECT * FROM platform_runs WHERE user_id = ? AND status = 'playing' ORDER BY started_at DESC LIMIT 1`).get(String(userId)));
    },
    async getPlatformRun(id) { return runFromRow(conn.prepare('SELECT * FROM platform_runs WHERE id = ?').get(String(id))); },
    // UPSERT يحدّث الحالة والوصل فقط: started_at (هوية زمن الجولة) لا يُلمس — إعادة الحفظ لا تُعيد شباب الجولة
    async savePlatformRun(run) {
      conn.prepare(`INSERT INTO platform_runs (id, user_id, version, status, result_json, started_at, updated_at, character_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, result_json = excluded.result_json, updated_at = excluded.updated_at, character_type = excluded.character_type`)
        .run(String(run.id), String(run.user_id), Number(run.version) || 1, String(run.status || 'playing'),
          run.result_json == null ? null : String(run.result_json), Number(run.started_at) || Date.now(), Number(run.updated_at) || Date.now(),
          String(run.character_type || 'miner'));
    },
    async getPlatformDailyReward(userId, date) {
      const row = conn.prepare('SELECT reward_earned FROM platform_daily_rewards WHERE user_id = ? AND date = ?').get(String(userId), String(date));
      return row ? Number(row.reward_earned) || 0 : 0;
    },
    async addPlatformDailyReward(userId, date, amount) {
      conn.prepare(`INSERT INTO platform_daily_rewards (user_id, date, reward_earned, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET reward_earned = reward_earned + excluded.reward_earned, updated_at = excluded.updated_at`)
        .run(String(userId), String(date), Number(amount) || 0, Date.now());
    },
    // دالة ذرية: تضيف المكافأة مع تطبيق السقف في قاعدة البيانات مباشرة
    // تُرجع المبلغ الذي أُضيف فعليًا (قد يكون أقل من المطلوب بسبب السقف)
    async addPlatformDailyRewardWithCap(userId, date, amount, cap = 10000) {
      const uid = String(userId);
      const d = String(date);
      const amt = Number(amount) || 0;
      const now = Date.now();

      // استخدام معاملة لضمان الذرية
      const transaction = conn.transaction(() => {
        // قراءة القيمة الحالية داخل المعاملة
        const row = conn.prepare('SELECT reward_earned FROM platform_daily_rewards WHERE user_id = ? AND date = ?').get(uid, d);
        const current = row ? Number(row.reward_earned) || 0 : 0;

        // حساب المبلغ الذي يمكن إضافته
        const remaining = cap - current;
        const toAdd = Math.min(amt, remaining);

        if (toAdd <= 0) {
          return 0; // لا شيء يمكن إضافته
        }

        // UPDATE أو INSERT
        if (row) {
          conn.prepare(
            `UPDATE platform_daily_rewards
             SET reward_earned = reward_earned + ?, updated_at = ?
             WHERE user_id = ? AND date = ?`
          ).run(toAdd, now, uid, d);
        } else {
          conn.prepare(
            `INSERT INTO platform_daily_rewards (user_id, date, reward_earned, updated_at)
             VALUES (?, ?, ?, ?)`
          ).run(uid, d, toAdd, now);
        }

        return toAdd;
      });

      return transaction();
    },
    async getPending(id) { return conn.prepare('SELECT count FROM pending_referrals WHERE id = ?').get(String(id))?.count || 0; },
    async addPending(id) {
      conn.prepare(`INSERT INTO pending_referrals (id, count) VALUES (?, 1)
        ON CONFLICT(id) DO UPDATE SET count = count + 1`).run(String(id));
    },
    async clearPending(id) { conn.prepare('DELETE FROM pending_referrals WHERE id = ?').run(String(id)); },
    async setPending(id, count) {
      if (count > 0) conn.prepare('INSERT INTO pending_referrals (id, count) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET count = excluded.count').run(String(id), count);
    },
    async close() { conn.close(); },
  };
}

function createPgStore(url) {
  const { Pool } = require('pg');
  // اتصالات داخلية (localhost أو شبكة Render الداخلية) بلا SSL، وغيرها بـ SSL كما تفرضه السحابة
  const isLocal = /localhost|127\.0\.0\.1|\.internal\b/.test(url);
  const pool = new Pool({
    connectionString: url,
    ssl: !isLocal && process.env.PGSSL !== 'disable' ? { rejectUnauthorized: false } : undefined,
  });
  const ready = pool.query(SCHEMA_PG);
  const transactionContext = new AsyncLocalStorage();
  const q = async (sql, params) => { await ready; return (transactionContext.getStore() || pool).query(sql, params); };
  const placeholders = USER_COLUMNS.split(',').map((_, i) => `$${i + 1}`).join(',');
  return {
    driver: 'postgres',
    async withUsers(ids, work) {
      if (transactionContext.getStore()) throw new Error('Nested user transactions are not supported');
      await ready;
      const client = await pool.connect();
      let begun = false;
      try {
        await client.query('BEGIN');
        begun = true;
        // Stable order prevents referral/user lock inversion, including for absent rows.
        for (const id of [...new Set(ids.map(String))].sort()) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`mining:user:${id}`]);
        }
        const result = await transactionContext.run(client, work);
        await client.query('COMMIT');
        begun = false;
        return result;
      } catch (error) {
        if (begun) await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async getUser(id) { return rowToUser((await q('SELECT * FROM users WHERE id = $1', [String(id)])).rows[0]); },
    async putUser(u) {
      await q(`INSERT INTO users (${USER_COLUMNS}) VALUES (${placeholders})
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, state_json=EXCLUDED.state_json,
          referral_count=EXCLUDED.referral_count, referral_earnings=EXCLUDED.referral_earnings,
          referred_by=EXCLUDED.referred_by, daily_last_claim=EXCLUDED.daily_last_claim,
          daily_streak=EXCLUDED.daily_streak, unacked_credits=EXCLUDED.unacked_credits,
          violations=EXCLUDED.violations, last_save_at=EXCLUDED.last_save_at,
          created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at,
          revision=EXCLUDED.revision, sync_json=EXCLUDED.sync_json`, userParams(u));
    },
    async appendLedger(userId, entries) {
      for (const e of entries) {
        await q(`INSERT INTO op_ledger (user_id, session, seq, kind, detail_json, gold_delta, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (user_id, session, seq) DO NOTHING`,
        [String(userId), String(e.session), e.seq, e.kind, JSON.stringify(e.detail || {}), Number(e.goldDelta) || 0, e.at || Date.now()]);
      }
    },
    async ledgerFor(userId, limit = 50) {
      return (await q('SELECT session, seq, kind, detail_json, gold_delta, created_at FROM op_ledger WHERE user_id = $1 ORDER BY created_at DESC, seq DESC LIMIT $2', [String(userId), limit])).rows
        .map((r) => ({ session: r.session, seq: Number(r.seq), kind: r.kind, detail: parseJson(r.detail_json, {}), goldDelta: Number(r.gold_delta), at: Number(r.created_at) }));
    },
    async countUsers() { return Number((await q('SELECT COUNT(*) AS c FROM users')).rows[0].c); },
    async topUsers(limit) {
      return (await q("SELECT * FROM users ORDER BY (state_json->>'totalEarned')::double precision DESC LIMIT $1", [limit])).rows.map(rowToUser);
    },
    async getPending(id) { return Number((await q('SELECT count FROM pending_referrals WHERE id = $1', [String(id)])).rows[0]?.count || 0); },
    async addPending(id) {
      await q(`INSERT INTO pending_referrals (id, count) VALUES ($1, 1)
        ON CONFLICT(id) DO UPDATE SET count = pending_referrals.count + 1`, [String(id)]);
    },
    async clearPending(id) { await q('DELETE FROM pending_referrals WHERE id = $1', [String(id)]); },
    async setPending(id, count) {
      if (count > 0) await q('INSERT INTO pending_referrals (id, count) VALUES ($1, $2) ON CONFLICT(id) DO UPDATE SET count = EXCLUDED.count', [String(id), count]);
    },
    async recordRaceResult(week, { id, name, score, won }) {
      await q(`INSERT INTO race_stats (week, user_id, name, races, wins, best_score, total_score, updated_at)
        VALUES ($1, $2, $3, 1, $4, $5, $5, $6)
        ON CONFLICT(week, user_id) DO UPDATE SET name = EXCLUDED.name,
          races = race_stats.races + 1, wins = race_stats.wins + EXCLUDED.wins,
          best_score = GREATEST(race_stats.best_score, EXCLUDED.best_score),
          total_score = race_stats.total_score + EXCLUDED.total_score,
          updated_at = EXCLUDED.updated_at`,
      [week, String(id), name || 'لاعب', won ? 1 : 0, Math.floor(score) || 0, Date.now()]);
    },
    async recordRaceResults(week, results) {
      return this.withUsers(results.map((r) => r.id), async () => { for (const r of results) await this.recordRaceResult(week, r); });
    },
    async raceLeaderboard(week, limit) {
      return (await q(`SELECT user_id, name, races, wins, best_score, total_score FROM race_stats
        WHERE week = $1 ORDER BY wins DESC, best_score DESC, total_score DESC LIMIT $2`, [week, limit])).rows
        .map((r) => ({ id: r.user_id, name: r.name, races: Number(r.races), wins: Number(r.wins), bestScore: Number(r.best_score), totalScore: Number(r.total_score) }));
    },
    async raceTotals(userId) {
      const r = (await q('SELECT COALESCE(SUM(races), 0) AS races, COALESCE(SUM(wins), 0) AS wins, COALESCE(MAX(best_score), 0) AS best FROM race_stats WHERE user_id = $1', [String(userId)])).rows[0];
      return { races: Number(r?.races) || 0, wins: Number(r?.wins) || 0, bestScore: Number(r?.best) || 0 };
    },
    // جولة منجم المنصّة النشطة للاعب — الاستعلام داخل معاملة اللاعب عبر q() كما في بقية العمليات
    async activePlatformRun(userId) {
      return runFromRow((await q(`SELECT * FROM platform_runs WHERE user_id = $1 AND status = 'playing' ORDER BY started_at DESC LIMIT 1`, [String(userId)])).rows[0]);
    },
    async getPlatformRun(id) { return runFromRow((await q('SELECT * FROM platform_runs WHERE id = $1', [String(id)])).rows[0]); },
    // UPSERT يحدّث الحالة والوصل فقط: started_at (هوية زمن الجولة) لا يُلمس — إعادة الحفظ لا تُعيد شباب الجولة
    async savePlatformRun(run) {
      await q(`INSERT INTO platform_runs (id, user_id, version, status, result_json, started_at, updated_at, character_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(id) DO UPDATE SET status = EXCLUDED.status, result_json = EXCLUDED.result_json, updated_at = EXCLUDED.updated_at, character_type = EXCLUDED.character_type`,
      [String(run.id), String(run.user_id), Number(run.version) || 1, String(run.status || 'playing'),
        run.result_json == null ? null : String(run.result_json), Number(run.started_at) || Date.now(), Number(run.updated_at) || Date.now(),
        String(run.character_type || 'miner')]);
    },
    async getPlatformDailyReward(userId, date) {
      const r = (await q('SELECT reward_earned FROM platform_daily_rewards WHERE user_id = $1 AND date = $2', [String(userId), String(date)])).rows[0];
      return r ? Number(r.reward_earned) || 0 : 0;
    },
    async addPlatformDailyReward(userId, date, amount) {
      await q(`INSERT INTO platform_daily_rewards (user_id, date, reward_earned, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(user_id, date) DO UPDATE SET reward_earned = platform_daily_rewards.reward_earned + EXCLUDED.reward_earned, updated_at = EXCLUDED.updated_at`,
      [String(userId), String(date), Number(amount) || 0, Date.now()]);
    },
    // دالة ذرية: تضيف المكافأة مع تطبيق السقف في قاعدة البيانات مباشرة
    // تُرجع المبلغ الذي أُضيف فعليًا (قد يكون أقل من المطلوب بسبب السقف)
    async addPlatformDailyRewardWithCap(userId, date, amount, cap = 10000) {
      const uid = String(userId);
      const d = String(date);
      const amt = Number(amount) || 0;
      const now = Date.now();

      // التحقق من وجود معاملة حالية (من withUsers)
      const txClient = transactionContext.getStore();

      if (txClient) {
        // داخل معاملة، نستخدم الـ client الموجود
        const r = await txClient.query(
          'SELECT reward_earned FROM platform_daily_rewards WHERE user_id = $1 AND date = $2 FOR UPDATE',
          [uid, d]
        );
        const current = r.rows.length > 0 ? Number(r.rows[0].reward_earned) || 0 : 0;
        const remaining = cap - current;
        const toAdd = Math.min(amt, remaining);

        if (toAdd <= 0) return 0;

        if (r.rows.length > 0) {
          await txClient.query(
            'UPDATE platform_daily_rewards SET reward_earned = reward_earned + $1, updated_at = $2 WHERE user_id = $3 AND date = $4',
            [toAdd, now, uid, d]
          );
        } else {
          await txClient.query(
            'INSERT INTO platform_daily_rewards (user_id, date, reward_earned, updated_at) VALUES ($1, $2, $3, $4)',
            [uid, d, toAdd, now]
          );
        }
        return toAdd;
      }

      // خارج معاملة، ننشئ معاملة جديدة
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query(
          'SELECT reward_earned FROM platform_daily_rewards WHERE user_id = $1 AND date = $2 FOR UPDATE',
          [uid, d]
        );
        const current = r.rows.length > 0 ? Number(r.rows[0].reward_earned) || 0 : 0;
        const remaining = cap - current;
        const toAdd = Math.min(amt, remaining);

        if (toAdd <= 0) {
          await client.query('ROLLBACK');
          return 0;
        }

        if (r.rows.length > 0) {
          await client.query(
            'UPDATE platform_daily_rewards SET reward_earned = reward_earned + $1, updated_at = $2 WHERE user_id = $3 AND date = $4',
            [toAdd, now, uid, d]
          );
        } else {
          await client.query(
            'INSERT INTO platform_daily_rewards (user_id, date, reward_earned, updated_at) VALUES ($1, $2, $3, $4)',
            [uid, d, toAdd, now]
          );
        }

        await client.query('COMMIT');
        return toAdd;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}

function createStore() {
  const url = process.env.DATABASE_URL || '';
  const isProduction = process.env.NODE_ENV === 'production';

  // في الإنتاج، يجب استخدام PostgreSQL (إلا في الاختبارات)
  if (isProduction) {
    // السماح بـ sqlite:memory للاختبارات فقط
    if (url === 'sqlite:memory' && process.env.SKIP_PRODUCTION_CHECK === 'true') {
      console.log('🗄️  قاعدة البيانات: SQLite in-memory (اختبار إنتاجي)');
      return createSqliteStore(':memory:');
    }
    if (!url || !/^postgres(ql)?:\/\//.test(url)) {
      console.error('❌ خطأ إنتاجي: DATABASE_URL مطلوب ويجب أن يكون رابط PostgreSQL في وضع الإنتاج.');
      console.error('❌ SQLite غير مسموح في الإنتاج بسبب فقدان البيانات عند إعادة النشر.');
      process.exit(1);
    }
    console.log('🗄️  قاعدة البيانات: PostgreSQL (الإنتاج)');
    return createPgStore(url);
  }

  // في التطوير، يمكن استخدام SQLite أو PostgreSQL
  if (/^postgres(ql)?:\/\//.test(url)) {
    console.log('🗄️  قاعدة البيانات: PostgreSQL (التطوير)');
    return createPgStore(url);
  }
  const file = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'game.db');
  console.log(`🗄️  قاعدة البيانات: SQLite (${file}) - للتطوير فقط`);
  return createSqliteStore(file);
}

module.exports = { createStore };
