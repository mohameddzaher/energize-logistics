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

module.exports = { toHijri, fromHijri, fromHijriString, hKey, HIJRI_MONTHS_AR };
