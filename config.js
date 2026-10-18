// إعدادات التشغيل والتحقق منها: في الإنتاج يرفض الخادم البدء بإعداد غير آمن بدل التراجع الصامت.
const PLACEHOLDER_TOKEN = 'ضع_هنا_التوكن_الخاص_بك_من_BotFather';
const TOKEN_SHAPE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

function botTokenFrom(env) {
  const raw = String(env.BOT_TOKEN || '').trim();
  return raw && raw !== PLACEHOLDER_TOKEN ? raw : '';
}

// رابط اللعبة العام: APP_URL صريحاً، أو الرابط الذي تضبطه Render تلقائياً لكل خدمة ويب
function appUrlFrom(env) {
  return String(env.APP_URL || env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
}

const isPostgresUrl = (url) => /^postgres(ql)?:\/\//.test(String(url || ''));

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const botToken = botTokenFrom(env);
  const appUrl = appUrlFrom(env);
  // وضع الضيف: للتطوير فقط. في الإنتاج لا يُفعَّل أبداً (طلب تفعيله صراحةً خطأ إعداد أدناه)
  const allowGuest = !production && (env.ALLOW_GUEST_AUTH === 'true' || (!botToken && env.ALLOW_GUEST_AUTH !== 'false'));
  const requestedMode = String(env.BOT_MODE || '').trim().toLowerCase();
  const botMode = !botToken ? 'off'
    : ['webhook', 'polling'].includes(requestedMode) ? requestedMode
      : (production && appUrl.startsWith('https://') ? 'webhook' : 'polling');
  // عدد طبقات البروكسي الموثوقة أمام الخادم (Render: طبقة واحدة). 0 = لا ثقة بـ X-Forwarded-For
  const hopsRaw = env.TRUST_PROXY_HOPS;
  const trustProxyHops = hopsRaw === undefined || hopsRaw === ''
    ? (production || env.RENDER ? 1 : 0)
    : Math.max(0, Math.min(5, Math.floor(Number(hopsRaw)) || 0));
  return {
    production, botToken, appUrl, allowGuest, botMode, trustProxyHops,
    botUsername: String(env.BOT_USERNAME || '').replace(/^@/, '').trim(),
    webhookSecret: String(env.WEBHOOK_SECRET || '').trim(),
    databaseUrl: String(env.DATABASE_URL || '').trim(),
    allowSqliteInProduction: env.ALLOW_SQLITE_IN_PRODUCTION === 'true',
    guestRequested: env.ALLOW_GUEST_AUTH === 'true',
  };
}

// أخطاء إعداد تمنع تشغيل الإنتاج. لا تُطبع قيم الأسرار أبداً — أسماء المتغيرات فقط.
function productionConfigErrors(config) {
  if (!config.production) return [];
  const errors = [];
  if (!config.botToken) errors.push('BOT_TOKEN مفقود: بدونه لا يمكن التحقق من هوية لاعبي تيليجرام.');
  else if (!TOKEN_SHAPE.test(config.botToken)) errors.push('BOT_TOKEN بصيغة غير صالحة (المتوقع 123456:ABC... من @BotFather).');
  if (config.guestRequested) errors.push('ALLOW_GUEST_AUTH=true ممنوع في الإنتاج: يسمح لأي شخص بانتحال أي حساب ضيف.');
  if (!isPostgresUrl(config.databaseUrl) && !config.allowSqliteInProduction) {
    errors.push('DATABASE_URL (postgres://...) مفقود: SQLite على قرص مؤقت يفقد بيانات اللاعبين عند إعادة التشغيل. '
      + 'إن كان لديك قرص دائم فعّل ALLOW_SQLITE_IN_PRODUCTION=true صراحةً.');
  }
  if (!config.appUrl.startsWith('https://')) errors.push('APP_URL مفقود أو ليس https:// — زر فتح اللعبة في البوت يحتاجه.');
  if (config.botMode === 'webhook' && config.webhookSecret && !/^[A-Za-z0-9_-]{16,256}$/.test(config.webhookSecret)) {
    errors.push('WEBHOOK_SECRET يجب أن يكون 16–256 حرفاً من A-Z a-z 0-9 _ - فقط (شرط Telegram).');
  }
  return errors;
}

module.exports = { loadConfig, productionConfigErrors, isPostgresUrl, PLACEHOLDER_TOKEN };
