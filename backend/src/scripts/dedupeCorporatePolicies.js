/**
 * dedupeCorporatePolicies — وثيقتان مكرَّرتان في «وثائق تأمين الشركة».
 *
 *   node src/scripts/dedupeCorporatePolicies.js --dry
 *   node src/scripts/dedupeCorporatePolicies.js
 *
 * السجلُّ يحمل خمسَ وثائق، اثنتان منها هما نفسُهما وثيقتان أخريان:
 *   «تأمين البضائع + ملحق السيارات»  انتهاؤها 2026-08-26  ⟵ سبقتها «تأمين البضائع» 2027-08-26
 *   «تأمين خيانة الأمانة ل 58 سائق»                        ⟵ ورقمُها هو رقمُ «تأمين خيانة الأمانة» نفسُه
 *
 * وعدُّ السائقين في الاسم هو العلّة: الوثيقةُ تُجدَّد ويتغيّر العدد، فيبقى
 * الاسمُ يقول ثمانيةً وخمسين إلى الأبد. فتبقى الوثيقةُ بلا عددٍ في اسمها،
 * ويُقرأ العددُ من السائقين المشمولين أنفسِهم — راجع DriverCard.fidelity.
 *
 * الحذفُ ناعم: `isActive:false`، فالشاشة تقرأ النشطَ وحده والصفُّ يبقى للمراجعة.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

// يُطابَق بالاسم لا بالمعرّف: المعرّفات تختلف بين بيئةٍ وأخرى، والاسمُ هو ما رآه صاحبُ الطلب.
const DUPES = ['تأمين البضائع + ملحق السيارات', 'تأمين خيانة الأمانة ل 58 سائق'];
// ولا يُحذف مكرَّرٌ إلّا إن كان أصلُه موجودًا — وإلّا فنحن نحذف الوثيقة الوحيدة.
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
