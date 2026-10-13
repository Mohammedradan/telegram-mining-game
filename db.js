// طبقة تخزين اللعبة: SQLite افتراضياً (ملف data/game.db)، أو PostgreSQL عند
// ضبط DATABASE_URL (postgres://...) — نفس الواجهة غير المتزامنة للحالتين.
const fs = require('fs');
const path = require('path');

const USER_COLUMNS = `id, name, state_json, referral_count, referral_earnings,
  referred_by, daily_last_claim, daily_streak, unacked_credits, violations,
  last_save_at, created_at, updated_at`;

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
  };
}

function userParams(u) {
  return [
    u.id, u.name, JSON.stringify(u.state), u.referralCount || 0, u.referralEarnings || 0,
    u.referredBy || null, u.dailyLastClaim || null, u.dailyStreak || 0, u.unackedCredits || 0,
    u.violations || 0, u.lastSaveAt || Date.now(), u.createdAt || Date.now(), u.updatedAt || Date.now(),
  ];
}

const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, state_json TEXT NOT NULL,
  referral_count INTEGER NOT NULL DEFAULT 0, referral_earnings REAL NOT NULL DEFAULT 0,
  referred_by TEXT, daily_last_claim TEXT, daily_streak INTEGER NOT NULL DEFAULT 0,
  unacked_credits REAL NOT NULL DEFAULT 0, violations INTEGER NOT NULL DEFAULT 0,
  last_save_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_referrals (id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS race_stats (
  week TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
  races INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0, total_score INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL, PRIMARY KEY (week, user_id)
);
CREATE INDEX IF NOT EXISTS idx_users_total ON users ((CAST(json_extract(state_json, '$.totalEarned') AS REAL)) DESC);
`;

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, state_json JSONB NOT NULL,
  referral_count INTEGER NOT NULL DEFAULT 0, referral_earnings DOUBLE PRECISION NOT NULL DEFAULT 0,
  referred_by TEXT, daily_last_claim TEXT, daily_streak INTEGER NOT NULL DEFAULT 0,
  unacked_credits DOUBLE PRECISION NOT NULL DEFAULT 0, violations INTEGER NOT NULL DEFAULT 0,
  last_save_at BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_referrals (id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS race_stats (
  week TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
  races INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0, total_score INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL, PRIMARY KEY (week, user_id)
);
`;

function createSqliteStore(file) {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.exec(SCHEMA_SQLITE);
  const upsert = conn.prepare(`
    INSERT INTO users (${USER_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, state_json=excluded.state_json,
      referral_count=excluded.referral_count, referral_earnings=excluded.referral_earnings,
      referred_by=excluded.referred_by, daily_last_claim=excluded.daily_last_claim,
      daily_streak=excluded.daily_streak, unacked_credits=excluded.unacked_credits,
      violations=excluded.violations, last_save_at=excluded.last_save_at,
      created_at=excluded.created_at, updated_at=excluded.updated_at`);
  return {
    driver: 'sqlite',
    async getUser(id) { return rowToUser(conn.prepare('SELECT * FROM users WHERE id = ?').get(String(id))); },
    async putUser(u) { upsert.run(...userParams(u)); },
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
    async raceLeaderboard(week, limit) {
      return conn.prepare(`SELECT user_id, name, races, wins, best_score, total_score FROM race_stats
        WHERE week = ? ORDER BY wins DESC, best_score DESC, total_score DESC LIMIT ?`).all(week, limit)
        .map((r) => ({ id: r.user_id, name: r.name, races: r.races, wins: r.wins, bestScore: r.best_score, totalScore: r.total_score }));
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
  const q = async (sql, params) => { await ready; return pool.query(sql, params); };
  const placeholders = USER_COLUMNS.split(',').map((_, i) => `$${i + 1}`).join(',');
  return {
    driver: 'postgres',
    async getUser(id) { return rowToUser((await q('SELECT * FROM users WHERE id = $1', [String(id)])).rows[0]); },
    async putUser(u) {
      await q(`INSERT INTO users (${USER_COLUMNS}) VALUES (${placeholders})
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, state_json=EXCLUDED.state_json,
          referral_count=EXCLUDED.referral_count, referral_earnings=EXCLUDED.referral_earnings,
          referred_by=EXCLUDED.referred_by, daily_last_claim=EXCLUDED.daily_last_claim,
          daily_streak=EXCLUDED.daily_streak, unacked_credits=EXCLUDED.unacked_credits,
          violations=EXCLUDED.violations, last_save_at=EXCLUDED.last_save_at,
          created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at`, userParams(u));
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
    async raceLeaderboard(week, limit) {
      return (await q(`SELECT user_id, name, races, wins, best_score, total_score FROM race_stats
        WHERE week = $1 ORDER BY wins DESC, best_score DESC, total_score DESC LIMIT $2`, [week, limit])).rows
        .map((r) => ({ id: r.user_id, name: r.name, races: Number(r.races), wins: Number(r.wins), bestScore: Number(r.best_score), totalScore: Number(r.total_score) }));
    },
    async close() { await pool.end(); },
  };
}

function createStore() {
  const url = process.env.DATABASE_URL || '';
  if (/^postgres(ql)?:\/\//.test(url)) {
    console.log('🗄️  قاعدة البيانات: PostgreSQL');
    return createPgStore(url);
  }
  const file = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'game.db');
  console.log(`🗄️  قاعدة البيانات: SQLite (${file})`);
  return createSqliteStore(file);
}

module.exports = { createStore };
