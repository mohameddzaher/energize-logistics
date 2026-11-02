/**
 * dedupeCorporatePolicies: two duplicated documents in the corporate insurance register.
 * --dry previews.
 * One policy is a later one under another name, and the fidelity policy shares its number with another. A driver count in the name goes stale on renewal, so names carry no count; it is read from the covered drivers (see DriverCard.fidelity).
 * Soft delete with isActive:false so the row stays for review.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

// Match by name, not id: ids differ between environments.
const DUPES = ['تأمين البضائع + ملحق السيارات', 'تأمين خيانة الأمانة ل 58 سائق'];
// Delete a duplicate only if its original exists, otherwise the only policy would be removed.
const KEEPERS = { 'تأمين البضائع + ملحق السيارات': 'تأمين البضائع', 'تأمين خيانة الأمانة ل 58 سائق': 'تأمين خيانة الأمانة' };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { CorporatePolicy } = require('../models/VehicleMaster');
  const all = await CorporatePolicy.find({}).lean();
  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  console.log(`وثائق الشركة: ${all.length} (نشطة: ${all.filter((p) => p.isActive !== false).length})`);

  let removed = 0;
  for (const scope of DUPES) {
    const dupe = all.find((p) => p.scopeAr === scope && p.isActive !== false);
    if (!dupe) { console.log(`  · «${scope}» — غير موجودةٍ أو محذوفةٌ سلفًا`); continue; }
    const keeper = all.find((p) => p.scopeAr === KEEPERS[scope] && p.isActive !== false);
    if (!keeper) { console.log(`  ⚠ «${scope}» — لم أجد «${KEEPERS[scope]}» فتُركت (لا تُحذف الوثيقةُ الوحيدة)`); continue; }
    const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '—');
    console.log(`  ✕ «${scope}» انتهاؤها ${d(dupe.expiryDate)}  ⟵ الباقية: «${keeper.scopeAr}» ${d(keeper.expiryDate)}`);
    if (!DRY) await CorporatePolicy.updateOne({ _id: dupe._id }, { $set: { isActive: false } });
    removed += 1;
  }

  const left = await CorporatePolicy.find({ isActive: true }).sort({ expiryDate: 1 }).lean();
  console.log(`\n${DRY ? 'ستبقى' : 'بقيت'} ${left.length} وثيقة:`);
  for (const p of left) console.log(`    ${p.scopeAr}  —  ${p.expiryDate ? new Date(p.expiryDate).toISOString().slice(0, 10) : '—'}`);
  console.log(`\n${DRY ? 'سيُحذف' : 'حُذف'}: ${removed}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
