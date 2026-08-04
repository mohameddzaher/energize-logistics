/**
 * secretVault — تخزين أسرار قابلة للاسترجاع (زي باسوورد إيميل الشركة).
 *
 * ليه تشفير مش هاش؟ باسوورد الدخول للسيستم بيتعمله hash لأننا محتاجين نتأكد منه
 * بس، مش نعرفه. الحاجة هنا مختلفة: ده باسوورد صندوق بريد على هوستنجر، وتقنية
 * المعلومات محتاجة **تقراه** عشان تديه للموظف أو تظبط له برنامج البريد. فـ bcrypt
 * مش هيفيد، والنص الصريح غير مقبول. الحل الوسط الصحيح: تشفير متماثل مع مفتاح
 * برّه قاعدة البيانات.
 *
 * AES-256-GCM: بيدّي سرية **و** كشف للتلاعب — لو حد عدّل الصف في مونجو، فك
 * التشفير بيفشل بدل ما يرجّع بيانات مضروبة.
 *
 * المفتاح جاي من `EMAIL_VAULT_KEY` (32 بايت hex أو base64). لو مش موجود، الحفظ
 * **بيترفض** بدل ما ينزل النص صريح — الفشل الصامت هنا معناه تسريب كلمات مرور.
 *
 *   توليد مفتاح:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

let cachedKey;
function getKey() {
  if (cachedKey !== undefined) return cachedKey;
  const raw = (process.env.EMAIL_VAULT_KEY || '').trim();
  if (!raw) { cachedKey = null; return cachedKey; }
  let buf;
  if (/^[0-9a-f]{64}$/i.test(raw)) buf = Buffer.from(raw, 'hex');
  else buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    console.error('[secretVault] EMAIL_VAULT_KEY must decode to 32 bytes — secrets will NOT be stored.');
    cachedKey = null;
    return cachedKey;
  }
  cachedKey = buf;
  return cachedKey;
}

/** هل الخزنة جاهزة؟ الواجهة بتسأل عشان تقول للمستخدم بدل ما يكتب ويضيع شغله. */
const isReady = () => !!getKey();

/**
 * تشفير نص. بيرجّع سلسلة واحدة `v1:iv:tag:ciphertext` بالـ base64 عشان تتخزن في
 * خانة واحدة من غير ما نحتاج نغيّر الـ schema لو الخوارزمية اتغيّرت بعدين.
 */
function encrypt(plain) {
  const key = getKey();
  if (!key) {
    const e = new Error('خزنة كلمات المرور غير مهيأة (EMAIL_VAULT_KEY) — لا يمكن حفظ كلمة المرور');
    e.status = 503;
    e.code = 'VAULT_NOT_CONFIGURED';
    throw e;
  }
  const text = String(plain ?? '');
  if (!text) return '';
  const iv = crypto.randomBytes(12);                 // 96-bit IV، المقاس الموصى به لـ GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/**
 * فك التشفير. بيرجّع null لو مفيش قيمة، وبيرمي لو المفتاح غلط أو البيانات
 * اتلمست — أهون بكتير من إننا نرجّع حروف عشوائية على إنها كلمة المرور.
 */
function decrypt(stored) {
  if (!stored) return '';
  const key = getKey();
  if (!key) {
    const e = new Error('خزنة كلمات المرور غير مهيأة (EMAIL_VAULT_KEY)');
    e.status = 503;
    e.code = 'VAULT_NOT_CONFIGURED';
    throw e;
  }
  const parts = String(stored).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    const e = new Error('صيغة كلمة المرور المخزّنة غير معروفة');
    e.status = 500;
    throw e;
  }
  const [, iv, tag, data] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isReady };
