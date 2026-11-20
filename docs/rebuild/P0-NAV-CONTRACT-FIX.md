# P0 — إصلاح تناقض شريط التنقل وقت اللعب

**الفرع:** `arena/dc25d784-telegram-mining-game`
**الأساس:** `46089c7` (main)
**النطاق:** CSS + اختبار واحد. لا منطق لعبة، ولا اقتصاد، ولا خادم، ولا API، ولا schema.

## المشكلة (مقيسة على HEAD)

`npm test` على خط الأساس: **922 اختباراً، 920 ناجح، 1 فاشل، 1 متجاوز**.

```
not ok 765 - platform UI: Lobby default state, Live class while round runs
  location: test/platform-ui.test.js:450:1
  error: 'the global tab bar compacts during active play instead of disappearing'
```

ثلاثة عقود متناقضة على نفس المحفّز (`body.scene-live`):

| المصدر | ما يطلبه |
| --- | --- |
| `public/platform-layout.css:218` (المنتج) | `body.scene-live .bottom-nav { display: none !important; }` — إخفاء كامل |
| `test/layout.test.js:225` | `flex: 0 0 52px` — مصغّر **مرئي** |
| `scripts/test-platform-browser.cjs:164` | `expect(bottom-nav).isVisible() === true` داخل جولة نشطة |
| `test/platform-ui.test.js:464` | نص CSS حرفي `padding: 2px; gap: 2px` |

كما كان في الملف **كتلتان متعارضتان** لنفس المحدد (`52px` في السطر 471 و`display:none` في السطر 218)
تحجب إحداهما الأخرى بأولوية `!important` — أي أن الكتلة الثانية كانت ميتة تماماً.

الأثر الحقيقي في المنتج: اللاعب داخل جولة نشطة على الهاتف **لا يستطيع تغيير التبويب** إلا بإيقاف مؤقت،
وهذا يخالف بوّابة E2E القائمة ويخالف ملاحظة التصميم نفسها («تنقّل منكمش»).

## الإصلاح

1. حذف `display: none !important` من كتلة الشريط.
2. توحيد كل قواعد شريط التنقل وقت اللعب في **مكان واحد** في نهاية الملف مع تعليق يوضّح أنه المصدر الوحيد.
3. احتفاظ الزر بـ**44px** (حد اللمس المعتمد) بصف أفقي بلا تسميات نصية.
4. إضافة تأكيد سلبي في الاختبار: `assert.doesNotMatch(layout, /body\.scene-live \.bottom-nav \{\s*display: none/)`
   حتى لا يعود التناقض صامتاً.
5. تحديث التأكيدين الآخرين ليقرآ العقد الحقيقي (`52px` و`44px`) بدل النص القديم.

لم يُخفَّف أي تأكيد: عدد التأكيدات زاد من ثلاثة إلى أربعة، وأُضيف تأكيد منع الانحدار.

## الملفات

```
 public/platform-layout.css  | 30 +++++++++++++++++-------------
 test/platform-ui.test.js    | 14 +++++++++-----
 2 files changed
```

## النتائج الفعلية

```
$ npm run build
Build checks passed: 82 JavaScript files, 45 inline scripts, 75 local asset references,
13 stylesheet images and 10 images requested from scripts.

$ node --test test/platform-ui.test.js test/layout.test.js
# tests 35 | pass 35 | fail 0

$ npm test
# tests 922 | pass 921 | fail 0 | skipped 1     ← كان: pass 920 | fail 1
```

الاختبار المتجاوز الوحيد هو المتجاوز الموثّق سابقاً في المستودع، ولم يُضف أي skip جديد.

## ما لم يُشغَّل هنا (يُصرَّح به)

* اختبار المتصفح `test:browser`: Chromium غير مثبّت في هذه البيئة.
  التأكيد الذي كان يفشل في CI (`liveNav.isVisible()`) أصبح قابلاً للنجاح لأن القاعدة المانعة أُزيلت،
  لكن **لا أدّعي نجاحه** حتى يُشغَّل في CI على HEAD نفسه.
* PostgreSQL: البيئة المحلية SQLite فقط.

## المخاطر

منخفضة. التغيير بصري/تنقّلي: مساحة الشريط أثناء اللعب تبقى 52px (كما كان مقصوداً في الكتلة الميتة)
ومساحة الكانفاس لا تتغيّر لأن الارتفاع المحجوز كان موجوداً بالفعل في `flex: 0 0 52px`.
