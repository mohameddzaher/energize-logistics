/**
 * Merges records of the same vehicle duplicated by a plate change.
 * Usage: node src/scripts/mergeDuplicateVehicles.js [--dry]
 * The import matched by plate, which changes, so a plate change created a new record and left the old one. The import now matches chassis first; this cleans the earlier damage.
 * Only what the sheet does not know is moved: renewals (entered on screen) and linked accidents. Other fields come from the master, which is authoritative; e.g. the sheet explicitly says no fuel chip, and copying the old chip would undo that. Differences are printed for a human, not moved.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

// Fields that may move from old to new when the new one is empty.
const SCALARS = ['serialNumber', 'notesAr', 'commercialRegistration', 'plateLettersAr', 'plateDigits', 'colorAr', 'colorCode'];
const BLOCKS = {
  fuelCard: ['provider', 'cardNumber', 'statusAr', 'statusCode', 'consumptionTypeAr', 'consumptionTypeCode', 'limitSar', 'limitStatus'],
  gps: ['deviceId', 'deviceModel', 'simNumber', 'serialImei', 'provider', 'status', 'statusCode', 'expiryDate'],
  insurance: ['policyNumber', 'companyAr', 'coverageTypeAr', 'expiryDate', 'premiumSar'],
  operatingCard: ['cardNumber', 'expiryDate'],
  vehicleLicense: ['expiryDate'],
  inspection: ['statusAr', 'expiryDate'],
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const { VehicleMaster } = require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');

  // Groups sharing a chassis number, the only criterion for being the same vehicle.
  const groups = await VehicleMaster.aggregate([
    { $match: { chassisNumber: { $nin: ['', null] } } },
    { $group: { _id: '$chassisNumber', ids: { $push: '$_id' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);

  if (!groups.length) { console.log('مفيش تكرار — كل رقم هيكل ليه سجل واحد.'); process.exit(0); }
  console.log(`${groups.length} رقم هيكل متكرّر${DRY ? '   (تجربة — لن يُكتب شيء)' : ''}\n`);

  let merged = 0; let movedFields = 0; let movedClaims = 0;

  for (const g of groups) {
    const docs = await VehicleMaster.find({ _id: { $in: g.ids } }).sort({ updatedAt: -1 }).lean();
    // The most recently updated record is from the new file and is the one kept.
    const [keep, ...drop] = docs;
    console.log(`رقم الهيكل ${g._id}`);
    console.log(`  يفضل: ${keep.plateNumber}  (آخر تحديث ${new Date(keep.updatedAt).toISOString().slice(0, 10)})`);

    for (const old of drop) {
      console.log(`  يُدمج ويُشال: ${old.plateNumber}  (آخر تحديث ${new Date(old.updatedAt).toISOString().slice(0, 10)})`);
      // Data in the old record but not the new one is only printed. The master decides what is right and we do not guess.
      const differs = [];
      for (const f of SCALARS) {
        if (isEmpty(keep[f]) && !isEmpty(old[f])) differs.push(`${f}: ${old[f]}`);
      }
      for (const [block, fields] of Object.entries(BLOCKS)) {
        for (const f of fields) {
          if (isEmpty(keep[block]?.[f]) && !isEmpty(old[block]?.[f])) differs.push(`${block}.${f}: ${old[block][f]}`);
        }
      }
      if (differs.length) {
        console.log(`      ⓘ كان في السجل القديم ومش في الماستر الجديد (للعلم — مش هيتنقل):`);
        differs.forEach((x) => console.log(`          ${x}`));
        movedFields += differs.length;
      }
      // Renewals are human work, so all move regardless of emptiness.
      const oldRenewals = old.renewals || [];
      if (oldRenewals.length) { console.log(`      ← ${oldRenewals.length} سجل تجديد`); }

      if (!DRY) {
        if (oldRenewals.length) await VehicleMaster.updateOne({ _id: keep._id }, { $push: { renewals: { $each: oldRenewals } } });
        const r = await VehicleClaim.updateMany({ vehicle: old._id }, { $set: { vehicle: keep._id } });
        movedClaims += r.modifiedCount || 0;
        if (r.modifiedCount) console.log(`      ← ${r.modifiedCount} حادث اتحوّل للسجل الجديد`);
        await VehicleMaster.deleteOne({ _id: old._id });
      }
      merged++;
    }
    console.log('');
  }

  console.log(`${merged} سجل مكرّر اتشال · ${movedFields} حقل اختلف (اتطبع للعلم) · ${movedClaims} حادث اتحوّل`);
  if (!DRY) {
    const left = await VehicleMaster.aggregate([
      { $match: { chassisNumber: { $nin: ['', null] } } },
      { $group: { _id: '$chassisNumber', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]);
    console.log(left.length ? `✗ لسه فيه ${left.length} تكرار` : '✓ مفيش تكرار فاضل');
    console.log(`إجمالي المركبات: ${await VehicleMaster.countDocuments({})}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
