const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const PLACEHOLDER = 'ضع_هنا_التوكن_الخاص_بك_من_BotFather';

// 1. تقديم ملفات اللعبة (HTML/CSS/JS)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true, bot: Boolean(BOT_TOKEN && BOT_TOKEN !== PLACEHOLDER) }));

// 2. إعداد بوت التيليجرام
let bot = null;
if (BOT_TOKEN && BOT_TOKEN !== PLACEHOLDER) {
  bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    // رابط تطبيق الويب بعد استضافته أو عبر ngrok
    const appUrl = process.env.APP_URL || 'https://your-domain.com';
    const startPayload = ctx.startPayload || '';
    const isRef = startPayload.startsWith('ref_');

    return ctx.replyWithMarkdown(
      `⛏️ *مرحباً بك في إمبراطورية التعدين!*${isRef ? '\n🎁 انضممت عبر رابط دعوة صديق!' : ''}\n\nاضغط على الزر أدناه لبدء التعدين وجمع العملات 💰`,
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

  const shutdown = (signal) => {
    try { bot.stop(signal); } catch (_) { /* already stopped */ }
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
} else {
  console.log('⚠️  لم يتم وضع BOT_TOKEN (انسخ .env.example إلى .env)، سيعمل خادم الويب فقط.');
}

// 3. تشغيل خادم Express
app.listen(PORT, HOST, () => {
  console.log(`🎮 خادم اللعبة يعمل الآن على: http://localhost:${PORT}`);
});
