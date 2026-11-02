/* eslint-disable no-console */
/**
 * cleanItCustodyData: unify the IT custody register and move SIM cards out of it.
 * Usage: node src/scripts/cleanItCustodyData.js --dry | (no flag) | --purge (permanently delete SIM rows)
 * Rerunnable steps: SIMs moved to issuedBySection 'telecom' (reversible; --purge is the only data-losing path), brand case unified and extracted from names, name re-derived from type and brand.
 * Serial, status, employee and dates are untouched.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { deriveAssetName, normalizeBrand, EXCLUDED_TYPES } = require('../config/itCustody');

const DRY = process.argv.includes('--dry');
const PURGE = process.argv.includes('--purge');

// Brands as they appear inside free-text names; matched as whole words so "HP" is not picked up inside another word.
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

  // 1. SIMs
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

  // 2 and 3. Brand and name
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
