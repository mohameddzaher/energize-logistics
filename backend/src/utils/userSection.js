/**
 * The department (section key) a person belongs to: the section his role heads or works in, else the department on
 * his HR file. Super admins and other roles above a single section (IT run from super admin accounts, the CFO) have no
 * section in their role, so without the HR file their tasks fell under whatever department a form defaulted to.
 * HR departments are matched by their list key, not their Arabic name, so renaming a department does not break it.
 */
const { sectionOfRole } = require('../config/roles');

const KEY_SECTION = {
  operations: 'Operations', collections: 'Collections', heavy_transport: 'Fleet Management', light_transport: 'B2C',
  customs: 'Customs', hr: 'HR', finance: 'Accounting', sales: 'Sales', marketing: 'Marketing', it: 'Software & IT',
  management: 'Executive',
};
const ROLE_FALLBACK = { cfo: 'Accounting' };
const fold = (s) => String(s || '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');

let cache = { at: 0, map: null };
/** HR department name (Arabic or English, folded) -> section key; refreshed every minute. */
async function departmentSections() {
  if (cache.map && Date.now() - cache.at < 60000) return cache.map;
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type: 'hr_department', deleted: { $ne: true } }).select('key nameAr nameEn').lean();
  const map = new Map();
  for (const r of rows) {
    const sec = KEY_SECTION[r.key];
    if (!sec) continue;
    if (r.nameAr) map.set(fold(r.nameAr), sec);
    if (r.nameEn) map.set(fold(r.nameEn), sec);
  }
  cache = { at: Date.now(), map };
  return map;
}

/** Section of one user; `user.linkedEmployee.department` must be populated for the HR fallback. */
async function sectionOfUser(user) {
  if (!user) return null;
  const byRole = sectionOfRole(user.role) || ROLE_FALLBACK[user.role];
  if (byRole) return byRole;
  const dept = user.linkedEmployee && user.linkedEmployee.department;
  return dept ? (await departmentSections()).get(fold(dept)) || null : null;
}

/** id -> section for many user ids, in two queries. */
async function sectionsOfUserIds(ids) {
  const User = require('../models/User');
  require('../models/Employee');
  const uniq = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!uniq.length) return new Map();
  const users = await User.find({ _id: { $in: uniq } }).select('role linkedEmployee').populate('linkedEmployee', 'department').lean();
  const map = await departmentSections();
  const out = new Map();
  for (const u of users) {
    const byRole = sectionOfRole(u.role) || ROLE_FALLBACK[u.role];
    const dept = u.linkedEmployee && u.linkedEmployee.department;
    out.set(String(u._id), byRole || (dept ? map.get(fold(dept)) || null : null));
  }
  return out;
}

module.exports = { sectionOfUser, sectionsOfUserIds, departmentSections };
