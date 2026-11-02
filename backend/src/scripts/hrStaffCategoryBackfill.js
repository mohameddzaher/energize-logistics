/**
 * hrStaffCategoryBackfill: job category (administrative, driver, technician) for B2C and heavy-transport employees, one time; afterwards HR writes it.
 * Shows only; --apply writes.
 * Derived from job title: driver titles to driver, technician or mechanic to technician, supervisor, manager, assistant, follow-up officer to administrative. For B2C staff without a title, from their light-transport register type (rep or driver to driver, mechanic to technician, admin or supervisor to administrative). Unknowns (cleaner, loader and so on) are marked required for HR to decide. Anyone with a category already written is untouched, and each written category gets a history entry.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');

const APPLY = process.argv.includes('--apply');
const S = (v) => String(v ?? '').trim();
const fromTitle = (t) => {
  const s = S(t);
  if (/^سائق/.test(s)) return 'سائق';
  if (/ميكانيكي|^فني/.test(s)) return 'فني';
  if (/مشرف|مدير|مساعد|معقب|مسؤول المتابعة|^[اإ]دار/.test(s)) return 'إداري';
  return '';
};
const fromLt = (r) => {
  if (!r) return '';
  const j = S(r.jobTitleAr);
  if (r.staffKind === 'rep' || r.staffKind === 'driver' || /مندوب|سائق/.test(j)) return 'سائق';
  if (/ميكانيكي|فني/.test(j)) return 'فني';
  if (r.staffKind === 'admin' && /إداري|اداري|مشرف/.test(j)) return 'إداري';
  return '';
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const deps = await require('../utils/hrLists').categoryDepartments();
  const { LightTransportEmployee } = require('../models/LightTransport');
  const lt = new Map((await LightTransportEmployee.find({ employee: { $ne: null } }).select('employee staffKind jobTitleAr').lean()).map((r) => [String(r.employee), r]));
  const rows = await Employee.find({ department: { $in: deps }, isHrRecord: { $ne: false } }).select('employeeNumber arabicName firstName lastName department jobTitle staffCategory fieldStatus').lean();
  const ops = []; const audits = []; const tally = {}; const unknown = [];
  for (const e of rows) {
    if (S(e.staffCategory)) { tally['مكتوبة من قبل'] = (tally['مكتوبة من قبل'] || 0) + 1; continue; }
    const cat = fromTitle(e.jobTitle) || fromLt(lt.get(String(e._id)));
    const k = `${e.department} · ${cat || 'مطلوب'}`; tally[k] = (tally[k] || 0) + 1;
    if (cat) {
      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { staffCategory: cat } } } });
      audits.push({ bySystem: true, userName: 'النظام', action: 'hr_staff_category', entity: 'Employee', entityId: e._id,
        changes: { details: `الفئة الوظيفية: ${cat} (من المسمّى «${S(e.jobTitle) || '—'}»)`, after: { staffCategory: cat } }, createdAt: new Date() });
    } else {
      unknown.push(`${e.employeeNumber || '—'} ${e.arabicName || `${e.firstName} ${e.lastName}`} — «${S(e.jobTitle) || 'بلا مسمّى'}»`);
      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { 'fieldStatus.staffCategoryStatus': 'required' } } } });
    }
  }
  console.log(`القسمان: ${deps.join('، ')} · موظّفون: ${rows.length}`);
  for (const [k, n] of Object.entries(tally).sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
  if (unknown.length) console.log(`\nتُعلَّم «مطلوب» لتقرّر فيها الموارد البشريّة (${unknown.length}):\n  ${unknown.join('\n  ')}`);
  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply للتنفيذ)'); process.exit(0); }
  if (ops.length) await Employee.bulkWrite(ops);
  if (audits.length) await mongoose.connection.db.collection('auditlogs').insertMany(audits);
  console.log(`\nApplied: ${audits.length} فئة · ${unknown.length} مطلوب`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
