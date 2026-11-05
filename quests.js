'use strict';
// مهام المغامرة (الدفعة 3ب): اثنتا عشرة مهمة تُستلم مرة واحدة لكل لاعب، بمجموع 2,500 ذهب و800 خبرة.
//
// عدّاداتها تأتي من مصدر واحد فقط: جولات المنصّات التي أعاد الخادم تشغيلها بنفس البذرة (platform-api.js `finish`):
// الصخور المعدَّنة، الأعداء المهزومون، الخامات المجموعة بأنواعها، قتل كل زعيم بمفتاحه، والانتصارات بكل منجم (مسجّلة أصلاً
// في state.mines.wins). لا شيء من العميل: الجولات الكلاسيكية (ادّعاء عميل) والحفر العميق وصناديق موقع الحفر (عميل فقط)
// لا تُحتسب أبداً. المكافأة خارج سقف الذهب اليومي لأنها لمرة واحدة ومحدودة بمجموعها.
//
// وحدة صافية بلا اعتماد على الخادم: كل دوالّها تعمل على كائن العدّادات الذي يحفظه الخادم في user.sync.quests.

const ORES = ['copper', 'iron', 'gold', 'crystal', 'lava'];
const BOSSES = ['colossus', 'warden'];
const COUNTER_CAP = 1_000_000_000;

// counter: rocks | enemies | ore:<خام> | boss:<زعيم> | wins:<رقم المنجم 0..5>
// icon: اسم رمز SVG في الصفحة (i-pickaxe, i-swords, i-trophy, i-boss) أو ore:<خام> لنقطة لون الخام
const QUESTS = Object.freeze([
  { id: 'first_rock',  icon: 'i-pickaxe', title: 'أول صخرة',          desc: 'عدّن صخرة خام واحدة',                   counter: 'rocks',         target: 1,   gold: 50,  xp: 20 },
  { id: 'win_stone',   icon: 'i-trophy',  title: 'قلب المنجم الأول',   desc: 'اعبر المنجم الحجري مرة واحدة',          counter: 'wins:0',        target: 1,   gold: 100, xp: 40 },
  { id: 'copper_40',   icon: 'ore:copper', title: 'جامع النحاس',       desc: 'اجمع 40 قطعة نحاس',                     counter: 'ore:copper',    target: 40,  gold: 100, xp: 40 },
  { id: 'guards_50',   icon: 'i-swords',  title: 'حارس الحراس',        desc: 'اهزم 50 حارساً في المناجم',             counter: 'enemies',       target: 50,  gold: 150, xp: 60 },
  { id: 'iron_30',     icon: 'ore:iron',  title: 'حدّاد الأعماق',      desc: 'اجمع 30 قطعة حديد',                     counter: 'ore:iron',      target: 30,  gold: 150, xp: 50 },
  { id: 'win_crystal', icon: 'i-trophy',  title: 'عابر البلّور',       desc: 'اعبر أعماق البلّور مرة واحدة',          counter: 'wins:3',        target: 1,   gold: 150, xp: 50 },
  { id: 'gold_25',     icon: 'ore:gold',  title: 'عروق الذهب',         desc: 'اجمع 25 قطعة ذهب خام',                  counter: 'ore:gold',      target: 25,  gold: 200, xp: 60 },
  { id: 'colossus',    icon: 'i-boss',    title: 'سقوط العملاق',       desc: 'اهزم عملاق الذهب',                      counter: 'boss:colossus', target: 1,   gold: 300, xp: 100 },
  { id: 'crystal_20',  icon: 'ore:crystal', title: 'صائد البلّور',     desc: 'اجمع 20 بلّورة',                        counter: 'ore:crystal',   target: 20,  gold: 250, xp: 80 },
  { id: 'rocks_200',   icon: 'i-pickaxe', title: 'كسّار الصخور',       desc: 'عدّن 200 صخرة خام',                     counter: 'rocks',         target: 200, gold: 250, xp: 70 },
  { id: 'lava_15',     icon: 'ore:lava',  title: 'قابض الحمم',         desc: 'اجمع 15 قطعة حمم',                      counter: 'ore:lava',      target: 15,  gold: 300, xp: 90 },
  { id: 'warden',      icon: 'i-boss',    title: 'حارس القلب يسقط',    desc: 'اهزم حارس القلب',                       counter: 'boss:warden',   target: 1,   gold: 500, xp: 140 },
]);
const QUEST_BY_ID = Object.freeze(Object.fromEntries(QUESTS.map((q) => [q.id, q])));
const TOTALS = Object.freeze({ gold: QUESTS.reduce((a, q) => a + q.gold, 0), xp: QUESTS.reduce((a, q) => a + q.xp, 0), count: QUESTS.length });

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
// عدد صحيح غير سالب بحد أقصى؛ ما ليس رقماً محدوداً (NaN, Infinity, نص) يساوي صفراً لا الحدّ الأقصى
const count = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(COUNTER_CAP, Math.max(0, Math.floor(n))) : 0; };

// كائن العدّادات المحفوظ: لا يقبل إلا مفاتيحه المعروفة، وأعداداً صحيحة غير سالبة، وتواريخ استلام لمهام معروفة فقط
function normalize(raw) {
  const r = isObj(raw) ? raw : {};
  const ores = {}; const bosses = {}; const claimed = {};
  for (const k of ORES) ores[k] = count(isObj(r.ores) ? r.ores[k] : 0);
  for (const k of BOSSES) bosses[k] = count(isObj(r.bosses) ? r.bosses[k] : 0);
  if (isObj(r.claimed)) for (const q of QUESTS) { const at = Number(r.claimed[q.id]); if (Number.isFinite(at) && at > 0) claimed[q.id] = at; }
  return { rocks: count(r.rocks), enemies: count(r.enemies), ores, bosses, claimed };
}

// جولة منصّات أعاد الخادم تشغيلها: facts = { mined, defeated, ores: {خام: عدد}, boss: 'colossus' | 'warden' | null }
// تعدّل الكائن المُمرَّر (مطبَّعاً) وتعيده. قيم غير صالحة لا تزيد شيئاً، وزعيم غير معروف لا يُحتسب.
function addRun(counters, facts = {}) {
  const c = counters;
  c.rocks = count(c.rocks + count(facts.mined));
  c.enemies = count(c.enemies + count(facts.defeated));
  const got = isObj(facts.ores) ? facts.ores : {};
  for (const k of ORES) c.ores[k] = count(c.ores[k] + count(got[k]));
  if (BOSSES.includes(facts.boss)) c.bosses[facts.boss] = count(c.bosses[facts.boss] + 1);
  return c;
}

// القيمة الحالية لمهمة: العدّادات المحفوظة، أو الانتصارات من state.mines.wins (مسجّلة من إعادة التشغيل أصلاً)
function valueOf(quest, counters, wins) {
  const [kind, arg] = quest.counter.split(':');
  if (kind === 'rocks') return count(counters.rocks);
  if (kind === 'enemies') return count(counters.enemies);
  if (kind === 'ore') return count(counters.ores[arg]);
  if (kind === 'boss') return count(counters.bosses[arg]);
  if (kind === 'wins') return count(Array.isArray(wins) ? wins[Number(arg)] : 0);
  return 0;
}

function view(counters, wins) {
  const items = QUESTS.map((q) => {
    const value = Math.min(q.target, valueOf(q, counters, wins));
    return { id: q.id, icon: q.icon, title: q.title, desc: q.desc, target: q.target, value, done: value >= q.target, claimed: Boolean(counters.claimed[q.id]), gold: q.gold, xp: q.xp };
  });
  return { items, claimedCount: items.filter((i) => i.claimed).length, total: items.length, totalGold: TOTALS.gold, totalXp: TOTALS.xp };
}

// استلام مهمة: تُسجَّل في counters.claimed ولا تتكرر. المنح الفعلي (ذهب وخبرة وسجل) في الخادم.
function claim(counters, wins, id, now) {
  const q = QUEST_BY_ID[id];
  if (!q) return { status: 'invalid' };
  if (counters.claimed[q.id]) return { status: 'rejected', reason: 'claimed' };
  const value = valueOf(q, counters, wins);
  if (value < q.target) return { status: 'rejected', reason: 'locked', value: Math.min(q.target, value), target: q.target };
  counters.claimed[q.id] = Number(now) > 0 ? Number(now) : 1;
  return { status: 'ok', id: q.id, gold: q.gold, xp: q.xp };
}

module.exports = { QUESTS, QUEST_BY_ID, TOTALS, ORES, BOSSES, normalize, addRun, valueOf, view, claim };
