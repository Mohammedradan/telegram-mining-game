const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const RAW_TOKEN = (process.env.BOT_TOKEN || '').trim();
const PLACEHOLDER = 'ضع_هنا_التوكن_الخاص_بك_من_BotFather';
const BOT_TOKEN = RAW_TOKEN && RAW_TOKEN !== PLACEHOLDER ? RAW_TOKEN : '';
// وضع الضيف (حفظ بدون تيليجرام) يعمل تلقائياً عند غياب التوكن، ويمكن تفعيله صراحةً
const ALLOW_GUEST = !BOT_TOKEN || process.env.ALLOW_GUEST_AUTH === 'true';
const REFERRAL_REWARD = 1000;

// ---------------------------------------------------------------------------
// مخزن بيانات بسيط بملف JSON (مناسب للنسخة التجريبية — انظر README للترقية)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultState = () => ({
  gold: 0,
  totalEarned: 0,
  clickPower: 1,
  passiveIncome: 0,
  energy: 1000,
  maxEnergy: 1000,
  owned: { click: 0, bot: 0, rig: 0 },
  costs: { click: 50, bot: 200, rig: 1000 },
  boostUntil: 0,
  boostCooldownUntil: 0,
  lastSeen: Date.now(),
});

let db = { users: {}, pendingReferrals: {} };
try {
  if (fs.existsSync(DB_FILE)) db = { users: {}, pendingReferrals: {}, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
} catch (e) {
  console.error('⚠️  ملف البيانات تالف، نبدأ بقاعدة فارغة:', e.message);
  db = { users: {}, pendingReferrals: {} };
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.error('خطأ حفظ البيانات:', e.message); }
  }, 200);
}

const clampNum = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function sanitizeState(input, base = defaultState()) {
  const s = (input && typeof input === 'object') ? input : {};
  const o = (s.owned && typeof s.owned === 'object') ? s.owned : {};
  const c = (s.costs && typeof s.costs === 'object') ? s.costs : {};
  const maxEnergy = clampNum(s.maxEnergy, 100, 10_000_000, base.maxEnergy);
  return {
    gold: clampNum(s.gold, 0, 1e12, base.gold),
    totalEarned: clampNum(s.totalEarned, 0, 1e12, base.totalEarned),
    clickPower: clampNum(s.clickPower, 1, 100_000, base.clickPower),
    passiveIncome: clampNum(s.passiveIncome, 0, 1e9, base.passiveIncome),
    energy: clampNum(s.energy, 0, maxEnergy, base.energy),
    maxEnergy,
    owned: {
      click: Math.floor(clampNum(o.click, 0, 1e6, base.owned.click)),
      bot: Math.floor(clampNum(o.bot, 0, 1e6, base.owned.bot)),
      rig: Math.floor(clampNum(o.rig, 0, 1e6, base.owned.rig)),
    },
    costs: {
      click: clampNum(c.click, 1, 1e12, base.costs.click),
      bot: clampNum(c.bot, 1, 1e12, base.costs.bot),
      rig: clampNum(c.rig, 1, 1e12, base.costs.rig),
    },
    boostUntil: clampNum(s.boostUntil, 0, Date.now() + 24 * 3600e3, 0),
    boostCooldownUntil: clampNum(s.boostCooldownUntil, 0, Date.now() + 24 * 3600e3, 0),
    lastSeen: Date.now(),
  };
}

const dayStr = (d = new Date()) => d.toISOString().slice(0, 10);
const levelOf = (totalEarned) => Math.floor(totalEarned / 5000) + 1;

function dailyInfo(user) {
  const today = dayStr();
  const yesterday = dayStr(new Date(Date.now() - 86400e3));
  const canClaim = user.dailyLastClaim !== today;
  const nextStreak = !canClaim ? user.dailyStreak : (user.dailyLastClaim === yesterday ? user.dailyStreak + 1 : 1);
  return { canClaim, streak: canClaim ? nextStreak : user.dailyStreak, reward: Math.min(1500, 500 + (nextStreak - 1) * 100), today };
}

function createUser(id, name) {
  const user = {
    id: String(id),
    name: name || 'معدّن أسطوري',
    state: defaultState(),
    referralCount: 0,
    referralEarnings: 0,
    referredBy: null,
    dailyLastClaim: null,
    dailyStreak: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // مكافآت دعوات وصلت قبل أن يفتح الداعي اللعبة أول مرة
  const pending = db.pendingReferrals[user.id] || 0;
  if (pending > 0) {
    user.state.gold += pending * REFERRAL_REWARD;
    user.state.totalEarned += pending * REFERRAL_REWARD;
    user.referralCount += pending;
    user.referralEarnings += pending * REFERRAL_REWARD;
    delete db.pendingReferrals[user.id];
  }
  db.users[user.id] = user;
  return user;
}

function profileOf(user, isNew = false) {
  return {
    user: { id: user.id, name: user.name },
    state: user.state,
    referralCount: user.referralCount,
    referralEarnings: user.referralEarnings,
    referredBy: user.referredBy,
    daily: dailyInfo(user),
    isNew,
    serverTime: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// مصادقة Telegram WebApp (initData) + وضع ضيف للتطوير
// ---------------------------------------------------------------------------
function validateInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computed = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  const a = Buffer.from(computed); const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null; // أقدم من 24 ساعة
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

function parseInitDataUser(initData) { // بدون توكن لا يمكن التحقق — للتطوير فقط
  try { return JSON.parse(new URLSearchParams(initData).get('user') || 'null'); } catch { return null; }
}

function requireAuth(req, res, next) {
  const initData = req.get('x-telegram-init-data') || (req.get('authorization') || '').replace(/^tma\s+/i, '');
  if (initData) {
    const tgUser = BOT_TOKEN ? validateInitData(initData) : parseInitDataUser(initData);
    if (!tgUser?.id) return res.status(401).json({ error: 'بيانات تيليجرام غير صالحة أو منتهية — أعد فتح اللعبة من البوت' });
    req.player = { id: String(tgUser.id), name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'معدّن أسطوري' };
    return next();
  }
  const guestId = (req.get('x-guest-id') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (guestId && ALLOW_GUEST) {
    req.player = { id: `guest_${guestId}`, name: 'ضيف' };
    return next();
  }
  return res.status(401).json({ error: BOT_TOKEN ? 'افتح اللعبة من داخل تيليجرام' : 'مصادقة مفقودة' });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true, bot: Boolean(BOT_TOKEN), users: Object.keys(db.users).length }));

// جلب/إنشاء ملف اللاعب — يعالج الدعوات عند أول دخول (?ref=ref_<id>)
app.get('/api/me', requireAuth, (req, res) => {
  let user = db.users[req.player.id];
  let isNew = false;
  if (!user) {
    user = createUser(req.player.id, req.player.name);
    isNew = true;
    const refId = String(req.query.ref || '').replace(/^ref_/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (refId && refId !== user.id) {
      user.referredBy = refId;
      const inviter = db.users[refId];
      if (inviter) {
        inviter.state.gold += REFERRAL_REWARD;
        inviter.state.totalEarned += REFERRAL_REWARD;
        inviter.referralCount += 1;
        inviter.referralEarnings += REFERRAL_REWARD;
        inviter.updatedAt = Date.now();
      } else {
        db.pendingReferrals[refId] = (db.pendingReferrals[refId] || 0) + 1;
      }
    }
    persist();
  } else if (req.player.name && user.name !== req.player.name && req.player.name !== 'ضيف') {
    user.name = req.player.name;
  }
  res.json(profileOf(user, isNew));
});

app.post('/api/save', requireAuth, (req, res) => {
  const user = db.users[req.player.id] || createUser(req.player.id, req.player.name);
  user.state = sanitizeState(req.body?.state, user.state);
  user.updatedAt = Date.now();
  persist();
  res.json({ ok: true, serverTime: Date.now() });
});

app.post('/api/claim-daily', requireAuth, (req, res) => {
  const user = db.users[req.player.id] || createUser(req.player.id, req.player.name);
  const info = dailyInfo(user);
  if (!info.canClaim) return res.status(409).json({ error: 'استلمت مكافأة اليوم — عُد غداً!', daily: info });
  user.dailyStreak = info.streak;
  user.dailyLastClaim = info.today;
  user.state.gold += info.reward;
  user.state.totalEarned += info.reward;
  user.updatedAt = Date.now();
  persist();
  res.json({ ok: true, reward: info.reward, state: user.state, daily: dailyInfo(user) });
});

app.get('/api/leaderboard', (req, res) => {
  const top = Object.values(db.users)
    .sort((a, b) => b.state.totalEarned - a.state.totalEarned)
    .slice(0, 20)
    .map((u, i) => ({
      rank: i + 1,
      id: u.id,
      name: u.name,
      gold: Math.floor(u.state.gold),
      totalEarned: Math.floor(u.state.totalEarned),
      level: levelOf(u.state.totalEarned),
    }));
  res.json({ leaderboard: top });
});

// ---------------------------------------------------------------------------
// بوت تيليجرام
// ---------------------------------------------------------------------------
let bot = null;
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    const appUrl = process.env.APP_URL || 'https://your-domain.com';
    const startPayload = ctx.startPayload || '';
    const isRef = startPayload.startsWith('ref_');

    return ctx.replyWithMarkdown(
      `⛏️ *مرحباً بك في إمبراطورية التعدين!*${isRef ? '\n🎁 انضممت عبر رابط دعوة — سيحصل صديقك على 1,000 🪙 عند فتحك اللعبة!' : ''}\n\nاضغط على الزر أدناه لبدء التعدين وجمع العملات 💰`,
      Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 فتح اللعبة الآن', appUrl)],
      ])
    );
  });

  bot.catch((err, ctx) => {
    console.error(`خطأ في البوت لتحديث ${ctx?.updateType}:`, err);
  });

  // لا نترك فشل إطلاق البوت (توكن خاطئ/شبكة) يُسقط خادم اللعبة
  bot.launch()
    .then(() => console.log('🤖 تم تشغيل بوت تيليجرام بنجاح!'))
    .catch((err) => console.error('خطأ في تشغيل البوت (سيستمر خادم الويب):', err.message));

  const shutdown = (signal) => { try { bot.stop(signal); } catch (_) { /* already stopped */ } };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
} else {
  console.log('⚠️  لم يتم وضع BOT_TOKEN (انسخ .env.example إلى .env)، سيعمل خادم الويب فقط بوضع الضيف.');
}

app.listen(PORT, HOST, () => {
  console.log(`🎮 خادم اللعبة يعمل الآن على: http://localhost:${PORT}`);
});
