/**
 * ── الشهرُ يُقرأ بأيّ صورةٍ كُتب، ولا يُسقِط الصفحة ────────────────────────
 *
 * حقلُ `month` في القاعدة رقمٌ من ١ إلى ١٢، وكان يُقرأ `Number(req.query.month)`
 * مباشرةً. فرابطٌ يحمل `month=2026-09` — وهي الصورةُ التي يكتبها الإنسانُ
 * ويحفظها في مفضّلته — يعطي `NaN`، فترفض Mongoose التحويلَ ويسقط النداءُ
 * بخطأ ٥٠٠: «تعذّر تحميل المعاملات»، والشاشةُ فارغةٌ بلا سبب. قيس على
 * البرودكشن في أربع نقاط (التخليص، تحليلاته، استغلال العقود، طلبات B2C).
 *
 * فالقراءةُ تقبل الصورتين: رقمَ الشهر وحدَه، و`YYYY-MM` فتُؤخذ منها السنةُ
 * أيضًا. وما لا يُفهَم يُهمَل — الفلترُ الخاطئ يُتجاهَل ولا يُسقِط شاشة.
 */
const parseMonth = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return { month: null, year: null };
  const ym = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ym) {
    const mo = Number(ym[2]);
    return { month: mo >= 1 && mo <= 12 ? mo : null, year: Number(ym[1]) };
  }
  const n = Number(s);
  return { month: Number.isInteger(n) && n >= 1 && n <= 12 ? n : null, year: null };
};

/** سنةٌ معقولة أو `null` — لا `NaN` يصل إلى القاعدة. */
const parseYear = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= 1900 && n <= 2999 ? n : null;
};

module.exports = { parseMonth, parseYear };
