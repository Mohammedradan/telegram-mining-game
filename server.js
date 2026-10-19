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
const { raceRulesFromEnv, raceCap: raceCapRule, raceDeadline, forfeitAllowed, decideWinner } = require('./race-rules');
// محرك الساحة مشترك مع المتصفح (يُقدَّم ثابتاً من public/) حتى تكون محاكاة الخادم مطابقة لما عرضه العميل
const ArenaRules = require('./public/arena-rules');
// منجم المنصّة (اللعبة الجانبية): مسارات API تُركَّب أدناه بنفس المصادقة والتحقق والمعاملات
const { mountPlatform } = require('./platform-api');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const { loadConfig, productionConfigErrors, configWarnings } = require('./config');
const { createRateLimiter } = require('./rate-limit');
const { securityHeaders } = require('./security-headers');
const CONFIG = loadConfig();
const BOT_TOKEN = CONFIG.botToken;
// اسم مستخدم البوت العام لروابط الدعوة: BOT_USERNAME صريحاً، وإلا يُقرأ من getMe عند تشغيل البوت
let botUsername = CONFIG.botUsername;
// وضع الضيف للتطوير فقط عند غياب التوكن؛ في الإنتاج لا يُسمح به إلا بتفعيل صريح.
const IS_PRODUCTION = CONFIG.production;
const ALLOW_GUEST = CONFIG.allowGuest;
// الإنتاج لا يبدأ بإعداد ناقص: لا وضع ضيف صامت ولا SQLite مؤقتة ولا بوت بلا رابط
const CONFIG_ERRORS = productionConfigErrors(CONFIG);
for (const w of configWarnings(CONFIG)) console.warn(`⚠️  ${w}`);
if (CONFIG_ERRORS.length) {
  console.error('⛔ إعداد الإنتاج غير مكتمل (NODE_ENV=production) — لن يبدأ الخادم:');
  for (const e of CONFIG_ERRORS) console.error(`   • ${e}`);
  console.error('   راجع DEPLOYMENT.md لإعداد متغيرات البيئة.');
  process.exit(1);
}
const REFERRAL_REWARD = 1000;

// إعدادات مكافحة الغش الخادمية (قابلة للضبط من البيئة)
const MAX_CLICKS_PER_SEC = Number(process.env.MAX_CLICKS_PER_SEC || 20); // نقرات بشرية/لمس متعدد كحد أقصى معقول
const ENERGY_REGEN_PER_SEC = 3;
const OFFLINE_CAP_SEC = 8 * 3600;
const BOOST_DURATION_MS = 30_000;
const BOOST_COOLDOWN_MS = 5 * 60_000;
// نقرات لم تُزامَن بعد تُحتسب لها طاقة متجددة لعشر دقائق كحد أقصى (انقطاع شبكة معقول، لا جلسة غير متصلة كاملة)
const MINE_WINDOW_CAP_SEC = 10 * 60;
const MAX_OPS_PER_BATCH = 64;
// جولات المغامرة: زمن اللعب المبلَّغ عنه لا يتجاوز الزمن الحقيقي منذ آخر جولة (بسقف 30 دقيقة بعد غياب)
const RUN_WINDOW_CAP_SEC = 30 * 60;
const RUN_SLACK_SEC = 3;                  // تسامح لزمن الشبكة/الطابور بين نهاية الجولة ووصول تقريرها
const RUN_REWARD_GAP_SEC = 20;            // فاصل أدنى بين جولتين مكافأتين (على الخط الزمني للجولات)
const RUN_MAX_SCORE_PER_SEC = 40;         // النقاط المعتمدة للمكافأة لا تتجاوز هذا المعدل
const RUN_HARD_SCORE_PER_SEC = 300;       // سقف فيزيائي للنقاط المسجّلة في الإحصاءات
const RUN_MAX_OBJECTS_PER_SEC = 5;        // أقصى توليد عناصر في اللعبة (كل 0.2 ثانية)
const RUN_MIN_BOSS_SEC = 8;               // لا يُحتسب قتل زعيم في جولة أقصر من ذلك
const RUN_MIN_SEC = 5;                    // جولة أقصر من ذلك ليست جولة حقيقية (لا تُحتسب)
// نقاط الخبرة: تُمنح من أحداث يتحقق منها الخادم فقط (طاقة مُنفقة، شراء، تعزيز، جولات، يومية، دعوات)
const XP_RULES = {
  energyPerXp: 10,      // كل 10 طاقة تُنفق في التعدين = 1 خبرة (البقية تُرحَّل ولا تضيع)
  costPerXp: 20,        // كل 20 ذهب يُنفق على ترقية = 1 خبرة
  boost: 10,
  runSecPerXp: 4, runGemsPerXp: 2, bossKill: 25,
  arenaWin: 10,
  dailyBase: 25, dailyPerStreak: 5, dailyMax: 100,
  referral: 100,
};
const LEGACY_GOLD_PER_LEVEL = 5000;        // صيغة المستوى القديمة (إجمالي المكاسب/5000) — تُحوَّل مرة واحدة إلى خبرة
const MAX_SESSIONS_TRACKED = 6;

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
  adventure: defaultAdventure(),
  xp: 0,
  lastSeen: Date.now(),
});
// إحصاءات المغامرة الموثوقة (تُحدَّث من جولات يتحقق منها الخادم فقط) — المناطق مشتقة منها
const ADV_STAT_KEYS = ['runs', 'gems', 'maxCombo', 'bestScore', 'bestSurvival', 'bossWins', 'rewardEarned', 'playSec'];
function defaultAdventure() { return { runs: 0, gems: 0, maxCombo: 0, bestScore: 0, bestSurvival: 0, bossWins: 0, rewardEarned: 0, playSec: 0, zones: 1 }; }

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
    adventure: sanitizeAdventure(s.adventure, base.adventure),
    // ملف من قبل نقاط الخبرة: يبدأ بخبرة تعادل مستواه القديم تماماً (لا يخسر لاعب مستواه)
    xp: (s.xp === undefined || s.xp === null) ? legacyXp(clampNum(s.totalEarned, 0, 1e12, base.totalEarned)) : Math.floor(clampNum(s.xp, 0, 1e15, 0)),
    lastSeen: Date.now(),
  };
}

// منحنى المستوى: الخبرة اللازمة لبلوغ المستوى n هي 60(n−1)² + 40(n−1) — المستوى 2 عند 100، 5 عند 1120، 10 عند 5220
const xpForLevel = (n) => { const k = Math.max(0, Math.floor(n) - 1); return 60 * k * k + 40 * k; };
function levelFromXp(xp) {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  let level = Math.floor((-40 + Math.sqrt(1600 + 240 * x)) / 120) + 1;
  while (xpForLevel(level + 1) <= x) level += 1;
  while (level > 1 && xpForLevel(level) > x) level -= 1;
  return level;
}
function legacyXp(totalEarned) {
  const earned = Math.max(0, Number(totalEarned) || 0);
  const level = Math.floor(earned / LEGACY_GOLD_PER_LEVEL) + 1;
  const frac = (earned % LEGACY_GOLD_PER_LEVEL) / LEGACY_GOLD_PER_LEVEL;
  return Math.floor(xpForLevel(level) + frac * (xpForLevel(level + 1) - xpForLevel(level)));
}
function progressOf(s) {
  const level = levelFromXp(s.xp);
  const start = xpForLevel(level); const end = xpForLevel(level + 1);
  return { level, xp: s.xp, current: s.xp - start, needed: end - start };
}
const grantXp = (s, amount) => { const n = Math.max(0, Math.floor(amount)); s.xp += n; s.level = levelFromXp(s.xp); return n; };
function sanitizeAdventure(input, base = defaultAdventure()) {
  const a = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const out = {};
  for (const k of ADV_STAT_KEYS) out[k] = Math.floor(clampNum(a[k], 0, 1e12, base?.[k] || 0));
  out.zones = zonesFor(out);
  return out;
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

// فتح مناطق المغامرة (نفس عتبات الواجهة) — يُشتق خادمياً من إحصاءات موثوقة
const ADV_ZONE_RULES = [
  { gems: 0, runs: 0, bosses: 0 },
  { gems: 25, runs: 3, bosses: 0 },
  { gems: 75, runs: 0, bosses: 1 },
];
function zonesFor(a) {
  let unlocked = 1;
  if (a.gems >= ADV_ZONE_RULES[1].gems || a.runs >= ADV_ZONE_RULES[1].runs) unlocked = 2;
  if (a.gems >= ADV_ZONE_RULES[2].gems || a.bossWins >= ADV_ZONE_RULES[2].bosses) unlocked = 3;
  return unlocked;
}

function deriveStats(s) {
  s.clickPower = 1 + s.owned.click;
  s.passiveIncome = s.owned.bot * 5 + s.owned.rig * 25;
  for (const t of Object.keys(UPGRADES_DEF)) s.costs[t] = costFor(t, s.owned[t]);
  if (!s.adventure) s.adventure = defaultAdventure();
  s.adventure.zones = zonesFor(s.adventure);
  s.level = levelFromXp(s.xp);
  return s;
}

// ---------------------------------------------------------------------------
// الاقتصاد الخادمي — الخادم مصدر الحقيقة للذهب والطاقة والمشتريات والتعزيز.
// لا يُقبل من العميل رصيد ولا قدرات؛ يرسل العميل «عمليات» (نقرات مجمّعة، شراء،
// تعزيز، مكافأة جولة) بأرقام تسلسلية لكل جلسة، والخادم يحاكي القيود الفيزيائية
// (الطاقة وتجددها، معدل النقر، الأسعار المشتقة، نافذة التعزيز) ويتجاهل التكرار.
// ---------------------------------------------------------------------------
const OP_TYPES = new Set(['mine', 'buy', 'buy_adv', 'boost', 'reward', 'run', 'mission', 'weekly_mission', 'achievement', 'arena']);
// جولة مغامرة: الوضع يحدد المدة القصوى وسقف المكافأة ومعاملها (مطابق للواجهة)
const ADV_RUN_MODES = {
  classic: { maxSec: 60, scale: 1, cap: 100 },
  blitz: { maxSec: 30, scale: 1.15, cap: 100 },
  survival: { maxSec: 3600, scale: 1.4, cap: 150 },
  boss: { maxSec: 75, scale: 1.1, cap: 100 },
};
const ADV_DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
// الساحة: لم يعد العميل يبلّغ «فزت»؛ يرسل حركاته فقط والخادم يعيد تشغيل المباراة ببذرة التذكرة
// (public/arena-rules.js) ويختم النتيجة. الفاصل الزمني بين فوزين مكافأين يبقى سقف الاقتصاد.
const ARENA_RULES = {
  minIntervalMs: 10_000,   // فوز مكافأ واحد كل 10 ثوانٍ (كما كان)
  slackMs: 250,            // تسامح في أدنى زمن للمباراة (دور الروبوت 750 مللي ثانية × أدواره)
};

// تقرير جولة مغامرة: يُقبل فقط إن اتسع له الزمن الحقيقي منذ آخر جولة، وتُقصّ أرقامه إلى ما تسمح به
// فيزياء اللعبة (توليد ≤ 5 عناصر/ثانية). يُحدّث الإحصاءات الموثوقة ويحسب المكافأة من زمن اللعب الفعلي.
function applyRun(user, op, now, timeline) {
  const s = user.state; const a = s.adventure;
  const modeCfg = ADV_RUN_MODES[op.mode];
  if (!modeCfg) return { status: 'invalid' };
  const difficulty = ADV_DIFFICULTIES.has(op.difficulty) ? op.difficulty : 'normal';
  const duration = Math.floor(clampNum(op.duration, 0, modeCfg.maxSec + 1, 0));
  if (duration < RUN_MIN_SEC) return { status: 'rejected', reason: 'short', duration };
  // نهاية الجولة كما يدّعيها العميل (ago = منذ كم مللي ثانية انتهت) محصورة بين آخر جولة والآن،
  // ويجب أن يتسع ما بينهما لزمن الجولة (مع تسامح الشبكة) — زمن لعب أكثر من الزمن الحقيقي مرفوض
  const claimedEnd = now - clampNum(op.ago, 0, RUN_WINDOW_CAP_SEC * 1000, 0);
  const endAt = Math.min(now, Math.max(timeline.cursor, claimedEnd));
  const needMs = Math.max(duration - RUN_SLACK_SEC, 2) * 1000;
  if (endAt - timeline.cursor < needMs) return { status: 'rejected', reason: 'time', duration, flagged: true };
  timeline.cursor = endAt;
  const maxObjects = duration * RUN_MAX_OBJECTS_PER_SEC + RUN_MAX_OBJECTS_PER_SEC;
  const gems = Math.floor(clampNum(op.gems, 0, 1e6, 0));
  const combo = Math.floor(clampNum(op.combo, 0, 1e6, 0));
  const rawScore = Math.floor(clampNum(op.score, 0, 1e9, 0));
  const score = Math.min(rawScore, duration * RUN_HARD_SCORE_PER_SEC + RUN_HARD_SCORE_PER_SEC);
  const bossKill = op.mode === 'boss' && op.boss === true && duration >= RUN_MIN_BOSS_SEC;
  const clamped = gems > maxObjects || combo > maxObjects || rawScore > score || (op.boss === true && !bossKill);
  const r = { status: clamped ? 'clamped' : 'ok', mode: op.mode, difficulty, duration, score, gems: Math.min(gems, maxObjects), combo: Math.min(combo, maxObjects), boss: bossKill, race: op.race === true, gold: 0, flagged: clamped };
  // المكافأة: من النقاط التي يسمح بها زمن اللعب، بسقف الوضع، وبفاصل 20 ثانية بين جولتين مكافأتين
  if (!r.race) {
    const basis = Math.min(score, duration * RUN_MAX_SCORE_PER_SEC);
    const gold = Math.min(modeCfg.cap, Math.floor(basis / 5 * modeCfg.scale)) + (bossKill ? 150 : 0);
    if (gold > 0) {
      if (endAt - timeline.lastRewardEnd < RUN_REWARD_GAP_SEC * 1000) r.reason = 'too_soon';
      else { r.gold = gold; timeline.lastRewardEnd = endAt; s.gold += gold; s.totalEarned += gold; }
    }
  }
  const zonesBefore = a.zones;
  a.runs += 1; a.gems += r.gems; a.playSec += duration;
  a.maxCombo = Math.max(a.maxCombo, r.combo);
  a.bestScore = Math.max(a.bestScore, score);
  if (op.mode === 'survival') a.bestSurvival = Math.max(a.bestSurvival, score);
  if (bossKill) a.bossWins += 1;
  a.rewardEarned += r.gold;
  a.zones = zonesFor(a);
  r.zones = a.zones; r.unlocked = a.zones > zonesBefore;
  return r;
}

// ---------------------------------------------------------------------------
// المهام اليومية — يولّدها الخادم لكل لاعب/يوم (UTC) من مجموعة ثابتة، ويتقدّم عدّادها من
// العمليات الموثوقة نفسها (تعدين، شراء، تعزيز، جولات، ساحة). الاستلام عملية مرقّمة تُسجَّل في الدفتر.
// ---------------------------------------------------------------------------
const MISSION_POOL = [
  { key: 'mine_energy', icon: '⚡', title: 'أنفق {n} طاقة في التعدين', target: 600, gold: 150, xp: 40, mode: 'sum' },
  { key: 'mine_gold', icon: '⛏️', title: 'عدّن {n} ذهب بالنقر', target: 800, gold: 150, xp: 40, mode: 'sum' },
  { key: 'runs', icon: '🎮', title: 'أكمل {n} جولات مغامرة', target: 3, gold: 200, xp: 50, mode: 'sum' },
  { key: 'gems', icon: '💎', title: 'التقط {n} جوهرة في المغامرة', target: 60, gold: 200, xp: 50, mode: 'sum' },
  { key: 'score', icon: '🏅', title: 'حقق {n} نقطة في جولة واحدة', target: 400, gold: 250, xp: 60, mode: 'max' },
  { key: 'boss', icon: '👹', title: 'اهزم زعيم المنجم', target: 1, gold: 300, xp: 80, mode: 'sum' },
  { key: 'boost', icon: '🚀', title: 'فعّل التعزيز {n} مرات', target: 2, gold: 100, xp: 30, mode: 'sum' },
  { key: 'buy', icon: '🛒', title: 'اشترِ {n} ترقيات', target: 2, gold: 150, xp: 40, mode: 'sum' },
  { key: 'play_time', icon: '⏱️', title: 'العب {n} ثانية في المغامرة', target: 180, gold: 200, xp: 50, mode: 'sum' },
  { key: 'survival', icon: '💀', title: 'حقق {n} نقطة في وضع البقاء', target: 250, gold: 250, xp: 60, mode: 'max' },
  { key: 'arena', icon: '⚔️', title: 'افُز بـ{n} مباريات في الساحة', target: 2, gold: 100, xp: 30, mode: 'sum' },
];
const MISSION_BY_KEY = Object.fromEntries(MISSION_POOL.map((m) => [m.key, m]));
const MISSIONS_PER_DAY = 3;
const MISSION_BONUS = { gold: 300, xp: 100 };

function hash32(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
// اختيار حتمي لمهام اليوم: نفس اللاعب ونفس اليوم ⇒ نفس المهام على أي خادم/جهاز
function pickMissions(userId, day) {
  let seed = hash32(`${userId}:${day}`) || 1;
  const next = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const pool = MISSION_POOL.map((_, i) => i);
  const chosen = [];
  while (chosen.length < MISSIONS_PER_DAY && pool.length) chosen.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  return chosen.map((i) => ({ key: MISSION_POOL[i].key, progress: 0, claimed: false }));
}
function ensureMissions(user, now) {
  const day = dayStr(new Date(now));
  const m = user.sync.missions;
  const valid = m && m.day === day && Array.isArray(m.items) && m.items.every((it) => it && MISSION_BY_KEY[it.key]);
  if (!valid) user.sync.missions = { day, items: pickMissions(user.id, day), bonusClaimed: false };
  return user.sync.missions;
}
function trackMissionList(items, byKey, key, value) {
  const def = byKey[key];
  if (!def || value <= 0) return;
  for (const item of items) {
    if (item.key !== key || item.claimed) continue;
    item.progress = def.mode === 'max' ? Math.max(item.progress || 0, value) : Math.min(def.target, (item.progress || 0) + value);
  }
}
function trackMission(user, key, amount, now) {
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) return;
  trackMissionList(ensureMissions(user, now).items, MISSION_BY_KEY, key, value);
  trackMissionList(ensureWeeklyMissions(user, now).items, WEEKLY_MISSION_BY_KEY, key, value);
}
function missionsView(user, now) {
  const m = ensureMissions(user, now);
  const items = m.items.map((item) => {
    const def = MISSION_BY_KEY[item.key];
    const progress = Math.min(def.target, Math.floor(item.progress || 0));
    return { key: def.key, icon: def.icon, title: def.title.replace('{n}', String(def.target)), target: def.target, progress, done: progress >= def.target, claimed: Boolean(item.claimed), gold: def.gold, xp: def.xp };
  });
  const d = new Date(now);
  const resetsIn = Math.max(0, Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000));
  const allClaimed = items.length > 0 && items.every((i) => i.claimed);
  return { day: m.day, resetsIn, items, bonus: { ...MISSION_BONUS, ready: allClaimed && !m.bonusClaimed, claimed: Boolean(m.bonusClaimed) } };
}
// استلام مكافأة مهمة (أو مكافأة إكمال اليوم) — داخل applyOps
function claimMission(user, key, now) {
  const s = user.state; const m = ensureMissions(user, now);
  if (key === 'bonus') {
    if (m.bonusClaimed) return { status: 'rejected', reason: 'claimed' };
    if (!m.items.every((i) => i.claimed)) return { status: 'rejected', reason: 'incomplete' };
    m.bonusClaimed = true;
    s.gold += MISSION_BONUS.gold; s.totalEarned += MISSION_BONUS.gold;
    return { status: 'ok', key, gold: MISSION_BONUS.gold, xp: grantXp(s, MISSION_BONUS.xp), day: m.day };
  }
  const def = MISSION_BY_KEY[key]; const item = m.items.find((i) => i.key === key);
  if (!def || !item) return { status: 'invalid' };
  if (item.claimed) return { status: 'rejected', reason: 'claimed' };
  if ((item.progress || 0) < def.target) return { status: 'rejected', reason: 'incomplete', progress: Math.floor(item.progress || 0), target: def.target };
  item.claimed = true;
  user.sync.missionsClaimed = (Number(user.sync.missionsClaimed) || 0) + 1; // يغذّي إنجاز «مثابر»
  s.gold += def.gold; s.totalEarned += def.gold;
  return { status: 'ok', key, gold: def.gold, xp: grantXp(s, def.xp), day: m.day };
}

// ---------------------------------------------------------------------------
// المهام الأسبوعية — يولّدها الخادم لكل لاعب/أسبوع ISO (UTC) من مجموعة ثابتة بنفس نمط
// المهام اليومية، ويتقدّم عدّادها من العمليات الموثوقة نفسها، والاستلام عبر weekly_mission في الدفتر.
// ---------------------------------------------------------------------------
const WEEKLY_MISSION_POOL = [
  { key: 'mine_energy', icon: '⚡', title: 'أنفق {n} طاقة في التعدين هذا الأسبوع', target: 3000, gold: 500, xp: 120, mode: 'sum' },
  { key: 'mine_gold', icon: '⛏️', title: 'عدّن {n} ذهب بالنقر هذا الأسبوع', target: 4000, gold: 500, xp: 120, mode: 'sum' },
  { key: 'runs', icon: '🎮', title: 'أكمل {n} جولات مغامرة هذا الأسبوع', target: 15, gold: 600, xp: 150, mode: 'sum' },
  { key: 'gems', icon: '💎', title: 'التقط {n} جوهرة في المغامرة هذا الأسبوع', target: 300, gold: 600, xp: 150, mode: 'sum' },
  { key: 'score', icon: '🏅', title: 'حقق {n} نقطة في جولة واحدة هذا الأسبوع', target: 650, gold: 700, xp: 180, mode: 'max' },
  { key: 'boss', icon: '👹', title: 'اهزم زعيم المنجم {n} مرات هذا الأسبوع', target: 3, gold: 900, xp: 220, mode: 'sum' },
  { key: 'boost', icon: '🚀', title: 'فعّل التعزيز {n} مرات هذا الأسبوع', target: 8, gold: 400, xp: 100, mode: 'sum' },
  { key: 'buy', icon: '🛒', title: 'اشترِ {n} ترقيات هذا الأسبوع', target: 6, gold: 500, xp: 120, mode: 'sum' },
  { key: 'play_time', icon: '⏱️', title: 'العب {n} ثانية في المغامرة هذا الأسبوع', target: 900, gold: 600, xp: 150, mode: 'sum' },
  { key: 'survival', icon: '💀', title: 'حقق {n} نقطة في وضع البقاء هذا الأسبوع', target: 400, gold: 700, xp: 180, mode: 'max' },
  { key: 'arena', icon: '⚔️', title: 'افُز بـ{n} مباريات في الساحة هذا الأسبوع', target: 8, gold: 500, xp: 120, mode: 'sum' },
];
const WEEKLY_MISSION_BY_KEY = Object.fromEntries(WEEKLY_MISSION_POOL.map((m) => [m.key, m]));
const WEEKLY_MISSIONS_PER_WEEK = 3;
const WEEKLY_MISSION_BONUS = { gold: 1000, xp: 300 };

function pickWeeklyMissions(userId, week) {
  let seed = hash32(`weekly:${userId}:${week}`) || 1;
  const next = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const pool = WEEKLY_MISSION_POOL.map((_, i) => i);
  const chosen = [];
  while (chosen.length < WEEKLY_MISSIONS_PER_WEEK && pool.length) chosen.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  return chosen.map((i) => ({ key: WEEKLY_MISSION_POOL[i].key, progress: 0, claimed: false }));
}
function ensureWeeklyMissions(user, now) {
  const week = currentWeekKey(new Date(now));
  const w = user.sync.weeklyMissions;
  const valid = w && w.week === week && Array.isArray(w.items) && w.items.length > 0 && w.items.every((it) => it && WEEKLY_MISSION_BY_KEY[it.key]);
  if (!valid) user.sync.weeklyMissions = { week, items: pickWeeklyMissions(user.id, week), bonusClaimed: false };
  return user.sync.weeklyMissions;
}
function weeklyMissionsView(user, now) {
  const w = ensureWeeklyMissions(user, now);
  const items = w.items.map((item) => {
    const def = WEEKLY_MISSION_BY_KEY[item.key];
    const progress = Math.min(def.target, Math.floor(item.progress || 0));
    return { key: def.key, icon: def.icon, title: def.title.replace('{n}', String(def.target)), target: def.target, progress, done: progress >= def.target, claimed: Boolean(item.claimed), gold: def.gold, xp: def.xp };
  });
  const d = new Date(now);
  const daysUntilMonday = 8 - (d.getUTCDay() || 7);
  const resetsIn = Math.max(0, Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilMonday) - now) / 1000));
  const allClaimed = items.length > 0 && items.every((i) => i.claimed);
  return { week: w.week, resetsIn, items, bonus: { ...WEEKLY_MISSION_BONUS, ready: allClaimed && !w.bonusClaimed, claimed: Boolean(w.bonusClaimed) } };
}
function claimWeeklyMission(user, key, now) {
  const s = user.state; const w = ensureWeeklyMissions(user, now);
  if (key === 'bonus') {
    if (w.bonusClaimed) return { status: 'rejected', reason: 'claimed' };
    if (!w.items.every((i) => i.claimed)) return { status: 'rejected', reason: 'incomplete' };
    w.bonusClaimed = true;
    s.gold += WEEKLY_MISSION_BONUS.gold; s.totalEarned += WEEKLY_MISSION_BONUS.gold;
    return { status: 'ok', key, gold: WEEKLY_MISSION_BONUS.gold, xp: grantXp(s, WEEKLY_MISSION_BONUS.xp), week: w.week };
  }
  const def = WEEKLY_MISSION_BY_KEY[key]; const item = w.items.find((i) => i.key === key);
  if (!def || !item) return { status: 'invalid' };
  if (item.claimed) return { status: 'rejected', reason: 'claimed' };
  if ((item.progress || 0) < def.target) return { status: 'rejected', reason: 'incomplete', progress: Math.floor(item.progress || 0), target: def.target };
  item.claimed = true;
  user.sync.weeklyClaimed = (Number(user.sync.weeklyClaimed) || 0) + 1;
  s.gold += def.gold; s.totalEarned += def.gold;
  return { status: 'ok', key, gold: def.gold, xp: grantXp(s, def.xp), week: w.week };
}

// ---------------------------------------------------------------------------
// الإنجازات — تُحتسب من بيانات لا يملكها إلا الخادم (إحصاءات جولات تحقق منها، سباقات مختومة،
// خبرة، مهام مستلمة، سلسلة يومية، دعوات، مشتريات). المعرّفات الثمانية الأولى مطابقة لواجهة اللعبة القديمة.
// ---------------------------------------------------------------------------
const advOf = (u) => (u.state.adventure && typeof u.state.adventure === 'object') ? u.state.adventure : {};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ACHIEVEMENTS = [
  { id: 'first_run', icon: '🎬', name: 'أول مغامرة', desc: 'أكمل جولة مغامرة واحدة', target: 1, gold: 25, xp: 10, value: (u) => num(advOf(u).runs) },
  { id: 'score500', icon: '💎', name: 'نتيجة 500', desc: 'حقق أفضل نتيجة 500+', target: 500, gold: 75, xp: 20, value: (u) => num(advOf(u).bestScore) },
  { id: 'combo20', icon: '🔥', name: 'سلسلة 20', desc: 'حقق أعلى سلسلة ×20', target: 20, gold: 75, xp: 20, value: (u) => num(advOf(u).maxCombo) },
  { id: 'collector', icon: '🧲', name: 'جامع الكنوز', desc: 'التقط 300 جوهرة إجمالاً', target: 300, gold: 100, xp: 30, value: (u) => num(advOf(u).gems) },
  { id: 'survivor', icon: '💀', name: 'الناجي', desc: 'حقق 300 نقطة في وضع البقاء', target: 300, gold: 100, xp: 30, value: (u) => num(advOf(u).bestSurvival) },
  { id: 'boss', icon: '👹', name: 'قاتل الزعماء', desc: 'اهزم زعيم المنجم مرة واحدة', target: 1, gold: 100, xp: 30, value: (u) => num(advOf(u).bossWins) },
  { id: 'racer', icon: '⚔️', name: 'بطل السباقات', desc: 'افُز بسباق مباشر واحد', target: 1, gold: 50, xp: 20, value: (u, ctx) => num(ctx.raceWins) },
  { id: 'earner', icon: '🪙', name: 'صانع الذهب', desc: 'اكسب 500 ذهب من المغامرات', target: 500, gold: 100, xp: 30, value: (u) => num(advOf(u).rewardEarned) },
  { id: 'upgrades10', icon: '🛠️', name: 'مهندس المنجم', desc: 'اشترِ 10 ترقيات إجمالاً', target: 10, gold: 150, xp: 40, value: (u) => Object.values(u.state.owned || {}).reduce((a, v) => a + num(v), 0) + Object.values(u.state.adventureUpgrades || {}).reduce((a, v) => a + num(v), 0) },
  { id: 'missions10', icon: '📅', name: 'مثابر', desc: 'استلم 10 مهام يومية', target: 10, gold: 200, xp: 50, value: (u) => num(u.sync.missionsClaimed) },
  { id: 'streak7', icon: '🗓️', name: 'أسبوع كامل', desc: 'سلسلة مكافأة يومية 7 أيام', target: 7, gold: 300, xp: 60, value: (u) => num(u.dailyStreak) },
  { id: 'inviter', icon: '👥', name: 'صاحب الدعوة', desc: 'ادعُ صديقاً واحداً', target: 1, gold: 100, xp: 30, value: (u) => num(u.referralCount) },
  { id: 'level5', icon: '⭐', name: 'معدّن متمرس', desc: 'ابلغ المستوى 5', target: 5, gold: 150, xp: 0, value: (u) => levelFromXp(u.state.xp) },
  { id: 'level10', icon: '🌟', name: 'معدّن أسطوري', desc: 'ابلغ المستوى 10', target: 10, gold: 400, xp: 0, value: (u) => levelFromXp(u.state.xp) },
  { id: 'tycoon', icon: '🏦', name: 'قطب الذهب', desc: 'اكسب 50,000 ذهب إجمالاً', target: 50_000, gold: 500, xp: 100, value: (u) => num(u.state.totalEarned) },
];
const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
function claimedAchievements(user) {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(user.sync.achievements)) user.sync.achievements = {};
  const rec = user.sync.achievements;
  if (!isObj(rec.claimed)) rec.claimed = {};
  return rec.claimed;
}
function achievementsView(user, ctx = {}) {
  const claimed = claimedAchievements(user);
  const items = ACHIEVEMENTS.map((a) => {
    const value = Math.min(a.target, Math.floor(a.value(user, ctx)));
    return { id: a.id, icon: a.icon, name: a.name, desc: a.desc, target: a.target, value, done: value >= a.target, claimed: Boolean(claimed[a.id]), gold: a.gold, xp: a.xp };
  });
  return { items, claimedCount: items.filter((i) => i.claimed).length, total: items.length };
}
function claimAchievement(user, id, ctx, now) {
  const a = ACHIEVEMENT_BY_ID[id];
  if (!a) return { status: 'invalid' };
  const claimed = claimedAchievements(user);
  if (claimed[a.id]) return { status: 'rejected', reason: 'claimed' };
  const value = Math.floor(a.value(user, ctx));
  if (value < a.target) return { status: 'rejected', reason: 'locked', value: Math.min(a.target, value), target: a.target };
  claimed[a.id] = now;
  const s = user.state;
  s.gold += a.gold; s.totalEarned += a.gold;
  return { status: 'ok', id: a.id, gold: a.gold, xp: a.xp ? grantXp(s, a.xp) : 0 };
}

// ---------------------------------------------------------------------------
// ⚔️ الساحة: تذكرة مباراة (رقم، بذرة، مستوى الخصم) يصدرها الخادم، والعميل يعيد الحركات فقط
// ---------------------------------------------------------------------------
const freshArena = () => ({ record: { wins: 0, losses: 0, draws: 0 }, ticket: null });
function normalizeArena(raw) {
  const o = (v) => ((v && typeof v === 'object' && !Array.isArray(v)) ? v : {});
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const a = o(raw); const rec = o(a.record); const t = o(a.ticket);
  const ticket = (Number.isSafeInteger(t.matchNo) && t.matchNo >= 1 && Number.isFinite(Number(t.seed)))
    ? { matchNo: t.matchNo, seed: Number(t.seed) >>> 0, level: Math.max(1, Math.floor(Number(t.level) || 1)), issuedAt: Number(t.issuedAt) || 0 }
    : null;
  return { record: { wins: n(rec.wins), losses: n(rec.losses), draws: n(rec.draws) }, ticket };
}
function issueArenaTicket(user, now) {
  const arena = user.sync.arena;
  arena.ticket = { matchNo: (arena.ticket?.matchNo || 0) + 1, seed: crypto.randomInt(0, 0x100000000), level: levelFromXp(user.state.xp), issuedAt: now };
  return arena.ticket;
}
// لاعب قديم (أو جديد) بلا تذكرة: تُصدر مرة واحدة داخل مسار كتابة (me/ops) فتبقى ثابتة حتى تُستهلك
function ensureArenaTicket(user, now) {
  if (!user.sync.arena.ticket) issueArenaTicket(user, now);
  return user.sync.arena.ticket;
}
const publicTicket = (t) => (t ? { matchNo: t.matchNo, seed: t.seed, level: t.level } : null);
function arenaView(user) {
  const a = user.sync.arena;
  return { ticket: publicTicket(a.ticket), record: { ...a.record }, winReward: ArenaRules.CONFIG.winReward, minIntervalMs: ARENA_RULES.minIntervalMs };
}
// مباراة مُبلَّغة: يجب أن تحمل رقم التذكرة الحالية، وتُعاد محاكاتها من بذرتها بحركات اللاعب فقط.
// كل تذكرة تُستهلك بمباراة واحدة (مقبولة أو مرفوضة) وتُصدر التالية في الرد نفسه.
function applyArena(user, op, now) {
  const s = user.state; const sync = user.sync; const arena = sync.arena;
  const ticket = arena.ticket;
  const matchNo = Number(op.matchNo);
  if (!ticket || !Number.isSafeInteger(matchNo)) return { status: 'invalid' };
  if (matchNo !== ticket.matchNo) return { status: 'rejected', reason: 'stale_match', matchNo: ticket.matchNo, ticket: publicTicket(ticket) };
  const moves = Array.isArray(op.moves) ? op.moves : null;
  if (!moves || !moves.length || moves.length > ArenaRules.CONFIG.maxRounds || moves.some((m) => !ArenaRules.ACTIONS.includes(m))) return { status: 'invalid' };
  const base = { consumed: true, matchNo, level: ticket.level, seed: ticket.seed };
  const replayed = ArenaRules.replay({ level: ticket.level, seed: ticket.seed, moves });
  if (!replayed.ok) {
    issueArenaTicket(user, now);
    return { ...base, status: 'rejected', reason: replayed.reason, ...(replayed.round ? { round: replayed.round } : {}), gold: 0, record: { ...arena.record }, ticket: publicTicket(arena.ticket) };
  }
  // مباراة أسرع من مهلات الواجهة نفسها لم تُلعب — لا تُحتسب حتى كخسارة
  if (now - ticket.issuedAt < ArenaRules.minDurationMs(replayed.enemyTurns) - ARENA_RULES.slackMs) {
    issueArenaTicket(user, now);
    return { ...base, status: 'rejected', reason: 'too_fast', gold: 0, record: { ...arena.record }, ticket: publicTicket(arena.ticket) };
  }
  const outcome = replayed.outcome;
  arena.record[outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws'] += 1;
  const r = { ...base, status: 'ok', outcome, rounds: replayed.rounds, gold: 0, xp: 0 };
  if (outcome === 'win') {
    const last = Number(sync.lastRewardAt.arena) || 0;
    if (now - last < ARENA_RULES.minIntervalMs) {
      r.status = 'too_soon'; r.retryAt = last + ARENA_RULES.minIntervalMs; // الفوز يُسجَّل، والمكافأة لا تتكرر قبل الفاصل
    } else {
      sync.lastRewardAt.arena = now;
      r.gold = ArenaRules.CONFIG.winReward;
      s.gold += r.gold; s.totalEarned += r.gold;
      r.xp = grantXp(s, XP_RULES.arenaWin);
      trackMission(user, 'arena', 1, now);
    }
  }
  issueArenaTicket(user, now);
  r.record = { ...arena.record };
  r.ticket = publicTicket(arena.ticket);
  return r;
}

const overlapSec = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / 1000;
const freshSync = (now = Date.now()) => ({ settledAt: now, energyAt: now, sessions: {}, lastRewardAt: {}, lastRunAt: 0, xpCarry: 0, missions: {}, missionsClaimed: 0, weeklyMissions: {}, weeklyClaimed: 0, achievements: {}, arena: freshArena(), platformDay: '', platformGold: 0 });

// تطبيع ملف لاعب (قديم أو جديد) دون تغيير أرصدته: دفتر مزامنة بقيم افتراضية، وقدرات مشتقة من المشتريات
function ensureSync(user) {
  const base = Number(user.lastSaveAt) || Number(user.updatedAt) || Date.now();
  const sync = (user.sync && typeof user.sync === 'object' && !Array.isArray(user.sync)) ? user.sync : {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  user.sync = {
    settledAt: Number.isFinite(sync.settledAt) ? sync.settledAt : base,
    energyAt: Number.isFinite(sync.energyAt) ? sync.energyAt : base,
    sessions: obj(sync.sessions),
    lastRewardAt: obj(sync.lastRewardAt),
    lastRunAt: Number.isFinite(sync.lastRunAt) ? sync.lastRunAt : 0,
    xpCarry: Number.isFinite(sync.xpCarry) ? sync.xpCarry : 0,
    missions: obj(sync.missions),
    missionsClaimed: Number.isFinite(sync.missionsClaimed) ? sync.missionsClaimed : 0,
    weeklyMissions: obj(sync.weeklyMissions),
    weeklyClaimed: Number.isFinite(sync.weeklyClaimed) ? sync.weeklyClaimed : 0,
    achievements: obj(sync.achievements),
    arena: normalizeArena(sync.arena),
    platformDay: typeof sync.platformDay === 'string' ? sync.platformDay : '',
    platformGold: Math.max(0, Math.floor(Number(sync.platformGold) || 0)),
  };
  user.revision = Number.isFinite(user.revision) ? user.revision : 0;
  user.state = deriveStats(sanitizeState(user.state, defaultState()));
  return user;
}

// الدخل السلبي يُحتسب من زمن الخادم فقط (حتى 8 ساعات غياب)، مضاعفاً خلال نافذة التعزيز الفعلية
function settlePassive(user, now) {
  const s = user.state; const sync = user.sync;
  const elapsedSec = Math.max(0, (now - sync.settledAt) / 1000);
  const effectiveSec = Math.min(elapsedSec, OFFLINE_CAP_SEC);
  const boostedSec = overlapSec(now - effectiveSec * 1000, now, s.boostUntil - BOOST_DURATION_MS, s.boostUntil);
  const gain = s.passiveIncome * (effectiveSec + boostedSec);
  if (gain > 0) { s.gold += gain; s.totalEarned += gain; }
  sync.settledAt = now;
  return { seconds: Math.floor(elapsedSec), gold: gain };
}

// الطاقة تُخزَّن كما كانت عند آخر تسوية تعدين؛ للعرض نُسقطها إلى الآن دون كتابة
function projectedState(user, now = Date.now()) {
  const s = user.state;
  const energy = Math.min(s.maxEnergy, s.energy + Math.max(0, (now - user.sync.energyAt) / 1000) * ENERGY_REGEN_PER_SEC);
  return { ...s, energy, lastSeen: now };
}

function parseOpsRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'طلب مزامنة غير صالح' };
  const session = String(body.session || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!session) return { error: 'معرّف جلسة مزامنة مفقود' };
  if (!Array.isArray(body.ops) || body.ops.length > MAX_OPS_PER_BATCH) return { error: 'قائمة عمليات غير صالحة' };
  const ops = [];
  let prev = 0;
  for (const raw of body.ops) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'عملية غير صالحة' };
    const seq = Number(raw.seq);
    if (!Number.isSafeInteger(seq) || seq <= prev) return { error: 'تسلسل عمليات غير صالح' };
    if (typeof raw.type !== 'string' || !OP_TYPES.has(raw.type)) return { error: 'نوع عملية غير معروف' };
    prev = seq;
    const str = (v) => (typeof v === 'string' ? v.slice(0, 32) : '');
    ops.push({
      seq, type: raw.type, clicks: raw.clicks, boosted: raw.boosted, item: str(raw.item), key: str(raw.key), id: str(raw.id), game: str(raw.game),
      score: raw.score, mode: str(raw.mode), boss: raw.boss === true,
      difficulty: str(raw.difficulty), gems: raw.gems, combo: raw.combo, duration: raw.duration, race: raw.race === true, ago: raw.ago,
      matchNo: raw.matchNo, moves: Array.isArray(raw.moves) ? raw.moves.slice(0, ArenaRules.CONFIG.maxRounds + 1).map((m) => str(m)) : undefined,
    });
  }
  return { session, ops, revision: Number.isSafeInteger(body.revision) ? body.revision : null };
}

// تطبيق دفعة عمليات على حالة موثوقة. يجب استدعاؤها داخل معاملة اللاعب وبعد settlePassive.
function applyOps(user, session, ops, now, ctx = {}) {
  const s = user.state; const sync = user.sync;
  const prevSeq = Number(sync.sessions[session]?.seq) || 0;
  let lastSeq = prevSeq;
  // ميزانية النقر منذ آخر تسوية طاقة: طاقة مخزّنة + تجدد (حتى 10 دقائق) ومعدل نقر أقصى، مع تسامح ثانية واحدة
  const windowSec = Math.max(0, (now - sync.energyAt) / 1000);
  const budgetSec = Math.min(windowSec, MINE_WINDOW_CAP_SEC);
  let clickBudget = Math.floor(budgetSec * MAX_CLICKS_PER_SEC) + MAX_CLICKS_PER_SEC;
  let energyBudget = s.energy + budgetSec * ENERGY_REGEN_PER_SEC;
  let boostedBudget = null;
  const computeBoostedBudget = () => {
    const overlap = overlapSec(now - budgetSec * 1000, now, s.boostUntil - BOOST_DURATION_MS, s.boostUntil);
    return Math.floor(overlap * MAX_CLICKS_PER_SEC) + ((overlap > 0 || s.boostUntil > now) ? MAX_CLICKS_PER_SEC : 0);
  };
  let energySpent = 0; let mined = false; let flagged = false;
  // خط زمني لجولات المغامرة داخل الدفعة: يبدأ من آخر جولة مقبولة (أو قبل 30 دقيقة على الأكثر)
  const timeline = {
    cursor: Math.max(Number(sync.lastRunAt) || 0, now - RUN_WINDOW_CAP_SEC * 1000),
    lastRewardEnd: Number(sync.lastRewardAt.adventure) || 0,
    ran: false,
  };
  const results = []; const ledger = [];
  const levelBefore = levelFromXp(s.xp);
  for (const op of ops) {
    if (op.seq <= lastSeq) { results.push({ seq: op.seq, type: op.type, status: 'duplicate' }); continue; }
    lastSeq = op.seq;
    const r = { seq: op.seq, type: op.type, status: 'ok' };
    let goldDelta = 0; let detail = null;
    switch (op.type) {
      case 'mine': {
        const clicks = Math.floor(clampNum(op.clicks, 0, 1e6, 0));
        const claimedBoosted = Math.floor(clampNum(op.boosted, 0, clicks, 0));
        if (boostedBudget === null) boostedBudget = computeBoostedBudget();
        const cp = s.clickPower;
        const accepted = Math.max(0, Math.min(clicks, clickBudget, Math.floor(energyBudget / cp)));
        const boosted = Math.max(0, Math.min(claimedBoosted, accepted, boostedBudget));
        const cost = accepted * cp;
        const gold = cost + boosted * cp; // النقرة المعزّزة تمنح الضعف بنفس تكلفة الطاقة
        clickBudget -= accepted; energyBudget -= cost; boostedBudget -= boosted; energySpent += cost; mined = true;
        s.gold += gold; s.totalEarned += gold;
        sync.xpCarry += cost;
        r.xp = grantXp(s, Math.floor(sync.xpCarry / XP_RULES.energyPerXp));
        sync.xpCarry %= XP_RULES.energyPerXp;
        trackMission(user, 'mine_energy', cost, now); trackMission(user, 'mine_gold', gold, now);
        Object.assign(r, { clicks: accepted, boosted, gold });
        if (accepted < clicks || boosted < claimedBoosted) { r.status = 'clamped'; flagged = true; }
        break;
      }
      case 'buy': {
        if (!UPGRADES_DEF[op.item]) { r.status = 'invalid'; break; }
        if (s.owned[op.item] >= 1e6) { r.status = 'rejected'; r.reason = 'max'; break; }
        const cost = costFor(op.item, s.owned[op.item]);
        r.cost = cost;
        if (s.gold < cost) { r.status = 'rejected'; r.reason = 'insufficient'; flagged = true; break; }
        s.gold -= cost; s.owned[op.item] += 1; deriveStats(s);
        r.xp = grantXp(s, cost / XP_RULES.costPerXp);
        trackMission(user, 'buy', 1, now);
        goldDelta = -cost; detail = { item: op.item, level: s.owned[op.item] };
        break;
      }
      case 'buy_adv': {
        const def = ADV_UPGRADES_DEF[op.key];
        if (!def) { r.status = 'invalid'; break; }
        const lvl = s.adventureUpgrades[op.key] || 0;
        if (lvl >= def.max) { r.status = 'rejected'; r.reason = 'max'; break; }
        const cost = advCostFor(op.key, lvl);
        r.cost = cost;
        if (s.gold < cost) { r.status = 'rejected'; r.reason = 'insufficient'; flagged = true; break; }
        s.gold -= cost; s.adventureUpgrades[op.key] = lvl + 1;
        r.xp = grantXp(s, cost / XP_RULES.costPerXp);
        trackMission(user, 'buy', 1, now);
        goldDelta = -cost; detail = { key: op.key, level: lvl + 1 };
        break;
      }
      case 'boost': {
        if (s.boostUntil > now) { r.status = 'active'; r.until = s.boostUntil; break; }
        if ((s.boostCooldownUntil || 0) > now) { r.status = 'cooldown'; r.retryAt = s.boostCooldownUntil; break; }
        s.boostUntil = now + BOOST_DURATION_MS;
        s.boostCooldownUntil = now + BOOST_COOLDOWN_MS;
        boostedBudget = null; // نقرات لاحقة في الدفعة نفسها تُقاس على النافذة الجديدة
        r.xp = grantXp(s, XP_RULES.boost);
        trackMission(user, 'boost', 1, now);
        r.until = s.boostUntil; detail = { until: s.boostUntil };
        break;
      }
      case 'run': {
        const run = applyRun(user, op, now, timeline);
        if (run.flagged) flagged = true;
        delete run.flagged;
        Object.assign(r, run);
        if (r.status === 'ok' || r.status === 'clamped') {
          timeline.ran = true;
          r.xp = grantXp(s, Math.floor(r.duration / XP_RULES.runSecPerXp) + Math.floor(r.gems / XP_RULES.runGemsPerXp) + (r.boss ? XP_RULES.bossKill : 0));
          trackMission(user, 'runs', 1, now); trackMission(user, 'gems', r.gems, now); trackMission(user, 'score', r.score, now);
          trackMission(user, 'play_time', r.duration, now);
          if (r.boss) trackMission(user, 'boss', 1, now);
          if (r.mode === 'survival') trackMission(user, 'survival', r.score, now);
          goldDelta = r.gold;
          detail = { mode: r.mode, difficulty: r.difficulty, score: r.score, gems: r.gems, combo: r.combo, duration: r.duration, boss: r.boss, race: r.race, zones: r.zones };
        }
        break;
      }
      case 'reward': {
        // توافق مع صفحات مخبأة: لا مكافأة يعلنها العميل بنفسه — الساحة عبر `arena` والمغامرة عبر `run`
        r.status = 'invalid';
        if (op.game === 'adventure') r.reason = 'use_run';
        else if (op.game === 'arena') r.reason = 'use_arena';
        break;
      }
      case 'arena': {
        const match = applyArena(user, op, now);
        Object.assign(r, match);
        if (match.consumed) {
          if (match.status === 'rejected') flagged = true; // حركات لا تطابق المحاكاة = ادعاء غير مطابق
          goldDelta = match.gold || 0;
          detail = { matchNo: match.matchNo, status: match.status, outcome: match.outcome || null, reason: match.reason || null, rounds: match.rounds || 0, level: match.level, seed: match.seed };
        }
        break;
      }
      case 'mission': {
        const claim = claimMission(user, op.key, now);
        Object.assign(r, claim);
        if (claim.status === 'ok') { goldDelta = claim.gold; detail = { key: claim.key, day: claim.day, xp: claim.xp }; }
        break;
      }
      case 'weekly_mission': {
        const claim = claimWeeklyMission(user, op.key, now);
        Object.assign(r, claim);
        if (claim.status === 'ok') { goldDelta = claim.gold; detail = { key: claim.key, week: claim.week, xp: claim.xp }; }
        break;
      }
      case 'achievement': {
        const claim = claimAchievement(user, op.id, ctx, now);
        Object.assign(r, claim);
        if (claim.status === 'ok') { goldDelta = claim.gold; detail = { id: claim.id, xp: claim.xp }; }
        break;
      }
      default: r.status = 'invalid';
    }
    results.push(r);
    if (detail) ledger.push({ session, seq: op.seq, kind: op.type, detail, goldDelta, at: now });
  }
  if (mined) {
    // ما تبقى من الطاقة: المخزون + التجدد الكامل للنافذة − ما أُنفق، ولا يتجاوز الحد (الإنفاق لا يُنشئ طاقة)
    s.energy = Math.max(0, Math.min(s.maxEnergy, s.energy + windowSec * ENERGY_REGEN_PER_SEC - energySpent));
    sync.energyAt = now;
  }
  if (timeline.ran) {
    sync.lastRunAt = timeline.cursor;
    if (timeline.lastRewardEnd) sync.lastRewardAt.adventure = timeline.lastRewardEnd;
  }
  sync.sessions[session] = { seq: lastSeq, at: now };
  const ids = Object.keys(sync.sessions);
  if (ids.length > MAX_SESSIONS_TRACKED) {
    ids.sort((a, b) => (sync.sessions[b].at || 0) - (sync.sessions[a].at || 0));
    for (const id of ids.slice(MAX_SESSIONS_TRACKED)) delete sync.sessions[id];
  }
  const levelAfter = levelFromXp(s.xp);
  return {
    results, ledger, flagged, lastSeq,
    applied: results.filter((r) => r.status !== 'duplicate').length,
    levelUp: levelAfter > levelBefore ? { from: levelBefore, to: levelAfter } : null,
  };
}

// ---------------------------------------------------------------------------
// أدوات اليومية/المستوى/الملف الشخصي
// ---------------------------------------------------------------------------
const dayStr = (d = new Date()) => d.toISOString().slice(0, 10);
// مستوى صف قد لا يكون مُحمَّلاً عبر ensureSync بعد (لوحة الصدارة): خبرة مخزّنة أو المكافئ القديم
const levelOfRow = (state) => levelFromXp((state && state.xp !== undefined && state.xp !== null) ? state.xp : legacyXp(state?.totalEarned));

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
    revision: 0,
    sync: freshSync(now),
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

function profileOf(user, isNew = false, extra = {}) {
  const now = Date.now();
  return {
    user: { id: user.id, name: user.name },
    state: projectedState(user, now),
    progress: progressOf(user.state),
    missions: missionsView(user, now),
    weeklyMissions: weeklyMissionsView(user, now),
    achievements: achievementsView(user, { raceWins: extra.race?.wins || 0 }),
    arena: arenaView(user),
    revision: user.revision,
    referralCount: user.referralCount,
    referralEarnings: user.referralEarnings,
    referredBy: user.referredBy,
    daily: dailyInfo(user),
    isNew,
    serverTime: now,
    ...extra,
  };
}

// جلب/تحضير ملف اللاعب داخل معاملته (يستدعيه تكامل منجم المنصّة): إنشاء عند الحاجة
// وضمان دفتر المزامنة وتذكرة الساحة — دون تعديل الأرصدة أو منح مكافآت من هنا.
async function prepare(player) {
  const now = Date.now();
  let user = await store.getUser(player.id);
  if (!user) {
    user = await createUser(player.id, player.name);
    ensureArenaTicket(user, now);
    await store.putUser(user);
  } else {
    ensureSync(user);
    ensureArenaTicket(user, now);
    if (player.name && user.name !== player.name && player.name !== 'ضيف') user.name = player.name;
  }
  return user;
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
        revision: 0, sync: freshSync(u.updatedAt || Date.now()),
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
  const authDateRaw = params.get('auth_date');
  const authDate = Number(authDateRaw);
  const nowSeconds = Math.floor(Date.now() / 1000);
  // ارفض التاريخ المفقود/غير الرقمي/المستقبلي بشكل غير معقول/الأقدم من 24 ساعة.
  if (!authDateRaw || !Number.isFinite(authDate) || authDate <= 0
      || authDate > nowSeconds + 30 || nowSeconds - authDate > 86400) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

function parseInitDataUser(initData) { // بدون توكن لا يمكن التحقق — للتطوير فقط
  try { return JSON.parse(new URLSearchParams(initData).get('user') || 'null'); } catch { return null; }
}

// مصدر واحد لقرار الهوية لكل المسارات (HTTP وWebSocket): initData موقّع بالتوكن، أو بلا توقيع
// في التطوير فقط، أو ضيف عند السماح به. يعيد { player } أو { error } دون أي تراجع صامت.
function authenticate(initData, rawGuestId) {
  if (initData) {
    const tgUser = BOT_TOKEN
      ? validateInitData(initData)
      : (!IS_PRODUCTION && ALLOW_GUEST ? parseInitDataUser(initData) : null);
    if (!tgUser?.id) return { error: 'بيانات تيليجرام غير صالحة أو منتهية — أعد فتح اللعبة من البوت' };
    return { player: { id: String(tgUser.id), name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'معدّن أسطوري' } };
  }
  const guestId = String(rawGuestId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (guestId && ALLOW_GUEST && !IS_PRODUCTION) return { player: { id: `guest_${guestId}`, name: 'ضيف' } };
  return { error: BOT_TOKEN ? 'افتح اللعبة من داخل تيليجرام' : 'مصادقة مفقودة' };
}

function requireAuth(req, res, next) {
  const initData = req.get('x-telegram-init-data') || (req.get('authorization') || '').replace(/^tma\s+/i, '');
  const auth = authenticate(initData, req.get('x-guest-id'));
  if (!auth.player) return res.status(401).json({ error: auth.error });
  req.player = auth.player;
  return next();
}

// تحديد معدّل بسيط حسب اللاعب/العنوان لكل مسار
// المفتاح: اللاعب الموثَّق، وإلا عنوان العميل كما يحدده trust proxy (لا يُقبل X-Forwarded-For من العميل مباشرة)
const RATE_LIMITER = createRateLimiter({ windowMs: 60_000, maxKeys: Number(process.env.RATE_LIMIT_MAX_KEYS) || 10_000 });
function rateLimit(name, maxPerMinute) {
  return (req, res, next) => {
    const verdict = RATE_LIMITER.hit(`${name}:${req.player?.id || req.ip}`, maxPerMinute);
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000))));
      return res.status(429).json({ error: 'طلبات كثيرة جداً — انتظر قليلاً' });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
// Render يضع بروكسي واحداً أمام الخدمة: نثق بآخر X-Forwarded-For يضيفه هو فقط، لا بما يرسله العميل
app.set('trust proxy', CONFIG.trustProxyHops);
app.use(securityHeaders({ production: IS_PRODUCTION }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const asyncRoute = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('خطأ API:', e);
  if (!res.headersSent) res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

app.get('/health', asyncRoute(async (req, res) => {
  res.json({ ok: true, bot: Boolean(BOT_TOKEN), botMode: CONFIG.botMode, db: store.driver, users: await store.countUsers() });
}));

// إعدادات عامة للواجهة: اسم مستخدم البوت فقط (لروابط الدعوة) — لا أسرار ولا رابط Webhook
app.get('/api/config', rateLimit('config', 60), (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ botUsername: botUsername || null });
});

// جلب/إنشاء ملف اللاعب — يعالج الدعوات عند أول دخول (?ref=ref_<id>) ويسوّي الدخل السلبي خادمياً
app.get('/api/me', requireAuth, rateLimit('me', 60), asyncRoute(async (req, res) => {
  const refId = String(req.query.ref || '').replace(/^ref_/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  // سباقات WebSocket يختمها الخادم بنفسه — إجماليها إحصاء موثوق للمغامرة والإنجازات (قراءة فقط خارج معاملة اللاعب)
  const race = await store.raceTotals(req.player.id);
  const result = await store.withUsers([req.player.id, ...(refId ? [refId] : [])], async () => {
    const now = Date.now();
    let user = await store.getUser(req.player.id);
    let isNew = false;
    let offline = { seconds: 0, gold: 0 };
    if (!user) {
      user = await createUser(req.player.id, req.player.name);
      ensureArenaTicket(user, now);
      isNew = true;
      if (refId && refId !== user.id) {
        user.referredBy = refId;
        const inviter = await store.getUser(refId);
        if (inviter) {
          ensureSync(inviter);
          inviter.state.gold += REFERRAL_REWARD;
          inviter.state.totalEarned += REFERRAL_REWARD;
          grantXp(inviter.state, XP_RULES.referral);
          inviter.referralCount += 1;
          inviter.referralEarnings += REFERRAL_REWARD;
          inviter.revision += 1; // يصل الداعي عبر حالته الموثوقة في مزامنته التالية
          inviter.updatedAt = now;
          await store.putUser(inviter);
        } else {
          await store.addPending(refId);
        }
      }
      await store.putUser(user);
    } else {
      ensureSync(user);
      ensureArenaTicket(user, now);
      if (req.player.name && user.name !== req.player.name && req.player.name !== 'ضيف') user.name = req.player.name;
      offline = settlePassive(user, now);
      user.unackedCredits = 0;
      user.revision += 1;
      user.updatedAt = now;
      await store.putUser(user);
    }
    return profileOf(user, isNew, { offline: { seconds: offline.seconds, gold: Math.floor(offline.gold) }, race });
  });
  // Do not acknowledge a reward or save until the database commit succeeded.
  res.json(result);
}));

// 🔁 المزامنة الموثوقة: دفعة عمليات مرقّمة لكل جلسة؛ إعادة الإرسال آمنة (التكرار يُتجاهل)
app.post('/api/ops', requireAuth, rateLimit('ops', 120), asyncRoute(async (req, res) => {
  const parsed = parseOpsRequest(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const ctx = { raceWins: (await store.raceTotals(req.player.id)).wins || 0 };
  const result = await store.withUsers([req.player.id], async () => {
    const now = Date.now();
    let user = await store.getUser(req.player.id);
    if (!user) user = await createUser(req.player.id, req.player.name);
    ensureSync(user);
    ensureArenaTicket(user, now);
    settlePassive(user, now);
    const outcome = applyOps(user, parsed.session, parsed.ops, now, ctx);
    if (outcome.flagged) user.violations += 1;
    if (outcome.ledger.length) await store.appendLedger(user.id, outcome.ledger);
    user.unackedCredits = 0;
    user.revision += 1;
    user.lastSaveAt = now;
    user.updatedAt = now;
    await store.putUser(user);
    return {
      ok: true,
      revision: user.revision,
      staleClient: parsed.revision !== null && parsed.revision < user.revision - 1,
      sessionSeq: outcome.lastSeq,
      applied: outcome.applied,
      results: outcome.results,
      violations: user.violations,
      state: projectedState(user, now),
      progress: progressOf(user.state),
      levelUp: outcome.levelUp,
      missions: missionsView(user, now),
      weeklyMissions: weeklyMissionsView(user, now),
      achievements: achievementsView(user, ctx),
      arena: arenaView(user),
      referralCount: user.referralCount,
      referralEarnings: user.referralEarnings,
      daily: dailyInfo(user),
      serverTime: now,
    };
  });
  res.json(result);
}));

// توافق مع عملاء قدامى (صفحة مخبأة قبل بروتوكول العمليات): لا يُقبل أي رصيد أو ترقية من الحالة المرسلة؛
// يُعاد لهم ملف الخادم الموثوق فقط، وبعد إعادة التحميل يستخدم العميل /api/ops.
app.post('/api/save', requireAuth, rateLimit('save', 120), asyncRoute(async (req, res) => {
  if (!req.body?.state || typeof req.body.state !== 'object' || Array.isArray(req.body.state)) {
    return res.status(400).json({ error: 'حالة حفظ غير صالحة' });
  }
  const result = await store.withUsers([req.player.id], async () => {
    const now = Date.now();
    let user = await store.getUser(req.player.id);
    if (!user) user = await createUser(req.player.id, req.player.name);
    ensureSync(user);
    settlePassive(user, now);
    user.unackedCredits = 0;
    user.revision += 1;
    user.lastSaveAt = now;
    user.updatedAt = now;
    await store.putUser(user);
    const state = projectedState(user, now);
    const claimed = sanitizeState(req.body.state, user.state);
    const corrected = Math.floor(claimed.gold) !== Math.floor(state.gold)
      || JSON.stringify(claimed.owned) !== JSON.stringify(state.owned)
      || JSON.stringify(claimed.adventureUpgrades) !== JSON.stringify(state.adventureUpgrades);
    return { ok: true, legacy: true, corrected, violations: user.violations, serverCreditsApplied: 0, state, progress: progressOf(user.state), revision: user.revision, serverTime: now };
  });
  res.json(result);
}));

app.post('/api/claim-daily', requireAuth, rateLimit('daily', 10), asyncRoute(async (req, res) => {
  const ctx = { raceWins: (await store.raceTotals(req.player.id)).wins || 0 };
  const result = await store.withUsers([req.player.id], async () => {
    const now = Date.now();
    let user = await store.getUser(req.player.id);
    if (!user) user = await createUser(req.player.id, req.player.name);
    ensureSync(user);
    const info = dailyInfo(user);
    if (!info.canClaim) return { status: 409, body: { error: 'استلمت مكافأة اليوم — عُد غداً!', daily: info } };
    settlePassive(user, now);
    user.dailyStreak = info.streak;
    user.dailyLastClaim = info.today;
    user.state.gold += info.reward;
    user.state.totalEarned += info.reward;
    const levelBefore = levelFromXp(user.state.xp);
    const xp = grantXp(user.state, Math.min(XP_RULES.dailyMax, XP_RULES.dailyBase + XP_RULES.dailyPerStreak * info.streak));
    const levelAfter = levelFromXp(user.state.xp);
    user.revision += 1;
    user.lastSaveAt = now;
    user.updatedAt = now;
    await store.putUser(user);
    return { status: 200, body: { ok: true, reward: info.reward, xp, state: projectedState(user, now), progress: progressOf(user.state), levelUp: levelAfter > levelBefore ? { from: levelBefore, to: levelAfter } : null, missions: missionsView(user, now), weeklyMissions: weeklyMissionsView(user, now), achievements: achievementsView(user, ctx), arena: arenaView(user), revision: user.revision, daily: dailyInfo(user), serverTime: now } };
  });
  res.status(result.status).json(result.body);
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
      level: levelOfRow(u.state),
    })),
  });
}));

// ---------------------------------------------------------------------------
// 🧭 منجم المنصّة (اللعبة الجانبية الحتمية): بداية الجولة وإنهاؤها بإعادة تشغيل
// الخادم للحركات المسجّلة مع مكافأة افتراضية واحدة مضمونة المعاملة — نفس المصادقة
// وتحديد المعدل ومعالجة الأخطاء المعتمدة أعلاه (platform-api.js).
// ---------------------------------------------------------------------------
mountPlatform({ app, store, requireAuth, rateLimit, asyncRoute, prepare, profileOf, grantXp, trackMission, now: Date.now });

// ---------------------------------------------------------------------------
// ⚔️ سباقات لاعب ضد لاعب مباشرة (WebSocket) — غرف سريعة أو برمز خاص
// الخادم يقرّن اللاعبين ويبث التقدم والنتائج؛ محاكاة اللعبة نفسها عند العميل
// بنفس بذرة عشوائية للطرفين، والنتيجة تُختم بسقف نقاط معقول لمدة السباق.
// ---------------------------------------------------------------------------
// قواعد السباق (race-rules.js): الخادم يقرر المدة ويبلّغها، ويختم النتيجة بنفسه عند اكتمال الطرفين أو انتهاء المهلة أو انسحاب طرف.
const RACE_RULES = raceRulesFromEnv();
const raceRooms = new Map();
let raceQueue = [];
const sendWs = (ws, obj) => { try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch (_) {} };
// سقف نتيجة لاعب لحظة الإبلاغ: لا يتجاوز ما يسمح به زمن السباق ولا يقفز فوق آخر تقدّم أبلغه هو
const raceCap = (room, playerId, rawScore, now) => raceCapRule(RACE_RULES, { startAt: room.startAt || now, last: room.track.get(playerId) || null }, rawScore, now);
function beginRaceRound(room, players) {
  room.state = 'racing';
  room.seed = Math.floor(Math.random() * 2 ** 31);
  room.startAt = Date.now() + 2500;
  room.startedAt = Date.now();
  room.results = new Map();
  room.track = new Map();
  clearTimeout(room.timer);
  // الخادم ينهي السباق بنفسه إن لم يصل إنهاء طرف قبل المهلة: آخر تقدّم مُبلَّغ هو نتيجته
  room.timer = setTimeout(() => {
    settleRace(room, 'timeout').then((outcome) => announceRace(room, outcome)).catch((e) => console.error('تعذّر ختم سباق منتهي الوقت:', e.message));
  }, raceDeadline(RACE_RULES, room.startAt) - Date.now());
  room.timer.unref?.();
  for (const p of players) {
    p.player.ready = false;
    const opp = players.find((q) => q !== p);
    sendWs(p, { type: 'start', seed: room.seed, startAt: room.startAt, duration: RACE_RULES.durationSec, opponent: { id: opp.player.id, name: opp.player.name } });
  }
}
// إعلان نتيجة مختومة لطرفي غرفة ما زالت قائمة (قد تُحذف الغرفة أثناء التخزين بانقطاع/انتقال)
function announceRace(room, outcome) {
  if (!outcome || raceRooms.get(room.id) !== room || room.players.size !== 2) return;
  room.state = 'finished';
  for (const p of room.players) sendWs(p, { type: 'result', reason: outcome.reason, winnerId: outcome.winnerId, results: outcome.results });
}
// ختم السباق: اكتمال النتيجتين، أو انتهاء المهلة (آخر تقدّم لمن لم يُنهِ)، أو انسحاب (الباقي يفوز مهما كانت النقاط)
async function settleRace(room, reason, { forfeitBy = null, players = null } = {}) {
  if (room.state !== 'racing') return null;
  clearTimeout(room.timer); room.timer = null;
  const now = Date.now();
  const list = players || [...room.players];
  for (const p of list) {
    if (room.results.has(p.player.id)) continue;
    const last = room.track.get(p.player.id);
    room.results.set(p.player.id, { id: p.player.id, name: p.player.name, score: last ? last.score : 0, timedOut: reason === 'timeout', flagged: false });
  }
  const results = [...room.results.values()].map((r) => ({ ...r, forfeited: r.id === forfeitBy })).sort((a, b) => b.score - a.score);
  if (results.length < 2) { room.state = 'finished'; return null; }
  const winnerId = decideWinner(results, forfeitBy);
  room.state = 'settling';
  room.outcome = { reason, winnerId, results };
  // 🏆 تسجيل البطولة الأسبوعية قبل إعلان النتيجة — السطران في معاملة واحدة (فشل التخزين لا يعطّل السباق)
  try {
    await store.recordRaceResults(currentWeekKey(), results.map((r) => ({ ...r, won: winnerId === r.id })));
  } catch (e) { console.error('تعذّر تسجيل نتيجة سباق:', e.message); }
  return room.outcome;
}
const raceCode = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return raceRooms.has(code) ? raceCode() : code;
};

function setupMultiplayer(httpServer) {
  if (!WebSocketServer) return; // السباقات معطّلة فقط — بقية اللعبة تعمل
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 4096 });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const auth = authenticate(url.searchParams.get('initData') || '', url.searchParams.get('guest'));
    const player = auth.player || null;
    if (!player) { ws.close(4001, 'auth required'); return; }
    try { const dbUser = await store.getUser(player.id); if (dbUser?.name && dbUser.name !== 'ضيف') player.name = dbUser.name; } catch (_) {}

    if (ws.readyState !== ws.OPEN) return;
    ws.player = { ...player, roomId: null, ready: false, lastProgress: 0 };
    sendWs(ws, { type: 'welcome', id: player.id, name: player.name });

    const leaveRoom = (notify = true) => {
      raceQueue = raceQueue.filter((q) => q !== ws);
      const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
      ws.player.roomId = null;
      ws.player.ready = false;
      if (!room) return;
      // أغلق الغرفة بالكامل عند مغادرة أحد اللاعبين؛ لا تترك خصماً عالقاً في غرفة سباق منتهية.
      raceRooms.delete(room.id);
      clearTimeout(room.timer); room.timer = null;
      const racingState = ['racing', 'settling'].includes(room.state);
      // انسحاب بعد بداية السباق فعلياً = خسارة للمنسحب وفوز مسجّل للباقي (يُعلَن فوراً ويُحفظ خلفياً)
      const forfeit = room.state === 'racing' && room.players.size === 2 && forfeitAllowed(RACE_RULES, room.startAt || Infinity, Date.now());
      const others = [...room.players].filter((o) => o !== ws);
      let outcome = null;
      if (forfeit) {
        const snapshot = [...room.players];
        const settled = settleRace(room, 'forfeit', { forfeitBy: ws.player.id, players: snapshot });
        settled.catch(() => {});
        outcome = room.outcome;
      }
      for (const other of others) {
        other.player.roomId = null;
        other.player.ready = false;
        if (notify) sendWs(other, {
          type: racingState ? 'opponent_left' : 'room_closed',
          message: racingState ? (outcome ? 'انسحب الخصم — سُجّل الفوز لك' : 'غادر الخصم — يمكنك بدء سباق جديد') : 'أُغلقت الغرفة — أنشئ غرفة جديدة',
          ...(outcome ? { forfeit: true, winnerId: outcome.winnerId, results: outcome.results } : {}),
        });
      }
      room.players.clear();
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
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return;

      try {
        if (msg.type === 'quick') {
          leaveRoom(true);
          raceQueue = raceQueue.filter((q) => q.readyState === q.OPEN && q !== ws);
          const otherIndex = raceQueue.findIndex((q) => q.player.id !== ws.player.id);
          const other = otherIndex >= 0 ? raceQueue.splice(otherIndex, 1)[0] : null;
          if (other) {
            const room = { id: raceCode(), code: 'سريع', players: new Set(), state: 'lobby', results: new Map(), rematchRequests: new Set() };
            raceRooms.set(room.id, room);
            pairInto(room, other);
          }
          else { raceQueue.push(ws); sendWs(ws, { type: 'waiting', message: 'بانتظار خصم…' }); }
        }

        if (msg.type === 'create') {
          leaveRoom(true);
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
          if (host.player.id === ws.player.id) {
            sendWs(ws, { type: 'error', message: 'لا يمكنك التسابق مع حسابك نفسه' });
            return;
          }
          // Validate the destination first, then detach from any previous room.
          leaveRoom(true);
          pairInto(room, host);
        }

        if (msg.type === 'ready') {
          const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
          if (!room || room.state !== 'lobby' || room.players.size !== 2 || !room.players.has(ws)) return;
          ws.player.ready = true;
          const players = [...room.players];
          if (players.every((p) => p.player.ready)) beginRaceRound(room, players);
        }

        if (msg.type === 'progress') {
          if (![msg.score, msg.lives, msg.xRatio].every(Number.isFinite)) return;
          const now = Date.now();
          if (now - ws.player.lastProgress < 100) return;
          ws.player.lastProgress = now;
          const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
          if (!room || room.state !== 'racing' || !room.players.has(ws)) return;
          // التقدّم يُقصّ بنفس سقوف النتيجة ويُحفظ كآخر نقاط معروفة (نتيجة اللاعب إن انتهى الوقت أو انسحب)
          const tracked = now >= (room.startAt || 0) && !room.results.has(ws.player.id) ? raceCap(room, ws.player.id, msg.score, now) : null;
          if (tracked) room.track.set(ws.player.id, { score: tracked.score, at: now });
          const payload = {
            type: 'opponent_progress',
            score: tracked ? tracked.score : Math.max(0, Math.min(RACE_RULES.scoreBase, Number(msg.score) || 0)),
            lives: Math.max(0, Math.min(5, Number(msg.lives) || 0)),
            xRatio: Math.max(0, Math.min(1, Number(msg.xRatio) || 0.5)),
            finished: Boolean(msg.finished),
          };
          for (const other of room.players) if (other !== ws) sendWs(other, payload);
        }

        if (msg.type === 'finish') {
          if (!Number.isFinite(msg.score) || msg.score < 0) return;
          const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
          if (!room || room.state !== 'racing' || !room.players.has(ws)) return;
          // لا نقبل إنهاء قبل وقت البداية، ولا نسمح بتغيير نتيجة اللاعب بعد ختمها.
          const nowFinish = Date.now();
          if (nowFinish < (room.startAt || 0) || room.results.has(ws.player.id)) return;
          // سقفان: زمن السباق (45/ث + 100 حتى مدته) وآخر تقدّم مُبلَّغ (+ قفزة واحدة)
          const { score, flagged } = raceCap(room, ws.player.id, msg.score, nowFinish);
          room.results.set(ws.player.id, { id: ws.player.id, name: ws.player.name, score, flagged, timedOut: false });
          room.track.set(ws.player.id, { score, at: nowFinish });
          for (const other of room.players) if (other !== ws) sendWs(other, { type: 'opponent_finished', score });
          if (room.results.size >= 2) {
            // Keep rematch/ready blocked until asynchronous persistence completes.
            const outcome = await settleRace(room, 'finished');
            announceRace(room, outcome); // A disconnect/switch can delete this room while storage is in flight.
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
            beginRaceRound(room, players);
          }
        }

        if (msg.type === 'leave') leaveRoom(true);
      } catch (error) {
        // Avoid unhandled rejections and never log player messages or auth data.
        console.error('خطأ معالجة رسالة سباق:', error.code || 'internal');
        sendWs(ws, { type: 'error', message: 'تعذّر تنفيذ طلب السباق — حاول مجددًا' });
      }
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
let httpServer = null;
// Render المجانية تنام بعد 15 دقيقة بلا طلبات واردة (render.com/docs/free): الـ long-polling يتوقف معها
// فلا يرد البوت على /start، بينما طلب webhook الوارد من Telegram يوقظ الخدمة ويعيد Telegram المحاولة عند الفشل.
// لذلك webhook هو الافتراضي في الإنتاج متى توفر رابط https، وpolling للتطوير المحلي (BOT_MODE يتجاوز ذلك).
const WEBHOOK_PATH = BOT_TOKEN ? `/telegram/webhook/${crypto.createHash('sha256').update(BOT_TOKEN).digest('hex').slice(0, 32)}` : '';
const WEBHOOK_SECRET = BOT_TOKEN
  ? (CONFIG.webhookSecret || crypto.createHmac('sha256', BOT_TOKEN).update('telegram-webhook-secret').digest('hex').slice(0, 64))
  : '';
// معرّفات التحديثات المعالجة/الجارية: Telegram يعيد إرسال التحديث إن لم يصله 200، فلا يُعالج مرتين
const handledUpdates = new Map();
function rememberUpdate(id) {
  handledUpdates.delete(id); handledUpdates.set(id, Date.now());
  while (handledUpdates.size > 2000) handledUpdates.delete(handledUpdates.keys().next().value);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    const appUrl = CONFIG.appUrl || 'https://your-domain.com';
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

  if (CONFIG.botMode === 'webhook') {
    app.post(WEBHOOK_PATH, async (req, res) => {
      if (!safeEqual(req.get('x-telegram-bot-api-secret-token') || '', WEBHOOK_SECRET)) return res.sendStatus(401);
      const id = req.body?.update_id;
      if (!Number.isSafeInteger(id)) return res.sendStatus(400);
      if (handledUpdates.has(id)) return res.sendStatus(200);
      rememberUpdate(id);
      try {
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
      } catch (err) {
        handledUpdates.delete(id); // فشل غير متوقع: نسمح لإعادة محاولة Telegram بمعالجته
        console.error('خطأ في معالجة تحديث webhook:', err.message);
        res.sendStatus(500);
      }
    });
  }

  // لا نترك فشل تهيئة البوت (توكن خاطئ/شبكة) يُسقط خادم اللعبة
  (async () => {
    const me = await bot.telegram.getMe();
    bot.botInfo = me;
    if (!botUsername) botUsername = me.username || '';
    if (CONFIG.botMode === 'webhook') {
      await bot.telegram.setWebhook(`${CONFIG.appUrl}${WEBHOOK_PATH}`, {
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
      });
      console.log(`🤖 بوت تيليجرام @${me.username} يعمل بوضع webhook`);
    } else {
      await bot.launch();
      console.log(`🤖 بوت تيليجرام @${me.username} يعمل بوضع polling`);
    }
  })().catch((err) => console.error('خطأ في تشغيل البوت (سيستمر خادم الويب):', err.message));
} else {
  console.log('⚠️  لم يتم وضع BOT_TOKEN (انسخ .env.example إلى .env)، سيعمل خادم الويب فقط بوضع الضيف.');
}

// إيقاف نظيف: إيقاف polling (إن وُجد) وإغلاق الخادم ثم قاعدة البيانات. لا نحذف الـ webhook: نسخة النشر الجديدة تخدمه
function shutdown(signal) {
  if (bot && CONFIG.botMode === 'polling') { try { bot.stop(signal); } catch (_) { /* already stopped */ } }
  const finish = () => Promise.resolve(store.close?.()).catch(() => {}).finally(() => process.exit(0));
  if (httpServer) { httpServer.close(finish); setTimeout(finish, 5000).unref(); } else finish();
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

migrateLegacyJson().finally(() => {
  httpServer = app.listen(PORT, HOST, () => {
    console.log(`🎮 خادم اللعبة يعمل الآن على: http://localhost:${PORT}`);
  });
  setupMultiplayer(httpServer);
});
