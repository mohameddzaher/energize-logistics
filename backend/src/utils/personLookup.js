/**
 * personLookup — أيُّ ملفٍّ في الموارد البشريّة هذا الرجل؟
 *
 * ── لماذا هنا ───────────────────────────────────────────────────────────────
 * قاعدةُ صاحب الشركة: «سجلٌّ واحدٌ للشخص في النظام كلِّه» — والشخصُ ملفُّه في
 * الموارد البشريّة (`Employee`)، يُعرَف برقم هويّته: في `iqamaNumber` للمقيم وفي
 * `nationalId` للسعوديّ (ويُنسخ الثاني إلى الأوّل عند الحفظ، لكنّ ملفّاتٍ قديمةً
 * لم تُحفَظ بعده). فالبحثُ في العمودين معًا، وإلّا قُرئ رقمٌ مكتوبٌ كأنّه مفقود.
 *
 * ── وصلتُه بـ `utils/personRef` ─────────────────────────────────────────────
 * بابُ الربط العامّ للأشخاص يُكتب في `utils/personRef` (بحثٌ برقم الهويّة ثمّ
 * بالاسم المطويّ، و`displayName`). وهذا الملفُّ نسخةٌ صغيرةٌ بالمعنى نفسِه لأقسامٍ
 * كُتبت قبله (سائقو طلبات الشحنات، الفنّيّون، المستخدمون) — **يُستبدَل به حين
 * يصل، ولا يُضاف إليه شيء**: قاعدتان للشخص الواحد تتباعدان بصمت.
 */
const S = (v) => String(v == null ? '' : v).trim();

/** رقمُ الهويّة بلا مسافاتٍ وبأرقامٍ غربيّة — «٢٤٥ ٦٧» و«24567» رقمٌ واحد. */
const idKey = (v) => S(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s+/g, '');

/** الاسمُ الذي يُعرَض للشخص: الاسمُ العربيّ الكامل إن وُجد، وإلّا الأوّلُ والأخير. */
const displayName = (e) => (e ? (S(e.arabicName) || [S(e.firstName), S(e.lastName)].filter(Boolean).join(' ')) : '');

/** طيُّ الاسم للمقارنة: صورُ الحرف والمسافاتُ وحالةُ اللاتينيّة لا تصنع رجلًا ثانيًا. */
const foldName = (s) => S(s)
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^؀-ۿa-zA-Z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const SELECT = '_id firstName lastName arabicName iqamaNumber nationalId idType phone nationality employmentStatus';

/** ملفٌّ واحدٌ برقم الهويّة، أو null. */
async function byIdNumber(id, select = SELECT) {
  const k = idKey(id);
  if (!k) return null;
  const Employee = require('../models/Employee');
  return Employee.findOne({ $or: [{ iqamaNumber: k }, { nationalId: k }] }).select(select).lean();
}

/** دفعةً واحدة: Map من رقم الهويّة إلى الملفّ. الرقمُ الذي يحمله ملفّان يُترَك (لا يُخمَّن). */
async function byIdNumbers(ids, select = SELECT) {
  const keys = [...new Set((ids || []).map(idKey).filter(Boolean))];
  const out = new Map();
  if (!keys.length) return out;
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ $or: [{ iqamaNumber: { $in: keys } }, { nationalId: { $in: keys } }] })
    .select(select).lean();
  const seen = new Map();
  for (const e of rows) {
    for (const k of new Set([idKey(e.iqamaNumber), idKey(e.nationalId)])) {
      if (!k || !keys.includes(k)) continue;
      if (seen.has(k) && String(seen.get(k)._id) !== String(e._id)) { out.delete(k); seen.set(k, { _id: 'ambiguous' }); continue; }
      if (seen.get(k)?._id === 'ambiguous') continue;
      seen.set(k, e); out.set(k, e);
    }
  }
  return out;
}

module.exports = { idKey, displayName, foldName, byIdNumber, byIdNumbers, SELECT };
