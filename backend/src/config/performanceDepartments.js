/**
 * performanceDepartments — قسمُ الموظّف في تقييم الأداء: قاعدةٌ واحدةٌ تُسأل
 * في كلّ موضع.
 *
 * ── ما كان ────────────────────────────────────────────────────────────────
 * صفحةُ تقييم كلّ قسمٍ كانت تُبنى من «مدير القسم»: قسمُه هو في الموارد البشريّة
 * ومعه كلُّ من كُتب مديرًا مباشرًا له. فمديرةُ العقود — وهي موظّفةٌ في
 * «المالية» — جلبت قسمَ الماليّة كلَّه إلى صفحة العقود، ومديرُ تطوير الأعمال جلب
 * مندوبي «المبيعات» لأنّهم يتبعونه، وصفحةُ المبيعات نفسُها فارغة. وصفحةُ «كل
 * الأقسام» تعدّ بالنصّ الحرّ، فـ«B2C» و«ادارة B2C» قسمان، والحساباتُ التي ليست
 * ملفَّ موارد بشريّة تُعَدّ في الملاك ولا تظهر في أيّ قائمة.
 *
 * ── ما صار ────────────────────────────────────────────────────────────────
 * ١. **قسمُ الموظّف ما في ملفّه** (`Employee.department`) لا غير — لا دورُ حسابه
 *    ولا مديرُه المباشر. ويُقرأ عبر قائمة الأقسام المعتمدة نفسِها التي تُختار
 *    منها خانةُ القسم في الموارد البشريّة (`Lookup` من نوع `hr_department`)،
 *    فلا قائمةَ ثانيةَ هنا. والمطابقةُ بعد طيّ صور الكتابة: الهمزات والتاء
 *    المربوطة والألف المقصورة و«ال» التعريف وكلمة «إدارة/قسم» والمسافات.
 *    وما لم يطابق شيئًا يبقى قسمًا باسمه كما كُتب — لا يُدَسّ في قسمٍ غيره —
 *    والفارغُ «بدون قسم».
 * ٢. **لكلّ قسمٍ صفحةُ نظامٍ واحدةٌ تملكه** (أو لا صفحة): التي تحمل اسمَه
 *    (مفتاحُ القسم في config/sections.js أو اسمُه العربيّ)، وإلّا فالتي يتبع
 *    مديرَها أكثرُ من نصف موظّفي القسم بحسب «المدير المباشر» في ملفّاتهم —
 *    فـ«النقل الثقيل» لصفحة إدارة الأسطول و«الصيانة» للوكيشن سوليوشن، وليس في
 *    النظام قسمٌ باسمهما. ولا خريطةَ مكتوبةً بين التسميتين تشيخ.
 *
 * ومن هاتين تُشتقّ القائمةُ والصلاحيّةُ والأرقامُ معًا — راجع performanceController.
 */
const { nameKey } = require('../utils/nameKey');
const { isLightDepartment } = require('../utils/lightTransportSync');
const { SECTION_ROLES } = require('./roles');

const NONE = Object.freeze({ key: '__none__', label: 'بدون قسم', labelEn: 'No department', known: false, none: true });

// كلماتٌ لا تميّز قسمًا عن قسم: «إدارة العقود» و«العقود» قسمٌ واحد.
const GENERIC = new Set(['اداره', 'قسم', 'department', 'dept']);

/**
 * مفتاحُ المطابقة لاسم قسم. `nameKey` يطوي الهمزات والتاء والألف المقصورة،
 * ويُزاد عليه هنا «ال» التعريف في أوّل الكلمة («تخليص جمركي» = «التخليص
 * الجمركي») وكلماتُ «إدارة/قسم». والطيُّ الواسع آمنٌ هنا لأنّ المطابَق قائمةٌ
 * قصيرةٌ معتمدة، لا أسماءُ شركاتٍ يتسرّب بعضُها إلى بعض.
 */
function deptFold(value) {
  const words = String(value || '').replace(/[_/\\|،,.()\-–—]+/g, ' ').split(/\s+/)
    .map((w) => nameKey(w))
    .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
    .filter(Boolean);
  const kept = words.filter((w) => !GENERIC.has(w));
  return (kept.length ? kept : words).join('');
}

/** يبني فهرسَ المطابقة من صفوف قائمة الأقسام. */
function buildIndex(rows) {
  const list = (rows || []).filter((r) => r && r.key && !r.deleted);
  const byFold = new Map();
  for (const r of list) {
    for (const name of [r.nameAr, r.nameEn, r.key]) {
      const f = deptFold(name);
      if (f && !byFold.has(f)) byFold.set(f, r);
    }
  }
  return { rows: list, byFold, light: list.find((r) => r.key === 'light_transport') || null };
}

/**
 * قائمةُ الأقسام المعتمدة كما هي في القاعدة الآن (يعدّلها مسؤولُ الموارد
 * البشريّة من «البيانات المرجعيّة»). وإن لم تُبذَر بعدُ فبذورُها من الإعداد.
 */
async function loadIndex() {
  const Lookup = require('../models/Lookup');
  let rows = await Lookup.find({ type: 'hr_department', deleted: { $ne: true } })
    .select('key nameAr nameEn order').sort({ order: 1 }).lean();
  if (!rows.length) {
    const { REGISTRY } = require('./lookupTypes');
    const def = (REGISTRY || []).find((t) => t.type === 'hr_department');
    rows = (def?.seed || []).map((s) => ({ ...s }));
  }
  return buildIndex(rows);
}

/**
 * القسمُ المعتمد لنصٍّ كُتب في ملفّ موظّف (أو في نموذج تقييم).
 * @returns {{ key: string, label: string, labelEn: string, known: boolean }}
 */
/**
 * ── ومن لا تقييمَ له ───────────────────────────────────────────────────────
 * «سعودة» و«مواءمة» تصنيفُ توظيفٍ لا قسمُ عمل: لا مديرَ قسمٍ يتابعهم ولا
 * مؤشّراتِ أداءٍ لهم (قرارُ صاحب الشركة). فلا يدخلون قوائمَ التقييم ولا ملاكَ
 * النظرة الشاملة، ولا يُفتَح لهم نموذجُ تقييم. والمقارنةُ بالطيّ: «موائمة»
 * و«مواءمة» كتابتان لشيءٍ واحد.
 */
const NO_KPI_DEPARTMENTS = ['سعودة', 'مواءمة', 'موائمة'];
const NO_KPI_FOLDS = new Set(NO_KPI_DEPARTMENTS.map((d) => deptFold(d)));
const isKpiExempt = (raw) => NO_KPI_FOLDS.has(deptFold(String(raw || '').replace(/\s+/g, ' ').trim()));

function resolveDepartment(raw, index) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return NONE;
  const f = deptFold(text);
  let row = index.byFold.get(f);
  // «B2C» و«ادارة B2C» و«قطاع الأفراد» هي النقلُ الخفيف — القاعدةُ نفسُها التي
  // يُدخَل بها الموظّفُ سجلَّ النقل الخفيف (utils/lightTransportSync).
  if (!row && index.light && (isLightDepartment(text) || deptFold(index.light.nameAr) === f)) row = index.light;
  if (!row && index.light && isLightDepartment(text.replace(/^(ادارة|إدارة|قسم)\s+/, ''))) row = index.light;
  if (row) return { key: row.key, label: row.nameAr, labelEn: row.nameEn || row.nameAr, known: true };
  // ليس في القائمة: قسمٌ باسمه. يُجمَع ما اتّفق طيُّه كي لا تصنع مسافةٌ قسمين.
  return { key: `x:${f || text}`, label: text, labelEn: text, known: false };
}

/** أدوارُ من يدير قسمَ النظام — مديرُه، ومن فوقه إن وُجد (المدير الماليّ). */
function managerRolesOf(sectionKey) {
  const { JP_SECTIONS } = require('./jpSections');
  const jp = Object.values(JP_SECTIONS).find((s) => s.roleSection === sectionKey);
  if (jp) return jp.managerRoles;
  const def = SECTION_ROLES.find((s) => s.section === sectionKey);
  return def ? [def.manager.key] : [];
}

// دورُ مديرٍ → قسمُه. يُبنى مرّةً: الأدوارُ إعدادٌ لا يتغيّر والخادمُ يعمل.
let byManagerRole = null;
function sectionOfManagerRole(role) {
  if (!byManagerRole) {
    byManagerRole = new Map();
    for (const s of SECTION_ROLES) {
      for (const r of managerRolesOf(s.section)) if (!byManagerRole.has(r)) byManagerRole.set(r, s.section);
    }
  }
  return byManagerRole.get(role) || null;
}

/**
 * أيُّ صفحةِ قسمٍ في النظام تملك كلَّ قسمٍ من أقسام الموارد البشريّة.
 *
 * @param {object} index     فهرسُ الأقسام المعتمدة
 * @param {Array}  employees موظّفون على رأس العمل، وعلى كلٍّ منهم `dept` (resolveDepartment)
 * @param {Map}    roleOf    معرّفُ المستخدم → دورُه (الحسابات الفعّالة)
 * @returns {Map<string, string>} مفتاحُ القسم المعتمد → مفتاحُ قسم النظام
 */
function sectionOwners(index, employees, roleOf) {
  const { SECTION_LABELS_AR } = require('./sections');
  const owner = new Map();

  // ١. بالاسم: القسمُ الذي يحمل اسمَ قسم النظام (مفتاحَه أو اسمَه العربيّ).
  for (const s of SECTION_ROLES) {
    for (const name of [s.section, SECTION_LABELS_AR[s.section]]) {
      const d = resolveDepartment(name, index);
      if (d.known && !owner.has(d.key)) owner.set(d.key, s.section);
    }
  }

  // ٢. بالتبعيّة: قسمٌ لا يحمل اسمَ قسمِ نظامٍ يتبع القسمَ الذي يرأسه مديرُه —
  //    أي يتبع مديرَه (أو هو مديرُه نفسُه) أكثرُ من نصف موظّفيه.
  const size = new Map();
  const led = new Map(); // deptKey → Map(section → count)
  for (const e of employees) {
    const k = e.dept.key;
    if (owner.has(k) || e.dept.none) continue;
    size.set(k, (size.get(k) || 0) + 1);
    const own = sectionOfManagerRole(roleOf.get(String(e.user || '')));
    const boss = sectionOfManagerRole(roleOf.get(String(e.directManager || '')));
    const sec = own || boss;
    if (!sec) continue;
    if (!led.has(k)) led.set(k, new Map());
    led.get(k).set(sec, (led.get(k).get(sec) || 0) + 1);
  }
  for (const [k, bySection] of led) {
    const [sec, n] = [...bySection.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n * 2 > size.get(k)) owner.set(k, sec);
  }
  return owner;
}

module.exports = {
  NO_KPI_DEPARTMENTS, isKpiExempt,
  NONE, deptFold, buildIndex, loadIndex, resolveDepartment, managerRolesOf, sectionOfManagerRole, sectionOwners,
};
