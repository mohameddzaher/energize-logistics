/* eslint-disable no-console */
/**
 * Finds login accounts linked to a placeholder record instead of the real one.
 * When an employee logs in with no HR record, the system creates an empty self-service file (isHrRecord: false) so they can request leave. Once HR later enters the real record, the person has two: the real one with contract, identity and salary, and an empty one linked to the account. Leave balance is then read from the empty record and shows zero.
 * Not fixed automatically: the account is in English, the record in the local language, and the account has no identity number. Candidates are listed and linking needs an explicit command.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z؀-ۿ]/g, '');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');

  // Explicit link
  if (has('--link')) {
    const email = val('--link');
    const empNo = argv[argv.indexOf('--link') + 2];
    const user = await User.findOne({ email: new RegExp(`^${email}$`, 'i') });
    if (!user) { console.log(`✗ لا حساب بالبريد ${email}`); process.exit(1); }
    const emp = await Employee.findOne({ employeeNumber: empNo });
    if (!emp) { console.log(`✗ لا موظّف برقم ${empNo}`); process.exit(1); }
    console.log(`\n  ${user.email}  →  ${emp.arabicName || `${emp.firstName} ${emp.lastName}`} (رقم ${emp.employeeNumber})`);
    const old = user.linkedEmployee ? await Employee.findById(user.linkedEmployee).lean() : null;
    if (old) console.log(`  الرابط الحاليّ: ${old.arabicName || old.firstName} ${old.isHrRecord === false ? '(سجلٌّ وهميّ)' : '(سجلٌّ حقيقيّ)'}`);
    if (!has('--yes')) { console.log('\n  — لم يُمرَّر --yes، فلم يُكتب شيء.\n'); process.exit(0); }
    await User.updateOne({ _id: user._id }, { linkedEmployee: emp._id });
    await Employee.updateOne({ _id: emp._id }, { user: user._id });
    // The placeholder record is unlinked, not deleted, since old requests may reference it.
    if (old && old.isHrRecord === false) await Employee.updateOne({ _id: old._id }, { $unset: { user: 1 } });
    console.log('  ✓ رُبط.\n');
    process.exit(0);
  }

  // Inventory
  const [users, emps, activeContracts] = await Promise.all([
    User.find({ role: { $ne: 'client' } }).select('email firstName lastName role linkedEmployee').lean(),
    Employee.find().select('firstName lastName arabicName email employeeNumber iqamaNumber jobTitle isHrRecord').lean(),
    Contract.find({ status: 'active' }).select('employee annualLeaveDays startDate').lean(),
  ]);
  const byId = new Map(emps.map((e) => [String(e._id), e]));
  const contractOf = new Map(activeContracts.map((c) => [String(c.employee), c]));
  const real = emps.filter((e) => e.isHrRecord !== false);

  const rows = [];
  for (const u of users) {
    const e = u.linkedEmployee ? byId.get(String(u.linkedEmployee)) : null;
    if (e && e.isHrRecord !== false) continue;              // Linked to a real record.
    // Candidates: any real record sharing a name word with the account.
    const words = norm(`${u.firstName || ''}${u.lastName || ''}`);
    const cands = real
      .map((r) => {
        const rn = norm(r.arabicName || `${r.firstName || ''}${r.lastName || ''}`);
        const en = norm(`${r.firstName || ''}${r.lastName || ''}`);
        let score = 0;
        if (en && (en.includes(words) || words.includes(en))) score = 3;
        else if (r.email && u.email && r.email.toLowerCase() === u.email.toLowerCase()) score = 4;
        else if (rn && words && [...new Set(words.match(/.{4,}/g) || [])].some((w) => rn.includes(w))) score = 1;
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    rows.push({ u, e, cands });
  }

  console.log(`\n  ${users.length} حسابًا · ${rows.length} منها غير مربوطٍ بسجلٍّ حقيقيّ\n`);
  for (const { u, e, cands } of rows) {
    console.log(`  ${u.email}  (${u.firstName || ''} ${u.lastName || ''} · ${u.role})`);
    console.log(`     الحاليّ : ${e ? `${e.arabicName || e.firstName || ''} — سجلُّ خدمةٍ ذاتية فارغ` : 'بلا ربط'}`);
    if (!cands.length) console.log('     المرشّحون: لا مرشَّح — يُربط يدويًّا من صفحة المستخدمين');
    for (const c of cands) {
      const ct = contractOf.get(String(c.r._id));
      console.log(`     مرشَّح  : ${(c.r.arabicName || `${c.r.firstName} ${c.r.lastName}`).padEnd(34)} رقم ${String(c.r.employeeNumber || '—').padEnd(6)}${ct ? ` · عقدٌ ساري (${ct.annualLeaveDays} يوم)` : ' · بلا عقد'}`);
    }
    console.log('');
  }
  console.log('  للربط:  node src/scripts/auditEmployeeLinks.js --link <بريد الحساب> <رقم الموظّف> --yes\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
