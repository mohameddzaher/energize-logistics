/**
 * حدُّ صفوفٍ **يُعلِن نفسه** — لا يقصّ بصمت.
 *
 * ── لماذا يلزم هذا أصلًا ────────────────────────────────────────────────────
 * كلُّ سقفٍ يُكتب اليوم يصير ضيّقًا يومًا: تكبر الشركة، وتتراكم السنوات، فتبلغ
 * مجموعةٌ حدَّها. والقصُّ الصامت أخطر من الخطأ الصريح: الخطأ يُرى ويُعالَج،
 * والناتجُ المقصوصُ يبدو كاملًا فيُصدَّق ويُبنى عليه قرار.
 *
 * وقد وقع ذلك هنا فعلًا: طلبات الأفراد اليوميّة بلغت ثلاثةً وأربعين ألفًا تحت
 * سقفٍ من خمسة آلاف، فكانت الشاشة تعرض ثُمنَ ما تظنّ أنها تعرضه.
 *
 * القاعدة: يُطلَب سقفٌ + واحد. فإن عاد الزائدُ فالنتيجة مقصوصة، ويُقال ذلك في
 * الردّ — ويبقى للطالب أن يضيّق مداه أو يرفع سقفه عن علم.
 *
 *   const { rows, truncated, limit } = await cappedFind(Model.find(f).sort(s), 1000);
 *   res.json({ rows, ...(truncated && { truncated, limit, note: CAP_NOTE }) });
 */
const CAP_NOTE_AR = 'النتيجة مبتورة عند الحدّ — ضيّق المدى أو ارفع limit';
const CAP_NOTE_EN = 'Result truncated at the cap — narrow the range or raise limit';

/**
 * @param {import('mongoose').Query} query  استعلامٌ مُهيَّأ بلا `limit`
 * @param {number} cap                      أقصى عددٍ يُعاد
 * @returns {Promise<{rows: any[], truncated: boolean, limit: number}>}
 */
async function cappedFind(query, cap) {
  const rows = await query.limit(cap + 1).lean();
  if (rows.length > cap) {
    return { rows: rows.slice(0, cap), truncated: true, limit: cap };
  }
  return { rows, truncated: false, limit: cap };
}

/** يقرأ `limit` من الاستعلام بحدٍّ أدنى وأقصى — فلا يطلب أحدٌ الملايين بالخطأ. */
function askedLimit(q, fallback, max) {
  const n = Number(q && q.limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

module.exports = { cappedFind, askedLimit, CAP_NOTE_AR, CAP_NOTE_EN };
