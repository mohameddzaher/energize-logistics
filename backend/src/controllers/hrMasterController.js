/**
 * hrMasterController — نظرة الموارد البشرية الشاملة: كارت لكل عمود، وقايمة شغل.
 *
 * الفكرة اللي القسم ده مبني عليها: الداشبورد مش عرض أرقام، دي **قايمة شغل**.
 * كل رقم «مطلوب» معناه ناقص لازم التيم يجمّعه، والضغط عليه بيفتح الناس اللي
 * ناقصهم بالظبط عشان يتملي من هناك على طول.
 *
 * وعشان كده «مطلوب» و«غير مطلوب» مفصولين في كل عدّاد: سعودي مالوش إقامة مش
 * «ناقص إقامة»، وحطّه في قايمة الشغل بيخلّيها كذب وبيضيّع وقت الناس.
 */
const Employee = require('../models/Employee');
const H = require('../config/hrFields');
const cache = require('../utils/ttlCache');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

const emit = () => { try { emitToAll('hr:master', {}); } catch (e) {} cache.clear('hrm:'); };
const filled = (v) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));
const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/**
 * حالة حقل عند موظف: مطلوب / غير مطلوب / لا يوجد / مملي.
 *
 * القيمة الموجودة تسبق العَلَم الإداري: حقلٌ فيه تاريخ إقامة مكتوب ليس «مطلوبًا»
 * مهما قال العَلَم — العَلَم أثرٌ قديم من قبل أن يُملأ الحقل، وإبقاؤه يضع اسمًا
 * في قائمة عملٍ لا عمل فيه فيضيّع وقت مَن يفتحه.
 *
 * أما «غير مطلوب» و«راتب نقدي» فيبقيان كما هما: هما قرارٌ إداريّ لا نقصُ بيانات،
 * ولا تنقضهما قيمةٌ موجودة.
 */
const statusOf = (emp, fieldKey) => {
  const st = emp.fieldStatus?.[H.statusKeyOf(fieldKey)];
  if (st === 'required' && filled(emp[fieldKey])) return 'filled';
  if (st) return st;
  return filled(emp[fieldKey]) ? 'filled' : 'none';
};

// عتبات التنبيه — نفس فكرة المركبات. لو حبينا نخلّيها قابلة للتعديل بعدين،
// المكان ده هو اللي هيتغيّر.
const ALERT = { warnDays: 60, criticalDays: 30 };

// الحقول التي يجوز الفلترة بها — مشتقّة من تعريف الحقول نفسه، فأي حقل يُضاف
// هناك ويُعلَّم `groupable` يصير قابلًا للفلترة هنا تلقائيًّا بلا تعديل.
const FILTERABLE = [...new Set([
  ...H.GROUPS.flatMap((g) => g.fields.filter((x) => x.groupable).map((x) => x.key)),
  'department', 'branchName', 'project', 'nationality', 'workStatusText', 'bank',
  'licenseType', 'insuranceCompany', 'directManagerName', 'iqamaProfession', 'idType',
  'gender', 'driverCardStatus', 'insuranceClass', 'contractStatusText', 'systemStatus',
])].filter((k) => !['isOutsideKingdom', 'isFreelancer'].includes(k));

// حقول التاريخ التي تقبل مدى (من/إلى).
const DATE_FILTERABLE = [
  'hireDate', 'dateOfBirth', 'iqamaExpiry', 'passportExpiry', 'contractEndDate',
  'insuranceExpiry', 'healthCertExpiry', 'driverCardExpiry', 'licenseExpiry',
];

function buildFilter(q) {
  // سجلات حسابات الدخول التلقائية مش موظفين — بتخرج من كل عدّاد وكل قايمة هنا.
  const f = { isHrRecord: { $ne: false } };
  // النطاق الافتراضي = **الملف الوظيفي الحالي** (٣٧٨ صف الماستر). اللي خرج قبل
  // كده سجله محفوظ كتاريخ ومش بيتعدّ مع الموظفين، وإلا «عدد الموظفين» بيبقى
  // رقم مالوش معنى. `scope=all` بيرجّع كل حاجة بالتاريخ.
  if (q.scope !== 'all') f.inCurrentMaster = true;
  // حالة التوظيف تُقرأ من `employment`. كان اسمها `status`، وهو الاسم نفسه الذي
  // تستعمله صفحة المجموعة لحالة الخانة (مطلوب/غير مطلوب) — فكان «جدة + على رأس
  // العمل» يصل إلى الجدول فيُقرأ «حالة خانة اسمها active» فيُرجع صفرًا. الاسم
  // القديم ما زال مقبولًا لأن روابط محفوظة تستعمله.
  const employment = q.employment || (['active', 'inactive'].includes(q.status) ? q.status : '');
  if (employment === 'active') f.employmentStatus = 'active';
  if (employment === 'inactive') f.employmentStatus = { $ne: 'active' };
  // ── الفلترة بأكثر من قيمة، وبأكثر من حقل معًا ──────────────────────────────
  // «أرِني الباكستانيين والهنود، الذكور، في النقل الثقيل، بجدة ومكة» سؤال واحد
  // لا أربعة. كان كل حقل يقبل قيمةً واحدة، فيُجيب عن ربعه.
  //
  // القيم تصل مفصولةً بفواصل، و«—» تعني الخانة الفارغة — وهي فئةٌ حقيقية:
  // «مَن لا جنسية مسجَّلة له» سؤال يُسأل، لا نتيجةَ خطأ.
  const multi = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const k of FILTERABLE) {
    const vals = multi(q[k]);
    if (!vals.length) continue;
    const wantsBlank = vals.includes('—');
    const rest = vals.filter((x) => x !== '—');
    if (wantsBlank && rest.length) f[k] = { $in: [...rest, '', null] };
    else if (wantsBlank) f[k] = { $in: ['', null] };
    else f[k] = { $in: rest };
  }
  // الحقول المنطقية: تقبل نعم/لا صراحةً بدل أن تكون «مفعَّلة أو لا شيء».
  for (const [qk, field] of [['outsideKingdom', 'isOutsideKingdom'], ['freelancer', 'isFreelancer']]) {
    if (q[qk] === '1') f[field] = true;
    else if (q[qk] === '0') f[field] = { $ne: true };
  }
  // مدى التاريخ **لا يُطبَّق هنا** — انظر dateRangePred تحت. حقول التواريخ في
  // هذا الملف مخزَّنة نصًّا لأنها تحمل كلمات إدارية بجانب التاريخ («مطلوب»،
  // «غير مطلوب»)، فمقارنتها بـ$gte/$lte على كائن تاريخ تقارن نوعين مختلفين في
  // BSON فتُرجع صفوفًا لا علاقة لها بالمدى المطلوب. تُطبَّق على القيمة بعد
  // قراءتها تاريخًا حقيقيًّا.
  if (q.q && q.q.trim()) {
    const r = rx(q.q);
    f.$or = [{ arabicName: r }, { firstName: r }, { lastName: r }, { employeeNumber: r }, { iqamaNumber: r }, { passportNumber: r }, { companyNumber: r }, { absherNumber: r }];
  }
  return f;
}

/**
 * شرط مدى التاريخ — يُطبَّق على الصفوف بعد جلبها.
 *
 * القيمة قد تكون تاريخًا مخزَّنًا وقد تكون كلمة («مطلوب»). الكلمة ليست تاريخًا
 * خارج المدى، بل **لا تاريخ لها**، فتخرج من أي مدى — ويردّها الفلتر «—» وحده.
 */
const asDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};
function dateRangePred(q) {
  const tests = [];
  for (const key of DATE_FILTERABLE) {
    // «—» على حقل تاريخ = لا تاريخ مقروء أصلًا (فارغ أو كلمة إدارية).
    if (String(q[key] ?? '').split(',').map((x) => x.trim()).includes('—')) {
      tests.push((e) => asDate(e[key]) === null);
      continue;
    }
    const from = q[`${key}From`]; const to = q[`${key}To`];
    if (!from && !to) continue;
    const lo = from ? new Date(`${from}T00:00:00.000Z`) : null;
    const hi = to ? new Date(`${to}T23:59:59.999Z`) : null;
    tests.push((e) => {
      const d = asDate(e[key]);
      if (!d) return false;
      return (!lo || d >= lo) && (!hi || d <= hi);
    });
  }
  return tests.length ? (e) => tests.every((t) => t(e)) : null;
}

// تُصدَّر ليستعملها قائمة الموظفين العامة، فيصير للفلترة لغةٌ واحدة في القسم
// كلّه: ما تكتبه لوحة الموارد البشرية تفهمه القائمة، وما يفهمه الموقع يفهمه
// التطبيق. لغتان للفلترة تعنيان حتمًا رقمين مختلفين للسؤال نفسه.
exports._buildFilter = buildFilter;
exports._dateRangePred = dateRangePred;

/** جلب الموظفين بكل شروط الاستعلام — شروط قاعدة البيانات ثم شروط التواريخ. */
async function findEmployees(q, select) {
  let query = Employee.find(buildFilter(q));
  if (select) query = query.select(select);
  // بلا hint: إجبار المخطِّط على فهرسٍ بعينه يجعل كل استعلام يفشل إن لم يكن
  // ذلك الفهرس موجودًا على العنقود — وهو ما كان يحدث هنا حرفيًّا. الفهارس
  // تُنشأ بـ scripts/addHrIndexes.js ويختار المخطِّط منها ما يناسب كل استعلام.
  const rows = await query.lean();
  const pred = dateRangePred(q);
  return pred ? rows.filter(pred) : rows;
}

// ── تحليلات مشتقّة ─────────────────────────────────────────────────────────
//
// أعمدة كثيرة قيمتها تاريخ خام لا يُقرأ منه شيء بالعين: «١٩٨٧-٠٣-١١» لا تقول
// «في الثلاثينات». هذه الدوال تحوّل التواريخ إلى شرائح يفهمها القارئ — وتُرفق
// مع كل شريحة **الفلتر الذي يعيد إنتاجها بالضبط**، فالضغط عليها يفتح صفوفها
// دون أن تعيد الواجهة استنتاج الشرط (ولو استنتجته لاختلف الرقم يومًا ما).
const iso = (d) => d.toISOString().slice(0, 10);
const shiftYears = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return iso(d); };
const nextDay = (isoStr) => { const d = new Date(`${isoStr}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const shiftDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

/** شرائح عمر/أقدمية: حدّان بالسنوات على حقل تاريخ. */
const yearBands = (rows, key, bands) => bands.map((b) => {
  // الأكبر سنًّا = الأقدم تاريخًا. حدّ «من» يُزاح يومًا لأن نهاية الشريحة السابقة
  // هي نفس التاريخ، فلولا الإزاحة لوقع من يبلغ الحدّ تمامًا في الشريحتين معًا.
  const from = b.max == null ? null : nextDay(shiftYears(b.max));
  const to = b.min == null ? null : shiftYears(b.min);
  const f = {};
  if (from) f[`${key}From`] = from;
  if (to) f[`${key}To`] = to;
  const count = rows.filter((r) => {
    const v = r[key] instanceof Date ? r[key] : (r[key] ? new Date(r[key]) : null);
    if (!v || isNaN(v)) return false;
    const s = iso(v);
    return (!from || s >= from) && (!to || s <= to);
  }).length;
  return { label: b.ar, labelEn: b.en, count, filter: f };
});

/** آفاق انتهاء مستند: منتهٍ / خلال ٣٠ / ٣١-٦٠ / ٦١-٩٠ / أبعد / بلا تاريخ. */
const expiryHorizon = (rows, key) => {
  const today = iso(new Date());
  const mk = (ar, en, from, to) => {
    const f = {};
    if (from) f[`${key}From`] = from;
    if (to) f[`${key}To`] = to;
    const count = rows.filter((r) => {
      const v = r[key] ? new Date(r[key]) : null;
      if (!v || isNaN(v)) return false;
      const s = iso(v);
      return (!from || s >= from) && (!to || s <= to);
    }).length;
    return { label: ar, labelEn: en, count, filter: f };
  };
  const out = [
    // «منتهٍ» ينتهي بالأمس و«خلال ٣٠» تبدأ اليوم — ولو تقاطعا عند اليوم نفسه
    // لعُدَّ من ينتهي اليوم مرتين، فيتجاوز مجموع الشرائح عدد الموظفين.
    mk('منتهٍ', 'Expired', null, shiftDays(-1)),
    mk('خلال ٣٠ يومًا', 'Within 30d', today, shiftDays(30)),
    mk('٣١ إلى ٦٠ يومًا', '31–60d', shiftDays(31), shiftDays(60)),
    mk('٦١ إلى ٩٠ يومًا', '61–90d', shiftDays(61), shiftDays(90)),
    mk('أبعد من ٩٠ يومًا', 'Beyond 90d', shiftDays(91), null),
  ];
  const dated = rows.filter((r) => r[key] && !isNaN(new Date(r[key]))).length;
  out.push({ label: 'بلا تاريخ مسجَّل', labelEn: 'No date', count: rows.length - dated, filter: { [key]: '—' } });
  return out;
};

const AGE_BANDS = [
  { ar: 'أقل من ٢٥', en: 'Under 25', min: null, max: 25 },
  { ar: '٢٥ إلى ٣٤', en: '25–34', min: 25, max: 35 },
  { ar: '٣٥ إلى ٤٤', en: '35–44', min: 35, max: 45 },
  { ar: '٤٥ إلى ٥٤', en: '45–54', min: 45, max: 55 },
  { ar: '٥٥ فأكثر', en: '55+', min: 55, max: null },
];
const TENURE_BANDS = [
  { ar: 'أقل من سنة', en: 'Under 1y', min: null, max: 1 },
  { ar: 'سنة إلى سنتين', en: '1–2y', min: 1, max: 3 },
  { ar: '٣ إلى ٥ سنوات', en: '3–5y', min: 3, max: 6 },
  { ar: '٦ إلى ١٠ سنوات', en: '6–10y', min: 6, max: 11 },
  { ar: 'أكثر من ١٠ سنوات', en: 'Over 10y', min: 11, max: null },
];
const HORIZON_DOCS = [
  { key: 'iqamaExpiry', ar: 'انتهاء الإقامات', en: 'Iqama expiry' },
  { key: 'contractEndDate', ar: 'انتهاء العقود', en: 'Contract end' },
  { key: 'passportExpiry', ar: 'انتهاء الجوازات', en: 'Passport expiry' },
  { key: 'insuranceExpiry', ar: 'انتهاء التأمين الطبي', en: 'Medical insurance' },
  { key: 'healthCertExpiry', ar: 'انتهاء الشهادات الصحية', en: 'Health certificate' },
  { key: 'driverCardExpiry', ar: 'انتهاء بطاقات السائقين', en: 'Driver card' },
  { key: 'licenseExpiry', ar: 'انتهاء رخص القيادة', en: 'Driving licence' },
];

const buildAnalytics = (rows) => {
  const out = [];
  out.push({ key: 'age', ar: 'الفئات العمرية', en: 'Age bands', kind: 'bar', items: yearBands(rows, 'dateOfBirth', AGE_BANDS) });
  out.push({ key: 'tenure', ar: 'مدة الخدمة', en: 'Tenure', kind: 'bar', items: yearBands(rows, 'hireDate', TENURE_BANDS) });
  for (const d of HORIZON_DOCS) {
    out.push({ key: `hz:${d.key}`, ar: d.ar, en: d.en, kind: 'horizon', field: d.key, items: expiryHorizon(rows, d.key) });
  }
  return out;
};

// ── الفلاتر المتاحة وقيمها ──────────────────────────────────────────────────
//
// الشاشة تحتاج أن تعرف: بأي الحقول أفلتر؟ وما القيم الممكنة لكلٍّ؟ وكم صفًّا
// وراء كل قيمة **بعد بقيّة الفلاتر المطبَّقة**؟
//
// الرقم الأخير هو بيت القصيد: لو حُسبت الأعداد على الملف كلّه لرأى المستخدم
// «الهند ٤٠» ثم اختار «النقل الثقيل» فوجدها ٣ — فيظنّ الشاشة تكذب. تُحسَب هنا
// على المجموعة المفلترة فعلًا، **عدا الحقل نفسه**: عند حساب قيم الجنسية نطبّق
// كل الفلاتر إلا الجنسية، وإلا لبقيت القيمة المختارة وحدها ظاهرةً ولَما استطاع
// أحد أن يضيف جنسيةً ثانية إلى اختياره.
exports.filterOptions = async (req, res) => {
  try {
    const key = `hrm:filters:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    // تعريف كل فلتر: مفتاحه واسمه ومجموعته.
    const defs = [];
    for (const g of H.GROUPS) {
      for (const fld of g.fields) {
        if (!fld.groupable) continue;
        defs.push({ key: fld.key, ar: fld.ar, en: fld.en, groupAr: g.ar, groupEn: g.en, groupKey: g.key });
      }
    }

    const tally = (rows, key) => {
      const counts = new Map();
      for (const r of rows) {
        const raw = r[key];
        const v = raw === true ? 'نعم' : raw === false ? 'لا' : (filled(raw) ? String(raw) : '—');
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    };

    // «كل الفلاتر إلا هذا الحقل» تختلف فعليًّا **فقط** للحقول المفلترة الآن؛
    // والبقيّة — وهي الأغلبية دائمًا — تشترك في المجموعة نفسها. فبدل ثمانية
    // عشر استعلامًا في كل فتحة للّوحة، استعلامٌ واحد لها جميعًا وواحدٌ لكل
    // فلترٍ نشط. مع خمسة فلاتر نشطة: ٦ استعلامات بدل ١٨.
    const isActive = (k) => {
      const v = req.query[k];
      return (v != null && v !== '') || req.query[`${k}From`] || req.query[`${k}To`];
    };
    const active = defs.filter((d) => isActive(d.key));
    const passive = defs.filter((d) => !isActive(d.key));

    const shared = passive.length
      ? await findEmployees(req.query, [...new Set([...passive.map((d) => d.key), ...DATE_FILTERABLE])].join(' '))
      : [];

    const perActive = await Promise.all(active.map(async (d) => {
      const others = { ...req.query };
      delete others[d.key]; delete others[`${d.key}From`]; delete others[`${d.key}To`];
      return [d.key, await findEmployees(others, [...new Set([d.key, ...DATE_FILTERABLE])].join(' '))];
    }));
    const byActive = new Map(perActive);

    // الترتيب يبقى ترتيب التعريف حتى لا تقفز الحقول في اللوحة بين فتحةٍ وأخرى.
    const filters = defs.map((d) => ({
      ...d,
      values: tally(byActive.get(d.key) || shared, d.key),
    }));

    const body = { filters, dateFields: DATE_FILTERABLE };
    cache.set(key, body, 20000);
    res.json(body);
  } catch (e) {
    console.error('hr filterOptions', e);
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  النظرة الشاملة
// ═══════════════════════════════════════════════════════════════════════════
exports.overview = async (req, res) => {
  try {
    const key = `hrm:ov:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    // مشروعٌ جزئيّ لتقليل النقل — و`fieldStatus` **أوّل** ما فيه.
    //
    // كان محذوفًا، وهو الحقل الذي تُقرأ منه حالة كل خانة؛ فبغيابه صارت كل خانة
    // «مملوءة أو لا شيء» وانهار عمود «مطلوب» كلّه إلى صفر — لوحةٌ تقول إن لا
    // عمل ينتظر، وفي القاعدة ٥٢٦٢ خانة تنتظر. تقليل النقل لا يجوز أن يحذف
    // الحقل الذي عليه يقوم الحساب.
    const requiredFields = [...new Set([
      'fieldStatus',
      'employeeNumber', 'arabicName', 'firstName', 'lastName', 'employmentStatus',
      'isOutsideKingdom', 'isFreelancer', 'iban', 'gosiNumber', 'inCurrentMaster',
      ...FILTERABLE, ...DATE_FILTERABLE,
      ...H.GROUPS.flatMap((g) => [g.expiryField, ...g.fields.map((f) => f.key)]).filter(Boolean),
    ])].join(' ');
    const employees = await findEmployees(req.query, requiredFields);

    // ── كارت لكل حقل ─────────────────────────────────────────────────────────
    // العدّادات الأربعة هي اللي المستخدم طلبها بالاسم: مطلوب، غير مطلوب، مملي،
    // والإجمالي. وكل واحد معاه الفلتر اللي بيفتح الناس دول بالظبط.
    const groups = H.GROUPS.map((g) => {
      const fields = g.fields.map((f) => {
        const counts = { required: 0, not_required: 0, none: 0, filled: 0, cash_payroll: 0, unparseable: 0 };
        const values = new Map();
        for (const e of employees) {
          const st = statusOf(e, f.key);
          counts[st] = (counts[st] || 0) + 1;
          if (f.groupable) {
            const raw = e[f.key];
            const v = raw === true ? 'نعم' : raw === false ? 'لا' : (filled(raw) ? String(raw) : '—');
            values.set(v, (values.get(v) || 0) + 1);
          }
        }
        return {
          key: f.key, ar: f.ar, en: f.en, type: f.type, group: g.key,
          total: employees.length,
          counts,
          // «مطلوب» هو الرقم اللي بيتصرف فيه — بيتقدّم في الترتيب.
          required: counts.required,
          values: f.groupable
            ? [...values.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
            : undefined,
        };
      });
      const out = {
        key: g.key, ar: g.ar, en: g.en, icon: g.icon, document: !!g.document,
        fields,
        required: fields.reduce((n, f) => n + f.required, 0),
      };
      // المجموعات اللي فيها مستند بتاريخ انتهاء بتاخد كمان حالات التاريخ.
      if (g.document) {
        const states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0 };
        let nearest = null;
        for (const e of employees) {
          const st = H.stateOf(e[g.expiryField], statusOf(e, g.expiryField) === 'filled' ? '' : statusOf(e, g.expiryField), ALERT);
          states[st.state] += 1;
          if (st.days != null && st.days >= 0 && (nearest === null || st.days < nearest)) nearest = st.days;
        }
        out.states = states;
        out.expiryField = g.expiryField;
        out.needsAttention = states.expired + states.critical + states.warning;
        out.nearestDays = nearest;
      }
      return out;
    });

    // ── كل رقم في هذه اللوحة محسوب على ما يعرضه الفلتر ────────────────────────
    // كان «الموظفون» و«على رأس العمل» يُحسبان من الملفّ كلّه مهما كان الفلتر،
    // بحجّة أن «عدد الموظفين» حقيقةٌ ثابتة. والنتيجة على الشاشة: تختار جنسيةً
    // عددها ٧٢ فتقرأ «الموظفون ٣٧٨» فوق أرقامٍ كلّها محسوبة على الـ٧٢ — لوحةٌ
    // نصفها يجيب عن سؤالك ونصفها يجيب عن سؤالٍ آخر، ولا شيء يقول أيّهما أيّ.
    // إجمالي الملفّ يبقى متاحًا: يُرفَع الفلتر فيظهر.
    const rosterFilter = { isHrRecord: { $ne: false } };
    if (req.query.scope !== 'all') rosterFilter.inCurrentMaster = true;
    const rosterTotal = await Employee.countDocuments(rosterFilter);
    const activeCount = employees.filter((e) => e.employmentStatus === 'active').length;

    const totals = {
      employees: employees.length,
      active: activeCount,
      notActive: employees.length - activeCount,
      // إجمالي الملفّ الوظيفيّ — تعرضه الشاشة بجانب الرقم المفلتر ليُعرف من أيٍّ
      // اقتُطع، لا لتحلّ محلّه.
      roster: rosterTotal,
      // اللي الفلتر الحالي بيعرضه — الأرقام اللي تحت كلها محسوبة عليه.
      filtered: employees.length,
      required: groups.reduce((n, g) => n + g.required, 0),
      expiringSoon: groups.reduce((n, g) => n + (g.needsAttention || 0), 0),
      outsideKingdom: employees.filter((e) => e.isOutsideKingdom).length,
      freelancers: employees.filter((e) => e.isFreelancer).length,
      cashPayroll: employees.filter((e) => statusOf(e, 'iban') === 'cash_payroll').length,
      gosiRegistered: employees.filter((e) => filled(e.gosiNumber)).length,
    };

    // ── الشغل اليوميّ، محسوبًا على المعروض ──────────────────────────────────
    // كانت هذه الأرقام تأتي من نداءٍ عامٍّ يتجاهل الفلتر، فتختار فرعًا فتقرأ
    // «٣٣٥ عهدة» وهي عهدُ الشركة كلها. صارت تُحسب على الموظفين المطابقين وحدهم،
    // ومعها ذهب نداءٌ كاملٌ من كل فتحةٍ للصفحة.
    const LeaveRequest = require('../models/LeaveRequest');
    const HRRequest = require('../models/HRRequest');
    const Asset = require('../models/Asset');
    const empIds = employees.map((e) => e._id);
    const [pendingLeaves, openRequests, assignedAssets] = await Promise.all([
      LeaveRequest.countDocuments({ employee: { $in: empIds }, status: { $in: ['pending_manager', 'pending_hr'] } }),
      HRRequest.countDocuments({ employee: { $in: empIds }, status: { $in: ['open', 'in_progress'] } }),
      Asset.countDocuments({ employee: { $in: empIds }, status: 'assigned' }),
    ]);
    const work = { pendingLeaves, openRequests, assignedAssets };

    // أكتر ١٢ حقل ناقص — «ابدأ من هنا».
    const topRequired = groups
      .flatMap((g) => g.fields.map((f) => ({ ...f, groupAr: g.ar, groupKey: g.key })))
      .filter((f) => f.required > 0)
      .sort((a, b) => b.required - a.required)
      .slice(0, 12);

    const body = { totals, work, groups, topRequired, analytics: buildAnalytics(employees), alert: ALERT, statuses: H.STATUS_LABELS, states: H.STATE_LABELS };
    // زيادة TTL الـ cache من 20s إلى 60s لتقليل الحسابات المتكررة
    cache.set(key, body, 60000);
    res.json(body);
  } catch (e) {
    console.error('hr overview', e);
    res.status(500).json({ message: 'تعذّر تحميل نظرة الموارد البشرية' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  صفحة كل مجموعة — الإقامات، الرخص، التأمينات …
// ═══════════════════════════════════════════════════════════════════════════
/**
 * GET /records/:group?field=&status=required&state=expired&withinDays=30&sort=&dir=
 *
 * بترجّع الموظفين + **حقول المجموعة دي بس** وحالة كل حقل، فالشاشة تقدر تعرض
 * الناقص وتخلّي المستخدم يملاه من نفس المكان.
 */
exports.records = async (req, res) => {
  try {
    const g = H.getGroup(req.params.group);
    if (!g) return res.status(404).json({ message: 'المجموعة غير معروفة' });

    // iqamaNumber يُرجَع دائمًا وإن لم يكن من حقول المجموعة — كل جدول في القسم
    // يعرض الموظف وبجانبه رقم هويته، وهو ما يبحث الناس به.
    const employees = await findEmployees(req.query,
      [...new Set(['employeeNumber', 'arabicName', 'firstName', 'lastName', 'iqamaNumber',
        'department', 'branchName', 'project', 'employmentStatus', 'workStatusText', 'fieldStatus',
        ...DATE_FILTERABLE, ...g.fields.map((f) => f.key)])].join(' '));

    const field = req.query.field || '';
    // «active»/«inactive» حالة توظيف لا حالة خانة — تُطبَّق في buildFilter،
    // ولا يجوز أن تُقرأ هنا حالةَ خانةٍ لا وجود لها فتُفرِّغ الجدول.
    const wantStatus = ['active', 'inactive'].includes(req.query.status) ? '' : (req.query.status || '');
    const wantState = req.query.state || '';
    const withinDays = req.query.withinDays === '' || req.query.withinDays == null ? null : Number(req.query.withinDays);
    // «ينتهي خلال ٣٠ يوم» كان بيرجّع المنتهي من سنة كمان، لأن -٣٦٥ أصغر من ٣٠.
    // المنتهي حاجة تانية خالص، فبقى اختيار صريح بدل ما يتلبّس على الفلتر.
    const includeExpired = req.query.includeExpired !== '0';

    let rows = employees.map((e) => {
      const values = {};
      const statuses = {};
      for (const f of g.fields) { values[f.key] = e[f.key] ?? null; statuses[f.key] = statusOf(e, f.key); }
      const doc = g.document
        ? H.stateOf(e[g.expiryField], statuses[g.expiryField] === 'filled' ? '' : statuses[g.expiryField], ALERT)
        : null;
      return {
        _id: e._id,
        employeeNumber: e.employeeNumber, name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        iqamaNumber: e.iqamaNumber || '',
        department: e.department, branchName: e.branchName, project: e.project,
        workStatusText: e.workStatusText, employmentStatus: e.employmentStatus,
        values, statuses,
        state: doc?.state || null, daysRemaining: doc?.days ?? null,
        // «ناقص إيه عند الشخص ده» — بالاسم، عشان الشاشة ما تحسبهاش تاني.
        missing: g.fields.filter((f) => statuses[f.key] === 'required').map((f) => ({ key: f.key, ar: f.ar })),
      };
    });

    if (field && wantStatus) rows = rows.filter((r) => r.statuses[field] === wantStatus);
    else if (wantStatus) rows = rows.filter((r) => g.fields.some((f) => r.statuses[f.key] === wantStatus));
    if (wantState) rows = rows.filter((r) => r.state === wantState);
    if (withinDays !== null && g.document) {
      rows = rows.filter((r) => r.daysRemaining != null && r.daysRemaining <= withinDays
        && (includeExpired || r.daysRemaining >= 0));
    }

    // الترتيب: بالأقرب انتهاءً افتراضيًا للمستندات، وبالاسم لغيرها.
    const dir = req.query.dir === 'desc' ? -1 : 1;
    const sort = req.query.sort || (g.document ? 'daysRemaining' : 'name');
    rows.sort((a, b) => {
      const av = sort === 'daysRemaining' ? (a.daysRemaining ?? 1e9) : (a[sort] ?? a.values?.[sort] ?? '');
      const bv = sort === 'daysRemaining' ? (b.daysRemaining ?? 1e9) : (b[sort] ?? b.values?.[sort] ?? '');
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'ar') * dir;
    });

    // ملخّص محسوب على **نفس** الصفوف المعروضة.
    const summary = { total: rows.length };
    for (const f of g.fields) {
      summary[f.key] = { required: 0, not_required: 0, none: 0, filled: 0 };
      for (const r of rows) summary[f.key][r.statuses[f.key]] = (summary[f.key][r.statuses[f.key]] || 0) + 1;
    }
    if (g.document) {
      summary.states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0 };
      for (const r of rows) if (r.state) summary.states[r.state] += 1;
    }

    res.json({
      group: { key: g.key, ar: g.ar, en: g.en, icon: g.icon, document: !!g.document, expiryField: g.expiryField || null, fields: g.fields },
      rows: rows.slice(0, 1000),
      summary,
    });
  } catch (e) {
    console.error('hr records', e);
    res.status(500).json({ message: 'تعذّر تحميل السجلات' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  ملء البيانات الناقصة — من أي مكان
// ═══════════════════════════════════════════════════════════════════════════
/**
 * PATCH /employees/:id/fields   { fields: { iqamaExpiry: '2027-01-01', ... } }
 *
 * الحقول المسموح بيها هي المعرَّفة في config/hrFields بس — عشان الشاشة ما تقدرش
 * تكتب في حقل مالهاش دعوة بيه. وحالة «مطلوب» بتتشال لوحدها في pre-save بتاع
 * الموديل، فالعدّاد في الداشبورد بينقص من غير أي خطوة زيادة.
 */
exports.updateFields = async (req, res) => {
  try {
    const incoming = req.body.fields || {};
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'الموظف غير موجود' });

    const applied = {}; const rejected = [];
    for (const [k, v] of Object.entries(incoming)) {
      const f = H.getField(k);
      if (!f) { rejected.push(k); continue; }
      if (f.type === 'date') {
        if (v === '' || v === null) { emp[k] = null; applied[k] = null; continue; }
        const dt = new Date(v);
        if (isNaN(dt)) { rejected.push(k); continue; }
        emp[k] = dt; applied[k] = dt;
      } else if (f.type === 'bool') {
        emp[k] = v === true || v === 'true' || v === '1'; applied[k] = emp[k];
      } else {
        emp[k] = String(v ?? '').trim(); applied[k] = emp[k];
      }
    }
    if (!Object.keys(applied).length) {
      return res.status(400).json({ message: rejected.length ? `حقول غير معروفة: ${rejected.join(', ')}` : 'لم تُرسل أي حقول' });
    }

    // «غير مطلوب» قرار إداري — لو المستخدم بيعلّم حقل كده بنسجّلها صراحةً.
    for (const [k, code] of Object.entries(req.body.markStatus || {})) {
      if (!H.getField(k)) continue;
      if (code === 'clear') emp.fieldStatus.delete(H.statusKeyOf(k));
      else if (['required', 'not_required', 'none'].includes(code)) emp.fieldStatus.set(H.statusKeyOf(k), code);
    }

    await emp.save();   // pre-save بيشيل «مطلوب» عن أي حقل اتملى

    logAudit({
      user: req.user, action: 'update_employee_fields', entity: 'Employee', entityId: emp._id,
      changes: { after: applied }, ipAddress: req.ip,
    }).catch(() => {});

    emit();
    const fresh = await Employee.findById(emp._id).lean();
    const statuses = {};
    for (const k of Object.keys(applied)) statuses[k] = statusOf(fresh, k);
    res.json({ employee: { _id: fresh._id, ...applied }, statuses, rejected });
  } catch (e) {
    if (e.name === 'ValidationError') {
      const first = Object.values(e.errors || {})[0];
      return res.status(400).json({ message: first?.message || 'بيانات غير صالحة' });
    }
    console.error('hr updateFields', e);
    res.status(500).json({ message: 'تعذّر حفظ البيانات' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  الانتهاءات عبر كل المستندات
// ═══════════════════════════════════════════════════════════════════════════
exports.expiring = async (req, res) => {
  try {
    const withinDays = req.query.withinDays === '' || req.query.withinDays == null ? null : Math.max(0, Number(req.query.withinDays) || 0);
    const wanted = (req.query.doc || '').split(',').map((x) => x.trim()).filter(Boolean);
    const docs = wanted.length ? H.DOCUMENT_GROUPS.filter((g) => wanted.includes(g.key)) : H.DOCUMENT_GROUPS;
    const includeExpired = req.query.includeExpired !== '0';
    const wantState = req.query.state || '';

    const employees = await findEmployees(req.query,
      [...new Set(['employeeNumber', 'arabicName', 'firstName', 'lastName', 'iqamaNumber',
        'department', 'branchName', 'fieldStatus', ...DATE_FILTERABLE,
        ...H.DOCUMENT_GROUPS.map((g) => g.expiryField)])].join(' '));

    const rows = [];
    for (const e of employees) {
      for (const g of docs) {
        const stCode = statusOf(e, g.expiryField);
        const st = H.stateOf(e[g.expiryField], stCode === 'filled' ? '' : stCode, ALERT);
        if (st.state === 'not_applicable' || st.state === 'missing') continue;
        if (!includeExpired && st.state === 'expired') continue;
        if (wantState && st.state !== wantState) continue;
        if (withinDays !== null && st.days > withinDays) continue;
        rows.push({
          employeeId: e._id, employeeNumber: e.employeeNumber,
          name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
          iqamaNumber: e.iqamaNumber || '',
          department: e.department, branchName: e.branchName,
          docKey: g.key, docAr: g.ar, docEn: g.en, expiryField: g.expiryField,
          expiryDate: e[g.expiryField], daysRemaining: st.days, state: st.state,
        });
      }
    }
    rows.sort((a, b) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9));

    const summary = { total: rows.length, expired: 0, critical: 0, warning: 0, valid: 0 };
    const byDoc = {};
    for (const r of rows) { summary[r.state] = (summary[r.state] || 0) + 1; byDoc[r.docKey] = (byDoc[r.docKey] || 0) + 1; }

    res.json({
      rows: rows.slice(0, 2000), summary,
      byDoc: H.DOCUMENT_GROUPS.map((g) => ({ key: g.key, ar: g.ar, en: g.en, count: byDoc[g.key] || 0 })),
      withinDays,
    });
  } catch (e) {
    console.error('hr expiring', e);
    res.status(500).json({ message: 'تعذّر تحميل الانتهاءات' });
  }
};

/** تعريف المجموعات والحقول — الواجهة بتبني منه الصفحات والفلاتر. */
exports.fieldConfig = (req, res) => {
  res.json({
    groups: H.GROUPS.map((g) => ({
      key: g.key, ar: g.ar, en: g.en, icon: g.icon,
      document: !!g.document, expiryField: g.expiryField || null, fields: g.fields,
    })),
    statuses: H.STATUS_LABELS, states: H.STATE_LABELS, alert: ALERT,
  });
};

// ═══════════════════════════════════════════════════════════════════════════
//  التجديد — فرديًّا وجماعيًّا
// ═══════════════════════════════════════════════════════════════════════════
//
// لماذا هنا أصلًا: صفحات المستندات (الإقامات، الجوازات، العقود، التأمين الطبي،
// الشهادات الصحية، بطاقات السائقين، رخص القيادة) لم يكن فيها تجديد. كان الحلّ
// الوحيد أن يُفتَح تاريخ الانتهاء ويُكتَب فوقه — فيضيع الجواب عن «مَن جدّدها
// ومتى ومن أي تاريخ إلى أيّ»، وهو أول ما يُسأل عنه عند أي مراجعة.
//
// والتجديد الجماعي ليس ترفًا: تُجدَّد عشرات الإقامات دفعةً واحدة بالتاريخ نفسه،
// وفعلُها صفًّا صفًّا يعني عشرات النوافذ — ومعها احتمال أن يُنسى صفّ في المنتصف.
const EmployeeRenewal = require('../models/EmployeeRenewal');
const { _RENEWAL_FIELDS: RENEWAL_FIELDS, _GROUP_DOC_TYPE: GROUP_DOC_TYPE } = require('./hrController');

/** تاريخ سليم بصيغة YYYY-MM-DD، أو null. */
const asIsoDay = (v) => {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : s;
};

/** المجموعة أو نوع المستند → خريطة الحقول. تقبل الاسمين فلا يهمّ من يُنادي. */
const renewalMapOf = (docTypeOrGroup) => {
  const key = GROUP_DOC_TYPE[docTypeOrGroup] || docTypeOrGroup;
  const map = RENEWAL_FIELDS[key];
  return map && map.expiry ? { key, map } : null;
};

/**
 * POST /master/renew
 * { employee, docType|group, newExpiry, documentNumber?, notes? }
 */
exports.renew = async (req, res) => {
  try {
    const resolved = renewalMapOf(req.body.docType || req.body.group);
    if (!resolved) return res.status(400).json({ message: 'نوع المستند غير معروف' });
    const newExpiry = asIsoDay(req.body.newExpiry);
    if (!newExpiry) return res.status(400).json({ message: 'أدخل تاريخ الانتهاء الجديد' });

    const emp = await Employee.findById(req.body.employee);
    if (!emp) return res.status(404).json({ message: 'الموظف غير موجود' });

    const { key, map } = resolved;
    const previousExpiry = emp[map.expiry] || '';
    emp[map.expiry] = newExpiry;
    const docNum = String(req.body.documentNumber ?? '').trim();
    if (map.number && docNum) emp[map.number] = docNum;
    await emp.save();

    const renewal = await EmployeeRenewal.create({
      employee: emp._id, docType: key,
      previousExpiry, newExpiry, documentNumber: docNum,
      notes: String(req.body.notes ?? '').trim(),
      renewedBy: req.user._id, renewedAt: new Date(),
    });

    logAudit({
      user: req.user._id, action: 'renew_document', entity: 'Employee', entityId: emp._id,
      changes: { before: { docType: key, expiry: previousExpiry }, after: { expiry: newExpiry, documentNumber: docNum } },
      ipAddress: req.ip,
    }).catch(() => {});
    emit();
    res.status(201).json({ employee: { _id: emp._id, [map.expiry]: newExpiry }, renewal });
  } catch (e) {
    console.error('hr renew', e);
    res.status(500).json({ message: 'تعذّر تسجيل التجديد' });
  }
};

/**
 * POST /master/renew-bulk
 * { items: [{ employee, docType|group }], newExpiry, notes? }
 *
 * كله أو لا شيء. لو سقط صفٌّ واحد في التحقّق لا يُكتب أيّ صفّ — لأن التجديد
 * الجزئي أسوأ من الفشل: تظنّ الدفعة تمّت، ويبقى فيها من لم يُجدَّد بلا أن يقول
 * أحدٌ أيّهم.
 */
exports.renewBulk = async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: 'اختر مستندًا واحدًا على الأقل' });
    if (items.length > 500) return res.status(400).json({ message: 'أقصى ٥٠٠ سطر في المرة الواحدة' });

    const sharedExpiry = asIsoDay(req.body.newExpiry);
    const notes = String(req.body.notes ?? '').trim();

    // ① التحقّق من كل سطر قبل كتابة أي سطر.
    const errors = [];
    const plan = [];
    const ids = [...new Set(items.map((r) => String(r.employee || r.id || '')).filter(Boolean))];
    const found = await Employee.find({ _id: { $in: ids } });
    const byId = new Map(found.map((e) => [String(e._id), e]));

    items.forEach((row, i) => {
      const line = i + 1;
      const resolved = renewalMapOf(row.docType || row.group);
      if (!resolved) return errors.push({ line, message: 'نوع المستند غير معروف' });
      const newExpiry = asIsoDay(row.newExpiry) || sharedExpiry;
      if (!newExpiry) return errors.push({ line, message: 'تاريخ الانتهاء الجديد ناقص أو غير صالح' });
      const emp = byId.get(String(row.employee || row.id || ''));
      if (!emp) return errors.push({ line, message: 'الموظف غير موجود' });
      plan.push({ emp, key: resolved.key, map: resolved.map, newExpiry, documentNumber: String(row.documentNumber ?? '').trim() });
    });

    if (errors.length) {
      return res.status(400).json({ message: 'العملية اترفضت — مفيش أي مستند اتجدّد', errors });
    }

    // ② الكتابة.
    const renewed = [];
    const history = [];
    for (const p of plan) {
      const previousExpiry = p.emp[p.map.expiry] || '';
      p.emp[p.map.expiry] = p.newExpiry;
      if (p.map.number && p.documentNumber) p.emp[p.map.number] = p.documentNumber;
      await p.emp.save();
      history.push({
        employee: p.emp._id, docType: p.key,
        previousExpiry, newExpiry: p.newExpiry, documentNumber: p.documentNumber,
        notes, renewedBy: req.user._id, renewedAt: new Date(),
      });
      renewed.push({
        employee: p.emp._id,
        name: p.emp.arabicName || `${p.emp.firstName || ''} ${p.emp.lastName || ''}`.trim(),
        docType: p.key, previousExpiry, newExpiry: p.newExpiry,
      });
    }
    if (history.length) await EmployeeRenewal.insertMany(history);

    logAudit({
      user: req.user._id, action: 'renew_documents_bulk', entity: 'Employee',
      changes: { after: { count: renewed.length, newExpiry: sharedExpiry } }, ipAddress: req.ip,
    }).catch(() => {});
    emit();

    res.json({
      renewed,
      summary: { count: renewed.length, employees: new Set(renewed.map((r) => String(r.employee))).size },
    });
  } catch (e) {
    console.error('hr renewBulk', e);
    res.status(500).json({ message: 'تعذّر تسجيل التجديد الجماعي' });
  }
};
