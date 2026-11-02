/**
 * hrWorkStatusBackfill: work status is derived from status: working, or not working with the status.
 * Shows only; --apply writes.
 * The field is no longer typed by hand; it was free text from the master sheet. Whoever has not ended service becomes working (leave stays in the employment status, not here); whoever ended becomes not working, plus a status when the old text indicates one: final exit to final exit, sister company to sister company, sponsorship transfer to awaiting sponsorship transfer.
 * No one's employment status changes. Suspended staff (old status) are listed for HR to decide: end service with the awaiting-transfer status, or reactivate.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const ENG = require('../utils/hrEngagement');

const APPLY = process.argv.includes('--apply');
const kindFromText = (t) => {
  const s = String(t || '');
  if (/خروج\s*نهائ/.test(s)) return 'final_exit';
  if (/شقيق/.test(s)) return 'sister_company';
  if (/نقل.{0,6}كفال|كفال.{0,6}نقل/.test(s)) return 'transfer_pending';
  return '';
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const rows = await Employee.find({ isHrRecord: { $ne: false } })
    .select('arabicName firstName lastName employeeNumber employmentStatus workStatusText terminationKind terminatedAt sisterCompany').lean();
  const ops = []; const tally = {}; const suspended = []; const audits = []; const conflicts = [];
  const nm = (e) => `${e.employeeNumber || '—'} ${e.arabicName || `${e.firstName} ${e.lastName}`}`;
  for (const e of rows) {
    const set = {};
    if (e.employmentStatus === 'terminated' && !e.terminationKind) {
      const k = kindFromText(e.workStatusText);
      if (k) {
        set.terminationKind = k;
        // An old waiting status has its deadline counted from its end date; once past, alerts start saying overdue.
        if (k === 'transfer_pending') set.transferDeadline = new Date(new Date(e.terminatedAt || Date.now()).getTime() + ENG.TRANSFER_DAYS * 86400000);
      }
    }
    const want = ENG.workStatusTextOf({ ...e, ...set });
    if (String(e.workStatusText || '') !== want) set.workStatusText = want;
    if (e.employmentStatus === 'suspended') suspended.push(`${e.employeeNumber || '—'} ${e.arabicName || `${e.firstName} ${e.lastName}`}`);
    // Working, yet the old text says otherwise: for HR to decide.
    if (e.employmentStatus !== 'terminated' && /لا يعمل|خروج|استقال|انهاء|إنهاء/.test(String(e.workStatusText || ''))) conflicts.push(`${nm(e)} — «${e.workStatusText}»`);
    if (Object.keys(set).length) {
      // The old text is kept in the employee's history tab.
      if (String(e.workStatusText || '').trim()) {
        audits.push({
          bySystem: true, userName: 'النظام', action: 'hr_work_status_derived', entity: 'Employee', entityId: e._id,
          changes: { details: `حالة العمل صارت من الحالة: «${e.workStatusText}» → «${want}»`, before: { workStatusText: e.workStatusText }, after: { workStatusText: want, ...(set.terminationKind ? { terminationKind: set.terminationKind } : {}) } },
          createdAt: new Date(),
        });
      }
      const k = `«${e.workStatusText || ''}» → «${want}»`;
      tally[k] = (tally[k] || 0) + 1;
      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: set } } });
    }
  }
  console.log(`employees: ${rows.length} | to update: ${ops.length}`);
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  if (suspended.length) console.log(`\nموقوفون (حالة قديمة) — تقرّر فيهم الموارد البشريّة: ${suspended.join(' · ')}`);
  if (conflicts.length) console.log(`\nعلى رأس العمل والنصُّ القديم يقول غير ذلك (${conflicts.length}):\n  ${conflicts.join('\n  ')}`);
  if (!APPLY) { console.log('\n(عرضٌ فقط — أضِف --apply للتنفيذ)'); process.exit(0); }
  if (ops.length) await Employee.bulkWrite(ops);
  if (audits.length) await mongoose.connection.db.collection('auditlogs').insertMany(audits);
  try { require('../utils/ttlCache').clear('hrm:'); require('../utils/ttlCache').clear('hr:'); } catch (_) { /* */ }
  console.log(`\nApplied: ${ops.length}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
