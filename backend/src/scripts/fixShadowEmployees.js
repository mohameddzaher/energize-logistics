/**
 * Shadow employee records: move their data and delete the empty ones. Without --yes it prints a plan.
 * Self-service creates an empty record without an employee number when no HR record is linked; later linking leaves the shadow holding old leaves and requests.
 * 1) Orphan with data and an exact single name match with a linked real record: move data, delete. 2) Orphan with no data or Arabic name: delete.
 * 3) Full Arabic name but no number: untouched (a real person). 4) Duplicate numbers: reported, not merged.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const LeaveRequest = require('../models/LeaveRequest');
const HRRequest = require('../models/HRRequest');
const Contract = require('../models/Contract');
const Asset = require('../models/Asset');
const EmployeeDocument = require('../models/EmployeeDocument');
const EmployeeRenewal = require('../models/EmployeeRenewal');

const APPLY = process.argv.includes('--yes');

// References to the employee.
// An incomplete list means silent deletion of unchecked data: seven employees were deleted because authorizations were not in the list, each holding an active driving authorization on a company vehicle, leaving the vehicle authorized to a nonexistent person. auditDataIntegrity catches a repeat.
const VehicleAuthorization = require('../models/VehicleAuthorization');
const VehicleAccident = require('../models/VehicleAccident');
const OWNED = [
  ['إجازات', LeaveRequest], ['طلبات', HRRequest], ['عقود', Contract],
  ['عهد', Asset], ['مستندات', EmployeeDocument], ['تجديدات', EmployeeRenewal],
  ['تفاويض', VehicleAuthorization], ['حوادث', VehicleAccident],
];

const fold = (s) => String(s || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[ً-ْـ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

const nameOf = (e) => fold(e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`);
const hasArabic = (s) => /[ء-ي]/.test(String(s || ''));

async function countsFor(id) {
  const out = {};
  let total = 0;
  for (const [label, M] of OWNED) {
    // eslint-disable-next-line no-await-in-loop
    const n = await M.countDocuments({ employee: id });
    if (n) { out[label] = n; total += n; }
  }
  return { out, total };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('\n' + '='.repeat(72));
  console.log(APPLY ? '  سجلّات الموظّفين الظلّيّة — تنفيذ' : '  سجلّات الموظّفين الظلّيّة — تقريرٌ فقط');
  console.log('='.repeat(72));

  const [employees, users] = await Promise.all([
    Employee.find({}).select('firstName lastName arabicName employeeNumber email iqamaNumber nationalId').lean(),
    User.find({}).select('email firstName lastName linkedEmployee').lean(),
  ]);
  const referenced = new Set(users.map((u) => String(u.linkedEmployee || '')).filter(Boolean));
  const real = employees.filter((e) => e.employeeNumber);
  const shadows = employees.filter((e) => !e.employeeNumber);

  console.log(`  موظّفون: ${employees.length} · بلا رقم: ${shadows.length} · يشير إليها حساب: ${shadows.filter((e) => referenced.has(String(e._id))).length}`);

  // 4) Duplicate numbers: reported, not touched.
  const byNum = new Map();
  for (const e of real) {
    const k = String(e.employeeNumber);
    if (!byNum.has(k)) byNum.set(k, []);
    byNum.get(k).push(e);
  }
  const dupes = [...byNum.entries()].filter(([, v]) => v.length > 1);
  const dupDeletes = [];
  const dupReport = [];
  for (const [num, list] of dupes) {
    // Duplicates that resolve themselves: two copies with the same name, one completely empty (no data, no iqama number, no account pointing at it) and the other complete. That is an extra copy, not a second person, and deleting it loses nothing.
    // Everything else is reported and left: one number held by two different people is a real error, and fixing it means giving one a different number, which is HR's decision.
    const sameName = new Set(list.map((e) => nameOf(e))).size === 1;
    // eslint-disable-next-line no-await-in-loop
    const withCounts = await Promise.all(list.map(async (e) => ({
      e,
      total: (await countsFor(e._id)).total,
      linked: referenced.has(String(e._id)),
      hasId: !!String(e.iqamaNumber || e.nationalId || '').trim(),
    })));
    const idOf = (e) => String(e.iqamaNumber || e.nationalId || '').trim();
    const ids = new Set(list.map((x) => idOf(x)).filter(Boolean));
    // One person: same name and same ID number (or absent on one). A record split in two, not two people; merge the data into one and delete the other.
    const samePerson = sameName && ids.size <= 1;
    if (samePerson) {
      // The survivor is the one an account points to, otherwise the one with more data.
      const primary = withCounts.find((x) => x.linked)
        || [...withCounts].sort((a, b) => b.total - a.total)[0];
      withCounts.filter((x) => x !== primary)
        .forEach((x) => dupDeletes.push({ num, e: x.e, keeper: primary.e, total: x.total }));
    } else {
      dupReport.push([num, withCounts]);
    }
  }
  if (dupDeletes.length) {
    console.log(`\n  ⓪ نسخٌ مكرّرةٌ لنفس الشخص — تُدمج في الأصل ثمّ تُحذف: ${dupDeletes.length}`);
    dupDeletes.forEach((d) => console.log(`     #${d.num} ${d.e.arabicName || `${d.e.firstName || ''} ${d.e.lastName || ''}`.trim()}${d.total ? ` (يُنقل منها ${d.total} سجلًّا)` : ' (فارغة)'}`));
  }
  if (dupReport.length) {
    console.log(`\n  ⚠ أرقامُ موظّفين مكرّرة تحتاج قرارَ الموارد البشريّة (${dupReport.length}) — لا يمسّها هذا السكربت:`);
    for (const [num, list] of dupReport) {
      console.log(`     #${num}:`);
      list.forEach((x) => console.log(`        ${x.e.arabicName || `${x.e.firstName || ''} ${x.e.lastName || ''}`.trim() || '(بلا اسم)'} — هويّة ${x.e.iqamaNumber || x.e.nationalId || '—'}، بيانات ${x.total}${x.linked ? '، له حساب' : ''}`));
    }
  }

  const moves = [];
  const deletes = [];
  const keeps = [];

  for (const sh of shadows) {
    if (referenced.has(String(sh._id))) continue;      // Not an orphan
    // eslint-disable-next-line no-await-in-loop
    const { out, total } = await countsFor(sh._id);
    const arabicFullName = hasArabic(sh.arabicName || sh.firstName) && String(sh.arabicName || '').trim().split(/\s+/).length >= 3;

    if (arabicFullName) { keeps.push({ sh, counts: out, total, why: 'اسمٌ عربيٌّ كامل — شخصٌ حقيقيّ ينقصه رقمُ موظّف' }); continue; }

    if (total === 0) { deletes.push({ sh }); continue; }

    // Has data: does the owner of that name have an account linked to a real record?
    const key = nameOf(sh);
    const cands = users.filter((u) => u.linkedEmployee && fold(`${u.firstName || ''} ${u.lastName || ''}`) === key);
    const targets = [...new Set(cands.map((u) => String(u.linkedEmployee)))];
    if (targets.length === 1) {
      const target = real.find((e) => String(e._id) === targets[0]);
      if (target && String(target._id) !== String(sh._id)) {
        moves.push({ sh, target, counts: out, total });
        continue;
      }
    }
    keeps.push({ sh, counts: out, total, why: targets.length ? 'الهدفُ ملتبس' : 'لا حسابَ يدلّ على صاحبه' });
  }

  const label = (e) => (e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || String(e._id));

  console.log(`\n  ① تُنقل بياناتُها ثمّ تُحذف: ${moves.length}`);
  moves.forEach((m) => console.log(`     ${label(m.sh)}  →  #${m.target.employeeNumber} ${label(m.target)}   (${Object.entries(m.counts).map(([k, v]) => `${k} ${v}`).join('، ')})`));

  console.log(`\n  ② تُحذف (يتيمةٌ فارغة): ${deletes.length}`);
  deletes.forEach((d) => console.log(`     ${label(d.sh)}`));

  console.log(`\n  ③ تُترك: ${keeps.length}`);
  keeps.forEach((k) => console.log(`     ${label(k.sh)}${k.total ? ` (${Object.entries(k.counts).map(([a, b]) => `${a} ${b}`).join('، ')})` : ''} — ${k.why}`));

  if (!APPLY) { console.log('\n  — تقريرٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let moved = 0; let removed = 0;
  for (const m of moves) {
    for (const [, M] of OWNED) {
      // eslint-disable-next-line no-await-in-loop
      const r = await M.updateMany({ employee: m.sh._id }, { $set: { employee: m.target._id } });
      moved += r.modifiedCount;
    }
    // eslint-disable-next-line no-await-in-loop
    await Employee.deleteOne({ _id: m.sh._id });
    removed += 1;
  }
  for (const d of deletes) {
    // eslint-disable-next-line no-await-in-loop
    await Employee.deleteOne({ _id: d.sh._id });
    removed += 1;
  }
  for (const d of dupDeletes) {
    for (const [, M] of OWNED) {
      // eslint-disable-next-line no-await-in-loop
      const r = await M.updateMany({ employee: d.e._id }, { $set: { employee: d.keeper._id } });
      moved += r.modifiedCount;
    }
    // eslint-disable-next-line no-await-in-loop
    await Employee.deleteOne({ _id: d.e._id });
    removed += 1;
  }
  console.log(`\n  ✓ نُقل ${moved} سجلًّا · حُذف ${removed} سجلَّ موظّفٍ ظلّيّ\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
