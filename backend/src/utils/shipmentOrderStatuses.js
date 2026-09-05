/**
 * مفرداتُ حالات الشحنة — العقدُ في الشيفرة، والتسميةُ في الإعدادات.
 *
 * ── لماذا الاثنان معًا ─────────────────────────────────────────────────────
 * طُلب أن تُضبَط حالاتُ الشحنة من إعدادات القسم. والحالةُ في الوقت نفسِه ليست
 * تسميةً تُبدَّل: `arrived` تعدّها التحليلات، و`late` تُطلق منها التنبيهات،
 * و`bond_received` يقف عليها شرطُ المشتريات في المحفظة — والمنصّةُ الخارجيّة
 * تتكلّم بهذه المفاتيح نفسِها. فحذفُ مفتاحٍ من شاشةٍ يُسكت منطقًا في قسمٍ آخر.
 *
 * فالمفاتيحُ العشرةُ مكتوبةٌ هنا ولا تُحذَف. والذي يملكه القسمُ من إعداداته:
 * **الاسمُ الظاهر ولونُه وترتيبُه وأهو مُستعمَلٌ اليوم** — ويملك أن يزيد حالةً
 * حاديةَ عشرةَ من عنده، فتُقبَل في الحفظ وتظهر في البطاقات وفي كلّ قائمة.
 *
 * والمخزَّنُ على الشحنة هو **المفتاح** لا الاسم: تُعاد تسميةُ «وصلت» غدًا فلا
 * يتغيّر شيءٌ في ثلاثةٍ وثلاثين ألفَ سجلّ.
 */

// العشرةُ الأساسيّة — تُطابق مرآةَ منصّة التشغيل حرفًا بحرف.
const CORE = [
  { key: 'requesting', en: 'Requesting', ar: 'قيد الطلب', color: '#64748b' },
  { key: 'loading', en: 'Loading', ar: 'جاري التحميل', color: '#d97706' },
  { key: 'uploaded', en: 'Uploaded', ar: 'تم التحميل', color: '#ca8a04' },
  { key: 'on_way', en: 'On Way', ar: 'في الطريق', color: '#2563eb' },
  { key: 'arrived', en: 'Arrived', ar: 'وصلت', color: '#4f46e5' },
  { key: 'bond_sent', en: 'Bond Sent', ar: 'أُرسل السند', color: '#0891b2' },
  { key: 'bond_received', en: 'Bond Received', ar: 'استُلم السند', color: '#059669' },
  { key: 'late', en: 'Late', ar: 'متأخرة', color: '#ea580c' },
  { key: 'invoiced', en: 'Invoiced', ar: 'تمت الفوترة', color: '#7c3aed' },
  { key: 'cancelled', en: 'Cancelled', ar: 'ملغاة', color: '#dc2626' },
];

const CORE_KEYS = new Set(CORE.map((s) => s.key));

/**
 * القائمةُ كما يراها المستخدمُ الآن: الأساسيّةُ بتسمياتها المضبوطة، ثمّ ما زاده.
 *
 * وتُقرأ من القاعدة في كلّ نداء بلا ذاكرة: القائمةُ عشرةُ صفوفٍ، وذاكرةٌ لها
 * تعني أنّ من عدّل تسميةً في الإعدادات لا يراها إلّا بعد دقيقة — وهو بالضبط ما
 * تعنيه كلمةُ «حيّ» في الطلب.
 */
async function statusVocabulary({ includeInactive = false } = {}) {
  let rows = [];
  try {
    const Lookup = require('../models/Lookup');
    rows = await Lookup.find({ type: 'so_status', deleted: { $ne: true } })
      .sort({ order: 1, createdAt: 1 }).lean();
  } catch (_) { rows = []; }

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = [];

  // الأساسيّةُ أوّلًا وبترتيب دورتها إن لم يُعَد ترتيبُها.
  CORE.forEach((s, i) => {
    const r = byKey.get(s.key);
    byKey.delete(s.key);
    const active = r ? r.isActive !== false : true;
    if (!active && !includeInactive) return;
    out.push({
      key: s.key,
      ar: (r && r.nameAr) || s.ar,
      en: (r && r.nameEn) || s.en,
      color: (r && r.color) || s.color,
      order: r && typeof r.order === 'number' ? r.order : i,
      active,
      isCore: true,
    });
  });

  // ثمّ ما زاده القسمُ من عنده.
  byKey.forEach((r) => {
    const active = r.isActive !== false;
    if (!active && !includeInactive) return;
    out.push({
      key: r.key,
      ar: r.nameAr || r.key,
      en: r.nameEn || r.key,
      color: r.color || '#64748b',
      order: typeof r.order === 'number' ? r.order : 99,
      active,
      isCore: false,
    });
  });

  return out.sort((a, b) => a.order - b.order);
}

/**
 * أتُقبَل هذه الحالةُ في الحفظ؟
 *
 * المفتاحُ الأساسيُّ يُقبَل دائمًا وإن أُخفي من الشاشة — سجلَّاتٌ قديمةٌ تحمله،
 * ورفضُه في التعديل يمنع حفظَ شحنةٍ لم يمسَّ أحدٌ حالتَها. وما زاده القسمُ
 * يُقبَل ما دام قائمًا غيرَ محذوف.
 */
async function isValidStatus(key) {
  const k = String(key || '').trim();
  if (!k) return false;
  if (CORE_KEYS.has(k)) return true;
  const all = await statusVocabulary({ includeInactive: true });
  return all.some((s) => s.key === k);
}

module.exports = { CORE, CORE_KEYS, statusVocabulary, isValidStatus };
