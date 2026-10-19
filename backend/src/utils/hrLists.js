/**
 * hrLists — خاناتُ ملفّ الموظّف التي تُختار من قائمةٍ ولا تُكتب.
 *
 * ── القاعدة (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ──────────────────────────────────────
 * القسمُ والجنسيّةُ والمدينةُ والمشروعُ قوائمُ مغلقة في كلّ شاشةٍ تكتبها — الماستر،
 * وملفّ الموظّف، والتطبيق — وفيها بحث. والقائمةُ صفوفُ `Lookup` تُدار من
 * «القوائم المرجعيّة» (الأقسامُ للسوبر أدمن وحدَه — config/lookupTypes ← superOnly).
 *
 * والمخزَّنُ في الملفّ هو الاسمُ العربيّ كما كان منذ الاستيراد — تقرؤه الفلاترُ
 * والتصديراتُ والتقاريرُ مباشرةً. فلذلك:
 *   · تغييرُ اسم بندٍ يُكتب على ملفّات أصحابه في اللحظة نفسِها (`renamed`)؛
 *   · والبندُ الذي عليه موظّفون لا يُحذف ولا يُوقَف (`usage`).
 *
 * ── والمشروعُ قائمتان ──────────────────────────────────────────────────────
 * مشاريعُ B2C (`lt_project`: كيتا، امازون، هنجرستيشن…) يملكها قسمُ B2C، ومشروعُ
 * موظّف B2C يُقرأ من سجلّه هناك ويُكتب فيه (models/LightTransport ← hook، و
 * `projectToB2C` هنا). وبقيّةُ المشاريع (`hr_project`) للموارد البشريّة.
 */
const cache = require('./ttlCache');

const NO_DEPARTMENT = 'بدون قسم';
const B2C_UNSET = '(غير محدد)';

/** خانةُ الملفّ → قوائمُها (الأولى هي التي تُدار من الموارد البشريّة). */
const FIELD_LISTS = {
  department: ['hr_department'],
  nationality: ['hr_nationality'],
  branchName: ['hr_work_location'],
  workLocation: ['hr_work_location'],
  project: ['hr_project', 'lt_project'],
  staffCategory: ['hr_staff_category'],
};
/** قائمةٌ → خاناتُ الملفّ التي تحمل أسماءَها. */
const LIST_FIELDS = Object.entries(FIELD_LISTS).reduce((m, [field, types]) => {
  for (const t of types) (m[t] = m[t] || []).push(field);
  return m;
}, {});
const isHrList = (type) => !!LIST_FIELDS[type];

/** أسماءُ قائمةٍ (العربيّة) — بترتيبها. */
const namesOf = (type) => cache.wrap(`hrlists:${type}`, 30000, async () => {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type, isActive: true, deleted: { $ne: true } })
    .sort({ order: 1, nameEn: 1 }).select('nameAr').lean();
  return rows.map((r) => String(r.nameAr || '').trim()).filter((n) => n && n !== B2C_UNSET);
});

/** خياراتُ خانةٍ: قوائمُها مجموعةً بلا تكرار. */
async function optionsFor(field) {
  const types = FIELD_LISTS[field] || [];
  const out = [];
  for (const t of types) for (const n of await namesOf(t)) if (!out.includes(n)) out.push(n); // eslint-disable-line no-await-in-loop
  return out;
}

const forget = () => {
  try { cache.clear('hrlists:'); cache.clear('hrdept:'); cache.clear('hrm:choices'); } catch (_) { /* */ }
};

const LABELS = { staffCategory: 'الفئة الوظيفية', department: 'القسم', nationality: 'الجنسية', branchName: 'المدينة', workLocation: 'مكان العمل', project: 'المشروع' };
const MANAGER = { staffCategory: 'السوبر أدمن', department: 'السوبر أدمن', nationality: 'الموارد البشريّة', branchName: 'الموارد البشريّة', workLocation: 'الموارد البشريّة', project: 'الموارد البشريّة (ومشاريع B2C من قسم B2C)' };

/**
 * رسالةُ رفضٍ إن لم تكن القيمةُ من القائمة، وإلّا null.
 * الفارغُ مقبول. وما كان في الملفّ من قبل ولم يتغيّر لا يُرفض — فحفظُ خانةٍ أخرى
 * في ملفٍّ قديمٍ لا يتعطّل بقيمةٍ قديمة.
 */
async function fieldError(field, value, previous) {
  if (!FIELD_LISTS[field]) return null;
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (previous != null && v === String(previous).trim()) return null;
  if ((await optionsFor(field)).includes(v)) return null;
  return `${LABELS[field]} «${v}» ليس في القائمة — اختر منها (يضيف إليها ${MANAGER[field]} من القوائم المرجعيّة)`;
}

/** يفحص كلَّ خانات القوائم في جسمٍ مُرسَل. يُرجع أوّلَ رسالة رفض. */
async function bodyError(body, current = {}) {
  for (const f of Object.keys(FIELD_LISTS)) {
    if (body[f] === undefined) continue;
    const err = await fieldError(f, body[f], current[f]); // eslint-disable-line no-await-in-loop
    if (err) return err;
  }
  return null;
}

/** كم ملفًّا يحمل هذا الاسم في خانات هذه القائمة — ومنهم في الأرشيف. */
async function usage(type, name) {
  const Employee = require('../models/Employee');
  const { ARCHIVED } = require('./hrEngagement');
  const n = String(name || '').trim();
  const fields = LIST_FIELDS[type] || [];
  if (!n || !fields.length) return { total: 0, archived: 0 };
  const q = { $or: fields.map((f) => ({ [f]: n })) };
  const [total, archived] = await Promise.all([
    Employee.countDocuments(q),
    Employee.countDocuments({ $and: [q, ARCHIVED] }),
  ]);
  // مشاريعُ B2C يحملها سجلُّ B2C أيضًا.
  if (type === 'lt_project') {
    const { LightTransportEmployee } = require('../models/LightTransport');
    const lt = await LightTransportEmployee.countDocuments({ projectAr: n });
    return { total: total + lt, archived };
  }
  return { total, archived };
}

const bust = (payload) => {
  for (const p of ['hrm:', 'hr:', 'dash:', 'endedstaff:', 'lt:', 'perf:']) { try { cache.clear(p); } catch (_) { /* */ } }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('hr:master', payload || {});
    emitToAll('hr:employee', {});
  } catch (_) { /* */ }
};

/** الاسمُ الجديدُ على كلّ ملفٍّ يحمل القديم، ثمّ تتحدّث الشاشاتُ المفتوحة. */
async function renamed(type, from, to) {
  forget();
  const a = String(from || '').trim(); const b = String(to || '').trim();
  const fields = LIST_FIELDS[type] || [];
  if (!a || !b || a === b || !fields.length) return { touched: 0 };
  const Employee = require('../models/Employee');
  let touched = 0;
  for (const f of fields) {
    const r = await Employee.updateMany({ [f]: a }, { $set: { [f]: b } }); // eslint-disable-line no-await-in-loop
    touched += r.modifiedCount || 0;
  }
  if (type === 'lt_project') {
    const { LightTransportEmployee } = require('../models/LightTransport');
    await LightTransportEmployee.updateMany({ projectAr: a }, { $set: { projectAr: b } });
  }
  bust({ listRenamed: { type, from: a, to: b } });
  return { touched };
}

/**
 * ── مشروعُ موظّف B2C ──────────────────────────────────────────────────────
 * مَن له صفٌّ في سجلّ B2C مشروعُه هناك. فإن غيّرته الموارد البشريّة كُتب هناك
 * أيضًا — والعكسُ في hook السجلّ. ولا يُختار له إلّا مشروعٌ من مشاريع B2C.
 */
async function b2cRowOf(employeeId) {
  const { LightTransportEmployee } = require('../models/LightTransport');
  return LightTransportEmployee.findOne({ employee: employeeId }).select('_id projectAr employee');
}
async function projectError(employee, value) {
  const v = String(value ?? '').trim();
  if (!v || v === String(employee.project || '').trim()) return null;
  const row = await b2cRowOf(employee._id);
  if (!row) return null;
  if ((await namesOf('lt_project')).includes(v)) return null;
  return `«${v}» ليس من مشاريع B2C — هذا الموظّف في سجلّ B2C، فمشروعُه من مشاريعه (${(await namesOf('lt_project')).join('، ')})`;
}
async function projectToB2C(employee, value) {
  const row = await b2cRowOf(employee._id);
  if (!row) return false;
  const v = String(value ?? '').trim() || B2C_UNSET;
  if (String(row.projectAr || '') === v) return false;
  row.projectAr = v;
  row.$locals.fromHr = true; // لا يُعاد إلى الملفّ ما جاء منه
  await row.save();
  try { require('../websocket/socketManager').emitToAll('lt:updated', {}); } catch (_) { /* */ }
  return true;
}
/** مشروعُ سجلّ B2C كما يُكتب في الملفّ. */
const projectFromB2C = (projectAr) => {
  const v = String(projectAr || '').trim();
  return v === B2C_UNSET ? '' : v;
};

/**
 * ── الفئةُ الوظيفيّة لقسمين وحدَهما ──────────────────────────────────────────
 * B2C والنقل الثقيل — يُعرفان بمفتاحيهما في قائمة الأقسام (light_transport ·
 * heavy_transport) لا باسميهما، فلا يُبطلُ تغييرُ الاسم القاعدة.
 */
const categoryDepartments = () => cache.wrap('hrlists:catdeps', 30000, async () => {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type: 'hr_department', key: { $in: ['light_transport', 'heavy_transport'] }, deleted: { $ne: true } }).select('nameAr').lean();
  return rows.map((r) => String(r.nameAr || '').trim()).filter(Boolean);
});
async function categoryError(department, value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const deps = await categoryDepartments();
  if (deps.includes(String(department || '').trim())) return null;
  return `الفئة الوظيفية لموظفي ${deps.join(' و')} فقط`;
}

module.exports = {
  categoryDepartments, categoryError,
  FIELD_LISTS, LIST_FIELDS, isHrList, NO_DEPARTMENT, B2C_UNSET,
  namesOf, optionsFor, forget, fieldError, bodyError, usage, renamed, bust,
  projectError, projectToB2C, projectFromB2C,
};
