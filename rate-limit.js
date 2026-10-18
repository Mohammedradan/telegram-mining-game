// محدِّد معدّل بنافذة ثابتة لكل مفتاح، بذاكرة محدودة: تُحذف المفاتيح المنتهية دورياً،
// وعند بلوغ الحد يُطرد الأقدم نشاطاً فقط — لا يُمسح عدّاد بقية العملاء أبداً.
// المخزن محلي لكل نسخة خادم؛ مع عدة نسخ يلزم مخزن مشترك (Redis/PostgreSQL) لحد عالمي دقيق.
function createRateLimiter({ windowMs = 60_000, maxKeys = 10_000, now = Date.now } = {}) {
  const hits = new Map(); // key -> { count, resetAt } — ترتيب الإدراج = ترتيب آخر نشاط
  let nextSweep = 0;
  function sweep(t) {
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
    nextSweep = t + windowMs;
  }
  function hit(key, max) {
    const t = now();
    if (t >= nextSweep) sweep(t);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) entry = { count: 0, resetAt: t + windowMs };
    hits.delete(key); // نقل المفتاح إلى آخر الترتيب (الأحدث نشاطاً)
    entry.count += 1;
    hits.set(key, entry);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return { allowed: entry.count <= max, remaining: Math.max(0, max - entry.count), resetAt: entry.resetAt };
  }
  return { hit, size: () => hits.size };
}

module.exports = { createRateLimiter };
