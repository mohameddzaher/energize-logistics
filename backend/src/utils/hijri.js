/**
 * التاريخُ الهجريُّ والميلاديُّ — وجهان لتاريخٍ واحدٍ لا حقلان.
 *
 * ── لماذا يُشتقّ ولا يُخزَّن ───────────────────────────────────────────────
 * الطلبُ أن يكون لكلّ تاريخٍ عمودان: ميلاديٌّ وهجريّ، و«مجرّد ما يُكتب أحدهما
 * يسمع الآخر». وأوّلُ ما يُفكَّر فيه حقلان في القاعدة ومزامنةٌ بينهما — وهو
 * بابُ اختلافٍ مؤكَّد: من يكتب في أحدهما بسكربتٍ أو استيرادٍ أو شاشةٍ قديمة
 * يترك الآخرَ قديمًا، ثمّ يُقرأ تاريخان لشيءٍ واحدٍ ولا يُعرَف أيُّهما الصحيح.
 *
 * فالمخزَّنُ واحدٌ — الميلاديُّ كما هو اليوم (`YYYY-MM-DD`) — والهجريُّ **عرضٌ
 * له**. ومن أدخل بالهجريّ تُحوَّل كتابتُه إلى ميلاديٍّ قبل الحفظ. فالعمودان
 * متوافقان بالبناء لا بالمزامنة، ولا يحتاج الأمرُ تحديثَ صفٍّ واحدٍ في القاعدة.
 *
 * ── والتحويلُ بتقويم أمّ القرى ─────────────────────────────────────────────
 * هو التقويمُ الرسميُّ في المملكة، وهو المعنيُّ في الإقامات والرخص. ويُقرأ من
 * `Intl` المبنيّ في العقدة (`islamic-umalqura`) — بلا حزمةٍ تُضاف ولا جدولٍ
 * يُنسَخ ويشيخ.
 *
 * والعكس (هجريٌّ ← ميلاديّ) لا تقدّمه `Intl`، فيُحسَب ببحثٍ ثنائيٍّ على
 * الأيّام: التقويمان متزايدان معًا، فيُقارَب اليومُ الميلاديُّ الذي يُعطي هذا
 * التاريخَ الهجريَّ في نحوِ خمسَ عشرةَ خطوة. وهو دقيقٌ تمامًا لأنّ المرجعَ هو
 * `Intl` نفسُها التي تُقرأ بها الوجهةُ الأخرى — فالذهابُ والعودةُ لا يختلفان.
 */

const DAY = 86400000;
const PAD = (n) => String(n).padStart(2, '0');

// تنسيقٌ واحدٌ يُبنى مرّةً — بناؤه لكلّ تاريخٍ أغلى من التحويل نفسِه.
let fmt = null;
const formatter = () => {
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
    });
  }
  return fmt;
};

const asDate = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** ميلاديٌّ ← هجريٌّ «YYYY-MM-DD»، أو '' إن لم يُقرأ تاريخًا. */
const toHijri = (value) => {
  const d = asDate(value);
  if (!d) return '';
  try {
    const parts = formatter().formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value || '';
    // بعض الإصدارات تُلحق «AH» بالسنة — تُقشَر الأرقامُ وحدَها.
    const y = String(get('year')).replace(/\D/g, '');
    const mo = String(get('month')).replace(/\D/g, '');
    const da = String(get('day')).replace(/\D/g, '');
    if (!y || !mo || !da) return '';
    return `${y.padStart(4, '0')}-${PAD(mo)}-${PAD(da)}`;
  } catch (e) {
    return '';
  }
};

/** مفتاحٌ رقميٌّ للمقارنة: 1446-07-03 → 14460703. */
const hKey = (s) => {
  const m = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
};

/**
 * هجريٌّ «YYYY-MM-DD» ← ميلاديٌّ `Date` (UTC منتصفَ الليل)، أو null.
 * بحثٌ ثنائيٌّ بين سنةِ ٦٠٠ﻫ وسنةِ ١٦٠٠ﻫ تقريبًا — يكفي كلَّ ما يُكتب.
 */
const fromHijri = (value) => {
  const want = hKey(value);
  if (!want) return null;
  // تقديرٌ أوّليٌّ: السنةُ الهجريّة ٣٥٤٫٣٦٧ يومًا، و١ محرّم ١ﻫ = 622-07-19م.
  const m = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  const [, hy, hm, hd] = m.map(Number);
  const guess = Date.UTC(622, 6, 19) + Math.round(((hy - 1) * 354.367 + (hm - 1) * 29.53 + (hd - 1)) * DAY);
  let lo = guess - 40 * DAY;
  let hi = guess + 40 * DAY;
  // وإن أخطأ التقديرُ وُسِّع المدى — لا يُفترَض صحّةُ التقريب.
  if (hKey(toHijri(new Date(lo))) > want) lo = Date.UTC(600, 0, 1);
  if (hKey(toHijri(new Date(hi))) < want) hi = Date.UTC(2200, 0, 1);
  for (let i = 0; i < 64 && lo <= hi; i += 1) {
    const mid = lo + Math.floor((hi - lo) / 2 / DAY) * DAY;
    const got = hKey(toHijri(new Date(mid)));
    if (got === want) return new Date(mid);
    if (got == null) return null;
    if (got < want) lo = mid + DAY; else hi = mid - DAY;
  }
  return null;
};

/** هجريٌّ ← ميلاديٌّ نصًّا «YYYY-MM-DD»، أو ''. */
const fromHijriString = (value) => {
  const d = fromHijri(value);
  return d ? `${d.getUTCFullYear()}-${PAD(d.getUTCMonth() + 1)}-${PAD(d.getUTCDate())}` : '';
};

/** أسماءُ الأشهر الهجريّة — للعرض حين يُكتب التاريخُ كلامًا. */
const HIJRI_MONTHS_AR = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الثاني', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];

/**
 * fillHijriPairs — يُكمل توأمَ التاريخ في تعديلٍ مسطَّح (`{ 'block.expiryDate': … }`).
 *
 * بعضُ السجلّات (المركبات) تخزّن التاريخَ مرّتين: `expiryDate` ميلاديًّا
 * و`expiryDateHijri` نصًّا. والحسابُ كلُّه على الميلاديّ، فهجريٌّ بلا ميلاديٍّ
 * مستندٌ «بلا تاريخ». فمن أرسل أحدَهما يُكتب له الآخر هنا:
 *
 *   • هجريٌّ وحدَه            ← يُشتقّ ميلاديُّه.
 *   • ميلاديٌّ وحدَه           ← يُشتقّ هجريُّه (إن كان للحقل توأمٌ في السجلّ).
 *   • الاثنان معًا            ← يغلب ما **تغيّر** عمّا في السجلّ؛ وإن تغيّرا معًا
 *                               فالميلاديُّ هو المرجع.
 *
 * يعدّل `$set` في مكانه ويردّ ما اشتقّه (`{ مفتاح: قيمة }`) ليُقال للشاشة.
 * ولا يرمي: تاريخٌ لا يُقرأ يُترك كما هو — يرفضه التحقّقُ بعده برسالته.
 *
 * ── ولماذا هو هنا ───────────────────────────────────────────────────────────
 * كان متحكِّمُ المركبات ينادي هذه الدالّةَ وهي غيرُ موجودة: فكلُّ حفظٍ على
 * مركبة — تعديلُ بيانٍ، إضافةُ جهاز تتبّع — يردّ «fillHijriPairs is not a
 * function» ولا يُحفَظ شيء.
 */
const SUFFIX = 'Hijri';
const getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const sameDay = (a, b) => {
  const x = asDate(a); const y = asDate(b);
  if (!x && !y) return true;
  if (!x || !y) return false;
  return x.toISOString().slice(0, 10) === y.toISOString().slice(0, 10);
};
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// التواريخُ التي لها توأمٌ هجريٌّ مخزَّنٌ في سجلّ المركبة (models/VehicleMaster):
// رخصةُ السير والفحصُ الدوريّ. وغيرُهما (اشتراك GPS، التأمين…) ميلاديٌّ وحدَه —
// فلا يُخترَع له حقلٌ هجريٌّ لا وجودَ له في النموذج.
const VEHICLE_PAIRS = ['vehicleLicense.expiryDate', 'inspection.expiryDate'];

function fillHijriPairs($set, before = {}, known = VEHICLE_PAIRS) {
  const derived = {};
  if (!$set || typeof $set !== 'object') return derived;
  const bases = new Set();
  for (const k of Object.keys($set)) {
    if (k.endsWith(SUFFIX)) bases.add(k.slice(0, -SUFFIX.length));
    // ميلاديٌّ بلا توأمٍ مُرسَل: له توأمٌ إن كان معروفًا أو كان في السجلّ.
    else if (known.includes(k) || getPath(before, `${k}${SUFFIX}`) !== undefined) bases.add(k);
  }
  for (const base of bases) {
    const hk = `${base}${SUFFIX}`;
    const hasG = Object.prototype.hasOwnProperty.call($set, base);
    const hasH = Object.prototype.hasOwnProperty.call($set, hk);
    const gChanged = hasG && !sameDay($set[base], getPath(before, base));
    const hChanged = hasH && hKey($set[hk]) !== hKey(getPath(before, hk));
    try {
      if (hasH && !isBlank($set[hk]) && (!hasG || (hChanged && !gChanged))) {
        // الهجريُّ هو المكتوب: يُخرج ميلاديَّه.
        const g = fromHijriString(String($set[hk]).trim());
        if (g) { $set[base] = g; derived[base] = g; }
      } else if (hasG) {
        // الميلاديُّ هو المكتوب (أو مُسح): توأمُه يتبعه.
        const h = isBlank($set[base]) ? '' : toHijri($set[base]);
        if (h !== undefined && h !== null && (!hasH || hKey($set[hk]) !== hKey(h))) { $set[hk] = h; derived[hk] = h; }
      }
    } catch (e) { /* يُترك للتحقّق بعده */ }
  }
  return derived;
}

module.exports = { toHijri, fromHijri, fromHijriString, hKey, HIJRI_MONTHS_AR, fillHijriPairs };
