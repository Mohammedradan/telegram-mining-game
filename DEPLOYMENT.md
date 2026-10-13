# 🚀 النشر للإنتاج — خطوة بخطوة

هدف هذه المرحلة: تشغيل اللعبة على الإنترنت مجاناً (Render + PostgreSQL سحابية)
برابط HTTPS ثابت يعمل داخل تيليجرام، مع بقاء مكافحة الغش الخادمية كما هي
(التحقق يعمل قبل الحفظ أياً كانت قاعدة البيانات — لا يتغير شيء فيه).

---

## أ) التشغيل على جهازك الآن (محلياً — 5 دقائق)

```bash
git pull                     # أو git clone <رابط المستودع> ثم cd telegram-mining-game
npm install                  # تثبيت التبعيات (Node 20 أو أحدث — انظر .nvmrc: نسخة 22)
cp .env.example .env         # على ويندوز: copy .env.example .env
npm start
```

افتح: http://localhost:3000 — وستجد اللعبة تعمل بقاعدة SQLite محلية (`data/game.db`).

تحقق سريع:

```bash
curl http://localhost:3000/health
# {"ok":true,"bot":false,"db":"sqlite","users":0}
npm test                     # 8 اختبارات تكامل يجب أن تنجح كلها
```

> بدون `BOT_TOKEN` يعمل وضع الضيف تلقائياً محلياً. **لا تفعّل `ALLOW_GUEST_AUTH` في الإنتاج أبداً.**

لتجربة اللعبة داخل تيليجرام وأنت محلي:

```bash
ngrok http 3000              # انسخ رابط https الناتج وضعه APP_URL في .env ثم أعد التشغيل
```

---

## ب) إنشاء قاعدة PostgreSQL مجانية (Supabase — 3 دقائق)

1. سجّل في https://supabase.com وأنشئ مشروعاً جديداً (اختر منطقة قريبة من جمهورك، مثلاً Frankfurt).
2. من **Project Settings ← Database ← Connection string** انسخ رابط **Session pooler**
   (يبدأ بـ `postgres://...pooler.supabase.com:5432/...`). استخدم الباسورد الذي اخترته للمشروع.
3. هذا هو `DATABASE_URL`. الخادم سيكتشفه تلقائياً وينشئ الجداول عند أول تشغيل — **لا توجد خطوات SQL يدوية**.

جرّبه محلياً قبل النشر إن أردت:

```bash
# داخل .env: ضع DATABASE_URL بالرابط المنسوخ
npm start
# يجب أن يطبع: 🗄️  قاعدة البيانات: PostgreSQL
curl http://localhost:3000/health   # "db":"postgres"
```

---

## ج) النشر على Render (5 دقائق)

المستودع يحتوي `render.yaml` جاهزاً، فهناك طريقتان:

### الطريقة الأسهل — Blueprint
1. ادخل https://dashboard.render.com واختر **New ← Blueprint**.
2. اربط حساب GitHub واختر هذا المستودع والفرع الذي عليه الكود.
3. Render سيقرأ `render.yaml` وينشئ خدمة الويب بإعداداتها (بناء: `npm install && npm run build`، تشغيل: `npm start`، فحص صحة: `/health`، خطة Free، Node 22).
4. سيطلب منك إدخال المتغيرات السرية يدوياً (مذكورة أدناه) — أدخلها وأكمل.

### أو يدوياً — Web Service
New ← Web Service ← اربط المستودع، ثم: Runtime: Node، Build: `npm install && npm run build`، Start: `npm start`، Health Check Path: `/health`، Plan: Free.

### متغيرات البيئة المطلوبة في لوحة Render

| المتغير | القيمة |
|---|---|
| `BOT_TOKEN` | توكن بوتك من @BotFather |
| `DATABASE_URL` | رابط PostgreSQL من الخطوة (ب) |
| `APP_URL` | رابط خدمتك بعد إنشائها، مثل `https://telegram-mining-game.onrender.com` (ستعرفه بعد أول إنشاء — ضعه ثم اعمل Manual Deploy مرة أخرى) |
| `MAX_CLICKS_PER_SEC` | `20` (موجود في render.yaml) |

> **لا تضف `PORT`** — Render يضبطه تلقائياً والخادم يقرأه من البيئة أصلاً.

### التحقق بعد النشر

```bash
curl https://<خدمتك>.onrender.com/health
# {"ok":true,"bot":true,"db":"postgres","users":0}
```

- `bot:true` يعني التوكن مقروء، و`db:"postgres"` يعني القاعدة السحابية متصلة.
- أول طلب بعد فترة خمول قد يأخذ 30–50 ثانية (الخدمة المجانية تنام) — هذا طبيعي في فئة Free.

---

## د) ربط البوت في تيليجرام (دقيقتان)

1. في `public/index.html` استبدل `MiningClickerBot` (سطر `BOT_USERNAME`) باسم مستخدم بوتك الفعلي — حتى تولّد روابط الدعوة بشكل صحيح — ثم ادفع التغيير (`git push`) وسيعيد Render النشر تلقائياً.
2. في @BotFather: أرسل `/mybots` ← اختر بوتك ← **Bot Settings ← Menu Button ← Configure menu button** ← أرسل: `https://<خدمتك>.onrender.com`
3. افتح بوتك، أرسل `/start`، واضغط **🚀 فتح اللعبة الآن** — يجب أن تفتح اللعبة داخل تيليجرام، وتنشئ لك ملف لاعب موثّقاً في PostgreSQL (جرّب أن تسجل نقرات، أعد فتح اللعبة، وستجد تقدمك كما هو).

---

## هـ) قائمة تحقق قبل دعوة اللاعبين ✅

- [ ] `/health` يرد ok و`db:"postgres"` و`bot:true`
- [ ] اللعبة تفتح من داخل تيليجرام (زر القائمة في البوت)
- [ ] التقدم يُحفظ بعد إغلاق اللعبة وفتحها (سحابياً)
- [ ] `APP_URL` في Render يطابق رابط الخدمة تماماً
- [ ] `ALLOW_GUEST_AUTH` **غير موجود** في متغيرات Render
- [ ] `.env` الحقيقي غير مرفوع إلى Git (موجود فقط محلياً/في لوحة Render)

## ملاحظات مجانية-الطبقة الصادقة 💡

- **نوم الخدمة**: Render Free ينام بعد ~15 دقيقة بلا طلبات؛ أول فتح بعده بطيء (~30–50 ثانية) ثم سريع. مقبول للتجربة والإطلاق الصغير.
- **بدائل قاعدة أبقى**: قاعدة Render Postgres المجانية مؤقتة وتنتهي بعد فترة قصيرة — Supabase/Neon أبقى مجاناً، لذا يُفضَّلان.
- **`better-sqlite3` اختياري**: في الإنتاج مع PostgreSQL لن يبني الخادم SQLite أصلاً، لذا جعلناه تبعية اختيارية حتى لا يعطّل أي فشل بناء أصلي عملية النشر.
