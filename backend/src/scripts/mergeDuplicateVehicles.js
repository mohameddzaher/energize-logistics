/**
 * mergeDuplicateVehicles — دمج سجلات نفس المركبة اللي اتكرّرت بسبب تغيير اللوحة.
 *
 *   node src/scripts/mergeDuplicateVehicles.js --dry
 *   node src/scripts/mergeDuplicateVehicles.js
 *
 * ليه حصل التكرار: الاستيراد كان بيدوّر باللوحة، واللوحة بتتغيّر. أول ما مركبة
 * تتغيّر لوحتها كان بيتعمل لها سجل جديد وتفضل القديمة معلّقة. الاستيراد اتظبط
 * (بقى بيدوّر برقم الهيكل الأول)، والسكربت ده بينضّف اللي حصل قبل الإصلاح.
 *
 * الدمج **مش مسح**: أي حقل فاضي في السجل الجديد وموجود في القديم بيتنقل، وأي
 * تجديدات أو حوادث مربوطة بالقديم بتتحوّل للجديد. بعد كده بس بيتشال القديم.
 * مسح السجل القديم على طول كان هيضيّع بيانات زي رقم شريحة الوقود والملاحظات.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

// الحقول اللي ينفع تتنقل من القديم للجديد لو الجديد فاضي فيها.
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

  // مجموعات بنفس رقم الهيكل — ده المعيار الوحيد اللي بيقول «دي نفس العربية».
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
    // الأحدث تحديثًا هو اللي من الملف الجديد — هو اللي بيفضل.
    const [keep, ...drop] = docs;
    console.log(`رقم الهيكل ${g._id}`);
    console.log(`  يفضل: ${keep.plateNumber}  (آخر تحديث ${new Date(keep.updatedAt).toISOString().slice(0, 10)})`);

    for (const old of drop) {
      console.log(`  يُدمج ويُشال: ${old.plateNumber}  (آخر تحديث ${new Date(old.updatedAt).toISOString().slice(0, 10)})`);
      const patch = {};

      for (const f of SCALARS) {
        if (isEmpty(keep[f]) && !isEmpty(old[f])) { patch[f] = old[f]; console.log(`      ← ${f}: ${old[f]}`); movedFields++; }
      }
      for (const [block, fields] of Object.entries(BLOCKS)) {
        for (const f of fields) {
          if (isEmpty(keep[block]?.[f]) && !isEmpty(old[block]?.[f])) {
            patch[`${block}.${f}`] = old[block][f];
            console.log(`      ← ${block}.${f}: ${old[block][f]}`);
            movedFields++;
          }
        }
      }
      // التجديدات شغل بني آدم — بتتنقل كلها، مش بشرط الفاضي.
      const oldRenewals = old.renewals || [];
      if (oldRenewals.length) { console.log(`      ← ${oldRenewals.length} سجل تجديد`); }

      if (!DRY) {
        if (Object.keys(patch).length) await VehicleMaster.updateOne({ _id: keep._id }, { $set: patch });
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

  console.log(`${merged} سجل مكرّر اتدمج · ${movedFields} حقل اتنقل · ${movedClaims} حادث اتحوّل`);
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
