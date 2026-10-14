'use strict';
// قواعد السباق المباشر (دوال نقية بلا حالة — تُختبر وحدها وتُستخدم في server.js)
// الخادم يقرر مدة السباق ويبلّغها للعميل، ويختم النتيجة بنفسه عند اكتمال الطرفين أو انتهاء المهلة أو انسحاب طرف.
// النقاط تبقى تقريراً من العميل لكن محدودة بسقفين لا يملك العميل تجاوزهما:
//   1) سقف الزمن: ما يسمح به زمن السباق المنقضي (معدل أقصى/ثانية + سماح أولي) حتى مدة السباق.
//   2) سقف التقدّم: آخر نقاط أبلغها اللاعب نفسه + ما يسمح به الزمن منذ ذلك البلاغ + قفزة واحدة شرعية.

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));

function raceRulesFromEnv(env = process.env) {
  const durationSec = clampInt(env.RACE_DURATION_SEC || 60, 2, 300);
  const graceSec = clampInt(env.RACE_GRACE_SEC || 8, 1, 60);
  return {
    durationSec,                                   // مدة السباق (كلاسيك 60 ثانية افتراضياً)
    graceSec,                                      // سماح شبكة/تحميل بعد انتهاء المدة قبل أن يختم الخادم
    scoreRate: 45,                                 // أقصى معدل نقاط/ثانية يُقبل على طول السباق
    scoreBase: 100,                                // سماح أولي
    scoreBurst: 400,                               // أكبر قفزة شرعية بين بلاغين (جوهرة ذهبية ×6 + مهمة داخلية)
    forfeitAfterSec: Math.min(3, durationSec / 2), // مغادرة بعد هذه الثواني من البداية = خسارة مسجّلة
  };
}

// سقف نتيجة لاعب لحظة البلاغ. `last` = آخر تقدّم مقبول له {score, at} أو null.
function raceCap(rules, { startAt, last }, rawScore, now) {
  const elapsed = Math.max(0, (now - startAt) / 1000);
  const timeCap = Math.floor(Math.min(elapsed, rules.durationSec) * rules.scoreRate) + rules.scoreBase;
  const streamCap = last ? Math.floor(last.score + Math.max(0, (now - last.at) / 1000) * rules.scoreRate) + rules.scoreBurst : Infinity;
  const n = Number(rawScore);
  const wanted = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; // غير العددي/اللانهائي = صفر، لا سقف
  const score = Math.min(wanted, timeCap, streamCap);
  return { score, flagged: wanted > score, timeCap, streamCap };
}

const raceDeadline = (rules, startAt) => startAt + (rules.durationSec + rules.graceSec) * 1000;
const forfeitAllowed = (rules, startAt, now) => now >= startAt + rules.forfeitAfterSec * 1000;

// حسم الفائز: المنسحب يخسر مهما كانت نقاطه؛ وإلا الأعلى نقاطاً، والتعادل بلا فائز.
function decideWinner(results, forfeitBy = null) {
  if (results.length < 2) return null;
  if (forfeitBy) return results.find((r) => r.id !== forfeitBy)?.id ?? null;
  const sorted = [...results].sort((a, b) => b.score - a.score);
  return sorted[0].score === sorted[1].score ? null : sorted[0].id;
}

module.exports = { raceRulesFromEnv, raceCap, raceDeadline, forfeitAllowed, decideWinner };
