/* eslint-disable no-console */
/**
 * cleanItCustodyData — توحيد سجل عهد تقنية المعلومات، وإخراج شرائح الاتصال منه.
 *
 *   node src/scripts/cleanItCustodyData.js --dry     ← تجربة، لا تكتب شيئاً
 *   node src/scripts/cleanItCustodyData.js
 *   node src/scripts/cleanItCustodyData.js --purge   ← حذف صفوف الشرائح نهائياً
 *
 * ما الذي كان في السجل قبل التنظيف: أربعمئة وأربعة وثمانون... بل ثلاثمئة
 * وأربعة وثمانون صنفاً تحمل ستة وستين اسماً حرّاً مختلفاً — «Dell» و«لابتوب
 * Dell» و«Laptop HP» و«ASUS» و«شاحن لابتوب Asus» صفوف لأشياء يفترض أن تُكتب
 * بطريقة واحدة. والماركة فارغة في مئتين وستة عشر صفاً، ومكتوبة بحالتَي أحرف
 * مختلفتين حيث وُجدت (Honor/HONOR، Asus/ASUS، Oppo/OPPO، logitech/Logitech)،
 * فكان كل تجميع حسب الماركة ينقسم على نفسه.
 *
 * ثلاث خطوات، كلها قابلة لإعادة التشغيل بلا أثر مضاعف:
 *
 *   ١. الشرائح: خطوط الأرقام ليست من عهدة القسم. الافتراضي نقلها إلى
 *      `issuedBySection: 'telecom'` — نقل قابل للتراجع يُخرجها من كل شاشات
 *      القسم دون إتلاف سجل من كانت باسمه. و`--purge` يحذفها فعلاً، وهو
 *      المسار الوحيد الذي يفقد البيانات، ولذلك لا يعمل إلا بطلب صريح.
 *
 *   ٢. الماركة: توحيد حالة الأحرف، واستخراجها من الاسم الحرّ حيث كانت فارغة —
 *      «لابتوب Asus» يعرف ماركته، لكن الحقل الذي تُقرأ منه التقارير كان خالياً.
 *
 *   ٣. الاسم: يُعاد اشتقاقه من النوع والماركة، فيصير للصنف الواحد اسم واحد.
 *
 * الرقم التسلسلي والحالة والموظف والتواريخ لا تُمَس: هي البيانات التي لا يمكن
 * إعادة توليدها إن أُخطئ فيها.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { deriveAssetName, normalizeBrand, EXCLUDED_TYPES } = require('../config/itCustody');

const DRY = process.argv.includes('--dry');
const PURGE = process.argv.includes('--purge');

// الماركات كما تظهر داخل الأسماء الحرّة. تُطابَق ككلمة كاملة حتى لا يلتقط
// «HP» حرفَي «HP» داخل كلمة أخرى.
const BRANDS = ['Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'Apple', 'Samsung', 'Honor', 'Oppo',
  'MSI', 'LG', 'Logitech', 'Logi', 'Legion', 'SMI', 'Mobily', 'Huawei', 'Xiaomi'];

const brandFromName = (name) => {
  const n = String(name || '');
  const hit = BRANDS.find((b) => new RegExp(`(^|[^\\p{L}])${b}([^\\p{L}]|$)`, 'iu').test(n));
  return hit ? normalizeBrand(hit) : '';
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Asset = require('../models/Asset');

  const mode = DRY ? '   (تجربة — لن يُكتب شيء)' : '';
  console.log(`تنظيف سجل عهد تقنية المعلومات${mode}\n`);

  // ── ١. الشرائح ────────────────────────────────────────────────────────────
  const sims = await Asset.find({ type: 'sim' }).select('_id name serialNumber status employee').lean();
  console.log(`شرائح الاتصال: ${sims.length} صف`);
  if (sims.length) {
    if (PURGE) {
      console.log('  → حذف نهائي (--purge)');
      if (!DRY) {
        const r = await Asset.deleteMany({ type: 'sim' });
        console.log(`  حُذف ${r.deletedCount}`);
      }
    } else {
      console.log("  → نقل إلى issuedBySection: 'telecom' (قابل للتراجع)");
      if (!DRY) {
        const r = await Asset.updateMany(
          { type: 'sim', issuedBySection: { $ne: 'telecom' } },
          { $set: { issuedBySection: 'telecom', category: 'TELECOM' } },
        );
        console.log(`  نُقل ${r.modifiedCount}`);
      }
    }
  }

  // ── ٢ و٣. الماركة والاسم ──────────────────────────────────────────────────
  const rows = await Asset.find({ type: { $nin: EXCLUDED_TYPES } })
    .select('_id name type brand')
    .lean();

  let brandFixed = 0;
  let brandFilled = 0;
  let nameFixed = 0;
  const ops = [];

  rows.forEach((a) => {
    const current = String(a.brand || '').trim();
    let brand = normalizeBrand(current);
    if (!brand) {
      const guessed = brandFromName(a.name);
      if (guessed) { brand = guessed; brandFilled += 1; }
    } else if (brand !== current) {
      brandFixed += 1;
    }

    const name = deriveAssetName(a.type, brand);
    const changed = brand !== current || name !== String(a.name || '');
    if (name !== String(a.name || '')) nameFixed += 1;
    if (changed) ops.push({ updateOne: { filter: { _id: a._id }, update: { $set: { brand, name } } } });
  });

  console.log(`\nالأصناف المعنية: ${rows.length} صف`);
  console.log(`  ماركة وُحّدت كتابتها : ${brandFixed}`);
  console.log(`  ماركة استُخرجت من الاسم: ${brandFilled}`);
  console.log(`  اسم أُعيد اشتقاقه    : ${nameFixed}`);
  console.log(`  صفوف ستُكتب          : ${ops.length}`);

  if (ops.length && !DRY) {
    const r = await Asset.bulkWrite(ops, { ordered: false });
    console.log(`\nكُتب ${r.modifiedCount} صف.`);
  }

  if (DRY) console.log('\nلم يُكتب شيء. أعد التشغيل بدون --dry للتنفيذ.');
  await mongoose.disconnect();
})().catch((e) => { console.error('فشل:', e.message); process.exit(1); });
