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
// وضع الضيف للتطوير فقط عند غياب التوكن؛ في الإنتاج لا يُسمح به إلا بتفعيل صريح.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOW_GUEST = process.env.ALLOW_GUEST_AUTH === 'true'
  || (!BOT_TOKEN && !IS_PRODUCTION && process.env.ALLOW_GUEST_AUTH !== 'false');
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
const OP_TYPES = new Set(['mine', 'buy', 'buy_adv', 'boost', 'reward', 'run', 'mission']);
// جولة مغامرة: الوضع يحدد المدة القصوى وسقف المكافأة ومعاملها (مطابق للواجهة)
const ADV_RUN_MODES = {
  classic: { maxSec: 60, scale: 1, cap: 100 },
  blitz: { maxSec: 30, scale: 1.15, cap: 100 },
  survival: { maxSec: 3600, scale: 1.4, cap: 150 },
  boss: { maxSec: 75, scale: 1.1, cap: 100 },
};
const ADV_DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
// مكافآت الألعاب المصغّرة الأخرى ما زالت نتائج يبلّغ عنها العميل، لكنها محدودة خادمياً
// بفاصل زمني أدنى وتُسجَّل في دفتر العمليات. جولات المغامرة لها عملية `run` خاصة بها.
const REWARD_RULES = {
  arena: { minIntervalMs: 10_000, compute: () => 50 },
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
function trackMission(user, key, amount, now) {
  const def = MISSION_BY_KEY[key];
  const value = Math.max(0, Number(amount) || 0);
  if (!def || value <= 0) return;
  for (const item of ensureMissions(user, now).items) {
    if (item.key !== key || item.claimed) continue;
    item.progress = def.mode === 'max' ? Math.max(item.progress || 0, value) : Math.min(def.target, (item.progress || 0) + value);
  }
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
  s.gold += def.gold; s.totalEarned += def.gold;
  return { status: 'ok', key, gold: def.gold, xp: grantXp(s, def.xp), day: m.day };
}

const overlapSec = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / 1000;
const freshSync = (now = Date.now()) => ({ settledAt: now, energyAt: now, sessions: {}, lastRewardAt: {}, lastRunAt: 0, xpCarry: 0 });

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
      seq, type: raw.type, clicks: raw.clicks, boosted: raw.boosted, item: str(raw.item), key: str(raw.key), game: str(raw.game),
      score: raw.score, mode: str(raw.mode), boss: raw.boss === true,
      difficulty: str(raw.difficulty), gems: raw.gems, combo: raw.combo, duration: raw.duration, race: raw.race === true, ago: raw.ago,
    });
  }
  return { session, ops, revision: Number.isSafeInteger(body.revision) ? body.revision : null };
}

// تطبيق دفعة عمليات على حالة موثوقة. يجب استدعاؤها داخل معاملة اللاعب وبعد settlePassive.
function applyOps(user, session, ops, now) {
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
        const rule = REWARD_RULES[op.game];
        if (!rule) { r.status = 'invalid'; if (op.game === 'adventure') r.reason = 'use_run'; break; }
        const last = Number(sync.lastRewardAt[op.game]) || 0;
        if (now - last < rule.minIntervalMs) { r.status = 'too_soon'; r.gold = 0; r.retryAt = last + rule.minIntervalMs; break; }
        const gold = rule.compute(op);
        r.gold = gold;
        if (gold <= 0) break; // جولة بلا جائزة لا تستهلك الفاصل الزمني
        sync.lastRewardAt[op.game] = now;
        s.gold += gold; s.totalEarned += gold;
        if (op.game === 'arena') { r.xp = grantXp(s, XP_RULES.arenaWin); trackMission(user, 'arena', 1, now); }
        goldDelta = gold; detail = { game: op.game, mode: op.mode || null, score: Math.floor(clampNum(op.score, 0, 100_000, 0)), boss: op.boss === true };
        break;
      }
      case 'mission': {
        const claim = claimMission(user, op.key, now);
        Object.assign(r, claim);
        if (claim.status === 'ok') { goldDelta = claim.gold; detail = { key: claim.key, day: claim.day, xp: claim.xp }; }
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

function requireAuth(req, res, next) {
  const initData = req.get('x-telegram-init-data') || (req.get('authorization') || '').replace(/^tma\s+/i, '');
  if (initData) {
    const tgUser = BOT_TOKEN
      ? validateInitData(initData)
      : (!IS_PRODUCTION && ALLOW_GUEST ? parseInitDataUser(initData) : null);
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

// جلب/إنشاء ملف اللاعب — يعالج الدعوات عند أول دخول (?ref=ref_<id>) ويسوّي الدخل السلبي خادمياً
app.get('/api/me', requireAuth, rateLimit('me', 60), asyncRoute(async (req, res) => {
  const refId = String(req.query.ref || '').replace(/^ref_/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const result = await store.withUsers([req.player.id, ...(refId ? [refId] : [])], async () => {
    const now = Date.now();
    let user = await store.getUser(req.player.id);
    let isNew = false;
    let offline = { seconds: 0, gold: 0 };
    if (!user) {
      user = await createUser(req.player.id, req.player.name);
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
      if (req.player.name && user.name !== req.player.name && req.player.name !== 'ضيف') user.name = req.player.name;
      offline = settlePassive(user, now);
      user.unackedCredits = 0;
      user.revision += 1;
      user.updatedAt = now;
      await store.putUser(user);
    }
    return profileOf(user, isNew, { offline: { seconds: offline.seconds, gold: Math.floor(offline.gold) } });
  });
  // سباقات WebSocket يختمها الخادم بنفسه — إجماليها إحصاء موثوق للمغامرة (خارج معاملة اللاعب: قراءة فقط)
  result.race = await store.raceTotals(req.player.id);
  // Do not acknowledge a reward or save until the database commit succeeded.
  res.json(result);
}));

// 🔁 المزامنة الموثوقة: دفعة عمليات مرقّمة لكل جلسة؛ إعادة الإرسال آمنة (التكرار يُتجاهل)
app.post('/api/ops', requireAuth, rateLimit('ops', 120), asyncRoute(async (req, res) => {
  const parsed = parseOpsRequest(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const result = await store.withUsers([req.player.id], async () => {
    const now = Date.now();
    let user = await store.getUser(req.player.id);
    if (!user) user = await createUser(req.player.id, req.player.name);
    ensureSync(user);
    settlePassive(user, now);
    const outcome = applyOps(user, parsed.session, parsed.ops, now);
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
    return { status: 200, body: { ok: true, reward: info.reward, xp, state: projectedState(user, now), progress: progressOf(user.state), levelUp: levelAfter > levelBefore ? { from: levelBefore, to: levelAfter } : null, missions: missionsView(user, now), revision: user.revision, daily: dailyInfo(user), serverTime: now } };
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
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 4096 });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    let player = null;
    const initData = url.searchParams.get('initData') || '';
    const guest = (url.searchParams.get('guest') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (initData) {
      const tgUser = BOT_TOKEN
      ? validateInitData(initData)
      : (!IS_PRODUCTION && ALLOW_GUEST ? parseInitDataUser(initData) : null);
      if (tgUser?.id) player = { id: String(tgUser.id), name: tgUser.first_name || 'لاعب' };
    } else if (guest && ALLOW_GUEST) {
      player = { id: `guest_${guest}`, name: 'ضيف' };
    }
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
      for (const other of room.players) {
        if (other === ws) continue;
        other.player.roomId = null;
        other.player.ready = false;
        if (notify) sendWs(other, {
          type: ['racing', 'settling'].includes(room.state) ? 'opponent_left' : 'room_closed',
          message: ['racing', 'settling'].includes(room.state) ? 'غادر الخصم — يمكنك بدء سباق جديد' : 'أُغلقت الغرفة — أنشئ غرفة جديدة',
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
          if (![msg.score, msg.lives, msg.xRatio].every(Number.isFinite)) return;
          const now = Date.now();
          if (now - ws.player.lastProgress < 100) return;
          ws.player.lastProgress = now;
          const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
          if (!room || room.state !== 'racing' || !room.players.has(ws)) return;
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
          if (!Number.isFinite(msg.score) || msg.score < 0) return;
          const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
          if (!room || room.state !== 'racing' || !room.players.has(ws)) return;
          // لا نقبل إنهاء قبل وقت البداية، ولا نسمح بتغيير نتيجة اللاعب بعد ختمها.
          if (Date.now() < (room.startAt || 0) || room.results.has(ws.player.id)) return;
          // سقف نتيجة معقول: مدة السباق × أقصى معدل نقاط/ثانية تقريبي
          const elapsedRace = Math.min(75, Math.max(0, (Date.now() - (room.startAt || Date.now())) / 1000));
          const maxScore = Math.floor(elapsedRace * 45) + 100;
          const score = Math.max(0, Math.min(maxScore, Math.floor(Number(msg.score) || 0)));
          room.results.set(ws.player.id, { id: ws.player.id, name: ws.player.name, score });
          for (const other of room.players) if (other !== ws) sendWs(other, { type: 'opponent_finished', score });
          if (room.results.size >= 2) {
            // Keep rematch/ready blocked until asynchronous persistence completes.
            room.state = 'settling';
            const results = [...room.results.values()].sort((a, b) => b.score - a.score);
            const winnerId = results[0].score === results[1].score ? null : results[0].id;
            // 🏆 تسجيل البطولة الأسبوعية قبل إعلان النتيجة (فشل التخزين لا يعطّل السباق)
            try {
              const week = currentWeekKey();
              for (const r of results) await store.recordRaceResult(week, { ...r, won: winnerId === r.id });
            } catch (e) { console.error('تعذّر تسجيل نتيجة سباق:', e.message); }
            // A disconnect/switch can delete this room while storage is in flight.
            if (raceRooms.get(room.id) !== room || room.players.size !== 2) return;
            room.state = 'finished';
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
