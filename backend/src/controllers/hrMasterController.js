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
const { startOfDay, endOfDay, daysUntil } = require('../utils/companyDay');
const H = require('../config/hrFields');
const cache = require('../utils/ttlCache');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

/**
 * ── والتعديلُ من الماستر يصل بقيّةَ القسم ──────────────────────────────────
 *
 * كان يبثّ `hr:master` وحدَه، وهو ما تسمعه شاشاتُ الماستر. وشاشاتُ الموظّفين
 * والعقود والتراخيص تسمع `hr:employee` — فمَن عدّل إقامةً من الماستر بقيت
 * قائمةُ الموظّفين على القديم حتى يُحدِّثها بيده. والعكسُ كان مصلَحًا:
 * `bustEmployeeCaches` في hrController تبثّ الاثنين.
 *
 * فيبثّ الاثنين هنا كذلك، وتُمسَح ذاكراتُ القسم الثلاث لا ذاكرةُ الماستر
 * وحدَها — وإلّا عادت اللوحةُ بأرقامٍ من قبل التعديل لدقيقةٍ كاملة.
 */
/**
 * ── تُمحى الذاكرةُ ثمّ يُعلَن ───────────────────────────────────────────────
 * كان البثُّ يسبق المحو، والمستمعون يعيدون القراءةَ فورَ سماعه — فيقرؤون
 * الذاكرةَ القديمةَ قبل أن تُمحى، وتبقى الشاشةُ متأخّرةً **تغييرًا واحدًا**:
 * يُملأ رقمُ الجواز فيبقى الكارتُ يقول «مطلوب»، حتّى يقع تغييرٌ آخرُ فيُظهر
 * أثرَ الأوّل. راجع [[announce-before-invalidate]].
 */
const emit = () => {
  cache.clear('hrm:');
  try { cache.clear('hr:employees:'); cache.clear('dash:hr:'); } catch (e) { /* */ }
  try { emitToAll('hr:master', {}); } catch (e) { /* */ }
  try { emitToAll('hr:employee', {}); } catch (e) { /* */ }
};
const filled = (v) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));
const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/**
 * حالة حقل عند موظف: مطلوب / غير مطلوب / لا يوجد / مُدخَل.
 *
 * القيمة الموجودة تسبق العَلَم الإداري: حقلٌ فيه تاريخ إقامة مكتوب ليس «مطلوبًا»
 * مهما قال العَلَم — العَلَم أثرٌ قديم من قبل أن يُملأ الحقل، وإبقاؤه يضع اسمًا
 * في قائمة عملٍ لا عمل فيه فيضيّع وقت مَن يفتحه.
 *
 * أما «غير مطلوب» و«راتب نقدي» فيبقيان كما هما: هما قرارٌ إداريّ لا نقصُ بيانات،
 * ولا تنقضهما قيمةٌ موجودة.
 */
const statusOf = (emp, fieldKey) => {
  // القيمةُ تُقرأ بـ`H.valueOf` لا من العمود مباشرةً: «رقم الهوية/الإقامة»
  // عمودان، والقراءةُ من أحدهما تجعل السعوديَّ صاحبَ الرقم «ناقصًا».
  const val = H.valueOf(emp, fieldKey);
  const st = emp.fieldStatus?.[H.statusKeyOf(fieldKey)];
  if (st === 'required' && filled(val)) return 'filled';
  if (st) return st;
  return filled(val) ? 'filled' : 'none';
};

// عتبات التنبيه — نفس فكرة المركبات. لو حبينا نخلّيها قابلة للتعديل بعدين،
// المكان ده هو اللي هيتغيّر.
const ALERT = { warnDays: 60, criticalDays: 30 };

/**
 * ── مستنداتُ مَن تُتابَع؟ ────────────────────────────────────────────────────
 *
 * رقمُ «الانتهاءات» في الشريط كان ٥٦٨ وصفحتُه تفتح على ٤٤٣ — رقمان لشيءٍ واحد.
 * والسببُ أنّ كلًّا منهما عدَّ قومًا: الشريطُ والبطاقاتُ يعدّان الملفَّ كلَّه ومعه
 * مئةٌ وأربعةٌ انتهت خدمتُهم (إقامةُ مَن غادر قبل سنةٍ «منتهيةٌ» إلى الأبد، ولا
 * عملَ فيها)، والصفحةُ تعدّ مَن «على رأس العمل» وحدَهم فتُسقِط مَن في إجازةٍ أو
 * موقوفًا — وهؤلاء بالذات مَن تفوت مستنداتُهم.
 *
 * فالقاعدةُ واحدةٌ تُكتب هنا مرّةً ويقرؤها الثلاثة: ما لم يُطلَب صراحةً غيرُ
 * ذلك، تُعَدّ الانتهاءاتُ لكلّ مَن **لم تنتهِ خدمتُه**. ومَن اختار حالةَ توظيفٍ
 * بيده فاختيارُه يسبق — و`employment=all` يُرجع الملفَّ كلَّه بمن غادر.
 *
 * والنطاقُ يُرسَل مع الأرقام (`expiryScope`) فتحمله الروابطُ كما هو: الرقمُ
 * والجدولُ الذي يفتحه يقرآن الشرطَ نفسَه بالبناء لا بالمصادفة.
 */
const EXPIRY_SCOPE = { employment: 'current' };
const hasEmploymentFilter = (q) => !!q.employment || ['active', 'inactive'].includes(q.status);
const expiryScopeOf = (q) => (hasEmploymentFilter(q || {}) ? {} : EXPIRY_SCOPE);
// ── والعمودُ المشتقُّ لا يُعَدّ ولا يُستعلَم ──────────────────────────────────
// لكلّ تاريخٍ توأمٌ هجريٌّ في التعريف (راجع config/hrFields)، وهو **مشتقٌّ** لا
// مخزَّن. فلو دخل في قوائم العدّ لقُرئ فارغًا في القاعدة فعُدَّ «مطلوبًا» —
// اثنتا عشرةَ خانةً ناقصةً لكلّ موظّفٍ لا وجودَ لها. وهذه هي القائمةُ الحقيقيّة.
const storedFields = (g) => g.fields.filter((f) => !f.derived);
const storedKeys = () => [...new Set(H.GROUPS.flatMap((g) => storedFields(g).map((f) => f.key)))];
/** التوائمُ الهجريّة: تُشتقّ عند القراءة وتُرسَل مع الصفّ. راجع utils/hijri. */
const { toHijri } = require('../utils/hijri');
const hijriFields = () => H.ALL_FIELDS.filter((f) => f.type === 'hijri');


// الحقول التي يجوز الفلترة بها — مشتقّة من تعريف الحقول نفسه، فأي حقل يُضاف
// هناك ويُعلَّم `groupable` يصير قابلًا للفلترة هنا تلقائيًّا بلا تعديل.
const FILTERABLE = [...new Set([
  ...H.GROUPS.flatMap((g) => g.fields.filter((x) => x.groupable).map((x) => x.key)),
  'department', 'branchName', 'project', 'nationality', 'workStatusText', 'bank',
  'licenseType', 'insuranceCompany', 'directManagerName', 'iqamaProfession', 'idType',
  'gender', 'driverCardStatus', 'insuranceClass', 'contractStatusText', 'systemStatus',
])].filter((k) => !['isOutsideKingdom', 'isFreelancer'].includes(k));

// حقول التاريخ التي تقبل مدى (من/إلى) — مشتقّة هي الأخرى من تعريف الحقول.
//
// كانت قائمةً مكتوبةً باليد، فكلُّ حقل تاريخٍ يُضاف هناك يبقى خارج الفلترة حتى
// يتذكّره أحدٌ هنا — وهو ما لا يُكتشَف بخطأ، بل بمستخدمٍ يكتب مدًى فلا يتغيّر
// شيء. الاشتقاق يجعل النسيان مستحيلًا.
const DATE_FILTERABLE = H.ALL_FIELDS.filter((f) => f.type === 'date').map((f) => f.key);

// ── الحقول المنطقية ──────────────────────────────────────────────────────────
// اللوحة تعرض قيمها كما تُقرأ («نعم»/«لا») لأنّ ذلك ما يفهمه من ينظر، وهي
// مستثناةٌ من FILTERABLE فوق لأنّ $in على نصٍّ لا يطابق حقلًا منطقيًّا في BSON.
// فكانت تصل إلى الخادم ولا يقرؤها أحد: تضغط «فري لانسر» فلا يتغيّر شيء ولا
// يقول شيءٌ لماذا. تُترجَم هنا إلى true/false قبل أن تصير شرطًا.
const BOOL_FILTERABLE = ['isOutsideKingdom', 'isFreelancer'];
const asBool = (v) => {
  const t = String(v ?? '').trim();
  if (['نعم', 'true', '1'].includes(t)) return true;
  if (['لا', 'false', '0'].includes(t)) return false;
  return null;
};

function buildFilter(q) {
  // سجلات حسابات الدخول التلقائية مش موظفين — بتخرج من كل عدّاد وكل قايمة هنا.
  const f = { isHrRecord: { $ne: false } };
  // ── الماستر يشمل كلَّ موظّف ─────────────────────────────────────────────
  // كان النطاقُ الافتراضيّ «مَن في ملفّ الماستر المستورَد» (`inCurrentMaster`)،
  // وهي علامةٌ يضعها الاستيرادُ وحدَه. فكلُّ موظّفٍ أُضيف من صفحة الموظّفين بعد
  // الاستيراد كان يظهر هناك ويغيب هنا — لا يُعدّ ولا يُوجد بالبحث باسمه ولا
  // بإقامته. والماستر هو الصورةُ الشاملة للقسم، فيقرأ ما تقرؤه صفحةُ الموظّفين
  // بالضبط، وحالةُ التوظيف (على رأس العمل / منتهي) فلترٌ لا نطاق.
  // `scope=master` يُبقي القراءةَ القديمة لمن يحتاجها.
  if (q.scope === 'master') f.inCurrentMaster = true;
  // حالة التوظيف تُقرأ من `employment`. كان اسمها `status`، وهو الاسم نفسه الذي
  // تستعمله صفحة المجموعة لحالة الخانة (مطلوب/غير مطلوب) — فكان «جدة + على رأس
  // العمل» يصل إلى الجدول فيُقرأ «حالة خانة اسمها active» فيُرجع صفرًا. الاسم
  // القديم ما زال مقبولًا لأن روابط محفوظة تستعمله.
  const employment = q.employment || (['active', 'inactive'].includes(q.status) ? q.status : '');
  if (employment === 'active') f.employmentStatus = 'active';
  if (employment === 'inactive') f.employmentStatus = { $ne: 'active' };
  // ── و«على قوّة العمل» غيرُ «على رأس العمل» ───────────────────────────────
  // مَن في إجازةٍ أو موقوفٌ ليس «على رأس العمل» اليوم، لكنّه موظّفٌ قائمٌ
  // تُجدَّد إقامتُه ورخصتُه. و`inactive` تجمعه مع مَن انتهت خدمتُه، فلا تصلح
  // لسؤال «مستنداتُ مَن تُتابَع؟». فهذه القيمةُ هي الجواب: كلُّ مَن لم تنتهِ
  // خدمتُه — راجع EXPIRY_SCOPE.
  if (employment === 'current') f.employmentStatus = { $ne: 'terminated' };
  if (employment === 'terminated') f.employmentStatus = 'terminated';
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
  // الحقول المنطقية باسمها الحقيقيّ، كما ترسلها لوحة الفلترة.
  for (const field of BOOL_FILTERABLE) {
    const vals = [...new Set(multi(q[field]).map(asBool).filter((v) => v !== null))];
    // القيمتان معًا = بلا شرط: «نعم أو لا» يشمل الجميع، وشرطٌ يشمل الجميع
    // شرطٌ زائد يُبطئ ولا يُنقِص.
    if (vals.length !== 1) continue;
    f[field] = vals[0] ? true : { $ne: true };
  }
  // والأزرار الجاهزة في الشاشة ترسل اسمًا مختصرًا؛ وهي أصرح فتُطبَّق بعده.
  for (const [qk, field] of [['outsideKingdom', 'isOutsideKingdom'], ['freelancer', 'isFreelancer']]) {
    if (q[qk] === '1') f[field] = true;
    else if (q[qk] === '0') f[field] = { $ne: true };
  }
  // مدى التاريخ **لا يُطبَّق هنا** — انظر dateRangePred تحت. حقول التواريخ في
  // هذا الملف مخزَّنة نصًّا لأنها تحمل كلمات إدارية بجانب التاريخ («مطلوب»،
  // «غير مطلوب»)، فمقارنتها بـ$gte/$lte على كائن تاريخ تقارن نوعين مختلفين في
  // BSON فتُرجع صفوفًا لا علاقة لها بالمدى المطلوب. تُطبَّق على القيمة بعد
  // قراءتها تاريخًا حقيقيًّا.
  // ── وأعمدةُ الهويّة الثلاثةُ تُفلتَر كما تُعرَض ────────────────────────────
  //
  // جدولُ الماستر يعرض ثلاثةَ أعمدةٍ مثبَّتةٍ لا توجد في `FILTERABLE`: «الموظف»
  // و«رقم الهوية/الإقامة» و«عدد العهد». فمن أشّر في قمعها على موظّفٍ بعينه
  // انتظر أن يقتصر الجدولُ عليه، وكانت القيمةُ تُرسَل فتُهمَل في صمت: لا خطأً
  // يُقرأ ولا صفًّا يتغيّر — وهو أسوأُ من الرفض، لأنّه يُقرأ «الفلتر معطوب».
  //
  // وسببُ غيابها أنّ كلَّ عمودٍ منها **ليس حقلًا في القاعدة**:
  //   • «الموظف» = `arabicName` أو «الاسمُ الأوّل + الأخير» مركَّبين.
  //   • «رقم الهوية/الإقامة» = `iqamaNumber` أو `nationalId` بحسب نوع الهويّة
  //     (راجع ذاكرة «رقم الهوية في عمودين»).
  //   • «عدد العهد» محسوبٌ من سجلّ الأصول — ويُطبَّق في `exports.grid`.
  const multiRaw = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const names = multiRaw(q.name);
  if (names.length) {
    const full = { $trim: { input: { $concat: [{ $ifNull: ['$firstName', ''] }, ' ', { $ifNull: ['$lastName', ''] }] } } };
    f.$and = [...(f.$and || []), { $or: [
      { arabicName: { $in: names } },
      { $expr: { $in: [full, names] } },
    ] }];
  }
  const ids = multiRaw(q.iqamaNumber);
  if (ids.length) {
    // «—» في القمع تعني «بلا رقم»: وهي فئةٌ يُسأل عنها (مَن لم تُسجَّل هويّتُه).
    const wantsBlank = ids.includes('—');
    const rest = ids.filter((x) => x !== '—');
    const keys = H.searchKeysOf('iqamaNumber');
    const or = rest.length ? keys.map((k) => ({ [k]: { $in: rest } })) : [];
    if (wantsBlank) or.push({ $and: keys.map((k) => ({ [k]: { $in: ['', null] } })) });
    if (or.length) f.$and = [...(f.$and || []), { $or: or }];
  }

  if (q.q && q.q.trim()) {
    const r = rx(q.q);
    // ويُبحَث في عمودَي رقم الهويّة معًا: مَن كتب رقمَ سعوديٍّ كان لا يجده.
    f.$or = [{ arabicName: r }, { firstName: r }, { lastName: r }, { employeeNumber: r },
      ...H.searchKeysOf('iqamaNumber').map((k) => ({ [k]: r })),
      { passportNumber: r }, { companyNumber: r }, { absherNumber: r }];
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
// ── حقولٌ يُسأل عنها بالسنوات لا بالتاريخ ────────────────────────────────────
// «أرِني مَن أعمارهم بين ٢٥ و٣٠» سؤالٌ يُسأل كل يوم، وكان جوابه يحتاج حسابَ
// تاريخَي ميلادٍ في الرأس ثم كتابتهما. والسنُّ تتغيّر مع الزمن والتاريخ لا،
// فالفلتر بالسنوات يبقى صحيحًا غدًا والمدى المكتوب بالتاريخ يشيخ.
const YEAR_SPAN_FIELDS = { dateOfBirth: 'age', hireDate: 'tenure' };
// وحقولُ الانتهاء يُسأل عنها بالأيام المتبقّية: «ما ينتهي خلال ثلاثين يومًا».
// وهي بالتعريف تواريخُ انتهاء المستندات، فتُقرأ منها لا تُكتب بجانبها.
const DAYS_LEFT_FIELDS = H.DOCUMENT_GROUPS.map((g) => g.expiryField).filter(Boolean);

/** فرقُ السنوات الكاملة بين تاريخٍ واليوم — سنٌّ أو أقدميّة. */
const yearsSince = (d) => {
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) y -= 1;
  return y;
};
// (كانت هنا `daysUntil` تقيس بمنتصف ليل **الخادم** — وهو غرينتش على خادمنا —
//  فتنقص يومًا كاملًا في الساعات الثلاث الأولى من يوم الرياض. صارت من
//  `utils/companyDay` تُقارن أيّامَ التقويم لا اللحظات.)

function dateRangePred(q) {
  const tests = [];

  // ① يومٌ بعينه: `<key>On=YYYY-MM-DD`. المدى «من كذا إلى كذا نفسه» يؤدّي المعنى
  //    لكنّه يجعل المستخدم يكتب التاريخ مرّتين لسؤالٍ واحد.
  for (const key of DATE_FILTERABLE) {
    const on = String(q[`${key}On`] ?? '').trim();
    if (!on) continue;
    tests.push((e) => {
      const d = asDate(e[key]);
      return !!d && d.toISOString().slice(0, 10) === on;
    });
  }

  // ② مدًى بالسنوات: `ageFrom/ageTo` و`tenureFrom/tenureTo`.
  for (const [key, name] of Object.entries(YEAR_SPAN_FIELDS)) {
    const lo = q[`${name}From`] === '' || q[`${name}From`] == null ? null : Number(q[`${name}From`]);
    const hi = q[`${name}To`] === '' || q[`${name}To`] == null ? null : Number(q[`${name}To`]);
    if (lo == null && hi == null) continue;
    tests.push((e) => {
      const d = asDate(e[key]);
      if (!d) return false;
      const y = yearsSince(d);
      return (lo == null || y >= lo) && (hi == null || y <= hi);
    });
  }

  // ③ مدًى بالأيام المتبقّية: `<key>DaysFrom/DaysTo`. السالب ماضٍ، فـ«المنتهي
  //    منذ شهر إلى ما ينتهي بعد شهر» يُكتب ‎-30 إلى 30.
  for (const key of DAYS_LEFT_FIELDS) {
    const lo = q[`${key}DaysFrom`] === '' || q[`${key}DaysFrom`] == null ? null : Number(q[`${key}DaysFrom`]);
    const hi = q[`${key}DaysTo`] === '' || q[`${key}DaysTo`] == null ? null : Number(q[`${key}DaysTo`]);
    if (lo == null && hi == null) continue;
    tests.push((e) => {
      const d = asDate(e[key]);
      if (!d) return false;
      const n = daysUntil(d);
      return (lo == null || n >= lo) && (hi == null || n <= hi);
    });
  }

  for (const key of DATE_FILTERABLE) {
    // «—» على حقل تاريخ = لا تاريخ مقروء أصلًا (فارغ أو كلمة إدارية).
    if (String(q[key] ?? '').split(',').map((x) => x.trim()).includes('—')) {
      tests.push((e) => asDate(e[key]) === null);
      continue;
    }
    const from = q[`${key}From`]; const to = q[`${key}To`];
    if (!from && !to) continue;
    const lo = from ? startOfDay(from) : null;
    const hi = to ? endOfDay(to) : null;
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
// وتُصدَّر معهما قائمةُ حقول التاريخ: شرطُ المدى يُطبَّق على القيمة **بعد**
// جلبها، فالحقل الذي لا يُجلَب يبدو «بلا تاريخ» فيسقط من كلّ مدًى بصمت. ومَن
// يشتقّ مشروعَه بيده ينسى حقلًا يُضاف هنا، ولا يُكتشَف ذلك بخطأ بل بمستخدمٍ
// يكتب مدًى فتعود الشاشة فارغة بلا سبب ظاهر.
exports._DATE_FILTERABLE = DATE_FILTERABLE;

/** جلب الموظفين بكل شروط الاستعلام — شروط قاعدة البيانات ثم شروط التواريخ. */
async function findEmployees(q, select) {
  let query = Employee.find(buildFilter(q));
  // الأعمدةُ التي تقرأ منها الحقولُ المشتقّة تُجرّ دائمًا — راجع H.READ_DEPS.
  // خمسةُ استعلاماتٍ هنا تختار أعمدةً بعينها، ونسيانُ العمود في واحدٍ منها
  // يجعل الشاشة تقول «لا يوجد» عن رقمٍ مكتوب.
  if (select) query = query.select([select, ...H.READ_DEPS].join(' '));
  // بلا hint: إجبار المخطِّط على فهرسٍ بعينه يجعل كل استعلام يفشل إن لم يكن
  // ذلك الفهرس موجودًا على العنقود — وهو ما كان يحدث هنا حرفيًّا. الفهارس
  // تُنشأ بـ scripts/addHrIndexes.js ويختار المخطِّط منها ما يناسب كل استعلام.
  const rows = await query.lean();
  const pred = dateRangePred(q);
  return pred ? rows.filter(pred) : rows;
}

/**
 * شرطُ القاعدة المكافئُ لكلّ فلاتر الاستعلام — ومعها مدى التواريخ.
 *
 * العدُّ انتقل إلى القاعدة (راجع utils/hrCounts) وبقي مدى التواريخ شرطًا يُطبَّق
 * في العقدة بعد الجلب. فكانت اللوحةُ تعدّ بـ`buildFilter` وحدَها: يُختار «العمر
 * من ٢٥ إلى ٣٠» فيقول عدّادُ الفلتر ٥٤ وتبقى البطاقاتُ كلُّها على ٤٤١ — فلترٌ
 * يظهر مطبَّقًا ولا يحرّك رقمًا. فحين يوجد مدًى تُحسَم المطابقةُ أوّلًا إلى
 * قائمةِ معرّفات، وهي التي تُعَدّ.
 */
async function matchFor(q) {
  const match = buildFilter(q);
  const pred = dateRangePred(q);
  if (!pred) return match;
  const rows = await Employee.find(match).select(['_id', ...DATE_FILTERABLE].join(' ')).lean();
  return { _id: { $in: rows.filter(pred).map((r) => r._id) } };
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
// آفاق الانتهاء: مجموعةُ مستنداتٍ واحدة = بطاقةُ أفقٍ واحدة، مشتقّةً من تعريف
// المجموعات. مجموعةٌ تُضاف هناك كانت تبقى بلا أفقٍ هنا حتى يتذكّرها أحد.
const HORIZON_DOCS = H.DOCUMENT_GROUPS.map((g) => ({ key: g.expiryField, ar: `انتهاء ${g.ar}`, en: `${g.en} expiry` }));

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
      // ── والخانةُ الخاليةُ في حقلٍ منطقيٍّ ليست فئةً ثالثة ────────────────────
      // «خارج المملكة» إمّا نعم أو لا. والحقلُ غيرُ المكتوب كان يُعَدُّ «—»،
      // فتقول القائمةُ «لا: ٤٠٩» ويردّ الجدولُ ٤١٤ — لأنّ فلترَ «لا» هو
      // `{ $ne: true }` وهو يشمل غيرَ المكتوب. فيُعَدُّ غيرُ المكتوب «لا» كما
      // يُفلتَر، فيتساوى ما يُقرأ وما يُرَدّ.
      const isBool = BOOL_FILTERABLE.includes(key);
      const counts = new Map();
      for (const r of rows) {
        const raw = r[key];
        const v = raw === true ? 'نعم'
          : isBool ? 'لا'
            : (raw === false ? 'لا' : (filled(raw) ? String(raw) : '—'));
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
      ...H.GROUPS.flatMap((g) => [g.expiryField, ...storedFields(g).map((f) => f.key)]).filter(Boolean),
    ])].join(' ');
    // ── والعدُّ يجري في القاعدة ───────────────────────────────────────────
    //
    // كانت اللوحةُ تقرأ الموظّفين كلَّهم بحقولهم كلِّها ثمّ تعدُّ في العقدة.
    // وقِيس على الإنتاج فبان أنّ العنقودَ يسلّم نحوَ **٩٥ كيلوبايت في الثانية**،
    // وأنّ كلَّ شيءٍ يتناسب مع ذلك تناسبًا مستقيمًا: ميجابايتٌ واحدٌ من
    // الموظّفين = أحدَ عشرَ ثانية، في كلّ فتحةٍ للشريط. والعدُّ نفسُه في
    // القاعدة عشرُ مِلّي ثوانٍ — فليست المشكلةُ حسابًا بل نقلًا.
    //
    // فالعدُّ والتوزيعُ وحالاتُ الانتهاء تُحسب هناك ويُنقَل الجوابُ وحدَه.
    // وقد قُورنت النتيجةُ بالحساب القديم حقلًا حقلًا وحالةً حالة — مطابقةٌ
    // تمامًا (راجع auditHrCountsParity و auditHrStatesParity).
    const { statusCounts, valueDistributions, boolCounts, docStateCounts, filledExpr } = require('../utils/hrCounts');
    const match = await matchFor(req.query);
    // حالاتُ الانتهاء تُعَدّ لمن لم تنتهِ خدمتُه — راجع EXPIRY_SCOPE.
    const expiryScope = expiryScopeOf(req.query);
    const docMatch = expiryScope.employment ? { $and: [match, buildFilter(expiryScope)] } : match;
    const allKeys = storedKeys();
    const groupableKeys = [...new Set(H.GROUPS.flatMap((g) => g.fields.filter((f) => f.groupable).map((f) => f.key)))];

    const [counts, dists, states, sums] = await Promise.all([
      statusCounts(Employee, match, allKeys),
      valueDistributions(Employee, match, groupableKeys),
      docStateCounts(Employee, docMatch, H.GROUPS, ALERT),
      boolCounts(Employee, match, {
        active: { $eq: ['$employmentStatus', 'active'] },
        terminated: { $eq: ['$employmentStatus', 'terminated'] },
        outsideKingdom: { $eq: ['$isOutsideKingdom', true] },
        freelancers: { $eq: ['$isFreelancer', true] },
        gosiRegistered: filledExpr('gosiNumber'),
        cashPayroll: { $eq: [{ $ifNull: ['$fieldStatus.ibanStatus', ''] }, 'cash_payroll'] },
      }),
    ]);
    const employeeCount = sums.total;

    // مُعرِّفاتُ الموظّفين المطابقين — تحتاجها عدّاداتُ الإجازات والطلبات والعهد.
    //
    // ── ومعها تواريخُ التحليلات ───────────────────────────────────────────────
    // حين نُقل العدُّ إلى القاعدة قُصر هذا الاستعلامُ على `_id`، وبقيت
    // `buildAnalytics` تقرأ منه تاريخَ الميلاد والتعيين وتواريخَ الانتهاء — فقرأت
    // فراغًا: كلُّ شريحةٍ صفر، و«بلا تاريخ» تساوي عددَ الموظّفين كلِّهم. أحدَ
    // عشرَ تاريخًا قصيرًا لكلّ موظّفٍ حمولةٌ صغيرة، وبغيرها القسمُ كلُّه كاذب.
    const empIdRows = await Employee.find(match)
      .select(['_id', 'dateOfBirth', 'hireDate', ...HORIZON_DOCS.map((x) => x.key)].join(' ')).lean();
    const employees = empIdRows;

    // ── كارت لكل حقل ─────────────────────────────────────────────────────────
    // العدّادات الأربعة هي اللي المستخدم طلبها بالاسم: مطلوب، غير مطلوب، مُدخَل،
    // والإجمالي. وكل واحد معاه الفلتر اللي بيفتح الناس دول بالظبط.
    const countsOf = (key) => counts[key] || {};
    const groups = H.GROUPS.map((g) => {
      const fields = g.fields.map((f) => {
        const counts = { required: 0, not_required: 0, none: 0, filled: 0, cash_payroll: 0, inactive: 0, unparseable: 0 };
        // التوأمُ الهجريُّ مشتقٌّ: حالتُه حالةُ أصله الميلاديّ (وهكذا تعدّه صفحةُ
        // المجموعة). وكان يُعَدّ بمفتاحه هو فيخرج صفرًا في الأربعة — سطرٌ بلا
        // رقمٍ في اللوحة، وأرقامُه كاملةٌ في الصفحة التي يفتحها.
        Object.assign(counts, countsOf(f.of || f.key));
        // ── التوزيع في البطاقة: أعلى القيم لا كلُّها ────────────────────────────
        // أعمدةٌ مفتاحُها فريدٌ لكلّ موظّف (البريد، الرقم الوظيفيّ، جوال أبشر)
        // توزيعُها ثلاثمئةٌ وستّون سطرًا كلٌّ منها «١» — ليس توزيعًا يُقرأ، وهو
        // في الشبكة مئاتُ الكيلوبايتات تُنقَل في كلّ فتحةٍ للّوحة ولا تُعرض.
        // البطاقة تعرض عشرين، فتُرسَل خمسٌ وعشرون ومعها العدد الحقيقيّ للقيم
        // حتى لا يقول العنوان «التوزيع (٢٥)» وهي اثنتان وثمانون. والقائمة
        // الكاملة مكانُها لوحةُ الفلترة: هناك يُبحَث ويُختار.
        const dist = f.groupable ? dists[f.key] : null;
        return {
          key: f.key, ar: f.ar, en: f.en, type: f.type, group: g.key,
          total: employeeCount,
          counts,
          // «مطلوب» هو الرقم اللي بيتصرف فيه — بيتقدّم في الترتيب.
          // والمشتقُّ لا يدخل المجموع: نقصُه نقصُ أصله، فلو جُمع لعُدَّ مرّتين.
          required: f.derived ? 0 : counts.required,
          values: dist ? dist.list : undefined,
          valuesTotal: dist ? dist.total : undefined,
        };
      });
      const out = {
        key: g.key, ar: g.ar, en: g.en, icon: g.icon, document: !!g.document,
        fields,
        required: fields.reduce((n, f) => n + f.required, 0),
      };
      // المجموعات اللي فيها مستند بتاريخ انتهاء بتاخد كمان حالات التاريخ.
      if (g.document) {
        const st = states[g.key] || { states: {}, nearest: null };
        const nearest = st.nearest ?? null;
        out.states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0, ...st.states };
        out.expiryField = g.expiryField;
        out.needsAttention = out.states.expired + out.states.critical + out.states.warning;
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
    // لا تقييدَ بملفّ الاستيراد — راجع buildFilter.
    if (req.query.scope === 'master') rosterFilter.inCurrentMaster = true;
    const rosterTotal = await Employee.countDocuments(rosterFilter);
    const activeCount = sums.active;

    const totals = {
      employees: employeeCount,
      active: activeCount,
      notActive: employeeCount - activeCount,
      // «ليس على رأس العمل» يجمع مَن انتهت خدمتُه ومَن في إجازةٍ أو موقوف —
      // والثاني ليس مغادرًا. فيُرسَل عددُ المنتهية خدمتُهم وحدَه بجانبه.
      terminated: sums.terminated,
      // إجمالي الملفّ الوظيفيّ — تعرضه الشاشة بجانب الرقم المفلتر ليُعرف من أيٍّ
      // اقتُطع، لا لتحلّ محلّه.
      roster: rosterTotal,
      // اللي الفلتر الحالي بيعرضه — الأرقام اللي تحت كلها محسوبة عليه.
      filtered: employeeCount,
      required: groups.reduce((n, g) => n + g.required, 0),
      expiringSoon: groups.reduce((n, g) => n + (g.needsAttention || 0), 0),
      outsideKingdom: sums.outsideKingdom,
      freelancers: sums.freelancers,
      cashPayroll: sums.cashPayroll,
      gosiRegistered: sums.gosiRegistered,
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

    const body = {
      totals, work, groups, topRequired, analytics: buildAnalytics(employees), alert: ALERT,
      // الشرطُ الذي عُدَّت به الانتهاءات — تحمله الروابطُ فيفتح الرقمُ صفوفَه.
      expiryScope,
      statuses: H.STATUS_LABELS, states: H.STATE_LABELS,
    };
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
    // جدولا المجموعة والانتهاءات كانا بلا ذاكرة أصلًا، وهما أثقل ما في القسم:
    // تحت أربعين مستخدمًا متزامنًا بلغا ٦٫٢ و٦٫٦ ثانية عند ٩٥٪. و`wrap` يضمن
    // أن يُحسب الجواب مرّةً واحدة مهما بلغ عدد مَن سألوه في اللحظة نفسها.
    const ck = `hrm:rec:${req.params.group}:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(ck);
    if (cached !== undefined) return res.json(cached);
    const g = H.getGroup(req.params.group);
    if (!g) return res.status(404).json({ message: 'المجموعة غير معروفة' });

    // iqamaNumber يُرجَع دائمًا وإن لم يكن من حقول المجموعة — كل جدول في القسم
    // يعرض الموظف وبجانبه رقم هويته، وهو ما يبحث الناس به.
    const employees = await findEmployees(req.query,
      [...new Set(['employeeNumber', 'arabicName', 'firstName', 'lastName', 'iqamaNumber',
        'department', 'branchName', 'project', 'employmentStatus', 'workStatusText', 'fieldStatus',
        ...DATE_FILTERABLE, ...storedFields(g).map((f) => f.key)])].join(' '));

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
      for (const f of g.fields) {
        if (f.derived) continue;
        values[f.key] = H.valueOf(e, f.key) ?? null;
        statuses[f.key] = statusOf(e, f.key);
      }
      // والتوأمُ الهجريُّ مشتقٌّ من الميلاديّ — حالتُه حالتُه.
      for (const f of g.fields.filter((x) => x.type === 'hijri')) {
        values[f.key] = values[f.of] ? toHijri(values[f.of]) : null;
        statuses[f.key] = statuses[f.of];
      }
      const doc = g.document
        ? H.stateOf(e[g.expiryField], statuses[g.expiryField] === 'filled' ? '' : statuses[g.expiryField], ALERT)
        : null;
      return {
        _id: e._id,
        employeeNumber: e.employeeNumber, name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        iqamaNumber: H.valueOf(e, 'iqamaNumber') || '',
        department: e.department, branchName: e.branchName, project: e.project,
        workStatusText: e.workStatusText, employmentStatus: e.employmentStatus,
        values, statuses,
        state: doc?.state || null, daysRemaining: doc?.days ?? null,
        // «ناقص إيه عند الشخص ده» — بالاسم، عشان الشاشة ما تحسبهاش تاني.
        missing: g.fields.filter((f) => statuses[f.key] === 'required').map((f) => ({ key: f.key, ar: f.ar })),
      };
    });

    const statusPass = (r) => {
      if (!wantStatus) return true;
      if (field) return r.statuses[field] === wantStatus;
      return g.fields.some((f) => r.statuses[f.key] === wantStatus);
    };
    // ── و«يحتاج انتباهًا» حالةٌ تُطلَب باسمها ──────────────────────────────
    // الشريطُ يعرض رقمَ المنتهي والحرج والقريب مجموعةً (`needsAttention`).
    // وبغير قيمةٍ تجمعها لا يستطيع الضغطُ على الرقم أن يفتح صفوفَه بعينها —
    // فيقرأ المستخدم رقمًا ويفتح جدولًا فيه غيرُه، وهو أصلُ الشكوى.
    const ATTENTION = ['expired', 'critical', 'warning'];
    const statePass = (r) => {
      if (!wantState) return true;
      return wantState === 'attention' ? ATTENTION.includes(r.state) : r.state === wantState;
    };
    if (withinDays !== null && g.document) {
      rows = rows.filter((r) => r.daysRemaining != null && r.daysRemaining <= withinDays
        && (includeExpired || r.daysRemaining >= 0));
    }
    // ── والعدّادُ لا يُفلتَر بنفسه ─────────────────────────────────────────────
    //
    // كان الملخّصُ يُحسَب على الصفوف **بعد** الضغط على العدّاد. فمَن ضغط «مطلوب ٤»
    // في «حالة العقد» رأى البطاقةَ نفسَها تنكمش إلى «مطلوب ٤» وحدَها وتختفي
    // «غير مطلوب ٧٨» و«مُدخَل ٣٣٣» — وبقيّةُ البطاقات تُعَدّ على الأربعة. فلا
    // يُنتقَل من عدّادٍ إلى جاره إلّا برفع الأوّل، ومجموعُ الأربعة لم يعد عددَ
    // الموظّفين.
    //
    // فكلُّ طائفةٍ من العدّادات تُحسَب بكلّ الفلاتر **عدا فلترَها هي** — القاعدةُ
    // نفسُها التي تُحسَب بها قيمُ لوحة الفلترة (راجع filterOptions): عدّاداتُ
    // الحالة لا يحرّكها اختيارُ حالة، وبطاقاتُ الانتهاء لا يحرّكها اختيارُ
    // انتهاء. والرقمُ المضغوطُ يبقى عددَ الصفوف التي يفتحها بالضبط.
    const forStatusCounts = rows.filter(statePass);
    const forStateCounts = rows.filter(statusPass);
    rows = forStatusCounts.filter(statusPass);

    // الترتيب: بالأقرب انتهاءً افتراضيًا للمستندات، وبالاسم لغيرها.
    const dir = req.query.dir === 'desc' ? -1 : 1;
    const sort = req.query.sort || (g.document ? 'daysRemaining' : 'name');
    rows.sort((a, b) => {
      const av = sort === 'daysRemaining' ? (a.daysRemaining ?? 1e9) : (a[sort] ?? a.values?.[sort] ?? '');
      const bv = sort === 'daysRemaining' ? (b.daysRemaining ?? 1e9) : (b[sort] ?? b.values?.[sort] ?? '');
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'ar') * dir;
    });

    // `population` مقامُ عدّادات الحالة: مجموعُ حالات أيّ حقلٍ يساويه دائمًا.
    const summary = { total: rows.length, population: forStatusCounts.length };
    for (const f of g.fields) {
      summary[f.key] = { required: 0, not_required: 0, none: 0, filled: 0 };
      for (const r of forStatusCounts) summary[f.key][r.statuses[f.key]] = (summary[f.key][r.statuses[f.key]] || 0) + 1;
    }
    if (g.document) {
      summary.states = { valid: 0, warning: 0, critical: 0, expired: 0, missing: 0, not_applicable: 0 };
      for (const r of forStateCounts) if (r.state) summary.states[r.state] += 1;
    }

    const body = {
      group: { key: g.key, ar: g.ar, en: g.en, icon: g.icon, document: !!g.document, expiryField: g.expiryField || null, fields: g.fields },
      rows: rows.slice(0, 1000),
      summary,
    };
    cache.set(ck, body, 60000);
    res.json(body);
  } catch (e) {
    console.error('hr records', e);
    res.status(500).json({ message: 'تعذّر تحميل السجلات' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  الماستر — صفٌّ واحدٌ لكلّ موظّف، فيه كلُّ شيء
// ═══════════════════════════════════════════════════════════════════════════
/**
 * GET /master/grid?page=&limit=&sort=&dir=&…الفلاتر نفسُها
 *
 * ── لماذا صفحةٌ واحدةٌ تجمع كلَّ المجموعات ────────────────────────────────
 * صفحاتُ القسم مقسَّمةٌ بحسب المستند: إقاماتٌ، وجوازات، وعقود… وهو التقسيمُ
 * الصحيح للعمل اليوميّ. لكنّ السؤالَ «أرِني هذا الموظّف كلَّه» — أو «صدّر لي
 * الملفّ كلَّه بأعمدةٍ أختارها» — لا تجيب عنه أيُّ واحدةٍ منها، ويُجاب عنه
 * اليوم بفتح ثلاثَ عشرةَ شاشةً ولصقِ نتائجها في إكسل.
 *
 * ── والصفحاتُ مرقَّمة ─────────────────────────────────────────────────────
 * العنقودُ يسلّم نحوَ ٩٥ كيلوبايت في الثانية، فأربعُمئةِ موظّفٍ بكلّ حقولهم
 * أحدَ عشرَ ثانية. خمسون صفًّا في الصفحة تُنقَل في أقلَّ من نصف ثانية —
 * والتصديرُ يجلبها صفحةً صفحةً حين يُطلَب، لا في كلّ فتحة.
 */
exports.grid = async (req, res) => {
  try {
    const ck = `hrm:grid:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(ck);
    if (cached !== undefined) return res.json(cached);

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));

    const allFields = storedKeys();
    const select = [...new Set([
      'employeeNumber', 'arabicName', 'firstName', 'lastName', 'employmentStatus',
      'department', 'branchName', 'project', 'fieldStatus', 'employmentType', 'isFreelancer',
      ...allFields, ...DATE_FILTERABLE,
    ])].join(' ');

    // الفلترةُ والترتيبُ في القاعدة؛ ومدى التواريخ المشتقُّ يُطبَّق بعدها كما
    // في بقيّة الشاشات (راجع findEmployees).
    const filter = buildFilter(req.query);

    // ── و«عدد العهد» عمودٌ محسوبٌ يُفلتَر هنا ─────────────────────────────────
    // ليس حقلًا في ملفّ الموظّف بل عددُ ما في عهدته من سجلّ الأصول، فلا تعرفه
    // `buildFilter`. وكان التأشيرُ عليه في القمع يُهمَل صامتًا. فيُحوَّل العددُ
    // المطلوبُ إلى قائمةِ موظّفين: مَن عهدتُه ثلاثةٌ هم هؤلاء بأعيانهم — و«٠»
    // هم مَن لا عهدةَ لهم، وهو أكثرُ ما يُسأل عنه.
    const custodyWanted = String(req.query.custodyCount ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '');
    if (custodyWanted.length) {
      const AssetModel = require('../models/Asset');
      const byEmp = await AssetModel.aggregate([
        { $match: { employee: { $ne: null }, status: 'assigned' } },
        { $group: { _id: '$employee', n: { $sum: 1 } } },
      ]);
      const wanted = new Set(custodyWanted.map((x) => Number(x)).filter((n) => Number.isFinite(n)));
      const withCount = byEmp.filter((r) => wanted.has(r.n)).map((r) => r._id);
      if (wanted.has(0)) {
        // الصفرُ نفيٌ لا قيمة: كلُّ من ليس في سجلّ العهد.
        const held = byEmp.map((r) => r._id);
        filter.$and = [...(filter.$and || []), { $or: [{ _id: { $nin: held } }, ...(withCount.length ? [{ _id: { $in: withCount } }] : [])] }];
      } else {
        filter.$and = [...(filter.$and || []), { _id: { $in: withCount } }];
      }
    }

    const pred = dateRangePred(req.query);
    const sortKey = String(req.query.sort || 'employeeNumber');
    const dir = req.query.dir === 'desc' ? -1 : 1;

    let rows; let total;
    if (pred) {
      // شرطٌ لا يُعبَّر عنه في القاعدة: تُقرأ المطابقةُ ثمّ تُقصّ.
      const all = await Employee.find(filter).select(select).sort({ [sortKey]: dir }).lean();
      const kept = all.filter(pred);
      total = kept.length;
      rows = kept.slice((page - 1) * limit, page * limit);
    } else {
      [rows, total] = await Promise.all([
        Employee.find(filter).select(select).sort({ [sortKey]: dir })
          .skip((page - 1) * limit).limit(limit).lean(),
        Employee.countDocuments(filter),
      ]);
    }

    // عددُ العهد لكلّ موظّفٍ في الصفحة — استعلامٌ واحدٌ لا واحدٌ لكلّ صفّ.
    const Asset = require('../models/Asset');
    const ids = rows.map((r) => r._id);
    const custody = new Map();
    if (ids.length) {
      const agg = await Asset.aggregate([
        { $match: { employee: { $in: ids }, status: 'assigned' } },
        { $group: { _id: '$employee', n: { $sum: 1 } } },
      ]);
      agg.forEach((a) => custody.set(String(a._id), a.n));
    }

    const out = rows.map((e) => {
      const row = {
        _id: e._id,
        employeeNumber: e.employeeNumber,
        name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        employmentStatus: e.employmentStatus,
        custodyCount: custody.get(String(e._id)) || 0,
        values: {},
        statuses: {},
      };
      for (const k of allFields) {
        const v = H.valueOf(e, k);
        // الفارغُ لا يُرسَل: أربعةٌ وخمسون مفتاحًا لكلّ صفٍّ أكثرُها فارغ،
        // ونقلُها يضاعف الحمولةَ على وصلةٍ تسلّم ٩٥ ك.ب/ث.
        if (v !== null && v !== undefined && v !== '') row.values[k] = v;
        const st = statusOf(e, k);
        // و«مملوء» هي الحالُ الغالبة، فتُفهَم بالسكوت وتُرسَل ما سواها.
        if (st !== 'filled') row.statuses[k] = st;
      }
      // ── والتوأمُ الهجريُّ يُشتقّ هنا، لا في المتصفّح ──────────────────────
      // لو حُسِب في الشاشة لحُسِب مرّةً في الويب ومرّةً في التطبيق بمكتبتين
      // مختلفتين — فيختلف اليومُ بين الاثنين. المصدرُ واحدٌ: utils/hijri.
      for (const f of hijriFields()) {
        const g = row.values[f.of];
        if (g) row.values[f.key] = toHijri(g);
      }
      return row;
    });

    const body = {
      rows: out,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      // تعريفُ الأعمدة يُرسَل مع البيانات: الشاشةُ لا تعيد كتابته، وأيُّ حقلٍ
      // يُضاف في `config/hrFields` يظهر هنا بلا تعديلٍ في الواجهة.
      // ── والعناوينُ من القائمة المسطَّحة لا من المجموعات الخام ─────────────
      // كانت تُبنى من `H.GROUPS` مباشرةً بـ`f.ar` كما كُتب. وهو مكتوبٌ لصفحة
      // المجموعة، حيث اسمُ المجموعة فوقه: «تاريخ الانتهاء» واضحٌ داخل
      // «الإقامات». وهنا تقف المجموعاتُ كلُّها في صفٍّ واحد، فيظهر «تاريخ
      // الانتهاء الميلادي» **سبعَ مرّات** — ولا يُعرَف أيُّها أيّ، لا على
      // الشاشة ولا في ملفّ الإكسل.
      //
      // و`ALL_FIELDS` هي القائمةُ نفسُها بعد تقييد ما تكرّر باسم مجموعته
      // (راجع `qualifyDuplicateLabels` في config/hrFields)، وتحمل المجموعةَ
      // معها. فصفحةُ المجموعة تُبقي عنوانَها القصير، والجدولُ المسطَّح يأخذ
      // المقيَّد — من مصدرٍ واحد.
      columns: H.ALL_FIELDS.map((f) => ({
        key: f.key, ar: f.ar, en: f.en, type: f.type, group: f.group, groupAr: f.groupAr, groupEn: f.groupEn,
        // `of` يقول للشاشةِ أيُّ تاريخٍ ميلاديٍّ هذا توأمُه الهجريّ — فتقرأ
        // قيمتَه من أصله ولا تحوّل نصًّا هجريًّا مرّةً ثانية.
        of: f.of || null,
        choice: !!f.choice, cashPayroll: !!f.cashPayroll,
      })),
    };
    cache.set(ck, body, 30000);
    res.json(body);
  } catch (e) {
    console.error('hr grid', e);
    res.status(500).json({ message: 'تعذّر تحميل ماستر الموارد البشرية' });
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
    for (const [rawKey, rawVal] of Object.entries(incoming)) {
      // ── ومن كتب بالهجريّ كتب في التاريخ نفسِه ──────────────────────────
      // العمودُ الهجريُّ مشتقٌّ لا مخزَّن (راجع config/hrFields وutils/hijri).
      // فما وصل منه يُحوَّل إلى ميلاديٍّ ويُكتب في توأمه — فيَرى من يقرأ
      // بالميلاديّ تجديدَ من كتب بالهجريّ في اللحظة نفسِها، بلا مزامنة.
      let k = rawKey; let v = rawVal;
      if (H.isHijriKey(k)) {
        const base = H.baseOfHijri(k);
        if (!H.getField(base)) { rejected.push(k); continue; }
        if (v === '' || v === null) { k = base; v = ''; } else {
          const greg = require('../utils/hijri').fromHijriString(String(v).trim());
          if (!greg) { rejected.push(`${k} (تاريخٌ هجريٌّ غير صحيح)`); continue; }
          k = base; v = greg;
        }
      }
      const f = H.getField(k);
      if (!f) { rejected.push(k); continue; }
      if (f.derived) { rejected.push(k); continue; }
      if (f.type === 'date') {
        if (v === '' || v === null) { emp[k] = null; applied[k] = null; continue; }
        const dt = new Date(v);
        if (isNaN(dt)) { rejected.push(k); continue; }
        // أكثرُ حقول التواريخ هنا **نصٌّ** في المخطَّط بصيغة YYYY-MM-DD (انظر
        // models/Employee)، وإسنادُ كائن تاريخٍ إلى حقلٍ نصّيّ يخزّن ناتج
        // `Date.toString()` كاملًا: «Fri Jan 01 2027 03:00:00 GMT+0300 (…)».
        // فيبقى التاريخ يُقرأ على الشاشة ولا يُقارَن — الترتيبُ النصّيّ يختلّ،
        // ومطابقةُ الاستيراد بالصيغة القياسية تسقط، ويظهر في التصدير سطرٌ
        // بلغةٍ أخرى. والعطب صامت: لا شيء يبدو خاطئًا حتى يُسأل الملفّ سؤالًا
        // يعتمد على الصيغة. فيُكتب بصيغة الحقل نفسه، ويبقى الكائن لما عُرِّف
        // في المخطَّط تاريخًا حقًّا.
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim())
          ? String(v).trim() : dt.toISOString().slice(0, 10);
        emp[k] = Employee.schema.path(k)?.instance === 'String' ? iso : dt;
        applied[k] = emp[k];
      } else if (f.type === 'bool') {
        emp[k] = v === true || v === 'true' || v === '1'; applied[k] = emp[k];
      } else {
        // ويُكتب في العمود الموافق لنوع الهويّة — وإلّا كُتب رقمُ السعوديّ في
        // خانة الإقامة، فيقرؤه الماستر ولا يقرؤه ملفُّ الموظّف.
        const target = H.writeKeyOf(emp, k);
        emp[target] = String(v ?? '').trim(); applied[k] = emp[target];
      }
    }
    if (!Object.keys(applied).length) {
      return res.status(400).json({ message: rejected.length ? `حقول غير معروفة: ${rejected.join(', ')}` : 'لم تُرسل أي حقول' });
    }

    // ── وتغييرُ النوع يجرّ معه بياناتِ العقد ────────────────────────────
    //
    // مَن ليس على كفالتنا فلا عقدَ بيننا وبينه، فبياناتُ عقده «غير مطلوبة» لا
    // «ناقصة». والقاعدةُ تُطبَّق هنا في الخادم لا في الشاشة، فيستوي فيها من
    // غيّر النوعَ من الماستر ومن غيّره من ملفّ الموظّف — والعكسُ كذلك: من
    // نُقل إلى الكفالة تعود بياناتُ عقده مطلوبةً كغيره.
    if (Object.prototype.hasOwnProperty.call(applied, 'employmentType')) {
      const { applyEmploymentType } = require('../utils/employmentType');
      const set = applyEmploymentType(applied.employmentType);
      emp.isFreelancer = set.isFreelancer;
      for (const [key, val] of Object.entries(set)) {
        if (!key.startsWith('fieldStatus.')) continue;
        const sk = key.slice('fieldStatus.'.length);
        if (val) emp.fieldStatus.set(sk, val);
        else emp.fieldStatus.delete(sk);
      }
      applied.isFreelancer = emp.isFreelancer;
    }

    // «غير مطلوب» قرار إداري — لو المستخدم بيعلّم حقل كده بنسجّلها صراحةً.
    for (const [k, code] of Object.entries(req.body.markStatus || {})) {
      if (!H.getField(k)) continue;
      if (code === 'clear') emp.fieldStatus.delete(H.statusKeyOf(k));
      else if (['required', 'not_required', 'none', 'inactive'].includes(code)) emp.fieldStatus.set(H.statusKeyOf(k), code);
    }

    await emp.save();   // pre-save بيشيل «مطلوب» عن أي حقل اتملى

    // ── وبطاقةُ السائق تُكتب في سجلّ المركبات ─────────────────────────────
    // السجلُّ هناك هو المرجع؛ ما يُعدَّل هنا يُكتب فيه ثمّ تعود لقطتُه منه.
    if (['driverCardNumber', 'driverCardExpiry', 'driverCardType'].some((k) => k in applied)) {
      try { await require('../utils/driverCardSync').pushEmployeeToCard(emp, { userId: req.user?._id, emit: false }); } catch (e) { console.error('HR → driver card:', e.message); }
    }

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
    const ck = `hrm:exp:${JSON.stringify(req.query || {})}`;
    const cached = cache.get(ck);
    if (cached !== undefined) return res.json(cached);
    const withinDays = req.query.withinDays === '' || req.query.withinDays == null ? null : Math.max(0, Number(req.query.withinDays) || 0);
    const wanted = (req.query.doc || '').split(',').map((x) => x.trim()).filter(Boolean);
    const docs = wanted.length ? H.DOCUMENT_GROUPS.filter((g) => wanted.includes(g.key)) : H.DOCUMENT_GROUPS;
    const includeExpired = req.query.includeExpired !== '0';
    const wantState = req.query.state || '';

    // النطاقُ نفسُه الذي عُدَّ به رقمُ الشريط — راجع EXPIRY_SCOPE.
    const scope = expiryScopeOf(req.query);
    const employees = await findEmployees({ ...req.query, ...scope },
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
        // «يحتاج انتباهًا» تجمع الثلاثَ حالات — راجع records.
        if (wantState === 'attention') { if (!['expired', 'critical', 'warning'].includes(st.state)) continue; }
        else if (wantState && st.state !== wantState) continue;
        if (withinDays !== null && st.days > withinDays) continue;
        rows.push({
          employeeId: e._id, employeeNumber: e.employeeNumber,
          name: e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
          iqamaNumber: H.valueOf(e, 'iqamaNumber') || '',
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

    const body = {
      rows: rows.slice(0, 2000), summary,
      byDoc: H.DOCUMENT_GROUPS.map((g) => ({ key: g.key, ar: g.ar, en: g.en, count: byDoc[g.key] || 0 })),
      withinDays,
      alert: ALERT, expiryScope: scope,
    };
    cache.set(ck, body, 60000);
    res.json(body);
  } catch (e) {
    console.error('hr expiring', e);
    res.status(500).json({ message: 'تعذّر تحميل الانتهاءات' });
  }
};

/** تعريف المجموعات والحقول — الواجهة بتبني منه الصفحات والفلاتر. */
/**
 * GET /master/choices — قيمُ كلّ حقلِ اختيارٍ كما هي مستعمَلةٌ في الملفّ.
 *
 * نوعُ الرخصة والبنك وحالةُ التأمين كانت نصًّا حرًّا، فكُتب البنكُ الواحد
 * بخمس صيغ («الراجحي»، «مصرف الراجحي»، «Al Rajhi»…) وصار الفلترُ خمسَ قيمٍ لشيءٍ
 * واحد. القائمةُ تُبنى من القيم الموجودة فعلًا (فلا تخترع مفرداتٍ لا يعرفها
 * أحد)، وتُرتَّب بالأكثر استعمالًا، ويبقى للكاتب أن يضيف قيمةً جديدة.
 */
exports.choices = async (req, res) => {
  try {
    const body = await cache.wrap('hrm:choices', 60000, async () => {
      const fields = H.ALL_FIELDS.filter((f) => f.choice);
      const rows = await Employee.find({ isHrRecord: { $ne: false } }).select(fields.map((f) => f.key).join(' ')).lean();
      const out = {};
      for (const f of fields) {
        const counts = new Map();
        for (const r of rows) {
          const v = String(r[f.key] ?? '').trim();
          if (!v || /^(مطلوب|غير مطلوب|لا يوجد|لايوجد|-|—)$/.test(v)) continue;
          counts.set(v, (counts.get(v) || 0) + 1);
        }
        out[f.key] = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
      }
      return { choices: out };
    });
    res.json(body);
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل القوائم' }); }
};

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

/**
 * تاريخُ التجديد — ميلاديًّا كُتب أو هجريًّا.
 *
 * «ممكن واحد يعمل تجديد ويختار التاريخ هجري وممكن تاني يختار ميلادي». والمخزَّنُ
 * ميلاديٌّ واحدٌ دائمًا (راجع utils/hijri)، فمن أرسل `newExpiryHijri` تُحوَّل
 * كتابتُه هنا — ولا يُفتح حقلٌ ثانٍ في القاعدة ولا تُطلَب مزامنة.
 *
 * والسنةُ تفصل بينهما بلا لبس: الهجريّةُ اليومَ ١٤٤٨ والميلاديّةُ ٢٠٢٦، فحتّى
 * لو كُتب الهجريُّ في خانة الميلاديّ غلطًا لم يُقرأ تاريخًا معقولًا — ومع ذلك
 * لا يُخمَّن: الحقلُ الذي أرسله المستخدم هو الذي يُقرأ.
 */
const renewalDay = (body, prefix = 'newExpiry') => {
  const hijri = String(body?.[`${prefix}Hijri`] ?? '').trim();
  if (hijri) {
    const greg = require('../utils/hijri').fromHijriString(hijri);
    return greg ? asIsoDay(greg) : null;
  }
  return asIsoDay(body?.[prefix]);
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
    const newExpiry = renewalDay(req.body);
    if (!newExpiry) {
      return res.status(400).json({
        message: req.body?.newExpiryHijri ? 'التاريخُ الهجريُّ غير صحيح' : 'أدخل تاريخ الانتهاء الجديد',
      });
    }

    const emp = await Employee.findById(req.body.employee);
    if (!emp) return res.status(404).json({ message: 'الموظف غير موجود' });

    const { key, map } = resolved;
    const previousExpiry = emp[map.expiry] || '';
    emp[map.expiry] = newExpiry;
    const docNum = String(req.body.documentNumber ?? '').trim();
    if (map.number && docNum) emp[map.number] = docNum;
    await emp.save();
    // تجديدُ بطاقة السائق من الموارد البشريّة يُكتب في سجلّ المركبات كذلك.
    if (resolved?.key === 'driverCard' || /driverCard/.test(String(resolved?.expiry || ''))) {
      try { await require('../utils/driverCardSync').pushEmployeeToCard(emp, { userId: req.user?._id, emit: false }); } catch (e) { console.error('HR renew → driver card:', e.message); }
    }

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

    const sharedExpiry = renewalDay(req.body);
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
      const newExpiry = renewalDay(row) || sharedExpiry;
      if (!newExpiry) return errors.push({ line, message: 'تاريخ الانتهاء الجديد ناقص أو غير صالح' });
      const emp = byId.get(String(row.employee || row.id || ''));
      if (!emp) return errors.push({ line, message: 'الموظف غير موجود' });
      plan.push({ emp, key: resolved.key, map: resolved.map, newExpiry, documentNumber: String(row.documentNumber ?? '').trim() });
    });

    if (errors.length) {
      return res.status(400).json({ message: 'رُفضت العملية كاملةً — لم يُجدَّد أي مستند', errors });
    }

    // ② الكتابة.
    const renewed = [];
    const history = [];
    for (const p of plan) {
      const previousExpiry = p.emp[p.map.expiry] || '';
      p.emp[p.map.expiry] = p.newExpiry;
      if (p.map.number && p.documentNumber) p.emp[p.map.number] = p.documentNumber;
      await p.emp.save();
      if (/driverCard/.test(JSON.stringify(p.resolved || p.map || {}))) {
        try { await require('../utils/driverCardSync').pushEmployeeToCard(p.emp, { userId: req.user?._id, emit: false }); } catch (e) { console.error('HR bulk renew → driver card:', e.message); }
      }
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

// ═══════════════════════════════════════════════════════════════════════════
//  التحليلُ بالأقسام
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /master/by-department — صفٌّ لكلّ قسمٍ بأرقامه كلِّها.
 *
 * ── لماذا جدولٌ لا فلترٌ وحدَه ──────────────────────────────────────────────
 * اللوحةُ تُفلتَر بالقسم فتقول كلَّ شيءٍ عن قسمٍ واحد. وسؤالُ من يدير الموارد
 * البشريّة ليس «ما حالُ التشغيل؟» بل **«أيُّ الأقسام أسوأ؟»** — وجوابُه يحتاج
 * الأقسامَ كلَّها في شاشةٍ واحدةٍ متجاورة. وبغيره تُفتَح اللوحةُ عشرين مرّةً
 * بعشرين فلترٍ ويُكتَب الناتجُ على ورقة.
 *
 * فلكلّ قسم: عددُه (على رأس العمل / منتهية خدمتُه)، وخاناتُه الناقصة، ومستنداتُه
 * المنتهية والقريبة، وعقودُه، وإجازاتُه القائمة، وعهدُه. والعدُّ كلُّه في
 * القاعدة في استعلامين — لا نقلَ لأربع مئة موظّفٍ لتُعَدّ في العقدة (راجع
 * التعليقَ في `overview` لسبب هذه القاعدة).
 *
 * وكلُّ رقمٍ مفتاحُه فلترٌ جاهز: الشاشةُ تفتح صفوفَه بالقسم نفسِه فلا يُقرأ رقمٌ
 * لا تُرى ورقتُه.
 */
exports.byDepartment = async (req, res) => {
  try {
    const key = `hrm:bydept:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const match = await matchFor(req.query);
    const allKeys = storedKeys();
    // ── و«ناقص» تُقرأ بالقاعدة نفسِها التي تقرؤها اللوحة ────────────────────
    // `statusExpr` هو تعريفُ حالة الخانة في القاعدة (راجع utils/hrCounts):
    // «مطلوب» خانةٌ فارغةٌ لم تُعلَّم «غير مطلوبة». ولو كُتب هنا شرطٌ ثانٍ
    // بمعناه لاختلف الرقمُ عن بطاقات اللوحة يومًا بلا أن يُعرَف لماذا.
    const { statusExpr } = require('../utils/hrCounts');

    const missingExpr = {
      $add: allKeys.map((k) => ({ $cond: [{ $eq: [statusExpr(k), 'required'] }, 1, 0] })),
    };

    // ── والمستنداتُ المنتهيةُ تُعَدّ بقاعدة اللوحة أيضًا ────────────────────
    // سبعةٌ من حقول الانتهاء الثمانية نصوصٌ لا تواريخ، وفيها نصوصٌ لا تُقرأ
    // تاريخًا أصلًا («Fri Sep 03 2027 03:00:00 GMT+0300…») — فـ`$toDate`
    // تُسقِط الاستعلامَ كلَّه عند أوّل واحدٍ منها. والقاعدةُ المكتوبةُ في
    // `docStateCounts` تحوّل بـ`$convert` مع `onError: null`: ما لا يُقرأ
    // تاريخًا يُعَدّ «ناقصًا». فتُقرأ هنا حرفًا بحرف.
    const docGroups = H.GROUPS.filter((g) => g.document && g.expiryField);
    const docDays = (g) => ({
      $let: {
        vars: { dd: { $convert: { input: `$${g.expiryField}`, to: 'date', onError: null, onNull: null } } },
        in: { $cond: [{ $eq: ['$$dd', null] }, null, { $dateDiff: { startDate: '$$NOW', endDate: '$$dd', unit: 'day' } }] },
      },
    });
    // «منتهٍ» ما مضى تاريخُه، و«قريب» ما بقي له ما دون حدّ التنبيه — ولا يُعَدّ
    // مستندٌ لم يُطلَب من صاحبه (سعوديٌّ بلا إقامة ليس «منتهيًا»).
    const applicable = (g) => ({ $not: [{ $in: [statusExpr(g.expiryField), ['not_required', 'none']] }] });
    const expiredExpr = {
      $add: docGroups.map((g) => ({
        $cond: [{ $and: [applicable(g), { $lt: [docDays(g), 0] }] }, 1, 0],
      })),
    };
    const soonExpr = {
      $add: docGroups.map((g) => ({
        $cond: [{
          $and: [applicable(g), { $gte: [docDays(g), 0] }, { $lte: [docDays(g), ALERT.warnDays] }],
        }, 1, 0],
      })),
    };

    const rows = await Employee.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$department', ''] },
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$employmentStatus', 'active'] }, 1, 0] } },
          ended: { $sum: { $cond: [{ $eq: ['$employmentStatus', 'active'] }, 0, 1] } },
          saudi: { $sum: { $cond: [{ $eq: ['$nationality', 'سعودي'] }, 1, 0] } },
          outside: { $sum: { $cond: ['$isOutsideKingdom', 1, 0] } },
          freelancers: { $sum: { $cond: ['$isFreelancer', 1, 0] } },
          missing: { $sum: missingExpr },
          peopleWithMissing: { $sum: { $cond: [{ $gt: [missingExpr, 0] }, 1, 0] } },
          docsExpired: { $sum: expiredExpr },
          docsSoon: { $sum: soonExpr },
          salary: { $sum: { $ifNull: ['$basicSalary', 0] } },
        },
      },
      { $sort: { total: -1 } },
    ]).allowDiskUse(true);

    // الإجازاتُ والعهدُ والعقودُ تعيش في مجموعاتٍ أخرى، فتُعَدّ هناك وتُضَمّ
    // بالقسم — لا تُقرأ لكلّ قسمٍ على حدة.
    const Asset = require('../models/Asset');
    const LeaveRequest = require('../models/LeaveRequest');
    const Contract = require('../models/Contract');
    const deptOf = new Map((await Employee.find(match).select('department').lean())
      .map((e) => [String(e._id), e.department || '']));

    const tallyBy = (docs, pick) => {
      const m = new Map();
      for (const d of docs) {
        const dep = deptOf.get(String(pick(d)));
        if (dep === undefined) continue;        // موظّفٌ خارج الفلتر الحاليّ
        m.set(dep, (m.get(dep) || 0) + 1);
      }
      return m;
    };
    const [assets, leaves, contracts] = await Promise.all([
      Asset.find({ status: 'assigned' }).select('employee').lean().catch(() => []),
      LeaveRequest.find({ status: { $in: ['pending', 'approved'] } }).select('employee status').lean().catch(() => []),
      Contract.find({ status: 'active' }).select('employee').lean().catch(() => []),
    ]);
    const custodyBy = tallyBy(assets, (a) => a.employee);
    const leavePendingBy = tallyBy(leaves.filter((l) => l.status === 'pending'), (l) => l.employee);
    const leaveApprovedBy = tallyBy(leaves.filter((l) => l.status === 'approved'), (l) => l.employee);
    const contractsBy = tallyBy(contracts, (c) => c.employee);

    const departments = rows.map((r) => ({
      department: r._id || '',
      total: r.total,
      active: r.active,
      ended: r.ended,
      saudi: r.saudi,
      outside: r.outside,
      freelancers: r.freelancers,
      missing: r.missing,
      peopleWithMissing: r.peopleWithMissing,
      // الاكتمالُ نسبةُ ما مُلئ من خانات القسم كلِّها — رقمٌ واحدٌ يقارن
      // الأقسامَ بعضَها ببعضٍ مهما اختلفت أعدادُها.
      completeness: r.total && allKeys.length
        ? Math.round((1 - r.missing / (r.total * allKeys.length)) * 1000) / 10
        : 100,
      docsExpired: r.docsExpired,
      docsSoon: r.docsSoon,
      contracts: contractsBy.get(r._id || '') || 0,
      custody: custodyBy.get(r._id || '') || 0,
      leavesPending: leavePendingBy.get(r._id || '') || 0,
      leavesApproved: leaveApprovedBy.get(r._id || '') || 0,
      salary: Math.round(r.salary),
    }));

    const body = {
      departments,
      fieldsPerEmployee: allKeys.length,
      totals: departments.reduce((s, d) => ({
        total: s.total + d.total, active: s.active + d.active, ended: s.ended + d.ended,
        missing: s.missing + d.missing, docsExpired: s.docsExpired + d.docsExpired,
        docsSoon: s.docsSoon + d.docsSoon, custody: s.custody + d.custody,
        leavesPending: s.leavesPending + d.leavesPending, leavesApproved: s.leavesApproved + d.leavesApproved,
        contracts: s.contracts + d.contracts, salary: s.salary + d.salary,
      }), { total: 0, active: 0, ended: 0, missing: 0, docsExpired: 0, docsSoon: 0, custody: 0, leavesPending: 0, leavesApproved: 0, contracts: 0, salary: 0 }),
    };
    cache.set(key, body, 20000);
    res.json(body);
  } catch (e) {
    console.error('hr byDepartment', e);
    res.status(500).json({ message: 'تعذّر تحميل تحليل الأقسام' });
  }
};
