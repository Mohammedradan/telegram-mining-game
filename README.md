# ⛏️ telegram-mining-game

لعبة تعدين بنظام النقرات والتطوير التلقائي كـ **Telegram Mini App (TMA)** — شبيهة بـ *Notcoin* و *Hamster Kombat*.

## 📁 هيكل المشروع

```text
telegram-mining-game/
├── package.json
├── server.js          # خادم Express + بوت تيليجرام (Telegraf)
├── .env.example       # انسخه إلى .env وضع BOT_TOKEN و APP_URL
└── public/
    └── index.html     # واجهة اللعبة كاملة (تصميم + منطق + حفظ تلقائي)
```

## 🚀 التشغيل محلياً (دقيقة واحدة)

```bash
npm install
npm start
```

افتح المتصفح على: http://localhost:3000

> بدون `BOT_TOKEN` يعمل خادم الويب فقط — البوت اختياري للتجربة المحلية.

## 🤖 ربطها بتيليجرام كـ Mini App

1. انسخ `.env.example` إلى `.env` وضع `BOT_TOKEN` من [@BotFather](https://t.me/BotFather).
2. عرّض الخادم للإنترنت: `ngrok http 3000` (أو استضف على Render / Railway / Vercel).
3. ضع رابط `https` الناتج في `APP_URL` داخل `.env` وأعد تشغيل الخادم،
   واستبدل `MiningClickerBot` في `public/index.html` باسم مستخدم بوتك لتعمل روابط الدعوة.
4. في `@BotFather`: ‏`/mybots` ← اختر البوت ← **Bot Settings** ← **Menu Button** ← **Configure menu button** ← أرسل نفس الرابط.
5. افتح البوت واضغط زر القائمة لتشغيل اللعبة من داخل تيليجرام مباشرة.

## 🎮 الميزات

- نقر متعدد اللمس مع أرقام متطايرة واهتزاز (Haptic Feedback) عبر Telegram WebApp.
- طاقة تتجدد (3/ثانية) وتُستهلك حسب قوة النقرة.
- 3 ترقيات (فأس فولاذي / عامل آلي / منصة عملاقة) بأسعار تصاعدية وعدّاد ملكية.
- دخل سلبي + **أرباح أثناء الغياب** حتى 8 ساعات، وحفظ تلقائي للتقدم في `localStorage`.
- مستوى يعتمد على إجمالي ما كسبته عبر الزمن (لا ينقص عند الشراء).
- روابط دعوة للأصدقاء عبر `?start=ref_<userId>`.

## 🔌 نقاط فحص

- `GET /health` → `{ ok: true, bot: true|false }`
