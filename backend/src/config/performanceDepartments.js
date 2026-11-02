/**
 * An employee's department in performance review: one rule used everywhere.
 * It is Employee.department only (not the account role or the direct manager), matched against the HR hr_department lookup after spelling folds; unmatched names stay as written, empty is no department. Each department maps to the one system page that owns it, by name or by the page whose manager most of its staff report to. See performanceController.
 */
const { nameKey } = require('../utils/nameKey');
const { isLightDepartment } = require('../utils/lightTransportSync');
const { SECTION_ROLES } = require('./roles');

const NONE = Object.freeze({ key: '__none__', label: 'بدون قسم', labelEn: 'No department', known: false, none: true });

// Words that do not distinguish one department from another.
const GENERIC = new Set(['اداره', 'قسم', 'department', 'dept']);

/** Match key for a department name: nameKey folds plus a leading definite article and the words for department/section. The wide fold is safe because the matched set is a short approved list. */
function deptFold(value) {
  const words = String(value || '').replace(/[_/\\|،,.()\-–—]+/g, ' ').split(/\s+/)
    .map((w) => nameKey(w))
    .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
    .filter(Boolean);
  const kept = words.filter((w) => !GENERIC.has(w));
  return (kept.length ? kept : words).join('');
}

/** Builds the match index from the department list rows. */
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

/** Approved department list as currently in the DB (edited by HR in Reference Data); seeded from config if not yet seeded. */
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
 * Approved department for a text written on an employee file or review form.
 * @returns {{ key: string, label: string, labelEn: string, known: boolean }}
 */
/** Employment classifications (localization/alignment), not work departments: no department manager and no KPIs, so they are excluded from review lists, headcount and review forms. Matching folds both spellings of the second word. */
const NO_KPI_DEPARTMENTS = ['سعودة', 'مواءمة', 'موائمة'];
const NO_KPI_FOLDS = new Set(NO_KPI_DEPARTMENTS.map((d) => deptFold(d)));
const isKpiExempt = (raw) => NO_KPI_FOLDS.has(deptFold(String(raw || '').replace(/\s+/g, ' ').trim()));

function resolveDepartment(raw, index) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return NONE;
  const f = deptFold(text);
  let row = index.byFold.get(f);
  // These B2C names are light transport; same rule that admits an employee to the light transport register (utils/lightTransportSync).
  if (!row && index.light && (isLightDepartment(text) || deptFold(index.light.nameAr) === f)) row = index.light;
  if (!row && index.light && isLightDepartment(text.replace(/^(ادارة|إدارة|قسم)\s+/, ''))) row = index.light;
  if (row) return { key: row.key, label: row.nameAr, labelEn: row.nameEn || row.nameAr, known: true };
  // Not in the list: keep the department under its own name; fold-equal spellings are merged so whitespace does not split one department.
  return { key: `x:${f || text}`, label: text, labelEn: text, known: false };
}

/** Roles that manage a system department: its manager, and the one above if any (the financial manager). */
function managerRolesOf(sectionKey) {
  const { JP_SECTIONS } = require('./jpSections');
  const jp = Object.values(JP_SECTIONS).find((s) => s.roleSection === sectionKey);
  if (jp) return jp.managerRoles;
  const def = SECTION_ROLES.find((s) => s.section === sectionKey);
  return def ? [def.manager.key] : [];
}

// Manager role to department. Built once: roles are static config.
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
 * Which system department page owns each HR department.
 * @param {object} index approved department index; {Array} employees active employees with `dept`; {Map} roleOf user id to role
 * @returns {Map<string, string>} approved department key to system department key
 */
function sectionOwners(index, employees, roleOf) {
  const { SECTION_LABELS_AR } = require('./sections');
  const owner = new Map();

  // 1. By name: the department carrying the system department's key or Arabic name.
  for (const s of SECTION_ROLES) {
    for (const name of [s.section, SECTION_LABELS_AR[s.section]]) {
      const d = resolveDepartment(name, index);
      if (d.known && !owner.has(d.key)) owner.set(d.key, s.section);
    }
  }

  // 2. By following: a department without a system name follows the one whose manager heads it, i.e. more than half its staff report to that manager (or are the manager).
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
