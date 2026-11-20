# P2 — مشهد المنجم القابل للعب

**الفرع:** `arena/dc25d784-telegram-mining-game`
**الأساس:** `46089c7` (main) — يبني على P0 (`a38747c`) و P1 (`59a40e9`)
**النطاق:** ملفات جديدة تحت `public/adventure/` + `adventure-api.js` + توصيل في `server.js` و`index.html` + سبع حزم اختبار.

## ما صار قابلاً للعب

منجم حجري كامل داخل تبويب «التعدين»: خريطة عشر طبقات، حركة بمفاتيح ولمس، مصعد، سلالم، آلات (حفر/سير/عربة/مستودع)، منجمون (crew)، مهمة، خزنة سرية، وشبكة عدادات HUD عربية. اللاعب يحرّك المنجّم، ينقر على العروق، يمشي، يركب المصعد، يشغّل الآلات، يجمع الخام إلى السايلو ثم يستلمه إلى `state.ores`.

الخادم هو المرجع: المشهد يرسل سجل العمليات (ops) والخادم يعيد بناء العالم بالتايمستب المستقل.

## العقد بين المشهد والخادم

| العنصر | الشكل |
| --- | --- |
| عملية إدخال | `{t:'i', mask, ticks}` — قناع إدخال مطابق + عدد التكات |
| عملية أمر | `{t:'c', command}` — أمر لعبة (منجم/آلة/مصعد/استلام) |
| الطلب | `{base:{tick}, ops, seq, id, digest}` |
| الرد | `{session, snapshot, applied, rejected, budget}` |
| الحدود | `MAX_OPS=600`, `MAX_INPUT_FRAMES=60*60*30`, `MAX_COMMANDS=400`, `MAX_DRIFT_TICKS=600` |

`checkpoint` يرفض بصدق: `409` عند تسلسل مكرر/فجوة، و`400` عند `base.tick + ticks > elapsed` أو عند خلط أقنعة مختلفة في عملية واحدة. السجل يُجزّئ بـ sha256 فلا تُخصم نفس العمليات مرتين.

## الاقتصاد

`collect` هو **الطريق الوحيد** لإدخال الخام إلى `state.ores`. سقف يومي `DAILY_ORE_CAP=1500` لكل نوع، والعدّاد يُصفَّر بتوقيت UTC. الاستلام يكتب `adv_mine_collect` في `op_ledger` **داخل نفس معاملة** تحديث المخزون، فلا يمكن أن يوجد خام بلا قيد.

## الثلاثة أخطاء التي كشفها الاختبار

هذه المرحلة أثبتت قيمة اختبار يقود إطارات حقيقية — كلاهما كان يمر من كل اختبارات الحالة:

### 1. مصنع المشهد يعيد الوصف بدل المشهد

كان `AdventureScene.create(deps)` و`init(hooks)` يعيدان `{create, COMMAND_SPACING, HUD_HZ, SYNC_HZ}` — أي **وصف الوحدة**، لا المشهد. الأثر: في `index.html` كان `const adv = AdventureScene.init({...})` يستقبل وصفاً، فتصبح `adv.scene` غير معرَّفة، وكل `AdvMine.scene?.show/hide/flush` تصمت بلا خطأ، والمنجم **لا يُركَّب أبداً** في صفحة حقيقية. الأسوأ: لا استثناء ولا تحذير.

الإصلاح: كلا المُحمّلَين يستدعي `create` الداخلي فعلياً:

```js
module.exports = { create: (options) => factory(options).create(options) };
```

### 2. حلقة الإطارات تقارن ثوانٍ بمللي ثوانٍ

```js
const elapsed = (t - lastTime) / 1000;   // ثوانٍ
const stepMs  = 1000 / rules.FPS;        // 16.67 = مللي
while (acc >= stepMs) { … }              // لا تتحقق أبداً
```

`acc` يتراكم بالثواني مقابل 16.67، فلا يتحقق الشرط أبداً: **العالم لا يتقدم ولا تكة واحدة**، حتى لو رُكّب المشهد. أُصلح إلى `1 / rules.FPS` مع تعليق يوضّح الوحدة.

### 3. المنجّم ينزلق بلا توقف

```js
p.vx = (direction && !p.mining) ? … : (p.mining ? 0 : p.vx);
```

عند ترك المفتاح لا يوجد فرع يُصفّر `vx`، ولا شيء آخر في المحاكاة يُخمده، فيستمر المنجّم 130 بكسل/ثانية إلى الأبد. أُصلح إلى `: 0`. الانجراف بعد الترك الآن **0.000 بكسل**.

> لولا اختبار `adventure-scene.test.js` الذي يقود إطارات حقيقية بساعة يدوية، لشُحن منجم مجمّد لا يتحرك وصفحة لا تعرضه.

## الملفات

```
adventure-api.js                         (جديد)  — العقد الخادمي + replay + اقتصاد
public/adventure/stone-mine-map.js       (تعديل) — تضاريس، مصعد، سلالم، آلات
public/adventure/stone-mine-rules.js     (تعديل) — المحاكاة + إصلاح vx
public/adventure/adventure-renderer.js   (جديد)  — الرسم على canvas من الإطار
public/adventure/adventure-scene.js      (جديد)  — الحلقة، الإدخال، HUD، سجل ops
public/adventure/adventure.css           (جديد)  — HUD عربي، مناطق لمس 44px
public/index.html                        (تعديل) — توصيل التبويب والمشهد والإفراغ
server.js                                (تعديل) — mountAdventureMine + ensureSync
test/adventure-{map,camera,rules,slice,travel,renderer,api,scene}.test.js (جديد/تعديل)
```

## الاختبارات

| المجموعة | العدد |
| --- | --- |
| `adventure-map` / `camera` / `rules` / `slice` / `travel` / `progression` | 75 |
| `adventure-renderer` | 7 |
| `adventure-api` (خادم حقيقي + إعادة تشغيل) | 11 |
| `adventure-scene` (إطارات حقيقية) | 12 |
| **`npm test` كامل** | **1014 اختباراً، 1013 ناجح، 0 فاشل، 1 متجاوز** |

`npm run build` → «83 JavaScript files, 50 inline scripts, 81 local asset references».

## قبول

- [x] `create()` و`init()` يعيدان مشهداً حياً (12 تأكيداً في `adventure-scene.test.js`).
- [x] 60 إطاراً = ~60 تكة (اختبار الانحدار للحلقة).
- [x] الإطار البطيء يتقدّم بالزمن لا بالإطارات، والقفزة الطويلة تُقصّ عند الحرس.
- [x] الإدخال يصل للقواعد: `ArrowRight` يحرّك، والترك **يوقف فعلاً**.
- [x] سجل العمليات يطابق المدخلات: `mask 0 → 2 → 0`، ويُدمج ما تشابه ويُحدّ بسقفه.
- [x] `flush` يسلّم دفعة واحدة مرة واحدة ولا يستدعي عند الفراغ.
- [x] `hide` يُوقف، `show` يستأنف بلا فقدان حالة، `destroy` آمن ومزدوج.
- [x] `init()` يعمل من ترتيب السكربتات الحقيقي في `index.html` (VM + globals).
- [x] الاستلام هو الطريق الوحيد للخام؛ القيد في نفس معاملة المخزون.
- [x] إعادة تشغيل الخادم تستأنف الجلسة (`resumed:true`).

## ما لم يُتحقق

- **لا متصفح محلي:** `npx playwright install chromium` يفشل في التنزيل، لذا `test:browser`/`test:clicker`/`test:platform` لم تُشغَّل. التحقق البصري تم عبر بدائل DOM تحاكي canvas و`requestAnimationFrame` و`performance.now`، وبواسطة `/tmp/init-test.cjs` (VM بترتيب سكربتات `index.html` الحقيقي). **لم يرَ أحدٌ `adventure.css` بعينه.**
- رسم `lift-shaft`/`drop-shaft` في الرِندرر غير مُتحقق منه بصرياً.
- الملفات المؤقتة في `/tmp` غير محفوظة في الالتزام.
