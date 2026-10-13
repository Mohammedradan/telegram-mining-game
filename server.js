const express = require('express');
const { Telegraf, Markup } = require('telegraf');
// مكتبة السباقات اختيارية التشغيل: غيابها يعطّل السباقات فقط ولا يُسقط اللعبة
let WebSocketServer = null;
try { ({ WebSocketServer } = require('ws')); } catch (_) { console.warn('⚠️  مكتبة ws غير مثبّتة — السباقات المباشرة معطّلة (شغّل: npm install)'); }
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createStore } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const RAW_TOKEN = (process.env.BOT_TOKEN || '').trim();
const PLACEHOLDER = 'ضع_هنا_التوكن_الخاص_بك_من_BotFather';
const BOT_TOKEN = RAW_TOKEN && RAW_TOKEN !== PLACEHOLDER ? RAW_TOKEN : '';
// وضع الضيف (حفظ بدون تيليجرام) يعمل تلقائياً عند غياب التوكن، ويمكن تفعيله صراحةً
const ALLOW_GUEST = !BOT_TOKEN || process.env.ALLOW_GUEST_AUTH === 'true';
const REFERRAL_REWARD = 1000;

// إعدادات مكافحة الغش الخادمية (قابلة للضبط من البيئة)
const MAX_CLICKS_PER_SEC = Number(process.env.MAX_CLICKS_PER_SEC || 20); // نقرات بشرية/لمس متعدد كحد أقصى معقول
const ENERGY_REGEN_PER_SEC = 3;
const OFFLINE_CAP_SEC = 8 * 3600;
const GAIN_SLACK = 10; // هامش تقريب بسيط لكل حفظ

const store = createStore();

// ---------------------------------------------------------------------------
// حالة اللعبة الافتراضية + تعقيم المدخلات
// ---------------------------------------------------------------------------
const defaultState = () => ({
  gold: 0,
  totalEarned: 0,
  clickPower: 1,
  passiveIncome: 0,
  energy: 1000,
  maxEnergy: 1000,
  owned: { click: 0, bot: 0, rig: 0 },
  costs: { click: 50, bot: 200, rig: 1000 },
  adventureUpgrades: { magnet: 0, cart: 0, speed: 0, shield: 0, heart: 0, clock: 0, luck: 0, skill: 0 },
  boostUntil: 0,
  boostCooldownUntil: 0,
  lastSeen: Date.now(),
});

const clampNum = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function sanitizeState(input, base = defaultState()) {
  const s = (input && typeof input === 'object') ? input : {};
  const o = (s.owned && typeof s.owned === 'object') ? s.owned : {};
  const au = (s.adventureUpgrades && typeof s.adventureUpgrades === 'object') ? s.adventureUpgrades : {};
  const c = (s.costs && typeof s.costs === 'object') ? s.costs : {};
  const maxEnergy = 1000; // ثابت في تصميم اللعبة الحالي — لا نقبل تغييره من العميل
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
    adventureUpgrades: Object.fromEntries(
      Object.keys(ADV_UPGRADES_DEF).map((k) => [k, Math.floor(clampNum(au[k], 0, ADV_UPGRADES_DEF[k].max, base.adventureUpgrades?.[k] || 0))])
    ),
    boostUntil: clampNum(s.boostUntil, 0, Date.now() + 24 * 3600e3, 0),
    boostCooldownUntil: clampNum(s.boostCooldownUntil, 0, Date.now() + 24 * 3600e3, 0),
    lastSeen: Date.now(),
  };
}

// الأسعار والقدرات مشتقة حتمياً من عدد المشتريات — لا نثق بقيم العميل
const UPGRADES_DEF = {
  click: { base: 50, growth: 1.5 },
  bot: { base: 200, growth: 1.4 },
  rig: { base: 1000, growth: 1.3 },
};
function costFor(type, ownedCount) {
  let c = UPGRADES_DEF[type].base;
  for (let i = 0; i < ownedCount; i++) c = Math.floor(c * UPGRADES_DEF[type].growth);
  return c;
}
function spendBetween(type, from, to) {
  let c = costFor(type, from);
  let total = 0;
  for (let i = from; i < to; i++) { total += c; c = Math.floor(c * UPGRADES_DEF[type].growth); }
  return total;
}

// ترقيات المغامرة الدائمة — الأسعار تُحسب خادمياً (يجب أن تطابق الواجهة)
const ADV_UPGRADES_DEF = {
  magnet: { base: 150, growth: 1.7, max: 5 },
  cart: { base: 200, growth: 1.7, max: 5 },
  speed: { base: 150, growth: 1.6, max: 5 },
  shield: { base: 250, growth: 1.8, max: 3 },
  heart: { base: 300, growth: 1.8, max: 3 },
  clock: { base: 150, growth: 1.6, max: 5 },
  luck: { base: 200, growth: 1.7, max: 5 },
  skill: { base: 250, growth: 1.8, max: 3 },
};
function advCostFor(key, level) {
  let c = ADV_UPGRADES_DEF[key].base;
  for (let i = 0; i < level; i++) c = Math.floor(c * ADV_UPGRADES_DEF[key].growth);
  return c;
}
function advSpendBetween(key, from, to) {
  let total = 0;
  for (let i = from; i < to; i++) total += advCostFor(key, i);
  return total;
}

function deriveStats(s) {
  s.clickPower = 1 + s.owned.click;
  s.passiveIncome = s.owned.bot * 5 + s.owned.rig * 25;
  for (const t of Object.keys(UPGRADES_DEF)) s.costs[t] = costFor(t, s.owned[t]);
  return s;
}

// ---------------------------------------------------------------------------
// التحقق الخادمي من الحفظ (مكافحة الغش)
// يقارن الحالة المُرسلة بآخر حالة موثوقة على الخادم والزمن المنقضي،
// ويصحّح (clamp) أي قيم مستحيلة بدلاً من قبولها، مع عدّ المخالفات.
// ---------------------------------------------------------------------------
function validateSave(user, input, { isBaseline = false } = {}) {
  const prev = user.state;
  const now = Date.now();
  const s = sanitizeState(input, prev);
  let corrected = false;
  const fix = (cond) => { if (cond) corrected = true; return cond; };

  // مكافآت خادمية (دعوة) لم يرها عميل الداعي بعد: تُدمج قبل المقارنة ثم تُعتمد
  const creditApplied = user.unackedCredits || 0;
  if (creditApplied > 0) { s.gold += creditApplied; s.totalEarned += creditApplied; }

  if (isBaseline) {
    // أول حفظ بعد إنشاء الحساب (ترحيل تقدم محلي مشروع) — نثق مرة واحدة فقط.
    // نستنتج المشتريات من القدرات إن غابت (حفظ قديم) ثم نشتق كل شيء حتمياً.
    if (s.owned.click === 0 && s.clickPower > 1) s.owned.click = s.clickPower - 1;
    if (s.owned.bot === 0 && s.owned.rig === 0 && s.passiveIncome >= 5) s.owned.bot = Math.floor(s.passiveIncome / 5);
    deriveStats(s);
    return { state: s, corrected: false, creditApplied };
  }

  const elapsedSec = Math.min(Math.max(0, (now - (user.lastSaveAt || now)) / 1000), OFFLINE_CAP_SEC);

  // 1) المشتريات (تعدين + مغامرة) لا تتناقص، وزيادتها محدودة لكل حفظ
  let expectedSpend = 0;
  for (const t of Object.keys(UPGRADES_DEF)) {
    if (fix(s.owned[t] < prev.owned[t])) s.owned[t] = prev.owned[t];
    if (fix(s.owned[t] > prev.owned[t] + 200)) s.owned[t] = prev.owned[t] + 200;
    expectedSpend += spendBetween(t, prev.owned[t], s.owned[t]);
  }
  for (const k of Object.keys(ADV_UPGRADES_DEF)) {
    const prevLvl = prev.adventureUpgrades?.[k] || 0;
    if (fix(s.adventureUpgrades[k] < prevLvl)) s.adventureUpgrades[k] = prevLvl;
    if (fix(s.adventureUpgrades[k] > prevLvl + 5)) s.adventureUpgrades[k] = prevLvl + 5;
    expectedSpend += advSpendBetween(k, prevLvl, s.adventureUpgrades[k]);
  }

  // 2) القدرات والأسعار مشتقة من المشتريات حصراً
  const beforeDerive = JSON.stringify([s.clickPower, s.passiveIncome, s.costs]);
  deriveStats(s);
  if (JSON.stringify([s.clickPower, s.passiveIncome, s.costs]) !== beforeDerive) corrected = true;

  // 2.5) شراء لا يغطيه الرصيد + أقصى كسب ممكن خلال الفترة يُرفض كلياً (لا شراء بالدين)
  {
    const maxClickPower0 = Math.max(prev.clickPower, s.clickPower);
    const maxPassive0 = Math.max(prev.passiveIncome, s.passiveIncome);
    const boostGuess = (s.boostUntil > now || prev.boostUntil > user.lastSaveAt) ? 2 : 1;
    const allowedEarly = elapsedSec * (MAX_CLICKS_PER_SEC * maxClickPower0 * boostGuess + maxPassive0 * boostGuess) + GAIN_SLACK + 120; // 120: هامش جائزة مغامرة/سباق قصيرة
    if (expectedSpend > prev.gold + allowedEarly) {
      s.owned = { ...prev.owned };
      s.adventureUpgrades = { ...(prev.adventureUpgrades || defaultState().adventureUpgrades) };
      expectedSpend = 0;
      deriveStats(s);
      corrected = true;
    }
  }

  // 3) التعزيز: بداية جديدة فقط بعد انتهاء التهدئة، ولمدة ≤30 ثانية وتهدئة 5 دقائق
  if (s.boostUntil !== prev.boostUntil || s.boostCooldownUntil !== prev.boostCooldownUntil) {
    const startingBoost = s.boostUntil > now && s.boostUntil !== prev.boostUntil;
    const valid = startingBoost
      && s.boostUntil - now <= 30_000 + 2_000
      && (prev.boostCooldownUntil || 0) <= now
      && Math.abs((s.boostCooldownUntil - s.boostUntil) - 270_000) <= 15_000
      && s.boostCooldownUntil >= prev.boostCooldownUntil;
    if (fix(!valid)) { s.boostUntil = prev.boostUntil; s.boostCooldownUntil = prev.boostCooldownUntil; }
  }
  const boosted = s.boostUntil > user.lastSaveAt || prev.boostUntil > user.lastSaveAt || s.boostUntil > now - 30_000 && prev.boostUntil > 0;
  const boostFactor = boosted ? 2 : 1;

  // 4) سقف الكسب الممكن خلال الزمن المنقضي (نقر + دخل سلبي + هامش)
  const maxClickPower = Math.max(prev.clickPower, s.clickPower);
  const maxPassive = Math.max(prev.passiveIncome, s.passiveIncome);
  const allowedGain = elapsedSec * (MAX_CLICKS_PER_SEC * maxClickPower * boostFactor + maxPassive * boostFactor) + GAIN_SLACK;

  const maxGold = prev.gold - expectedSpend + allowedGain;
  if (fix(s.gold > maxGold)) s.gold = Math.max(0, maxGold);
  if (fix(s.gold < prev.gold - expectedSpend)) s.gold = Math.max(0, prev.gold - expectedSpend); // ذهب لا يختفي بلا شراء (يحمي مكافآت الخادم من عميل قديم)

  if (fix(s.totalEarned < prev.totalEarned)) s.totalEarned = prev.totalEarned;
  if (fix(s.totalEarned > prev.totalEarned + allowedGain)) s.totalEarned = prev.totalEarned + allowedGain;

  // 5) الطاقة لا تتجدد أسرع من المعدل، ولا تتجاوز الحد
  const maxEnergyNow = Math.min(s.maxEnergy, prev.energy + elapsedSec * ENERGY_REGEN_PER_SEC);
  if (fix(s.energy > maxEnergyNow)) s.energy = maxEnergyNow;

  if (corrected) console.warn(`🛡️  تصحيح حفظ للاعب ${user.id} (مخالفات متراكمة: ${user.violations + 1})`);
  return { state: s, corrected, creditApplied };
}

// ---------------------------------------------------------------------------
// أدوات اليومية/المستوى/الملف الشخصي
// ---------------------------------------------------------------------------
const dayStr = (d = new Date()) => d.toISOString().slice(0, 10);
const levelOf = (totalEarned) => Math.floor(totalEarned / 5000) + 1;

// مفتاح أسبوع ISO (مثل 2026-W42) لبطولة السباقات الأسبوعية
function currentWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day); // الخميس من هذا الأسبوع
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400e3 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function dailyInfo(user) {
  const today = dayStr();
  const yesterday = dayStr(new Date(Date.now() - 86400e3));
  const canClaim = user.dailyLastClaim !== today;
  const nextStreak = !canClaim ? user.dailyStreak : (user.dailyLastClaim === yesterday ? user.dailyStreak + 1 : 1);
  return { canClaim, streak: canClaim ? nextStreak : user.dailyStreak, reward: Math.min(1500, 500 + (nextStreak - 1) * 100), today };
}

async function createUser(id, name) {
  const now = Date.now();
  const user = {
    id: String(id),
    name: name || 'معدّن أسطوري',
    state: defaultState(),
    referralCount: 0,
    referralEarnings: 0,
    referredBy: null,
    dailyLastClaim: null,
    dailyStreak: 0,
    unackedCredits: 0,
    violations: 0,
    lastSaveAt: now,
    createdAt: now,
    updatedAt: now,
  };
  // مكافآت دعوات وصلت قبل أن يفتح الداعي اللعبة أول مرة
  const pending = await store.getPending(user.id);
  if (pending > 0) {
    user.state.gold += pending * REFERRAL_REWARD;
    user.state.totalEarned += pending * REFERRAL_REWARD;
    user.referralCount += pending;
    user.referralEarnings += pending * REFERRAL_REWARD;
    await store.clearPending(user.id);
  }
  await store.putUser(user);
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

// ترحيل لمرة واحدة من مخزن JSON القديم (data/db.json) إن وُجد وقاعدة البيانات فارغة
async function migrateLegacyJson() {
  const legacyFile = path.join(__dirname, 'data', 'db.json');
  try {
    if ((await store.countUsers()) > 0 || !fs.existsSync(legacyFile)) return;
    const legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    const users = Object.values(legacy.users || {});
    for (const u of users) {
      await store.putUser({
        id: String(u.id), name: u.name || 'معدّن أسطوري',
        state: sanitizeState(u.state), referralCount: u.referralCount || 0,
        referralEarnings: u.referralEarnings || 0, referredBy: u.referredBy || null,
        dailyLastClaim: u.dailyLastClaim || null, dailyStreak: u.dailyStreak || 0,
        unackedCredits: 0, violations: 0,
        lastSaveAt: u.updatedAt || Date.now(), createdAt: u.createdAt || Date.now(), updatedAt: u.updatedAt || Date.now(),
      });
    }
    for (const [id, count] of Object.entries(legacy.pendingReferrals || {})) await store.setPending(id, count);
    if (users.length) {
      fs.renameSync(legacyFile, `${legacyFile}.migrated`);
      console.log(`🗄️  رُحّل ${users.length} لاعباً من db.json القديم إلى قاعدة البيانات (النسخة القديمة: db.json.migrated)`);
    }
  } catch (e) { console.error('تعذّر ترحيل db.json القديم:', e.message); }
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

// تحديد معدّل بسيط حسب اللاعب/العنوان لكل مسار
function rateLimit(name, maxPerMinute) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${name}:${req.player?.id || req.ip}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < 60_000);
    if (arr.length >= maxPerMinute) return res.status(429).json({ error: 'طلبات كثيرة جداً — انتظر قليلاً' });
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const asyncRoute = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('خطأ API:', e);
  if (!res.headersSent) res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

app.get('/health', asyncRoute(async (req, res) => {
  res.json({ ok: true, bot: Boolean(BOT_TOKEN), db: store.driver, users: await store.countUsers() });
}));

// جلب/إنشاء ملف اللاعب — يعالج الدعوات عند أول دخول (?ref=ref_<id>)
app.get('/api/me', requireAuth, rateLimit('me', 60), asyncRoute(async (req, res) => {
  let user = await store.getUser(req.player.id);
  let isNew = false;
  if (!user) {
    user = await createUser(req.player.id, req.player.name);
    isNew = true;
    const refId = String(req.query.ref || '').replace(/^ref_/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (refId && refId !== user.id) {
      user.referredBy = refId;
      const inviter = await store.getUser(refId);
      if (inviter) {
        inviter.state.gold += REFERRAL_REWARD;
        inviter.state.totalEarned += REFERRAL_REWARD;
        inviter.referralCount += 1;
        inviter.referralEarnings += REFERRAL_REWARD;
        inviter.unackedCredits = (inviter.unackedCredits || 0) + REFERRAL_REWARD; // سيُدمج في حفظه القادم أو يُعتمد الآن إن كان يقرأ ملفه
        inviter.updatedAt = Date.now();
        await store.putUser(inviter);
      } else {
        await store.addPending(refId);
      }
    }
    await store.putUser(user);
  } else {
    if (req.player.name && user.name !== req.player.name && req.player.name !== 'ضيف') user.name = req.player.name;
    // إيصال الحالة الحالية للعميل يعني اعتماد أي مكافآت خادمية معلّقة
    if (user.unackedCredits) { user.unackedCredits = 0; }
    user.updatedAt = Date.now();
    await store.putUser(user);
  }
  res.json(profileOf(user, isNew));
}));

app.post('/api/save', requireAuth, rateLimit('save', 120), asyncRoute(async (req, res) => {
  let user = await store.getUser(req.player.id);
  if (!user) user = await createUser(req.player.id, req.player.name);
  // الترحيل الأول المشروع: أول حفظ خلال ثانيتين من إنشاء الحساب مع طلب ترحيل صريح
  const isBaseline = req.body?.migrate === true && (user.lastSaveAt - user.createdAt) < 2000 && user.violations === 0;
  const { state, corrected, creditApplied } = validateSave(user, req.body?.state, { isBaseline });
  user.state = state;
  user.unackedCredits = 0;
  if (corrected) user.violations += 1;
  user.lastSaveAt = Date.now();
  user.updatedAt = Date.now();
  await store.putUser(user);
  res.json({ ok: true, corrected, violations: user.violations, serverCreditsApplied: creditApplied, state: user.state, serverTime: Date.now() });
}));

app.post('/api/claim-daily', requireAuth, rateLimit('daily', 10), asyncRoute(async (req, res) => {
  let user = await store.getUser(req.player.id);
  if (!user) user = await createUser(req.player.id, req.player.name);
  const info = dailyInfo(user);
  if (!info.canClaim) return res.status(409).json({ error: 'استلمت مكافأة اليوم — عُد غداً!', daily: info });
  user.dailyStreak = info.streak;
  user.dailyLastClaim = info.today;
  user.state.gold += info.reward;
  user.state.totalEarned += info.reward;
  user.lastSaveAt = Date.now();
  user.updatedAt = Date.now();
  await store.putUser(user);
  res.json({ ok: true, reward: info.reward, state: user.state, daily: dailyInfo(user) });
}));

app.get('/api/race-leaderboard', rateLimit('raceboard', 120), asyncRoute(async (req, res) => {
  const week = currentWeekKey();
  const rows = await store.raceLeaderboard(week, 20);
  res.json({ week, leaderboard: rows.map((r, i) => ({ rank: i + 1, ...r })) });
}));

app.get('/api/leaderboard', rateLimit('board', 120), asyncRoute(async (req, res) => {
  const top = await store.topUsers(20);
  res.json({
    leaderboard: top.map((u, i) => ({
      rank: i + 1, id: u.id, name: u.name,
      gold: Math.floor(u.state.gold), totalEarned: Math.floor(u.state.totalEarned),
      level: levelOf(u.state.totalEarned),
    })),
  });
}));

// ---------------------------------------------------------------------------
// ⚔️ سباقات لاعب ضد لاعب مباشرة (WebSocket) — غرف سريعة أو برمز خاص
// الخادم يقرّن اللاعبين ويبث التقدم والنتائج؛ محاكاة اللعبة نفسها عند العميل
// بنفس بذرة عشوائية للطرفين، والنتيجة تُختم بسقف نقاط معقول لمدة السباق.
// ---------------------------------------------------------------------------
const raceRooms = new Map();
let raceQueue = [];
const sendWs = (ws, obj) => { try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch (_) {} };
const raceCode = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return raceRooms.has(code) ? raceCode() : code;
};

function setupMultiplayer(httpServer) {
  if (!WebSocketServer) return; // السباقات معطّلة فقط — بقية اللعبة تعمل
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    let player = null;
    const initData = url.searchParams.get('initData') || '';
    const guest = (url.searchParams.get('guest') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (initData) {
      const tgUser = BOT_TOKEN ? validateInitData(initData) : parseInitDataUser(initData);
      if (tgUser?.id) player = { id: String(tgUser.id), name: tgUser.first_name || 'لاعب' };
    } else if (guest && ALLOW_GUEST) {
      player = { id: `guest_${guest}`, name: 'ضيف' };
    }
    if (!player) { ws.close(4001, 'auth required'); return; }
    try { const dbUser = await store.getUser(player.id); if (dbUser?.name && dbUser.name !== 'ضيف') player.name = dbUser.name; } catch (_) {}

    ws.player = { ...player, roomId: null, ready: false, lastProgress: 0 };
    sendWs(ws, { type: 'welcome', id: player.id, name: player.name });

    const leaveRoom = (notify = true) => {
      raceQueue = raceQueue.filter((q) => q !== ws);
      const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
      ws.player.roomId = null;
      if (!room) return;
      room.players.delete(ws);
      for (const other of room.players) {
        other.player.roomId = null;
        other.player.ready = false;
        if (notify) sendWs(other, { type: room.state === 'racing' ? 'opponent_left' : 'room_closed', message: 'غادر الخصم' });
      }
      if (room.players.size === 0) raceRooms.delete(room.id);
    };
    ws.leaveRaceRoom = leaveRoom;

    const pairInto = (room, other) => {
      room.players.add(ws); room.players.add(other);
      ws.player.roomId = room.id; other.player.roomId = room.id;
      sendWs(ws, { type: 'matched', code: room.code, opponent: { id: other.player.id, name: other.player.name } });
      sendWs(other, { type: 'matched', code: room.code, opponent: { id: ws.player.id, name: ws.player.name } });
    };

    ws.on('message', async (raw) => {
      if (raw.length > 4096) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'quick') {
        leaveRoom(false);
        raceQueue = raceQueue.filter((q) => q.readyState === q.OPEN && q !== ws);
        const other = raceQueue.shift();
        if (other) {
          const room = { id: raceCode(), code: 'سريع', players: new Set(), state: 'lobby', results: new Map(), rematchRequests: new Set() };
          raceRooms.set(room.id, room);
          pairInto(room, other);
        }
        else { raceQueue.push(ws); sendWs(ws, { type: 'waiting', message: 'بانتظار خصم…' }); }
      }

      if (msg.type === 'create') {
        leaveRoom(false);
        const code = raceCode();
        const room = { id: code, code, players: new Set([ws]), state: 'lobby', results: new Map(), rematchRequests: new Set() };
        raceRooms.set(code, room);
        ws.player.roomId = code;
        sendWs(ws, { type: 'room_created', code, message: `شارك الرمز ${code} مع صديقك` });
      }

      if (msg.type === 'join') {
        const room = raceRooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room || room.state !== 'lobby' || room.players.size >= 2) { sendWs(ws, { type: 'error', message: 'الغرفة غير موجودة أو ممتلئة' }); return; }
        const [host] = [...room.players];
        if (host === ws) return;
        pairInto(room, host);
      }

      if (msg.type === 'ready') {
        const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
        if (!room || room.players.size !== 2) return;
        ws.player.ready = true;
        const players = [...room.players];
        if (players.every((p) => p.player.ready)) {
          room.state = 'racing';
          room.seed = Math.floor(Math.random() * 2 ** 31);
          room.startAt = Date.now() + 2500;
          room.startedAt = Date.now();
          room.results = new Map();
          for (const p of players) {
            const opp = players.find((q) => q !== p);
            sendWs(p, { type: 'start', seed: room.seed, startAt: room.startAt, opponent: { id: opp.player.id, name: opp.player.name } });
          }
        }
      }

      if (msg.type === 'progress') {
        const now = Date.now();
        if (now - ws.player.lastProgress < 100) return;
        ws.player.lastProgress = now;
        const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
        if (!room || room.state !== 'racing') return;
        const payload = {
          type: 'opponent_progress',
          score: Math.max(0, Math.min(100000, Number(msg.score) || 0)),
          lives: Math.max(0, Math.min(5, Number(msg.lives) || 0)),
          xRatio: Math.max(0, Math.min(1, Number(msg.xRatio) || 0.5)),
          finished: Boolean(msg.finished),
        };
        for (const other of room.players) if (other !== ws) sendWs(other, payload);
      }

      if (msg.type === 'finish') {
        const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
        if (!room || room.state !== 'racing') return;
        // سقف نتيجة معقول: مدة السباق × أقصى معدل نقاط/ثانية تقريبي
        const elapsedRace = Math.min(75, Math.max(0, (Date.now() - (room.startedAt || Date.now())) / 1000));
        const maxScore = Math.floor(elapsedRace * 45) + 100;
        const score = Math.max(0, Math.min(maxScore, Math.floor(Number(msg.score) || 0)));
        room.results.set(ws.player.id, { id: ws.player.id, name: ws.player.name, score });
        for (const other of room.players) if (other !== ws) sendWs(other, { type: 'opponent_finished', score });
        if (room.results.size >= 2) {
          room.state = 'finished';
          const results = [...room.results.values()].sort((a, b) => b.score - a.score);
          const winnerId = results[0].score === results[1].score ? null : results[0].id;
          // 🏆 تسجيل البطولة الأسبوعية قبل إعلان النتيجة (فشل التخزين لا يعطّل السباق)
          try {
            const week = currentWeekKey();
            for (const r of results) await store.recordRaceResult(week, { ...r, won: winnerId === r.id });
          } catch (e) { console.error('تعذّر تسجيل نتيجة سباق:', e.message); }
          for (const p of room.players) sendWs(p, { type: 'result', winnerId, results });
        }
      }

      if (msg.type === 'rematch') {
        const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
        if (!room || room.state !== 'finished' || room.players.size !== 2) return;
        room.rematchRequests = room.rematchRequests || new Set();
        room.rematchRequests.add(ws.player.id);
        const players = [...room.players];
        for (const other of players) if (other !== ws) sendWs(other, { type: 'rematch_requested' });
        if (room.rematchRequests.size >= 2) {
          room.rematchRequests.clear();
          room.state = 'racing';
          room.seed = Math.floor(Math.random() * 2 ** 31);
          room.startAt = Date.now() + 2500;
          room.startedAt = Date.now();
          room.results = new Map();
          for (const p of players) {
            p.player.ready = false;
            const opp = players.find((q) => q !== p);
            sendWs(p, { type: 'start', seed: room.seed, startAt: room.startAt, opponent: { id: opp.player.id, name: opp.player.name } });
          }
        }
      }

      if (msg.type === 'leave') leaveRoom(true);
    });

    ws.on('close', leaveRoom);
    ws.on('error', () => leaveRoom());
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) {}
    }
  }, 30000);
  wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
  wss.on('close', () => clearInterval(heartbeat));
  console.log('⚔️  خادم سباقات WebSocket جاهز على /ws');
}

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

migrateLegacyJson().finally(() => {
  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`🎮 خادم اللعبة يعمل الآن على: http://localhost:${PORT}`);
  });
  setupMultiplayer(httpServer);
});
