/**
 * عدّادُ حالات حقول الموارد البشريّة — يُحسَب في القاعدة لا في العقدة.
 *
 * ── لماذا ─────────────────────────────────────────────────────────────────
 * لوحةُ الموارد البشريّة كانت تقرأ الموظّفين كلَّهم بحقولهم كلِّها ثمّ تعدّ
 * بالجافاسكربت. وقِيس ذلك على الإنتاج فبان أنّ العنقودَ يسلّم نحوَ **٩٥
 * كيلوبايت في الثانية** — رقمٌ ثابتٌ يتناسب معه كلُّ شيء تناسبًا مستقيمًا:
 *
 *     ٢٥ ك.ب →  ٢٥٠ مللي        ٢٠٣ ك.ب → ٢١٤٤ مللي
 *     ٦٧ ك.ب →  ٦٨٥ مللي        ١٫٠٧ م.ب → ١١٤٠٣ مللي
 *
 * فأربعُمئةٍ وواحدٌ وأربعون موظّفًا — ميجابايتٌ واحد — أحدَ عشرَ ثانيةً في كلّ
 * فتحةٍ للشريط. وليس ذلك بطءَ حسابٍ ولا كثرةَ بيانات: العدُّ نفسُه (`count`)
 * عشرُ مِلّي ثوانٍ. إنّما هو نقلُ المستندات.
 *
 * فالعدُّ يجري في القاعدة ويُنقَل الجوابُ وحدَه — بضعةُ كيلوبايتات.
 *
 * ── وحالةُ الحقل قاعدةٌ واحدة ─────────────────────────────────────────────
 * تُكتب هنا مرّةً بلغة التجميع، وهي نفسُها المكتوبةُ في `statusOf`:
 *
 *   • «مطلوب» ومملوءٌ فعلًا  → مملوء (الطلبُ قُضِي)
 *   • حالةٌ مكتوبة           → هي
 *   • لا حالة                → مملوءٌ أو لا يوجد
 */
const H = require('../config/hrFields');

/** تعبيرُ «قيمةِ» الحقل — يوافق `H.valueOf` بما فيه اختلافُ عمود الهوية. */
function valueExpr(key) {
  if (key === 'iqamaNumber') {
    // الهويةُ عمودان: السعوديُّ رقمُه في `nationalId`، وغيرُه في `iqamaNumber`.
    //
    // و«أوّلُ غيرِ الفارغ» لا `$ifNull`: الأخيرةُ ترتدّ عن null والغياب فقط،
    // وجافاسكربت `||` ترتدّ عن النصّ الفارغ أيضًا. وموظّفان لهما `nationalId`
    // نصٌّ فارغٌ ورقمٌ في `iqamaNumber` — فيقرؤهما الأصلُ رقمًا وتقرؤهما
    // `$ifNull` فراغًا.
    const first = (a, b2) => ({
      $let: {
        vars: { x: { $ifNull: [a, ''] }, y: { $ifNull: [b2, ''] } },
        in: { $cond: [{ $ne: ['$$x', ''] }, '$$x', '$$y'] },
      },
    });
    return {
      $cond: [{ $eq: ['$idType', 'national_id'] },
        first('$nationalId', '$iqamaNumber'),
        first('$iqamaNumber', '$nationalId')],
    };
  }
  return { $ifNull: [`$${key}`, ''] };
}

/** أمملوءٌ هو؟ — الفارغُ نصًّا والصفرُ الفارغُ وnull سواء. */
function filledExpr(key) {
  const v = valueExpr(key);
  return { $not: [{ $in: [v, ['', null, []]] }] };
}

/** حالةُ الحقل كتعبيرِ تجميع. */
function statusExpr(key) {
  const st = { $ifNull: [`$fieldStatus.${H.statusKeyOf(key)}`, ''] };
  const filled = filledExpr(key);
  return {
    $switch: {
      branches: [
        { case: { $and: [{ $eq: [st, 'required'] }, filled] }, then: 'filled' },
        { case: { $ne: [st, ''] }, then: st },
        { case: filled, then: 'filled' },
      ],
      default: 'none',
    },
  };
}

/**
 * عددُ كلّ حالةٍ لكلّ حقل، لمجموعةِ الموظّفين المطابقة.
 * يُعيد: { [fieldKey]: { required, not_required, filled, none, … } }
 */
async function statusCounts(Employee, match, keys) {
  const project = { _id: 0 };
  for (const k of keys) project[k.replace(/\./g, '__')] = statusExpr(k);

  // مجموعةٌ واحدةٌ تجمع الكلَّ: لكلّ حقلٍ عدّادٌ لكلّ حالة.
  const group = { _id: null };
  const STATES = ['required', 'not_required', 'filled', 'none', 'cash_payroll', 'unparseable'];
  for (const k of keys) {
    const safe = k.replace(/\./g, '__');
    for (const s of STATES) {
      group[`${safe}__${s}`] = { $sum: { $cond: [{ $eq: [`$${safe}`, s] }, 1, 0] } };
    }
  }

  const [row] = await Employee.aggregate([
    { $match: match },
    { $project: project },
    { $group: group },
  ]).allowDiskUse(true);

  const out = {};
  for (const k of keys) {
    const safe = k.replace(/\./g, '__');
    out[k] = {};
    for (const s of STATES) out[k][s] = row ? (row[`${safe}__${s}`] || 0) : 0;
  }
  return out;
}

/**
 * توزيعُ قيمِ الحقول القابلة للتجميع — في القاعدة كذلك.
 *
 * البطاقةُ تعرض عشرين قيمةً وعددَ كلٍّ منها. ونقلُ القيم كلِّها لأربعمئةِ
 * موظّفٍ لحسابها في العقدة هو الثمنُ نفسُه الذي دُفع في العدّ.
 */
async function valueDistributions(Employee, match, keys, limit = 25) {
  if (!keys.length) return {};
  const facet = {};
  for (const k of keys) {
    facet[k.replace(/\./g, '__')] = [
      { $group: {
        _id: {
          $let: {
            vars: { v: valueExpr(k) },
            in: {
              $switch: {
                branches: [
                  { case: { $eq: ['$$v', true] }, then: 'نعم' },
                  { case: { $eq: ['$$v', false] }, then: 'لا' },
                  { case: { $in: ['$$v', ['', null, []]] }, then: '—' },
                ],
                default: { $toString: '$$v' },
              },
            },
          },
        },
        count: { $sum: 1 },
      } },
      { $sort: { count: -1, _id: 1 } },
    ];
  }
  const [row] = await Employee.aggregate([{ $match: match }, { $facet: facet }]).allowDiskUse(true);
  const out = {};
  for (const k of keys) {
    const list = (row?.[k.replace(/\./g, '__')] || []).map((x) => ({ value: String(x._id), count: x.count }));
    out[k] = { list: list.slice(0, limit), total: list.length };
  }
  return out;
}

/** عدُّ صفوفٍ بشرطٍ منطقيّ — للمجاميع العامّة (خارج المملكة، فريلانسر…). */
async function boolCounts(Employee, match, exprs) {
  const group = { _id: null, total: { $sum: 1 } };
  for (const [name, expr] of Object.entries(exprs)) {
    group[name] = { $sum: { $cond: [expr, 1, 0] } };
  }
  const [row] = await Employee.aggregate([{ $match: match }, { $group: group }]);
  const out = { total: row?.total || 0 };
  for (const name of Object.keys(exprs)) out[name] = row ? (row[name] || 0) : 0;
  return out;
}

/**
 * حالاتُ انتهاء مستنداتِ المجموعات — في القاعدة.
 *
 * تُطابق `H.stateOf` حرفًا بحرف: «غير مطلوب» أو «لا يوجد» ⇒ لا ينطبق، ثمّ
 * بلا تاريخٍ ⇒ ناقص، ثمّ سالبُ الأيّام ⇒ منتهٍ، ثمّ العتبتان.
 */
async function docStateCounts(Employee, match, groups, alert = {}) {
  const crit = Number(alert.criticalDays ?? 30);
  const warn = Number(alert.warnDays ?? 60);
  const docs = groups.filter((g) => g.document && g.expiryField);
  if (!docs.length) return {};

  const project = { _id: 0 };
  for (const g of docs) {
    const st = statusExpr(g.expiryField);
    // `stateOf` تتلقّى '' حين تكون الحالةُ «مملوء» — فلا تُقرأ إلّا الحالتان.
    // ── والتواريخُ هنا نصوصٌ لا تواريخ ────────────────────────────────
    // سبعةٌ من حقول الانتهاء الثمانية مخزَّنةٌ نصًّا («YYYY-MM-DD») لا كائنَ
    // تاريخ — هكذا عُرِّفت. و`$dateDiff` لا تقبل نصًّا، فيُحوَّل بـ`$convert`
    // مع `onError: null` كي لا يُسقِط نصٌّ واحدٌ رديءُ الشكل الاستعلامَ كلَّه:
    // ما لا يُقرأ تاريخًا يُعَدُّ «ناقصًا»، وهو ما تفعله `daysLeft` نفسُها.
    const asDate = { $convert: { input: `$${g.expiryField}`, to: 'date', onError: null, onNull: null } };
    const days = {
      $let: {
        vars: { dd: asDate },
        in: { $cond: [{ $eq: ['$$dd', null] }, null,
          { $dateDiff: { startDate: '$$NOW', endDate: '$$dd', unit: 'day' } }] },
      },
    };
    project[`${g.key}__days`] = {
      $let: { vars: { d: days }, in: { $cond: [{ $gte: ['$$d', 0] }, '$$d', null] } },
    };
    project[g.key] = {
      $let: {
        vars: { s: st, d: days },
        in: {
          $switch: {
            branches: [
              { case: { $in: ['$$s', ['not_required', 'none']] }, then: 'not_applicable' },
              { case: { $eq: ['$$d', null] }, then: 'missing' },
              { case: { $lt: ['$$d', 0] }, then: 'expired' },
              { case: { $lte: ['$$d', crit] }, then: 'critical' },
              { case: { $lte: ['$$d', warn] }, then: 'warning' },
            ],
            default: 'valid',
          },
        },
      },
    };
  }

  const STATES = ['valid', 'warning', 'critical', 'expired', 'missing', 'not_applicable'];
  const group = { _id: null };
  for (const g of docs) {
    for (const st of STATES) {
      group[`${g.key}__${st}`] = { $sum: { $cond: [{ $eq: [`$${g.key}`, st] }, 1, 0] } };
    }
    // أقربُ انتهاءٍ لم يمضِ — الرقمُ الذي تعرضه البطاقة.
    group[`${g.key}__nearest`] = { $min: `$${g.key}__days` };
  }

  const [row] = await Employee.aggregate([{ $match: match }, { $project: project }, { $group: group }]).allowDiskUse(true);
  const out = {};
  for (const g of docs) {
    out[g.key] = { states: {}, nearest: row ? row[`${g.key}__nearest`] : null };
    for (const st of STATES) out[g.key].states[st] = row ? (row[`${g.key}__${st}`] || 0) : 0;
  }
  return out;
}

module.exports = {
  statusCounts, valueDistributions, boolCounts, docStateCounts,
  statusExpr, filledExpr, valueExpr,
};
