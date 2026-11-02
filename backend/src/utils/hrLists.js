/**
 * hrLists: employee-file fields picked from a list, not typed.
 * Department, nationality, city and project are closed lists backed by `Lookup` rows (departments super-admin only: config/lookupTypes superOnly). The file stores the Arabic name, so renaming an item rewrites the files holding it (`renamed`) and an item in use cannot be deleted or disabled (`usage`).
 * Projects are two lists: B2C `lt_project` (owned by B2C; an employee's project is read from and written to the B2C record, models/LightTransport hook and `projectToB2C`) and HR `hr_project`.
 */
const cache = require('./ttlCache');

const NO_DEPARTMENT = 'بدون قسم';
const B2C_UNSET = '(غير محدد)';

/** File field to its lists (the first is the one managed by HR). */
const FIELD_LISTS = {
  department: ['hr_department'],
  nationality: ['hr_nationality'],
  branchName: ['hr_work_location'],
  workLocation: ['hr_work_location'],
  project: ['hr_project', 'lt_project'],
  staffCategory: ['hr_staff_category'],
  registerNumber: ['hr_register', 'hr_register_kind'],
};
/** List to the file fields that hold its names. */
const LIST_FIELDS = Object.entries(FIELD_LISTS).reduce((m, [field, types]) => {
  for (const t of types) (m[t] = m[t] || []).push(field);
  return m;
}, {});
const isHrList = (type) => !!LIST_FIELDS[type];

/** Names (Arabic) of a list, in order. */
const namesOf = (type) => cache.wrap(`hrlists:${type}`, 30000, async () => {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type, isActive: true, deleted: { $ne: true } })
    .sort({ order: 1, nameEn: 1 }).select('nameAr').lean();
  return rows.map((r) => String(r.nameAr || '').trim()).filter((n) => n && n !== B2C_UNSET);
});

/** Options of a field: its lists combined without duplicates. */
async function optionsFor(field) {
  const types = FIELD_LISTS[field] || [];
  const out = [];
  for (const t of types) for (const n of await namesOf(t)) if (!out.includes(n)) out.push(n); // eslint-disable-line no-await-in-loop
  return out;
}

const forget = () => {
  try { cache.clear('hrlists:'); cache.clear('hrdept:'); cache.clear('hrm:choices'); } catch (_) { /* */ }
};

const LABELS = { registerNumber: 'رقم السجل التجاري', staffCategory: 'الفئة الوظيفية', department: 'القسم', nationality: 'الجنسية', branchName: 'المدينة', workLocation: 'مكان العمل', project: 'المشروع' };
const MANAGER = { registerNumber: 'السوبر أدمن', staffCategory: 'السوبر أدمن', department: 'السوبر أدمن', nationality: 'الموارد البشريّة', branchName: 'الموارد البشريّة', workLocation: 'الموارد البشريّة', project: 'الموارد البشريّة (ومشاريع B2C من قسم B2C)' };

/**
 * Rejection message if the value is not in the list, otherwise null.
 * Empty is accepted. A value already in the file and unchanged is not rejected, so saving another field on an old file is not blocked by a stale value.
 */
async function fieldError(field, value, previous) {
  if (!FIELD_LISTS[field]) return null;
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (previous != null && v === String(previous).trim()) return null;
  if ((await optionsFor(field)).includes(v)) return null;
  return `${LABELS[field]} «${v}» ليس في القائمة — اختر منها (يضيف إليها ${MANAGER[field]} من القوائم المرجعيّة)`;
}

/** Checks every list field in a submitted body; returns the first rejection message. */
async function bodyError(body, current = {}) {
  for (const f of Object.keys(FIELD_LISTS)) {
    if (body[f] === undefined) continue;
    const err = await fieldError(f, body[f], current[f]); // eslint-disable-line no-await-in-loop
    if (err) return err;
  }
  return null;
}

/** How many files carry this name in this list's fields, including archived ones. */
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
  // B2C projects are also held by the B2C record.
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

/** Applies the new name to every file holding the old one, then open screens refresh. */
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

/** B2C employee project: whoever has a row in the B2C record has their project there. If HR changes it, it is written there too (the reverse is in the record hook). Only a B2C project can be chosen for them. */
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
  row.$locals.fromHr = true; // Not written back to the file it came from.
  await row.save();
  // The section caches (its dashboard and the orders dashboard, whose account project follows) are cleared before announcing; otherwise B2C screens would show the old project until the cache expires.
  for (const p of ['lt:', 'b2c:']) { try { cache.clear(p); } catch (_) { /* */ } }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('lt:updated', { id: String(row._id) });
    emitToAll('b2c:rep:updated', { lt: String(row._id) });
  } catch (_) { /* */ }
  return true;
}
/** B2C record project as written in the file. */
const projectFromB2C = (projectAr) => {
  const v = String(projectAr || '').trim();
  return v === B2C_UNSET ? '' : v;
};

/** Job category applies to two departments only: B2C and heavy transport. They are identified by their department-list keys (light_transport, heavy_transport), not by name, so renaming does not break the rule. */
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
